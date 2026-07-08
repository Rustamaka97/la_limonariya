// La Limonariya POS terminal — thin Electron kiosk.
// Loads the LAN web POS fullscreen with a UA that marks it as a terminal, so the
// web app renders the clean terminal chrome (Shell isTerminal → ☰ menu, P3.6).
// Printing stays SERVER-SIDE (escpos.ts → TCP:9100); no client print bridge.
const { app, BrowserWindow, globalShortcut } = require("electron");
const fs = require("fs");
const path = require("path");

function loadConfig() {
  const def = JSON.parse(
    fs.readFileSync(path.join(__dirname, "config.default.json"), "utf8"),
  );
  // Optional per-machine override at %APPDATA%/lalimonariya-pos-terminal/config.json
  try {
    const userPath = path.join(app.getPath("userData"), "config.json");
    return { ...def, ...JSON.parse(fs.readFileSync(userPath, "utf8")) };
  } catch {
    return def;
  }
}

let win;
function createWindow() {
  const cfg = loadConfig();
  win = new BrowserWindow({
    fullscreen: cfg.fullscreen !== false,
    kiosk: cfg.kiosk === true,
    autoHideMenuBar: true,
    backgroundColor: "#0e4037",
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  const ua = `${win.webContents.getUserAgent()} LaLimonPOS/${app.getVersion()}`;
  const showOffline = () =>
    win.loadFile(path.join(__dirname, "offline.html")).catch(() => {});

  win.webContents.on("did-fail-load", showOffline);
  win.once("ready-to-show", () => win.show());
  win.loadURL(cfg.url, { userAgent: ua }).catch(showOffline);
}

app.whenReady().then(() => {
  createWindow();
  // F5 = reload (e.g. after a network blip); Ctrl+Shift+Q = quit the terminal.
  globalShortcut.register("F5", () => win && win.reload());
  globalShortcut.register("CommandOrControl+Shift+Q", () => app.quit());
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
