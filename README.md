# Local TTS Reader - Chrome Extension

A sleek Chrome extension that converts webpage text to speech using a local OpenAI-compatible TTS server. Features include voice selection, speed control, and the ability to save audio files.


## Features

- 🎯 Read selected text or entire webpage
- 📚 Sentence-by-sentence chunking with prefetch, so playback flows from
  one sentence to the next without waiting on the network mid-read
- 🖍️ The sentence currently being read is highlighted live on the page
  (works even when a sentence spans bold text, links, or other inline
  formatting)
- 🥶 Cold-start aware: shows a distinct "Starting voice engine…" state
  and uses a longer timeout for the first request of a session, since
  some local TTS backends (e.g. a sleeping llama-swap/Chatterbox
  process) can take up to ~30s to wake up
- 🎭 Multiple voice options compatible with OpenAI voice mappings
- ⚡ Adjustable playback speed (0.25x to 4.0x)
- 💾 Option to save audio for download
- ⏯️ Play/Pause/Stop/Seek controls
- 🎨 Clean, modern interface
- 🔧 Configurable server URL
- 🌐 Works with Tailscale/local network TTS servers

## Installation

1. Clone this repository:
```bash
git clone https://github.com/phildougherty/local_tts_reader.git
```

2. Load the extension in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked"
   - Select the cloned repository folder

## Usage

1. Click the extension icon in your Chrome toolbar
2. Configure your settings:
   - Select your preferred voice
   - Adjust the playback speed using the slider
   - Check "Save audio for download" if you want to download the audio
   - Enter your local TTS server URL

3. On any webpage:
   - Select specific text to read just that portion
   - Or don't select anything to read the entire page
   - Click play to start TTS
   - Use pause/stop controls as needed
   - Download the audio if recording was enabled

## Voice Options

The extension supports the following voices:
- Adam (Alloy) - `am_adam`
- Nicole (Ash) - `af_nicole`
- Emma (Coral) - `bf_emma`
- Bella (Echo) - `af_bella`
- Sarah (Fable) - `af_sarah`
- George (Onyx) - `bm_george`
- Isabella (Nova) - `bf_isabella`
- Michael (Sage) - `am_michael`
- Sky (Shimmer) - `af_sky`

## Server Requirements

Your local TTS server should:
- Be OpenAI API compatible
- Accept POST requests to `/v1/audio/speech`
- Accept JSON payload in the format:
\\```json
{
  "model": "tts-1",
  "voice": "af_bella",
  "input": "text to speak",
  "speed": 1.0
}
\\```
- Return audio data (mp3/wav)

Note: the extension now sends one request **per sentence** rather than
one request for the whole selection (see "How reading works" below), so
`input` will typically be a single sentence, not a full paragraph.

Default server URL: `http://localhost:8000/v1/audio/speech`

## How reading works

When you hit play, the extension:
1. Captures the current selection, or — if nothing is selected — tries
   to extract just the article content of the page (dropping nav bars,
   ads, sidebars, related-links widgets, etc.) using a vendored copy of
   [Mozilla's Readability.js](https://github.com/mozilla/readability),
   the same extraction library behind Firefox's Reader View. When that
   succeeds, the extracted article is shown in a clean, distraction-free
   overlay (closeable, or press Esc) and read from there; if extraction
   fails or the page doesn't look like a single article, it falls back
   to reading the whole page exactly as before. Either way, the result
   is split into sentences.
2. Requests the first sentence's audio. The very first request of a
   new session uses a longer timeout (45-60s) and the popup shows
   "Starting voice engine…", since some local TTS backends need time
   to load a model on their first request after being idle. Every
   request after that uses a shorter timeout (15-20s).
3. While a sentence plays, the *next* sentence's audio is fetched in
   the background, so there's no gap waiting on the network between
   sentences.
4. The sentence currently playing is highlighted on the page itself
   (not just scrolled to) via a content script — this works even when
   a sentence spans multiple inline elements like bold text or links.
5. Stop immediately cancels any in-flight request and clears the rest
   of the queue; the highlight is cleared on Stop, when a sentence
   finishes, and on page navigation.
6. If a request times out, it's retried once before an error is shown.

A background `chrome.alarms` heartbeat runs while a session is active,
to reduce the chance Chrome terminates the extension's MV3 service
worker while waiting on a slow (cold-start) response.

## Development

The extension's main files:
- `manifest.json`: Extension configuration
- `background.js`: Service worker — owns the reading session (chunking,
  prefetch, timeouts/retries, cold-start state)
- `contentScript.js` / `sentenceSplitter.js`: Injected into the page to
  capture the selection (or extracted article), split it into
  sentences, and highlight the sentence currently playing
- `vendor/readability.js`: Unmodified vendored copy of Mozilla's
  Readability.js (Apache-2.0, see `vendor/LICENSE-mozilla-readability.md`)
- `offscreen.js` / `offscreen.html`: Plays each sentence's audio
- `popup.html` / `popup.js`: UI and settings
- `textProcessor.js`: Strips markdown/URLs before sending text to TTS

To modify the extension:
1. Make your changes
2. Reload the extension in `chrome://extensions/`
3. Click the refresh icon on the extension card

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

Distributed under the MIT
