// Кун охири Telegram хулосаси — cron орқали (23:00). Ишлатиш (api контейнерда):
//   docker compose exec -T api npx tsx src/telegram-digest.ts
// Cron: 0 23 * * * cd /srv/limonariya && docker compose exec -T api npx tsx src/telegram-digest.ts
import { sendDailyDigest } from "./router";

sendDailyDigest()
  .then((r) => {
    console.log(`[digest] ${r.ok ? "юборилди" : "Telegram созланмаган"} · тешик: ${r.holes}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error("[digest]", e instanceof Error ? e.message : e);
    process.exit(1);
  });
