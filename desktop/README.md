# La Limonariya POS terminal (Electron kiosk)

Thin desktop wrapper that opens the LAN web POS fullscreen as a dedicated
cashier terminal. **Standalone — NOT part of the pnpm workspace** (its own
`npm install`), so it never touches the server/api build.

- Loads `config.default.json` → `url` (default `http://192.168.1.4:8080/?terminal`).
- Sends a `LaLimonPOS/<version>` User-Agent → the web app shows the clean terminal
  chrome (☰ menu instead of the 14-tab bar, POS as the default tab).
- Printing is **server-side** (api `escpos.ts` → network printers TCP:9100). This
  wrapper does **not** print — no client bridge.
- `F5` reloads, `Ctrl+Shift+Q` quits.

## Build the .exe (on a Windows machine, or macOS/Linux with wine)

```bash
cd desktop
npm install
# add an icon.png (512×512) next to package.json first
npm run build:win        # → dist/La Limonariya POS Setup <ver>.exe
```

Install the resulting `.exe` on each cashier PC. To point a machine at a
different server, drop a `config.json` into
`%APPDATA%/lalimonariya-pos-terminal/` with `{ "url": "http://<ip>:8080/?terminal" }`.

## No .exe? Use the browser instead

Opening `http://192.168.1.4:8080/?terminal` (or the public URL + `?terminal`) in
any browser gives the same terminal chrome — the `.exe` only adds fullscreen
kiosk lock-down and a double-click launcher.
