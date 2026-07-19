import { useEffect, useState } from "react";
import { trpc } from "./trpc";
import { payUrl, type PayConfig } from "./payqr";

// Меҳмон стол QR'и (?pay=tableId) → ўз чекини кўради + Payme/Click'да тўлайди.
// Public (auth йўқ). Тўлов тасдиғи кассирда (webhook кейинги фаза).
type Bill = {
  tableName: string | null;
  order: {
    orderRef: string;
    items: { name: string; qty: number; price: number }[];
    subtotal: number;
    service: number;
    servicePct: number;
    total: number;
  } | null;
  pay: PayConfig | null;
};
const fmt = (n: number) => n.toLocaleString("ru-RU");

export function BillPage({ tableId }: { tableId: string }) {
  const [data, setData] = useState<Bill | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    trpc.pos.guestBill
      .query({ tableId })
      .then((d) => setData(d as Bill))
      .catch(() => setErr(true));
  }, [tableId]);

  const order = data?.order ?? null;
  const cfg = data?.pay ?? {};
  const paymeLink = order ? payUrl("payme", cfg, order.total, order.orderRef) : null;
  const clickLink = order ? payUrl("click", cfg, order.total, order.orderRef) : null;

  return (
    <main className="flex min-h-dvh flex-col items-center bg-brand-deep px-6 py-10 text-white">
      <div className="mb-6 text-center">
        <div className="text-5xl">🍋</div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">La Limonariya</h1>
        {data?.tableName && <p className="mt-1 text-sm text-white/60">{data.tableName} · чек</p>}
      </div>

      {err ? (
        <p className="mt-10 text-center text-sm text-red-300">Чек юкланмади — қайта уриниб кўринг.</p>
      ) : !data ? (
        <p className="mt-10 text-white/50">⏳</p>
      ) : !order ? (
        <div className="mt-6 w-full max-w-sm rounded-3xl bg-white/10 px-6 py-10 text-center backdrop-blur">
          <div className="text-4xl">🧾</div>
          <p className="mt-3 text-lg font-bold">Очиқ чек йўқ</p>
          <p className="mt-1 text-sm text-white/60">Бу столда ҳозир фаол заказ топилмади.</p>
        </div>
      ) : (
        <div className="w-full max-w-sm space-y-4">
          <div className="rounded-3xl bg-white/10 p-5 backdrop-blur">
            <ul className="divide-y divide-white/10">
              {order.items.map((it, i) => (
                <li key={i} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-white/85">
                    {it.name} <span className="text-white/40">×{it.qty}</span>
                  </span>
                  <span className="tabular-nums text-white/85">{fmt(it.price * it.qty)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 space-y-1 border-t border-white/10 pt-3 text-sm">
              <div className="flex justify-between text-white/60">
                <span>Оралиқ</span>
                <span className="tabular-nums">{fmt(order.subtotal)}</span>
              </div>
              {order.service > 0 && (
                <div className="flex justify-between text-white/60">
                  <span>Хизмат {order.servicePct}%</span>
                  <span className="tabular-nums">{fmt(order.service)}</span>
                </div>
              )}
              <div className="flex justify-between pt-1 text-lg font-bold">
                <span>Жами</span>
                <span className="tabular-nums text-brand-gold">{fmt(order.total)} so'm</span>
              </div>
            </div>
          </div>

          {paymeLink || clickLink ? (
            <div className="space-y-2">
              {paymeLink && (
                <a
                  href={paymeLink}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-brand-gold py-4 text-center text-lg font-bold text-brand-ink transition active:scale-[.98]"
                >
                  Payme'да тўлаш
                </a>
              )}
              {clickLink && (
                <a
                  href={clickLink}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-white py-4 text-center text-lg font-bold text-brand-deep transition active:scale-[.98]"
                >
                  Click'да тўлаш
                </a>
              )}
              <p className="pt-1 text-center text-xs text-white/50">
                Тўлагач официантга кўрсатинг — у чекни ёпади.
              </p>
            </div>
          ) : (
            <p className="text-center text-sm text-white/50">
              Онлайн тўлов ҳозирча созланмаган — официантга нақд/карта билан тўланг.
            </p>
          )}
        </div>
      )}

      <p className="mt-auto pt-10 text-center text-xs text-white/30">La Limonariya · зал хизмати</p>
    </main>
  );
}
