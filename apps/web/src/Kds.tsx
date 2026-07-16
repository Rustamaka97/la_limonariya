import { useEffect, useRef, useState } from "react";
import { trpc } from "./trpc";

// 🍳 KDS — кухня экрани (ошхона планшети). Пишаётган тикетлар жонли; ошпаз
// «✓ Тайёр» босади → экрандан кетади. Вақт ошса ранг эскалация (кухня SLA).
// Юқори контраст + катта матн (иссиқ ошхона, узоқдан ўқилсин).

type KItem = { name: string; qty: number; note: string | null; station: string | null };
type Ticket = {
  id: string;
  createdAt: string;
  tableNo: string | null;
  hall: string | null;
  saleType?: string;
  items: KItem[];
};

// Собой/доставка — ошпаз ўраш кераклигини кўрсин (зал тикетида бейдж йўқ).
const SALE_TYPE_BADGE: Record<string, string> = { delivery: "🛵 ДОСТАВКА", takeaway: "🥡 СОБОЙ" };

const STATION_COLOR: Record<string, string> = {
  SALAT: "#22c55e",
  OSHXONA: "#f3b759",
  SHASHLIK: "#fb923c",
  BALIQ: "#22d3ee",
  BAR: "#a78bfa",
  "NON CHOY": "#a3e635",
};

function minsOpen(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

// Кухня SLA: 10′+ сариқ, 20′+ қизил (узоқ пишяпти → эътибор).
function ageStyle(m: number): { border: string; badge: string; text: string } {
  if (m >= 20) return { border: "#ef4444", badge: "bg-red-500 text-white", text: "text-red-300" };
  if (m >= 10) return { border: "#f59e0b", badge: "bg-amber-500 text-black", text: "text-amber-300" };
  return { border: "rgba(243,183,89,.25)", badge: "bg-emerald-500 text-black", text: "text-emerald-300" };
}

export function Kds() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [fs, setFs] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  function refetch() {
    const id = ++reqId.current;
    trpc.kds.board
      .query()
      .then((r) => { if (id === reqId.current) setTickets(r as Ticket[]); })
      .catch(() => {});
  }

  useEffect(() => {
    refetch();
    const poll = setInterval(refetch, 8_000);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    const fsc = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", fsc);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("fullscreenchange", fsc);
    };
  }, []);

  async function bump(id: string) {
    setBusy(id);
    // Оптимистик — ошпаз тез ишлайди, экрандан дарҳол кетсин.
    setTickets((prev) => prev.filter((t) => t.id !== id));
    try {
      await trpc.kds.bump.mutate({ ticketId: id });
    } catch {
      refetch(); // хато — қайтариб қўй
    } finally {
      setBusy(null);
    }
  }

  const p = (n: number) => String(n).padStart(2, "0");
  const d = new Date();
  const clock = `${p(d.getHours())}:${p(d.getMinutes())}`;

  return (
    <div ref={boxRef} className="min-h-[80dvh] rounded-2xl bg-brand-deep p-4 text-brand-cream sm:p-6">
      <div className="flex items-center gap-3">
        <span className="text-xl">🍳</span>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[.2em] text-brand-gold">Ошхона · KDS</div>
          <div className="text-xs text-brand-cream-soft/50">{tickets.length} тикет пишяпти · ҳар 8с янгиланади</div>
        </div>
        <span className="ml-auto text-xl font-bold tabular-nums">{clock}</span>
        <button
          onClick={() => (document.fullscreenElement ? document.exitFullscreen() : boxRef.current?.requestFullscreen?.())}
          className="rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold transition hover:bg-white/20"
        >
          {fs ? "Чиқиш" : "⛶ Тўлиқ экран"}
        </button>
      </div>

      {tickets.length === 0 ? (
        <div className="mt-10 grid place-items-center gap-2 text-center">
          <span className="text-4xl">✓</span>
          <p className="text-lg font-bold text-emerald-300">Ҳаммаси пиширилди</p>
          <p className="text-sm text-brand-cream-soft/50">Кутилаётган тикет йўқ</p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tickets.map((t) => {
            const m = minsOpen(t.createdAt);
            const st = ageStyle(m);
            const byStation = new Map<string, KItem[]>();
            for (const it of t.items) {
              const key = it.station ?? "Бошқа";
              const arr = byStation.get(key) ?? [];
              arr.push(it);
              byStation.set(key, arr);
            }
            return (
              <div
                key={t.id}
                className="flex flex-col rounded-2xl border-2 bg-brand-cream/5 p-3"
                style={{ borderColor: st.border }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-extrabold">
                    {t.tableNo ?? t.hall ?? "Заказ"}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {t.saleType && SALE_TYPE_BADGE[t.saleType] && (
                      <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs font-extrabold text-black">
                        {SALE_TYPE_BADGE[t.saleType]}
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${st.badge}`}>
                      {m}′
                    </span>
                  </span>
                </div>
                <div className="mt-2 flex-1 space-y-2">
                  {[...byStation.entries()].map(([station, items]) => (
                    <div key={station}>
                      <div
                        className="text-[10px] font-bold uppercase tracking-wider"
                        style={{ color: STATION_COLOR[station] ?? "#e5e5e5" }}
                      >
                        {station}
                      </div>
                      {items.map((it, i) => (
                        <div key={i} className="leading-tight">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-[15px] font-semibold">{it.name}</span>
                            <span className="text-[15px] font-extrabold tabular-nums text-brand-gold">×{it.qty}</span>
                          </div>
                          {it.note && (
                            <div className="text-[13px] font-semibold text-amber-300">&gt;&gt; {it.note}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => bump(t.id)}
                  disabled={busy === t.id}
                  className="mt-3 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-extrabold text-white transition hover:bg-emerald-700 active:scale-[.98] disabled:opacity-50 motion-reduce:active:scale-100"
                >
                  ✓ Тайёр
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
