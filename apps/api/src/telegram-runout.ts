// "Кечга қолмай тугайди" сигнали (лаҳм) — cron орқали (16:00). Ишлатиш (api контейнерда):
//   docker compose exec -T api npx tsx src/telegram-runout.ts
// Cron: 0 16 * * * cd /srv/limonariya && docker compose exec -T api npx tsx src/telegram-runout.ts
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "./db/client";
import { products, stockMovements } from "./db/schema";
import { sendTelegram, telegramEnabled } from "./telegram";
import { businessDayBounds, TZ_OFFSET_MS } from "./time";

const HOUR_MS = 60 * 60 * 1000;

function fmtTashkent(d: Date): string {
  const t = new Date(d.getTime() + TZ_OFFSET_MS);
  const hh = String(t.getUTCHours()).padStart(2, "0");
  const mm = String(t.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

async function checkRunout(): Promise<string[]> {
  const now = new Date();
  // businessDayBounds().startUTC = 06:00 Tashkent = 01:00 UTC → 11:00 Tashkent = startUTC + 5h.
  const { startUTC } = businessDayBounds();
  const cutoff11 = new Date(startUTC.getTime() + 5 * HOUR_MS);
  const end23 = new Date(startUTC.getTime() + 17 * HOUR_MS); // 06:00 + 17h = 23:00 Tashkent

  console.log(`[runout] сейчас=${now.toISOString()} 11:00Тошкент=${cutoff11.toISOString()} 23:00Тошкент=${end23.toISOString()}`);

  const hoursElapsed = (now.getTime() - cutoff11.getTime()) / HOUR_MS;
  // 1 соатдан кам — экстраполяция шов-шов маълумотдан (битта сотувдан) бўлиб
  // қолади (rate ноаниқ катта чиқади). Штатда cron 16:00 да ишлайди (hoursElapsed=5) —
  // бу чегара фақат қўлда/эрта қайта ишга туширишдан ҳимоя қилади.
  const MIN_HOURS_ELAPSED = 1;
  if (hoursElapsed < MIN_HOURS_ELAPSED) {
    console.log(`[runout] 11:00дан кейин ${hoursElapsed.toFixed(2)}соат — ҳали кам, экстраполяция ишончли эмас — ўтказиб юборилди`);
    return [];
  }

  const carc = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(inArray(products.name, ["Қўй лаҳм", "Мол лаҳм"]));

  const lines: string[] = [];

  for (const p of carc) {
    const onHandRow = (
      await db
        .select({ s: sql<number>`coalesce(sum(${stockMovements.qty}), 0)` })
        .from(stockMovements)
        .where(eq(stockMovements.productId, p.id))
    )[0];
    const onHandG = Number(onHandRow?.s ?? 0);

    const consumedRow = (
      await db
        .select({ s: sql<number>`coalesce(sum(-${stockMovements.qty}), 0)` })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.productId, p.id),
            lt(stockMovements.qty, 0),
            gte(stockMovements.createdAt, cutoff11),
            lt(stockMovements.createdAt, now),
          ),
        )
    )[0];
    const consumedG = Number(consumedRow?.s ?? 0);

    console.log(
      `[runout] ${p.name}: onHandG=${onHandG} consumedG=${consumedG} hoursElapsed=${hoursElapsed.toFixed(2)}`,
    );

    if (consumedG <= 0 || onHandG <= 0) {
      console.log(`[runout] ${p.name}: экстраполяция учун маълумот йўқ — ўтказиб юборилди`);
      continue;
    }

    const rate = consumedG / hoursElapsed; // г/соат
    const hoursLeft = onHandG / rate;
    const projectedRunout = new Date(now.getTime() + hoursLeft * HOUR_MS);

    console.log(
      `[runout] ${p.name}: rate=${rate.toFixed(1)}г/соат hoursLeft=${hoursLeft.toFixed(2)} projectedRunout=${projectedRunout.toISOString()}`,
    );

    if (projectedRunout < end23) {
      lines.push(`${p.name} соат ~${fmtTashkent(projectedRunout)} да тугайди`);
    }
  }

  return lines;
}

checkRunout()
  .then(async (lines) => {
    if (lines.length === 0) {
      console.log("[runout] нет рисков");
      process.exit(0);
    }
    if (telegramEnabled()) await sendTelegram(lines.join("\n"));
    console.log(`[runout] ${telegramEnabled() ? "юборилди" : "Telegram созланмаган"} · қаторлар: ${lines.length}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error("[runout]", e instanceof Error ? e.message : e);
    process.exit(1);
  });
