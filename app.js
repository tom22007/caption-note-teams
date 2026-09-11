(function () {
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const saveBtn = document.getElementById("saveBtn");
  const copyBtn = document.getElementById("copyBtn");
  const clearBtn = document.getElementById("clearBtn");
  const statusEl = document.getElementById("status");
  const transcriptEl = document.getElementById("transcript");
  const hintEl = document.getElementById("ocrHint");
  const regionEl = document.getElementById("region");
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

  const nameLike = /^[A-Z][A-Za-z'.\-]+(?: [A-Z][A-Za-z'.\-]+){0,4}$/;

  function setStatus(text, ok) {
    statusEl.textContent = text;
    statusEl.style.color = ok === false ? "#dc2626" : ok ? "#16a34a" : "#4b5563";
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

  function captionCrop(w, h, mode) {
    if (mode === "full") return { x: 0, y: 0, w: w, h: h };
    if (mode === "bottom") {
      const ch = Math.max(Math.floor(h * 0.36), 90);
      return { x: 0, y: h - ch, w: w, h: ch };
    }
    // Auto: a popped-out captions window is short/wide. A meeting or full
    // screen is tall, with captions near the bottom.
    if (h <= 520 || h / w <= 0.5) return { x: 0, y: 0, w: w, h: h };
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

      const crop = captionCrop(w, h, regionEl.value);
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
      hintEl.textContent = raw ? ("OCR: " + raw.replace(/\s+/g, " ").slice(0, 180)) : "OCR: (no text in this frame — pick the Captions window or Entire Screen)";
      mergeTurns(parseTurns(raw));
      render();
      setStatus("Recording · " + committed.length + " lines", true);
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
    startedAt = new Date();
    render();
    hintEl.textContent = "";
    video.srcObject = stream;
    video.classList.add("on");
    try { await video.play(); } catch (e) {}

    startBtn.disabled = true;
    stopBtn.disabled = false;
    setStatus("Reading captions from the selected window…", true);

    try { await ensureWorker(); } catch (err) {
      setStatus("Could not start OCR: " + err.message, false);
    }

    timer = setInterval(tick, 1200);
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
    setStatus(committed.length ? "Stopped." : "Stopped. No captions captured.", committed.length > 0);
  }

  function noteText() {
    const when = startedAt || new Date();
    return [
      "Caption Note",
      "Date: " + when.toISOString().slice(0, 16).replace("T", " "),
      "Source: Live Captions",
      "",
      "------------------------------------------------",
      "",
      committed.join("\n\n"),
      ""
    ].join("\n");
  }

  startBtn.addEventListener("click", startRecording);
  stopBtn.addEventListener("click", stopRecording);

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
