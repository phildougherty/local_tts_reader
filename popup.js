let audioPlayer = null;
let currentAudioUrl = null;

function updateSentenceProgress(info) {
  const el = document.getElementById('sentenceProgress');
  if (!el) return;
  if (!info || !info.total) {
    el.textContent = '';
    return;
  }
  el.textContent = `Sentence ${info.index + 1} of ${info.total}`;
}

function updateStatus(message, isError = false) {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `visible ${isError ? 'error' : 'success'}`;
  setTimeout(() => status.className = '', 3000);
}

function updateControlButtons(state) {
  const playBtn = document.getElementById('playBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const stopBtn = document.getElementById('stopBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const loadingIndicator = document.getElementById('loadingIndicator');
  const loadingLabel = document.getElementById('loadingLabel');
  const seekBar = document.getElementById('seekBar');

  // Hide loading indicator by default
  loadingIndicator.style.display = 'none';

  // Stop button is always enabled (except during loading/starting)
  stopBtn.disabled = state === 'loading' || state === 'starting';

  switch(state) {
    case 'starting':
      playBtn.disabled = true;
      pauseBtn.disabled = true;
      downloadBtn.disabled = true;
      seekBar.disabled = true;
      loadingLabel.textContent = 'Starting voice engine…';
      loadingIndicator.style.display = 'flex';
      break;
    case 'loading':
      playBtn.disabled = true;
      pauseBtn.disabled = true;
      downloadBtn.disabled = true;
      seekBar.disabled = true;
      loadingLabel.textContent = 'Loading…';
      loadingIndicator.style.display = 'flex';
      break;
    case 'ready':
      playBtn.disabled = false;
      pauseBtn.disabled = true;
      downloadBtn.disabled = !currentAudioUrl;
      seekBar.disabled = false;
      break;
    case 'playing':
      playBtn.disabled = true;
      pauseBtn.disabled = false;
      downloadBtn.disabled = !currentAudioUrl;
      seekBar.disabled = false;
      break;
    case 'paused':
      playBtn.disabled = false;
      pauseBtn.disabled = true;
      downloadBtn.disabled = !currentAudioUrl;
      seekBar.disabled = false;
      break;
    case 'stopped':
      playBtn.disabled = false;
      pauseBtn.disabled = true;
      downloadBtn.disabled = !currentAudioUrl;
      seekBar.disabled = true;
      // Reset seek bar to beginning
      seekBar.value = 0;
      document.getElementById('currentTime').textContent = '0:00';
      document.getElementById('duration').textContent = '0:00';
      break;
    default:
      playBtn.disabled = false;
      pauseBtn.disabled = true;
      downloadBtn.disabled = true;
      seekBar.disabled = true;
  }
}

function getSettings() {
  return {
    serverUrl: document.getElementById('serverUrl').value,
    voice: document.getElementById('voice').value,
    speed: document.getElementById('speed').value,
    recordAudio: document.getElementById('recordAudio').checked,
    preprocessText: document.getElementById('preprocessText').checked
  };
}

async function saveSettings() {
  const settings = getSettings();
  await chrome.storage.local.set(settings);
  updateStatus('Settings saved!', false);
}

// Format time in seconds to MM:SS format
function formatTime(seconds) {
  if (isNaN(seconds)) return '0:00';
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Sync player state when popup opens
async function syncPlayerState() {
  if (audioPlayer) {
    const state = await audioPlayer.getState();
    updateControlButtons(state);
    
    // Also sync the seek bar
    const timeInfo = await audioPlayer.getTimeInfo();
    if (timeInfo) {
      const seekBar = document.getElementById('seekBar');
      seekBar.max = timeInfo.duration;
      seekBar.value = timeInfo.currentTime;
      document.getElementById('currentTime').textContent = formatTime(timeInfo.currentTime);
      document.getElementById('duration').textContent = formatTime(timeInfo.duration);
    }
  }
}

// Update seek bar periodically
function startSeekBarUpdates() {
  const updateInterval = setInterval(async () => {
    if (!audioPlayer) return;
    
    const state = await audioPlayer.getState();
    if (state !== 'playing' && state !== 'paused') {
      clearInterval(updateInterval);
      return;
    }
    
    const timeInfo = await audioPlayer.getTimeInfo();
    if (timeInfo) {
      const seekBar = document.getElementById('seekBar');
      // Only update if user is not currently dragging
      if (!seekBar.classList.contains('seeking')) {
        seekBar.max = timeInfo.duration;
        seekBar.value = timeInfo.currentTime;
        document.getElementById('currentTime').textContent = formatTime(timeInfo.currentTime);
        document.getElementById('duration').textContent = formatTime(timeInfo.duration);
      }
    }
  }, 1000);
  
  return updateInterval;
}

document.addEventListener('DOMContentLoaded', async function() {
  // Initialize audio player
  audioPlayer = new AudioPlayer();
  await audioPlayer.init();
  
  // Load saved settings
  chrome.storage.local.get({
    serverUrl: DEFAULT_SETTINGS.serverUrl,
    voice: DEFAULT_SETTINGS.voice,
    speed: DEFAULT_SETTINGS.speed,
    recordAudio: DEFAULT_SETTINGS.recordAudio,
    preprocessText: DEFAULT_SETTINGS.preprocessText
  }, function(result) {
    document.getElementById('serverUrl').value = result.serverUrl;
    document.getElementById('voice').value = result.voice;
    document.getElementById('speed').value = result.speed;
    document.getElementById('recordAudio').checked = result.recordAudio;
    document.getElementById('preprocessText').checked = result.preprocessText;
    document.querySelector('.speed-value').textContent = `${result.speed}x`;
  });
  
  // Sync player state
  syncPlayerState();
  
  // Start seek bar updates
  let updateInterval = startSeekBarUpdates();
  
  // Set up seek bar events
  const seekBar = document.getElementById('seekBar');
  
  // When user starts seeking
  seekBar.addEventListener('mousedown', function() {
    seekBar.classList.add('seeking');
  });
  
  // When user is seeking
  seekBar.addEventListener('input', function() {
    document.getElementById('currentTime').textContent = formatTime(seekBar.value);
  });
  
  // When user finishes seeking
  seekBar.addEventListener('change', async function() {
    const newTime = parseFloat(seekBar.value);
    await audioPlayer.seek(newTime);
    seekBar.classList.remove('seeking');
  });
  
  // Speed slider
  document.getElementById('speed').addEventListener('input', function(e) {
    document.querySelector('.speed-value').textContent = `${e.target.value}x`;
  });
  
  // Play button
  document.getElementById('playBtn').addEventListener('click', async function() {
    try {
      const state = await audioPlayer.getState();
      
      if (state === 'paused' || state === 'ready') {
        audioPlayer.resume();
        updateControlButtons('playing');
        
        // Restart seek bar updates
        if (updateInterval) clearInterval(updateInterval);
        updateInterval = startSeekBarUpdates();
      } else {
        // Text capture (selection or whole page), sentence splitting,
        // and per-sentence preprocessing all happen in background.js /
        // contentScript.js now, so the popup just kicks off a session.
        const settings = getSettings();

        await saveSettings();
        updateControlButtons('loading');
        await audioPlayer.play(settings);

        // Restart seek bar updates
        if (updateInterval) clearInterval(updateInterval);
        updateInterval = startSeekBarUpdates();
      }
    } catch (error) {
      console.error('Error:', error);
      updateStatus(error.message, true);
      updateControlButtons('stopped');
    }
  });
  
  // Pause button
  document.getElementById('pauseBtn').addEventListener('click', function() {
    audioPlayer.pause();
    updateControlButtons('paused');
  });
  
  // Stop button
  document.getElementById('stopBtn').addEventListener('click', function() {
    audioPlayer.stop();
    updateControlButtons('stopped');
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }
  });
  
  // Download button
  document.getElementById('downloadBtn').addEventListener('click', function() {
    if (currentAudioUrl) {
      const a = document.createElement('a');
      a.href = currentAudioUrl;
      a.download = 'speech.mp3';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      updateStatus('Audio downloaded', false);
    }
  });
  
  // Save settings
  ['serverUrl', 'voice', 'speed', 'recordAudio', 'preprocessText'].forEach(id => {
    document.getElementById(id).addEventListener('change', saveSettings);
  });
  
  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'playerStateUpdate':
        updateControlButtons(message.state);
        if (message.state === 'playing' && !updateInterval) {
          updateInterval = startSeekBarUpdates();
        }
        if (message.state === 'stopped') {
          updateSentenceProgress(null);
        }
        break;

      case 'recordingComplete':
        currentAudioUrl = message.audioUrl;
        break;

      case 'streamError':
        updateStatus(message.error, true);
        updateControlButtons('stopped');
        updateSentenceProgress(null);
        break;

      case 'sentenceProgress':
        updateSentenceProgress(message);
        break;

      case 'timeUpdate':
        if (message.timeInfo && !seekBar.classList.contains('seeking')) {
          seekBar.max = message.timeInfo.duration;
          seekBar.value = message.timeInfo.currentTime;
          document.getElementById('currentTime').textContent = formatTime(message.timeInfo.currentTime);
          document.getElementById('duration').textContent = formatTime(message.timeInfo.duration);
        }
        break;
    }
  });
});