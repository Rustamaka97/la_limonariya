import { useEffect, useState } from "react";
import { trpc } from "./trpc";

const fmt = (n: number) => n.toLocaleString("ru-RU");
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
const fmtDate = (s: string | null) => {
  if (!s) return "—";
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
  balance: "Баланс клиента",
  avans: "Аванс (бронь)",
};

type FoundOrder = {
  id: string;
  checkNo: string;
  tableNo: string | null;
  hall: string | null;
  waiter: string | null;
  closedAt: string | null;
  isComp: boolean;
  total: number;
};

export function ChekQidirish() {
  const [from, setFrom] = useState(shiftDay(todayBiz(), -6));
  const [to, setTo] = useState(todayBiz());
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<FoundOrder[] | null>(null);
  const [err, setErr] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  function search() {
    setErr(false);
    trpc.finance.searchOrders
      .query({ from, to, query: q.trim() || undefined })
      .then(setRows)
      .catch(() => setErr(true));
  }
  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (openId)
    return (
      <OrderDetail
        id={openId}
        onBack={() => {
          setOpenId(null);
          search();
        }}
      />
    );

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Чек қидириш</h2>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={from}
          max={to}
          onChange={(e) => e.target.value && setFrom(e.target.value)}
          className="rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-brand"
        />
        <input
          type="date"
          value={to}
          max={todayBiz()}
          onChange={(e) => e.target.value && setTo(e.target.value)}
          className="rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-brand"
        />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="чек рақами ёки стол"
          className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-brand"
        />
        <button
          onClick={search}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white"
        >
          Қидириш
        </button>
      </div>

      {err ? (
        <div className="rounded-xl border bg-white px-4 py-8 text-center text-sm text-zinc-500">
          Юкланмади.{" "}
          <button onClick={search} className="font-medium text-emerald-600 underline">
            Қайта уриниш
          </button>
        </div>
      ) : rows === null ? (
        <div className="p-6 text-center text-zinc-400">⏳</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border bg-white px-4 py-8 text-center text-sm text-zinc-400">
          топилмади
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white">
          <div className="divide-y">
            {rows.map((r) => (
              <button
                key={r.id}
                onClick={() => setOpenId(r.id)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-zinc-50"
              >
                <span>
                  <span className="font-medium">#{r.checkNo}</span>{" "}
                  <span className="text-zinc-400">
                    {r.hall ?? "—"}
                    {r.tableNo && ` · стол ${r.tableNo}`} · {r.waiter ?? "—"}
                  </span>
                  {r.isComp && (
                    <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                      текин
                    </span>
                  )}
                </span>
                <span className="text-right">
                  <span className="block font-medium tabular-nums">{fmt(r.total)} so'm</span>
                  <span className="block text-xs text-zinc-400">{fmtDate(r.closedAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type OrderItem = { id: string; name: string; price: number; qty: number };
type OrderDetailData = {
  id: string;
  checkNo: string;
  tableNo: string | null;
  hall: string | null;
  waiter: string | null;
  createdAt: string;
  isComp: boolean;
  compReason: string | null;
  items: OrderItem[];
  payments: { method: string; amount: number }[];
  subtotal: number;
  service: number;
  servicePct: number;
  total: number;
};

function OrderDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [order, setOrder] = useState<OrderDetailData | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    trpc.pos.order.query({ id }).then(setOrder).catch(() => {});
  }, [id]);

  async function doRefund() {
    const n = Math.round(Number(amount));
    if (!n || n <= 0 || !reason.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await trpc.finance.refund.mutate({ orderId: id, amount: n, reason: reason.trim() });
      setDone(true);
      setRefunding(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Хато");
    } finally {
      setBusy(false);
    }
  }

  if (!order) return <div className="p-6 text-center text-zinc-400">⏳</div>;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-zinc-500 hover:text-zinc-900">
        ← Орқага
      </button>

      <div className="mx-auto max-w-xs space-y-2 rounded-xl border bg-white p-5 font-mono text-[13px] text-zinc-800">
        <div className="text-center font-semibold tracking-wide">
          {order.isComp ? "ТЕКИН (ходим/гость)" : "ГОСТЕВОЙ СЧЕТ"}
        </div>
        <div className="border-t border-dashed pt-2 text-xs text-zinc-500">
          Заказ №{order.checkNo} · {order.hall ?? "—"}
          {order.tableNo && ` · стол ${order.tableNo}`}
        </div>
        <div className="text-xs text-zinc-500">Официант: {order.waiter ?? "—"}</div>
        <div className="border-t border-dashed pt-2">
          {order.items.map((it) => (
            <div key={it.id} className="flex justify-between gap-2">
              <span className="truncate">{it.name}</span>
              <span className="whitespace-nowrap tabular-nums">
                {it.qty}×{fmt(it.price)}
              </span>
            </div>
          ))}
        </div>
        <div className="border-t border-dashed pt-2">
          <div className="flex justify-between">
            <span className="text-zinc-500">Оралиқ сумма</span>
            <span className="tabular-nums">{fmt(order.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Хизмат ({order.servicePct}%)</span>
            <span className="tabular-nums">{fmt(order.service)}</span>
          </div>
          <div className="flex justify-between text-base font-bold">
            <span>ИТОГО</span>
            <span className="tabular-nums">{fmt(order.total)}</span>
          </div>
        </div>
        <div className="border-t border-dashed pt-2">
          {order.payments.map((pm, i) => (
            <div key={i} className="flex justify-between gap-2">
              <span className="text-zinc-500">{PAY_LABEL[pm.method] ?? pm.method}</span>
              <span className="tabular-nums">{fmt(pm.amount)}</span>
            </div>
          ))}
        </div>
      </div>

      {done && (
        <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          ✓ Возврат ёзилди
        </div>
      )}

      {!done &&
        (!refunding ? (
          <button
            onClick={() => setRefunding(true)}
            className="w-full rounded-xl border border-red-200 bg-red-50 py-2.5 text-sm font-medium text-red-700 hover:bg-red-100"
          >
            Қайтариш (возврат)
          </button>
        ) : (
          <div className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
            <input
              autoFocus
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
              placeholder="сумма (so'm)"
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-red-400"
            />
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="сабаб (мажбурий)"
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-red-400"
            />
            {err && <p className="text-sm text-red-600">{err}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => setRefunding(false)}
                disabled={busy}
                className="flex-1 rounded-lg border py-2 text-sm disabled:opacity-40"
              >
                Бекор
              </button>
              <button
                onClick={doRefund}
                disabled={busy || !amount || !reason.trim()}
                className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Тасдиқлаш
              </button>
            </div>
          </div>
        ))}
    </div>
  );
}
