class AudioPlayer {
    constructor() {
      this.isPlaying = false;
      this.isInitialized = false;
    }
  
    async init() {
      if (!this.isInitialized) {
        // Set up the offscreen document for background playback
        await chrome.runtime.sendMessage({ type: 'setupOffscreen' });
        this.isInitialized = true;
      }
    }
  
    async play(settings) {
      await this.init();

      try {
        // Start a new reading session. background.js (via a content
        // script) captures the selection/page text itself, splits it
        // into sentence chunks, and streams them in order.
        await chrome.runtime.sendMessage({
          type: 'startStreaming',
          settings: settings,
          record: settings.recordAudio,
          mode: 'selection'
        });

        this.isPlaying = true;
        return true;
      } catch (error) {
        console.error('Error playing audio:', error);
        throw error;
      }
    }
  
    pause() {
      if (this.isInitialized) {
        chrome.runtime.sendMessage({ type: 'pause' });
        this.isPlaying = false;
      }
    }
  
    resume() {
      if (this.isInitialized) {
        chrome.runtime.sendMessage({ type: 'play' });
        this.isPlaying = true;
      }
    }
  
    stop() {
      if (this.isInitialized) {
        // Routed through background.js (not sent to the offscreen
        // document directly) so it can abort any in-flight/prefetch
        // fetch and clear the remaining sentence queue, not just halt
        // whatever's currently playing.
        chrome.runtime.sendMessage({ type: 'stopSession' });
        this.isPlaying = false;
      }
    }
  
    async seek(time) {
      if (this.isInitialized) {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'seek', time: time }, (response) => {
            resolve(response && response.success);
          });
        });
      }
      return false;
    }
  
    async getState() {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'getPlayerState' }, (response) => {
          resolve(response.state || 'stopped');
        });
      });
    }
  
    async getTimeInfo() {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'getTimeInfo' }, (response) => {
          resolve(response.timeInfo || null);
        });
      });
    }
  }
  
  window.AudioPlayer = AudioPlayer;