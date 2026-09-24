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

function newSession(tabId, settings, isRecording) {
  return {
    tabId,
    settings,
    isRecording,
    sentences: [],
    contentSessionId: null,
    currentIndex: -1,
    prefetch: null, // { index, promise } | { index, result: {arrayBuffer, mimeType} }
    abortControllers: new Map(), // index -> AbortController
    recordedChunks: [], // in order, for recordAudio
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
    startReadingFromTab(tab.id);
  }
});

// contentScript.js's prepareSession() already falls back to the whole
// page when there's no active selection, so 'selection' mode covers
// both "text selected" and "nothing selected -> read the page" cases.
async function startReadingFromTab(tabId) {
  try {
    const settings = await chrome.storage.local.get({
      serverUrl: 'http://localhost:8000/v1/audio/speech',
      voice: 'af_bella',
      speed: 1.0,
      recordAudio: false,
      preprocessText: true
    });
    await beginSession(tabId, settings, settings.recordAudio, 'selection');
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
      chrome.runtime.sendMessage({
        type: 'playerStateUpdate',
        state: message.state
      });
      return true;

    case 'audioReady':
      if (currentPlayerState === 'loading' || currentPlayerState === 'starting') {
        currentPlayerState = 'ready';
        chrome.runtime.sendMessage({
          type: 'playerStateUpdate',
          state: 'ready'
        });
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
      chrome.runtime.sendMessage({
        type: 'getTimeInfo'
      }).then((response) => {
        sendResponse(response);
      });
      return true;

    case 'timeUpdate':
      chrome.runtime.sendMessage(message);
      return true;
  }
});

function handleControlAudio(action) {
  if (action === 'pause') {
    chrome.runtime.sendMessage({ type: 'pause' });
  } else if (action === 'play') {
    chrome.runtime.sendMessage({ type: 'play' });
  } else if (action === 'stop') {
    stopSession('user');
  }
}

// --- Session lifecycle ---------------------------------------------------

async function beginSession(tabId, settings, isRecording, mode) {
  // Any previous session is replaced.
  stopSession('replaced');

  if (!tabId) {
    broadcastError('No active tab to read from.');
    return;
  }

  const s = newSession(tabId, settings, isRecording);
  session = s;

  setPlayerState('loading');

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['sentenceSplitter.js', 'contentScript.js']
    });

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
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

  s.currentIndex = index;
  if (s.isRecording) {
    s.recordedChunks.push(audioResult);
  }

  chrome.runtime.sendMessage({
    type: 'playChunk',
    audioData: Array.from(new Uint8Array(audioResult.arrayBuffer)),
    mimeType: audioResult.mimeType,
    index
  });

  chrome.runtime.sendMessage({
    type: 'sentenceProgress',
    index,
    total: s.sentences.length
  });

  notifyHighlight(s, index);

  // Start prefetching the next chunk while this one plays.
  const nextIndex = index + 1;
  if (nextIndex < s.sentences.length) {
    const promise = fetchChunkAudio(s, nextIndex);
    s.prefetch = { index: nextIndex, promise };
    promise.catch(() => {}); // handled when it's actually consumed
  }
}

async function handleChunkEnded(endedIndex) {
  const s = session;
  if (!s || s.stopped || endedIndex !== s.currentIndex) return;
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
  }).catch(() => {}); // tab may have navigated away; ignore
}

function clearPageHighlight(s) {
  if (!s || s.tabId == null) return;
  chrome.tabs.sendMessage(s.tabId, {
    type: 'ttsClearHighlight',
    sessionId: s.contentSessionId
  }).catch(() => {});
}

function finishSession(s) {
  if (!isActive(s)) return;
  s.stopped = true;
  clearPageHighlight(s);
  finalizeRecording(s);
  clearKeepAliveIfIdle();
  setPlayerState('stopped');
}

function stopSession(_reason) {
  const s = session;
  if (!s) return;
  s.stopped = true;
  for (const controller of s.abortControllers.values()) {
    controller.abort();
  }
  s.abortControllers.clear();
  s.prefetch = null;
  chrome.runtime.sendMessage({ type: 'stop' });
  clearPageHighlight(s);
  finalizeRecording(s);
  clearKeepAliveIfIdle();
  if (session === s) {
    currentPlayerState = 'stopped';
    chrome.runtime.sendMessage({ type: 'playerStateUpdate', state: 'stopped' });
  }
}

function finalizeRecording(s) {
  if (!s.isRecording || s.recordedChunks.length === 0) return;
  try {
    const mimeType = s.recordedChunks[0].mimeType || 'audio/mpeg';
    const buffers = s.recordedChunks.map((c) => c.arrayBuffer);
    const blob = new Blob(buffers, { type: mimeType });
    const audioUrl = URL.createObjectURL(blob);
    chrome.runtime.sendMessage({ type: 'recordingComplete', audioUrl });
  } catch (e) {
    console.error('Error assembling recorded audio:', e);
  }
}

function setPlayerState(state) {
  currentPlayerState = state;
  chrome.runtime.sendMessage({ type: 'playerStateUpdate', state });
}

function broadcastError(message) {
  chrome.runtime.sendMessage({ type: 'streamError', error: message });
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
