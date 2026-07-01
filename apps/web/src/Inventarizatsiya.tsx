import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "./App";
import { trpc } from "./trpc";

const STORAGES = ["Ошхона музлаткич", "Катта музлаткич"] as const;
const TYPE_LABEL: Record<string, string> = { part: "Гўшт", ingredient: "Хом-ашё", goods: "Товар" };
const STATUS_LABEL: Record<string, string> = {
  open: "Саналмоқда",
  submitted: "Тасдиқ кутмоқда",
  approved: "Тасдиқланди",
};
const fmt = (n: number) => n.toLocaleString("ru-RU");
const fmtDate = (s: string) => {
  const d = new Date(s);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
function fmtQty(qty: number, unit: string): string {
  if (unit === "dona") return `${qty} дона`;
  const liquid = unit === "l" || unit === "ml";
  return Math.abs(qty) >= 1000
    ? `${(qty / 1000).toFixed(2)} ${liquid ? "л" : "кг"}`
    : `${qty} ${liquid ? "мл" : "г"}`;
}

type ActiveCount = { id: string; storage: string; status: string; createdAt: string; createdBy: string | null };
type HistCount = ActiveCount & { submittedAt: string | null; approvedAt: string | null };

export function Inventarizatsiya({ user }: { user: SessionUser }) {
  const isDirector = user.role === "director";
  const [openId, setOpenId] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveCount[] | null>(null);
  const [hist, setHist] = useState<HistCount[] | null>(null);
  const [err, setErr] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setErr(false);
    Promise.all([trpc.analytics.activeCounts.query(), trpc.analytics.countList.query({})])
      .then(([a, h]) => { setActive(a); setHist(h); })
      .catch(() => setErr(true));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function start(storage: (typeof STORAGES)[number]) {
    setStarting(storage);
    try {
      const r = await trpc.analytics.startCount.mutate({ storage });
      setOpenId(r.id);
    } finally {
      setStarting(null);
    }
  }

  if (openId) return <CountView countId={openId} isDirector={isDirector} onBack={() => { setOpenId(null); refresh(); }} />;

  if (err) return <ErrBox onRetry={refresh} />;
  if (!active || !hist) return <div className="p-6 text-center text-zinc-400">⏳</div>;

  return (
    <div className="space-y-4">
      {active.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50">
          <div className="border-b border-amber-200 px-4 py-2.5 text-sm font-semibold text-amber-800">
            Давом этаётган санашлар
          </div>
          <div className="divide-y divide-amber-200 text-sm">
            {active.map((c) => (
              <button
                key={c.id}
                onClick={() => setOpenId(c.id)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-amber-100"
              >
                <span>
                  <span className="font-medium">{c.storage}</span>{" "}
                  <span className="text-xs text-amber-700">{STATUS_LABEL[c.status] ?? c.status}</span>
                </span>
                <span className="text-xs text-amber-600">{c.createdBy ?? "—"} · {fmtDate(c.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {STORAGES.map((s) => (
          <button
            key={s}
            onClick={() => start(s)}
            disabled={starting === s}
            className="rounded-xl border bg-white p-5 text-left hover:border-brand hover:bg-brand-cream disabled:opacity-50"
          >
            <div className="text-sm text-zinc-400">Янги санаш</div>
            <div className="text-lg font-semibold">{s}</div>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="border-b px-4 py-2.5 text-sm font-semibold">Тарих</div>
        {hist.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-zinc-400">ҳали санаш йўқ</div>
        ) : (
          <div className="divide-y text-sm">
            {hist.map((c) => (
              <button
                key={c.id}
                onClick={() => setOpenId(c.id)}
                className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-zinc-50"
              >
                <span>
                  <span className="font-medium">{c.storage}</span>{" "}
                  <span className="text-xs text-zinc-400">{c.createdBy ?? "—"} · {fmtDate(c.createdAt)}</span>
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    c.status === "approved"
                      ? "bg-emerald-100 text-emerald-700"
                      : c.status === "submitted"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-zinc-100 text-zinc-500"
                  }`}
                >
                  {STATUS_LABEL[c.status] ?? c.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type Item = {
  id: string;
  productId: string;
  name: string;
  type: string;
  unit: string;
  theoreticalQty: number;
  countedQty: number | null;
  counted: boolean;
  diff: number;
  diffPct: number | null;
  valueGap: number | null;
  flag: boolean;
  reason: string | null;
};
type CountData = {
  id: string;
  storage: string;
  status: string;
  note: string | null;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  items: Item[];
};

function CountView({
  countId,
  isDirector,
  onBack,
}: {
  countId: string;
  isDirector: boolean;
  onBack: () => void;
}) {
  const [data, setData] = useState<CountData | null>(null);
  const [err, setErr] = useState(false);
  const [edits, setEdits] = useState<Record<string, { countedQty: string; reason: string }>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr(false);
    trpc.analytics.count
      .query({ countId })
      .then((d) => {
        setData(d);
        const e: Record<string, { countedQty: string; reason: string }> = {};
        for (const it of d.items) e[it.id] = { countedQty: it.countedQty != null ? String(it.countedQty) : "", reason: it.reason ?? "" };
        setEdits(e);
      })
      .catch(() => setErr(true));
  }, [countId]);
  useEffect(() => { load(); }, [load]);

  if (err) return <ErrBox onRetry={load} />;
  if (!data) return <div className="p-6 text-center text-zinc-400">⏳</div>;

  const editable = data.status === "open";
  const canApprove = data.status === "submitted" && isDirector;

  function setEdit(itemId: string, patch: Partial<{ countedQty: string; reason: string }>) {
    setEdits((e) => ({ ...e, [itemId]: { ...e[itemId]!, ...patch } }));
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const items = (data?.items ?? []).map((it) => {
        const e = edits[it.id]!;
        return {
          itemId: it.id,
          countedQty: e.countedQty.trim() === "" ? null : Math.round(Number(e.countedQty)),
          reason: e.reason.trim() || undefined,
        };
      });
      await trpc.analytics.saveCount.mutate({ countId, items });
      load();
      setMsg("Сақланди");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      await save();
      await trpc.analytics.submitCount.mutate({ countId });
      load();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Хато");
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await trpc.analytics.approveCount.mutate({ countId });
      setMsg(r.alreadyApproved ? "Аллақачон тасдиқланган" : `Тасдиқланди — ${r.adjusted} та тузатиш ёзилди`);
      load();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Хато");
    } finally {
      setBusy(false);
    }
  }

  const flagged = data.items.filter((it) => it.flag);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-zinc-500 hover:text-zinc-700">← Орқага</button>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            data.status === "approved"
              ? "bg-emerald-100 text-emerald-700"
              : data.status === "submitted"
                ? "bg-amber-100 text-amber-700"
                : "bg-zinc-100 text-zinc-500"
          }`}
        >
          {STATUS_LABEL[data.status] ?? data.status}
        </span>
      </div>

      <div>
        <h2 className="text-lg font-semibold">{data.storage}</h2>
        <p className="text-xs text-zinc-400">{fmtDate(data.createdAt)} бошланди</p>
      </div>

      {flagged.length > 0 && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          🔴 {flagged.length} та маҳсулотда фарқ &gt;5%
        </div>
      )}

      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Маҳсулот</th>
              <th className="px-3 py-2 text-right font-medium">Ҳисобда</th>
              <th className="px-3 py-2 text-right font-medium">Реал</th>
              <th className="px-3 py-2 text-right font-medium">Фарқ</th>
              {editable && <th className="px-3 py-2 font-medium">Сабаб</th>}
              {!editable && <th className="px-3 py-2 font-medium">Сабаб</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.items.map((it) => {
              const e = edits[it.id];
              // live (unsaved) state — matches server's submitCount predicate exactly,
              // so the red cue never disagrees with what will actually block submit
              const liveCounted = e?.countedQty?.trim() === "" || e?.countedQty == null ? null : Math.round(Number(e.countedQty));
              const liveDiff = liveCounted != null ? liveCounted - it.theoreticalQty : 0;
              const needsReason = liveCounted != null && liveDiff !== 0 && !e?.reason?.trim();
              return (
                <tr key={it.id} className={it.flag ? "bg-red-50" : ""}>
                  <td className="px-3 py-1.5">
                    <span>{it.name}</span>
                    <span className="ml-1.5 text-xs text-zinc-400">{TYPE_LABEL[it.type] ?? it.type}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-zinc-500">
                    {fmtQty(it.theoreticalQty, it.unit)}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {editable ? (
                      <input
                        inputMode="numeric"
                        value={e?.countedQty ?? ""}
                        onChange={(ev) => setEdit(it.id, { countedQty: ev.target.value.replace(/\D/g, "") })}
                        placeholder="—"
                        className="w-24 rounded-lg border px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-brand"
                      />
                    ) : (
                      <span className="tabular-nums">{it.countedQty != null ? fmtQty(it.countedQty, it.unit) : "—"}</span>
                    )}
                  </td>
                  <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${it.flag ? "text-red-600" : it.diff === 0 ? "text-zinc-300" : "text-zinc-600"}`}>
                    {it.counted ? (
                      <>
                        {it.diff > 0 ? "+" : ""}
                        {fmtQty(it.diff, it.unit)}
                        {it.valueGap != null && it.valueGap > 0 && (
                          <div className="text-[11px] font-normal text-zinc-400">{fmt(it.valueGap)} so'm</div>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {editable ? (
                      <input
                        value={e?.reason ?? ""}
                        onChange={(ev) => setEdit(it.id, { reason: ev.target.value })}
                        placeholder={needsReason ? "сабаб (мажбурий)" : "изоҳ"}
                        className={`w-full rounded-lg border px-2 py-1 text-sm outline-none focus:border-brand ${needsReason ? "border-red-300" : ""}`}
                      />
                    ) : (
                      <span className="text-xs text-zinc-500">{it.reason ?? "—"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {msg && <p className="text-sm text-emerald-700">{msg}</p>}

      <div className="flex flex-wrap gap-2">
        {editable && (
          <>
            <button onClick={save} disabled={busy} className="rounded-lg border px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40">
              Сақлаш
            </button>
            <button onClick={submit} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
              Директорга юбориш
            </button>
          </>
        )}
        {canApprove && (
          <button onClick={approve} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
            Тасдиқлаш ва ёзиш
          </button>
        )}
        {data.status === "submitted" && !isDirector && (
          <span className="self-center text-sm text-zinc-400">Директор тасдиғини кутмоқда</span>
        )}
      </div>
    </div>
  );
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
