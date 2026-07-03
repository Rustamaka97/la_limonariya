import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { trpc } from "./trpc";

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
};
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
  useEffect(() => {
    trpc.dashboard.summary.query().then(setS).catch(() => {});
    trpc.telegram.enabled.query().then((r) => setTgEnabled(r.enabled)).catch(() => {});
    trpc.audit.recent.query({ limit: 25 }).then(setAudit).catch(() => {});
    trpc.analytics.digest.query().then(setToday).catch(() => {});
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

  if (!s) return <div className="p-6 text-center text-zinc-400">⏳</div>;

  const noMeat = s.meatCost.qoy === null && s.meatCost.mol === null;

  return (
    <div className="space-y-5">
      {today && (
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-zinc-700">📊 Бугун</h2>
            <span className="text-xs text-zinc-400">жонли ҳолат</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Big label="Тушум" value={fmt(today.revenueToday)} sub="so'm" accent />
            <Big label="Фойда ~" value={fmt(today.estProfit)} sub={`тахминий · COGS ${Math.round(today.estCogsPct * 100)}%`} accent={today.estProfit >= 0} danger={today.estProfit < 0} />
            <Big label="Нақд" value={fmt(today.cashToday)} sub="so'm" />
            <Big label="Очиқ столлар" value={String(today.openTables)} sub={today.openValue ? `${fmt(today.openValue)} so'm` : "бўш"} />
            <Big label="Аномалия" value={String(today.anomalyCount)} sub={today.lowStock ? `${today.lowStock} кам қолдиқ` : "белги"} danger={today.anomalyCount > 0} />
            <Big label="Қарз" value={fmt(today.debtToday)} sub={`етк. ${fmt(today.supplierDebt)} · меҳ. ${fmt(today.guestDebt)}`} danger={today.debtToday > 0} />
          </div>
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

function Big({ label, value, sub, accent, danger }: { label: string; value: string; sub?: string; accent?: boolean; danger?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${danger ? "border-red-200 bg-red-50" : accent ? "border-green-200 bg-green-50" : "bg-white"}`}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-0.5 text-xl font-bold tabular-nums ${danger ? "text-red-600" : accent ? "text-green-700" : ""}`}>{value}</div>
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
