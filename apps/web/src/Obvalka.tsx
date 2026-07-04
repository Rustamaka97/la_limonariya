import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { SessionUser } from "./App";
import { trpc } from "./trpc";
import { Skeleton } from "./Skeleton";
import { swr } from "./lib/cache";

function vibrate(pattern: number | number[]) {
  if ("vibrate" in navigator) navigator.vibrate(pattern);
}

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

export function Obvalka({ user }: { user: SessionUser }) {
  const [carcass, setCarcass] = useState<"qoy" | "mol">("qoy");
  const [weight, setWeight] = useState("");
  const [price, setPrice] = useState("");
  const [supplier, setSupplier] = useState("");
  const [parts, setParts] = useState<PartType[]>([]);
  const [pw, setPw] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [purchaseList, setPurchaseList] = useState<
    { id: string; supplier: string | null; total: number; createdAt: string; alreadyLinked: boolean }[]
  >([]);
  const [purchaseId, setPurchaseId] = useState("");
  const [shortReason, setShortReason] = useState("");

  useEffect(() => {
    trpc.obvalka.partTypes
      .query({ carcassType: carcass })
      .then(setParts)
      .catch(() => setParts([]));
    setPw({});
  }, [carcass]);

  useEffect(() => {
    swr("obvalka.purchases", () => trpc.obvalka.purchases.query(), setPurchaseList).catch(() => {});
  }, []);

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
        purchaseId: purchaseId || undefined,
        shortReason: diff > 5 && shortReason.trim() ? shortReason.trim() : undefined,
        parts: payload,
      });
      setResult((await trpc.obvalka.get.query({ id })) as Result);
      vibrate([20, 40, 20]);
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
          setPurchaseId("");
          setShortReason("");
          setPw({});
          swr("obvalka.purchases", () => trpc.obvalka.purchases.query(), setPurchaseList).catch(() => {});
        }}
      />
    );
  }

  if (busy) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-500">
          <Skeleton className="h-4 w-4 rounded-full" />
          Ҳисобланмоқда…
        </div>
        <Skeleton className="h-9 w-40" />
        <div className="grid grid-cols-3 gap-3">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
        <Skeleton className="h-40" />
        <Skeleton className="h-12" />
      </div>
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

      {["director", "manager"].includes(user.role) && (
        <NormLearnPanel
          carcass={carcass}
          user={user}
          onApplied={() =>
            trpc.obvalka.partTypes
              .query({ carcassType: carcass })
              .then(setParts)
              .catch(() => {})
          }
        />
      )}

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

      {purchaseList.length > 0 && (
        <Field label="Харид (ихтиёрий боғлаш)">
          <select
            value={purchaseId}
            onChange={(e) => setPurchaseId(e.target.value)}
            className="w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:border-brand"
          >
            <option value="">— боғланмаган —</option>
            {purchaseList.map((p) => (
              <option key={p.id} value={p.id} disabled={p.alreadyLinked}>
                {(p.supplier ?? "базар")} · {fmt(p.total)} so'm ·{" "}
                {new Date(p.createdAt).toLocaleDateString("ru-RU")}
                {p.alreadyLinked ? " (уланган)" : ""}
              </option>
            ))}
          </select>
        </Field>
      )}

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

      {diff > 5 && (
        <input
          value={shortReason}
          onChange={(e) => setShortReason(e.target.value)}
          placeholder="Сабаб — кам келди (ихтиёрий): бозорчи кам олиб келди / ёзувда йўқ ..."
          className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm outline-none focus:border-red-400"
        />
      )}

      <button
        onClick={submit}
        disabled={busy || !wKg || sumKg === 0}
        className="w-full rounded-xl bg-brand py-3 font-medium text-white disabled:opacity-40"
      >
        Ҳисоблаш ва сақлаш
      </button>

      <MarinadeForm />

      <style>{`.num{width:100%;border:1px solid #e4e4e7;border-radius:.6rem;padding:.55rem .75rem;text-align:right;font-variant-numeric:tabular-nums;outline:none}.num:focus{border-color:#22c55e}`}</style>
    </div>
  );
}

// Маринад партияси: хом лаҳм → маринадланган гўшт (сих грамм назорати учун).
function MarinadeForm() {
  const GROWTH: Record<"qoy" | "mol", number> = { qoy: 15, mol: 13 };
  const [ct, setCt] = useState<"qoy" | "mol">("qoy");
  const [rawKg, setRawKg] = useState("");
  const [growth, setGrowth] = useState("15");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const rawG = Math.round((parseFloat(rawKg) || 0) * 1000);
  const g = parseInt(growth || "0", 10) || 0;
  const marinatedG = Math.round(rawG * (1 + g / 100));

  async function submit() {
    if (rawG <= 0) return;
    setBusy(true);
    setDone(null);
    try {
      await trpc.marinade.create.mutate({ carcassType: ct, rawG, growthPct: g });
      setDone(`${(rawG / 1000).toFixed(1)} кг хом → ${(marinatedG / 1000).toFixed(1)} кг маринад`);
      setRawKg("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="text-sm font-semibold text-zinc-700">🍢 Маринад партияси</div>
      <div className="inline-flex rounded-lg border bg-white p-0.5">
        {(["qoy", "mol"] as const).map((c) => (
          <button
            key={c}
            onClick={() => { setCt(c); setGrowth(String(GROWTH[c])); }}
            className={`rounded-md px-4 py-1.5 text-sm font-medium ${ct === c ? "bg-zinc-900 text-white" : "text-zinc-500"}`}
          >
            {c === "qoy" ? "Қўй" : "Мол"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Хом лаҳм (кг)">
          <input inputMode="decimal" value={rawKg} onChange={(e) => setRawKg(e.target.value)} className="num" placeholder="0" />
        </Field>
        <Field label="Маринад ўсиши (%)">
          <input inputMode="numeric" value={growth} onChange={(e) => setGrowth(e.target.value.replace(/\D/g, ""))} className="num" placeholder="15" />
        </Field>
      </div>
      {rawG > 0 && (
        <div className="text-sm text-zinc-600">
          → маринад: <b className="tabular-nums">{(marinatedG / 1000).toFixed(1)}</b> кг
        </div>
      )}
      {done && <div className="text-sm text-emerald-700">✓ {done}</div>}
      <button
        onClick={submit}
        disabled={busy || rawG <= 0}
        className="w-full rounded-xl bg-amber-600 py-2.5 text-sm font-medium text-white disabled:opacity-40"
      >
        Маринад сақлаш
      </button>
    </div>
  );
}

type Suggestion = {
  partTypeId: string;
  name: string;
  isWaste: boolean;
  currentMin: number | null;
  currentMax: number | null;
  n: number;
  median: number | null;
  mad: number | null;
  learnedMin: number | null;
  learnedMax: number | null;
  suggestedMin: number | null;
  suggestedMax: number | null;
  enough: boolean;
  changed: boolean;
  wouldWiden: boolean;
  disjoint: boolean;
};
type SuggestResp = {
  sampleCarcasses: number;
  minSamples: number;
  parts: Suggestion[];
};

// Ўз-ўзидан ўрганадиган норма: рестораннинг ЎЗ сўнгги тоза тушаларидан ҳар қисм
// учун чиқиш% банди. Директор кўриб бир тугма билан қўллайди (авто-ёзмайди —
// икки ёмон обвалка нормани "кенгайтириб", ўғирликни яшириб қўймасин).
function NormLearnPanel({
  carcass,
  user,
  onApplied,
}: {
  carcass: "qoy" | "mol";
  user: SessionUser;
  onApplied: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SuggestResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const isDirector = user.role === "director";

  useEffect(() => {
    if (!open) return;
    setBusy(true);
    setMsg(null);
    setData(null);
    trpc.obvalka.normSuggestions
      .query({ carcassType: carcass })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setBusy(false));
  }, [open, carcass]);

  const changes = data?.parts.filter((p) => p.enough && p.changed) ?? [];

  async function apply() {
    if (!changes.length) return;
    if (!confirm(`${changes.length} та қисм нормаси янгиланади. Давом этамизми?`))
      return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await trpc.obvalka.applyNorms.mutate({
        updates: changes.map((p) => ({
          partTypeId: p.partTypeId,
          normMinPct: p.suggestedMin!,
          normMaxPct: p.suggestedMax!,
        })),
      });
      setMsg(`✓ ${res.updated} норма янгиланди`);
      onApplied();
      setData(await trpc.obvalka.normSuggestions.query({ carcassType: carcass }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/50">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium text-indigo-800"
      >
        <span>
          🧠 Норма ўрганиш{" "}
          <span className="text-xs font-normal text-indigo-400">
            — сўнгги тоза тушалардан
          </span>
        </span>
        <span className="text-indigo-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-indigo-100 p-3">
          {busy && !data && (
            <div className="text-sm text-zinc-400">юкланмоқда…</div>
          )}
          {data && (
            <>
              <div className="text-xs text-zinc-500">
                {data.sampleCarcasses} та тоза туша (кам-келтириш ±5% ичида) ·
                норма = медиана ± MAD. Норма фақат{" "}
                <b>торайтирилади</b> — детекция сусаймайди.
                {data.sampleCarcasses < data.minSamples &&
                  " — маълумот кам, ишончсиз."}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-zinc-400">
                    <tr>
                      <th className="py-1 pr-2 font-medium">Қисм</th>
                      <th className="px-2 py-1 text-right font-medium">Жорий</th>
                      <th className="px-2 py-1 text-right font-medium">
                        Data
                      </th>
                      <th className="px-2 py-1 text-right font-medium">
                        Янги банд
                      </th>
                      <th className="px-2 py-1 text-center font-medium">N</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-indigo-100">
                    {data.parts.map((p) => (
                      <tr
                        key={p.partTypeId}
                        className={p.enough && p.changed ? "bg-indigo-100/40" : ""}
                      >
                        <td className="py-1.5 pr-2">
                          {p.name}
                          {p.isWaste && (
                            <span className="ml-1 text-xs text-zinc-300">
                              чиқ.
                            </span>
                          )}
                          {p.disjoint && (
                            <span
                              className="ml-1 text-xs text-red-500"
                              title="Data жорий нормадан бутунлай ташқарида — текширинг"
                            >
                              ⚠
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">
                          {p.currentMin != null
                            ? `${p.currentMin}–${p.currentMax}%`
                            : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">
                          {p.enough && p.learnedMin != null ? (
                            <span title={`медиана ${p.median}%`}>
                              {p.learnedMin}–{p.learnedMax}%
                              {p.wouldWiden && (
                                <span
                                  className="ml-0.5 text-zinc-300"
                                  title="Data кенгроқ — торайтирилмайди"
                                >
                                  🔒
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-xs text-zinc-300">
                              кам ({p.n}/{data.minSamples})
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {p.enough && p.changed ? (
                            <span className="font-semibold text-indigo-700">
                              {p.suggestedMin}–{p.suggestedMax}%
                            </span>
                          ) : (
                            <span className="text-xs text-zinc-300">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-center text-xs tabular-nums text-zinc-400">
                          {p.n}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {msg && <div className="text-sm text-emerald-700">{msg}</div>}
              {isDirector ? (
                <button
                  onClick={apply}
                  disabled={busy || changes.length === 0}
                  className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  {changes.length
                    ? `${changes.length} қисм нормасини торайтириш`
                    : "торайтириш йўқ"}
                </button>
              ) : (
                <div className="text-xs text-zinc-400">
                  Қўллашни директор бажаради.
                </div>
              )}
            </>
          )}
        </div>
      )}
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
