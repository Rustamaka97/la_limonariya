import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { categories, products, stations } from "./schema";

type Seed = {
  categories: { clopos_id: number; name: string; position: number }[];
  stations: { clopos_id: number; name: string; printable: boolean }[];
  products: {
    clopos_id: number;
    name: string;
    type: "ingredient" | "part" | "semi" | "dish" | "goods";
    unit: "dona" | "kg" | "g" | "l" | "ml";
    category_clopos_id: number | null;
    station_clopos_id: number | null;
    price: number;
    sold_by_weight: boolean;
  }[];
};

const seed: Seed = JSON.parse(
  readFileSync(new URL("./catalog-seed.json", import.meta.url), "utf8"),
);

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const client = postgres(url, { max: 1 });
const db = drizzle(client);

await db
  .insert(categories)
  .values(
    seed.categories.map((c) => ({
      cloposId: c.clopos_id,
      name: c.name,
      position: c.position ?? 0,
    })),
  )
  .onConflictDoUpdate({
    target: categories.cloposId,
    set: { name: sql`excluded.name`, position: sql`excluded.position` },
  });

// Тасдиқланган принтер IP'лари (docs/rustam-javoblari-2.md, clopus-analiz.md).
// NON CHOY — принтери йўқ (null). onConflict'да ip ЯНГИЛАНМАЙДИ — қўлдан
// созланган IP re-seed'да бузилмасин.
const STATION_IP: Record<string, string | null> = {
  SALAT: "192.168.1.131",
  OSHXONA: "192.168.1.132",
  SHASHLIK: "192.168.1.133",
  BALIQ: "192.168.1.134",
  BAR: "192.168.1.137",
  "NON CHOY": null,
};

await db
  .insert(stations)
  .values(
    seed.stations.map((s) => ({
      cloposId: s.clopos_id,
      name: s.name,
      printable: s.printable,
      ip: STATION_IP[s.name] ?? null,
    })),
  )
  .onConflictDoUpdate({
    target: stations.cloposId,
    set: { name: sql`excluded.name`, printable: sql`excluded.printable` },
  });

const catMap = new Map(
  (await db.select().from(categories)).map((c) => [c.cloposId, c.id]),
);
const stMap = new Map(
  (await db.select().from(stations)).map((s) => [s.cloposId, s.id]),
);

await db
  .insert(products)
  .values(
    seed.products.map((p) => ({
      cloposId: p.clopos_id,
      name: p.name,
      type: p.type,
      unit: p.unit,
      categoryId: p.category_clopos_id
        ? (catMap.get(p.category_clopos_id) ?? null)
        : null,
      stationId: p.station_clopos_id
        ? (stMap.get(p.station_clopos_id) ?? null)
        : null,
      price: p.price,
      soldByWeight: p.sold_by_weight,
    })),
  )
  .onConflictDoUpdate({
    target: products.cloposId,
    set: {
      name: sql`excluded.name`,
      type: sql`excluded.type`,
      unit: sql`excluded.unit`,
      categoryId: sql`excluded.category_id`,
      stationId: sql`excluded.station_id`,
      price: sql`excluded.price`,
      soldByWeight: sql`excluded.sold_by_weight`,
    },
  });

console.log(
  `catalog: ${seed.categories.length} categories, ${seed.stations.length} stations, ${seed.products.length} products`,
);
await client.end();
