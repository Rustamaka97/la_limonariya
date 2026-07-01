import { useCallback, useEffect, useState } from "react";
import { trpc } from "./trpc";

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const pad = (n: number) => String(n).padStart(2, "0");
const fmtT = (s: string) => {
  const d = new Date(s);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Same 06:00-cut business day as the server (see Moliya.tsx).
function todayBiz(): string {
  const t = new Date(Date.now() + 5 * 3600 * 1000);
  if (t.getUTCHours() < 6) t.setUTCDate(t.getUTCDate() - 1);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
function shiftDay(day: string, delta: number): string {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

type SkewerProduct = { productId: string; name: string; normG: number | null };
type Batch = {
  id: string;
  productId: string;
  name: string;
  meatG: number;
  skewerCount: number;
  normG: number | null;
  actualG: number;
  devPct: number | null;
  note: string | null;
  createdAt: string;
  by: string | null;
};
type ReconRow = {
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

export function Vitrina() {
  const [day, setDay] = useState(todayBiz());
  const [products, setProducts] = useState<SkewerProduct[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [recon, setRecon] = useState<ReconRow[]>([]);
  const [err, setErr] = useState(false);

  const refresh = useCallback(() => {
    setErr(false);
    Promise.all([
      trpc.vitrina.batches.query({ day }),
      trpc.vitrina.reconcile.query({ day }),
    ])
      .then(([b, r]) => {
        setBatches(b.rows);
        setRecon(r.rows);
      })
      .catch(() => setErr(true));
  }, [day]);

  useEffect(() => {
    refresh();
    trpc.vitrina.products.query().then(setProducts).catch(() => {});
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => setDay(shiftDay(day, -1))} className="rounded-lg border px-2.5 py-1.5 text-sm hover:bg-zinc-100">‹</button>
        <input
          type="date"
          value={day}
          max={todayBiz()}
          onChange={(e) => e.target.value && setDay(e.target.value)}
          className="rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-brand"
        />
        <button onClick={() => setDay(shiftDay(day, 1))} disabled={day >= todayBiz()} className="rounded-lg border px-2.5 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-30">›</button>
        <button onClick={() => setDay(todayBiz())} className="rounded-lg border px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100">Бугун</button>
      </div>

      {err && (
        <div className="rounded-xl border bg-white px-4 py-6 text-center text-sm text-zinc-500">
          Юкланмади.{" "}
          <button onClick={refresh} className="font-medium text-emerald-600 underline">Қайта уриниш</button>
        </div>
      )}

      {day === todayBiz() && <NewBatch products={products} onSaved={refresh} />}

      <BatchList batches={batches} />

      <Reconciliation day={day} rows={recon} onSaved={refresh} />
    </div>
  );
}

function NewBatch({ products, onSaved }: { products: SkewerProduct[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [meatKg, setMeatKg] = useState("");
  const [skewers, setSkewers] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const sel = products.find((p) => p.productId === productId) ?? null;
  const meatG = Math.round(Number(meatKg.replace(",", ".")) * 1000) || 0;
  const n = Number(skewers) || 0;
  const actualG = meatG > 0 && n > 0 ? Math.round(meatG / n) : null;
  const devPct =
    actualG != null && sel?.normG ? Math.round(((actualG - sel.normG) / sel.normG) * 100) : null;

  async function save() {
    if (!productId || meatG <= 0 || n <= 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await trpc.vitrina.batchCreate.mutate({ productId, meatG, skewerCount: n });
      setMsg(
        r.devPct != null && Math.abs(r.devPct) > 10
          ? `⚠️ Сақланди, лекин нормадан ${r.devPct > 0 ? "+" : ""}${r.devPct}% четлашиш!`
          : "✅ Сақланди",
      );
      setMeatKg("");
      setSkewers("");
      onSaved();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Хато");
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-xl bg-brand py-3 font-medium text-white"
      >
        ＋ Сихлаш батчи (гўшт → сих)
      </button>
    );

  return (
    <div className="space-y-3 rounded-xl border bg-white p-4">
      <h3 className="text-sm font-semibold">Сихлаш батчи</h3>
      <select
        value={productId}
        onChange={(e) => setProductId(e.target.value)}
        className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand"
      >
        <option value="">Таом танланг…</option>
        {products.map((p) => (
          <option key={p.productId} value={p.productId}>
            {p.name}
            {p.normG ? ` (норма ${p.normG} г/сих)` : ""}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <input
          inputMode="decimal"
          value={meatKg}
          onChange={(e) => setMeatKg(e.target.value)}
          placeholder="Гўшт, кг"
          className="w-28 rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand tabular-nums"
        />
        <input
          inputMode="numeric"
          value={skewers}
          onChange={(e) => setSkewers(e.target.value.replace(/\D/g, ""))}
          placeholder="Неча сих чиқди"
          className="w-36 rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand tabular-nums"
        />
        <button
          onClick={save}
          disabled={busy || !productId || meatG <= 0 || n <= 0}
          className="flex-1 rounded-lg bg-brand py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Сақлаш
        </button>
      </div>
      {actualG != null && (
        <p className="text-sm text-zinc-500">
          Ҳисоб: <b className="tabular-nums">{actualG} г/сих</b>
          {sel?.normG && devPct != null && (
            <span className={Math.abs(devPct) > 10 ? "font-medium text-red-600" : "text-emerald-600"}>
              {" "}
              (норма {sel.normG} г → {devPct > 0 ? "+" : ""}
              {devPct}%)
            </span>
          )}
        </p>
      )}
      {msg && <p className="text-sm">{msg}</p>}
      <button onClick={() => setOpen(false)} className="w-full py-1 text-xs text-zinc-400">
        Ёпиш
      </button>
    </div>
  );
}

function BatchList({ batches }: { batches: Batch[] }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      <div className="flex items-baseline justify-between border-b px-4 py-2.5">
        <h3 className="text-sm font-semibold">🍢 Кун батчлари</h3>
        <span className="text-xs text-zinc-400">{batches.length} та</span>
      </div>
      {batches.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-zinc-400">бу кунда батч йўқ</div>
      ) : (
        <ul className="divide-y text-sm">
          {batches.map((b) => (
            <li key={b.id} className="flex items-center justify-between px-4 py-2.5">
              <span>
                <span className="text-zinc-400">{fmtT(b.createdAt)}</span>{" "}
                <span className="font-medium">{b.name}</span>
                <span className="text-xs text-zinc-400"> · {b.by ?? "—"}</span>
              </span>
              <span className="flex items-center gap-2 text-xs">
                <span className="tabular-nums text-zinc-500">
                  {fmt(b.meatG / 1000)}кг → {b.skewerCount} сих ({b.actualG} г)
                </span>
                {b.devPct != null && Math.abs(b.devPct) > 10 && (
                  <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-red-700 tabular-nums">
                    {b.devPct > 0 ? "+" : ""}
                    {b.devPct}%
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Reconciliation({
  day,
  rows,
  onSaved,
}: {
  day: string;
  rows: ReconRow[];
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    const items = Object.entries(values)
      .filter(([, v]) => v !== "")
      .map(([productId, v]) => ({ productId, countedQty: Number(v) || 0 }));
    if (items.length === 0) return;
    setBusy(true);
    try {
      await trpc.vitrina.setCount.mutate({ day, items });
      setEditing(false);
      setValues({});
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      <div className="flex items-baseline justify-between border-b px-4 py-2.5">
        <h3 className="text-sm font-semibold">📊 Витрина баланси</h3>
        <span className="text-xs text-zinc-400">кечаги + сихланган − сотилган = қолиши керак</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-zinc-400">
          маълумот йўқ — аввал сихлаш батчи киритинг
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-zinc-400">
                <th className="px-4 py-2 font-medium">Таом</th>
                <th className="px-2 py-2 text-right font-medium">Кеча</th>
                <th className="px-2 py-2 text-right font-medium">Сихланди</th>
                <th className="px-2 py-2 text-right font-medium">Сотилди</th>
                <th className="px-2 py-2 text-right font-medium">Кутилган</th>
                <th className="px-2 py-2 text-right font-medium">Саналган</th>
                <th className="px-4 py-2 text-right font-medium">Фарқ</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.productId}>
                  <td className="px-4 py-2">{r.name}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-zinc-500">
                    {r.openingKnown ? r.opening : <span title="кеча саналмаган">0?</span>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.skewered}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.sold}</td>
                  <td className="px-2 py-2 text-right font-medium tabular-nums">{r.expected}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {editing ? (
                      <input
                        inputMode="numeric"
                        value={values[r.productId] ?? (r.counted != null ? String(r.counted) : "")}
                        onChange={(e) =>
                          setValues((v) => ({
                            ...v,
                            [r.productId]: e.target.value.replace(/\D/g, ""),
                          }))
                        }
                        className="w-16 rounded-lg border px-2 py-1 text-right outline-none focus:border-brand"
                      />
                    ) : r.counted != null ? (
                      r.counted
                    ) : (
                      <span className="text-zinc-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {r.diff != null &&
                      (r.diff === 0 ? (
                        <span className="text-emerald-600">🟢 0</span>
                      ) : (
                        <span className="font-medium text-red-600 tabular-nums">
                          {r.diff > 0 ? "+" : ""}
                          {r.diff}
                        </span>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && (
        <div className="border-t px-4 py-3">
          {editing ? (
            <div className="flex gap-2">
              <button
                onClick={() => setEditing(false)}
                disabled={busy}
                className="flex-1 rounded-lg border py-2 text-sm disabled:opacity-40"
              >
                Бекор
              </button>
              <button
                onClick={save}
                disabled={busy}
                className="flex-1 rounded-lg bg-brand py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Санашни сақлаш
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="w-full rounded-lg border py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
            >
              🔢 Витринани санаш (кун охири)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
