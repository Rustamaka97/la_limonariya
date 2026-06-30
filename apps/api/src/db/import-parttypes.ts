import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { partTypes } from "./schema";

// [name, normMinPct, normMaxPct, isWaste] — from docs/obvalka-normalar.md (working bands)
const QOY: [string, number, number, boolean][] = [
  ["Ваггора", 28, 42, false],
  ["Буғлама", 24, 27, false],
  ["Базон-к", 18, 28, false],
  ["Шашлик", 13, 26, false],
  ["Шапок", 9, 17, false],
  ["Корейка", 5, 11, false],
  ["Думба", 7, 12, false],
  ["Жигар", 2, 4, false],
  ["Суяк", 7, 11, true],
  ["Мусор", 1, 3, true],
];
const MOL: [string, number, number, boolean][] = [
  ["Шапок", 14, 22, false],
  ["Филе", 12, 21, false],
  ["Тушонка", 9, 18, false],
  ["Шашлик", 10, 18, false],
  ["Умакай", 6, 14, false],
  ["Мастава", 7, 13, false],
  ["Салат", 3, 13, false],
  ["Марварид", 2, 6, false],
  ["Суяк", 10, 16, true],
  ["Илик", 3, 10, true],
];

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const client = postgres(url, { max: 1 });
const db = drizzle(client);

const rows = [
  ...QOY.map(([name, lo, hi, w], i) => ({
    carcassType: "qoy" as const,
    name,
    normMinPct: lo,
    normMaxPct: hi,
    isWaste: w,
    sort: i,
  })),
  ...MOL.map(([name, lo, hi, w], i) => ({
    carcassType: "mol" as const,
    name,
    normMinPct: lo,
    normMaxPct: hi,
    isWaste: w,
    sort: i,
  })),
];

await db
  .insert(partTypes)
  .values(rows)
  .onConflictDoUpdate({
    target: [partTypes.carcassType, partTypes.name],
    set: {
      normMinPct: sql`excluded.norm_min_pct`,
      normMaxPct: sql`excluded.norm_max_pct`,
      isWaste: sql`excluded.is_waste`,
      sort: sql`excluded.sort`,
    },
  });

console.log(`part_types: ${rows.length} (qoy ${QOY.length}, mol ${MOL.length})`);
await client.end();
