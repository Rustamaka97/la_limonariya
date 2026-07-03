import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "./App";
import { trpc } from "./trpc";

export type Category = { id: string; name: string; position: number; active: boolean };
export type Product = {
  id: string;
  name: string;
  type: string;
  unit: string;
  price: number;
  costPrice: number | null;
  soldByWeight: boolean;
  gramNorm?: number | null;
  active: boolean;
  categoryId: string | null;
  stationId: string | null;
  category: string | null;
  station: string | null;
  hasRecipe: boolean;
};
export type Station = { id: string; name: string; ip?: string | null };
type Component = { id: string; name: string; unit: string; type: string };

const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  dish: { label: "Таом", cls: "bg-emerald-100 text-emerald-700" },
  goods: { label: "Товар", cls: "bg-sky-100 text-sky-700" },
  ingredient: { label: "Хом-ашё", cls: "bg-amber-100 text-amber-700" },
  semi: { label: "Ярим-т.", cls: "bg-violet-100 text-violet-700" },
  part: { label: "Қисм", cls: "bg-rose-100 text-rose-700" },
};
const TYPES: { v: string; label: string }[] = [
  { v: "dish", label: "Таом" },
  { v: "goods", label: "Товар" },
  { v: "ingredient", label: "Хом-ашё" },
  { v: "semi", label: "Ярим-т." },
  { v: "part", label: "Қисм" },
];
const UNIT: Record<string, string> = { dona: "дона", kg: "кг", g: "г", l: "л", ml: "мл" };
const UNITS: { v: string; label: string }[] = [
  { v: "dona", label: "дона" },
  { v: "kg", label: "кг" },
  { v: "g", label: "г" },
  { v: "l", label: "л" },
  { v: "ml", label: "мл" },
];

export function Catalog({ user }: { user: SessionUser }) {
  const isDirector = user.role === "director";
  const [cats, setCats] = useState<Category[]>([]);
  const [stationsList, setStationsList] = useState<Station[]>([]);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [cat, setCat] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [editingCat, setEditingCat] = useState<Category | "new" | null>(null);

  const refreshCats = useCallback(() => {
    trpc.catalog.categories.list
      .query({ includeInactive: isDirector && showInactive })
      .then(setCats)
      .catch(() => {});
  }, [isDirector, showInactive]);
  const refreshProducts = useCallback(() => {
    setProducts(null);
    trpc.catalog.products.list
      .query({ categoryId: cat ?? undefined, includeInactive: isDirector && showInactive })
      .then(setProducts)
      .catch(() => setProducts([]));
  }, [cat, isDirector, showInactive]);

  useEffect(refreshCats, [refreshCats]);
  useEffect(refreshProducts, [refreshProducts]);
  useEffect(() => {
    if (isDirector) trpc.catalog.stations.query().then(setStationsList).catch(() => {});
  }, [isDirector]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Chip active={cat === null} onClick={() => setCat(null)}>
            Барчаси
          </Chip>
          {cats.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1">
              <Chip active={cat === c.id} onClick={() => setCat(c.id)}>
                {c.name}
                {!c.active && " (ўчирилган)"}
              </Chip>
              {isDirector && (
                <button
                  onClick={() => setEditingCat(c)}
                  className="text-xs text-zinc-300 hover:text-emerald-600"
                  title="Таҳрирлаш"
                >
                  ✎
                </button>
              )}
            </span>
          ))}
          {isDirector && (
            <button
              onClick={() => setEditingCat("new")}
              className="rounded-full border border-dashed border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-50"
            >
              + Категория
            </button>
          )}
        </div>
        {isDirector && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-zinc-500">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              ўчирилганлар ҳам
            </label>
            <button
              onClick={() => setEditing("new")}
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white"
            >
              ＋ Янги маҳсулот
            </button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium">Номи</th>
              <th className="px-3 py-2 font-medium">Тур</th>
              <th className="px-3 py-2 font-medium">Станция</th>
              <th className="px-3 py-2 text-right font-medium">Нарх</th>
              {isDirector && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {products?.map((p) => {
              const b = TYPE_BADGE[p.type];
              return (
                <tr key={p.id} className={!p.active ? "opacity-40" : ""}>
                  <td className="px-4 py-2">
                    {p.name}
                    {(p.type === "dish" || p.type === "semi") && !p.hasRecipe && (
                      <span className="ml-2 whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                        техкарта йўқ
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${b?.cls ?? ""}`}>
                      {b?.label ?? p.type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{p.station ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p.price
                      ? `${p.price.toLocaleString("ru-RU")} so'm${p.soldByWeight ? "/" + UNIT[p.unit] : ""}`
                      : "—"}
                  </td>
                  {isDirector && (
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => setEditing(p)}
                        className="text-zinc-300 hover:text-emerald-600"
                      >
                        ✎
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {products ? (
          <div className="px-4 py-2 text-xs text-zinc-400">{products.length} та маҳсулот</div>
        ) : (
          <div className="px-4 py-6 text-center text-zinc-400">⏳</div>
        )}
      </div>

      {editing && (
        <ProductModal
          product={editing === "new" ? null : editing}
          categories={cats}
          stations={stationsList}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refreshProducts();
          }}
        />
      )}
      {editingCat && (
        <CategoryModal
          category={editingCat === "new" ? null : editingCat}
          onClose={() => setEditingCat(null)}
          onSaved={() => {
            setEditingCat(null);
            refreshCats();
          }}
        />
      )}

      {isDirector && stationsList.length > 0 && (
        <PrintersSection
          stations={stationsList}
          onChanged={() => trpc.catalog.stations.query().then(setStationsList).catch(() => {})}
        />
      )}
    </div>
  );
}

function PrintersSection({ stations, onChanged }: { stations: Station[]; onChanged: () => void }) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save(stationId: string) {
    const raw = (edits[stationId] ?? "").trim();
    setBusy(stationId);
    setErr(null);
    try {
      await trpc.catalog.setStationIp.mutate({ stationId, ip: raw || null });
      setEdits((e) => { const n = { ...e }; delete n[stationId]; return n; });
      onChanged();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Хато");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      <div className="border-b px-4 py-2.5 text-sm font-semibold">🖨 Принтерлар (станция IP)</div>
      {err && <div className="px-4 pt-2 text-sm text-red-600">{err}</div>}
      <div className="divide-y text-sm">
        {stations.map((s) => {
          const val = edits[s.id] ?? s.ip ?? "";
          const dirty = edits[s.id] !== undefined && edits[s.id] !== (s.ip ?? "");
          return (
            <div key={s.id} className="flex items-center gap-2 px-4 py-2">
              <span className="w-24 shrink-0 font-medium">{s.name}</span>
              <input
                value={val}
                onChange={(e) => setEdits((ed) => ({ ...ed, [s.id]: e.target.value }))}
                placeholder="192.168.1.x (бўш = принтер йўқ)"
                className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm tabular-nums outline-none focus:border-brand"
              />
              <button
                onClick={() => save(s.id)}
                disabled={busy === s.id || !dirty}
                className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                Сақлаш
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        active ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

export function ProductModal({
  product,
  categories,
  stations,
  onClose,
  onSaved,
}: {
  product: Product | null;
  categories: Category[];
  stations: Station[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [type, setType] = useState(product?.type ?? "dish");
  const [unit, setUnit] = useState(product?.unit ?? "dona");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [stationId, setStationId] = useState(product?.stationId ?? "");
  const [soldByWeight, setSoldByWeight] = useState(product?.soldByWeight ?? false);
  const [gramNorm, setGramNorm] = useState(product?.gramNorm != null ? String(product.gramNorm) : "");
  const [active, setActive] = useState(product?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [components, setComponents] = useState<Component[]>([]);
  const [yieldG, setYieldG] = useState("");
  const [items, setItems] = useState<{ componentId: string; componentName: string; qtyG: string }[]>([]);
  const isRecipeType = type === "dish" || type === "semi";

  useEffect(() => {
    trpc.catalog.components.query().then(setComponents).catch(() => {});
    if (product) {
      trpc.catalog.recipeForProduct
        .query({ productId: product.id })
        .then((r) => {
          if (!r) return;
          setYieldG(r.yieldG ? String(r.yieldG) : "");
          setItems(
            r.items.map((i) => ({
              componentId: i.componentId ?? "",
              componentName: i.componentName ?? "",
              qtyG: i.qtyG ? String(i.qtyG) : "",
            })),
          );
        })
        .catch(() => {});
    }
  }, [product]);

  async function save() {
    if (!name.trim()) {
      setErr("Номи керак");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const priceNum = Math.round(Number(price) || 0);
      let productId = product?.id;
      if (product) {
        await trpc.catalog.products.update.mutate({
          id: product.id,
          name: name.trim(),
          type: type as "dish",
          unit: unit as "dona",
          price: priceNum,
          categoryId: categoryId || null,
          stationId: stationId || null,
          soldByWeight,
          gramNorm: gramNorm ? Math.round(Number(gramNorm)) : null,
          active,
        });
      } else {
        const created = await trpc.catalog.products.create.mutate({
          name: name.trim(),
          type: type as "dish",
          unit: unit as "dona",
          price: priceNum,
          categoryId: categoryId || undefined,
          stationId: stationId || undefined,
          soldByWeight,
          gramNorm: gramNorm ? Math.round(Number(gramNorm)) : undefined,
        });
        productId = created.id;
      }
      if (isRecipeType && productId) {
        const clean = items
          .map((i) => ({
            componentId: i.componentId || undefined,
            componentName: i.componentId ? undefined : i.componentName.trim() || undefined,
            qtyG: Math.round(Number(i.qtyG) || 0),
          }))
          .filter((i) => (i.componentId || i.componentName) && i.qtyG > 0);
        if (clean.length)
          await trpc.catalog.recipeUpsert.mutate({
            productId,
            yieldG: yieldG ? Math.round(Number(yieldG)) : null,
            items: clean,
          });
      }
      onSaved();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Хато");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-sm space-y-3 overflow-auto rounded-2xl bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold">{product ? "Маҳсулотни таҳрирлаш" : "Янги маҳсулот"}</h3>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Номи"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <div className="flex flex-wrap gap-1.5">
          {TYPES.map((t) => (
            <button
              key={t.v}
              onClick={() => setType(t.v)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${type === t.v ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
            placeholder="Нарх (so'm)"
            className="flex-1 rounded-lg border px-3 py-2 text-sm tabular-nums outline-none focus:border-brand"
          />
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className="rounded-lg border px-2 py-2 text-sm outline-none focus:border-brand"
          >
            {UNITS.map((u) => (
              <option key={u.v} value={u.v}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand"
        >
          <option value="">Категория йўқ</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={stationId}
          onChange={(e) => setStationId(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand"
        >
          <option value="">Станция йўқ</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          <input type="checkbox" checked={soldByWeight} onChange={(e) => setSoldByWeight(e.target.checked)} />
          Оғирлик бўйича сотилади (масалан, балиқ)
        </label>

        <label className="block text-sm text-zinc-600">
          1 сихдаги гўшт — <b>маринадланган</b> (г), сих грамм назорати учун (ихтиёрий)
          <input
            inputMode="numeric"
            value={gramNorm}
            onChange={(e) => setGramNorm(e.target.value.replace(/\D/g, ""))}
            placeholder="масалан 140 (маринадланган шашлик)"
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm tabular-nums outline-none focus:border-brand"
          />
        </label>

        {isRecipeType && (
          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-zinc-700">Техкарта (таннарх учун)</span>
              <input
                inputMode="numeric"
                value={yieldG}
                onChange={(e) => setYieldG(e.target.value.replace(/\D/g, ""))}
                placeholder="Чиқиш, г"
                className="w-20 rounded-lg border px-2 py-1 text-xs tabular-nums outline-none focus:border-brand"
              />
            </div>
            {items.map((it, idx) => {
              const unlinked = !it.componentId && !!it.componentName;
              return (
                <div key={idx} className="flex items-center gap-1.5">
                  <select
                    value={it.componentId}
                    onChange={(e) =>
                      setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, componentId: e.target.value } : r)))
                    }
                    className={`min-w-0 flex-1 rounded-lg border bg-white px-2 py-1.5 text-sm outline-none focus:border-brand ${
                      unlinked ? "border-amber-400 text-amber-700" : ""
                    }`}
                  >
                    <option value="">{unlinked ? `⚠ ${it.componentName} — боғланг` : "Ингредиент…"}</option>
                    {components.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <input
                    inputMode="numeric"
                    value={it.qtyG}
                    onChange={(e) =>
                      setItems((rows) =>
                        rows.map((r, i) => (i === idx ? { ...r, qtyG: e.target.value.replace(/\D/g, "") } : r)),
                      )
                    }
                    placeholder="г"
                    className="w-14 rounded-lg border px-2 py-1.5 text-sm tabular-nums outline-none focus:border-brand"
                  />
                  <button
                    onClick={() => setItems((rows) => rows.filter((_, i) => i !== idx))}
                    className="shrink-0 px-1 text-lg leading-none text-zinc-300 hover:text-red-500"
                    title="Ўчириш"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <button
              onClick={() => setItems((rows) => [...rows, { componentId: "", componentName: "", qtyG: "" }])}
              className="w-full rounded-lg border border-dashed border-amber-300 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100/60"
            >
              ＋ Ингредиент қўшиш
            </button>
            {items.filter((i) => (i.componentId || i.componentName) && i.qtyG).length === 0 && (
              <p className="text-xs text-amber-700">
                Техкартасиз таомнинг таннархи ҳисобланмайди — «сохта фойда» (Клопусдаги хато).
              </p>
            )}
          </div>
        )}

        {product && (
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Фаол (ўчирилса — менюда кўринмайди)
          </label>
        )}
        {err && <p className="text-sm text-red-500">{err}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 rounded-xl border py-2.5 text-zinc-600">
            Бекор
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="flex-1 rounded-xl bg-brand py-2.5 font-medium text-white disabled:opacity-40"
          >
            Сақлаш
          </button>
        </div>
      </div>
    </div>
  );
}

function CategoryModal({
  category,
  onClose,
  onSaved,
}: {
  category: Category | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [active, setActive] = useState(category?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) {
      setErr("Номи керак");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (category) {
        await trpc.catalog.categories.update.mutate({ id: category.id, name: name.trim(), active });
      } else {
        await trpc.catalog.categories.create.mutate({ name: name.trim() });
      }
      onSaved();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Хато");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-xs space-y-3 rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold">{category ? "Категорияни таҳрирлаш" : "Янги категория"}</h3>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Номи"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand"
        />
        {category && (
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Фаол (ўчирилса — рўйхатдан йўқолади)
          </label>
        )}
        {err && <p className="text-sm text-red-500">{err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border py-2.5 text-zinc-600">
            Бекор
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="flex-1 rounded-xl bg-brand py-2.5 font-medium text-white disabled:opacity-40"
          >
            Сақлаш
          </button>
        </div>
      </div>
    </div>
  );
}
