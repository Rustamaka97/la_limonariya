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

export function Recipes() {
  const [list, setList] = useState<Recipe[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, Item[]>>({});
  const [cats, setCats] = useState<Category[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [editProduct, setEditProduct] = useState<Product | null>(null);

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
      <p className="text-xs text-zinc-400">
        {list?.length ?? "…"} рецепт · таҳрирлаш учун ✎ (таом рецептлари)
      </p>
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
    </div>
  );
}
