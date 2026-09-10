importScripts('textProcessor.js');

let currentPlayerState = 'stopped';
let creating = null; // A global promise to avoid concurrency issues

// --- Active reading session state -------------------------------------
// A "session" covers one Play press through to Stop/completion/error.
// Only one session is active at a time.
let session = null;

const FIRST_CHUNK_TIMEOUT_MS = 55000; // cold-start: backend may take ~30s to wake up
const SUBSEQUENT_CHUNK_TIMEOUT_MS = 18000; // warm backend: ~1-2s typical
const KEEPALIVE_ALARM_NAME = 'tts-reader-keepalive';
const MIN_READABLE_FRAME_LENGTH = 200;
const FRAME_PREFERENCE_MARGIN = 200;

function newSession(tabId, frameId, settings, isRecording) {
  return {
    tabId,
    frameId,
    settings,
    isRecording,
    sentences: [],
    contentSessionId: null,
    currentIndex: -1,
    prefetch: null, // { index, promise } | { index, result: {arrayBuffer, mimeType} }
    abortControllers: new Map(), // index -> AbortController
    recordedChunks: [], // in order, for recordAudio
    chunkWatchdogTimer: null,
    stopped: false
  };
}

function isActive(s) {
  return session === s && !s.stopped;
}

async function setupOffscreenDocument() {
  const path = './offscreen.html';
  const offscreenUrl = chrome.runtime.getURL(path);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });

  if (existingContexts.length > 0) {
    return;
  }

  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: path,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Playing TTS audio in the background'
    });
    await creating;
    creating = null;
  }
}

// Set up context menu items
function setupContextMenu() {
  chrome.contextMenus.create({
    id: "readAloud",
    title: "Read Aloud",
    contexts: ["selection", "page"]
  });
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "readAloud") {
    // info.frameId is populated by Chrome itself (browser-level, not
    // page JS), so it correctly identifies the frame the user actually
    // right-clicked/selected in — including inside a cross-origin
    // iframe, which our own in-page window.getSelection() check could
    // never see (each frame has its own separate selection state).
    startReadingFromTab(tab.id, info.frameId);
  }
});

// contentScript.js's prepareSession() already falls back to the whole
// page when there's no active selection, so 'selection' mode covers
// both "text selected" and "nothing selected -> read the page" cases.
async function startReadingFromTab(tabId, frameId) {
  try {
    const settings = await chrome.storage.local.get({
      serverUrl: 'http://localhost:8000/v1/audio/speech',
      voice: 'af_bella',
      speed: 1.0,
      recordAudio: false,
      preprocessText: true
    });
    await beginSession(tabId, settings, settings.recordAudio, 'selection', frameId);
  } catch (error) {
    console.error('Error starting reading from tab:', error);
    broadcastError(error.message);
  }
}

// Handle messages from popup or offscreen document
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'setupOffscreen':
      setupOffscreenDocument().then(() => sendResponse({ success: true }));
      return true;

    case 'startStreaming': {
      (async () => {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id ?? null;
        await beginSession(tabId, message.settings, message.record, message.mode || 'selection');
        sendResponse({ success: true });
      })();
      return true;
    }

    case 'controlAudio':
      handleControlAudio(message.action);
      return true;

    case 'stopSession':
      stopSession('user');
      sendResponse({ success: true });
      return true;

    case 'stateUpdate':
      currentPlayerState = message.state;
      broadcast({ type: 'playerStateUpdate', state: message.state });
      return true;

    case 'audioReady':
      if (currentPlayerState === 'loading' || currentPlayerState === 'starting') {
        currentPlayerState = 'ready';
        broadcast({ type: 'playerStateUpdate', state: 'ready' });
      }
      return true;

    case 'chunkEnded':
      handleChunkEnded(message.index).catch((error) => {
        console.error('Error handling chunk end:', error);
        broadcastError(error.message);
        stopSession('error');
      });
      return true;

    case 'getPlayerState':
      sendResponse({ state: currentPlayerState });
      return true;

    case 'seek':
      chrome.runtime.sendMessage({
        type: 'seek',
        time: message.time
      }, (response) => {
        sendResponse(response);
      });
      return true;

    case 'getTimeInfo':
      chrome.runtime.sendMessage({ type: 'getTimeInfo' })
        .then((response) => sendResponse(response))
        .catch(() => sendResponse(null)); // offscreen doc not up yet
      return true;

    case 'timeUpdate':
      broadcast(message);
      return true;
  }
});

// Fire-and-forget broadcast to other extension contexts (popup,
// offscreen document). If nothing is listening right now (e.g. the
// popup is closed) the promise rejects with "Could not establish
// connection" — expected and harmless, but must be caught or Chrome
// logs it as an uncaught error against the extension.
function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

function handleControlAudio(action) {
  if (action === 'pause') {
    broadcast({ type: 'pause' });
  } else if (action === 'play') {
    broadcast({ type: 'play' });
  } else if (action === 'stop') {
    stopSession('user');
  }
}

// --- Session lifecycle ---------------------------------------------------

async function beginSession(tabId, settings, isRecording, mode, frameId) {
  // Any previous session is replaced.
  stopSession('replaced');

  if (!tabId) {
    broadcastError('No active tab to read from.');
    return;
  }

  setPlayerState('loading');

  // The popup's Play button has no frame context (unlike the context
  // menu, which gives us info.frameId directly) — probe every frame in
  // the tab for one with an active selection, or failing that, whoever
  // has substantially more text than the main frame (e.g. a page like
  // wikiroulette.co that embeds the actual article in a same/cross-
  // origin iframe and leaves only nav chrome in the main frame).
  const resolvedFrameId = frameId != null ? frameId : await pickBestFrame(tabId, mode);

  const s = newSession(tabId, resolvedFrameId, settings, isRecording);
  session = s;

  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [resolvedFrameId] },
      files: ['vendor/readability.js', 'sentenceSplitter.js', 'contentScript.js']
    });

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [resolvedFrameId] },
      func: (mode) => window.__ttsPrepareSession(mode),
      args: [mode]
    });

    if (!isActive(s)) return;

    const sentences = (result && result.sentences) || [];
    if (sentences.length === 0) {
      broadcastError('No readable text found.');
      stopSession('empty');
      return;
    }

    s.sentences = sentences;
    s.contentSessionId = result.sessionId;

    await setupOffscreenDocument();
    if (!isActive(s)) return;

    ensureKeepAlive();
    await playFromIndex(s, 0);
  } catch (error) {
    console.error('Error beginning session:', error);
    if (isActive(s)) {
      broadcastError(error.message);
      stopSession('error');
    }
  }
}

/**
 * Pick which frame in the tab to read from. A lightweight, standalone
 * probe (no dependency on our other injected files) run in every frame
 * via allFrames — cross-origin frames are reachable too, since the
 * manifest's host_permissions already cover all http/https origins.
 *
 * - If reading a selection, prefer whichever frame actually has one.
 * - Otherwise prefer the frame with substantially more text than the
 *   main frame, so a page that embeds its real content in an iframe
 *   (leaving only nav chrome in the main frame) still reads correctly.
 *   The margin avoids being fooled by a modest ad/tracker iframe.
 * - Falls back to the main frame (0) if probing fails entirely, or if
 *   nothing clearly beats it.
 */
async function pickBestFrame(tabId, mode) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const sel = window.getSelection();
        const hasSelection = !!(sel && sel.rangeCount > 0 && !sel.isCollapsed && sel.toString().trim());
        const textLength = document.body ? document.body.innerText.trim().length : 0;
        return { hasSelection, textLength };
      }
    });

    if (mode === 'selection') {
      const withSelection = results.find((r) => r.result && r.result.hasSelection);
      if (withSelection) return withSelection.frameId;
    }

    const mainFrame = results.find((r) => r.frameId === 0);
    const mainLength = mainFrame?.result?.textLength || 0;
    let best = mainFrame || results[0];
    let bestLength = mainLength;
    for (const r of results) {
      const len = r.result?.textLength || 0;
      if (r.frameId !== 0 && len >= MIN_READABLE_FRAME_LENGTH && len > mainLength + FRAME_PREFERENCE_MARGIN && len > bestLength) {
        best = r;
        bestLength = len;
      }
    }
    return best ? best.frameId : 0;
  } catch (error) {
    console.error('Error probing frames:', error);
    return 0;
  }
}

async function playFromIndex(s, index) {
  if (!isActive(s) || index >= s.sentences.length) {
    finishSession(s);
    return;
  }

  setPlayerState(index === 0 ? 'starting' : 'loading');

  let audioResult;
  try {
    if (s.prefetch && s.prefetch.index === index) {
      audioResult = await s.prefetch.promise;
      s.prefetch = null;
    } else {
      audioResult = await fetchChunkAudio(s, index);
    }
  } catch (error) {
    if (!isActive(s)) return;
    console.error(`Error fetching chunk ${index}:`, error);
    broadcastError(error.message || 'Failed to reach the TTS server.');
    stopSession('error');
    return;
  }

  if (!isActive(s)) return;

  // Re-verify (cheap no-op if it already exists) rather than trusting
  // the one-time setup at session start — guards against the offscreen
  // document having been silently torn down mid-session, which would
  // otherwise leave every future playChunk broadcast with no listener.
  await setupOffscreenDocument();
  if (!isActive(s)) return;

  s.currentIndex = index;
  if (s.isRecording) {
    s.recordedChunks.push(audioResult);
  }

  broadcast({
    type: 'playChunk',
    audioData: Array.from(new Uint8Array(audioResult.arrayBuffer)),
    mimeType: audioResult.mimeType,
    index
  });

  broadcast({
    type: 'sentenceProgress',
    index,
    total: s.sentences.length
  });

  notifyHighlight(s, index);
  armChunkWatchdog(s, index);

  // Start prefetching the next chunk while this one plays.
  const nextIndex = index + 1;
  if (nextIndex < s.sentences.length) {
    const promise = fetchChunkAudio(s, nextIndex);
    s.prefetch = { index: nextIndex, promise };
    promise.catch(() => {}); // handled when it's actually consumed
  }
}

// Chrome's tab-audio pipeline has occasionally been observed (verified
// live, testing long infobox/reference-heavy pages) to silently stop
// advancing after many dozens of rapid, very short chunks in a row: the
// offscreen document acks 'audioReady' but neither onplay nor onended
// ever fires afterward, and background.js has no signal that anything
// went wrong — the session just sits there forever. Rather than leave
// the whole read hung on one bad chunk, force-advance if a chunk we
// believe is playing hasn't reported ended within a generous window.
const CHUNK_WATCHDOG_MS = 20000;

function armChunkWatchdog(s, index) {
  clearChunkWatchdog(s);
  s.chunkWatchdogTimer = setTimeout(() => {
    if (!isActive(s) || s.currentIndex !== index) return;
    console.warn(`[TTS Reader] Chunk ${index} never reported ended after ${CHUNK_WATCHDOG_MS}ms; advancing anyway.`);
    playFromIndex(s, index + 1);
  }, CHUNK_WATCHDOG_MS);
}

function clearChunkWatchdog(s) {
  if (s.chunkWatchdogTimer) {
    clearTimeout(s.chunkWatchdogTimer);
    s.chunkWatchdogTimer = null;
  }
}

async function handleChunkEnded(endedIndex) {
  const s = session;
  if (!s || s.stopped || endedIndex !== s.currentIndex) return;
  clearChunkWatchdog(s);
  await playFromIndex(s, endedIndex + 1);
}

async function fetchChunkAudio(s, index, attempt = 1) {
  const isFirst = index === 0;
  const timeoutMs = isFirst ? FIRST_CHUNK_TIMEOUT_MS : SUBSEQUENT_CHUNK_TIMEOUT_MS;
  const controller = new AbortController();
  s.abortControllers.set(index, controller);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(s.settings.serverUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg, audio/wav, audio/*'
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: s.settings.voice,
        input: preprocessSentence(s.sentences[index], s.settings),
        speed: Number.parseFloat(s.settings.speed)
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const audioBlob = await response.blob();
    const mimeType = audioBlob.type || 'audio/mpeg';
    const arrayBuffer = await audioBlob.arrayBuffer();
    return { arrayBuffer, mimeType };
  } catch (error) {
    const wasAborted = error.name === 'AbortError';
    if (wasAborted && attempt < 2 && isActive(s)) {
      // One retry on timeout before surfacing an error.
      return fetchChunkAudio(s, index, attempt + 1);
    }
    if (wasAborted) {
      throw new Error('The TTS server took too long to respond.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    // On a timeout retry, a newer controller may already have replaced
    // this one under the same `index` key by the time this `finally`
    // runs (the recursive retry call starts synchronously before this
    // block executes) — only delete our own entry, never a newer one.
    if (s.abortControllers.get(index) === controller) {
      s.abortControllers.delete(index);
    }
  }
}

function preprocessSentence(text, settings) {
  if (settings.preprocessText && typeof TextProcessor !== 'undefined') {
    try {
      return TextProcessor.process(text);
    } catch (e) {
      console.error('Error preprocessing sentence:', e);
    }
  }
  return text;
}

function notifyHighlight(s, index) {
  if (s.tabId == null || s.contentSessionId == null) return;
  chrome.tabs.sendMessage(s.tabId, {
    type: 'ttsHighlightSentence',
    sessionId: s.contentSessionId,
    index
  }, { frameId: s.frameId }).catch(() => {}); // tab/frame may have navigated away; ignore
}

function clearPageHighlight(s) {
  if (!s || s.tabId == null) return;
  chrome.tabs.sendMessage(s.tabId, {
    type: 'ttsClearHighlight',
    sessionId: s.contentSessionId
  }, { frameId: s.frameId }).catch(() => {});
}

function finishSession(s) {
  if (!isActive(s)) return;
  s.stopped = true;
  clearChunkWatchdog(s);
  clearPageHighlight(s);
  finalizeRecording(s);
  clearKeepAliveIfIdle();
  setPlayerState('stopped');
}

function stopSession(_reason) {
  const s = session;
  if (!s) return;
  s.stopped = true;
  clearChunkWatchdog(s);
  for (const controller of s.abortControllers.values()) {
    controller.abort();
  }
  s.abortControllers.clear();
  s.prefetch = null;
  broadcast({ type: 'stop' });
  clearPageHighlight(s);
  finalizeRecording(s);
  clearKeepAliveIfIdle();
  if (session === s) {
    currentPlayerState = 'stopped';
    broadcast({ type: 'playerStateUpdate', state: 'stopped' });
  }
}

function finalizeRecording(s) {
  if (!s.isRecording || s.recordedChunks.length === 0) return;
  try {
    const mimeType = s.recordedChunks[0].mimeType || 'audio/mpeg';
    const buffers = s.recordedChunks.map((c) => c.arrayBuffer);
    const blob = new Blob(buffers, { type: mimeType });
    const audioUrl = URL.createObjectURL(blob);
    broadcast({ type: 'recordingComplete', audioUrl });
  } catch (e) {
    console.error('Error assembling recorded audio:', e);
  }
}

function setPlayerState(state) {
  currentPlayerState = state;
  broadcast({ type: 'playerStateUpdate', state });
}

function broadcastError(message) {
  broadcast({ type: 'streamError', error: message });
}

// --- Keep-alive heartbeat -------------------------------------------------
// MV3 service workers can be terminated by Chrome after ~30s of perceived
// inactivity; a raw fetch() awaiting a slow (cold-start) backend isn't
// always treated as "activity". A periodic alarm wakes the worker and
// performs a trivial extension-API call, which resets that idle clock.

function ensureKeepAlive() {
  chrome.alarms.get(KEEPALIVE_ALARM_NAME, (existing) => {
    if (!existing) {
      chrome.alarms.create(KEEPALIVE_ALARM_NAME, { periodInMinutes: 0.5 });
    }
  });
}

function clearKeepAliveIfIdle() {
  if (!session || session.stopped) {
    chrome.alarms.clear(KEEPALIVE_ALARM_NAME);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== KEEPALIVE_ALARM_NAME) return;
  if (!session || session.stopped) {
    chrome.alarms.clear(KEEPALIVE_ALARM_NAME);
    return;
  }
  // Any extension-API call is enough to register activity and keep the
  // worker warm through a long in-flight fetch.
  chrome.storage.local.get('__ttsKeepAlivePing', () => {});
});

// Initialize context menu when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  setupContextMenu();
});
