# Teleprompter Studio

Local-first teleprompter software for macOS and Windows. The desktop app separates the operator controller from the mirrored output; Android development is postponed until the desktop workflow is stable.

## Implemented

- Controller and independent windowed display with native window controls.
- Automatic external-display selection and manual display selection.
- Text, Markdown and DOCX file import.
- Horizontal, vertical and dual-axis mirror modes.
- Bundled Mengyuan Sans/Serif fonts plus size, weight, line height, spacing and alignment controls.
- Fixed-speed playback and a shared session clock.
- Page and paragraph navigation based on semantic script anchors.
- Space, Enter, arrow, Shift+arrow and PageUp controls.
- macOS and Windows system on-device recognition plus local FunASR streaming recognition.
- Selectable and persisted microphone input with live input-level feedback.
- Pinyin-aware incremental script tracking with automatic reread rewind.
- Paraformer Streaming INT8/FP32 model management: download, resume, verify, update and delete.
- macOS DMG/ZIP and Windows NSIS/portable packaging configuration.

## Not Implemented Yet

- Android client, on-device recognition and native external-display support.
- Local-network controller/display pairing.
- Production icon, release signing, notarization and auto-update.

## Development

No project-specific Conda environment is required. The desktop project uses Node.js and npm.

```bash
npm install
npm test
npm run build
npm run dev
```

The development command opens the Electron controller. Use **打开显示** to create the separate prompter output window.

## Packaging

```bash
npm run build:mac
npm run build:windows
```

`build:mac` creates a locally ad-hoc signed and strictly verified `.app` directory without producing a DMG or ZIP. `build:windows` creates and statically verifies an unpacked Windows x64 application under `release/win-unpacked`; it can cross-build on macOS, but runtime verification still requires Windows. Public macOS distribution requires a trusted Developer ID Application signature and notarization; Windows distribution requires code signing before installer packaging.

## Keyboard Controls

| Input | Action |
| --- | --- |
| `Space` | Play or pause |
| `Enter` | Play or pause |
| `Left` / `Right` | Previous or next derived page |
| `Shift+Left` / `Shift+Right` | Previous or next paragraph |
| `Up` / `Down` | Increase or decrease speed |
| `PageUp` | Rewind approximately 80 normalized characters |

## Current Verification

- Unit tests: 43 passing.
- Strict renderer TypeScript check: passing.
- Electron and Vite production build: passing.
- macOS controller/display E2E: passing on Apple Silicon.
- Paraformer real streaming recognition: passing; Electron receives multiple partial results and advances the script anchor before utterance completion.
- Paraformer Streaming INT8/FP32 model download/switch/delete lifecycle: passing; segmented SenseVoice models have been removed.
- Locally ad-hoc signed macOS test app: `release/mac-arm64/Teleprompter Studio.app`.
- macOS notarization: not configured; Gatekeeper public-distribution assessment therefore fails.
- Windows runtime and multi-display behavior: requires Windows hardware or CI validation.
