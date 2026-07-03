// Data-informed obvalka yield norms. SAFETY POSTURE (anti-theft): learning may only
// ever TIGHTEN a part's accept-band, never widen it — applying a learned band can
// increase detection sensitivity but never decrease it. Worst case is a false
// out-of-norm flag (director investigates), never a silently-hidden skim. Robust
// stats (median + MAD) so a couple of odd carcasses don't move the band.

export const round1 = (n: number) => Math.round(n * 10) / 10;

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

// Median absolute deviation — robust spread; unaffected by a single outlier the
// way stddev is.
export function mad(xs: number[], med?: number): number {
  if (!xs.length) return 0;
  const c = med ?? median(xs);
  return median(xs.map((x) => Math.abs(x - c)));
}

export type NormBand = {
  n: number;
  median: number;
  mad: number;
  minPct: number;
  maxPct: number;
};

// Band = median ± k·σ̂ where σ̂ = 1.4826·MAD (robust stddev estimate), with a small
// absolute floor so a razor-thin band doesn't flag normal biological variation.
// Edges rounded INWARD (ceil low, floor high) so the integer band is never WIDER
// than the statistical band — outward rounding would silently loosen detection.
export function normBand(
  samplesPct: number[],
  opts?: { k?: number; floorAbs?: number },
): NormBand {
  const k = opts?.k ?? 2.5;
  const floorAbs = opts?.floorAbs ?? 1.5;
  const med = median(samplesPct);
  const rawMad = mad(samplesPct, med);
  const half = Math.max(k * 1.4826 * rawMad, floorAbs);
  let minPct = Math.ceil(med - half);
  let maxPct = Math.floor(med + half);
  // floorAbs≥1.5 keeps the raw window ≥3pp wide, so inward rounding can't collapse
  // it; guard anyway.
  if (minPct > maxPct) {
    minPct = Math.round(med - half);
    maxPct = Math.round(med + half);
  }
  return {
    n: samplesPct.length,
    median: round1(med),
    mad: round1(rawMad),
    minPct: Math.max(0, minPct),
    maxPct,
  };
}

export const NORM_MIN_SAMPLES = 5;

export type Band = { minPct: number | null; maxPct: number | null };

// Intersect a learned band with the current (hand-set/seed) band. NEVER widens:
// each edge moves only inward. If current has no band, the learned band establishes
// one. If the learned band is entirely disjoint from current (recent data wholly
// outside the accepted window — itself a strong anomaly), we do NOT invent an empty
// band; caller is told via `disjoint` and current is kept.
export function intersectBand(
  cur: Band,
  learned: { minPct: number; maxPct: number },
): { minPct: number; maxPct: number; widerSides: boolean; disjoint: boolean } {
  if (cur.minPct == null || cur.maxPct == null)
    return { ...learned, widerSides: false, disjoint: false };
  const minPct = Math.max(cur.minPct, learned.minPct);
  const maxPct = Math.min(cur.maxPct, learned.maxPct);
  const widerSides =
    learned.minPct < cur.minPct || learned.maxPct > cur.maxPct;
  if (minPct > maxPct)
    return { minPct: cur.minPct, maxPct: cur.maxPct, widerSides, disjoint: true };
  return { minPct, maxPct, widerSides, disjoint: false };
}

// From clean carcasses (each: total weightG + its parts) produce a learned band per
// part_type. CRITICAL: aggregate all rows of the same part_type WITHIN a carcass into
// ONE yield% sample (Σ that part's weight / carcass weight) — so n = distinct clean
// carcasses, and split-into-two-rows can't bias the band or inflate the count.
export type CleanCarcass = {
  weightG: number;
  parts: { partTypeId: string | null; weightG: number }[];
};

export function bandsFromCarcasses(
  carcasses: CleanCarcass[],
): Map<string, NormBand> {
  const byPart = new Map<string, number[]>();
  for (const c of carcasses) {
    if (c.weightG <= 0) continue;
    const perPart = new Map<string, number>();
    for (const p of c.parts) {
      if (!p.partTypeId) continue;
      perPart.set(p.partTypeId, (perPart.get(p.partTypeId) ?? 0) + p.weightG);
    }
    for (const [partTypeId, sumW] of perPart) {
      const pct = (sumW / c.weightG) * 100;
      const arr = byPart.get(partTypeId);
      if (arr) arr.push(pct);
      else byPart.set(partTypeId, [pct]);
    }
  }
  const out = new Map<string, NormBand>();
  for (const [partTypeId, samples] of byPart)
    out.set(partTypeId, normBand(samples));
  return out;
}
