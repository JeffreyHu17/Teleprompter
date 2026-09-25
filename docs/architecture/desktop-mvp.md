# Desktop MVP Architecture

## Scope

The first implementation targets macOS and Windows. It provides:

- A controller window for script editing, playback, typography and output selection.
- A dedicated frameless display window for a physical beam-splitter teleprompter.
- Text, Markdown and DOCX import.
- Horizontal, vertical and dual-axis mirroring.
- Fixed-speed playback, page/paragraph navigation and configurable Enter behavior.
- Semantic script anchors that survive typography and viewport changes.

macOS local ASR runs through a native `TeleprompterSpeech.app` helper using `SFSpeechRecognizer` and `AVAudioEngine`. It requires `supportsOnDeviceRecognition` and sets `requiresOnDeviceRecognition = true`; unsupported devices fail explicitly instead of falling back to cloud recognition. Incremental transcripts enter a bidirectional script tracker, which submits the same `seek` anchors used by manual input.

## Runtime

```text
Electron main process
  - owns authoritative SessionState
  - opens controller/display BrowserWindows
  - imports local files
  - enumerates and places displays
  - runs fixed-speed playback clock
  - receives semantic commands

React controller renderer
  - edits scripts and settings
  - renders a normal-orientation confidence preview
  - emits commands only

React display renderer
  - performs final layout at target resolution
  - reports derived page anchors
  - renders mirroring and smooth anchor following
```

## Position Contract

`ScriptAnchor` is authoritative. Page number, line number and pixel offset are derived display data.

```text
ScriptAnchor
  document revision (from SessionState)
  paragraph id/index
  character offset in paragraph
  normalized global character offset
```

When typography or display geometry changes, the display renderer lays out the document again, places the current anchor on the focus line and reports new page anchors. This prevents font changes from moving playback to unrelated text.

## Desktop And Mobile Boundary

The TypeScript document, anchor, command and reducer modules are platform-independent. Electron owns desktop windows and displays. A later Capacitor mobile shell can reuse the core while implementing Android `Presentation` and Apple external-display scenes with native plugins.

## Deferred Work

- sherpa-onnx and non-Apple platform on-device speech adapters.
- Additional corpus tuning for the implemented bidirectional tracker and manual-override protection window.
- Local-network controller/display pairing.
- User shortcut editor and hardware shuttle support.
- Signed Windows and macOS release pipelines.

## Release Status

The current macOS artifact is development-signed and launches locally. It is not notarized and is not ready for public distribution. Windows packaging can be generated cross-platform, but runtime behavior remains unverified until exercised on Windows hardware or CI.
