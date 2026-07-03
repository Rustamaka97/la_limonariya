import { Fragment, useEffect, useState } from "react";
import { downloadCsv } from "./lib/csv";
import { trpc } from "./trpc";

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");

function CsvBtn({ rows, name }: { rows: Record<string, unknown>[]; name: string }) {
  if (!rows.length) return null;
  return (
    <button
      onClick={() => downloadCsv(`${name}.csv`, rows)}
      className="rounded-lg border px-3 py-1.5 text-sm font-medium text-zinc-500 hover:bg-zinc-100"
    >
      ⬇ CSV
    </button>
  );
}
const pad = (n: number) => String(n).padStart(2, "0");
function todayBiz(): string {
  const n = new Date();
  if (n.getHours() < 6) n.setDate(n.getDate() - 1);
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}
function shiftDay(day: string, delta: number): string {
  const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
function fmtShort(dayKey: string): string {
  const [, m, d] = dayKey.split("-");
  return `${d}.${m}`;
}

type Sub = "trend" | "category" | "dishes" | "waiters" | "cashiers" | "matrix";

export function Hisobot() {
  const [sub, setSub] = useState<Sub>("trend");
  const [from, setFrom] = useState(shiftDay(todayBiz(), -6));
  const [to, setTo] = useState(todayBiz());

  const tabs: { k: Sub; label: string }[] = [
    { k: "trend", label: "Тренд" },
    { k: "category", label: "Категория" },
    { k: "dishes", label: "Топ таомлар" },
    { k: "waiters", label: "Официантлар" },
    { k: "cashiers", label: "Кассирлар" },
    { k: "matrix", label: "Ҳаракат" },
  ];

  const quick = (n: number) => {
    setTo(todayBiz());
    setFrom(shiftDay(todayBiz(), -(n - 1)));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.k}
            onClick={() => setSub(t.k)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              sub === t.k ? "bg-brand text-white" : "bg-white text-zinc-500 hover:bg-zinc-100"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub !== "trend" && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => quick(7)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-zinc-100">7 кун</button>
          <button onClick={() => quick(30)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-zinc-100">30 кун</button>
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-brand" />
          <span className="text-zinc-400">—</span>
          <input type="date" value={to} max={todayBiz()} onChange={(e) => e.target.value && setTo(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-brand" />
        </div>
      )}

      {sub === "trend" && <Trend />}
      {sub === "category" && <Category from={from} to={to} />}
      {sub === "dishes" && <TopDishes from={from} to={to} />}
      {sub === "waiters" && <Waiters from={from} to={to} />}
      {sub === "cashiers" && <Cashiers from={from} to={to} />}
      {sub === "matrix" && <Matrix from={from} to={to} />}
    </div>
  );
}

function ErrBox({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-xl border bg-white px-4 py-8 text-center text-sm text-zinc-500">
      Юкланмади.{" "}
      <button onClick={onRetry} className="font-medium text-emerald-600 underline">
        Қайта уриниш
      </button>
    </div>
  );
}

type DayRow = { dayKey: string; revenue: number; checks: number; avgCheck: number };

function Trend() {
  const [data, setData] = useState<{ rows: DayRow[]; breakEvenHint: number } | null>(null);
  const [err, setErr] = useState(false);
  function load() {
    setErr(false);
    trpc.report.salesDaily.query({ days: 14 }).then(setData).catch(() => setErr(true));
  }
  useEffect(load, []);

  if (err) return <ErrBox onRetry={load} />;
  if (!data) return <div className="p-6 text-center text-zinc-400">⏳</div>;
  const { rows, breakEvenHint } = data;

  const max = Math.max(1, ...rows.map((r) => r.revenue));
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalChecks = rows.reduce((s, r) => s + r.checks, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-white p-3">
          <div className="text-xs text-zinc-500">{rows.length} кунлик тушум</div>
          <div className="mt-0.5 text-xl font-bold tabular-nums">{fmt(totalRevenue)}</div>
        </div>
        <div className="rounded-xl border bg-white p-3">
          <div className="text-xs text-zinc-500">Ўрт./кун</div>
          <div className="mt-0.5 text-xl font-bold tabular-nums">{fmt(totalRevenue / (rows.length || 1))}</div>
        </div>
        <div className="rounded-xl border bg-white p-3">
          <div className="text-xs text-zinc-500">Жами чек</div>
          <div className="mt-0.5 text-xl font-bold tabular-nums">{totalChecks}</div>
        </div>
      </div>
      <div className="rounded-xl border bg-white p-4">
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.dayKey} className="flex items-center gap-3 text-sm">
              <span className="w-10 shrink-0 text-xs text-zinc-400">{fmtShort(r.dayKey)}</span>
              <div className="h-5 flex-1 overflow-hidden rounded bg-zinc-100">
                <div
                  className={`h-full rounded ${r.revenue >= breakEvenHint ? "bg-emerald-500" : "bg-amber-400"}`}
                  style={{ width: `${Math.max(2, (r.revenue / max) * 100)}%` }}
                />
              </div>
              <span className="w-24 shrink-0 text-right tabular-nums text-zinc-600">{fmt(r.revenue)}</span>
              <span className="w-10 shrink-0 text-right text-xs text-zinc-400">{r.checks} чек</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-zinc-400">🟢 break-even (~{fmt(breakEvenHint)}) устида · 🟡 остида</p>
      </div>
    </div>
  );
}

type CatRow = { category: string; revenue: number; qty: number; pct: number };

function Category({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<CatRow[] | null>(null);
  const [err, setErr] = useState(false);
  function load() {
    setErr(false);
    setRows(null);
    trpc.report.byCategory.query({ from, to }).then(setRows).catch(() => setErr(true));
  }
  useEffect(load, [from, to]);

  if (err) return <ErrBox onRetry={load} />;
  if (!rows) return <div className="p-6 text-center text-zinc-400">⏳</div>;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <CsvBtn rows={rows} name="категория" />
      </div>
      <div className="overflow-hidden rounded-xl border bg-white">
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-zinc-400">бу даврда савдо йўқ</div>
      ) : (
        <div className="divide-y text-sm">
          {rows.map((r) => (
            <div key={r.category} className="flex items-center justify-between px-4 py-2.5">
              <span className="font-medium">{r.category}</span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-zinc-400">{r.qty} дона</span>
                <span className="tabular-nums">{fmt(r.revenue)}</span>
                <span className="w-10 rounded-full bg-zinc-100 px-2 py-0.5 text-center text-xs font-medium text-zinc-600 tabular-nums">{r.pct}%</span>
              </span>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

type DishRow = { productId: string; name: string; qty: number; revenue: number; meatCostTotal: number | null; profit: number | null };

function TopDishes({ from, to }: { from: string; to: string }) {
  const [by, setBy] = useState<"profit" | "qty">("profit");
  const [rows, setRows] = useState<DishRow[] | null>(null);
  const [err, setErr] = useState(false);
  function load() {
    setErr(false);
    setRows(null);
    trpc.report.topDishes.query({ from, to, by, limit: 15 }).then(setRows).catch(() => setErr(true));
  }
  useEffect(load, [from, to, by]);

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <button onClick={() => setBy("profit")} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${by === "profit" ? "bg-zinc-900 text-white" : "bg-white text-zinc-500 hover:bg-zinc-100"}`}>
          Фойда бўйича
        </button>
        <button onClick={() => setBy("qty")} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${by === "qty" ? "bg-zinc-900 text-white" : "bg-white text-zinc-500 hover:bg-zinc-100"}`}>
          Сотув бўйича
        </button>
        <span className="ml-auto">{rows && <CsvBtn rows={rows} name="топ-таомлар" />}</span>
      </div>
      <p className="text-xs text-zinc-400">Фойда жорий гўшт нархи асосида тахминланади (тарихий эмас)</p>
      {err ? (
        <ErrBox onRetry={load} />
      ) : !rows ? (
        <div className="p-6 text-center text-zinc-400">⏳</div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white">
          {rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-zinc-400">бу даврда савдо йўқ</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Таом</th>
                  <th className="px-3 py-2 text-right font-medium">Сотилди</th>
                  <th className="px-3 py-2 text-right font-medium">Тушум</th>
                  <th className="px-3 py-2 text-right font-medium">Фойда</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r, i) => (
                  <tr key={r.productId}>
                    <td className="px-3 py-1.5">
                      <span className="mr-1.5 text-zinc-300">{i + 1}.</span>
                      {r.name}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-zinc-500">{r.qty}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.revenue)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">
                      {r.profit != null ? <span className={r.profit >= 0 ? "text-emerald-600" : "text-red-600"}>{fmt(r.profit)}</span> : <span className="text-zinc-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

type WaiterRow = { waiterId: string; name: string; revenue: number; checks: number };

function Waiters({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<WaiterRow[] | null>(null);
  const [err, setErr] = useState(false);
  function load() {
    setErr(false);
    setRows(null);
    trpc.report.byWaiter.query({ from, to }).then(setRows).catch(() => setErr(true));
  }
  useEffect(load, [from, to]);

  if (err) return <ErrBox onRetry={load} />;
  if (!rows) return <div className="p-6 text-center text-zinc-400">⏳</div>;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <CsvBtn rows={rows} name="официантлар" />
      </div>
      <div className="overflow-hidden rounded-xl border bg-white">
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-zinc-400">бу даврда савдо йўқ</div>
      ) : (
        <div className="divide-y text-sm">
          {rows.map((r) => (
            <div key={r.waiterId} className="flex items-center justify-between px-4 py-2.5">
              <span className="font-medium">{r.name}</span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-zinc-400">{r.checks} чек</span>
                <span className="tabular-nums">{fmt(r.revenue)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

type CashierRow = { cashierId: string; name: string; revenue: number; debtIssued: number; checks: number };

function Cashiers({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<CashierRow[] | null>(null);
  const [err, setErr] = useState(false);
  function load() {
    setErr(false);
    setRows(null);
    trpc.report.byCashier.query({ from, to }).then(setRows).catch(() => setErr(true));
  }
  useEffect(load, [from, to]);

  if (err) return <ErrBox onRetry={load} />;
  if (!rows) return <div className="p-6 text-center text-zinc-400">⏳</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-400">Ким ёпди · ким кўп қарзга берди (сохта қарз назорати)</p>
        <CsvBtn rows={rows} name="кассирлар" />
      </div>
      <div className="overflow-hidden rounded-xl border bg-white">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-400">бу даврда ёпилган чек йўқ</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Кассир</th>
                <th className="px-3 py-2 text-right font-medium">Чек</th>
                <th className="px-3 py-2 text-right font-medium">Тушум</th>
                <th className="px-4 py-2 text-right font-medium">Қарзга берди</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.cashierId}>
                  <td className="px-4 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{r.checks}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.revenue)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {r.debtIssued > 0 ? <span className="text-amber-600">{fmt(r.debtIssued)}</span> : <span className="text-zinc-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

type MatrixCell = { date: string; in: number; out: number; close: number };
type MatrixData = { days: string[]; rows: { productId: string; name: string; unit: string; cells: MatrixCell[] }[] };

const uq = (base: number, unit: string) => {
  if (unit === "dona") return String(base);
  const liquid = unit === "l" || unit === "ml";
  return Math.abs(base) >= 1000 ? (base / 1000).toFixed(1) + (liquid ? "л" : "") : String(base) + (liquid ? "мл" : "г");
};
const dmd = (d: string) => d.slice(5); // MM-DD

function Matrix({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<MatrixData | null>(null);
  const [err, setErr] = useState(false);
  function load() {
    setErr(false);
    setData(null);
    trpc.report.stockMatrix.query({ from, to }).then(setData).catch(() => setErr(true));
  }
  useEffect(load, [from, to]);

  if (err) return <ErrBox onRetry={load} />;
  if (!data) return <div className="p-6 text-center text-zinc-400">⏳</div>;
  if (!data.rows.length) return <div className="p-6 text-center text-sm text-zinc-400">бу даврда ҳаракат йўқ</div>;

  const csvRows = data.rows.flatMap((r) => r.cells.map((c) => ({ маҳсулот: r.name, сана: c.date, приход: c.in, расход: c.out, остаток: c.close })));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-400">Приход / Расход / Остаток — ҳар маҳсулот, ҳар кун (кг/дона)</p>
        <CsvBtn rows={csvRows} name="ҳаракат-жадвали" />
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="text-xs">
          <thead className="bg-zinc-50 text-zinc-500">
            <tr>
              <th className="sticky left-0 z-10 bg-zinc-50 px-3 py-2 text-left font-medium">Маҳсулот</th>
              {data.days.map((d) => (
                <th key={d} className="px-2 py-2 text-center font-medium" colSpan={3}>{dmd(d)}</th>
              ))}
            </tr>
            <tr className="text-[10px] text-zinc-400">
              <th className="sticky left-0 z-10 bg-zinc-50" />
              {data.days.map((d) => (
                <Fragment key={d}>
                  <th className="px-1 py-1 text-right font-normal text-emerald-600">+</th>
                  <th className="px-1 py-1 text-right font-normal text-red-500">−</th>
                  <th className="px-1.5 py-1 text-right font-medium">ост</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.rows.map((r) => (
              <tr key={r.productId}>
                <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-1.5 font-medium">{r.name}</td>
                {r.cells.map((c) => (
                  <Fragment key={c.date}>
                    <td className="px-1 py-1.5 text-right tabular-nums text-emerald-600">{c.in ? uq(c.in, r.unit) : ""}</td>
                    <td className="px-1 py-1.5 text-right tabular-nums text-red-500">{c.out ? uq(c.out, r.unit) : ""}</td>
                    <td className={`px-1.5 py-1.5 text-right tabular-nums font-medium ${c.close < 0 ? "text-red-600" : ""}`}>{uq(c.close, r.unit)}</td>
                  </Fragment>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
