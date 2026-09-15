/**
 * Caption Note — Electron main process
 *
 * Loads the existing static UI (index.html / app.js / styles.css) and enables
 * getDisplayMedia so the page can share a captions window or Entire Screen
 * for local Tesseract OCR. Prefer Electron over Tauri for this MVP because
 * Chromium's displayMedia + desktopCapturer path is more reliable for
 * screen capture on macOS than WKWebView/WebView2 getDisplayMedia.
 */

const { app, BrowserWindow, session, desktopCapturer, shell } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 980,
    height: 840,
    minWidth: 640,
    minHeight: 520,
    title: "Caption Note",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Needed so the page can call getDisplayMedia / mediaDevices.
      // No preload; renderer stays a plain web page.
    },
  });

  win.setMenuBarVisibility(false);

  win.once("ready-to-show", () => {
    win.show();
  });

  // Keep the window title fixed even if the document title changes.
  win.on("page-title-updated", (event) => {
    event.preventDefault();
    win.setTitle("Caption Note");
  });

  // Open any target=_blank links in the OS browser, not a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // loadFile → secure context (required by getDisplayMedia). Static assets
  // (styles.css, app.js) resolve relative to index.html. Tesseract CDN still
  // needs network on first OCR.
  win.loadFile(path.join(__dirname, "..", "index.html"));
}

function setupDisplayMedia() {
  // Prefer the OS / Chromium system picker when available. Fall back to
  // granting a screen source so getDisplayMedia does not hang on platforms
  // without a system picker.
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 0, height: 0 },
        });
        if (!sources.length) {
          callback({});
          return;
        }
        const screen =
          sources.find((s) => String(s.id).startsWith("screen:")) || sources[0];
        callback({ video: screen });
      } catch (err) {
        console.error("setDisplayMediaRequestHandler failed:", err);
        callback({});
      }
    },
    { useSystemPicker: true }
  );
}

app.whenReady().then(() => {
  setupDisplayMedia();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
