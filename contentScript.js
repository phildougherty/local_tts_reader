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
 *
 * When nothing is selected, whole-page reads first try to extract just
 * the article content via vendor/readability.js (dropping nav/ads/
 * sidebars) and render it into a distraction-free overlay we inject
 * ourselves — see buildReaderOverlay(). Readability's own output is a
 * cleaned/detached copy, not a live reference into the page, so it
 * can't be used to build Ranges directly; rendering it into fresh DOM
 * we control sidesteps that while reusing the same sentence-splitting
 * and highlighting code as the selection path. If extraction fails or
 * the result looks too thin, this falls back to reading document.body
 * exactly as before.
 */
(function () {
  if (window.__ttsContentScriptInstalled) {
    return;
  }
  window.__ttsContentScriptInstalled = true;

  const HIGHLIGHT_NAME = 'tts-reader-highlight';
  const MIN_READABLE_LENGTH = 200;
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
  let readerOverlayEl = null;

  function supportsCustomHighlight() {
    return typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight !== 'undefined';
  }

  function injectStyle() {
    if (document.getElementById('tts-reader-style')) return;
    const style = document.createElement('style');
    style.id = 'tts-reader-style';
    style.textContent = `
      ${supportsCustomHighlight() ? `::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(233, 69, 96, 0.45); color: inherit; }` : ''}

      #tts-reader-overlay-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 5vh 20px;
        box-sizing: border-box;
      }
      #tts-reader-overlay {
        position: relative;
        background: #1a1a2e;
        color: #e6e6e6;
        max-width: 700px;
        width: 100%;
        max-height: 90vh;
        overflow-y: auto;
        border-radius: 10px;
        padding: 50px 40px 40px;
        box-sizing: border-box;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        line-height: 1.6;
      }
      #tts-reader-overlay-close {
        position: absolute;
        top: 12px;
        right: 12px;
        width: 32px;
        height: 32px;
        border: none;
        border-radius: 50%;
        background: #0f3460;
        color: #e6e6e6;
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
      }
      #tts-reader-overlay-close:hover {
        background: #e94560;
      }
      #tts-reader-overlay-title {
        margin: 0 0 20px;
        font-size: 1.6em;
        line-height: 1.3;
      }
      #tts-reader-overlay-content img {
        max-width: 100%;
        height: auto;
      }
      #tts-reader-overlay-content a {
        color: #e94560;
      }
      #tts-reader-overlay-content pre {
        white-space: pre-wrap;
        overflow-x: auto;
      }
    `;
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

  /**
   * Try to extract just the article content of the page via the
   * vendored Readability library, run against a clone (Readability
   * mutates whatever document it's given, so the live page must never
   * be passed directly). Returns null if the library isn't available,
   * extraction fails, or the result looks too thin to be a real
   * article (e.g. a listing/homepage rather than a single article).
   */
  function tryExtractReadableArticle() {
    if (typeof Readability === 'undefined') return null;
    try {
      const clone = document.cloneNode(true);
      const result = new Readability(clone, { charThreshold: MIN_READABLE_LENGTH }).parse();
      if (!result || !result.content) return null;
      if ((result.textContent || '').trim().length < MIN_READABLE_LENGTH) return null;
      return { title: result.title || '', contentHTML: result.content };
    } catch (e) {
      console.error('[TTS Reader] Readability extraction failed:', e);
      return null;
    }
  }

  /**
   * Parse Readability's output HTML in a detached document and strip
   * anything that shouldn't run/load when inserted into the real page
   * (script/style/iframe/etc. tags, inline event handlers, javascript:
   * URLs). Readability already does its own cleaning as part of
   * extraction, but this is cheap, defensive, belt-and-suspenders
   * safety before the result is grafted into the live DOM.
   * @returns {HTMLBodyElement} a body element (in a detached document)
   *   containing only the sanitized content, ready to import.
   */
  function sanitizeArticleFragment(htmlString) {
    const doc = new DOMParser().parseFromString(htmlString, 'text/html');
    doc.querySelectorAll('script, style, iframe, object, embed, link, meta, form, base').forEach((el) => el.remove());
    doc.querySelectorAll('*').forEach((el) => {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
        } else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) {
          el.removeAttribute(attr.name);
        }
      }
    });
    return doc.body;
  }

  /**
   * Render an extracted article into a distraction-free overlay
   * injected into the live page, so it has real, live DOM the rest of
   * this file can build sentence Ranges into. Only one overlay exists
   * at a time. Returns the content container to read from.
   */
  function buildReaderOverlay(article) {
    removeReaderOverlay();

    const backdrop = document.createElement('div');
    backdrop.id = 'tts-reader-overlay-backdrop';

    const panel = document.createElement('div');
    panel.id = 'tts-reader-overlay';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');

    const closeBtn = document.createElement('button');
    closeBtn.id = 'tts-reader-overlay-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close reading view and stop');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'stopSession' });
    });
    panel.appendChild(closeBtn);

    if (article.title) {
      const titleEl = document.createElement('h1');
      titleEl.id = 'tts-reader-overlay-title';
      titleEl.textContent = article.title;
      panel.appendChild(titleEl);
    }

    const contentEl = document.createElement('div');
    contentEl.id = 'tts-reader-overlay-content';
    const cleanBody = sanitizeArticleFragment(article.contentHTML);
    const importedBody = document.importNode(cleanBody, true);
    while (importedBody.firstChild) {
      contentEl.appendChild(importedBody.firstChild);
    }
    panel.appendChild(contentEl);

    backdrop.appendChild(panel);
    document.documentElement.appendChild(backdrop);
    readerOverlayEl = backdrop;

    return contentEl;
  }

  function removeReaderOverlay() {
    if (readerOverlayEl && readerOverlayEl.isConnected) {
      readerOverlayEl.remove();
    }
    readerOverlayEl = null;
  }

  function getSourceRange(mode) {
    if (mode === 'selection') {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        return selection.getRangeAt(0).cloneRange();
      }
    }

    // No selection (or explicit whole-page mode): try to read just the
    // article, rendered into our own overlay so it has live DOM.
    const article = tryExtractReadableArticle();
    if (article) {
      const contentRoot = buildReaderOverlay(article);
      const range = document.createRange();
      range.selectNodeContents(contentRoot);
      return range;
    }

    // Extraction unavailable/failed: fall back to the whole page body.
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
    // Unconditional (not left to getSourceRange's Readability branch):
    // a stale overlay from a previous whole-page session must not
    // linger if this new session ends up reading a plain selection.
    removeReaderOverlay();
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
          // Sent on real session end (stop/complete/error), unlike the
          // clearHighlight() call inside highlightSentence() which just
          // swaps the highlight between sentences mid-session — so this
          // is the right place to also tear down the reading overlay.
          removeReaderOverlay();
        }
        return false;
      }
    }
    return false;
  });

  window.addEventListener('beforeunload', () => {
    clearHighlight();
    removeReaderOverlay();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && readerOverlayEl) {
      chrome.runtime.sendMessage({ type: 'stopSession' });
    }
  });
  injectStyle();
})();
