import { useCallback, useEffect, useState } from "react";
import { type Category, type Product, ProductModal, type Station } from "./Catalog";
import { swr } from "./lib/cache";
import { trpc } from "./trpc";

type Recipe = {
  id: string;
  name: string;
  kind: string | null;
  category: string | null;
  yieldG: number | null;
  productId: string | null;
  linked: boolean;
};
type Item = {
  componentName: string;
  qtyG: number | null;
  stockHint: string | null;
  product: string | null;
};
type Suggestion = {
  recipeId: string;
  recipeName: string;
  productId: string;
  productName: string;
  score: number;
};

export function Recipes({ canManage = false }: { canManage?: boolean }) {
  const [list, setList] = useState<Recipe[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, Item[]>>({});
  const [cats, setCats] = useState<Category[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [linkBusy, setLinkBusy] = useState<string | null>(null);
  const [linkErr, setLinkErr] = useState<string | null>(null);

  const unlinkedCount = list?.filter((r) => !r.linked).length ?? 0;

  async function openSuggest() {
    setSuggestOpen(true);
    setSuggestions(null);
    setLinkErr(null);
    try {
      setSuggestions(await trpc.catalog.recipeLinkSuggest.query());
    } catch (e) {
      setLinkErr(e instanceof Error ? e.message : "Таклиф юкланмади");
      setSuggestions([]);
    }
  }

  async function link(s: Suggestion) {
    setLinkBusy(s.recipeId);
    setLinkErr(null);
    try {
      await trpc.catalog.recipeLink.mutate({ recipeId: s.recipeId, productId: s.productId });
      setSuggestions((prev) => prev?.filter((x) => x.recipeId !== s.recipeId) ?? null);
      refresh();
    } catch (e) {
      setLinkErr(e instanceof Error ? e.message : "Уланмади");
    } finally {
      setLinkBusy(null);
    }
  }

  const refresh = useCallback(() => {
    trpc.catalog.recipes
      .query()
      .then(setList)
      .catch(() => setList([]));
  }, []);

  useEffect(() => {
    refresh();
    trpc.catalog.categories.list.query().then(setCats).catch(() => {});
    swr("catalog.stations", () => trpc.catalog.stations.query(), setStations).catch(() => {});
  }, [refresh]);

  async function toggle(id: string) {
    if (open === id) {
      setOpen(null);
      return;
    }
    setOpen(id);
    if (!items[id]) {
      await swr(
        `catalog.recipe:${id}`,
        () => trpc.catalog.recipe.query({ recipeId: id }),
        (it) => setItems((prev) => ({ ...prev, [id]: it })),
      );
    }
  }

  async function edit(productId: string) {
    const p = await trpc.catalog.products.get.query({ id: productId });
    if (p) setEditProduct(p);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-400">
          {list?.length ?? "…"} рецепт
          {unlinkedCount > 0 && (
            <span className="ml-1 text-amber-600">· {unlinkedCount} таомга уланмаган</span>
          )}
          {" · таҳрирлаш ✎"}
        </p>
        {canManage && unlinkedCount > 0 && (
          <button
            onClick={openSuggest}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-soft"
          >
            🔗 Техкарта авто-улаш
          </button>
        )}
      </div>
      <div className="divide-y rounded-xl border bg-white">
        {list?.map((r) => (
          <div key={r.id}>
            <div className="flex items-center">
              <button
                onClick={() => toggle(r.id)}
                className="flex flex-1 items-center justify-between px-4 py-2.5 text-left hover:bg-zinc-50"
              >
                <span className="flex items-center gap-2">
                  <span className="text-zinc-400">
                    {open === r.id ? "▾" : "▸"}
                  </span>
                  <span>{r.name}</span>
                </span>
                <span className="flex items-center gap-2 text-xs">
                  {r.category && (
                    <span className="text-zinc-400">{r.category}</span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 ${
                      r.kind === "salad"
                        ? "bg-lime-100 text-lime-700"
                        : "bg-orange-100 text-orange-700"
                    }`}
                  >
                    {r.kind === "salad" ? "Салат" : "Иссиқ"}
                  </span>
                </span>
              </button>
              {r.linked && r.productId && (
                <button
                  onClick={() => r.productId && edit(r.productId)}
                  className="shrink-0 px-3 py-2.5 text-zinc-300 hover:text-brand"
                  title="Техкартани таҳрирлаш"
                >
                  ✎
                </button>
              )}
            </div>
            {open === r.id && (
              <div className="bg-zinc-50 px-4 py-2">
                <table className="w-full text-sm">
                  <tbody>
                    {items[r.id]?.map((it, i) => (
                      <tr
                        key={i}
                        className="border-b border-zinc-100 last:border-0"
                      >
                        <td className="py-1.5">
                          {it.componentName}
                          {it.stockHint && (
                            <span className="ml-1 text-xs text-zinc-400">
                              ({it.stockHint})
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-zinc-600">
                          {it.qtyG != null ? `${it.qtyG} г` : "—"}
                        </td>
                        <td className="py-1.5 pl-3 text-right text-xs">
                          {it.product ? (
                            <span className="text-green-600">✓</span>
                          ) : (
                            <span className="text-zinc-300">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!items[r.id] && (
                      <tr>
                        <td className="py-2 text-zinc-400">⏳</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      {editProduct && (
        <ProductModal
          product={editProduct}
          categories={cats}
          stations={stations}
          onClose={() => setEditProduct(null)}
          onSaved={() => {
            setEditProduct(null);
            setItems({});
            setOpen(null);
            refresh();
          }}
        />
      )}

      {suggestOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-6">
          <div className="flex max-h-[85dvh] w-full max-w-xl flex-col gap-3 rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-brand-ink">🔗 Техкарта авто-улаш</h3>
                <p className="text-xs text-zinc-400">
                  Ном-ўхшашлиги бўйича таклиф — тасдиқлаш сизда (нотўғри бўлса ташланг)
                </p>
              </div>
              <button
                onClick={() => setSuggestOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 transition hover:bg-zinc-100"
              >
                Ёпиш
              </button>
            </div>
            {linkErr && <p className="text-sm text-red-500">{linkErr}</p>}
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
              {suggestions === null && <p className="py-6 text-center text-sm text-zinc-400">⏳ Ҳисобланяпти…</p>}
              {suggestions?.length === 0 && (
                <p className="py-6 text-center text-sm text-zinc-400">
                  Ном-ўхшаш таклиф йўқ — қолганларини қўлда улаш керак
                </p>
              )}
              {suggestions?.map((s) => (
                <div
                  key={s.recipeId}
                  className="flex items-center gap-2 rounded-lg border border-brand-cream-soft px-3 py-2"
                >
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="truncate font-medium text-brand-ink">{s.recipeName}</div>
                    <div className="truncate text-xs text-zinc-500">→ {s.productName}</div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                      s.score >= 85
                        ? "bg-emerald-100 text-emerald-700"
                        : s.score >= 70
                          ? "bg-amber-100 text-amber-700"
                          : "bg-zinc-100 text-zinc-500"
                    }`}
                    title="Ишонч даражаси"
                  >
                    {s.score}%
                  </span>
                  <button
                    onClick={() => link(s)}
                    disabled={linkBusy === s.recipeId}
                    className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-soft disabled:opacity-50"
                  >
                    {linkBusy === s.recipeId ? "…" : "Улаш"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
