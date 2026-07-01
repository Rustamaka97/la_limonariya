#!/usr/bin/env node
// La Limonariya print-agent — касса компьютерида ишлайдиган кичик сервис.
// Веб-иловадан localhost:9110 га келган чек/тикетни ESC/POS байтларга айлантириб,
// термо-принтерга TCP 9100 (raw jetdirect) орқали юборади. Zero-dependency.
//
// Ишга тушириш:  node print-agent.mjs
// Созлаш:        шу папкадаги config.json (namuna: config.example.json)
// Принтер usb бўлса — Windows'да принтерни "Generic / Text Only" қилиб share
// қилинг ва config'da {"mode":"windows","printerName":"POS58"} ишлатинг.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, unlinkSync } from "node:fs";

const DIR = dirname(fileURLToPath(import.meta.url));
let config = {
  listenPort: 9110,
  mode: "tcp", // "tcp" (network printer) | "windows" (shared printer via copy /b)
  printerHost: "192.168.0.100",
  printerPort: 9100,
  printerName: "", // windows mode: shared printer name
  width: 80, // 58 | 80 (mm) → 32 | 48 chars per line (Font A)
};
try {
  config = { ...config, ...JSON.parse(readFileSync(join(DIR, "config.json"), "utf8")) };
} catch {
  console.log("[print-agent] config.json topilmadi — default sozlamalar bilan");
}
const CHARS_PER_LINE = config.width === 58 ? 32 : 48;

// --- CP866 (DOS Cyrillic) encoder. O'zbek kirill harflari CP866'da yo'q —
// eng yaqin rus harfiga tushiriladi (chek o'qilishi buzilmaydi).
const UZ_FALLBACK = {
  "ў": "у", "Ў": "У", "қ": "к", "Қ": "К", "ғ": "г", "Ғ": "Г", "ҳ": "х", "Ҳ": "Х",
  "ё": "е", "Ё": "Е", "’": "'", "‘": "'", "—": "-", "–": "-", "№": "N",
};
function cp866(str) {
  const out = [];
  for (let ch of str) {
    ch = UZ_FALLBACK[ch] ?? ch;
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c >= 0x410 && c <= 0x43f) out.push(c - 0x410 + 0x80); // А-п
    else if (c >= 0x440 && c <= 0x44f) out.push(c - 0x440 + 0xe0); // р-я
    else out.push(0x3f); // ?
  }
  return Buffer.from(out);
}

const ESC = 0x1b;
const GS = 0x1d;
const INIT = Buffer.from([ESC, 0x40]); // reset
const CODEPAGE_866 = Buffer.from([ESC, 0x74, 17]); // ESC t 17 = CP866 (ko'p printerlarda)
const ALIGN = (n) => Buffer.from([ESC, 0x61, n]); // 0 left 1 center 2 right
const BOLD = (on) => Buffer.from([ESC, 0x45, on ? 1 : 0]);
const SIZE = (n) => Buffer.from([GS, 0x21, n ? 0x11 : 0x00]); // double w+h
const CUT = Buffer.from([GS, 0x56, 66, 3]); // partial cut + feed
const NL = Buffer.from([0x0a]);

// lines: [{text, align:'left'|'center'|'right', bold, big, hr, pair:[l,r]}]
function render(lines) {
  const bufs = [INIT, CODEPAGE_866];
  for (const ln of lines) {
    if (ln.hr) {
      bufs.push(ALIGN(0), cp866("-".repeat(CHARS_PER_LINE)), NL);
      continue;
    }
    let text = ln.text ?? "";
    if (ln.pair) {
      const [l, r] = ln.pair;
      const pad = Math.max(1, CHARS_PER_LINE - l.length - r.length);
      text = l + " ".repeat(pad) + r;
    }
    bufs.push(
      ALIGN(ln.align === "center" ? 1 : ln.align === "right" ? 2 : 0),
      BOLD(!!ln.bold),
      SIZE(!!ln.big),
      cp866(text),
      NL,
    );
  }
  bufs.push(SIZE(false), BOLD(false), NL, NL, NL, CUT);
  return Buffer.concat(bufs);
}

function printTcp(data) {
  return new Promise((resolve, reject) => {
    const sock = connect(config.printerPort, config.printerHost, () => {
      sock.end(data, () => resolve());
    });
    sock.setTimeout(5000, () => {
      sock.destroy();
      reject(new Error("printer timeout"));
    });
    sock.on("error", reject);
  });
}

function printWindows(data) {
  // shared printer: copy /b file \\localhost\NAME
  return new Promise((resolve, reject) => {
    const tmp = join(tmpdir(), `limon-chek-${Date.now()}.bin`);
    writeFileSync(tmp, data);
    execFile(
      "cmd.exe",
      ["/c", "copy", "/b", tmp, `\\\\localhost\\${config.printerName}`],
      (err) => {
        try { unlinkSync(tmp); } catch {}
        if (err) reject(err);
        else resolve();
      },
    );
  });
}

const server = createServer((req, res) => {
  // faqat kassa kompyuterining o'zidan (localhost) so'rov qabul qilinadi
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, width: config.width, mode: config.mode }));
    return;
  }
  if (req.method === "POST" && req.url === "/print") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { lines } = JSON.parse(body);
        if (!Array.isArray(lines) || lines.length === 0) throw new Error("lines bo'sh");
        const data = render(lines);
        if (config.mode === "windows") await printWindows(data);
        else await printTcp(data);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        console.log(`[print-agent] chop etildi (${lines.length} qator)`);
      } catch (e) {
        console.error("[print-agent] xato:", e.message);
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }
  res.writeHead(404).end();
});

server.listen(config.listenPort, "127.0.0.1", () => {
  console.log(
    `[print-agent] tayyor: http://127.0.0.1:${config.listenPort} → ${
      config.mode === "windows" ? `\\\\localhost\\${config.printerName}` : `${config.printerHost}:${config.printerPort}`
    } (${config.width}mm)`,
  );
});
