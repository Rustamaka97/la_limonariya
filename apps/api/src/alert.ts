// Failures must not be silent: always log structured, and ping the director's
// Telegram (reusing telegram.ts — same TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_IDS as
// digest/signals) with a throttle so a crash loop can't flood the chat.
import { sendTelegram, telegramEnabled } from "./telegram";

let lastSentAt = 0;
const MIN_GAP_MS = 60_000;

export function reportError(source: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(`[alert] ${source}: ${message}`, stack ?? "");

  if (!telegramEnabled()) return;
  const now = Date.now();
  if (now - lastSentAt < MIN_GAP_MS) return;
  lastSentAt = now;

  void sendTelegram(`🚨 Limonariya API xatosi\n${source}: ${message}`);
}
