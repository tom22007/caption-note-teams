(function () {
  var startBtn = document.getElementById("startBtn");
  var stopBtn = document.getElementById("stopBtn");
  var saveBtn = document.getElementById("saveBtn");
  var copyBtn = document.getElementById("copyBtn");
  var clearBtn = document.getElementById("clearBtn");
  var statusEl = document.getElementById("status");
  var transcriptEl = document.getElementById("transcript");
  var video = document.getElementById("preview");
  var canvas = document.getElementById("frame");
  var stream = null;
  var timer = null;
  var worker = null;
  var busy = false;
  var committed = [];
  var startedAt = null;
  var nameLike = /^[A-Z][A-Za-z'.\-]+(?: [A-Z][A-Za-z'.\-]+){0,4}$/;

  if (window.microsoftTeams && microsoftTeams.app) {
    microsoftTeams.app.initialize().catch(function () {});
  }

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
    var lines = raw.replace(/\r/g, "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    var turns = [];
    var speaker = null;
    var buf = [];
    function flush() {
      if (speaker && buf.length) turns.push(speaker + ": " + buf.join(" "));
      buf = [];
    }
    for (var i = 0; i < lines.length; i++) {
      var n = lines[i];
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
    var last = committed[committed.length - 1];
    var match = -1;
    for (var i = 0; i < snap.length; i++) {
      var s = snap[i];
      if (s === last || s.indexOf(last) === 0 || last.indexOf(s) === 0) {
        match = i;
        break;
      }
    }
    if (match >= 0) {
      if (snap[match].length >= last.length) committed[committed.length - 1] = snap[match];
      for (var j = match + 1; j < snap.length; j++) committed.push(snap[j]);
      return;
    }
    for (var k = 0; k < snap.length; k++) {
      var line = snap[k];
      var dup = false;
      for (var c = 0; c < committed.length; c++) {
        var ex = committed[c];
        if (ex === line || ex.indexOf(line) === 0 || line.indexOf(ex) === 0) { dup = true; break; }
      }
      if (!dup) committed.push(line);
    }
  }

  async function tick() {
    if (!stream || busy) return;
    var track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== "live") {
      stopRecording();
      setStatus("Caption window was closed.", false);
      return;
    }
    busy = true;
    try {
      var w = video.videoWidth || 640;
      var h = video.videoHeight || 360;
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, w, h);
      if (!worker) worker = await Tesseract.createWorker("eng");
      var result = await worker.recognize(canvas);
      mergeTurns(parseTurns(result.data.text || ""));
      render();
      setStatus("Recording · " + committed.length + " lines", true);
    } catch (err) {
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
    stream.getVideoTracks()[0].addEventListener("ended", function () {
      stopRecording();
    });
  }

  async function stopRecording() {
    if (timer) { clearInterval(timer); timer = null; }
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
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
    var when = startedAt || new Date();
    return [
      "Caption Note",
      "Date: " + when.toISOString().slice(0, 16).replace("T", " "),
      "Source: Microsoft Teams live captions",
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
    var blob = new Blob([noteText()], { type: "text/plain" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "CaptionNote-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".txt";
    a.click();
  });
  copyBtn.addEventListener("click", function () {
    if (navigator.clipboard) navigator.clipboard.writeText(noteText());
  });
  clearBtn.addEventListener("click", function () {
    committed = [];
    render();
  });
})();
