import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "./App";
import { trpc } from "./trpc";

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const pad = (n: number) => String(n).padStart(2, "0");
const fmtDT = (s: string) => {
  const d = new Date(s);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const PAY_LABEL: Record<string, string> = {
  cash: "Нақд",
  card: "Карта",
  click: "Click",
  payme: "Payme",
  humo: "Ҳумо",
  debt: "Қарз",
};

type CurrentShift = {
  id: string;
  openedAt: string;
  openingFloat: number;
  openedBy: string | null;
  cashRevenue: number;
  cashDebtRepaid: number;
  cashExpenses: number;
  cashOutTotal: number;
  cashOutList: { id: string; amount: number; reason: string; createdAt: string; by: string | null }[];
  expectedCash: number;
  revenue: number;
  byMethod: Record<string, number>;
  checks: number;
} | null;

type ShiftRow = {
  id: string;
  status: string;
  openingFloat: number;
  openedAt: string;
  closedAt: string | null;
  countedCash: number | null;
  expectedCash: number | null;
  variance: number | null;
  note: string | null;
  openedBy: string | null;
};

export function Smena({ user }: { user: SessionUser }) {
  const isManager = ["director", "manager"].includes(user.role);
  const [shift, setShift] = useState<CurrentShift>(null);
  const [loaded, setLoaded] = useState(false);
  const [history, setHistory] = useState<ShiftRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    trpc.shift.current
      .query()
      .then((s) => {
        setShift(s);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    if (isManager)
      trpc.shift.list.query().then(setHistory).catch(() => {});
  }, [isManager]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!loaded) return <div className="p-6 text-center text-zinc-400">⏳</div>;

  return (
    <div className="space-y-4">
      {err && <p className="text-sm text-red-500">{err}</p>}
      {!shift ? (
        <OpenShift onOpened={refresh} onError={setErr} />
      ) : (
        <>
          <XReport shift={shift} />
          <CashOutSection shift={shift} onSaved={refresh} onError={setErr} />
          <CloseShift onClosed={refresh} onError={setErr} />
        </>
      )}
      {isManager && history.length > 0 && <History rows={history} />}
    </div>
  );
}

function OpenShift({ onOpened, onError }: { onOpened: () => void; onError: (e: string | null) => void }) {
  const [float, setFloat] = useState("50000");
  const [busy, setBusy] = useState(false);
  async function open() {
    setBusy(true);
    onError(null);
    try {
      await trpc.shift.open.mutate({ openingFloat: Number(float) || 0 });
      onOpened();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Хато");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 rounded-xl border bg-white p-5">
      <h2 className="font-semibold">Смена очиш</h2>
      <p className="text-sm text-zinc-500">
        Кассадаги бошланғич нақд (размен)ни киритинг — Z-ҳисобот шунга таянади.
      </p>
      <div className="flex gap-2">
        <input
          inputMode="numeric"
          value={float}
          onChange={(e) => setFloat(e.target.value.replace(/\D/g, ""))}
          className="w-40 rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand tabular-nums"
        />
        <button
          onClick={open}
          disabled={busy}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Смена очиш
        </button>
      </div>
    </div>
  );
}

function XReport({ shift }: { shift: NonNullable<CurrentShift> }) {
  const nonCash = Object.entries(shift.byMethod).filter(([m]) => m !== "cash");
  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      <div className="flex items-baseline justify-between border-b px-4 py-2.5">
        <h3 className="text-sm font-semibold">📗 X-ҳисобот (жонли)</h3>
        <span className="text-xs text-zinc-400">
          очилди {fmtDT(shift.openedAt)} · {shift.openedBy ?? "—"}
        </span>
      </div>
      <div className="space-y-1 px-4 py-3 text-sm">
        <Row l="Тушум (смена)" v={`${fmt(shift.revenue)} so'm`} />
        <Row l="Чеклар" v={String(shift.checks)} muted />
        <div className="my-2 border-t border-dashed" />
        <Row l="Бошланғич размен" v={fmt(shift.openingFloat)} muted />
        <Row l="+ Нақд тушум" v={fmt(shift.cashRevenue)} />
        <Row l="+ Қарз қайтарилди (нақд)" v={fmt(shift.cashDebtRepaid)} muted />
        <Row l="− Нақд харажат" v={fmt(shift.cashExpenses)} muted />
        <Row l="− Инкассация" v={fmt(shift.cashOutTotal)} muted />
        <div className="flex justify-between pt-1 text-base font-bold">
          <span>Кассада бўлиши керак</span>
          <span className="tabular-nums">{fmt(shift.expectedCash)}</span>
        </div>
        {nonCash.length > 0 && (
          <>
            <div className="my-2 border-t border-dashed" />
            {nonCash.map(([m, v]) => (
              <Row key={m} l={PAY_LABEL[m] ?? m} v={fmt(v)} muted />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function CashOutSection({
  shift,
  onSaved,
  onError,
}: {
  shift: NonNullable<CurrentShift>;
  onSaved: () => void;
  onError: (e: string | null) => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    const a = Number(amount);
    if (!a || !reason.trim()) return;
    setBusy(true);
    onError(null);
    try {
      await trpc.shift.cashOut.mutate({ amount: a, reason: reason.trim() });
      setAmount("");
      setReason("");
      onSaved();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Хато");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      <div className="border-b px-4 py-2.5">
        <h3 className="text-sm font-semibold">💸 Инкассация (кассадан пул олиш)</h3>
      </div>
      <div className="space-y-2 px-4 py-3">
        <div className="flex gap-2">
          <input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
            placeholder="Сумма"
            className="w-32 rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand tabular-nums"
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Сабаб (мажбурий) — масалан: эга олди, бозорга"
            className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            onClick={save}
            disabled={busy || !Number(amount) || !reason.trim()}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Ёзиш
          </button>
        </div>
        {shift.cashOutList.length > 0 && (
          <ul className="divide-y text-sm">
            {shift.cashOutList.map((o) => (
              <li key={o.id} className="flex items-center justify-between py-2">
                <span>
                  <span className="text-zinc-400">{fmtDT(o.createdAt)}</span> {o.reason}
                  <span className="text-xs text-zinc-400"> · {o.by ?? "—"}</span>
                </span>
                <span className="font-medium tabular-nums">−{fmt(o.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CloseShift({ onClosed, onError }: { onClosed: () => void; onError: (e: string | null) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ expectedCash: number; variance: number } | null>(null);

  async function close() {
    setBusy(true);
    onError(null);
    try {
      const r = await trpc.shift.close.mutate({
        countedCash: Number(counted) || 0,
        note: note.trim() || undefined,
      });
      if (!r.alreadyClosed) setResult({ expectedCash: r.expectedCash, variance: r.variance });
      onClosed();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Хато");
    } finally {
      setBusy(false);
    }
  }

  if (result)
    return (
      <div
        className={`rounded-xl border p-4 text-sm ${
          result.variance === 0
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-red-200 bg-red-50 text-red-700"
        }`}
      >
        <b>Z-ҳисобот:</b> кутилган {fmt(result.expectedCash)} · фарқ{" "}
        {result.variance > 0 ? "+" : ""}
        {fmt(result.variance)}
        {result.variance === 0 ? " — камомад йўқ 🟢" : " 🔴"}
      </div>
    );

  if (!confirming)
    return (
      <button
        onClick={() => setConfirming(true)}
        className="w-full rounded-xl border border-red-200 bg-white py-3 font-medium text-red-600 hover:bg-red-50"
      >
        📕 Смена ёпиш (Z-ҳисобот)
      </button>
    );

  return (
    <div className="space-y-3 rounded-xl border border-red-200 bg-white p-4">
      <p className="text-sm text-zinc-600">
        Кассадаги нақдни <b>физик санаб</b> киритинг — тизим кутилган билан солиштиради.
      </p>
      <div className="flex gap-2">
        <input
          autoFocus
          inputMode="numeric"
          value={counted}
          onChange={(e) => setCounted(e.target.value.replace(/\D/g, ""))}
          placeholder="Саналган нақд"
          className="w-40 rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand tabular-nums"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Изоҳ (ихтиёрий)"
          className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="flex-1 rounded-lg border py-2 text-sm disabled:opacity-40"
        >
          Бекор
        </button>
        <button
          onClick={close}
          disabled={busy || counted === ""}
          className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Ёпиш
        </button>
      </div>
    </div>
  );
}

function History({ rows }: { rows: ShiftRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      <div className="border-b px-4 py-2.5">
        <h3 className="text-sm font-semibold">Сменалар тарихи</h3>
      </div>
      <ul className="divide-y text-sm">
        {rows.map((s) => (
          <li key={s.id} className="flex items-center justify-between px-4 py-2.5">
            <span>
              <span className="font-medium">{fmtDT(s.openedAt)}</span>
              {s.closedAt && <span className="text-zinc-400"> → {fmtDT(s.closedAt)}</span>}
              <span className="text-xs text-zinc-400"> · {s.openedBy ?? "—"}</span>
              {s.note && <span className="text-xs text-zinc-400"> · {s.note}</span>}
            </span>
            {s.status === "open" ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">очиқ</span>
            ) : s.variance != null ? (
              <span
                className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${
                  s.variance === 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                }`}
              >
                {s.variance > 0 ? "+" : ""}
                {fmt(s.variance)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ l, v, muted }: { l: string; v: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-zinc-500" : ""}`}>
      <span>{l}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
}
