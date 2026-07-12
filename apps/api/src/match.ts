// Тех-карта авто-улаш матчери: texkarta рецепт номи ↔ CloPOS каталог таом номи.
// Улар имлода фарқ қилади (ўзбек ҳарф вариантлари ғ/г қ/к ҳ/х ў/у, префикс/суффикс
// «Шашлик — X», «X салат», «(мол гушти)»). Аниқ norm() 38 дан фақат 5 тани улайди.
// Бу — толерант матчер: ҳарф-фолд + шовқин токен + токен-қамров + edit-distance.
// Кўр-кўрона улаМАЙДИ — фақат таклиф беради, директор тасдиқлайди (router'да).

// Ўзбек ҳарф-вариантларини бир хиллаш (bridge.js CP866 fallback'и билан бир мантиқ).
export function foldName(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/ғ/g, "г")
    .replace(/қ/g, "к")
    .replace(/ҳ/g, "х")
    .replace(/ў/g, "у")
    .replace(/ё/g, "е")
    .replace(/[().,"'`«»—–\-/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Таом идентификациясига таъсир қилмайдиган шовқин токенлар (категория/ўлчов сўзлари).
// «жиз», «кабоб», «шурво» — таом ўзаги, ОЛИНМАЙДИ. «мол/қўй» — дисамбигуация, қолдирилади.
const NOISE = new Set([
  "шашлик", "салат", "порция", "порц", "шт", "кг", "гр", "г", "мл", "л",
  "гарнир", "блюдо",
]);

export function coreTokens(s: string): string[] {
  return foldName(s)
    .split(" ")
    .filter((t) => t.length > 0 && !NOISE.has(t));
}

// Таом ТУРИ — «салат» ва «шашлик»/«жиз»/«лағмон» ҲАР ХИЛ таом. Ном ўзаги ўхшаса
// ҳам тури зид бўлса — улаш нотўғри (Овощной САЛАТ ≠ Овошной ШАШЛИК).
const DISH_KINDS = [
  "салат", "шашлик", "лагмон", "жиз", "кабоб", "шурво", "суп",
  "стейк", "манти", "буглама", "кавоб", "плов", "лапша", "сомса",
];
function dishKind(folded: string): string | null {
  for (const k of DISH_KINDS) if (folded.includes(k)) return k;
  return null;
}

// Левенштейн ўхшашлик нисбати 0..1 (фолд қилинган сатрлар устида).
function editRatio(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  const prev = Array.from({ length: n + 1 }, (_, j) => j);
  const cur = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j]!;
  }
  return 1 - prev[n]! / Math.max(m, n);
}

// 0..1 ўхшашлик балли: аниқ фолд → 1; токен-қамров/қисм-тўплам → юқори;
// акс ҳолда edit-distance. Дисамбигуация: мол/қўй фарқ қилса — жарима.
export function simScore(a: string, b: string): number {
  const fa = foldName(a);
  const fb = foldName(b);
  if (fa === fb) return 1;

  const ta = coreTokens(a);
  const tb = coreTokens(b);
  // Едит-масофа ШОВҚИНСИЗ ўзак устида ҳисобланади («шашлик — кускавой» ↔
  // «кусковой (мол гушти) шт» → «кускавой» ↔ «кусковой мол гушти»).
  const ca = ta.join(" ");
  const cb = tb.join(" ");
  let base: number;
  if (ta.length && tb.length) {
    const setA = new Set(ta);
    const setB = new Set(tb);
    const overlap = ta.filter((t) => setB.has(t)).length;
    const tokenScore = overlap / Math.max(ta.length, tb.length);
    const subset = ta.every((t) => setB.has(t)) || tb.every((t) => setA.has(t));
    if (subset && overlap > 0) base = Math.max(tokenScore, 0.82);
    else base = Math.max(tokenScore * 0.9, editRatio(ca, cb));
  } else {
    base = editRatio(ca || fa, cb || fb);
  }

  // Гўшт тури зид бўлса (бири мол, бошқаси қўй) — бу ҲАР ХИЛ таом, кучли жарима
  // («Шашлик — кускавой» мол ва қўй иккита алоҳида рецепт/таом).
  const meatA = /мол/.test(fa) ? "mol" : /куй|кўй/.test(fa) ? "qoy" : null;
  const meatB = /мол/.test(fb) ? "mol" : /куй|кўй/.test(fb) ? "qoy" : null;
  if (meatA && meatB && meatA !== meatB) base *= 0.4;

  // Таом ТУРИ зид бўлса — нотўғри мослик (салат ≠ шашлик ≠ жиз ≠ лағмон).
  const kindA = dishKind(fa);
  const kindB = dishKind(fb);
  if (kindA && kindB && kindA !== kindB) base *= 0.35;

  return base;
}

export type LinkCandidate = { id: string; name: string };
export type LinkSuggestion = { productId: string; productName: string; score: number };

// Бир рецепт учун энг мос таомни топади (балл билан). Мос топилмаса null.
export function bestMatch(
  recipeName: string,
  products: LinkCandidate[],
  minScore = 0.5,
): LinkSuggestion | null {
  let best: LinkSuggestion | null = null;
  for (const p of products) {
    const score = simScore(recipeName, p.name);
    if (!best || score > best.score)
      best = { productId: p.id, productName: p.name, score };
  }
  if (!best || best.score < minScore) return null;
  return best;
}
