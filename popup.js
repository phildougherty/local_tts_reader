let audioPlayer = null;
let currentAudioUrl = null;

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
  const seekBar = document.getElementById('seekBar');
  
  // Hide loading indicator by default
  loadingIndicator.style.display = 'none';
  
  // Stop button is always enabled (except during loading)
  stopBtn.disabled = state === 'loading';
  
  switch(state) {
    case 'loading':
      playBtn.disabled = true;
      pauseBtn.disabled = true;
      downloadBtn.disabled = true;
      seekBar.disabled = true;
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
  const useCustomVoice = document.getElementById('useCustomVoice').checked;
  const voice = useCustomVoice ? 
    document.getElementById('customVoice').value : 
    document.getElementById('voice').value;
  
  return {
    serverUrl: document.getElementById('serverUrl').value,
    voice: voice,
    speed: document.getElementById('speed').value,
    recordAudio: document.getElementById('recordAudio').checked,
    preprocessText: document.getElementById('preprocessText').checked,
    enableChunking: document.getElementById('enableChunking').checked
  };
}

async function saveSettings() {
  const settings = getSettings();
  const useCustomVoice = document.getElementById('useCustomVoice').checked;
  const customVoice = document.getElementById('customVoice').value;
  
  // Add voice mode and custom voice to settings
  settings.voiceMode = useCustomVoice ? 'custom' : 'preset';
  settings.customVoice = customVoice;
  
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

// Process text based on settings
function processText(text, settings) {
  if (settings.preprocessText) {
    return TextProcessor.process(text);
  }
  return text;
}

// Toggle between preset and custom voice sections
function toggleVoiceSection() {
  const useCustomVoice = document.getElementById('useCustomVoice').checked;
  const presetSection = document.getElementById('presetVoiceSection');
  const customSection = document.getElementById('customVoiceSection');
  
  if (useCustomVoice) {
    presetSection.style.display = 'none';
    customSection.style.display = 'block';
  } else {
    presetSection.style.display = 'block';
    customSection.style.display = 'none';
  }
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
    preprocessText: DEFAULT_SETTINGS.preprocessText,
    enableChunking: true,
    voiceMode: 'preset',
    customVoice: ''
  }, function(result) {
    document.getElementById('serverUrl').value = result.serverUrl;
    document.getElementById('voice').value = result.voice;
    document.getElementById('speed').value = result.speed;
    document.getElementById('recordAudio').checked = result.recordAudio;
    document.getElementById('preprocessText').checked = result.preprocessText;
    document.getElementById('enableChunking').checked = result.enableChunking;
    document.querySelector('.speed-value').textContent = `${result.speed}x`;
    
    // Set voice mode
    const isCustomVoice = result.voiceMode === 'custom' || 
      (result.customVoice && result.customVoice.trim() !== '');
    
    if (isCustomVoice) {
      document.getElementById('useCustomVoice').checked = true;
      document.getElementById('customVoice').value = result.customVoice || '';
      toggleVoiceSection();
    } else {
      document.getElementById('usePresetVoice').checked = true;
    }
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
  
  // Voice mode radio buttons
  document.getElementById('usePresetVoice').addEventListener('change', function() {
    if (this.checked) {
      toggleVoiceSection();
      saveSettings();
    }
  });
  
  document.getElementById('useCustomVoice').addEventListener('change', function() {
    if (this.checked) {
      toggleVoiceSection();
      saveSettings();
    }
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
        const tabs = await chrome.tabs.query({active: true, currentWindow: true});
        const [tab] = tabs;
        const result = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: () => {
            const selection = window.getSelection();
            return selection.toString().trim() || document.body.innerText;
          },
        });

        let text = result[0].result;
        const settings = getSettings();
        
        // Process text if enabled
        text = processText(text, settings);
        
        await saveSettings();
        updateControlButtons('loading');
        await audioPlayer.play(text, settings);
        
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
  ['serverUrl', 'voice', 'speed', 'recordAudio', 'preprocessText', 'enableChunking', 'customVoice'].forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener('change', saveSettings);
    }
  });
  
  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'playerStateUpdate':
        updateControlButtons(message.state);
        if (message.state === 'playing' && !updateInterval) {
          updateInterval = startSeekBarUpdates();
        }
        break;
        
      case 'recordingComplete':
        currentAudioUrl = message.audioUrl;
        break;
        
      case 'streamError':
        updateStatus(message.error, true);
        updateControlButtons('stopped');
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