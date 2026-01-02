# AI-trans (Context-aware Translation Browser Extension)

AI-trans is a browser extension powered by a configurable LLM translation service. It provides high-quality, context-aware translations for selected text on web pages and presents results in a single card: Full Sentence Translation (to avoid omissions), Contextual Translation, Literal Translation, and Semantic Notes. The result bubble supports dragging, language switching, and closing by clicking outside or the X button.

## Features
- Context-aware translation: Full sentence, contextual, literal, and semantic explanation in one view
- Language dropdown: switch target language in the result card
- Draggable result bubble: drag by the header to avoid obstructing content
- Close by clicking outside or the X button after translation completes
- Local UI preview page for development

## Project Structure
```
├── README.md
├── README_EN.md          # English README (this file)
├── background.js         # Service Worker: unified LLM calls, error handling, retries
├── contentScript.js      # Content script: selection handling, Shiba icon, result bubble & interactions
├── contentStyles.css     # Styles: result bubble, header, interaction states (drag, close, etc.)
├── env.json              # Local development example (do not store secrets)
├── icons/                # Extension and overlay icons (includes 柴犬.svg)
├── manifest.json         # Manifest V3 (name, permissions, icons)
├── options.html          # Options page: configure API Key, target language, trigger mode, etc.
├── options.js            # Options page logic
└── preview.html          # Local preview page for UI card layout and interactions
```

## Installation (Development Mode)
1. Clone or download this repository
2. Open Chrome/Edge → visit `chrome://extensions` / `edge://extensions`
3. Turn on "Developer mode"
4. Click "Load unpacked" and select the project root directory
5. Ensure the extension AI-trans is enabled

## Quick Start
- Select text on any web page
- A Shiba icon appears near the selection; click it to request translation and open the result bubble
- The result card includes:
  - Full sentence translation (ensures complete sentence/multi-clause coverage)
  - Contextual translation (based on surrounding context)
  - Literal translation (word-by-word/phrase)
  - Semantic notes (explanation, usage)
- Interactions:
  - Drag the bubble by its header to avoid blocking content
  - Use the language dropdown to switch target language
  - Click outside the bubble or the X button to close

## Configuration
- In the Options page (options.html), configure:
  - API Key and endpoint for your translation service (e.g., DeepSeek-compatible)
  - Target language, trigger mode (hover/click), context window length
- Security recommendations:
  - Keep API Key in local browser storage (chrome.storage); never commit secrets
  - `env.json` is for local examples only; do not store real keys here

## Permissions & Security
- Minimal MV3 permissions: `storage`, `activeTab`, `scripting`
- `host_permissions`: only the translation endpoint domains you intend to use
- Privacy & security:
  - Only send the necessary selection text and a small context window
  - Do not record or upload sensitive page data
  - Do not store secrets in logs or repository

## How It Works (Brief)
- contentScript:
  - Listens to selection & clicks, inserts the trigger icon (Shiba)
  - Collects selected text and context, renders the result bubble and interactions
- background:
  - Builds a structured prompt with selection and safe-wrapped context
  - Calls the translation service and returns structured results (full/contextual/literal/semantic)
  - Handles errors and retries centrally

## Local UI Preview
- Start a local server:
  - `python3 -m http.server 5500`
- Open: `http://localhost:5500/preview.html`
- Preview card layout and interactions without hitting real APIs

## Packaging & Publishing
- Use as an unpacked extension or package a ZIP for store submission
- Pre-publish checklist:
  - Manifest name and icons (this project uses "AI-trans" with `icons/柴犬.svg`)
  - Minimal permissions and privacy notice
  - Options page for user API Key (no bundled secrets)

## Roadmap
- ESC key to close bubble
- More precise drag hotspot (left side of header only)
- Clearer translation levels with badges
- Optional domain-specific context for professional accuracy
- Persistent bubble position and smart avoidance

## Contributing
- Issues/PRs are welcome to improve features and UX
- Before submitting, `git pull --rebase` on latest main

## FAQ
- Q: The language dropdown doesn’t open or respond.
  - A: Dragging is limited to the header; interactions like select/button are excluded from drag. If you still see issues, reload the extension and try again.
- Q: The Shiba icon doesn’t appear.
  - A: Ensure the extension is enabled and you have selected text. Some pages (e.g., PDFs or certain shadow DOMs) may require additional support.
- Q: Click outside doesn’t close the bubble.
  - A: Outside-click listeners are attached after translation completes. If the bubble persists, use the X button.
- Q: API Key not configured / rate limit errors.
  - A: Set your API Key in the Options page. Handle rate limits by retrying later.
- Q: Bubble position is odd or out of view after drag.
  - A: Drag is in viewport coordinates with fixed positioning. Reload the page to reset or drag back to a visible area.

## License
- MIT License. See the LICENSE file for details.