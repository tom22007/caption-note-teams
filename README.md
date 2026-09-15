# Caption Note

Capture **live captions** from Microsoft Teams, Zoom, or Google Meet into a plain-text note — on a Mac, in Chrome or Edge, **or as a one-click desktop app** — without Record/Transcribe APIs.

This is a lightweight browser app: you share a captions window (or Entire Screen), and the page crops the caption region and runs **Tesseract.js OCR** locally. Speaker turns are merged into a note you can download or copy.

The same static files (`index.html`, `app.js`, `styles.css`) power both local browser testing and the Electron desktop shell.

## Desktop app (Electron)

### Approach: Electron (not Tauri)

**Electron** wraps the existing static UI for one-click launch (`Caption Note.app` / `.exe`).

We evaluated **Tauri** first (smaller binary), but chose **Electron** for this MVP because:

- Caption Note depends on **`getDisplayMedia` / screen recording** for OCR.
- Electron’s Chromium **`displayMedia` + `desktopCapturer`** path (with `setDisplayMediaRequestHandler` and `useSystemPicker`) is generally more reliable for screen/window capture on **macOS** than WKWebView-based Tauri webviews.
- A working screen-share MVP matters more than binary size for v1.

Tauri remains a future option if display capture becomes solid there; do not block on it for this release.

### Dev (run from source)

Requires Node.js 18+ and npm.

```bash
npm install
npm run desktop
```

This opens an Electron window titled **Caption Note** that loads `index.html` via `loadFile` (secure context). Tesseract still loads from the jsDelivr CDN on first OCR — **network required** the first time (CDN is fine for MVP).

### Release build

```bash
npm install
npm run desktop:build          # mac (dmg/zip) + win (nsis/portable)
npm run desktop:build:mac      # mac only
npm run desktop:build:win      # Windows only
```

Artifacts land in **`release/`** (gitignored):

| Platform | Typical output |
|----------|----------------|
| macOS    | `release/Caption Note-1.0.0.dmg`, `.zip` / `Caption Note.app` |
| Windows  | `release/Caption Note Setup 1.0.0.exe` (NSIS), portable `.exe` |

### Launch the built app

**macOS**

1. Open the DMG (or unzip) from `release/`.
2. Drag **Caption Note.app** to Applications (or run it from the DMG).
3. Double-click **Caption Note**.
4. Grant **Screen Recording** (see below), then quit and reopen if macOS asks.

**Windows**

1. Run the NSIS installer from `release/`, or launch the portable `.exe`.
2. Start **Caption Note** from the Start Menu shortcut or the portable binary.

### Mac Screen Recording permission (required)

Caption Note must be allowed to capture the screen so OCR can read live captions.

1. Open **System Settings → Privacy & Security → Screen Recording**.
2. Enable **Caption Note** (packaged app) — or **Electron** when running `npm run desktop` from source.
3. **Quit and reopen** Caption Note (or the Electron helper) after toggling permission.
4. Click **Start** in the app and share the captions window or **Entire Screen**.

If the preview is black, share Entire Screen and confirm Screen Recording is enabled for the app you actually launched.

### Windows note

Windows usually prompts for screen capture when you click **Start**. If capture fails, check that Caption Note is allowed to record the screen in **Settings → Privacy → Screen recording** (wording varies by Windows version), then restart the app.

### Scripts reference

| Script | Purpose |
|--------|---------|
| `npm run desktop` | Dev: launch Electron shell |
| `npm run desktop:build` | Package mac + win into `release/` |
| `npm run desktop:build:mac` | Package mac only |
| `npm run desktop:build:win` | Package Windows only |

Static web files are **not** removed — you can still test in a browser (below).

---

## Quick start (browser)

1. Serve the repo over localhost (required for `getDisplayMedia`):

   ```bash
   python3 -m http.server 8000
   ```

2. Open [http://localhost:8000](http://localhost:8000) in **Chrome or Edge**.
3. On a Mac: **System Settings → Privacy & Security → Screen Recording** — enable Chrome or Edge, then **quit and reopen** the browser.
4. Choose a **Platform** (Auto / Teams / Zoom / Google Meet), turn on live captions in the meeting app, click **Start**, and share the captions window or Entire Screen.

## Mac workflow by platform

### Microsoft Teams

1. In the meeting: **More (…) → Language and speech → Show live captions**.
2. Pop captions into their own window if available.
3. In Caption Note, select **Teams**.
4. Click **Start** → share the **Captions** window.
   If the preview is **black** (common with Teams windows on macOS), cancel and share **Entire Screen** instead, then keep the captions visible.

### Zoom

1. In the meeting: enable **Live Transcript** / captions (host or participant controls).
2. Pop the captions / transcript panel into a separate window if you can.
3. In Caption Note, select **Zoom**.
4. Click **Start** → share the **Zoom captions** window, or **Entire Screen** if a single-window share looks wrong or black.

### Google Meet

1. In the meeting: turn on **Captions** (CC).
2. Meet does **not** offer a separate captions window — captions appear as a bottom overlay.
3. In Caption Note, select **Google Meet**.
4. Click **Start** → share **Entire Screen** (or the Meet browser tab). Keep the Meet window visible so the bottom overlay is in view.

### Auto

Uses the original heuristic: a short/wide share (typical captions popup) is OCR'd in full; a tall meeting or full-screen share crops a bottom band (~36%).

## What gets saved

Downloaded / copied notes include a header like:

```text
Caption Note
Date: 2026-09-14 21:48
Source: Live Captions (Teams)
```

Source is one of: `Teams`, `Zoom`, `Meet`, or `Auto`.

## Honest limits (OCR approach)

- Accuracy depends on font size, contrast, window size, and GPU/CPU load. Expect occasional typos and missed lines.
- Overlapping UI chrome (chat, reactions, raised hands) can pollute the crop.
- Rapid speaker changes or scrolling captions may lag behind real-time speech.
- macOS may return a **black** frame for some app windows unless you share Entire Screen and grant Screen Recording to the browser **or** the Caption Note desktop app.
- This is **not** an official integration with Teams / Zoom / Meet caption APIs.
- First OCR run needs network for the Tesseract.js CDN (unless you later vendor the library).

## Platform crop presets

Documented in `app.js` (`captionCrop`):

| Platform | Short captions window | Tall / Entire Screen |
|----------|----------------------|----------------------|
| Auto     | Full frame           | Bottom ~36%          |
| Teams    | Full frame           | Bottom ~40%          |
| Zoom     | Full frame           | Bottom ~34%          |
| Meet     | (N/A — use screen)   | Bottom ~28% + side inset |

When text is flowing, the OCR tick interval speeds up slightly (~900 ms vs ~1200 ms idle). Merge logic for speaker turns is unchanged from the prior Teams-focused build.

## Path for v2 (not in this MVP)

More reliable capture without OCR:

- **Browser extension** that scrapes the live-caption DOM in Meet / web Zoom / web Teams
- **Accessibility / AX** APIs on macOS for native caption windows
- Optional: switch desktop shell to **Tauri** if getDisplayMedia becomes equally reliable
- Optional: vendor/bundle Tesseract so first OCR works offline

Those need packaging, permissions, and per-app maintenance; the browser path stays a plain static page you can open locally.

## Out of scope

OS accessibility APIs, Zoom/Teams Graph SDKs, Whisper audio transcription, code-signed/notarized Mac distribution (local `electron-builder` output is enough for MVP).

## Privacy

All OCR runs in your browser or desktop webview. No caption text is uploaded by this app. See `privacy.html`.

## Teams / GitHub Pages

Static hosting files for Teams / gh-pages (e.g. `appPackage/`, `.nojekyll`, `config.html`, `privacy.html`) are unchanged — this desktop shell only adds Electron packaging beside them.
