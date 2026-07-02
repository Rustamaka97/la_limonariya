import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { products } from "./schema";

// Carcass-level meat balances. Recipe data only knows carcass (мол/қўй/товуқ),
// not cut, so meat stock is tracked here — obvalka credits, sales debit.
const CARCASS = ["Мол лаҳм", "Қўй лаҳм", "Товуқ гўшти"];

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const client = postgres(url, { max: 1 });
const db = drizzle(client);

for (const name of CARCASS) {
  const existing = (
    await db.select().from(products).where(eq(products.name, name)).limit(1)
  )[0];
  if (!existing)
    await db.insert(products).values({
      name,
      type: "part",
      unit: "g",
      price: 0,
      active: false,
    });
}

console.log(`carcass products: ${CARCASS.length}`);
await client.end();
