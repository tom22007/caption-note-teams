(function () {
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const saveBtn = document.getElementById("saveBtn");
  const copyBtn = document.getElementById("copyBtn");
  const clearBtn = document.getElementById("clearBtn");
  const statusEl = document.getElementById("status");
  const transcriptEl = document.getElementById("transcript");
  const video = document.getElementById("preview");
  const canvas = document.getElementById("frame");
  
  let stream = null;
  let timer = null;
  let worker = null;
  let busy = false;
  let committed = [];
  let startedAt = null;
  
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
    const lines = raw.replace(/\r/g, "").split("\n").map(s => s.trim()).filter(Boolean);
    const turns = [];
    let speaker = null;
    let buf = [];
    
    const flush = () => {
      if (speaker && buf.length) turns.push(speaker + ": " + buf.join(" "));
      buf = [];
    };
    
    for (let i = 0; i < lines.length; i++) {
      const n = lines[i];
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
      const w = video.videoWidth || 640;
      const h = video.videoHeight || 360;
      
      // PERFORMANCE FIX: Only capture the bottom 35% of the screen where captions usually appear
      const cropY = Math.floor(h * 0.65);
      const cropH = h - cropY;
      
      canvas.width = w;
      canvas.height = cropH;
      const ctx = canvas.getContext("2d");
      
      // Draw only the cropped section onto the canvas
      ctx.drawImage(video, 0, cropY, w, cropH, 0, 0, w, cropH);
      
      if (!worker) {
        setStatus("Loading OCR engine (first time takes a moment)...", true);
        worker = await Tesseract.createWorker("eng");
      }
      
      const result = await worker.recognize(canvas);
      mergeTurns(parseTurns(result.data.text || ""));
      render();
      setStatus("Recording · " + committed.length + " lines", true);
    } catch (err) {
      console.error(err);
      setStatus("Could not read captions: " + err.message, false);
    }
    busy = false;
  }

  async function startRecording() {
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 2 },
        audio: false
      });
    } catch (err) {
      setStatus("Screen pick was cancelled.", false);
      return;
    }
    
    committed = [];
    startedAt = new Date();
    video.srcObject = stream;
    video.classList.add("on");
    await video.play();
    
    startBtn.disabled = true;
    stopBtn.disabled = false;
    setStatus("Reading captions from the selected window…", true);
    
    timer = setInterval(tick, 2000);
    tick();
    
    stream.getVideoTracks()[0].addEventListener("ended", () => {
      stopRecording();
    });
  }

  async function stopRecording() {
    if (timer) { 
      clearInterval(timer); 
      timer = null; 
    }
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    
    video.srcObject = null;
    video.classList.remove("on");
    startBtn.disabled = false;
    stopBtn.disabled = true;
    
    if (worker) {
      try { await worker.terminate(); } catch (e) {}
      worker = null;
    }
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
  
  saveBtn.addEventListener("click", () => {
    const blob = new Blob([noteText()], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "CaptionNote-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".txt";
    a.click();
  });
  
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(noteText());
      setStatus("Copied to clipboard!", true);
    } catch (err) {
      setStatus("Failed to copy. Please select and copy manually.", false);
    }
  });
  
  clearBtn.addEventListener("click", () => {
    committed = [];
    render();
  });
})();