// Telegram push — директорга критик сигнал + кун охири хулоса. Токен/чатлар
// муҳитдан (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_IDS=id1,id2). Токен — СИР (env, репога эмас).
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHATS = (process.env.TELEGRAM_CHAT_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function telegramEnabled(): boolean {
  return Boolean(TOKEN && CHATS.length);
}

// Барча чатга юборади; ҲЕҚ ҚАЧОН reject қилмайди (ички catch). API'да
// `void sendTelegram(...)` — блокламайди; cron'да `await` — юборилишини кутади.
export async function sendTelegram(text: string): Promise<void> {
  if (!TOKEN || CHATS.length === 0) return;
  await Promise.all(
    CHATS.map((chatId) =>
      fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      })
        .then(async (r) => {
          if (!r.ok) console.error("[telegram]", r.status, await r.text().catch(() => ""));
        })
        .catch((e) => console.error("[telegram]", e instanceof Error ? e.message : e)),
    ),
  );
}
