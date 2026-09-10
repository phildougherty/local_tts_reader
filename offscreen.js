const audioElement = document.getElementById('audioElement');
let currentChunkIndex = null;
let previousObjectUrl = null;

// Play one prefetched sentence chunk. background.js is responsible for
// ordering/prefetching; this just plays whatever it's told to, in order.
function playChunk(audioDataArray, mimeType, index) {
  try {
    const uint8Array = new Uint8Array(audioDataArray);
    const blob = new Blob([uint8Array], { type: mimeType });
    const audioUrl = URL.createObjectURL(blob);

    if (previousObjectUrl) {
      URL.revokeObjectURL(previousObjectUrl);
    }
    previousObjectUrl = audioUrl;
    currentChunkIndex = index;

    audioElement.src = audioUrl;
    audioElement.play().catch((err) => {
      console.error('Play error:', err);
      chrome.runtime.sendMessage({ type: 'streamError', error: err.message });
    });

    chrome.runtime.sendMessage({ type: 'audioReady' });
  } catch (error) {
    console.error('Error processing audio chunk:', error);
    chrome.runtime.sendMessage({ type: 'streamError', error: error.message });
  }
}

// Get current time and duration
function getTimeInfo() {
  return {
    currentTime: audioElement.currentTime,
    duration: audioElement.duration
  };
}

// Seek to a specific time (within the currently playing chunk)
function seekTo(time) {
  audioElement.currentTime = time;
}

// Handle messages from the background script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'playChunk':
      if (message.audioData) {
        playChunk(message.audioData, message.mimeType, message.index);
      }
      break;

    case 'play':
      audioElement.play();
      break;

    case 'pause':
      audioElement.pause();
      break;

    case 'stop':
      currentChunkIndex = null;
      audioElement.pause();
      audioElement.currentTime = 0;
      audioElement.removeAttribute('src');
      audioElement.load();
      if (previousObjectUrl) {
        URL.revokeObjectURL(previousObjectUrl);
        previousObjectUrl = null;
      }
      chrome.runtime.sendMessage({ type: 'stateUpdate', state: 'stopped' });
      break;

    case 'seek': {
      seekTo(message.time);
      return true;
    }
    case 'getTimeInfo':
      sendResponse({ timeInfo: getTimeInfo() });
      return true;
  }
});

// Initialize audio event handlers
audioElement.onplay = () => {
  chrome.runtime.sendMessage({ type: 'stateUpdate', state: 'playing' });
};

audioElement.onpause = () => {
  // Swapping `src` between chunks, or the explicit Stop handler above,
  // both leave currentTime at/near 0 without the user asking to pause —
  // only report a genuine user pause.
  if (!audioElement.ended && audioElement.currentTime > 0) {
    chrome.runtime.sendMessage({ type: 'stateUpdate', state: 'paused' });
  }
};

// A chunk finishing playback means "advance the queue", not "session
// over" — background.js decides whether there's a next chunk to play.
audioElement.onended = () => {
  if (currentChunkIndex !== null) {
    chrome.runtime.sendMessage({ type: 'chunkEnded', index: currentChunkIndex });
  }
};

// Add timeupdate event for seeking
audioElement.ontimeupdate = () => {
  chrome.runtime.sendMessage({
    type: 'timeUpdate',
    timeInfo: {
      currentTime: audioElement?.currentTime ?? 0,
      duration: audioElement?.duration ?? 0
    }
  });
};
