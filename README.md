# Caption Note

Capture **live captions** from Microsoft Teams, Zoom, or Google Meet into a plain-text note — on a Mac, in Chrome or Edge, without Record/Transcribe APIs.

This is a lightweight browser app: you share a captions window (or Entire Screen), and the page crops the caption region and runs **Tesseract.js OCR** locally. Speaker turns are merged into a note you can download or copy.

## Quick start

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
- macOS may return a **black** frame for some app windows unless you share Entire Screen and grant Screen Recording to the browser.
- This is **not** an official integration with Teams / Zoom / Meet caption APIs.

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

Those need packaging, permissions, and per-app maintenance; this MVP stays a plain static page you can open locally.

## Out of scope

Native Electron app, OS accessibility APIs, Zoom/Teams Graph SDKs, Whisper audio transcription.

## Privacy

All OCR runs in your browser. No caption text is uploaded by this app. See `privacy.html`.
