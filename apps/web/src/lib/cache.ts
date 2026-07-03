import { idbGet, idbSet } from "./idb";

// Stale-while-revalidate: кэшдаги қиймат ДАРРОВ қайтарилади (тез рендер + оффлайн),
// сўнг тармоқдан янгиланади. onData ҳар қиймат келганда чақирилади (0, 1 ёки 2 марта):
//   online   → cache бор бўлса onData(cache), кейин onData(fresh)
//   online   → cache йўқ → onData(fresh)
//   offline  → onData(cache) (тармоқ хатоси ютилади)
//   offline+cache йўқ → throw (чақирувчи .catch билан ушлайди)
// Фақат ЎЗГАРМАС маълумот учун (меню/заллар/столлар) — заказлар эмас.
type KV = {
  get: <T>(k: string) => Promise<T | undefined>;
  set: (k: string, v: unknown) => Promise<void>;
};
const defaultKV: KV = { get: idbGet, set: idbSet };

export async function swr<T>(
  key: string,
  fetcher: () => Promise<T>,
  onData: (v: T) => void,
  kv: KV = defaultKV,
): Promise<void> {
  let cached: T | undefined;
  try {
    cached = await kv.get<T>(key);
  } catch {
    cached = undefined; // IDB ишламаса (private mode) — оддий тармоқ-режим
  }
  if (cached !== undefined) onData(cached);

  try {
    const fresh = await fetcher();
    onData(fresh);
    kv.set(key, fresh).catch(() => {}); // ёзиш фонда, блокламайди
  } catch (e) {
    if (cached === undefined) throw e; // кэш ҳам йўқ → ҳақиқий хато
    // акс ҳолда: оффлайн, кэшдаги қиймат кўрсатилиб турибди — жим ютамиз
  }
}
