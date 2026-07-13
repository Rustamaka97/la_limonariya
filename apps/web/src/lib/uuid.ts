// UUID v4 — БАРЧА контекстда ишлайди (HTTPS, localhost ВА оддий HTTP LAN).
// `crypto.randomUUID()` фақат secure-context'да (HTTPS/localhost) мавжуд —
// зал-сервери HTTP `192.168.1.x:8080` да у ЙЎҚ ва throw қилади. `crypto.
// getRandomValues` эса ҳамма жойда бор, шунга fallback шунга асосланади.
export function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10 (RFC 4122)
  let s = "";
  for (let i = 0; i < 16; i++) {
    s += b[i]!.toString(16).padStart(2, "0");
    if (i === 3 || i === 5 || i === 7 || i === 9) s += "-";
  }
  return s;
}
