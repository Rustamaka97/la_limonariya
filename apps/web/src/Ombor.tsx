import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "./trpc";

type Row = {
  productId: string;
  name: string;
  type: string;
  unit: string;
  onHand: number;
};

const TYPE_LABEL: Record<string, string> = {
  part: "Гўшт",
  ingredient: "Хом-ашё",
  goods: "Товар",
  semi: "Ярим-т.",
  dish: "Таом",
};

function fmt(r: Row): string {
  if (r.unit === "dona") return `${r.onHand} дона`;
  const liquid = r.unit === "l" || r.unit === "ml";
  return Math.abs(r.onHand) >= 1000
    ? `${(r.onHand / 1000).toFixed(2)} ${liquid ? "л" : "кг"}`
    : `${r.onHand} ${liquid ? "мл" : "г"}`;
}

export function Ombor() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  const [type, setType] = useState<string | null>(null);
  const [negOnly, setNegOnly] = useState(false);
  useEffect(() => {
    trpc.stock.onHand
      .query()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  const shown = useMemo(() => {
    if (!rows) return null;
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!type || r.type === type) &&
        (!negOnly || r.onHand < 0) &&
        (!needle || r.name.toLowerCase().includes(needle)),
    );
  }, [rows, q, type, negOnly]);

  if (!rows || !shown) return <div className="p-6 text-center text-zinc-400">⏳</div>;

  const negatives = rows.filter((r) => r.onHand < 0).length;
  const presentTypes = Object.keys(TYPE_LABEL).filter((t) => rows.some((r) => r.type === t));

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-400">
        Қолдиқ ҳаракатлардан ҳисобланади (обвалка кирим − сотув чиқим). Боғланмаган
        ингредиентлар ҳисобланмайди.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Қидириш…"
          className="w-44 rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-brand"
        />
        <Chip active={type === null} onClick={() => setType(null)}>
          Барчаси
        </Chip>
        {presentTypes.map((t) => (
          <Chip key={t} active={type === t} onClick={() => setType(type === t ? null : t)}>
            {TYPE_LABEL[t]}
          </Chip>
        ))}
        {negatives > 0 && (
          <button
            onClick={() => setNegOnly(!negOnly)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              negOnly ? "bg-red-600 text-white" : "bg-red-50 text-red-600 hover:bg-red-100"
            }`}
          >
            ● Манфий {negatives}
          </button>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium">Маҳсулот</th>
              <th className="px-3 py-2 font-medium">Тур</th>
              <th className="px-4 py-2 text-right font-medium">Қолдиқ</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((r) => (
              <tr key={r.productId} className={r.onHand < 0 ? "bg-red-50/60" : ""}>
                <td className="px-4 py-2">
                  {r.name}
                  {r.onHand < 0 && (
                    <span
                      className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-red-500 align-middle"
                      title="Манфий қолдиқ"
                    />
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-400">
                  {TYPE_LABEL[r.type] ?? r.type}
                </td>
                <td
                  className={`px-4 py-2 text-right font-medium tabular-nums ${
                    r.onHand < 0 ? "text-red-500" : "text-zinc-700"
                  }`}
                >
                  {fmt(r)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-400">
            Ҳали ҳаракат йўқ — обвалка ёзинг ёки заказ ёпинг
          </div>
        ) : shown.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-400">Топилмади</div>
        ) : (
          <div className="px-4 py-2 text-xs text-zinc-400">
            {shown.length} та маҳсулот
            {negatives > 0 && <span className="text-red-400"> · {negatives} манфий</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        active ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}
