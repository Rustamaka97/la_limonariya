import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { products, recipeItems, recipes } from "./schema";

type Seed = {
  recipes: {
    name: string;
    kind: string | null;
    category: string | null;
    yield_g: number | null;
    marinade: string | null;
    items: { name: string; qty_g: number | null; stock_hint: string | null }[];
  }[];
  aliases: Record<string, string[]>;
};

const seed: Seed = JSON.parse(
  readFileSync(new URL("./texkarta-seed.json", import.meta.url), "utf8"),
);

function toInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function norm(s: string): string {
  return (s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[().,"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const alias = new Map<string, string>();
for (const [c, vars] of Object.entries(seed.aliases))
  for (const v of vars) alias.set(norm(v), norm(c));
const canon = (s: string) => alias.get(norm(s)) ?? norm(s);

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const client = postgres(url, { max: 1 });
const db = drizzle(client);

const prodIndex = new Map<string, string>();
for (const p of await db
  .select({ id: products.id, name: products.name })
  .from(products))
  if (!prodIndex.has(norm(p.name))) prodIndex.set(norm(p.name), p.id);

// Idempotent (NON-destructive): preserve recipes already in the DB — a director's
// in-app tech-card edits (recipeUpsert, keyed by productId) must survive a restart.
// Seed only NEW dishes: skip a linked recipe if its product already has one; skip an
// unlinked (productId=null) reference recipe if its name already exists.
const existing = await db
  .select({ productId: recipes.productId, name: recipes.name })
  .from(recipes);
const haveProduct = new Set(
  existing.map((r) => r.productId).filter((x): x is string => !!x),
);
const haveName = new Set(existing.map((r) => norm(r.name)));

let dishLinked = 0;
let itemLinked = 0;
let itemTotal = 0;
let seeded = 0;
let skipped = 0;

for (const r of seed.recipes) {
  const productId = prodIndex.get(norm(r.name)) ?? null;
  if (productId ? haveProduct.has(productId) : haveName.has(norm(r.name))) {
    skipped++;
    continue;
  }
  if (productId) dishLinked++;

  const rec = (
    await db
      .insert(recipes)
      .values({
        productId,
        name: r.name,
        kind: r.kind,
        category: r.category,
        yieldG: toInt(r.yield_g),
        marinade: r.marinade,
      })
      .returning()
  )[0];
  if (!rec) continue;

  const items = r.items.map((it, idx) => {
    const componentId =
      prodIndex.get(canon(it.name)) ?? prodIndex.get(norm(it.name)) ?? null;
    itemTotal++;
    if (componentId) itemLinked++;
    return {
      recipeId: rec.id,
      componentId,
      componentName: it.name,
      qtyG: toInt(it.qty_g),
      stockHint: it.stock_hint ?? null,
      sort: idx,
    };
  });
  if (items.length) await db.insert(recipeItems).values(items);
  seeded++;
}

console.log(
  `recipes: seeded ${seeded}, preserved ${skipped} (dish→product ${dishLinked}), items linked ${itemLinked}/${itemTotal}`,
);
await client.end();
