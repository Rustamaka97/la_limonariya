import { useEffect, useState } from "react";
import { trpc } from "./trpc";

type Row = {
  productId: string;
  name: string;
  type: string;
  unit: string;
  onHand: number;
};
type Transfer = {
  refId: string;
  name: string;
  unit: string;
  qty: number;
  from: string | null;
  to: string | null;
  createdAt: string;
  by: string | null;
};

const STORAGES = ["Ошхона музлаткич", "Катта музлаткич"] as const;

const TYPE_LABEL: Record<string, string> = {
  part: "Гўшт",
  ingredient: "Хом-ашё",
  goods: "Товар",
  semi: "Ярим-т.",
  dish: "Таом",
};

const dispUnit = (u: string) => (u === "kg" ? "кг" : u === "l" ? "л" : u === "dona" ? "дона" : u === "ml" ? "мл" : "г");

function fmtQty(base: number, unit: string): string {
  if (unit === "dona") return `${base} дона`;
  const liquid = unit === "l" || unit === "ml";
  return Math.abs(base) >= 1000
    ? `${(base / 1000).toFixed(2)} ${liquid ? "л" : "кг"}`
    : `${base} ${liquid ? "мл" : "г"}`;
}
function fmt(r: Row): string {
  return fmtQty(r.onHand, r.unit);
}
const fmtDate = (s: string) => {
  const d = new Date(s);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function Ombor() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  const load = () => {
    trpc.stock.onHand.query().then(setRows).catch(() => setRows([]));
    trpc.stock.transfers.query().then(setTransfers).catch(() => {});
  };
  useEffect(load, []);

  if (!rows) return <div className="p-6 text-center text-zinc-400">⏳</div>;

  return (
    <div className="space-y-4">
      <TransferForm rows={rows} onDone={load} />

      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="border-b px-4 py-2.5 text-sm font-semibold">Қолдиқ</div>
        <p className="px-4 py-2 text-xs text-zinc-400">
          Ҳаракатлардан ҳисобланади (обвалка кирим − сотув чиқим). Боғланмаган
          ингредиентлар ҳисобланмайди.
        </p>
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium">Маҳсулот</th>
              <th className="px-3 py-2 font-medium">Тур</th>
              <th className="px-4 py-2 text-right font-medium">Қолдиқ</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.productId}>
                <td className="px-4 py-2">{r.name}</td>
                <td className="px-3 py-2 text-xs text-zinc-400">{TYPE_LABEL[r.type] ?? r.type}</td>
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
        {rows.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-zinc-400">
            Ҳали ҳаракат йўқ — обвалка ёзинг ёки заказ ёпинг
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="border-b px-4 py-2.5 text-sm font-semibold">🔄 Кўчиришлар тарихи</div>
        {transfers.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-zinc-400">ҳали кўчириш йўқ</div>
        ) : (
          <ul className="divide-y text-sm">
            {transfers.map((t) => (
              <li key={t.refId} className="flex items-center justify-between px-4 py-2.5">
                <span>
                  <span className="font-medium">{t.name}</span>{" "}
                  <span className="tabular-nums text-zinc-500">{fmtQty(t.qty, t.unit)}</span>
                  <span className="text-zinc-400"> · {t.from} → {t.to}</span>
                </span>
                <span className="text-xs text-zinc-400">
                  {fmtDate(t.createdAt)}{t.by ? ` · ${t.by}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TransferForm({ rows, onDone }: { rows: Row[]; onDone: () => void }) {
  const stockable = rows.filter((r) => ["part", "ingredient", "goods", "semi"].includes(r.type));
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [from, setFrom] = useState<(typeof STORAGES)[number]>(STORAGES[1]);
  const [to, setTo] = useState<(typeof STORAGES)[number]>(STORAGES[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const prod = stockable.find((r) => r.productId === productId);

  async function save() {
    setErr(null);
    const n = Number(qty);
    if (!productId || !(n > 0)) return;
    if (from === to) {
      setErr("Бир хил омбор танланди");
      return;
    }
    setBusy(true);
    try {
      await trpc.stock.transfer.mutate({ productId, qty: n, fromStorage: from, toStorage: to });
      setQty("");
      setProductId("");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Хатолик");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border bg-white p-4">
      <div className="text-sm font-semibold">🔄 Омбор ораси кўчириш</div>
      <select
        value={productId}
        onChange={(e) => setProductId(e.target.value)}
        className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand"
      >
        <option value="">Маҳсулот танланг…</option>
        {stockable.map((r) => (
          <option key={r.productId} value={r.productId}>
            {r.name} (бор: {fmt(r)})
          </option>
        ))}
      </select>

      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="Миқдор"
          className="w-32 rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <span className="text-sm text-zinc-400">{prod ? dispUnit(prod.unit) : ""}</span>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <StoragePick value={from} onChange={setFrom} label="Қаердан" />
        <span className="text-zinc-400">→</span>
        <StoragePick value={to} onChange={setTo} label="Қаерга" />
      </div>

      {err && <p className="text-sm text-red-500">{err}</p>}

      <button
        onClick={save}
        disabled={busy || !productId || !(Number(qty) > 0)}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
      >
        Кўчириш
      </button>
    </div>
  );
}

function StoragePick({
  value,
  onChange,
  label,
}: {
  value: (typeof STORAGES)[number];
  onChange: (v: (typeof STORAGES)[number]) => void;
  label: string;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-xs text-zinc-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as (typeof STORAGES)[number])}
        className="rounded-lg border px-2 py-1.5 outline-none focus:border-brand"
      >
        {STORAGES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );
}
