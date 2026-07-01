import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { halls, tables } from "./schema";

// Real tables per hall (imported from Clopos export 2026-06-13).
const DATA: [string, string[]][] = [
  [
    "Асосий зал",
    [
      "1-Кабина",
      "2-Кабина",
      "3-Банкет зал",
      "4-Банкет зал",
      "1-ЛИМОНАРИЯ",
      "2-ЛИМОНАРИЯ",
      "3-ЛИМОНАРИЯ",
      "4-ЛИМОНАРИЯ",
      "5 Лимонария (Чорпоя)",
      "6 Лимонария",
      "7-Лимонария (Чорпоя)",
      "Кичик кабина",
      "8 Лимонария (Чорпоя)",
      "9 Лимонария (Чорпоя)",
      "10 Лимонария (Чорпоя)",
      "11 Лимонария",
      "12 Лимонария",
      "13 Лимонария",
      "14 Лимонария",
      "15 Лимонария",
      "16 Лимонария",
      "17 Лимонария",
    ],
  ],
  ["Катта зал", ["Стол 1", "Стол 2", "Стол 3", "Стол 4", "Стол 5", "Стол 6", "Стол 7", "Стол 8"]],
  ["Собой", ["Стол 1", "Стол 2", "Стол 3", "Стол 4", "Стол 5", "Стол 6", "Стол 7", "Стол 8"]],
  [
    "Терраса",
    ["Терасса 1", "Терасса 2", "Терасса 3", "Терасса 4", "Терасса 5", "Стол 6", "Стол 7", "Стол 8"],
  ],
];

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const client = postgres(url, { max: 1 });
const db = drizzle(client);

const hallRows = await db.select().from(halls);
const byName = new Map(hallRows.map((h) => [h.name, h.id]));

let added = 0;
for (const [hallName, names] of DATA) {
  const hallId = byName.get(hallName);
  if (!hallId) {
    console.log("hall not found:", hallName);
    continue;
  }
  const existing = new Set(
    (await db.select({ name: tables.name }).from(tables).where(eq(tables.hallId, hallId))).map(
      (r) => r.name,
    ),
  );
  const toAdd = names
    .map((name, i) => ({ hallId, name, sort: i }))
    .filter((t) => !existing.has(t.name));
  if (toAdd.length) {
    await db.insert(tables).values(toAdd);
    added += toAdd.length;
  }
}

console.log(`tables seeded: +${added}`);
await client.end();
