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
  useEffect(() => {
    trpc.dashboard.summary.query().then(setS).catch(() => {});
    trpc.telegram.enabled.query().then((r) => setTgEnabled(r.enabled)).catch(() => {});
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
    </div>
  );
}

function Big({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? "border-green-200 bg-green-50" : "bg-white"}`}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-0.5 text-xl font-bold tabular-nums ${accent ? "text-green-700" : ""}`}>{value}</div>
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
