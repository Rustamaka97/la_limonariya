// Node тест (tsx): pure insight/humanizer functions. Run: pnpm exec tsx src/insights.test.ts
import {
  buildPurchaseForecast,
  humanizeGrammLeak,
  humanizePriceSpike,
  humanizeUnderDelivery,
  marginDropInsight,
  type DishMarginDay,
  type GrammLeakItem,
  type PriceSpikeItem,
  type UnderDeliveryItem,
} from "./insights";

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error("✗", msg);
  }
}

// marginDropInsight
const day = (dayKey: string, marginPct: number, productId = "p1", name = "Шашлик"): DishMarginDay => ({
  productId,
  name,
  dayKey,
  marginPct,
});

ok(marginDropInsight([], ["d0", "d1", "d2"]) === null, "empty history → null");

const dropping: DishMarginDay[] = [
  day("d0", 40),
  day("d1", 33),
  day("d2", 25),
];
const dropInsight = marginDropInsight(dropping, ["d0", "d1", "d2"]);
ok(dropInsight !== null, "3-day strict drop ≥5pp → insight returned");
ok(dropInsight !== null && dropInsight.includes("Шашлик"), "insight names the dish");
ok(dropInsight !== null && dropInsight.includes("40%") && dropInsight.includes("25%"), "insight includes rounded margins");

const flat: DishMarginDay[] = [day("d0", 40), day("d1", 40), day("d2", 40)];
ok(marginDropInsight(flat, ["d0", "d1", "d2"]) === null, "flat margin → no insight");

const smallDrop: DishMarginDay[] = [day("d0", 40), day("d1", 38), day("d2", 37)];
ok(marginDropInsight(smallDrop, ["d0", "d1", "d2"]) === null, "drop <5pp → no insight");

const nonMonotonic: DishMarginDay[] = [day("d0", 40), day("d1", 45), day("d2", 30)];
ok(marginDropInsight(nonMonotonic, ["d0", "d1", "d2"]) === null, "non-monotonic (up then down) → no insight");

const missingDay: DishMarginDay[] = [day("d0", 40), day("d2", 20)];
ok(marginDropInsight(missingDay, ["d0", "d1", "d2"]) === null, "missing middle day → no insight");

const worstOfTwo: DishMarginDay[] = [
  day("d0", 40, "p1", "Лагман"),
  day("d1", 33, "p1", "Лагман"),
  day("d2", 25, "p1", "Лагман"),
  day("d0", 50, "p2", "Норин"),
  day("d1", 30, "p2", "Норин"),
  day("d2", 10, "p2", "Норин"),
];
const worstInsight = marginDropInsight(worstOfTwo, ["d0", "d1", "d2"]);
ok(worstInsight !== null && worstInsight.includes("Норин"), "picks dish with the biggest drop (40pp > 15pp)");

// buildPurchaseForecast
ok(buildPurchaseForecast("душанба", [], []) === null, "no history at all → null");
ok(buildPurchaseForecast("душанба", [1, 2, 3], []) === null, "fewer than 4 samples → null");

const qoyOnly = buildPurchaseForecast("душанба", [10, 12, 11, 13], []);
ok(qoyOnly !== null && qoyOnly.includes("қўй") && !qoyOnly.includes("мол"), "qoy-only forecast omits мол");
ok(qoyOnly !== null && qoyOnly.includes("душанба"), "forecast names the weekday");

const both = buildPurchaseForecast("жума", [10, 12, 11, 13], [20, 22, 21, 23]);
ok(both !== null && both.includes("қўй") && both.includes("мол"), "both carcasses present when both have ≥4 samples");

// humanizeUnderDelivery
const underItems: UnderDeliveryItem[] = [
  { carcassType: "qoy", weightG: 50000, sumPartsG: 45000, missingG: 5000, lossPct: 10 },
];
const underLines = humanizeUnderDelivery(underItems);
ok(underLines.length === 1, "one item → one line");
ok(underLines[0]!.includes("Қўй") && underLines[0]!.includes("50.0кг") && underLines[0]!.includes("5.0кг"), "under-delivery line has label + weights");
ok(humanizeUnderDelivery([]).length === 0, "empty items → empty lines");

// humanizePriceSpike
const spikeItems: PriceSpikeItem[] = [
  { carcassType: "mol", latestPrice: 90000, medianPrice: 70000, pct: 29 },
];
const spikeLines = humanizePriceSpike(spikeItems);
ok(spikeLines.length === 1 && spikeLines[0]!.includes("Мол") && spikeLines[0]!.includes("29%"), "price spike line has label + pct");

// humanizeGrammLeak
const leakItems: GrammLeakItem[] = [
  { carcassType: "qoy", marinatedG: 10000, usedG: 8000, leakG: 2000, leakPct: 20 },
];
const leakLines = humanizeGrammLeak(leakItems);
ok(leakLines.length === 1 && leakLines[0]!.includes("Қўй") && leakLines[0]!.includes("20%"), "gramm leak line has label + pct");

console.log(`insights: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
