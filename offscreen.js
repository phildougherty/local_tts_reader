let audioContext = null;
let audioElement = null;
let isPlaying = false;
let audioSource = null;
let hasSourceConnected = false;

// Audio chunk queue management
let audioQueue = [];
let currentSessionId = null;
let totalChunks = 0;
let chunksReceived = 0;
let isProcessingQueue = false;
let currentlyPlayingElement = null;

// Initialize the audio context
function initAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Audio element will be created fresh for each audio session
}

// Initialize audio queue for a new session
function initAudioQueue(sessionId, totalChunksCount) {
  currentSessionId = sessionId;
  totalChunks = totalChunksCount;
  chunksReceived = 0;
  audioQueue = [];
  isProcessingQueue = false;
  console.log(`🎵 Initialized audio queue for session ${sessionId} with ${totalChunks} chunks`);
}

// Add audio chunk to queue
function addAudioChunk(audioUrl, chunkIndex, sessionId) {
  if (sessionId !== currentSessionId) {
    console.log(`🚫 Ignoring chunk from old session ${sessionId}, current: ${currentSessionId}`);
    return;
  }
  
  audioQueue.push({
    url: audioUrl,
    index: chunkIndex,
    sessionId: sessionId,
    receivedTime: Date.now()
  });
  
  chunksReceived++;
  console.log(`📩 Added chunk ${chunkIndex} to queue (${chunksReceived}/${totalChunks}) - Queue length: ${audioQueue.length}`);
  
  // Start processing if this is the first chunk
  if (!isProcessingQueue && chunkIndex === 0) {
    console.log(`🎬 Starting audio queue processing with chunk 0`);
    processAudioQueue();
  }
}

// Process audio queue sequentially
async function processAudioQueue() {
  if (isProcessingQueue) return;
  
  isProcessingQueue = true;
  let currentChunkIndex = 0;
  
  while (currentSessionId) {
    // Find the next chunk in sequence
    const chunkIndex = audioQueue.findIndex(chunk => 
      chunk.sessionId === currentSessionId && 
      chunk.index === currentChunkIndex
    );
    
    if (chunkIndex === -1) {
      // Wait for the next sequential chunk
      if (currentChunkIndex < totalChunks) {
        console.log(`⏳ Waiting for chunk ${currentChunkIndex}... (Queue: [${audioQueue.map(c => c.index).join(', ')}])`);
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      } else {
        // All chunks processed
        break;
      }
    }
    
    const chunk = audioQueue.splice(chunkIndex, 1)[0];
    const waitTime = Date.now() - chunk.receivedTime;
    console.log(`🎵 Playing chunk ${chunk.index} (${chunk.index + 1}/${totalChunks}) - Waited ${waitTime}ms in queue`);
    
    try {
      const playStartTime = Date.now();
      await playAudioChunkSequentially(chunk.url, chunk.index);
      const playDuration = Date.now() - playStartTime;
      console.log(`✅ Chunk ${chunk.index} played successfully in ${playDuration}ms`);
      currentChunkIndex++;
    } catch (error) {
      console.error(`❌ Error playing chunk ${chunk.index}:`, error);
      currentChunkIndex++; // Skip failed chunk
    }
  }
  
  isProcessingQueue = false;
  console.log(`🏁 Audio queue processing complete - All ${totalChunks} chunks processed`);
  
  // Send completion message
  chrome.runtime.sendMessage({ type: 'stateUpdate', state: 'stopped' }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'streamComplete' }).catch(() => {});
}

// Play audio chunk and wait for completion
function playAudioChunkSequentially(audioUrl, chunkIndex) {
  return new Promise((resolve, reject) => {
    try {
      // Stop any currently playing audio
      if (currentlyPlayingElement) {
        currentlyPlayingElement.pause();
        currentlyPlayingElement.remove();
        currentlyPlayingElement = null;
      }
      
      // Create a fresh audio element for this chunk
      const chunkAudioElement = document.createElement('audio');
      chunkAudioElement.src = audioUrl;
      chunkAudioElement.preload = 'auto';
      document.body.appendChild(chunkAudioElement);
      
      // Set as currently playing
      currentlyPlayingElement = chunkAudioElement;
      
      chunkAudioElement.onplay = () => {
        console.log(`🎵 Started playing chunk ${chunkIndex}`);
        if (chunkIndex === 0) {
          // First chunk starting - update state
          chrome.runtime.sendMessage({ type: 'stateUpdate', state: 'playing' }).catch(() => {});
        }
      };
      
      chunkAudioElement.onended = () => {
        console.log(`✅ Chunk ${chunkIndex} finished playing`);
        if (currentlyPlayingElement === chunkAudioElement) {
          currentlyPlayingElement = null;
        }
        chunkAudioElement.remove();
        URL.revokeObjectURL(audioUrl);
        resolve();
      };
      
      chunkAudioElement.onerror = (error) => {
        console.error(`❌ Error in chunk ${chunkIndex}:`, error);
        if (currentlyPlayingElement === chunkAudioElement) {
          currentlyPlayingElement = null;
        }
        chunkAudioElement.remove();
        URL.revokeObjectURL(audioUrl);
        reject(error);
      };
      
      // Start playing immediately
      chunkAudioElement.play().catch(err => {
        console.error(`❌ Play error for chunk ${chunkIndex}:`, err);
        reject(err);
      });
      
    } catch (error) {
      reject(error);
    }
  });
}

// Process audio chunk received from background script
function processAudioChunk(audioDataArray, mimeType, isRecording, chunkIndex, sessionId, totalChunks) {
  try {
    console.log(`📦 Received audio chunk ${chunkIndex} (${Math.round(audioDataArray.length / 1024)}KB, ${mimeType})`);
    
    initAudio();
    
    // Convert array back to Uint8Array
    const uint8Array = new Uint8Array(audioDataArray);
    
    // Create blob from the array
    const blob = new Blob([uint8Array], { type: mimeType });
    
    // Create URL for the blob
    const audioUrl = URL.createObjectURL(blob);
    
    console.log(`🎶 Created audio URL for chunk ${chunkIndex}: ${audioUrl.substring(0, 50)}...`);
    
    // If recording is enabled, send URL back for download (only for first chunk)
    if (isRecording && chunkIndex === 0) {
      console.log(`💾 Recording enabled - saving first chunk for download`);
      chrome.runtime.sendMessage({ 
        type: 'recordingComplete', 
        audioUrl: audioUrl
      }).catch(() => {
        // Ignore connection errors
      });
    }
    
    // Add to audio queue
    addAudioChunk(audioUrl, chunkIndex, sessionId);
    
    // Notify that first audio chunk is ready
    if (chunkIndex === 0) {
      console.log(`🎯 First chunk ready - notifying background script`);
      chrome.runtime.sendMessage({ type: 'audioReady' }).catch(() => {
        // Ignore connection errors
      });
    }
    
  } catch (error) {
    console.error(`❌ Error processing audio chunk ${chunkIndex}:`, error);
    chrome.runtime.sendMessage({ 
      type: 'streamError', 
      error: error.message 
    }).catch(() => {
      // Ignore connection errors
    });
  }
}

// Process audio data received from background script (legacy single chunk)
function processAudioData(audioDataArray, mimeType, isRecording) {
  try {
    initAudio();
    
    // Convert array back to Uint8Array
    const uint8Array = new Uint8Array(audioDataArray);
    
    // Create blob from the array
    const blob = new Blob([uint8Array], { type: mimeType });
    
    // Create URL for the blob
    const audioUrl = URL.createObjectURL(blob);
    
    // If recording is enabled, send URL back for download
    if (isRecording) {
      chrome.runtime.sendMessage({ 
        type: 'recordingComplete', 
        audioUrl: audioUrl
      }).catch(() => {
        // Ignore connection errors
      });
    }
    
    // Play the audio
    playAudioUrl(audioUrl);
    
    // Notify that audio is ready to play
    chrome.runtime.sendMessage({ type: 'audioReady' }).catch(() => {
      // Ignore connection errors
    });
  } catch (error) {
    console.error('Error processing audio data:', error);
    chrome.runtime.sendMessage({ 
      type: 'streamError', 
      error: error.message 
    }).catch(() => {
      // Ignore connection errors
    });
  }
}

// Play audio from URL
function playAudioUrl(audioUrl) {
  try {
    console.log('Playing audio URL:', audioUrl);
    
    // Stop current audio if playing
    if (audioElement && !audioElement.paused) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
    
    // Disconnect existing audio source if it exists
    if (audioSource) {
      try {
        audioSource.disconnect();
      } catch (e) {
        // Ignore errors if already disconnected
      }
      audioSource = null;
    }
    
    // Remove old audio element to avoid MediaElementSource reuse issues
    if (audioElement) {
      audioElement.remove();
    }
    
    // Create a fresh audio element for each new audio
    audioElement = document.createElement('audio');
    audioElement.id = 'audioElement';
    audioElement.controls = true; // For debugging
    document.body.appendChild(audioElement);
    
    // Reset connection flag
    hasSourceConnected = false;
    
    // Set up audio element
    audioElement.src = audioUrl;
    
    // Set up event listeners
    audioElement.onplay = () => {
      isPlaying = true;
      
      // Connect to audio context only once per audio element
      if (!hasSourceConnected) {
        try {
          // Create and connect new source
          audioSource = audioContext.createMediaElementSource(audioElement);
          audioSource.connect(audioContext.destination);
          hasSourceConnected = true;
        } catch (e) {
          console.error('Error connecting audio source:', e);
          // If this fails, it might be because the element already has a source
          // Try to continue without the web audio API
        }
      }
      
      chrome.runtime.sendMessage({ type: 'stateUpdate', state: 'playing' }).catch(() => {
        // Ignore connection errors
      });
    };
    
    audioElement.onpause = () => {
      isPlaying = false;
      chrome.runtime.sendMessage({ type: 'stateUpdate', state: 'paused' }).catch(() => {
        // Ignore connection errors
      });
    };
    
    audioElement.onended = () => {
      isPlaying = false;
      chrome.runtime.sendMessage({ type: 'stateUpdate', state: 'stopped' }).catch(() => {
        // Ignore connection errors
      });
      chrome.runtime.sendMessage({ type: 'streamComplete' }).catch(() => {
        // Ignore connection errors
      });
    };
    
    // Add timeupdate event for seeking
    audioElement.ontimeupdate = () => {
      chrome.runtime.sendMessage({ 
        type: 'timeUpdate', 
        timeInfo: {
          currentTime: audioElement.currentTime,
          duration: audioElement.duration
        }
      }).catch(() => {
        // Ignore connection errors
      });
    };
    
    // Start playing
    audioElement.play().catch(err => {
      console.error('Play error:', err);
      chrome.runtime.sendMessage({ 
        type: 'streamError', 
        error: err.message 
      }).catch(() => {
        // Ignore connection errors
      });
    });
  } catch (error) {
    console.error('Error playing audio URL:', error);
    chrome.runtime.sendMessage({ 
      type: 'streamError', 
      error: error.message 
    }).catch(() => {
      // Ignore connection errors
    });
  }
}

// Get current player state
function getPlayerState() {
  if (!audioElement) return 'stopped';
  if (audioElement.paused) {
    return audioElement.currentTime > 0 && audioElement.currentTime < audioElement.duration ? 'paused' : 'stopped';
  }
  return 'playing';
}

// Get current time and duration
function getTimeInfo() {
  if (!audioElement) return null;
  return {
    currentTime: audioElement.currentTime,
    duration: audioElement.duration
  };
}

// Seek to a specific time
function seekTo(time) {
  if (!audioElement) return false;
  try {
    audioElement.currentTime = time;
    return true;
  } catch (error) {
    console.error('Error seeking:', error);
    return false;
  }
}

// Handle messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📥 Offscreen received message:', message.type, message.chunkIndex !== undefined ? `(chunk ${message.chunkIndex})` : '');
  
  switch (message.type) {
    case 'initAudioQueue':
      initAudioQueue(message.sessionId, message.totalChunks);
      break;
      
    case 'processAudioChunk':
      if (message.audioData) {
        processAudioChunk(
          message.audioData, 
          message.mimeType, 
          message.isRecording,
          message.chunkIndex,
          message.sessionId,
          message.totalChunks
        );
      }
      break;
      
    case 'processAudioData':
      if (message.audioData) {
        processAudioData(message.audioData, message.mimeType, message.isRecording);
      }
      break;
      
    case 'play':
      if (currentlyPlayingElement) {
        currentlyPlayingElement.play();
      } else if (audioElement) {
        audioElement.play();
      }
      break;
      
    case 'pause':
      if (currentlyPlayingElement) {
        currentlyPlayingElement.pause();
      } else if (audioElement) {
        audioElement.pause();
      }
      break;
      
    case 'stop':
      if (audioElement) {
        audioElement.pause();
        audioElement.currentTime = 0;
        chrome.runtime.sendMessage({ type: 'stateUpdate', state: 'stopped' }).catch(() => {
          // Ignore connection errors
        });
      }
      break;
      
    case 'stopAllAudio':
      // Stop current audio and clear queue
      if (audioElement) {
        audioElement.pause();
        audioElement.currentTime = 0;
      }
      // Stop currently playing chunk
      if (currentlyPlayingElement) {
        currentlyPlayingElement.pause();
        currentlyPlayingElement.remove();
        currentlyPlayingElement = null;
      }
      // Clear audio queue
      audioQueue = [];
      isProcessingQueue = false;
      currentSessionId = null;
      chunksReceived = 0;
      totalChunks = 0;
      // Remove any remaining audio elements
      document.querySelectorAll('audio').forEach(audio => audio.remove());
      console.log(`🛑 Stopped all audio and cleared queue`);
      chrome.runtime.sendMessage({ type: 'stateUpdate', state: 'stopped' }).catch(() => {
        // Ignore connection errors
      });
      break;
      
    case 'seek':
      const success = seekTo(message.time);
      sendResponse({ success });
      return true;
      
    case 'getState':
      sendResponse({ state: getPlayerState() });
      return true;
      
    case 'getTimeInfo':
      sendResponse({ timeInfo: getTimeInfo() });
      return true;
  }
});

// Initialize when the document loads
document.addEventListener('DOMContentLoaded', () => {
  console.log('🔧 Offscreen document loaded');
  
  // Initialize audio context only
  initAudio();
  
  console.log('✅ Offscreen document initialized and ready for messages');
  
  // Notify background script that offscreen is ready
  chrome.runtime.sendMessage({ type: 'offscreenReady' }).catch(() => {
    // Ignore connection errors - background might not be listening yet
  });
});