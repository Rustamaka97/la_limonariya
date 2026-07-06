"use strict";
// La Limonariya POS — desktop terminal (CloPOS.exe skeletidan aynan ko'chirilgan oqim):
// single-instance → autolaunch → splash → fullscreen oyna → loadURL(server) →
// did-fail-load = offline ekran (avto-retry) → render-process-gone = avto-reload.
// Farqi: CloPOS'dagi C# NativeBridge o'rniga printer-most shu processning o'zida (bridge.js).

const { app, BrowserWindow, Menu, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const bridge = require("./bridge");

const isPackaged = app.isPackaged;

// ── Konfig: exe yonidagi config.json (portable), dev'da papkadagi ─────────────
function loadConfig() {
  // portable NSIS temp'dan ishlaydi — asl exe papkasi PORTABLE_EXECUTABLE_DIR'da
  const dir = isPackaged
    ? (process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath))
    : __dirname;
  const cfgPath = path.join(dir, "config.json");
  const defPath = path.join(__dirname, "config.default.json");
  try {
    if (!fs.existsSync(cfgPath)) fs.copyFileSync(defPath, cfgPath);
    return { ...JSON.parse(fs.readFileSync(defPath, "utf8")), ...JSON.parse(fs.readFileSync(cfgPath, "utf8")), _path: cfgPath };
  } catch (e) {
    return { ...JSON.parse(fs.readFileSync(defPath, "utf8")), _path: cfgPath };
  }
}
const CFG = loadConfig();

// CloPOS bilan bir xil switch'lar
app.commandLine.appendSwitch("disable-http-cache");
app.commandLine.appendSwitch("disable-renderer-backgrounding");

// Web'ga "men desktop terminalman" belgisi — Shell terminal-rejimga o'tadi (toza POS chrome)
app.userAgentFallback = app.userAgentFallback + " LaLimonPOS/" + app.getVersion();

let mainWin = null;
let splashWin = null;

// ── Single instance (CloPOS: requestSingleInstanceLock) ──────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });

  app.on("ready", () => {
    // Windows autostart (CloPOS: auto-launch) — config'dan boshqariladi
    if (isPackaged && CFG.autoStart !== false) {
      app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
    }
    bridge.start(CFG); // printer-most (CloPOS: NativeBridge.bridge.start())
    Menu.setApplicationMenu(null);
    createMainWindow();
  });

  app.on("before-quit", () => bridge.stop());
  app.on("window-all-closed", () => {
    bridge.stop();
    app.quit();
  });

  process.on("uncaughtException", (err) => {
    console.error("uncaughtException:", err);
  });
}

function openSplash() {
  const s = new BrowserWindow({
    width: 420,
    height: 300,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: "#0e4037",
  });
  s.loadFile(path.join(__dirname, "splash.html"));
  // CloPOS: modalTimeout — splash 30s dan ko'p qolib ketmasin
  setTimeout(() => { try { s.destroy(); } catch {} }, 30_000);
  return s;
}

function destroySplash() {
  try { splashWin?.destroy(); } catch {}
  splashWin = null;
}

function createMainWindow() {
  splashWin = openSplash();

  mainWin = new BrowserWindow({
    title: "La Limonariya POS v" + app.getVersion(),
    backgroundColor: "#0e4037",
    show: false,
    fullscreen: isPackaged, // CloPOS: fullscreen faqat packaged'da
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      partition: "persist:lalimon", // CloPOS: persist:app — sessiya saqlanadi
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWin.maximize();

  attachWebContentsListeners(mainWin);
  mainWin.loadURL(CFG.serverUrl);

  mainWin.once("ready-to-show", () => {
    destroySplash();
    mainWin?.show();
  });

  // CloPOS: sahifa title'ni almashtirmasin
  mainWin.on("page-title-updated", (e) => e.preventDefault());

  // Klaviatura: F11 — fullscreen, Ctrl+R — reload, Ctrl+Shift+I — devtools (faqat dev)
  mainWin.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") {
      mainWin.setFullScreen(!mainWin.isFullScreen());
      e.preventDefault();
    } else if (input.control && input.key.toLowerCase() === "r") {
      mainWin.loadURL(CFG.serverUrl);
      e.preventDefault();
    } else if (!isPackaged && input.control && input.shift && input.key.toLowerCase() === "i") {
      mainWin.webContents.toggleDevTools();
      e.preventDefault();
    }
  });

  mainWin.on("closed", () => {
    destroySplash();
    mainWin = null;
  });
}

function attachWebContentsListeners(win) {
  // CloPOS: did-fail-load → xabar; bizda — brendli offline ekran, o'zi qayta uladi
  win.webContents.on("did-fail-load", (event, code, desc) => {
    destroySplash();
    if (code === -3) return; // ERR_ABORTED — foydalanuvchi navigatsiyasi, e'tiborsiz
    win.loadFile(path.join(__dirname, "offline.html"), {
      query: { u: CFG.serverUrl, e: `${code} ${desc}` },
    });
  });

  win.webContents.on("did-finish-load", () => {
    destroySplash();
    win.webContents.setZoomFactor(1);
  });

  // CloPOS: render-process-gone → avto-reload (krash tiklanishi)
  win.webContents.on("render-process-gone", async (e, details) => {
    console.error("Renderer gone:", details.reason);
    await new Promise((r) => setTimeout(r, 1000));
    if (mainWin) {
      mainWin.loadURL(CFG.serverUrl);
    } else {
      createMainWindow();
    }
  });
}
