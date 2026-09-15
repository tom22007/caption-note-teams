(function () {
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const saveBtn = document.getElementById("saveBtn");
  const copyBtn = document.getElementById("copyBtn");
  const clearBtn = document.getElementById("clearBtn");
  const statusEl = document.getElementById("status");
  const transcriptEl = document.getElementById("transcript");
  const hintEl = document.getElementById("ocrHint");
  const platformEl = document.getElementById("platform");
  const platformHintEl = document.getElementById("platformHint");
  const video = document.getElementById("preview");
  const frame = document.getElementById("frame");
  const ocrView = document.getElementById("ocrView");

  let stream = null;
  let timer = null;
  let worker = null;
  let busy = false;
  let committed = [];
  let startedAt = null;
  let blackStreak = 0;
  let lastHadText = false;
  let tickMs = 1200;

  const TICK_IDLE_MS = 1200;
  const TICK_FLOWING_MS = 900;

  const nameLike = /^[A-Z][A-Za-z'.\-]+(?: [A-Z][A-Za-z'.\-]+){0,4}$/;

  const PLATFORM_LABELS = {
    auto: "Auto",
    teams: "Teams",
    zoom: "Zoom",
    meet: "Meet"
  };

  const PLATFORM_HINTS = {
    auto: "Auto detects a short captions popup vs a tall meeting/screen and crops accordingly.",
    teams: "Share the Teams Captions popup or Entire Screen. Teams windows often capture black on Mac — prefer Entire Screen if the preview is black.",
    zoom: "Share the Zoom captions window or Entire Screen.",
    meet: "Share Entire Screen (or the Meet tab). Meet captions sit in a bottom overlay — no separate captions window."
  };

  function setStatus(text, ok) {
    statusEl.textContent = text;
    statusEl.style.color = ok === false ? "#dc2626" : ok ? "#16a34a" : "#4b5563";
  }

  function updatePlatformHint() {
    const key = platformEl.value;
    platformHintEl.textContent = PLATFORM_HINTS[key] || PLATFORM_HINTS.auto;
  }

  function sourceLabel() {
    return PLATFORM_LABELS[platformEl.value] || "Auto";
  }

  function render() {
    transcriptEl.textContent = committed.join("\n\n");
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  function isSpeaker(line) {
    if (!line || line.length > 48) return false;
    if (/[.,!?]/.test(line)) return false;
    return nameLike.test(line);
  }

  function parseTurns(raw) {
    const lines = raw.replace(/\r/g, "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    const turns = [];
    let speaker = null;
    let buf = [];

    const flush = function () {
      if (buf.length) turns.push((speaker || "Unknown") + ": " + buf.join(" "));
      buf = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const n = lines[i];
      const split = n.match(/^([A-Z][A-Za-z'.\-]+(?: [A-Z][A-Za-z'.\-]+){0,4})\s*[:\-]\s+(.+)$/);
      if (split) {
        flush();
        speaker = split[1];
        buf.push(split[2]);
        continue;
      }
      if (isSpeaker(n)) {
        if (speaker && n !== speaker) flush();
        speaker = n;
      } else {
        if (!speaker) speaker = "Unknown";
        buf.push(n);
      }
    }
    flush();
    return turns;
  }

  function mergeTurns(snap) {
    if (!snap.length) return;
    if (!committed.length) {
      committed = snap.slice();
      return;
    }

    const last = committed[committed.length - 1];
    let match = -1;

    for (let i = 0; i < snap.length; i++) {
      const s = snap[i];
      if (s === last || s.indexOf(last) === 0 || last.indexOf(s) === 0) {
        match = i;
        break;
      }
    }

    if (match >= 0) {
      if (snap[match].length >= last.length) committed[committed.length - 1] = snap[match];
      for (let j = match + 1; j < snap.length; j++) committed.push(snap[j]);
      return;
    }

    for (let k = 0; k < snap.length; k++) {
      const line = snap[k];
      let dup = false;
      for (let c = 0; c < committed.length; c++) {
        const ex = committed[c];
        if (ex === line || ex.indexOf(line) === 0 || line.indexOf(ex) === 0) {
          dup = true;
          break;
        }
      }
      if (!dup) committed.push(line);
    }
  }

  function waitForVideo() {
    return new Promise(function (resolve) {
      if (video.videoWidth > 0) {
        resolve();
        return;
      }
      const done = function () {
        if (video.videoWidth > 0) resolve();
        else setTimeout(done, 50);
      };
      video.addEventListener("loadeddata", done, { once: true });
      setTimeout(done, 80);
    });
  }

  /**
   * Platform-aware caption crop presets.
   *
   * Fractions are tuned for typical live-caption layouts when sharing
   * Entire Screen (tall). Short/wide shares (popped-out caption windows)
   * use the full frame for Teams/Zoom/Auto.
   *
   * - auto:   short/wide → full; else bottom ~36% (legacy behaviour)
   * - teams:  short/wide → full (Captions popup); else bottom ~40%
   * - zoom:   short/wide → full (captions window); else bottom ~34%
   * - meet:   Meet-style bottom overlay ~28% tall, slight side inset
   *           (Meet has no separate captions window)
   */
  function captionCrop(w, h, platform) {
    const shortWide = h <= 520 || h / w <= 0.5;

    if (platform === "meet") {
      // Google Meet: captions are a compact bottom-center overlay on the
      // meeting UI. Crop a thinner bottom band with modest side inset so
      // chrome/side panels are less likely to confuse OCR.
      const ch = Math.max(Math.floor(h * 0.28), 100);
      const inset = Math.floor(w * 0.08);
      return { x: inset, y: h - ch, w: Math.max(w - inset * 2, 1), h: ch };
    }

    if (platform === "teams") {
      // Teams: prefer full frame for a popped-out Captions window; otherwise
      // a slightly taller bottom band for in-meeting / Entire Screen share.
      if (shortWide) return { x: 0, y: 0, w: w, h: h };
      const ch = Math.max(Math.floor(h * 0.40), 120);
      return { x: 0, y: h - ch, w: w, h: ch };
    }

    if (platform === "zoom") {
      // Zoom: captions popup or in-meeting bottom bar. Bottom band is a bit
      // tighter than Teams because Zoom's caption strip is usually shorter.
      if (shortWide) return { x: 0, y: 0, w: w, h: h };
      const ch = Math.max(Math.floor(h * 0.34), 110);
      return { x: 0, y: h - ch, w: w, h: ch };
    }

    // Auto (default): same logic as before the multi-platform MVP.
    if (shortWide) return { x: 0, y: 0, w: w, h: h };
    const ch = Math.max(Math.floor(h * 0.36), 120);
    return { x: 0, y: h - ch, w: w, h: ch };
  }

  function preprocess(src, sw, sh) {
    const scale = sw < 1000 ? 3 : 2;
    const dw = Math.min(1600, Math.max(1, Math.round(sw * scale)));
    const dh = Math.max(1, Math.round(sh * (dw / sw)));
    ocrView.width = dw;
    ocrView.height = dh;
    const ctx = ocrView.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(src, 0, 0, sw, sh, 0, 0, dw, dh);
    const img = ctx.getImageData(0, 0, dw, dh);
    const d = img.data;
    let total = 0;
    const pixels = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = y;
      total += y;
    }
    const mean = total / pixels;
    const invert = mean < 145;
    for (let i = 0; i < d.length; i += 4) {
      let y = d[i];
      if (invert) y = 255 - y;
      y = (y - 128) * 1.55 + 140;
      if (y < 0) y = 0;
      if (y > 255) y = 255;
      d[i] = d[i + 1] = d[i + 2] = y;
    }
    ctx.putImageData(img, 0, 0);
    return { mean: mean, invert: invert, black: mean < 14 };
  }

  async function ensureWorker() {
    if (worker) return worker;
    if (typeof Tesseract === "undefined") {
      throw new Error("OCR library did not load. Check your network and refresh.");
    }
    setStatus("Loading OCR engine (first time takes a moment)…", true);
    worker = await Tesseract.createWorker("eng");
    await worker.setParameters({
      tessedit_pageseg_mode: "6",
      user_defined_dpi: "300",
      preserve_interword_spaces: "1"
    });
    return worker;
  }

  function scheduleTicks() {
    if (timer) clearInterval(timer);
    timer = setInterval(tick, tickMs);
  }

  function adjustTickRate(hadText) {
    const next = hadText ? TICK_FLOWING_MS : TICK_IDLE_MS;
    if (next === tickMs) return;
    tickMs = next;
    if (timer) scheduleTicks();
  }

  async function tick() {
    if (!stream || busy) return;

    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== "live") {
      stopRecording();
      setStatus("Caption window was closed.", false);
      return;
    }

    busy = true;
    try {
      await waitForVideo();
      const w = video.videoWidth || 0;
      const h = video.videoHeight || 0;
      if (w < 8 || h < 8) {
        setStatus("Waiting for the shared window…", false);
        busy = false;
        return;
      }

      const crop = captionCrop(w, h, platformEl.value);
      frame.width = crop.w;
      frame.height = crop.h;
      const fctx = frame.getContext("2d", { willReadFrequently: true });
      fctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);

      const prep = preprocess(frame, crop.w, crop.h);
      if (prep.black) {
        blackStreak += 1;
        if (blackStreak >= 2) {
          setStatus("Capture is black. Share Entire Screen, or enable Screen Recording for Chrome/Edge on this Mac, then restart the browser.", false);
        } else {
          setStatus("Shared window looks black…", false);
        }
        busy = false;
        return;
      }
      blackStreak = 0;

      await ensureWorker();
      const result = await worker.recognize(ocrView);
      const raw = (result && result.data && result.data.text || "").trim();
      const hadText = !!raw;
      lastHadText = hadText;
      adjustTickRate(hadText);
      hintEl.textContent = raw
        ? ("OCR: " + raw.replace(/\s+/g, " ").slice(0, 180))
        : "OCR: (no text in this frame — pick the captions window or Entire Screen)";
      mergeTurns(parseTurns(raw));
      render();
      setStatus("Recording (" + sourceLabel() + ") · " + committed.length + " lines", true);
    } catch (err) {
      console.error(err);
      setStatus("Could not read captions: " + (err && err.message ? err.message : err), false);
    }
    busy = false;
  }

  async function startRecording() {
    if (!window.isSecureContext) {
      setStatus("Open this page via http://localhost:8000 (not as a file).", false);
      return;
    }
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 4, max: 8 },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false,
        preferCurrentTab: false,
        selfBrowserSurface: "exclude",
        systemAudio: "exclude"
      });
    } catch (err) {
      setStatus("Screen pick was cancelled.", false);
      return;
    }

    committed = [];
    blackStreak = 0;
    lastHadText = false;
    tickMs = TICK_IDLE_MS;
    startedAt = new Date();
    render();
    hintEl.textContent = "";
    video.srcObject = stream;
    video.classList.add("on");
    try { await video.play(); } catch (e) {}

    startBtn.disabled = true;
    stopBtn.disabled = false;
    setStatus("Reading captions (" + sourceLabel() + ") from the selected window…", true);

    try { await ensureWorker(); } catch (err) {
      setStatus("Could not start OCR: " + err.message, false);
    }

    scheduleTicks();
    tick();

    stream.getVideoTracks()[0].addEventListener("ended", function () {
      stopRecording();
    });
  }

  async function stopRecording() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }

    video.srcObject = null;
    video.classList.remove("on");
    startBtn.disabled = false;
    stopBtn.disabled = true;
    tickMs = TICK_IDLE_MS;
    setStatus(committed.length ? "Stopped." : "Stopped. No captions captured.", committed.length > 0);
  }

  function noteText() {
    const when = startedAt || new Date();
    return [
      "Caption Note",
      "Date: " + when.toISOString().slice(0, 16).replace("T", " "),
      "Source: Live Captions (" + sourceLabel() + ")",
      "",
      "------------------------------------------------",
      "",
      committed.join("\n\n"),
      ""
    ].join("\n");
  }

  startBtn.addEventListener("click", startRecording);
  stopBtn.addEventListener("click", stopRecording);
  platformEl.addEventListener("change", updatePlatformHint);
  updatePlatformHint();

  saveBtn.addEventListener("click", function () {
    const blob = new Blob([noteText()], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "CaptionNote-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".txt";
    a.click();
  });

  copyBtn.addEventListener("click", async function () {
    try {
      await navigator.clipboard.writeText(noteText());
      setStatus("Copied to clipboard!", true);
    } catch (err) {
      setStatus("Failed to copy. Please select and copy manually.", false);
    }
  });

  clearBtn.addEventListener("click", function () {
    committed = [];
    render();
  });
})();
