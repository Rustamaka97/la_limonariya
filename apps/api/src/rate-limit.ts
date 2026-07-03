import type { Context as HonoContext } from "hono";

// ── PIN login brute-force ҳимояси ─────────────────────────────────────────
// 4 рақамли PIN = атиги 10 000 вариант. Ҳимоясиз скрипт секундлар ичида
// топади. Иккита босқич, ИККАЛАСИ ҳам verify'дан ОЛДИН рад этади (параллел
// ҳужумда тўғри PIN'ни ҳам ушлаб қолиш учун):
//   1) per-IP — битта қурилма кўп марта хато → фақат ЎША IP блок (LAN'да ҳар
//      қурилманинг ўз IP'си, бошқалар ишлайверади).
//   2) глобал backstop — барча IP бўйича жами хато → қисқа глобал блок. Бу
//      X-Forwarded-For'ни ротация қилиб per-IP'ни айланиб ўтишни тўхтатади.
// Норма (14 ходим, баъзан адашиш) ҳеч қачон бу чегараларга етмайди.

const WINDOW_MS = 15 * 60_000;
const PER_IP_MAX = 10; // 15 дақиқада хато уриниш → блок
const PER_IP_LOCK_MS = 5 * 60_000; // ×2 ҳар қайта тушганда
const PER_IP_LOCK_CAP = 60 * 60_000;
const GLOBAL_MAX = 60; // барча IP бўйича жами → глобал блок
const GLOBAL_LOCK_MS = 2 * 60_000;
const MAX_ENTRIES = 10_000; // хотира чегараси (IP-ротация ҳужумида)

type Entry = { fails: number; windowStart: number; lockUntil: number; trips: number };

const byIp = new Map<string, Entry>();
const global: Entry = { fails: 0, windowStart: 0, lockUntil: 0, trips: 0 };

function roll(e: Entry, now: number): void {
  if (now - e.windowStart > WINDOW_MS) {
    e.fails = 0;
    e.windowStart = now;
  }
}

function prune(now: number): void {
  if (byIp.size <= MAX_ENTRIES) return;
  for (const [ip, e] of byIp) {
    if (e.lockUntil <= now && now - e.windowStart > WINDOW_MS) byIp.delete(ip);
  }
}

// Блокланган бўлса — қолган ms, акс ҳолда 0.
export function loginBlockedFor(ip: string, now: number): number {
  if (global.lockUntil > now) return global.lockUntil - now;
  const e = byIp.get(ip);
  if (e && e.lockUntil > now) return e.lockUntil - now;
  return 0;
}

export function recordLoginFail(ip: string, now: number): void {
  roll(global, now);
  global.fails++;
  if (global.fails >= GLOBAL_MAX) {
    global.lockUntil = now + GLOBAL_LOCK_MS;
    global.fails = 0;
    global.windowStart = now;
  }

  let e = byIp.get(ip);
  if (!e) {
    e = { fails: 0, windowStart: now, lockUntil: 0, trips: 0 };
    byIp.set(ip, e);
  }
  roll(e, now);
  e.fails++;
  if (e.fails >= PER_IP_MAX) {
    e.trips++;
    e.lockUntil = now + Math.min(PER_IP_LOCK_CAP, PER_IP_LOCK_MS * 2 ** (e.trips - 1));
    e.fails = 0;
    e.windowStart = now;
  }
  prune(now);
}

export function recordLoginSuccess(ip: string): void {
  byIp.delete(ip);
}

// Клиент IP: Caddy reverse_proxy X-Forwarded-For'га реал peer'ни қўшади;
// leftmost = клиент. XFF йўқ бўлса (host dev) — socket манзили.
export function clientIp(c: HonoContext): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } })
    ?.incoming;
  return incoming?.socket?.remoteAddress ?? "unknown";
}

// Тест учун (ички ҳолатни тозалаш).
export function _resetRateLimit(): void {
  byIp.clear();
  global.fails = 0;
  global.windowStart = 0;
  global.lockUntil = 0;
  global.trips = 0;
}
