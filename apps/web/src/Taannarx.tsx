import { useEffect, useState } from "react";
import { trpc } from "./trpc";

type Dish = {
  id: string;
  name: string;
  kind: string | null;
  salePrice: number;
  meatCostTotal: number;
  meatG: number;
  meatPct: number | null;
  fullCostTotal: number;
  costComplete: boolean;
  unpricedCount: number;
  marginTotal: number | null;
  marginPct: number | null;
};
type Data = {
  meatCost: { qoy: number | null; mol: number | null };
  dishes: Dish[];
};

const fmt = (n: number) => n.toLocaleString("ru-RU");

export function Taannarx() {
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => {
    trpc.taannarx.list.query().then(setData).catch(() => {});
  }, []);

  if (!data) return <div className="p-6 text-center text-zinc-400">⏳</div>;

  const noObvalka = data.meatCost.qoy === null && data.meatCost.mol === null;
  // group: 0 = valid margin (0..100%), 1 = no sale link, 2 = batch (>100% → needs yield)
  const grp = (d: Dish) =>
    d.meatPct == null ? 1 : d.meatPct > 100 ? 2 : 0;
  const withMeat = data.dishes
    .filter((d) => d.meatCostTotal > 0)
    .sort((a, b) => grp(a) - grp(b) || (b.meatPct ?? 0) - (a.meatPct ?? 0));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <MeatCard label="Қўй гўшт таннархи" v={data.meatCost.qoy} />
        <MeatCard label="Мол гўшт таннархи" v={data.meatCost.mol} />
      </div>

      {noObvalka && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          Гўшт таннархи учун аввал <b>Обвалка</b> ёзинг (нарх билан). Кейин бу
          ерда ҳар таомнинг гўшт харажати ва маржаси чиқади.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium">Таом</th>
              <th className="px-3 py-2 text-right font-medium">Сотув</th>
              <th className="px-3 py-2 text-right font-medium">Тўлиқ таннарх</th>
              <th className="px-3 py-2 text-right font-medium">Маржа</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {withMeat.map((d) => {
              const batch = d.meatPct != null && d.meatPct > 100;
              const valid = d.salePrice > 0 && !batch;
              const mp = d.marginPct;
              // higher margin = healthier (opposite of cost %)
              const loss = valid && mp != null && mp < 0;
              const thin = valid && mp != null && mp >= 0 && mp < 25;
              return (
                <tr key={d.id} className={loss ? "bg-red-50" : ""}>
                  <td className="px-4 py-2">
                    {d.name}
                    <span className="ml-1 block text-xs text-zinc-400">
                      гўшт {(d.meatG / 1000).toFixed(2)}кг · {fmt(d.meatCostTotal)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-500">
                    {d.salePrice ? fmt(d.salePrice) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {fmt(d.fullCostTotal)}
                    {!d.costComplete && (
                      <span
                        className="ml-1 text-xs text-amber-500"
                        title={`${d.unpricedCount} компонент нархсиз — таннарх тўлиқ эмас`}
                      >
                        ⚠{d.unpricedCount}
                      </span>
                    )}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-medium tabular-nums ${
                      !valid
                        ? "text-zinc-300"
                        : loss
                          ? "text-red-600"
                          : thin
                            ? "text-amber-600"
                            : "text-green-600"
                    }`}
                  >
                    {!d.salePrice
                      ? "—"
                      : batch
                        ? "партия?"
                        : mp != null
                          ? `${mp}%${loss ? " 🔴" : thin ? " ⚠️" : ""}`
                          : "—"}
                  </td>
                </tr>
              );
            })}
            {withMeat.length === 0 && !noObvalka && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-zinc-400">
                  Гўштли таомлар топилмади
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {withMeat.length > 0 && (
          <div className="px-4 py-2 text-xs text-zinc-400">
            Тўлиқ таннарх = гўшт + нархи бор барча компонентлар. ⚠N = N компонент
            нархсиз (таннарх тўлиқ эмас). Маржа% = (сотув − таннарх) / сотув · 🔴
            манфий, ⚠️ &lt;25% юпқа. Нарх «—» = каталогга боғланмаган.
          </div>
        )}
      </div>
    </div>
  );
}

function MeatCard({ label, v }: { label: string; v: number | null }) {
  return (
    <div className="rounded-xl border bg-white p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums">
        {v != null ? `${fmt(v)} so'm/кг` : "—"}
      </div>
    </div>
  );
}
