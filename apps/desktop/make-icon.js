"use strict";
// PWA ikonkasidan (icon-512.png) Windows .ico yasaydi + dev oyna uchun icon.png ko'chiradi.
const fs = require("fs");
const path = require("path");
const pngToIco = require("png-to-ico");

const src = path.resolve(__dirname, "../web/public/brand/icon-512.png");
const outDir = path.join(__dirname, "build");

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(src, path.join(__dirname, "icon.png"));
  const buf = await pngToIco(src);
  fs.writeFileSync(path.join(outDir, "icon.ico"), buf);
  console.log("icon.ico + icon.png tayyor");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
