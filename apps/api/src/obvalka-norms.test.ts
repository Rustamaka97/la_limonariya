// Node тест (tsx): data-informed norm math (v2, tighten-only). Run: pnpm exec tsx src/obvalka-norms.test.ts
import {
  bandsFromCarcasses,
  intersectBand,
  mad,
  median,
  NORM_MIN_SAMPLES,
  normBand,
  type CleanCarcass,
} from "./obvalka-norms";

let pass = 0;
let fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error("✗", msg);
  }
}

// median / mad
ok(median([]) === 0, "median([]) = 0");
ok(median([3, 1, 2]) === 2, "median odd = 2");
ok(median([1, 2, 3, 4]) === 2.5, "median even = 2.5");
ok(mad([1, 2, 3, 4, 5]) === 1, "mad([1..5]) = 1");
ok(mad([10, 10, 10]) === 0, "mad constant = 0");

// normBand — consistent samples, floorAbs=1.5, INWARD rounding (ceil low, floor high)
const tight = normBand([24, 24, 24, 24, 24]);
ok(tight.n === 5, "band.n counts samples");
ok(tight.median === 24, "band.median = 24");
ok(tight.mad === 0, "band.mad = 0 for constant");
// med 24, half 1.5 → [22.5,25.5] → ceil 23 .. floor 25
ok(tight.minPct === 23 && tight.maxPct === 25, "inward-rounded floor band 24 → 23..25");
ok(tight.maxPct - tight.minPct >= 1, "band never collapses");

// no floorRel: high-yield part is NOT given a 0.12·median-wide blind spot
const high = normBand([35, 35, 35, 35, 35]);
ok(high.minPct === 34 && high.maxPct === 36, "high-yield 35 → 34..36 (no relative floor)");

// spread widens vs tight
const wide = normBand([20, 22, 24, 26, 28, 30, 18]);
ok(wide.maxPct - wide.minPct > tight.maxPct - tight.minPct, "spread widens band");

// min clamped ≥ 0
const low = normBand([1, 1, 1, 1, 1]);
ok(low.minPct >= 0, "minPct clamped ≥ 0");

// bandsFromCarcasses — ONE sample per (carcass, partType): split rows are combined
const carcasses: CleanCarcass[] = [
  {
    weightG: 10000,
    parts: [
      { partTypeId: "A", weightG: 2000 }, // A split across
      { partTypeId: "A", weightG: 2000 }, // two rows → combined 40%
      { partTypeId: "B", weightG: 1000 }, // 10%
      { partTypeId: null, weightG: 500 }, // ignored
    ],
  },
  {
    weightG: 10000,
    parts: [
      { partTypeId: "A", weightG: 4000 }, // 40% (single row)
      { partTypeId: "B", weightG: 1000 }, // 10%
    ],
  },
  { weightG: 0, parts: [{ partTypeId: "A", weightG: 999 }] }, // skipped
];
const bands = bandsFromCarcasses(carcasses);
ok(bands.size === 2, "only A and B (null + zero-weight ignored)");
ok(bands.get("A")!.n === 2, "A has 2 samples — split rows combined, NOT counted twice");
ok(bands.get("A")!.median === 40, "A combined yield 40% (2000+2000)/10000, not 20%");
ok(bands.get("B")!.median === 10, "B median 10%");

// intersectBand — NEVER widens
const t1 = intersectBand({ minPct: 10, maxPct: 20 }, { minPct: 12, maxPct: 18 });
ok(t1.minPct === 12 && t1.maxPct === 18 && !t1.widerSides && !t1.disjoint, "tightens both sides");
const t2 = intersectBand({ minPct: 10, maxPct: 20 }, { minPct: 8, maxPct: 25 });
ok(t2.minPct === 10 && t2.maxPct === 20 && t2.widerSides, "learned wider → current kept, widerSides flagged");
const t3 = intersectBand({ minPct: 10, maxPct: 20 }, { minPct: 15, maxPct: 25 });
ok(t3.minPct === 15 && t3.maxPct === 20 && t3.widerSides, "one side tighter, one side wider → tighten only");
const t4 = intersectBand({ minPct: null, maxPct: null }, { minPct: 12, maxPct: 18 });
ok(t4.minPct === 12 && t4.maxPct === 18 && !t4.disjoint, "null current → learned establishes");
const t5 = intersectBand({ minPct: 10, maxPct: 12 }, { minPct: 20, maxPct: 25 });
ok(t5.disjoint && t5.minPct === 10 && t5.maxPct === 12, "disjoint → keep current, flag disjoint");

ok(NORM_MIN_SAMPLES === 5, "NORM_MIN_SAMPLES = 5");

console.log(`obvalka-norms: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
