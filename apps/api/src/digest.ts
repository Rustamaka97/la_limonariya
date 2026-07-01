// Кунлик Telegram digest — директор чўнтагида кун якуни. Reuses the same
// aggregation the Аналитика screen shows (financeForWindow/computeSignals), so
// bot and UI can never disagree. Send time: DIGEST_TIME env ("HH:MM" Tashkent
// wall clock, default 22:30). Last-sent day is persisted in app_meta so a
// container restart can't double-send the same business day.
import { eq } from "drizzle-orm";
import { sendTelegram } from "./alert";
import { db } from "./db/client";
import { appMeta } from "./db/schema";
import {
  computeSignals,
  debtTotals,
  financeForWindow,
  stockableOnHand,
} from "./router";
import { businessDayBounds } from "./time";

const TZ_OFFSET_MS = 5 * 60 * 60 * 1000; // Asia/Tashkent, no DST
const META_KEY = "digest_last_day";

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");

export async function buildDigestText(): Promise<string> {
  const { startUTC, endUTC, dayKey } = businessDayBounds();
  const fin = await financeForWindow(startUTC, endUTC);
  const sig = await computeSignals();
  const { supplierTotal, guestTotal } = await debtTotals();
  const lowStock = (await stockableOnHand()).filter((p) => p.onHand < 0).length;

  const lines: string[] = [
    `🍋 Лимонария — кун якуни (${dayKey})`,
    `💰 Тушум: ${fmt(fin.revenue)} so'm (${fin.checks} чек · ўртача ${fmt(fin.avgCheck)})`,
    `📈 Соф фойда: ${fmt(fin.sofFoyda)}${fin.cogsPartial ? " (COGS қисман)" : ""}`,
    `🥩 COGS: ${fmt(fin.cogs)} · Харажат: ${fmt(fin.opex)} · Солиқ: ${fmt(fin.cardTax)}`,
  ];
  if (fin.ownerDraw > 0) lines.push(`👤 Эга олди: ${fmt(fin.ownerDraw)} (фойдага кирмайди)`);

  const flags: string[] = [];
  if (sig.obvalkaFlags.length) flags.push(`обвалка ${sig.obvalkaFlags.length}`);
  if (sig.priceSpikes.length) flags.push(`гўшт нархи ${sig.priceSpikes.length}`);
  if (sig.cashVariance && sig.cashVariance.variance !== 0)
    flags.push(`касса ${fmt(sig.cashVariance.variance)}`);
  if (sig.breakEvenFlag) flags.push("кеча break-even остида");
  if (sig.shortagePattern.length) flags.push(`такрорий камомад ${sig.shortagePattern.length}`);
  if (sig.compFlag) flags.push(`текин ${fmt(sig.compToday)}`);
  if (sig.staleOrders.length) flags.push(`очиқ стол ${sig.staleOrders.length}`);
  if (sig.removalTrend.length) flags.push(`ўчириш тренди ${sig.removalTrend.length}`);
  if (sig.expiryFlags.length) flags.push(`муддат ${sig.expiryFlags.length}`);
  if (sig.skewerFlags.length) flags.push(`сих грамм ${sig.skewerFlags.length}`);
  if (sig.vitrinaMismatch.length) flags.push(`витрина фарқи ${sig.vitrinaMismatch.length}`);
  lines.push(flags.length ? `🚩 Сигналлар: ${flags.join(" · ")}` : "🟢 Сигнал йўқ");

  if (lowStock > 0) lines.push(`📉 Манфий қолдиқ: ${lowStock} маҳсулот`);
  lines.push(`🤝 Қарз: биз тўлаймиз ${fmt(supplierTotal)} · бизга қарз ${fmt(guestTotal)}`);
  return lines.join("\n");
}

async function lastSentDay(): Promise<string | null> {
  const row = (
    await db.select().from(appMeta).where(eq(appMeta.key, META_KEY)).limit(1)
  )[0];
  return row?.value ?? null;
}

async function markSent(dayKey: string): Promise<void> {
  await db
    .insert(appMeta)
    .values({ key: META_KEY, value: dayKey })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: dayKey } });
}

// Minute tick instead of a cron dep: fires when Tashkent wall clock passes the
// configured time and today's business day hasn't been sent yet. ">= target"
// (not "==") so a tick lost to restart/downtime still sends on the next tick.
export function startDigestScheduler(): void {
  const conf = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(process.env.DIGEST_TIME ?? "22:30");
  const targetMin = conf ? Number(conf[1]) * 60 + Number(conf[2]) : 22 * 60 + 30;

  setInterval(async () => {
    try {
      const tash = new Date(Date.now() + TZ_OFFSET_MS);
      const nowMin = tash.getUTCHours() * 60 + tash.getUTCMinutes();
      // business day cuts at 06:00 — send window is [target .. 06:00 next cut)
      if (nowMin < targetMin && nowMin >= 6 * 60) return;
      const { dayKey } = businessDayBounds();
      if ((await lastSentDay()) === dayKey) return;
      const text = await buildDigestText();
      if (sendTelegram(text)) {
        await markSent(dayKey);
        console.log(`[digest] sent for ${dayKey}`);
      }
    } catch (e) {
      console.error("[digest] tick failed:", e instanceof Error ? e.message : e);
    }
  }, 60_000);
}
