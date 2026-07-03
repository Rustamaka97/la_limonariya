// 1 сихга гўшт грамми (M3 сих грамм-оқма сигнали учун — computeSignals шуни
// ўқийди; gramNorm=null бўлса таом сигналда СКИП бўлади). Манба: Рустам ака
// жавоблари раунд 5/6 + docs/texkarta.json + confirmations.
//
// Фақат NULL бўлганда сет қилинади → директорнинг қўлдаги таҳрири бузилмайди,
// қайта ишга туширса дубль ўзгармайди (идемпотент).
//
// Товук сончалари/Феле/Овошной/Баҳор/Доллар — менюда ЙЎҚ (раунд 6 L) → нормасиз.
// Вафли/Рулет — композит таом (сих эмас, раунд 6 K) → нормасиз.
// Кусковой қўй/мол 100г — каталогда мос ном топилмади (агар бўлса — қўлда).
//
// Ишлатиш (api контейнерда, каталог seed'дан кейин):
//   docker compose exec -T api npx tsx src/db/seed-gramnorm.ts
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { products } from "./schema";

const GRAM_NORM: Record<string, number> = {
  "КОРЕЙКА ШАШЛИК": 145, // 140/150
  "Жигар шашлик": 130,
  Марварид: 140, // мол гўшт
  "ТОВУҚ КАНОТЧАЛАРИ": 160,
  "Думма шашлик": 150, // думба
  "ПОМИДОРЧА ШАШЛИК": 300, // помидор
  Куртоба: 150,
};

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL yo'q");
  process.exit(1);
}
const sql = postgres(url);
const db = drizzle(sql);

let n = 0;
for (const [name, gram] of Object.entries(GRAM_NORM)) {
  const done = await db
    .update(products)
    .set({ gramNorm: gram })
    .where(and(eq(products.name, name), isNull(products.gramNorm)))
    .returning({ id: products.id });
  if (done.length) {
    n++;
    console.log(`  ✓ gramNorm «${name}» = ${gram} г`);
  } else {
    console.log(`  – «${name}» топилмади ёки норма аллақачон бор (скип)`);
  }
}
console.log(`gramNorm seeded on ${n} dishes`);
await sql.end();
