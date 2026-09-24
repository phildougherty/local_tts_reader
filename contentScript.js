/**
 * Content script for the TTS reader.
 *
 * Responsibilities:
 *  - Capture the text being read (current selection, or the whole page)
 *    as a flattened string PLUS a parallel map back to DOM Ranges, so
 *    each sentence chunk sent to the TTS backend can later be
 *    highlighted in place on the real page.
 *  - Split that flattened text into sentences (via sentenceSplitter.js)
 *    and resolve each sentence back into a DOM Range.
 *  - Respond to background.js messages telling it which sentence index
 *    is currently playing, and highlight/clear accordingly.
 *
 * Uses the CSS Custom Highlight API (`CSS.highlights` + `Highlight`)
 * rather than mutating the DOM (wrapping nodes in <span>), because a
 * sentence's Range frequently crosses partial inline elements (bold,
 * links, spans) where `Range.surroundContents()` would throw. The
 * Custom Highlight API paints a Range without touching the DOM tree at
 * all, so partial/multi-element ranges just work. Supported in Chrome
 * 105+, which covers any Chrome capable of running this MV3 extension.
 */
(function () {
  if (window.__ttsContentScriptInstalled) {
    return;
  }
  window.__ttsContentScriptInstalled = true;

  const HIGHLIGHT_NAME = 'tts-reader-highlight';
  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'MAIN',
    'BLOCKQUOTE', 'PRE', 'TABLE', 'TR', 'TD', 'TH', 'THEAD', 'TBODY',
    'FORM', 'FIELDSET', 'FIGURE', 'FIGCAPTION', 'DETAILS', 'SUMMARY',
    'DL', 'DT', 'DD', 'ADDRESS', 'HR', 'BODY', 'HTML'
  ]);
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

  let currentSessionId = 0;
  let sentenceRanges = [];

  function supportsCustomHighlight() {
    return typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight !== 'undefined';
  }

  function injectHighlightStyle() {
    if (!supportsCustomHighlight() || document.getElementById('tts-reader-highlight-style')) return;
    const style = document.createElement('style');
    style.id = 'tts-reader-highlight-style';
    style.textContent = `::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(233, 69, 96, 0.45); color: inherit; }`;
    (document.head || document.documentElement).appendChild(style);
  }

  function clearHighlight() {
    if (supportsCustomHighlight()) {
      CSS.highlights.delete(HIGHLIGHT_NAME);
    }
  }

  function highlightSentence(index) {
    clearHighlight();
    const range = sentenceRanges[index];
    if (!range || !supportsCustomHighlight()) return;
    try {
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range));
      const rect = range.getBoundingClientRect();
      if (rect && (rect.top < 60 || rect.bottom > window.innerHeight - 60)) {
        const el = range.startContainer.nodeType === Node.TEXT_NODE
          ? range.startContainer.parentElement
          : range.startContainer;
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (e) {
      console.error('[TTS Reader] highlight error:', e);
    }
  }

  function isHidden(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse';
  }

  function getBlockAncestor(el) {
    let node = el;
    while (node && node !== document.body) {
      if (BLOCK_TAGS.has(node.tagName)) return node;
      node = node.parentElement;
    }
    return document.body;
  }

  /**
   * Walk the text (and <br>) nodes inside `range`, building:
   *  - fullText: flattened string, with a synthetic "\n" inserted
   *    between nodes that live in different block-level ancestors (so
   *    e.g. two adjacent <div>s don't fuse into one run-on word/sentence
   *    the way raw textContent concatenation would).
   *  - segments: ordered list of {node, nodeOffsetStart, start, end}
   *    mapping fullText offsets back to (textNode, offset) DOM positions.
   *    Synthetic separators are NOT covered by any segment.
   */
  function buildTextMap(range) {
    const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentNode
      : range.commonAncestorContainer;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
            if (isHidden(node)) return NodeFilter.FILTER_REJECT;
            return node.tagName === 'BR' && range.intersectsNode(node)
              ? NodeFilter.FILTER_ACCEPT
              : NodeFilter.FILTER_SKIP;
          }
          if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (parent && SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (parent && isHidden(parent)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let fullText = '';
    const segments = [];
    let prevBlockAncestor = null;

    let node;
    while ((node = walker.nextNode())) {
      if (node.tagName === 'BR') {
        if (!/\s$/.test(fullText)) fullText += '\n';
        continue;
      }

      const blockAncestor = getBlockAncestor(node.parentElement);
      if (prevBlockAncestor !== null && blockAncestor !== prevBlockAncestor && !/\s$/.test(fullText)) {
        fullText += '\n';
      }
      prevBlockAncestor = blockAncestor;

      const text = node.textContent;
      let nodeStart = 0;
      let nodeEnd = text.length;
      if (node === range.startContainer) nodeStart = range.startOffset;
      if (node === range.endContainer) nodeEnd = range.endOffset;

      if (nodeEnd <= nodeStart) continue;
      const included = text.slice(nodeStart, nodeEnd);
      if (included.length === 0) continue;

      segments.push({
        node,
        nodeOffsetStart: nodeStart,
        start: fullText.length,
        end: fullText.length + included.length
      });
      fullText += included;
    }

    return { fullText, segments };
  }

  /** Resolve a [start, end) offset pair in fullText to a DOM Range, clamping into the nearest real segment if it falls on a synthetic separator. */
  function resolveRange(segments, start, end) {
    if (segments.length === 0) return null;

    let startSeg = segments.find((s) => start >= s.start && start <= s.end);
    if (!startSeg) startSeg = segments.find((s) => s.start >= start) || segments[segments.length - 1];
    let endSeg = segments.find((s) => end >= s.start && end <= s.end);
    if (!endSeg) {
      endSeg = [...segments].reverse().find((s) => s.end <= end) || segments[0];
    }
    if (!startSeg || !endSeg) return null;

    const startOffsetInSeg = Math.max(0, Math.min(start, startSeg.end) - startSeg.start);
    const endOffsetInSeg = Math.max(0, Math.min(end, endSeg.end) - endSeg.start);

    const domRange = document.createRange();
    try {
      domRange.setStart(startSeg.node, startSeg.nodeOffsetStart + startOffsetInSeg);
      domRange.setEnd(endSeg.node, endSeg.nodeOffsetStart + endOffsetInSeg);
    } catch (e) {
      return null;
    }
    if (domRange.collapsed) return null;
    return domRange;
  }

  function getSourceRange(mode) {
    if (mode === 'selection') {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        return selection.getRangeAt(0).cloneRange();
      }
    }
    // Fall back to (or explicitly use) the whole page body.
    const range = document.createRange();
    range.selectNodeContents(document.body);
    return range;
  }

  /**
   * Prepare a new reading session: capture text + build sentence Ranges.
   * @returns {{ sessionId: number, sentences: string[] }}
   */
  function prepareSession(mode) {
    clearHighlight();
    const sourceRange = getSourceRange(mode);
    const { fullText, segments } = buildTextMap(sourceRange);
    const boundaries = (window.SentenceSplitter || self.SentenceSplitter).findSentenceBoundaries(fullText);

    currentSessionId += 1;
    const sessionId = currentSessionId;
    sentenceRanges = [];
    const sentences = [];

    for (const { start, end } of boundaries) {
      const domRange = resolveRange(segments, start, end);
      const text = fullText.slice(start, end).trim();
      if (!text) continue;
      sentenceRanges.push(domRange);
      sentences.push(text);
    }

    return { sessionId, sentences };
  }

  // Exposed directly (not via chrome.runtime.sendMessage) because
  // background.js calls this through chrome.scripting.executeScript's
  // `func`, which runs in this SAME isolated world/frame — and Chrome
  // explicitly excludes "the frame that called sendMessage" from
  // receiving its own broadcast, so a same-frame round trip through
  // chrome.runtime.onMessage would just hang forever. Highlight
  // updates below are a different case: those come from background.js
  // itself (a different context) via chrome.tabs.sendMessage, which is
  // never excluded.
  window.__ttsPrepareSession = prepareSession;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case 'ttsHighlightSentence': {
        if (message.sessionId === currentSessionId) {
          highlightSentence(message.index);
        }
        return false;
      }
      case 'ttsClearHighlight': {
        if (message.sessionId === currentSessionId || message.sessionId === undefined) {
          clearHighlight();
        }
        return false;
      }
    }
    return false;
  });

  window.addEventListener('beforeunload', clearHighlight);
  injectHighlightStyle();
})();
