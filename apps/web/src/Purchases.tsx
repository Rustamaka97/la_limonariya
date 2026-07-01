import { useEffect, useMemo, useState } from "react";
import { trpc } from "./trpc";

type Prod = {
  id: string;
  name: string;
  unit: string;
  type: string;
  costPrice: number | null;
};

type Line = {
  productId: string;
  name: string;
  unit: string;
  qty: string;
  price: string;
};

type Purchase = {
  id: string;
  supplier: string | null;
  total: number;
  createdAt: string;
  buyer: string | null;
  lines: number;
};

const UNIT_LABEL: Record<string, string> = {
  kg: "кг",
  g: "г",
  l: "л",
  ml: "мл",
  dona: "дона",
};

const fmtSom = (n: number) => n.toLocaleString("ru-RU");

export function Purchases() {
  const [prods, setProds] = useState<Prod[]>([]);
  const [recent, setRecent] = useState<Purchase[] | null>(null);
  const [supplier, setSupplier] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    trpc.purchase.list
      .query()
      .then(setRecent)
      .catch(() => setRecent([]));
  }
  useEffect(() => {
    trpc.purchase.products
      .query()
      .then(setProds)
      .catch(() => setProds([]));
    refresh();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const chosen = new Set(lines.map((l) => l.productId));
    return prods
      .filter((p) => !chosen.has(p.id) && p.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [search, prods, lines]);

  const total = lines.reduce((s, l) => s + (Number(l.price) || 0), 0);

  function addLine(p: Prod) {
    setLines((ls) => [
      ...ls,
      { productId: p.id, name: p.name, unit: p.unit, qty: "", price: "" },
    ]);
    setSearch("");
  }
  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }
  function removeLine(i: number) {
    setLines((ls) => ls.filter((_, j) => j !== i));
  }

  async function save() {
    const items = lines
      .map((l) => ({
        productId: l.productId,
        qty: Number(l.qty),
        price: Math.round(Number(l.price) || 0),
      }))
      .filter((i) => i.qty > 0);
    if (!items.length) {
      setError("Миқдор киритинг");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await trpc.purchase.create.mutate({
        supplier: supplier.trim() || undefined,
        items,
      });
      setLines([]);
      setSupplier("");
      refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Хато");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-xl border bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Янги харид</h2>
          <input
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder="Етказувчи (ихтиёрий)"
            className="rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-brand"
          />
        </div>

        <div className="relative">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Маҳсулот қидириш… (масло, пиёз, кола…)"
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand"
          />
          {filtered.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border bg-white shadow-lg">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addLine(p)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-50"
                >
                  <span>{p.name}</span>
                  <span className="text-xs text-zinc-400">
                    {UNIT_LABEL[p.unit] ?? p.unit}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {lines.length > 0 && (
          <div className="divide-y rounded-lg border">
            {lines.map((l, i) => (
              <div
                key={l.productId}
                className="flex items-center gap-2 px-3 py-2"
              >
                <span className="flex-1 text-sm">{l.name}</span>
                <div className="flex items-center gap-1">
                  <input
                    inputMode="decimal"
                    value={l.qty}
                    onChange={(e) =>
                      setLine(i, { qty: e.target.value.replace(/[^\d.]/g, "") })
                    }
                    placeholder="0"
                    className="w-16 rounded-lg border px-2 py-1 text-right text-sm outline-none focus:border-brand"
                  />
                  <span className="w-9 text-xs text-zinc-400">
                    {UNIT_LABEL[l.unit] ?? l.unit}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    inputMode="numeric"
                    value={l.price}
                    onChange={(e) =>
                      setLine(i, { price: e.target.value.replace(/\D/g, "") })
                    }
                    placeholder="нарх"
                    className="w-28 rounded-lg border px-2 py-1 text-right text-sm outline-none focus:border-brand"
                  />
                  <span className="text-xs text-zinc-400">сўм</span>
                </div>
                <button
                  onClick={() => removeLine(i)}
                  className="text-zinc-300 hover:text-red-500"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-500">
            Жами:{" "}
            <span className="font-semibold text-zinc-900">
              {fmtSom(total)} сўм
            </span>
          </span>
          <button
            onClick={save}
            disabled={busy || lines.length === 0}
            className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? "…" : "Сақлаш"}
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-500">
          Сўнгги харидлар
        </h2>
        <div className="overflow-hidden rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Сана</th>
                <th className="px-3 py-2 font-medium">Етказувчи</th>
                <th className="px-3 py-2 text-center font-medium">Қатор</th>
                <th className="px-4 py-2 text-right font-medium">Жами</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {recent?.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2 text-zinc-500">
                    {new Date(p.createdAt).toLocaleString("ru-RU", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-3 py-2">{p.supplier ?? "—"}</td>
                  <td className="px-3 py-2 text-center text-zinc-400">
                    {p.lines}
                  </td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">
                    {fmtSom(p.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {recent && recent.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-zinc-400">
              Ҳали харид йўқ
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
