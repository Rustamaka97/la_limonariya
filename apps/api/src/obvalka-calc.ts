export type PartInput = {
  name: string;
  weightG: number;
  isWaste: boolean;
  normMinPct: number | null;
  normMaxPct: number | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

// Carcass cost spreads only over SELLABLE parts (bone/trash = 0) → real per-kg
// meat cost. Loss% = (carcass − Σparts)/carcass; >±5% is flagged for review.
export function computeObvalka(
  weightG: number,
  pricePerKg: number,
  parts: PartInput[],
) {
  const totalPartsG = parts.reduce((s, p) => s + p.weightG, 0);
  const lossG = weightG - totalPartsG;
  const lossPct = weightG > 0 ? (lossG / weightG) * 100 : 0;
  const sellableG = parts
    .filter((p) => !p.isWaste)
    .reduce((s, p) => s + p.weightG, 0);
  const totalCost = Math.round((weightG / 1000) * pricePerKg);
  const costPerKg =
    sellableG > 0 ? Math.round(totalCost / (sellableG / 1000)) : 0;

  const items = parts.map((p) => {
    const pct = weightG > 0 ? (p.weightG / weightG) * 100 : 0;
    const outOfNorm =
      p.normMinPct != null &&
      p.normMaxPct != null &&
      (pct < p.normMinPct || pct > p.normMaxPct);
    return {
      name: p.name,
      weightG: p.weightG,
      pct: round1(pct),
      isWaste: p.isWaste,
      normMinPct: p.normMinPct,
      normMaxPct: p.normMaxPct,
      outOfNorm,
      costPerKg: p.isWaste ? 0 : costPerKg,
    };
  });

  return {
    totalPartsG,
    lossG,
    lossPct: round1(lossPct),
    balanceFlag: Math.abs(lossPct) > 5,
    sellableG,
    totalCost,
    costPerKg,
    items,
  };
}
