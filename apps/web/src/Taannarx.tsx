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

      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium">Таом</th>
              <th className="px-3 py-2 text-right font-medium">Сотув</th>
              <th className="px-3 py-2 text-right font-medium">Гўшт таннарх</th>
              <th className="px-3 py-2 text-right font-medium">Гўшт %</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {withMeat.map((d) => {
              const batch = d.meatPct != null && d.meatPct > 100;
              const valid = d.meatPct != null && !batch;
              const high = valid && d.meatPct! >= 60;
              const mid = valid && d.meatPct! >= 40;
              return (
                <tr key={d.id} className={high ? "bg-red-50" : ""}>
                  <td className="px-4 py-2">
                    {d.name}
                    <span className="ml-1 text-xs text-zinc-400">
                      {(d.meatG / 1000).toFixed(2)}кг
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-500">
                    {d.salePrice ? fmt(d.salePrice) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {fmt(d.meatCostTotal)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-medium tabular-nums ${
                      !d.salePrice
                        ? "text-zinc-300"
                        : batch
                          ? "text-amber-600"
                          : high
                            ? "text-red-600"
                            : mid
                              ? "text-amber-600"
                              : "text-green-600"
                    }`}
                  >
                    {!d.salePrice
                      ? "—"
                      : batch
                        ? "партия?"
                        : `${d.meatPct}%${high ? " ⚠️" : ""}`}
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
            Гўшт % = гўшт таннархи сотув нархига нисбатан. 🔴 ≥60% — маржа юпқа.
            Нарх «—» = таом каталогга боғланмаган.
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
