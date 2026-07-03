import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { trpc } from "./trpc";

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
};

export function Analitika() {
  const [d, setD] = useState<Digest | null>(null);
  const [s, setS] = useState<Signals | null>(null);
  const [err, setErr] = useState(false);

  function load() {
    setErr(false);
    Promise.all([trpc.analytics.digest.query(), trpc.analytics.signals.query()])
      .then(([dd, ss]) => { setD(dd); setS(ss); })
      .catch(() => setErr(true));
  }
  useEffect(() => { load(); }, []);

  if (err) return <ErrBox onRetry={load} />;
  if (!d || !s) return <div className="p-6 text-center text-zinc-400">⏳</div>;

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
                    {g.flag ? "🔴" : "🟢"} {g.leakG > 0 ? "−" : "+"}{Math.abs(g.leakG / 1000).toFixed(1)}кг · {g.leakPct}%
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
