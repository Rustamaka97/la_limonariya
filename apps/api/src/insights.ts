// Human-readable Telegram insights — W4 smart layer (4.1/4.2/4.5). Pure functions:
// no DB, no side effects. Callers (router.ts sendDailyDigest) do all the querying.

export type DishMarginDay = { productId: string; name: string; dayKey: string; marginPct: number };

export function marginDropInsight(
  history: DishMarginDay[],
  daysOldToNew: [string, string, string],
): string | null {
  const [day0, day1, day2] = daysOldToNew;
  const byProduct = new Map<string, Map<string, DishMarginDay>>();
  for (const h of history) {
    const m = byProduct.get(h.productId) ?? new Map<string, DishMarginDay>();
    m.set(h.dayKey, h);
    byProduct.set(h.productId, m);
  }
  let worst: { name: string; d0: number; d1: number; d2: number; drop: number } | null = null;
  for (const [, m] of byProduct) {
    const r0 = m.get(day0);
    const r1 = m.get(day1);
    const r2 = m.get(day2);
    if (!r0 || !r1 || !r2) continue;
    if (!(r0.marginPct > r1.marginPct && r1.marginPct > r2.marginPct)) continue;
    const drop = r0.marginPct - r2.marginPct;
    if (drop < 5) continue;
    // Тенг drop'да исм бўйича детерминистик танлов — history массиви қандай
    // тартибда келишидан (DB query'да ORDER BY йўқ) натижа боғлиқ бўлмаслиги учун.
    if (!worst || drop > worst.drop || (drop === worst.drop && r0.name < worst.name)) {
      worst = { name: r0.name, d0: r0.marginPct, d1: r1.marginPct, d2: r2.marginPct, drop };
    }
  }
  if (!worst) return null;
  const d0 = Math.round(worst.d0);
  const d1 = Math.round(worst.d1);
  const d2 = Math.round(worst.d2);
  return `${worst.name} маржаси 3 кун кетма-кет тушмоқда (${d0}% → ${d1}% → ${d2}%) — нархни кўтаринг ёки харидни текширинг`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return Number.isInteger(mid)
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[Math.floor(mid)] ?? 0);
}

export function buildPurchaseForecast(
  weekdayName: string,
  qoyHistoryKg: number[],
  molHistoryKg: number[],
): string | null {
  const qoyKg = qoyHistoryKg.length >= 4 ? Math.round(median(qoyHistoryKg) * 10) / 10 : null;
  const molKg = molHistoryKg.length >= 4 ? Math.round(median(molHistoryKg) * 10) / 10 : null;
  if (qoyKg == null && molKg == null) return null;
  const parts: string[] = [];
  if (qoyKg != null) parts.push(`~${qoyKg} кг қўй`);
  if (molKg != null) parts.push(`~${molKg} кг мол`);
  return `📦 Эртага (${weekdayName}): ${parts.join(", ")} керак бўлади (тахминий)`;
}

export type UnderDeliveryItem = {
  carcassType: "qoy" | "mol";
  weightG: number;
  sumPartsG: number;
  missingG: number;
  lossPct: number;
};

const CARCASS_LABEL: Record<"qoy" | "mol", string> = { qoy: "Қўй", mol: "Мол" };

export function humanizeUnderDelivery(items: UnderDeliveryItem[]): string[] {
  return items.map((it) => {
    const label = CARCASS_LABEL[it.carcassType];
    const weightKg = (it.weightG / 1000).toFixed(1);
    const sumKg = (it.sumPartsG / 1000).toFixed(1);
    const missingKg = (it.missingG / 1000).toFixed(1);
    return `🚩 ${label}: бозорчи ${weightKg}кг деди, обвалка ${sumKg}кг кўрди — ${missingKg}кг фарқ (${it.lossPct}%)`;
  });
}

export type PriceSpikeItem = {
  carcassType: "qoy" | "mol";
  latestPrice: number;
  medianPrice: number;
  pct: number;
};

export function humanizePriceSpike(items: PriceSpikeItem[]): string[] {
  const som = (n: number) => n.toLocaleString("ru-RU");
  return items.map((it) => {
    const label = CARCASS_LABEL[it.carcassType];
    return `💸 ${label} нархи ${it.pct}% ошди (охирги: ${som(it.latestPrice)}, медиана: ${som(it.medianPrice)})`;
  });
}

export type GrammLeakItem = {
  carcassType: "qoy" | "mol";
  marinatedG: number;
  usedG: number;
  leakG: number;
  leakPct: number;
};

export function humanizeGrammLeak(items: GrammLeakItem[]): string[] {
  return items.map((it) => {
    const label = CARCASS_LABEL[it.carcassType];
    const marinatedKg = (it.marinatedG / 1000).toFixed(1);
    const usedKg = (it.usedG / 1000).toFixed(1);
    return `🍢 ${label} сихда фарқ: маринад ${marinatedKg}кг, сотилган-меъёр ${usedKg}кг — ${it.leakPct}% фарқ`;
  });
}
