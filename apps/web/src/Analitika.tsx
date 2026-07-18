import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { trpc } from "./trpc";
import { swr } from "./lib/cache";
import { Skeleton, SkeletonCard, SkeletonRow } from "./Skeleton";

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const fmtDate = (s: string) => {
  const d = new Date(s);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

type Digest = {
  revenueToday: number;
  estProfit: number;
  estCogsPct: number;
  anomalyCount: number;
  lowStock: number;
  debtToday: number;
  supplierDebt: number;
  guestDebt: number;
};
type Signals = {
  obvalkaFlags: { id: string; carcassType: string; weightG: number; createdAt: string; lossPct: number; balanceFlag: boolean; anomalies: number }[];
  thinDishes: { id: string; name: string; salePrice: number; meatCostTotal: number; meatPct: number | null }[];
  cashVariance: { dayKey: string; countedCash: number; expectedCash: number; variance: number } | null;
  breakEvenFlag: boolean;
  yesterdayRevenue: number;
  priceSpikes: { carcassType: string; latestPrice: number; medianPrice: number; pct: number }[];
  shortagePattern: { productId: string; name: string; count: number }[];
  historyPending: boolean;
  compToday: number;
  compFlag: boolean;
  staleOrders: { id: string; tableNo: string | null; hall: string | null; waiter: string | null; createdAt: string; minutesOpen: number }[];
  underDelivery: { id: string; carcassType: string; weightG: number; sumPartsG: number; lossPct: number; missingG: number; missingCost: number; shortReason: string | null; supplier: string | null; createdAt: string }[];
  grammLeak: { carcassType: string; marinatedG: number; soldSikh: number; usedG: number; expectedSikh: number; leakG: number; leakPct: number; flag: boolean }[];
  vitrinaMismatch: { productId: string; name: string; opening: number | null; openingKnown: boolean; skewered: number; sold: number; expected: number; counted: number | null; diff: number | null }[];
  skewerFlags: { id: string; name: string; meatG: number; skewerCount: number; normG: number | null; actualG: number; devPct: number | null; by: string | null }[];
  expiryFlags: { productId: string; name: string; unit: string; onHand: number; ageDays: number; shelfLifeDays: number }[];
};

export function Analitika() {
  const [sub, setSub] = useState<"signals" | "menu" | "waiters">("signals");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            { k: "signals", label: "Сигналлар" },
            { k: "menu", label: "Таом таҳлили" },
            { k: "waiters", label: "Официант KPI" },
          ] as const
        ).map((t) => (
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
      {sub === "signals" ? <SignalsView /> : sub === "menu" ? <MenuTahlil /> : <WaiterKpi />}
    </div>
  );
}

function SignalsView() {
  const [d, setD] = useState<Digest | null>(null);
  const [s, setS] = useState<Signals | null>(null);
  const [err, setErr] = useState(false);

  function load() {
    setErr(false);
    swr("analytics.digest", () => trpc.analytics.digest.query(), setD).catch(() => setErr(true));
    swr("analytics.signals", () => trpc.analytics.signals.query(), setS).catch(() => setErr(true));
  }
  useEffect(() => { load(); }, []);

  if (err) return <ErrBox onRetry={load} />;
  if (!d || !s) return <AnalitikaSkeleton />;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Big label="Бугунги тушум" value={fmt(d.revenueToday)} sub="so'm" />
        <Big
          label="Тахм. соф фойда"
          value={fmt(d.estProfit)}
          sub={`${Math.round(d.estCogsPct * 100)}% COGS тахминий`}
          tone={d.estProfit >= 0 ? "good" : "bad"}
        />
        <Big label="Аномалия" value={String(d.anomalyCount)} sub="бугунги сигнал" tone={d.anomalyCount > 0 ? "warn" : "good"} />
        <Big label="Қарз" value={fmt(d.debtToday)} sub={`биз ${fmt(d.supplierDebt)} · бизга ${fmt(d.guestDebt)}`} tone={d.debtToday > 0 ? "warn" : "good"} />
      </div>

      {d.lowStock > 0 && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
          📉 {d.lowStock} та маҳсулот манфий қолдиқда — Омборни текширинг
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="🔪 Обвалка баланс/норма" hint="сўнгги 20">
          {s.obvalkaFlags.length === 0 ? (
            <Empty>аномалия йўқ</Empty>
          ) : (
            <ul className="divide-y">
              {s.obvalkaFlags.map((o) => (
                <li key={o.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">{o.carcassType === "qoy" ? "Қўй" : "Мол"}</span>{" "}
                    <span className="text-zinc-400">{(o.weightG / 1000).toFixed(1)}кг · {fmtDate(o.createdAt)}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    {o.anomalies > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700">⚠️ {o.anomalies}</span>}
                    {o.balanceFlag && (
                      <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-red-700 tabular-nums">
                        🔴 {o.lossPct > 0 ? "−" : "+"}{Math.abs(o.lossPct)}%
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="🚩 Юпқа маржали таомлар" hint="гўшт ≥60%">
          {s.thinDishes.length === 0 ? (
            <Empty>йўқ</Empty>
          ) : (
            <ul className="divide-y">
              {s.thinDishes.map((dd) => (
                <li key={dd.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span>{dd.name}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-xs text-zinc-400 tabular-nums">{fmt(dd.meatCostTotal)} / {fmt(dd.salePrice)}</span>
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-center text-xs font-medium text-red-700 tabular-nums">{dd.meatPct}%</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="💰 Касса камомади" hint="бугун">
          {!s.cashVariance ? (
            <Empty>бугун ҳали саналмаган — Молия → Кунлик ёпилиш</Empty>
          ) : s.cashVariance.variance === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-emerald-600">🟢 тенг — камомад йўқ</div>
          ) : (
            <div className="px-4 py-4 text-sm">
              <div className="flex justify-between"><span className="text-zinc-500">Кутилган</span><span className="tabular-nums">{fmt(s.cashVariance.expectedCash)}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Санаб чиқилган</span><span className="tabular-nums">{fmt(s.cashVariance.countedCash)}</span></div>
              <div className="mt-1 flex justify-between font-medium text-red-600"><span>Камомад</span><span className="tabular-nums">{s.cashVariance.variance > 0 ? "+" : ""}{fmt(s.cashVariance.variance)}</span></div>
            </div>
          )}
        </Section>

        <Section title="📊 Кечаги савдо vs break-even" hint="~8.9 млн/кун">
          <div className="px-4 py-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Кечаги тушум</span>
              <span className={`tabular-nums font-medium ${s.breakEvenFlag ? "text-red-600" : "text-emerald-600"}`}>
                {fmt(s.yesterdayRevenue)}
              </span>
            </div>
            {s.breakEvenFlag && <p className="mt-2 text-xs text-red-600">🔴 break-even остида — кеча зарарли кун бўлган</p>}
          </div>
        </Section>

        <Section title="🥩 Гўшт нархи сакраши" hint="медиана vs сўнгги">
          {s.priceSpikes.length === 0 ? (
            <Empty>норма доирасида</Empty>
          ) : (
            <ul className="divide-y">
              {s.priceSpikes.map((p) => (
                <li key={p.carcassType} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span>{p.carcassType === "qoy" ? "Қўй" : "Мол"}</span>
                  <span className="flex items-center gap-2 text-xs">
                    <span className="text-zinc-400 tabular-nums">{fmt(p.medianPrice)} → {fmt(p.latestPrice)}</span>
                    <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-red-700 tabular-nums">+{p.pct}%</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="📦 Такрорий камомад" hint={s.historyPending ? "тарих тўпланмоқда" : "сўнгги 5 тасдиқланган санашда"}>
          {s.shortagePattern.length === 0 ? (
            <Empty>{s.historyPending ? "камида 2 тасдиқланган санаш керак" : "такрорий камомад йўқ"}</Empty>
          ) : (
            <ul className="divide-y">
              {s.shortagePattern.map((p) => (
                <li key={p.productId} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span>{p.name}</span>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{p.count} марта</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="🎁 Текин/ходим овқати" hint="бугун">
          <div className="px-4 py-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">Бугунги текин ҳажми</span>
              <span className={`tabular-nums font-medium ${s.compFlag ? "text-red-600" : "text-zinc-700"}`}>
                {fmt(s.compToday)}
              </span>
            </div>
            {s.compFlag && <p className="mt-2 text-xs text-red-600">🔴 кунлик лимитдан ошди (500 000)</p>}
          </div>
        </Section>

        <Section title="🍢 Сих грамм оқмаси" hint="маринад vs сотилган сих">
          {s.grammLeak.length === 0 ? (
            <Empty>маринад партияси йўқ</Empty>
          ) : (
            <ul className="divide-y">
              {s.grammLeak.map((g) => (
                <li key={g.carcassType} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">{g.carcassType === "qoy" ? "Қўй" : "Мол"}</span>{" "}
                    <span className="text-zinc-400">
                      маринад {(g.marinatedG / 1000).toFixed(1)}кг · сотилди {g.soldSikh} сих
                    </span>
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${g.flag ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}
                  >
                    {g.flag ? "🔴" : "🟢"} {g.leakG > 0 ? "оқма" : "ортиқча"} {Math.abs(g.leakG / 1000).toFixed(1)}кг · {Math.abs(g.leakPct)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="🍢 Витрина фарқи" hint="кутилган vs саналган (кечаги кун)">
          {s.vitrinaMismatch.length === 0 ? (
            <Empty>витрина мос — тешик йўқ 🟢</Empty>
          ) : (
            <ul className="divide-y">
              {s.vitrinaMismatch.map((v) => (
                <li key={v.productId} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="font-medium">{v.name}</span>
                  <span className="flex items-center gap-2 text-xs tabular-nums">
                    <span className="text-zinc-400">кутилган {v.expected} · саналган {v.counted ?? "—"}</span>
                    <span className={`rounded-full px-1.5 py-0.5 font-medium ${(v.diff ?? 0) < 0 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                      {(v.diff ?? 0) > 0 ? "+" : ""}{v.diff}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="⚖️ Сих норма четлашиши" hint="сўнгги 15 батч · ±10%">
          {s.skewerFlags.length === 0 ? (
            <Empty>норма доирасида 🟢</Empty>
          ) : (
            <ul className="divide-y">
              {s.skewerFlags.map((f) => (
                <li key={f.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">{f.name}</span>{" "}
                    <span className="text-zinc-400">{f.actualG}г/сих (норма {f.normG ?? "—"})</span>
                  </span>
                  {f.devPct != null && (
                    <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums ${f.devPct > 0 ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700"}`}>
                      {f.devPct > 0 ? "+" : ""}{f.devPct}%
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="⏳ Муддат ўтган" hint="FIFO ёши > яроқлилик">
          {s.expiryFlags.length === 0 ? (
            <Empty>муддати ўтган йўқ 🟢</Empty>
          ) : (
            <ul className="divide-y">
              {s.expiryFlags.map((e) => (
                <li key={e.productId} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="font-medium">{e.name}</span>
                  <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700 tabular-nums">
                    {e.ageDays} кун (норма {e.shelfLifeDays})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="🚩 Кам келтириш" hint="харид − обвалка > 5%">
          {s.underDelivery.length === 0 ? (
            <Empty>кам келтириш йўқ 🟢</Empty>
          ) : (
            <ul className="divide-y">
              {s.underDelivery.map((u) => (
                <li key={u.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">{u.carcassType === "qoy" ? "Қўй" : "Мол"}</span>{" "}
                    <span className="text-zinc-400">{(u.weightG / 1000).toFixed(1)}кг · {fmtDate(u.createdAt)}</span>
                    {u.shortReason && <div className="text-xs text-zinc-400">{u.shortReason}</div>}
                  </span>
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 tabular-nums">
                    −{(u.missingG / 1000).toFixed(1)}кг · {fmt(u.missingCost)} so'm · {u.lossPct}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="⏰ Узоқ очиқ столлар" hint="90 дақиқадан кўп">
          {s.staleOrders.length === 0 ? (
            <Empty>ҳаммаси меъёрида</Empty>
          ) : (
            <ul className="divide-y">
              {s.staleOrders.map((o) => (
                <li key={o.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">{o.hall ?? "—"}</span>
                    {o.tableNo && <span className="text-zinc-400"> · стол {o.tableNo}</span>}
                    <span className="text-zinc-400"> · {o.waiter ?? "—"}</span>
                  </span>
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                    {Math.floor(o.minutesOpen / 60)}с {o.minutesOpen % 60}м
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

const QUAD: Record<string, { label: string; desc: string; cls: string }> = {
  star: { label: "⭐ Юлдузлар", desc: "кўп сотилади + яхши маржа — асранг, олдинга чиқаринг", cls: "text-emerald-700" },
  plowhorse: { label: "🐴 Отлар", desc: "кўп сотилади, юпқа маржа — нарх/грамм кўриб чиқинг", cls: "text-amber-700" },
  puzzle: { label: "🧩 Жумбоқлар", desc: "маржа яхши, кам сотилади — менюда кўтаринг, таклиф қилинг", cls: "text-sky-700" },
  dog: { label: "🐶 Итлар", desc: "иккиси ҳам паст — олиб ташлаш ёки ўзгартириш номзоди", cls: "text-zinc-500" },
};

function MenuTahlil() {
  const today = () => {
    const t = new Date(Date.now() + 5 * 3600 * 1000);
    if (t.getUTCHours() < 6) t.setUTCDate(t.getUTCDate() - 1);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
  };
  const back = (n: number) => {
    const [y = 0, m = 1, d = 1] = today().split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d - n));
    const p = (x: number) => String(x).padStart(2, "0");
    return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
  };
  const [days, setDays] = useState(14);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<{
    medQty: number;
    medMargin: number;
    rows: { productId: string; name: string; qty: number; revenue: number; unitMargin: number; totalMargin: number; quadrant: string }[];
    unknown: { productId: string; name: string; qty: number; revenue: number }[];
  } | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    setErr(false);
    setData(null);
    trpc.analytics.menuEngineering
      .query({ from: back(days - 1), to: today() })
      .then(setData)
      .catch(() => setErr(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, reload]);

  if (err) return <ErrBox onRetry={() => setReload((n) => n + 1)} />;

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {[7, 14, 30].map((n) => (
          <button
            key={n}
            onClick={() => setDays(n)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              days === n ? "bg-zinc-900 text-white" : "bg-white text-zinc-500 hover:bg-zinc-100"
            }`}
          >
            {n} кун
          </button>
        ))}
      </div>

      {!data ? (
        <div className="p-6 text-center text-zinc-400">⏳</div>
      ) : data.rows.length === 0 ? (
        <div className="rounded-xl border bg-white px-4 py-8 text-center text-sm text-zinc-400">
          бу даврда гўшт таннархи маълум таом сотилмаган
        </div>
      ) : (
        <>
          <p className="text-xs text-zinc-400">
            Маржа = сотув нархи − гўшт таннархи (бошқа ингредиентлар кейин қўшилади). Медиана:{" "}
            {Math.round(data.medQty)} дона · {fmt(data.medMargin)} so'm.
          </p>
          {(["star", "plowhorse", "puzzle", "dog"] as const).map((q) => {
            const rows = data.rows.filter((r) => r.quadrant === q);
            if (rows.length === 0) return null;
            const meta = QUAD[q]!;
            return (
              <Section key={q} title={meta.label} hint={meta.desc}>
                <ul className="divide-y">
                  {rows.map((r) => (
                    <li key={r.productId} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span>{r.name}</span>
                      <span className="flex items-center gap-3 text-xs tabular-nums">
                        <span className="text-zinc-400">{r.qty} дона</span>
                        <span className="text-zinc-400">маржа {fmt(r.unitMargin)}</span>
                        <span className={`font-medium ${meta.cls}`}>Σ {fmt(r.totalMargin)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            );
          })}
          {data.unknown.length > 0 && (
            <Section title="❓ Таннарх номаълум" hint="рецепт/гўшт нархи йўқ — квадрантга кирмади">
              <ul className="divide-y">
                {data.unknown.map((r) => (
                  <li key={r.productId} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span>{r.name}</span>
                    <span className="text-xs tabular-nums text-zinc-400">
                      {r.qty} дона · {fmt(r.revenue)}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function WaiterKpi() {
  const today = () => {
    const t = new Date(Date.now() + 5 * 3600 * 1000);
    if (t.getUTCHours() < 6) t.setUTCDate(t.getUTCDate() - 1);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
  };
  const back = (n: number) => {
    const [y = 0, m = 1, d = 1] = today().split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d - n));
    const p = (x: number) => String(x).padStart(2, "0");
    return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
  };
  const [days, setDays] = useState(14);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<{
    rows: {
      waiter: string;
      revenue: number;
      orders: number;
      guests: number;
      items: number;
      avgCheck: number;
      avgPerGuest: number;
      itemsPerOrder: number;
    }[];
  } | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    setErr(false);
    setData(null);
    trpc.analytics.waiterKpi
      .query({ from: back(days - 1), to: today() })
      .then(setData)
      .catch(() => setErr(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, reload]);

  if (err) return <ErrBox onRetry={() => setReload((n) => n + 1)} />;
  const medal = ["🥇", "🥈", "🥉"];
  const maxRev = data?.rows[0]?.revenue ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {[7, 14, 30].map((n) => (
          <button
            key={n}
            onClick={() => setDays(n)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              days === n ? "bg-zinc-900 text-white" : "bg-white text-zinc-500 hover:bg-zinc-100"
            }`}
          >
            {n} кун
          </button>
        ))}
      </div>

      {!data ? (
        <div className="p-6 text-center text-zinc-400">⏳</div>
      ) : data.rows.length === 0 ? (
        <div className="rounded-xl border bg-white px-4 py-8 text-center text-sm text-zinc-400">
          бу даврда ёпилган заказ йўқ
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-zinc-400">
            Официант = заказни очган ходим. Тушум = реал тўлов (аванс ҳам). Кўп сотган — юқорида.
          </p>
          {data.rows.map((r, i) => (
            <div key={`${r.waiter}-${i}`} className="rounded-xl border bg-white p-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-semibold text-brand-ink">
                  <span className="w-6 text-center text-base">{medal[i] ?? i + 1}</span> {r.waiter}
                </span>
                <span className="text-lg font-bold tabular-nums text-brand">
                  {fmt(r.revenue)} <span className="text-xs font-normal text-zinc-400">so'm</span>
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full bg-brand-gold"
                  style={{ width: `${maxRev > 0 ? Math.round((r.revenue / maxRev) * 100) : 0}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-zinc-500">
                <span>Заказ: <b className="text-zinc-700">{r.orders}</b></span>
                <span>Ўрт. чек: <b className="text-zinc-700">{fmt(r.avgCheck)}</b></span>
                <span>Меҳмон: <b className="text-zinc-700">{r.guests}</b></span>
                <span>Меҳмонига: <b className="text-zinc-700">{fmt(r.avgPerGuest)}</b></span>
                <span>Таом/заказ: <b className="text-zinc-700">{r.itemsPerOrder}</b></span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Big({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
  const c =
    tone === "good"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "bad"
        ? "border-red-200 bg-red-50 text-red-700"
        : tone === "warn"
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : "bg-white";
  return (
    <div className={`rounded-xl border p-3 ${c}`}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-0.5 text-xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-zinc-400">{sub}</div>}
    </div>
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

function AnalitikaSkeleton() {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
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
