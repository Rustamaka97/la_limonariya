import { useEffect, useMemo, useState } from "react";
import { trpc } from "./trpc";

type Prod = { id: string; name: string };

type Batch = {
  id: string;
  name: string;
  meatG: number;
  skewerCount: number;
  normG: number | null;
  createdAt: string;
  by: string | null;
  actualG: number;
  devPct: number | null;
};

type Recon = {
  productId: string;
  name: string;
  opening: number | null;
  openingKnown: boolean;
  skewered: number;
  sold: number;
  expected: number;
  counted: number | null;
  diff: number | null;
};

const fmt = (n: number) => n.toLocaleString("ru-RU");

export function Vitrina() {
  const [prods, setProds] = useState<Prod[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [recon, setRecon] = useState<Recon[]>([]);
  const [loaded, setLoaded] = useState(false);

  // сих батчи формаси
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Prod | null>(null);
  const [meatG, setMeatG] = useState("");
  const [skewers, setSkewers] = useState("");
  const [normG, setNormG] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // витрина санаш киритиш
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [savingCounts, setSavingCounts] = useState(false);

  function refresh() {
    trpc.vitrina.today
      .query()
      .then((d) => {
        setBatches(d.batches);
        setRecon(d.reconcile);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }
  useEffect(() => {
    trpc.vitrina.products
      .query()
      .then(setProds)
      .catch(() => setProds([]));
    refresh();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return prods.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8);
  }, [search, prods]);

  const meatN = Number(meatG) || 0;
  const skewN = Number(skewers) || 0;
  const normN = Number(normG) || 0;
  const actualG = skewN > 0 ? Math.round(meatN / skewN) : 0;
  const devPct =
    normN > 0 && actualG > 0 ? Math.round(((actualG - normN) / normN) * 100) : null;

  async function addBatch() {
    if (!picked || meatN <= 0 || skewN <= 0) {
      setError("Таом, гўшт (г) ва сих сонини киритинг");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await trpc.vitrina.addBatch.mutate({
        productId: picked.id,
        meatG: meatN,
        skewerCount: skewN,
        ...(normN > 0 ? { normG: normN } : {}),
      });
      setPicked(null);
      setSearch("");
      setMeatG("");
      setSkewers("");
      setNormG("");
      refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Хато");
    } finally {
      setBusy(false);
    }
  }

  async function saveCounts() {
    const entries = Object.entries(counts).filter(([, v]) => v.trim() !== "");
    if (!entries.length) return;
    setSavingCounts(true);
    try {
      for (const [productId, v] of entries) {
        await trpc.vitrina.count.mutate({
          productId,
          countedQty: Math.round(Number(v) || 0),
        });
      }
      setCounts({});
      refresh();
    } catch {
      // jimgina — keyingi saqlashda qayta urinadi
    } finally {
      setSavingCounts(false);
    }
  }

  const hasCountInput = Object.values(counts).some((v) => v.trim() !== "");

  return (
    <div className="space-y-5">
      {/* A — сих батчи қўшиш */}
      <section className="space-y-3 rounded-xl border bg-white p-4">
        <h2 className="text-sm font-semibold">Сих батчи — гўшт → сих</h2>
        <div className="relative">
          <input
            value={picked ? picked.name : search}
            onChange={(e) => {
              setPicked(null);
              setSearch(e.target.value);
            }}
            placeholder="Таом қидириш… (шашлик, люля…)"
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand"
          />
          {!picked && filtered.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border bg-white shadow-lg">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setPicked(p);
                    setSearch("");
                  }}
                  className="flex w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-zinc-500">
            Гўшт (г)
            <input
              inputMode="numeric"
              value={meatG}
              onChange={(e) => setMeatG(e.target.value.replace(/\D/g, ""))}
              placeholder="10000"
              className="mt-1 block w-28 rounded-lg border px-3 py-2 text-right text-sm tabular-nums outline-none focus:border-brand"
            />
          </label>
          <label className="text-xs text-zinc-500">
            Сих (дона)
            <input
              inputMode="numeric"
              value={skewers}
              onChange={(e) => setSkewers(e.target.value.replace(/\D/g, ""))}
              placeholder="65"
              className="mt-1 block w-24 rounded-lg border px-3 py-2 text-right text-sm tabular-nums outline-none focus:border-brand"
            />
          </label>
          <label className="text-xs text-zinc-500">
            Норма (г/сих)
            <input
              inputMode="numeric"
              value={normG}
              onChange={(e) => setNormG(e.target.value.replace(/\D/g, ""))}
              placeholder="140"
              className="mt-1 block w-24 rounded-lg border px-3 py-2 text-right text-sm tabular-nums outline-none focus:border-brand"
            />
          </label>
          <div className="ml-auto text-right text-xs text-zinc-500">
            <div>
              1 сих ≈{" "}
              <span className="font-semibold tabular-nums text-zinc-900">{actualG} г</span>
            </div>
            {devPct != null && (
              <div
                className={
                  Math.abs(devPct) > 10 ? "font-semibold text-red-500" : "text-emerald-600"
                }
              >
                нормадан {devPct > 0 ? "+" : ""}
                {devPct}%
              </div>
            )}
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex justify-end">
          <button
            onClick={addBatch}
            disabled={busy}
            className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? "…" : "Қўшиш"}
          </button>
        </div>
      </section>

      {/* B — бугунги сих батчлари */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-500">Бугунги сих батчлари</h2>
        <div className="overflow-hidden rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Таом</th>
                <th className="px-3 py-2 text-right font-medium">Гўшт</th>
                <th className="px-3 py-2 text-right font-medium">Сих</th>
                <th className="px-3 py-2 text-right font-medium">1 сих</th>
                <th className="px-4 py-2 text-right font-medium">Норма</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-2">{b.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(b.meatG)} г</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.skewerCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.actualG} г</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {b.devPct == null ? (
                      <span className="text-zinc-400">—</span>
                    ) : (
                      <span
                        className={
                          Math.abs(b.devPct) > 10
                            ? "font-semibold text-red-500"
                            : "text-emerald-600"
                        }
                      >
                        {Math.abs(b.devPct) > 10 ? "🚩 " : ""}
                        {b.devPct > 0 ? "+" : ""}
                        {b.devPct}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loaded && batches.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-zinc-400">
              Бугун сих батчи йўқ
            </div>
          )}
        </div>
      </section>

      {/* C — витрина баланси (тешик назорати) */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-500">
            Витрина баланси — тешик назорати
          </h2>
          <button
            onClick={saveCounts}
            disabled={savingCounts || !hasCountInput}
            className="rounded-lg bg-brand px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            {savingCounts ? "…" : "Санашни сақлаш"}
          </button>
        </div>
        <div className="overflow-hidden rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Таом</th>
                <th className="px-3 py-2 text-right font-medium">Кеча қолди</th>
                <th className="px-3 py-2 text-right font-medium">Сихланди</th>
                <th className="px-3 py-2 text-right font-medium">Сотилди</th>
                <th className="px-3 py-2 text-right font-medium">Кутилган</th>
                <th className="px-3 py-2 text-right font-medium">Саналди</th>
                <th className="px-4 py-2 text-right font-medium">Фарқ</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {recon.map((r) => (
                <tr key={r.productId}>
                  <td className="px-4 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-400">
                    {r.openingKnown ? r.opening : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.skewered}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.sold}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {r.expected}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      inputMode="numeric"
                      value={counts[r.productId] ?? (r.counted != null ? String(r.counted) : "")}
                      onChange={(e) =>
                        setCounts((c) => ({
                          ...c,
                          [r.productId]: e.target.value.replace(/\D/g, ""),
                        }))
                      }
                      placeholder="—"
                      className="w-16 rounded-lg border px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-brand"
                    />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.diff == null ? (
                      <span className="text-zinc-300">—</span>
                    ) : r.diff === 0 ? (
                      <span className="text-emerald-600">0</span>
                    ) : (
                      <span className="font-semibold text-red-500">
                        🚩 {r.diff > 0 ? "+" : ""}
                        {fmt(r.diff)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loaded && recon.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-zinc-400">
              Ҳали сих/сотув йўқ — юқорида батч қўшинг
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          Кутилган = кеча қолди + бугун сихланди − бугун сотилди. Фарқ 🚩 = витринадан
          назоратсиз кетган (тешик).
        </p>
      </section>
    </div>
  );
}
