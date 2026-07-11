import { useEffect, useRef, useState } from "react";
import { trpc } from "./trpc";

// 📺 Директор ТВ — офис/касса деворидаги экранга жонли пульс.
// Фақат директор (Shell таб гейти + серверда directorProcedure'лар).
// Маълумот тайёр эндпоинтлардан: analytics.digest (Бугун KPI, 30с),
// analytics.signals (тешик сигналлари, 30с), report.salesDaily (14 кун, 5 дақ).

type Today = {
  revenueToday: number;
  cashToday: number;
  estProfit: number;
  estCogsPct: number;
  anomalyCount: number;
  openTables: number;
  openValue: number;
  debtToday: number;
  vsLastWeekPct: number | null;
};
type TrendRow = { dayKey: string; revenue: number; checks: number; avgCheck: number };
type Signals = {
  staleOrders: { tableNo: string | null; waiter?: string | null; minutesOpen: number }[];
  skewerFlags: { name: string; actualG: number; normG: number | null; devPct: number | null; by: string | null }[];
  vitrinaMismatch: { name: string; expected: number; counted: number | null; diff: number | null }[];
  grammLeak: { carcassType: string; leakG: number; leakPct: number; flag: boolean }[];
  cashVariance: { variance: number } | null;
  breakEvenFlag: boolean;
  compFlag: boolean;
  compToday: number;
  refundsToday: { count: number; sum: number };
  voidsToday: { count: number };
  reprintsToday: { count: number };
};

const fmt = (n: number) => n.toLocaleString("ru-RU");

// Рақам алмашганда юмшоқ санаб чиқиш (prefers-reduced-motion ҳурмат қилинади)
function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const prevRef = useRef(target);
  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = target;
    if (from === target) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const dur = 700;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(from + (target - from) * e));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

function Spark({ rows }: { rows: TrendRow[] }) {
  if (rows.length < 2) return null;
  const W = 600, H = 90;
  const vals = rows.map((r) => r.revenue);
  const max = Math.max(...vals), min = Math.min(...vals);
  const span = max - min || 1;
  const pts: [number, number][] = vals.map((v, i) => [
    (i / (vals.length - 1)) * W,
    H - 8 - ((v - min) / span) * (H - 20),
  ]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden="true">
      <path d={`${line} L ${W} ${H} L 0 ${H} Z`} fill="rgba(243,183,89,.13)" />
      <path d={line} fill="none" stroke="#f3b759" strokeWidth="3" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="5" fill="#f3b759" />
    </svg>
  );
}

function buildFlags(sig: Signals): { icon: string; title: string; sub: string }[] {
  const out: { icon: string; title: string; sub: string }[] = [];
  for (const o of sig.staleOrders.slice(0, 2))
    out.push({
      icon: "⏱",
      title: `${o.tableNo ?? "Стол"} — ${o.minutesOpen}′ очиқ`,
      sub: `Тўлов кутиляптими?${o.waiter ? ` · ${o.waiter}` : ""}`,
    });
  for (const f of sig.skewerFlags.slice(0, 2))
    out.push({
      icon: "🍢",
      title: `${f.name}: сих ${f.actualG}г`,
      sub: `норма ${f.normG ?? "—"}г · ${f.devPct != null && f.devPct > 0 ? "+" : ""}${f.devPct ?? "—"}%${f.by ? ` · ${f.by}` : ""}`,
    });
  for (const v of sig.vitrinaMismatch.slice(0, 2))
    out.push({
      icon: "🧮",
      title: `Витрина: ${v.name} фарқ ${v.diff != null && v.diff > 0 ? "+" : ""}${v.diff ?? "—"}`,
      sub: `кутилган ${v.expected} → саналган ${v.counted ?? "—"}`,
    });
  for (const g of sig.grammLeak.filter((x) => x.flag))
    out.push({
      icon: "🥩",
      title: `Грамм-оқма (${g.carcassType === "qoy" ? "қўй" : "мол"}): ${g.leakPct}%`,
      sub: `${fmt(g.leakG)} г маринад изсиз — сих грамми/йўқолиш текширилсин`,
    });
  if (sig.cashVariance && sig.cashVariance.variance < 0)
    out.push({ icon: "💵", title: `Касса камомади: ${fmt(sig.cashVariance.variance)}`, sub: "кун охири саноқ ↔ сотув фарқи" });
  if (sig.breakEvenFlag)
    out.push({ icon: "📉", title: "Тушум зарарсизлик чизиғидан паст", sub: "кунлик 8.9 млн остида" });
  if (sig.compFlag)
    out.push({ icon: "🆓", title: `Текин лимитдан ошди: ${fmt(sig.compToday)}`, sub: "кунлик 500 минг лимит" });
  if (sig.refundsToday.count)
    out.push({ icon: "↩️", title: `Возврат: ${sig.refundsToday.count} та`, sub: `${fmt(sig.refundsToday.sum)} so'm` });
  if (sig.voidsToday.count)
    out.push({ icon: "🗑", title: `Ўчирилган таом: ${sig.voidsToday.count} та`, sub: "пиширилгандан кейин камайтирилган" });
  if (sig.reprintsToday.count)
    out.push({ icon: "🖨", title: `Қайта чоп: ${sig.reprintsToday.count} та`, sub: "дубликат назорати журналда" });
  return out.slice(0, 6);
}

export function Tv() {
  const [today, setToday] = useState<Today | null>(null);
  const [sig, setSig] = useState<Signals | null>(null);
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [fs, setFs] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  function refetchLive() {
    // in-flight guard — интервал ва visibilitychange тўқнашганда эски жавоб
    // янгисини езиб юбормасин (Dashboard'даги қолип).
    const id = ++reqId.current;
    trpc.analytics.digest.query().then((r) => { if (id === reqId.current) setToday(r); }).catch(() => {});
    trpc.analytics.signals.query().then((r) => { if (id === reqId.current) setSig(r as unknown as Signals); }).catch(() => {});
  }

  useEffect(() => {
    refetchLive();
    trpc.report.salesDaily.query({ days: 14 }).then((r) => setTrend(r.rows)).catch(() => {});
    const live = setInterval(refetchLive, 30_000);
    const daily = setInterval(() => {
      trpc.report.salesDaily.query({ days: 14 }).then((r) => setTrend(r.rows)).catch(() => {});
    }, 300_000);
    const clock = setInterval(() => setNow(new Date()), 15_000);
    const vis = () => { if (!document.hidden) refetchLive(); };
    document.addEventListener("visibilitychange", vis);
    const fsc = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", fsc);
    return () => {
      clearInterval(live); clearInterval(daily); clearInterval(clock);
      document.removeEventListener("visibilitychange", vis);
      document.removeEventListener("fullscreenchange", fsc);
    };
  }, []);

  const rev = useCountUp(today?.revenueToday ?? 0);
  const p = (n: number) => String(n).padStart(2, "0");
  const clock = `${p(now.getHours())}:${p(now.getMinutes())}`;
  const lastRow = trend[trend.length - 1];
  const flags = sig ? buildFlags(sig) : [];

  return (
    <div
      ref={boxRef}
      className="min-h-[80dvh] rounded-2xl bg-brand-deep p-5 text-brand-cream sm:p-8"
      style={{ background: "radial-gradient(1100px 500px at 72% -12%, rgba(243,183,89,.09), transparent 60%), #092f28" }}
    >
      {/* Сарлавҳа: лого + соат + тўлиқ экран */}
      <div className="flex items-center gap-3">
        <img src="/brand/logo-96.png" alt="" className="h-9 w-9 rounded-full ring-2 ring-brand-gold/50" />
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[.2em] text-brand-gold">La Limonariya · жонли пульс</div>
          <div className="text-xs text-brand-cream-soft/50">ҳар 30 сонияда янгиланади</div>
        </div>
        <span className="ml-auto text-2xl font-bold tabular-nums sm:text-3xl">{clock}</span>
        <button
          onClick={() => (document.fullscreenElement ? document.exitFullscreen() : boxRef.current?.requestFullscreen?.())}
          className="rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold transition hover:bg-white/20"
        >
          {fs ? "Чиқиш" : "⛶ Тўлиқ экран"}
        </button>
      </div>

      {/* Бугунги тушум — катта */}
      <div className="mt-6">
        <div className="text-[11px] font-bold uppercase tracking-[.22em] text-brand-gold">Бугунги тушум</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-3">
          <span className="text-[clamp(40px,7vw,76px)] font-extrabold leading-none tabular-nums">{fmt(rev)}</span>
          <span className="text-lg text-brand-cream-soft/50">so'm</span>
          {today?.vsLastWeekPct != null && (
            <span className={`rounded-full px-3 py-1 text-sm font-bold tabular-nums ${today.vsLastWeekPct >= 0 ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}>
              {today.vsLastWeekPct >= 0 ? "▲" : "▼"} {Math.abs(today.vsLastWeekPct)}% ўтган ҳафтага
            </span>
          )}
        </div>
      </div>

      {/* KPI карталар */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { l: "Чеклар", v: lastRow ? fmt(lastRow.checks) : "—" },
          { l: "Ўртача чек", v: lastRow ? fmt(lastRow.avgCheck) : "—" },
          { l: "Очиқ столлар", v: today ? String(today.openTables) : "—", gold: true, sub: today ? `${fmt(today.openValue)} so'm ичида` : undefined },
          { l: `Фойда ~ (COGS ${Math.round((today?.estCogsPct ?? 0.53) * 100)}%)`, v: today ? fmt(today.estProfit) : "—", ok: true },
        ].map((k) => (
          <div key={k.l} className="rounded-2xl border border-brand-gold/15 bg-brand-cream/5 px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-[.14em] text-brand-cream-soft/50">{k.l}</div>
            <div className={`mt-0.5 text-2xl font-extrabold tabular-nums ${k.gold ? "text-brand-gold" : k.ok ? "text-emerald-300" : ""}`}>{k.v}</div>
            {k.sub && <div className="text-[10px] text-brand-cream-soft/40">{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* 14 кун спарклайн */}
      <div className="mt-4 rounded-2xl border border-brand-gold/15 bg-brand-cream/5 px-4 py-3">
        <div className="text-[10px] font-bold uppercase tracking-[.14em] text-brand-cream-soft/50">14 кун · тушум</div>
        <div className="mt-2"><Spark rows={trend} /></div>
      </div>

      {/* Сигналлар */}
      <div className="mt-4 space-y-2">
        {!sig ? (
          <div className="rounded-2xl border border-brand-gold/15 bg-brand-cream/5 px-4 py-3.5 text-sm text-brand-cream-soft/50">
            Сигналлар юкланмоқда…
          </div>
        ) : flags.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3.5 text-sm">
            <span className="text-lg">🟢</span>
            <span><b className="font-bold">Ҳаммаси тинч</b> — фаол сигнал йўқ</span>
          </div>
        ) : (
          flags.map((f, i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl border border-brand-gold/15 bg-brand-cream/5 px-4 py-3">
              <span className="text-lg">{f.icon}</span>
              <span className="min-w-0 text-sm">
                <b className="font-bold">{f.title}</b>
                <span className="block text-xs text-brand-cream-soft/50">{f.sub}</span>
              </span>
            </div>
          ))
        )}
      </div>

      <p className="mt-6 text-center text-[10px] text-brand-cream-soft/35">
        📺 Деворга осиладиган режим — «Тўлиқ экран»ни босинг · фақат директор кўради
      </p>
    </div>
  );
}
