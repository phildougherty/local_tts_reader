let audioContext = null;
let audioElement = null;
let isPlaying = false;
let audioSource = null;
let hasSourceConnected = false;

// Initialize the audio context
function initAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  if (!audioElement) {
    audioElement = document.getElementById('audioElement');
    if (!audioElement) {
      audioElement = document.createElement('audio');
      audioElement.id = 'audioElement';
      audioElement.controls = true; // For debugging
      document.body.appendChild(audioElement);
    }
  }
}

// Process audio data received from background script
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
      });
    }
    
    // Play the audio
    playAudioUrl(audioUrl);
    
    // Notify that audio is ready to play
    chrome.runtime.sendMessage({ type: 'audioReady' });
  } catch (error) {
    console.error('Error processing audio data:', error);
    chrome.runtime.sendMessage({ 
      type: 'streamError', 
      error: error.message 
    });
  }
}

// Play audio from URL
function playAudioUrl(audioUrl) {
  try {
    console.log('Playing audio URL:', audioUrl);
    
    // Reset connection flag
    hasSourceConnected = false;
    
    // Set up audio element
    audioElement.src = audioUrl;
    
    // Set up event listeners
    audioElement.onplay = () => {
      isPlaying = true;
      
      // Connect to audio context only once
      if (!hasSourceConnected) {
        audioSource = audioContext.createMediaElementSource(audioElement);
        audioSource.connect(audioContext.destination);
        hasSourceConnected = true;
      }
      
      chrome.runtime.sendMessage({ type: 'stateUpdate', state: 'playing' });
    };
    
    audioElement.onpause = () => {
      isPlaying = false;
      chrome.runtime.sendMessage({ type: 'stateUpdate', state: 'paused' });
    };
    
    audioElement.onended = () => {
      isPlaying = false;
      chrome.runtime.sendMessage({ type: 'stateUpdate', state: 'stopped' });
      chrome.runtime.sendMessage({ type: 'streamComplete' });
    };
    
    // Add timeupdate event for seeking
    audioElement.ontimeupdate = () => {
      chrome.runtime.sendMessage({ 
        type: 'timeUpdate', 
        timeInfo: {
          currentTime: audioElement.currentTime,
          duration: audioElement.duration
        }
      });
    };
    
    // Start playing
    audioElement.play().catch(err => {
      console.error('Play error:', err);
      chrome.runtime.sendMessage({ 
        type: 'streamError', 
        error: err.message 
      });
    });
  } catch (error) {
    console.error('Error playing audio URL:', error);
    chrome.runtime.sendMessage({ 
      type: 'streamError', 
      error: error.message 
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
  console.log('Offscreen received message:', message.type);
  
  switch (message.type) {
    case 'processAudioData':
      if (message.audioData) {
        processAudioData(message.audioData, message.mimeType, message.isRecording);
      }
      break;
      
    case 'play':
      if (audioElement) {
        audioElement.play();
      }
      break;
      
    case 'pause':
      if (audioElement) {
        audioElement.pause();
      }
      break;
      
    case 'stop':
      if (audioElement) {
        audioElement.pause();
        audioElement.currentTime = 0;
        chrome.runtime.sendMessage({ type: 'stateUpdate', state: 'stopped' });
      }
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
  console.log('Offscreen document loaded');
  
  // Create audio element
  audioElement = document.createElement('audio');
  audioElement.id = 'audioElement';
  audioElement.controls = true; // For debugging
  document.body.appendChild(audioElement);
  
  // Initialize audio context
  initAudio();
  
  console.log('Offscreen document initialized');
});
