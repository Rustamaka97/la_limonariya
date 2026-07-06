"use strict";
// La Limonariya — printer-most (CloPOS'dagi NativeBridge/express o'rniga, shu processda).
// HTTP qabul qiladi (127.0.0.1:agentPort) va stansiya printeriga IP:9100 CP866 ESC/POS yuboradi.
// Kod print-agent POC'dan ko'chirilgan; stansiya xaritasi endi config.json'dan keladi.

const http = require("http");
const net = require("net");
const os = require("os");

let server = null;
let STATIONS = {};
let PORT = 7178;

// ── CP866 kodlash (kirill uchun MAJBURIY) ────────────────────────────────────
const UZ_FALLBACK = {
  "Ў": "У", "ў": "у", "Қ": "К", "қ": "к",
  "Ғ": "Г", "ғ": "г", "Ҳ": "Х", "ҳ": "х",
};
function toCp866(str) {
  const bytes = [];
  for (const ch of String(str)) {
    let c = ch.codePointAt(0);
    if (UZ_FALLBACK[ch] !== undefined) c = UZ_FALLBACK[ch].codePointAt(0);
    if (c < 0x80) { bytes.push(c); continue; }                                  // ASCII
    if (c >= 0x0410 && c <= 0x042f) { bytes.push(c - 0x0410 + 0x80); continue; } // А..Я
    if (c >= 0x0430 && c <= 0x043f) { bytes.push(c - 0x0430 + 0xa0); continue; } // а..п
    if (c >= 0x0440 && c <= 0x044f) { bytes.push(c - 0x0440 + 0xe0); continue; } // р..я
    if (c === 0x0401) { bytes.push(0xf0); continue; }                            // Ё
    if (c === 0x0451) { bytes.push(0xf1); continue; }                            // ё
    if (c === 0x2116) { bytes.push(0xfc); continue; }                            // №
    bytes.push(0x3f);                                                            // ?
  }
  return Buffer.from(bytes);
}

// ── ESC/POS buyruqlari ───────────────────────────────────────────────────────
const ESC = 0x1b, GS = 0x1d;
const CMD = {
  init:     Buffer.from([ESC, 0x40]),
  cp866:    Buffer.from([ESC, 0x74, 0x11]),
  boldOn:   Buffer.from([ESC, 0x45, 0x01]),
  boldOff:  Buffer.from([ESC, 0x45, 0x00]),
  center:   Buffer.from([ESC, 0x61, 0x01]),
  left:     Buffer.from([ESC, 0x61, 0x00]),
  big:      Buffer.from([GS, 0x21, 0x11]),
  normal:   Buffer.from([GS, 0x21, 0x00]),
  feed3:    Buffer.from([0x1b, 0x64, 0x03]),
  cut:      Buffer.from([GS, 0x56, 0x00]),
  beep:     Buffer.from([ESC, 0x42, 0x02, 0x02]),
  cashdraw: Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa]),
  nl:       Buffer.from([0x0a]),
};

function buildReceipt(job) {
  const parts = [CMD.init, CMD.cp866];
  if (job.center) parts.push(CMD.center);
  if (job.title) {
    parts.push(CMD.big, CMD.boldOn, toCp866(job.title), CMD.nl, CMD.normal, CMD.boldOff);
  }
  if (job.text) {
    parts.push(CMD.left);
    for (const line of String(job.text).split("\n")) {
      parts.push(toCp866(line), CMD.nl);
    }
  }
  parts.push(CMD.feed3);
  if (job.beep) parts.push(CMD.beep);
  if (job.cashdraw) parts.push(CMD.cashdraw);
  if (job.cut !== false) parts.push(CMD.cut);
  return Buffer.concat(parts);
}

// ── Printerga xom bayt (net.Socket → IP:9100) ────────────────────────────────
function sendRaw(ip, port, buffer, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let done = false;
    socket.setTimeout(timeout);
    socket.connect(port, ip, () => {
      socket.write(buffer, (err) => {
        if (err) { done = true; socket.destroy(); return reject(err); }
        setTimeout(() => { if (!done) { done = true; socket.end(); resolve({ ok: true, bytes: buffer.length }); } }, 150);
      });
    });
    socket.on("timeout", () => { if (!done) { done = true; socket.destroy(); reject(new Error("Printer timeout: " + ip)); } });
    socket.on("error", (err) => { if (!done) { done = true; socket.destroy(); reject(err); } });
  });
}

function resolveTarget(job) {
  if (job.ip) return { ip: job.ip, port: job.port || 9100 };
  const st = STATIONS[String(job.station || "").toUpperCase()];
  if (!st) throw new Error("Noma'lum stansiya: " + job.station);
  return st;
}

function json(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}

function localIp() {
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const n of ifs[name] || []) {
      if (n.family === "IPv4" && !n.internal) return n.address;
    }
  }
  return "127.0.0.1";
}

async function handler(req, res) {
  if (req.method === "OPTIONS") return json(res, 204, {});
  const url = req.url.split("?")[0];

  if (req.method === "GET" && url === "/health")
    return json(res, 200, { ok: true, agent: "la-limonariya-pos", ip: localIp(), port: PORT, stations: Object.keys(STATIONS) });
  if (req.method === "GET" && url === "/stations")
    return json(res, 200, { stations: STATIONS });

  if (req.method === "POST" && (url === "/print" || url === "/test")) {
    const body = await readBody(req);
    try {
      const job = url === "/test"
        ? { station: body.station || "BAR", center: true, title: "ТЕСТ ЧЕК",
            text: "La Limonariya POS\n--------------------\nСтанция: " + (body.station || "BAR") +
                  "\nВақт: " + new Date().toLocaleString("ru-RU") +
                  "\n--------------------\nПринтер уланди ✓", beep: true, cut: true }
        : body;
      const target = resolveTarget(job);
      const buffer = job.escpos ? Buffer.from(job.escpos, "base64") : buildReceipt(job);
      const r = await sendRaw(target.ip, target.port, buffer);
      return json(res, 200, { success: true, target, ...r });
    } catch (e) {
      return json(res, 500, { success: false, error: e.message });
    }
  }

  json(res, 404, { error: "Not found" });
}

exports.start = function start(cfg) {
  STATIONS = cfg.stations || {};
  PORT = cfg.agentPort || 7178;
  server = http.createServer(handler);
  server.on("error", (e) => console.error("bridge:", e.message));
  server.listen(PORT, () =>
    console.log(`printer-most → http://127.0.0.1:${PORT} (stansiyalar: ${Object.keys(STATIONS).join(", ") || "yo'q"})`),
  );
};

exports.stop = function stop() {
  try { server?.close(); } catch {}
  server = null;
};
