import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { trpc } from "./trpc";
import { Skeleton, SkeletonCard, SkeletonRow } from "./Skeleton";
import { useCountUp } from "./lib/useCountUp";

type ThinDish = {
  id: string;
  name: string;
  salePrice: number;
  meatCostTotal: number;
  meatG: number;
  meatPct: number | null;
};
type RecentObvalka = {
  id: string;
  carcassType: string;
  weightG: number;
  supplier: string | null;
  createdAt: string;
  lossPct: number;
  balanceFlag: boolean;
  costPerKg: number;
  anomalies: number;
};
type RecentVoid = {
  id: string;
  orderId: string;
  name: string;
  qty: number;
  note: string | null;
  createdAt: string;
  performedByName: string | null;
};
type RecentDiscount = {
  id: string;
  amount: number;
  reason: string | null;
  closedAt: string | null;
  performedByName: string | null;
};
type Today = {
  revenueToday: number;
  cashToday: number;
  estProfit: number;
  estCogsPct: number;
  anomalyCount: number;
  lowStock: number;
  openTables: number;
  openValue: number;
  debtToday: number;
  supplierDebt: number;
  guestDebt: number;
  revenueLastWeekSameDay: number;
  checksLastWeekSameDay: number;
  vsLastWeekPct: number | null;
};
type TrendRow = { dayKey: string; revenue: number; checks: number; avgCheck: number; estProfit: number };
type AuditRow = {
  id: string;
  action: string;
  entity: string | null;
  summary: string | null;
  createdAt: string;
  actor: string | null;
};
type Summary = {
  meatCost: { qoy: number | null; mol: number | null };
  catalog: Record<string, number>;
  recipeCount: number;
  recentObvalka: RecentObvalka[];
  thinDishes: ThinDish[];
  recentVoids: RecentVoid[];
  recentDiscounts: RecentDiscount[];
};

const fmt = (n: number) => n.toLocaleString("ru-RU");
const fmtDate = (s: string) => {
  const d = new Date(s);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function Dashboard({ onGoObvalka }: { onGoObvalka: () => void }) {
  const [s, setS] = useState<Summary | null>(null);
  const [tgEnabled, setTgEnabled] = useState(false);
  const [tg, setTg] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [today, setToday] = useState<Today | null>(null);
  const [trend, setTrend] = useState<TrendRow[] | null>(null);

  const todayReqId = useRef(0);
  function refetchToday() {
    // in-flight guard: 30с интервал ва visibilitychange бир вақтда ишга тушса,
    // эски (кечроқ қайтган) жавоб янгисини ЕЗИБ ЮБОРМАСЛИГИ учун.
    const id = ++todayReqId.current;
    trpc.analytics.digest.query().then((r) => {
      if (id === todayReqId.current) setToday(r);
    }).catch(() => {});
  }

  useEffect(() => {
    trpc.dashboard.summary.query().then(setS).catch(() => {});
    trpc.telegram.enabled.query().then((r) => setTgEnabled(r.enabled)).catch(() => {});
    trpc.audit.recent.query({ limit: 25 }).then(setAudit).catch(() => {});
    refetchToday();
    trpc.report.salesDaily.query({ days: 14 }).then((r) => setTrend(r.rows)).catch(() => {});
  }, []);

  useEffect(() => {
    function tick() {
      if (document.visibilityState === "visible") refetchToday();
    }
    const id = setInterval(tick, 30000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  async function sendDigest() {
    setTg("…");
    try {
      const r = await trpc.telegram.digest.mutate();
      setTg(`✓ юборилди (${r.holes} тешик)`);
    } catch {
      setTg("хатолик");
    }
  }

  const revenueToday = useCountUp(today?.revenueToday ?? 0);
  const estProfit = useCountUp(today?.estProfit ?? 0);
  const cashToday = useCountUp(today?.cashToday ?? 0);
  const anomalyCount = useCountUp(today?.anomalyCount ?? 0);
  const debtToday = useCountUp(today?.debtToday ?? 0);

  if (!s) return <DashboardSkeleton />;

  const noMeat = s.meatCost.qoy === null && s.meatCost.mol === null;

  return (
    <div className="space-y-5">
      {today && (
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-zinc-700">📊 Бугун</h2>
            <span className="flex items-center gap-1.5 text-xs text-zinc-400">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              жонли ҳолат
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Big label="Тушум" value={fmt(revenueToday)} sub="so'm" accent />
            <Big label="Фойда ~" value={fmt(estProfit)} sub={`тахминий · COGS ${Math.round(today.estCogsPct * 100)}%`} accent={today.estProfit >= 0} danger={today.estProfit < 0} />
            <Big label="Нақд" value={fmt(cashToday)} sub="so'm" />
            <Big label="Очиқ столлар" value={String(today.openTables)} sub={today.openValue ? `${fmt(today.openValue)} so'm` : "бўш"} />
            <Big
              label="Аномалия"
              value={String(anomalyCount)}
              sub={today.lowStock ? `${today.lowStock} кам қолдиқ` : "белги"}
              danger={today.anomalyCount > 0}
              className={today.anomalyCount > 0 ? "animate-anomaly-glow" : ""}
            />
            <Big label="Қарз" value={fmt(debtToday)} sub={`етк. ${fmt(today.supplierDebt)} · меҳ. ${fmt(today.guestDebt)}`} danger={today.debtToday > 0} />
          </div>
          {today.vsLastWeekPct !== null && (
            <div className={`mt-2 text-xs font-medium ${today.vsLastWeekPct >= 0 ? "text-green-700" : "text-red-600"}`}>
              {today.vsLastWeekPct >= 0 ? "↑" : "↓"} {Math.abs(today.vsLastWeekPct)}% ўтган ҳафтанинг шу кунига нисбатан
            </div>
          )}
          {trend && trend.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-3">
              <SparklineCard label="14 кун · тушум" points={trend.map((t) => t.revenue)} />
              <SparklineCard label="14 кун · чек" points={trend.map((t) => t.checks)} />
              {/* "ялпи фойда" — фақат COGS айирилган, харажат/солиқ/қайтариш ҳисобга олинмаган
                  (юқоридаги "Фойда ~" эса тўлиқ ҳисоб — иккиси ТУРЛИ методология, шунинг
                  учун ном англи фарқлаб турилиши керак). */}
              <SparklineCard label="14 кун · ялпи фойда" points={trend.map((t) => t.estProfit)} color="#0e4037" />
            </div>
          )}
        </div>
      )}
      {tgEnabled && (
        <div className="flex items-center justify-end gap-2">
          {tg && <span className="text-xs text-zinc-400">{tg}</span>}
          <button
            onClick={sendDigest}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
          >
            📤 Telegram кун хулосаси
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Big label="Қўй гўшт таннарх" value={s.meatCost.qoy != null ? fmt(s.meatCost.qoy) : "—"} sub="so'm/кг" accent={s.meatCost.qoy != null} />
        <Big label="Мол гўшт таннарх" value={s.meatCost.mol != null ? fmt(s.meatCost.mol) : "—"} sub="so'm/кг" accent={s.meatCost.mol != null} />
        <Big label="Маҳсулот" value={String(Object.values(s.catalog).reduce((a, b) => a + b, 0))} sub={`${s.catalog.dish ?? 0} таом · ${s.catalog.goods ?? 0} товар`} />
        <Big label="Рецепт" value={String(s.recipeCount)} sub="тех-карта" />
      </div>

      {noMeat && (
        <button onClick={onGoObvalka} className="block w-full rounded-xl bg-amber-50 p-3 text-left text-sm text-amber-700 hover:bg-amber-100">
          🥩 Гўшт таннархи ва таом маржаси учун аввал <b>Обвалка</b> ёзинг →
        </button>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="🚩 Юпқа маржали таомлар" hint="гўшт нархнинг катта қисми">
          {s.thinDishes.length === 0 ? (
            <Empty>обвалка ёзилгач чиқади</Empty>
          ) : (
            <ul className="divide-y">
              {s.thinDishes.map((d) => {
                const high = (d.meatPct ?? 0) >= 60;
                return (
                  <li key={d.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span>{d.name}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-zinc-400 tabular-nums">{fmt(d.meatCostTotal)} / {fmt(d.salePrice)}</span>
                      <span className={`w-12 rounded-full px-2 py-0.5 text-center text-xs font-medium tabular-nums ${high ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{d.meatPct}%</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Сўнгги обвалка" hint="баланс ва аномалия назорати">
          {s.recentObvalka.length === 0 ? (
            <Empty>ҳали обвалка йўқ</Empty>
          ) : (
            <ul className="divide-y">
              {s.recentObvalka.map((o) => (
                <li key={o.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">{o.carcassType === "qoy" ? "Қўй" : "Мол"}</span>{" "}
                    <span className="text-zinc-400">{(o.weightG / 1000).toFixed(1)}кг · {fmtDate(o.createdAt)}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    {o.anomalies > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700">⚠️ {o.anomalies}</span>}
                    <span className={`rounded-full px-1.5 py-0.5 tabular-nums ${o.balanceFlag ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                      {o.balanceFlag ? "🔴" : "🟢"} {o.lossPct > 0 ? "−" : "+"}{Math.abs(o.lossPct)}%
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="🗑️ Ўчирилган таомлар" hint="пиширилгандан кейин камайтирилган — журнал">
        {s.recentVoids.length === 0 ? (
          <Empty>ҳали йўқ</Empty>
        ) : (
          <ul className="divide-y">
            {s.recentVoids.map((v) => (
              <li key={v.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span>
                  <span className="font-medium">{v.name}</span>{" "}
                  <span className="text-zinc-400">×{v.qty} · {fmtDate(v.createdAt)}</span>
                  {v.note && <span className="text-zinc-400"> · {v.note}</span>}
                </span>
                <span className="text-xs text-zinc-400">{v.performedByName ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="🏷️ Чегирмалар" hint="ким берди — сохта чегирма назорати">
        {s.recentDiscounts.length === 0 ? (
          <Empty>ҳали йўқ</Empty>
        ) : (
          <ul className="divide-y">
            {s.recentDiscounts.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span>
                  <span className="font-medium tabular-nums text-amber-700">−{fmt(d.amount)}</span>{" "}
                  <span className="text-zinc-400">{d.closedAt ? fmtDate(d.closedAt) : ""}</span>
                  {d.reason && <span className="text-zinc-400"> · {d.reason}</span>}
                </span>
                <span className="text-xs text-zinc-400">{d.performedByName ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="🧾 Аудит журнали" hint="ким нимани ўзгартирди — PIN, роль, нарх, рецепт, бекор">
        {audit.length === 0 ? (
          <Empty>ҳали йўқ</Empty>
        ) : (
          <ul className="divide-y">
            {audit.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span>
                  <span className="font-medium">{AUDIT_LABEL[a.action] ?? a.action}</span>
                  {a.summary && <span className="text-zinc-500"> · {a.summary}</span>}{" "}
                  <span className="text-zinc-400">{fmtDate(a.createdAt)}</span>
                </span>
                <span className="text-xs text-zinc-400">{a.actor ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

const AUDIT_LABEL: Record<string, string> = {
  "pin.reset": "🔑 PIN",
  "user.create": "👤 Янги ходим",
  "user.update": "👤 Ходим",
  "product.create": "🏷️ Янги маҳсулот",
  "product.update": "🏷️ Маҳсулот",
  "station.ip": "🖨️ Принтер IP",
  "recipe.upsert": "📋 Тех-карта",
  "order.cancel": "❌ Заказ бекор",
  "norm.apply": "🧠 Норма",
  "expense.create": "💸 Харажат",
  "expense.delete": "🗑️ Харажат ўчди",
};

function Big({ label, value, sub, accent, danger, className }: { label: string; value: string; sub?: string; accent?: boolean; danger?: boolean; className?: string }) {
  return (
    <div className={`rounded-xl border p-3 ${danger ? "border-red-200 bg-red-50" : accent ? "border-green-200 bg-green-50" : "bg-white"} ${className ?? ""}`}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-0.5 text-xl font-bold tabular-nums ${danger ? "text-red-600" : accent ? "text-green-700" : ""}`}>{value}</div>
      {sub && <div className="text-xs text-zinc-400">{sub}</div>}
    </div>
  );
}

function SparklineCard({ label, points, color }: { label: string; points: number[]; color?: string }) {
  return (
    <div className="rounded-xl border bg-white p-3">
      <Sparkline points={points} color={color} />
      <div className="mt-1 text-center text-xs text-zinc-400">{label}</div>
    </div>
  );
}

function Sparkline({ points, color }: { points: number[]; color?: string }) {
  const w = 100;
  const h = 28;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min;
  const step = points.length > 1 ? w / (points.length - 1) : 0;
  const coords: Array<{ x: number; y: number }> = points.map((p, i) => {
    const x = i * step;
    const y = range === 0 ? h / 2 : h - 2 - ((p - min) / range) * (h - 4);
    return { x, y };
  });
  const path = coords.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const last = coords[coords.length - 1] ?? { x: 0, y: h / 2 };
  const lastX = last.x;
  const lastY = last.y;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      <polyline points={path} fill="none" stroke={color ?? "#0e4037"} strokeWidth={1.5} />
      <circle cx={lastX} cy={lastY} r={2.5} style={{ fill: "var(--color-brand-gold, #f3b759)" }} />
    </svg>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-white">
      <div className="flex items-baseline justify-between border-b px-4 py-2.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <span className="text-xs text-zinc-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-zinc-400">{children}</div>;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border bg-white">
            <div className="border-b px-4 py-2.5">
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="divide-y">
              {Array.from({ length: 3 }).map((_, j) => (
                <SkeletonRow key={j} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
