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
type Line = { name: string; unit: string; qty: number; storage: string | null };
type JournalGroup = {
  key: string;
  type: string;
  note: string | null;
  createdAt: string;
  by: string | null;
  lines: Line[];
};

const STORAGES = ["Ошхона музлаткич", "Катта музлаткич"] as const;

const TYPE_LABEL: Record<string, string> = {
  part: "Гўшт",
  ingredient: "Хом-ашё",
  goods: "Товар",
  semi: "Ярим-т.",
  dish: "Таом",
};
const MOVE_LABEL: Record<string, string> = {
  transfer: "🔄 Кўчириш",
  loss: "🗑 Списание",
  production: "🏭 Ишлаб чиқариш",
  inventory_adjust: "📊 Тузатиш",
};

const dispUnit = (u: string) =>
  u === "kg" ? "кг" : u === "l" ? "л" : u === "dona" ? "дона" : u === "ml" ? "мл" : "г";

function fmtQty(base: number, unit: string): string {
  const s = base < 0 ? "−" : "";
  const a = Math.abs(base);
  if (unit === "dona") return `${s}${a} дона`;
  const liquid = unit === "l" || unit === "ml";
  return a >= 1000 ? `${s}${(a / 1000).toFixed(2)} ${liquid ? "л" : "кг"}` : `${s}${a} ${liquid ? "мл" : "г"}`;
}
const fmt = (r: Row) => fmtQty(r.onHand, r.unit);
const fmtDate = (s: string) => {
  const d = new Date(s);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function Ombor() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [journal, setJournal] = useState<JournalGroup[]>([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState<string | null>(null);
  const [negOnly, setNegOnly] = useState(false);

  const load = () => {
    trpc.stock.onHand.query().then(setRows).catch(() => setRows([]));
    trpc.stock.journal.query().then(setJournal).catch(() => {});
  };
  useEffect(load, []);

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
    <div className="space-y-4">
      <StockActions rows={rows} onDone={load} />

      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="border-b px-4 py-2.5 text-sm font-semibold">Қолдиқ</div>
        <p className="px-4 py-2 text-xs text-zinc-400">
          Ҳаракатлардан ҳисобланади (обвалка кирим − сотув чиқим). Боғланмаган
          ингредиентлар ҳисобланмайди.
        </p>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2">
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

      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="border-b px-4 py-2.5 text-sm font-semibold">📋 Ҳаракатлар журнали</div>
        {journal.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-zinc-400">ҳали ҳаракат йўқ</div>
        ) : (
          <ul className="divide-y text-sm">
            {journal.map((g) => (
              <li key={g.key} className="px-4 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{MOVE_LABEL[g.type] ?? g.type}</span>
                  <span className="text-xs text-zinc-400">
                    {fmtDate(g.createdAt)}{g.by ? ` · ${g.by}` : ""}
                  </span>
                </div>
                <div className="mt-0.5 text-zinc-600">
                  {g.lines.map((l, i) => (
                    <span key={i} className="mr-3 whitespace-nowrap">
                      {l.name}{" "}
                      <span className={`tabular-nums ${l.qty < 0 ? "text-red-500" : "text-emerald-600"}`}>
                        {fmtQty(l.qty, l.unit)}
                      </span>
                      {l.storage ? <span className="text-zinc-400"> ({l.storage})</span> : null}
                    </span>
                  ))}
                </div>
                {g.note && g.type !== "transfer" && (
                  <div className="mt-0.5 text-xs text-zinc-400">{g.note}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StockActions({ rows, onDone }: { rows: Row[]; onDone: () => void }) {
  const [mode, setMode] = useState<"transfer" | "spoilage" | "produce">("transfer");
  const stockable = rows.filter((r) => ["part", "ingredient", "goods", "semi"].includes(r.type));

  const tab = (m: typeof mode, label: string) => (
    <button
      onClick={() => setMode(m)}
      className={`rounded-lg px-3 py-1.5 text-sm ${
        mode === m ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3 rounded-xl border bg-white p-4">
      <div className="flex flex-wrap gap-1.5">
        {tab("transfer", "🔄 Кўчириш")}
        {tab("spoilage", "🗑 Списание")}
        {tab("produce", "🏭 Ишлаб чиқариш")}
      </div>
      {mode === "transfer" && <TransferForm stockable={stockable} onDone={onDone} />}
      {mode === "spoilage" && <SpoilageForm stockable={stockable} onDone={onDone} />}
      {mode === "produce" && <ProduceForm stockable={stockable} onDone={onDone} />}
    </div>
  );
}

function ProductSelect({
  stockable,
  value,
  onChange,
  placeholder,
}: {
  stockable: Row[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand"
    >
      <option value="">{placeholder}</option>
      {stockable.map((r) => (
        <option key={r.productId} value={r.productId}>
          {r.name} (бор: {fmt(r)})
        </option>
      ))}
    </select>
  );
}

function QtyInput({
  value,
  onChange,
  unit,
}: {
  value: string;
  onChange: (v: string) => void;
  unit?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Миқдор"
        className="w-32 rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand"
      />
      <span className="text-sm text-zinc-400">{unit ?? ""}</span>
    </div>
  );
}

function TransferForm({ stockable, onDone }: { stockable: Row[]; onDone: () => void }) {
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [from, setFrom] = useState<(typeof STORAGES)[number]>(STORAGES[1]);
  const [to, setTo] = useState<(typeof STORAGES)[number]>(STORAGES[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const prod = stockable.find((r) => r.productId === productId);

  async function save() {
    setErr(null);
    if (!productId || !(Number(qty) > 0)) return;
    if (from === to) return setErr("Бир хил омбор танланди");
    setBusy(true);
    try {
      await trpc.stock.transfer.mutate({ productId, qty: Number(qty), fromStorage: from, toStorage: to });
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
    <div className="space-y-3">
      <ProductSelect stockable={stockable} value={productId} onChange={setProductId} placeholder="Маҳсулот танланг…" />
      <QtyInput value={qty} onChange={setQty} unit={prod ? dispUnit(prod.unit) : ""} />
      <div className="flex items-center gap-2 text-sm">
        <StoragePick value={from} onChange={setFrom} label="Қаердан" />
        <span className="text-zinc-400">→</span>
        <StoragePick value={to} onChange={setTo} label="Қаерга" />
      </div>
      {err && <p className="text-sm text-red-500">{err}</p>}
      <SaveBtn onClick={save} disabled={busy || !productId || !(Number(qty) > 0)} label="Кўчириш" />
    </div>
  );
}

function SpoilageForm({ stockable, onDone }: { stockable: Row[]; onDone: () => void }) {
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const prod = stockable.find((r) => r.productId === productId);

  async function save() {
    setErr(null);
    if (!productId || !(Number(qty) > 0) || !reason.trim()) return;
    setBusy(true);
    try {
      await trpc.stock.spoilage.mutate({ productId, qty: Number(qty), reason: reason.trim() });
      setQty("");
      setProductId("");
      setReason("");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Хатолик");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <ProductSelect stockable={stockable} value={productId} onChange={setProductId} placeholder="Бузилган маҳсулот…" />
      <QtyInput value={qty} onChange={setQty} unit={prod ? dispUnit(prod.unit) : ""} />
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Сабаб (мажбурий) — масалан: муддати ўтди"
        className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand"
      />
      {err && <p className="text-sm text-red-500">{err}</p>}
      <SaveBtn
        onClick={save}
        disabled={busy || !productId || !(Number(qty) > 0) || !reason.trim()}
        label="Ҳисобдан чиқариш"
      />
    </div>
  );
}

function ProduceForm({ stockable, onDone }: { stockable: Row[]; onDone: () => void }) {
  const [outId, setOutId] = useState("");
  const [outQty, setOutQty] = useState("");
  const [inputs, setInputs] = useState<{ productId: string; qty: string }[]>([{ productId: "", qty: "" }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const outProd = stockable.find((r) => r.productId === outId);

  const setInput = (i: number, patch: Partial<{ productId: string; qty: string }>) =>
    setInputs((arr) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const validInputs = inputs.filter((x) => x.productId && Number(x.qty) > 0);

  async function save() {
    setErr(null);
    if (!outId || !(Number(outQty) > 0) || validInputs.length === 0) return;
    setBusy(true);
    try {
      await trpc.stock.produce.mutate({
        outputProductId: outId,
        outputQty: Number(outQty),
        inputs: validInputs.map((x) => ({ productId: x.productId, qty: Number(x.qty) })),
      });
      setOutId("");
      setOutQty("");
      setInputs([{ productId: "", qty: "" }]);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Хатолик");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-xs font-medium text-emerald-700">Чиқади (ярим-тайёр)</div>
        <ProductSelect stockable={stockable} value={outId} onChange={setOutId} placeholder="Тайёр маҳсулот…" />
        <div className="mt-2">
          <QtyInput value={outQty} onChange={setOutQty} unit={outProd ? dispUnit(outProd.unit) : ""} />
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-red-600">Кетади (хом-ашё)</div>
        <div className="space-y-2">
          {inputs.map((row, i) => {
            const p = stockable.find((r) => r.productId === row.productId);
            return (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1">
                  <ProductSelect
                    stockable={stockable}
                    value={row.productId}
                    onChange={(v) => setInput(i, { productId: v })}
                    placeholder="Хом-ашё…"
                  />
                </div>
                <input
                  type="number"
                  inputMode="decimal"
                  value={row.qty}
                  onChange={(e) => setInput(i, { qty: e.target.value })}
                  placeholder="Миқдор"
                  className="w-24 rounded-lg border px-2 py-2 text-sm outline-none focus:border-brand"
                />
                <span className="w-8 text-xs text-zinc-400">{p ? dispUnit(p.unit) : ""}</span>
                {inputs.length > 1 && (
                  <button
                    onClick={() => setInputs((arr) => arr.filter((_, j) => j !== i))}
                    className="text-zinc-300 hover:text-red-500"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <button
          onClick={() => setInputs((arr) => [...arr, { productId: "", qty: "" }])}
          className="mt-2 text-sm font-medium text-emerald-600 hover:underline"
        >
          + хом-ашё қўшиш
        </button>
      </div>
      {err && <p className="text-sm text-red-500">{err}</p>}
      <SaveBtn
        onClick={save}
        disabled={busy || !outId || !(Number(outQty) > 0) || validInputs.length === 0}
        label="Ишлаб чиқариш"
      />
    </div>
  );
}

function SaveBtn({ onClick, disabled, label }: { onClick: () => void; disabled: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
    >
      {label}
    </button>
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
        className="rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-brand"
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
