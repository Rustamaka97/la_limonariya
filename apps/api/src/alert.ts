// Minimal failure-isn't-silent layer: always logs structured, optionally pings
// a Telegram chat if ALERT_TELEGRAM_BOT_TOKEN + ALERT_TELEGRAM_CHAT_ID are set
// (create a bot via @BotFather, add it to a chat, put the token/chat id in .env
// — 2 minutes, no paid service). Without those env vars, still logs to stdout
// (visible via `docker compose logs api`), which is strictly better than the
// previous silent-failure state.

const botToken = process.env.ALERT_TELEGRAM_BOT_TOKEN;
const chatId = process.env.ALERT_TELEGRAM_CHAT_ID;

let lastSentAt = 0;
const MIN_GAP_MS = 60_000; // don't spam the chat on a crash loop

// Fire-and-forget Telegram message to the configured chat. Returns false when
// Telegram isn't configured so callers (digest) can decide whether to retry later.
export function sendTelegram(text: string): boolean {
  if (!botToken || !chatId) return false;
  fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch((e) => {
    console.error("[alert] telegram send failed:", e instanceof Error ? e.message : e);
  });
  return true;
}

export function reportError(source: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(`[alert] ${source}: ${message}`, stack ?? "");

  const now = Date.now();
  if (now - lastSentAt < MIN_GAP_MS) return;
  lastSentAt = now;

  sendTelegram(`🚨 Limonariya API xatosi\n${source}: ${message}`);
}
