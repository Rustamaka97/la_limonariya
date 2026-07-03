import { useCallback, useEffect, useState } from "react";
import { trpc } from "./trpc";

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const pad = (n: number) => String(n).padStart(2, "0");

const CAT: Record<string, string> = {
  ijara: "Ижара",
  gaz: "Газ",
  elektr: "Свет",
  ish_haqi: "Ойлик",
  jihoz: "Жиҳоз",
  boshqa: "Бошқа",
  ega_oldi: "👑 Эга олди",
};
const CATS = Object.keys(CAT);
const METHOD: Record<string, string> = {
  cash: "Нақд",
  card: "Карта",
  click: "Click",
  payme: "Payme",
  debt: "Қарз",
};

// Operational day in Asia/Tashkent (UTC+5, no DST), 06:00 cut — matches server time.ts
// regardless of the browser's OS timezone.
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

type Sub = "day" | "expense" | "pnl" | "debt";

export function Moliya() {
  const [sub, setSub] = useState<Sub>("day");
  const tabs: { k: Sub; label: string }[] = [
    { k: "day", label: "Кунлик ёпилиш" },
    { k: "expense", label: "Харажат" },
    { k: "pnl", label: "P&L" },
    { k: "debt", label: "Қарзлар" },
  ];
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
      {sub === "day" && <DayClose />}
      {sub === "expense" && <Expenses />}
      {sub === "pnl" && <Pnl />}
      {sub === "debt" && <Debts />}
    </div>
  );
}

function Big({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad" | "plain";
}) {
  const c =
    tone === "good"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "bad"
        ? "border-red-200 bg-red-50 text-red-700"
        : "bg-white";
  return (
    <div className={`rounded-xl border p-3 ${c}`}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-0.5 text-xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-zinc-400">{sub}</div>}
    </div>
  );
}

function DayPicker({ day, setDay }: { day: string; setDay: (d: string) => void }) {
  return (
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
  );
}

type Fin = {
  revenue: number;
  byMethod: Record<string, number>;
  cardTax: number;
  guestDebt: number;
  checks: number;
  avgCheck: number;
  cogs: number;
  cogsPartial: boolean;
  unpricedCount: number;
  unpricedNames: string[];
  opex: number;
  opexByCat: Record<string, number>;
  ownerDraw: number;
  refundTotal: number;
  discountTotal: number;
  sofFoyda: number;
};

function FinView({ f }: { f: Fin }) {
  const margin = f.revenue > 0 ? Math.round((f.sofFoyda / f.revenue) * 100) : null;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Big label="Тушум" value={fmt(f.revenue)} sub="so'm" />
        <Big
          label="Соф фойда"
          value={fmt(f.sofFoyda)}
          sub={margin != null ? `${margin}%` : "so'm"}
          tone={f.sofFoyda >= 0 ? "good" : "bad"}
        />
        <Big label="Себестоимость" value={fmt(f.cogs)} sub={f.cogsPartial ? "қисман ⚠️" : "списание"} />
        <Big label="Харажат (OPEX)" value={fmt(f.opex)} sub="so'm" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-xl border bg-white">
          <div className="border-b px-4 py-2.5 text-sm font-semibold">Тўлов турлари</div>
          <div className="divide-y text-sm">
            {Object.keys(METHOD)
              .filter((m) => m !== "debt" && (f.byMethod[m] ?? 0) > 0)
              .map((m) => (
                <Row key={m} l={METHOD[m] ?? m} v={fmt(f.byMethod[m] ?? 0)} />
              ))}
            {f.cardTax > 0 && <Row l="Солиқ (4% карта)" v={`−${fmt(f.cardTax)}`} muted />}
            {f.guestDebt > 0 && <Row l="Меҳмон қарзи (олинмаган)" v={fmt(f.guestDebt)} muted />}
            {f.refundTotal > 0 && <Row l="Возврат" v={`−${fmt(f.refundTotal)}`} muted />}
            {f.discountTotal > 0 && <Row l="Чегирма" v={`−${fmt(f.discountTotal)}`} muted />}
            {f.ownerDraw > 0 && (
              <Row l="👑 Эга олди (фойдадан ташқари)" v={`−${fmt(f.ownerDraw)}`} muted />
            )}
            <Row l="Чек" v={`${f.checks} та · ўрт. ${fmt(f.avgCheck)}`} muted />
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border bg-white">
          <div className="border-b px-4 py-2.5 text-sm font-semibold">Харажатлар</div>
          {Object.keys(f.opexByCat).length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-zinc-400">харажат йўқ</div>
          ) : (
            <div className="divide-y text-sm">
              {Object.entries(f.opexByCat).map(([c, v]) => (
                <Row key={c} l={CAT[c] ?? c} v={fmt(v)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {f.cogsPartial && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-700">
          ⚠️ Себестоимость <b>қисман</b> — списание асосида (салат/ичимлик/тарозили
          таомлар кирмайди), шунинг учун реал соф фойда бундан бироз пастроқ.
          {f.unpricedCount > 0 && (
            <>
              {" "}
              {f.unpricedCount} та маҳсулот нархсиз: {f.unpricedNames.join(", ")} —
              харид киритсангиз аниқлашади.
            </>
          )}
        </div>
      )}
    </>
  );
}

function Row({ l, v, muted }: { l: string; v: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2">
      <span className={muted ? "text-zinc-400" : ""}>{l}</span>
      <span className={`tabular-nums ${muted ? "text-zinc-400" : "font-medium"}`}>{v}</span>
    </div>
  );
}

function DayClose() {
  const [day, setDay] = useState(todayBiz());
  const [f, setF] = useState<Fin | null>(null);
  const [err, setErr] = useState(false);
  const load = useCallback(() => {
    setF(null);
    setErr(false);
    trpc.finance.dayClose.query({ day }).then(setF).catch(() => setErr(true));
  }, [day]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <div className="space-y-4">
      <DayPicker day={day} setDay={setDay} />
      {err ? (
        <ErrBox onRetry={load} />
      ) : !f ? (
        <div className="p-6 text-center text-zinc-400">⏳</div>
      ) : (
        <>
          <FinView f={f} />
          <TillCount day={day} />
        </>
      )}
    </div>
  );
}

type TillData = {
  dayKey: string;
  floatAmount: number;
  cashRevenue: number;
  cashDebtRepaid: number;
  cashExpenses: number;
  cashCollected: number;
  expectedCash: number;
  openedAt: string | null;
  openedByName: string | null;
  countedCash: number | null;
  closedAt: string | null;
  variance: number | null;
  note: string | null;
};
type CashCollection = { id: string; amount: number; note: string; createdAt: string; performedByName: string | null };
const fmtTime = (s: string | null) => {
  if (!s) return "";
  const d = new Date(s);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function TillCount({ day }: { day: string }) {
  const [t, setT] = useState<TillData | null>(null);
  const [counted, setCounted] = useState("");
  const [busy, setBusy] = useState(false);
  const [openBusy, setOpenBusy] = useState(false);
  const [err, setErr] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [collections, setCollections] = useState<CashCollection[]>([]);
  const [collecting, setCollecting] = useState(false);
  const [colAmount, setColAmount] = useState("");
  const [colNote, setColNote] = useState("");
  const [colBusy, setColBusy] = useState(false);

  const refresh = useCallback(() => {
    setErr(false);
    trpc.finance.tillCount.get
      .query({ day })
      .then((d) => { setT(d); setCounted(d.countedCash != null ? String(d.countedCash) : ""); })
      .catch(() => { setT(null); setErr(true); });
    trpc.finance.cashCollections.query({ from: day, to: day }).then(setCollections).catch(() => setCollections([]));
  }, [day]);
  useEffect(() => {
    setT(null);
    refresh();
  }, [refresh]);

  async function openShift() {
    setOpenBusy(true);
    try {
      await trpc.finance.tillCount.open.mutate({ day });
      refresh();
    } finally {
      setOpenBusy(false);
    }
  }

  async function save() {
    const c = Math.round(Number(counted) || 0);
    setBusy(true);
    setSaveErr(null);
    try {
      await trpc.finance.tillCount.set.mutate({ day, countedCash: c });
      refresh();
    } catch (e: unknown) {
      setSaveErr(e instanceof Error ? e.message : "Хато");
    } finally {
      setBusy(false);
    }
  }

  async function saveCollection() {
    const n = Math.round(Number(colAmount));
    if (!n || n <= 0 || !colNote.trim()) return;
    setColBusy(true);
    try {
      await trpc.finance.collectCash.mutate({ amount: n, note: colNote.trim() });
      setColAmount("");
      setColNote("");
      setCollecting(false);
      refresh();
    } finally {
      setColBusy(false);
    }
  }

  if (err) return <ErrBox onRetry={refresh} />;
  if (!t) return <div className="rounded-xl border bg-white p-6 text-center text-zinc-400">⏳</div>;

  if (!t.openedAt)
    return (
      <div className="rounded-xl border bg-white p-4">
        <div className="mb-3 text-sm font-semibold">Смена</div>
        <p className="mb-3 text-sm text-zinc-500">Смена ҳали очилмаган — очмасдан касса ишламайди.</p>
        <button
          onClick={openShift}
          disabled={openBusy}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Смена очиш
        </button>
      </div>
    );

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">Касса санаш (камомад)</div>
        <div className="text-xs text-zinc-400">
          Очилди {fmtTime(t.openedAt)} · {t.openedByName ?? "—"}
          {t.closedAt && ` · Ёпилди ${fmtTime(t.closedAt)}`}
        </div>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-zinc-500 sm:grid-cols-5">
        <span>Размен: <b className="text-zinc-700">{fmt(t.floatAmount)}</b></span>
        <span>Нақд тушум: <b className="text-zinc-700">{fmt(t.cashRevenue)}</b></span>
        <span>Қарз қайтган: <b className="text-zinc-700">{fmt(t.cashDebtRepaid)}</b></span>
        <span>Нақд харажат: <b className="text-zinc-700">{fmt(t.cashExpenses)}</b></span>
        <span>Инкассация: <b className="text-zinc-700">{fmt(t.cashCollected)}</b></span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-zinc-500">Кутилган: <b className="tabular-nums">{fmt(t.expectedCash)}</b></span>
        <input
          inputMode="numeric"
          value={counted}
          onChange={(e) => setCounted(e.target.value.replace(/\D/g, ""))}
          placeholder="реал санаб чиқилган"
          className="w-44 rounded-lg border px-3 py-1.5 text-sm tabular-nums outline-none focus:border-brand"
        />
        <button onClick={save} disabled={busy || !counted} className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40">Сақлаш</button>
        {t.variance != null && (
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ${t.variance === 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
            {t.variance === 0 ? "тенг ✓" : `камомад ${t.variance > 0 ? "+" : ""}${fmt(t.variance)}`}
          </span>
        )}
      </div>
      {saveErr && <p className="mt-2 text-sm text-red-600">{saveErr}</p>}

      <div className="mt-3 border-t pt-3">
        {collections.length > 0 && (
          <div className="mb-2 space-y-1 text-xs text-zinc-500">
            {collections.map((c) => (
              <div key={c.id} className="flex items-center justify-between">
                <span>{c.note} · {c.performedByName ?? "—"}</span>
                <span className="tabular-nums font-medium text-zinc-700">−{fmt(c.amount)}</span>
              </div>
            ))}
          </div>
        )}
        {!collecting ? (
          <button
            onClick={() => setCollecting(true)}
            className="text-sm font-medium text-brand hover:underline"
          >
            + Инкассация (кассадан пул олиш)
          </button>
        ) : (
          <div className="space-y-2 rounded-lg bg-zinc-50 p-3">
            <div className="flex gap-2">
              <input
                inputMode="numeric"
                value={colAmount}
                onChange={(e) => setColAmount(e.target.value.replace(/\D/g, ""))}
                placeholder="сумма"
                className="w-32 rounded-lg border px-2 py-1.5 text-sm tabular-nums outline-none focus:border-brand"
              />
              <input
                value={colNote}
                onChange={(e) => setColNote(e.target.value)}
                placeholder="изоҳ (мажбурий) — мас. сейфга ўтказилди"
                className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-brand"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setCollecting(false)} className="flex-1 rounded-lg border py-1.5 text-sm">Бекор</button>
              <button
                onClick={saveCollection}
                disabled={colBusy || !colAmount || !colNote.trim()}
                className="flex-1 rounded-lg bg-brand py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                Сақлаш
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type Exp = {
  id: string;
  category: string;
  amount: number;
  method: string;
  recurring: boolean;
  note: string | null;
  spentAt: string;
};

function Expenses() {
  const [day, setDay] = useState(todayBiz());
  const [data, setData] = useState<{ rows: Exp[]; total: number } | null>(null);
  const [err, setErr] = useState(false);
  const refresh = useCallback(() => {
    setData(null);
    setErr(false);
    trpc.finance.expenses.list
      .query({ day })
      .then((d) => setData({ rows: d.rows, total: d.total }))
      .catch(() => setErr(true));
  }, [day]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <DayPicker day={day} setDay={setDay} />
      <ExpenseForm day={day} onSaved={refresh} />
      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="flex items-center justify-between border-b px-4 py-2.5 text-sm">
          <span className="font-semibold">Харажатлар</span>
          <span className="font-medium tabular-nums">{fmt(data?.total ?? 0)} so'm</span>
        </div>
        {err ? (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">
            Юкланмади.{" "}
            <button onClick={refresh} className="font-medium text-emerald-600 underline">қайта</button>
          </div>
        ) : !data ? (
          <div className="px-4 py-6 text-center text-zinc-400">⏳</div>
        ) : data.rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-zinc-400">бу кунда харажат йўқ</div>
        ) : (
          <div className="divide-y text-sm">
            {data.rows.map((e) => (
              <div key={e.id} className="flex items-center justify-between px-4 py-2">
                <span className="flex items-center gap-2">
                  <span className="font-medium">{CAT[e.category] ?? e.category}</span>
                  {e.recurring && <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">такрорий</span>}
                  {e.note && <span className="text-xs text-zinc-400">{e.note}</span>}
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums font-medium">{fmt(e.amount)}</span>
                  <button
                    onClick={() => trpc.finance.expenses.delete.mutate({ id: e.id }).then(refresh)}
                    className="text-zinc-300 hover:text-red-500"
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ExpenseForm({ day, onSaved }: { day: string; onSaved: () => void }) {
  const [cat, setCat] = useState("ijara");
  const [amount, setAmount] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const amt = Math.round(Number(amount) || 0);
    if (amt <= 0) return;
    setBusy(true);
    try {
      await trpc.finance.expenses.create.mutate({
        category: cat as "ijara",
        amount: amt,
        recurring,
        note: note.trim() || undefined,
        day,
      });
      setAmount("");
      setNote("");
      setRecurring(false);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border bg-white p-4">
      <div className="text-sm font-semibold">Янги харажат</div>
      <div className="flex flex-wrap gap-1.5">
        {CATS.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`rounded-lg px-3 py-1.5 text-sm ${cat === c ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}
          >
            {CAT[c]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          placeholder="сумма (so'm)"
          className="w-40 rounded-lg border px-3 py-2 text-sm tabular-nums outline-none focus:border-brand"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="изоҳ (ихтиёрий)"
          className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <label className="flex items-center gap-1.5 text-sm text-zinc-500">
          <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
          такрорий
        </label>
        <button
          onClick={save}
          disabled={busy || !amount}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Сақлаш
        </button>
      </div>
    </div>
  );
}

type Pnl = Fin & {
  days: number;
  dailyAvg: number;
  marginPct: number | null;
  breakEvenPerDay: number | null;
};

function Pnl() {
  const [from, setFrom] = useState(shiftDay(todayBiz(), -6));
  const [to, setTo] = useState(todayBiz());
  const [p, setP] = useState<Pnl | null>(null);
  const [err, setErr] = useState(false);
  const load = useCallback(() => {
    setP(null);
    setErr(false);
    trpc.finance.pnl.query({ from, to }).then(setP).catch(() => setErr(true));
  }, [from, to]);
  useEffect(() => {
    load();
  }, [load]);

  const quick = (n: number) => {
    setTo(todayBiz());
    setFrom(shiftDay(todayBiz(), -(n - 1)));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => quick(1)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-zinc-100">Бугун</button>
        <button onClick={() => quick(7)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-zinc-100">7 кун</button>
        <button onClick={() => quick(30)} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-zinc-100">30 кун</button>
        <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-brand" />
        <span className="text-zinc-400">—</span>
        <input type="date" value={to} max={todayBiz()} onChange={(e) => e.target.value && setTo(e.target.value)} className="rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-brand" />
      </div>

      {err ? (
        <ErrBox onRetry={load} />
      ) : !p ? (
        <div className="p-6 text-center text-zinc-400">⏳</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Big label={`Тушум (${p.days} кун)`} value={fmt(p.revenue)} sub={`ўрт. ${fmt(p.dailyAvg)}/кун`} />
            <Big label="Соф фойда" value={fmt(p.sofFoyda)} sub={p.marginPct != null ? `${p.marginPct}%` : ""} tone={p.sofFoyda >= 0 ? "good" : "bad"} />
            <Big label="Себестоимость" value={fmt(p.cogs)} sub={p.cogsPartial ? "қисман ⚠️" : ""} />
            <Big label="Break-even" value={p.breakEvenPerDay != null ? fmt(p.breakEvenPerDay) : "—"} sub={p.cogsPartial ? "⚠️ қисман COGS" : "so'm/кун керак"} />
          </div>
          <FinView f={p} />
          <div className="rounded-xl bg-zinc-50 px-4 py-3 text-xs text-zinc-500">
            📊 Эга баҳоси (2026-06): ~21 млн/кун тушум · ~27% фойда · break-even
            ~8.9 млн/кун. Юқоридагилар реал списание + харажатдан ҳисобланади.
          </div>
        </>
      )}
    </div>
  );
}

type Debt = {
  supplier: { id: string; supplier: string | null; total: number; paidTotal: number; outstanding: number; createdAt: string }[];
  supplierTotal: number;
  guest: { orderId: string; tableNo: string | null; hall: string | null; closedAt: string | null; outstanding: number; customerName: string | null; customerPhone: string | null }[];
  guestTotal: number;
};

type PayTarget = {
  title: string;
  outstanding: number;
  showMethod?: boolean;
  onPay: (amount: number, method?: string) => Promise<void>;
};

function Debts() {
  const [d, setD] = useState<Debt | null>(null);
  const [err, setErr] = useState(false);
  const [pay, setPay] = useState<PayTarget | null>(null);
  const refresh = useCallback(() => {
    setErr(false);
    trpc.finance.debts.query().then(setD).catch(() => setErr(true));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  if (err) return <ErrBox onRetry={refresh} />;
  if (!d) return <div className="p-6 text-center text-zinc-400">⏳</div>;
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="flex items-center justify-between border-b px-4 py-2.5 text-sm">
          <span className="font-semibold">🔴 Биз қарздормиз (етказувчи)</span>
          <span className="font-medium tabular-nums text-red-600">{fmt(d.supplierTotal)} so'm</span>
        </div>
        {d.supplier.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-zinc-400">қарз йўқ — ҳаммаси тўланган</div>
        ) : (
          <div className="divide-y text-sm">
            {d.supplier.map((s) => (
              <div key={s.id} className="flex items-center justify-between px-4 py-2">
                <span>
                  <span className="font-medium">{s.supplier ?? "Етказувчи"}</span>{" "}
                  <span className="text-xs text-zinc-400">{fmt(s.paidTotal)} / {fmt(s.total)}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums font-medium text-red-600">{fmt(s.outstanding)}</span>
                  <button
                    onClick={() =>
                      setPay({
                        title: `${s.supplier ?? "Етказувчи"}га тўлов`,
                        outstanding: s.outstanding,
                        onPay: async (amount) => {
                          await trpc.finance.paySupplier.mutate({ purchaseId: s.id, amount });
                        },
                      })
                    }
                    className="rounded-lg bg-brand px-3 py-1 text-xs font-medium text-white"
                  >
                    Тўлов
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="flex items-center justify-between border-b px-4 py-2.5 text-sm">
          <span className="font-semibold">🟡 Бизга қарздор (меҳмон)</span>
          <span className="font-medium tabular-nums">{fmt(d.guestTotal)} so'm</span>
        </div>
        {d.guest.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-zinc-400">меҳмон қарзи йўқ</div>
        ) : (
          <div className="divide-y text-sm">
            {d.guest.map((g) => (
              <div key={g.orderId} className="flex items-center justify-between px-4 py-2">
                <span className="text-zinc-500">
                  <span className="font-medium text-zinc-700">{g.customerName ?? "Меҳмон"}</span>
                  {g.customerPhone && <span className="text-xs"> · {g.customerPhone}</span>}
                  <span className="text-xs"> · {g.hall ?? "—"}{g.tableNo ? ` стол ${g.tableNo}` : ""}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums font-medium">{fmt(g.outstanding)}</span>
                  <button
                    onClick={() =>
                      setPay({
                        title: `${g.customerName ?? "Меҳмон"} тўлови`,
                        outstanding: g.outstanding,
                        showMethod: true,
                        onPay: async (amount, method) => {
                          await trpc.finance.payGuestDebt.mutate({
                            orderId: g.orderId,
                            amount,
                            method: (method as "cash" | "card" | "click" | "payme") ?? "cash",
                          });
                        },
                      })
                    }
                    className="rounded-lg bg-brand px-3 py-1 text-xs font-medium text-white"
                  >
                    Тўлов
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {pay && (
        <PayModal target={pay} onClose={() => setPay(null)} onPaid={() => { setPay(null); refresh(); }} />
      )}
    </div>
  );
}

function PayModal({
  target,
  onClose,
  onPaid,
}: {
  target: PayTarget;
  onClose: () => void;
  onPaid: () => void;
}) {
  const [amount, setAmount] = useState(String(target.outstanding));
  const [method, setMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pay() {
    const amt = Math.round(Number(amount) || 0);
    if (amt <= 0) return;
    setBusy(true);
    setErr(null);
    try {
      await target.onPay(amt, method);
      onPaid();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Хато");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-xs space-y-4 rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div>
          <h3 className="font-semibold">{target.title}</h3>
          <p className="text-sm text-zinc-500">Қолган қарз: {fmt(target.outstanding)} so'm</p>
        </div>
        <input
          autoFocus
          inputMode="numeric"
          value={amount}
          onChange={(e) => { setErr(null); setAmount(e.target.value.replace(/\D/g, "")); }}
          className="w-full rounded-xl border px-4 py-3 text-right text-lg tabular-nums outline-none focus:border-brand"
        />
        {target.showMethod && (
          <div className="flex gap-1.5">
            {["cash", "card", "click", "payme"].map((m) => (
              <button
                key={m}
                onClick={() => setMethod(m)}
                className={`flex-1 rounded-lg py-1.5 text-xs font-medium ${method === m ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600"}`}
              >
                {METHOD[m] ?? m}
              </button>
            ))}
          </div>
        )}
        {err && <p className="text-sm text-red-500">{err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border py-2.5 text-zinc-600">Бекор</button>
          <button onClick={pay} disabled={busy || !amount} className="flex-1 rounded-xl bg-brand py-2.5 font-medium text-white disabled:opacity-40">Тўлаш</button>
        </div>
      </div>
    </div>
  );
}
