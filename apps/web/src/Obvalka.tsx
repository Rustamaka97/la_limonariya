import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "./trpc";

type PartType = {
  id: string;
  name: string;
  normMinPct: number | null;
  normMaxPct: number | null;
  isWaste: boolean;
};
type Item = {
  name: string;
  weightG: number;
  pct: number;
  isWaste: boolean;
  normMinPct: number | null;
  normMaxPct: number | null;
  outOfNorm: boolean;
  costPerKg: number;
};
type Result = {
  carcassType: string;
  weightG: number;
  pricePerKg: number;
  supplier: string | null;
  totalPartsG: number;
  lossPct: number;
  balanceFlag: boolean;
  sellableG: number;
  totalCost: number;
  costPerKg: number;
  items: Item[];
};

const fmt = (n: number) => n.toLocaleString("ru-RU");

export function Obvalka() {
  const [carcass, setCarcass] = useState<"qoy" | "mol">("qoy");
  const [weight, setWeight] = useState("");
  const [price, setPrice] = useState("");
  const [supplier, setSupplier] = useState("");
  const [parts, setParts] = useState<PartType[]>([]);
  const [pw, setPw] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    trpc.obvalka.partTypes
      .query({ carcassType: carcass })
      .then(setParts)
      .catch(() => setParts([]));
    setPw({});
  }, [carcass]);

  const sumKg = useMemo(
    () => Object.values(pw).reduce((s, v) => s + (parseFloat(v) || 0), 0),
    [pw],
  );
  const wKg = parseFloat(weight) || 0;
  const diff = wKg ? ((wKg - sumKg) / wKg) * 100 : 0;

  async function submit() {
    const payload = parts
      .map((p) => ({
        partTypeId: p.id,
        weightG: Math.round((parseFloat(pw[p.id] || "0") || 0) * 1000),
      }))
      .filter((p) => p.weightG > 0);
    if (!wKg || payload.length === 0) return;
    setBusy(true);
    try {
      const { id } = await trpc.obvalka.create.mutate({
        carcassType: carcass,
        weightG: Math.round(wKg * 1000),
        pricePerKg: Math.round(parseFloat(price) || 0),
        supplier: supplier || undefined,
        parts: payload,
      });
      setResult((await trpc.obvalka.get.query({ id })) as Result);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <ResultView
        res={result}
        onBack={() => {
          setResult(null);
          setWeight("");
          setPrice("");
          setSupplier("");
          setPw({});
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border bg-white p-0.5">
        {(["qoy", "mol"] as const).map((c) => (
          <button
            key={c}
            onClick={() => setCarcass(c)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium ${
              carcass === c ? "bg-zinc-900 text-white" : "text-zinc-500"
            }`}
          >
            {c === "qoy" ? "Қўй" : "Мол"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Туша вазни (кг)">
          <input
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="num"
            placeholder="0"
          />
        </Field>
        <Field label="Нарх (so'm/кг)">
          <input
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="num"
            placeholder="0"
          />
        </Field>
        <Field label="Етказувчи">
          <input
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            className="num !text-left"
            placeholder="—"
          />
        </Field>
      </div>

      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="grid grid-cols-2 gap-x-4 p-2 sm:grid-cols-3">
          {parts.map((p) => (
            <label
              key={p.id}
              className="flex items-center justify-between gap-2 px-2 py-1.5"
            >
              <span className="text-sm">
                {p.name}
                {p.isWaste && (
                  <span className="ml-1 text-xs text-zinc-300">чиқ.</span>
                )}
              </span>
              <input
                inputMode="decimal"
                value={pw[p.id] ?? ""}
                onChange={(e) =>
                  setPw((s) => ({ ...s, [p.id]: e.target.value }))
                }
                placeholder="0"
                className="w-16 rounded-md border px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-brand"
              />
            </label>
          ))}
        </div>
        <div
          className={`flex items-center justify-between border-t px-4 py-2 text-sm ${
            Math.abs(diff) > 5 ? "bg-red-50 text-red-600" : "bg-zinc-50 text-zinc-600"
          }`}
        >
          <span>
            Σ қисмлар: <b className="tabular-nums">{sumKg.toFixed(1)}</b> /{" "}
            {wKg.toFixed(1)} кг
          </span>
          <span className="tabular-nums">
            фарқ {diff > 0 ? "−" : "+"}
            {Math.abs(diff).toFixed(1)}%
          </span>
        </div>
      </div>

      <button
        onClick={submit}
        disabled={busy || !wKg || sumKg === 0}
        className="w-full rounded-xl bg-brand py-3 font-medium text-white disabled:opacity-40"
      >
        Ҳисоблаш ва сақлаш
      </button>

      <style>{`.num{width:100%;border:1px solid #e4e4e7;border-radius:.6rem;padding:.55rem .75rem;text-align:right;font-variant-numeric:tabular-nums;outline:none}.num:focus{border-color:#22c55e}`}</style>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function ResultView({ res, onBack }: { res: Result; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-zinc-500 hover:text-zinc-900">
        ← Янги обвалка
      </button>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Туша"
          value={`${(res.weightG / 1000).toFixed(1)} кг`}
          sub={res.carcassType === "qoy" ? "Қўй" : "Мол"}
        />
        <Stat label="Умумий нарх" value={`${fmt(res.totalCost)}`} sub="so'm" />
        <Stat
          label="Баланс"
          value={`${res.lossPct > 0 ? "−" : "+"}${Math.abs(res.lossPct)}%`}
          sub={res.balanceFlag ? "🔴 текшир" : "🟢 жойида"}
          danger={res.balanceFlag}
        />
        <Stat
          label="РЕАЛ ТАННАРХ"
          value={fmt(res.costPerKg)}
          sub={`so'm/кг · ${(res.sellableG / 1000).toFixed(1)}кг сотув`}
          accent
        />
      </div>

      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium">Қисм</th>
              <th className="px-3 py-2 text-right font-medium">кг</th>
              <th className="px-3 py-2 text-right font-medium">%</th>
              <th className="px-3 py-2 text-right font-medium">норма</th>
              <th className="px-3 py-2 text-right font-medium">so'm/кг</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {res.items.map((it, i) => (
              <tr key={i} className={it.outOfNorm ? "bg-amber-50" : ""}>
                <td className="px-4 py-2">
                  {it.name}
                  {it.isWaste && (
                    <span className="ml-1 text-xs text-zinc-400">чиқинди</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {(it.weightG / 1000).toFixed(1)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {it.pct}%{it.outOfNorm && <span className="ml-1">⚠️</span>}
                </td>
                <td className="px-3 py-2 text-right text-xs text-zinc-400 tabular-nums">
                  {it.normMinPct != null ? `${it.normMinPct}–${it.normMaxPct}%` : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {it.costPerKg ? fmt(it.costPerKg) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
  danger,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        accent ? "border-green-200 bg-green-50" : "bg-white"
      } ${danger ? "border-red-200 bg-red-50" : ""}`}
    >
      <div className="text-xs text-zinc-500">{label}</div>
      <div
        className={`mt-0.5 text-lg font-bold tabular-nums ${
          accent ? "text-green-700" : danger ? "text-red-600" : ""
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-zinc-400">{sub}</div>}
    </div>
  );
}
