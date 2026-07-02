import { useCallback, useEffect, useState } from "react";
import { trpc } from "./trpc";

const CATEGORIES = ["idish", "mebel", "texnika", "boshqa"] as const;
type Category = (typeof CATEGORIES)[number];
const CATEGORY_LABEL: Record<Category, string> = {
  idish: "Идиш-товоқ",
  mebel: "Мебель",
  texnika: "Техника",
  boshqa: "Бошқа",
};
const REASON_LABEL: Record<string, string> = {
  kirim: "Кирим",
  sindi: "Синди",
  yoqoldi: "Йўқолди",
  tuzatish: "Тузатиш",
};
const fmtDate = (s: string) => {
  const d = new Date(s);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

type AssetRow = { id: string; category: Category; name: string; note: string | null; qty: number };

export function Inventar() {
  const [rows, setRows] = useState<AssetRow[] | null>(null);
  const [err, setErr] = useState(false);
  const [openAsset, setOpenAsset] = useState<AssetRow | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(() => {
    setErr(false);
    trpc.assets.list.query().then(setRows).catch(() => setErr(true));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  if (openAsset)
    return (
      <AssetDetail
        asset={openAsset}
        onBack={() => {
          setOpenAsset(null);
          refresh();
        }}
      />
    );
  if (err) return <ErrBox onRetry={refresh} />;
  if (!rows) return <div className="p-6 text-center text-zinc-400">⏳</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Инвентарь</h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white"
          >
            + Янги тур
          </button>
        )}
      </div>

      {adding && (
        <AddForm
          onDone={() => {
            setAdding(false);
            refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {rows.length === 0 && !adding && (
        <div className="rounded-xl border bg-white px-4 py-8 text-center text-sm text-zinc-400">
          ҳали тур қўшилмаган
        </div>
      )}

      {CATEGORIES.map((cat) => {
        const items = rows.filter((r) => r.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} className="overflow-hidden rounded-xl border bg-white">
            <div className="border-b px-4 py-2.5 text-sm font-semibold">{CATEGORY_LABEL[cat]}</div>
            <div className="divide-y text-sm">
              {items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => setOpenAsset(it)}
                  className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-zinc-50"
                >
                  <span>
                    <span className="font-medium">{it.name}</span>
                    {it.note && <span className="ml-1.5 text-xs text-zinc-400">{it.note}</span>}
                  </span>
                  <span className="tabular-nums font-medium">{it.qty} дона</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AddForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [category, setCategory] = useState<Category>("idish");
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await trpc.assets.create.mutate({
        category,
        name: name.trim(),
        note: note.trim() || undefined,
        initialQty: qty ? Math.round(Number(qty)) : undefined,
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border bg-zinc-50 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          className="rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-brand"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="номи (мас. Катта тарелка)"
          className="rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-brand sm:col-span-2"
        />
        <input
          inputMode="numeric"
          value={qty}
          onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))}
          placeholder="сони"
          className="rounded-lg border px-2 py-1.5 text-right text-sm outline-none focus:border-brand"
        />
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="изоҳ (ихтиёрий)"
        className="w-full rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-brand"
      />
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy || !name.trim()}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Қўшиш
        </button>
        <button onClick={onCancel} className="rounded-lg border px-3 py-1.5 text-sm">
          Бекор
        </button>
      </div>
    </div>
  );
}

type Movement = {
  id: string;
  qty: number;
  reason: string;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
  responsibleName: string | null;
};
type Staff = { id: string; name: string; active: boolean };

function AssetDetail({ asset, onBack }: { asset: AssetRow; onBack: () => void }) {
  const [hist, setHist] = useState<Movement[] | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [err, setErr] = useState(false);
  const [mode, setMode] = useState<"kirim" | "chiqim" | null>(null);

  const load = useCallback(() => {
    setErr(false);
    trpc.assets.history.query({ assetId: asset.id }).then(setHist).catch(() => setErr(true));
  }, [asset.id]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    trpc.users.list.query().then(setStaff).catch(() => setStaff([]));
  }, []);

  if (err) return <ErrBox onRetry={load} />;

  const qty = hist ? hist.reduce((s, m) => s + m.qty, 0) : null;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-zinc-500 hover:text-zinc-700">
        ← Орқага
      </button>

      <div>
        <h2 className="text-lg font-semibold">{asset.name}</h2>
        <p className="text-xs text-zinc-400">
          {CATEGORY_LABEL[asset.category]}
          {asset.note ? ` · ${asset.note}` : ""}
        </p>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="text-xs text-zinc-500">Ҳозирги сон</div>
        <div className="text-2xl font-bold tabular-nums">{qty ?? "…"} дона</div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setMode(mode === "kirim" ? null : "kirim")}
          className="flex-1 rounded-lg border border-emerald-200 bg-emerald-50 py-2.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
        >
          + Кирим
        </button>
        <button
          onClick={() => setMode(mode === "chiqim" ? null : "chiqim")}
          className="flex-1 rounded-lg border border-red-200 bg-red-50 py-2.5 text-sm font-medium text-red-700 hover:bg-red-100"
        >
          − Чиқим
        </button>
      </div>

      {mode && (
        <AdjustForm
          assetId={asset.id}
          mode={mode}
          staff={staff.filter((s) => s.active)}
          onDone={() => {
            setMode(null);
            load();
          }}
          onCancel={() => setMode(null)}
        />
      )}

      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="border-b px-4 py-2.5 text-sm font-semibold">Тарих</div>
        {!hist ? (
          <div className="px-4 py-6 text-center text-sm text-zinc-400">⏳</div>
        ) : hist.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-zinc-400">ҳали ҳаракат йўқ</div>
        ) : (
          <div className="divide-y text-sm">
            {hist.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-4 py-2">
                <span>
                  <span className={`font-medium tabular-nums ${m.qty > 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {m.qty > 0 ? "+" : ""}
                    {m.qty}
                  </span>{" "}
                  <span className="text-xs text-zinc-400">
                    {REASON_LABEL[m.reason] ?? m.reason}
                    {m.responsibleName ? ` · айбдор: ${m.responsibleName}` : ""}
                    {m.note ? ` · ${m.note}` : ""}
                  </span>
                </span>
                <span className="text-xs text-zinc-400">
                  {m.createdByName ?? "—"} · {fmtDate(m.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AdjustForm({
  assetId,
  mode,
  staff,
  onDone,
  onCancel,
}: {
  assetId: string;
  mode: "kirim" | "chiqim";
  staff: Staff[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<"sindi" | "yoqoldi" | "tuzatish">("sindi");
  const [responsibleId, setResponsibleId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const n = Math.round(Number(amount));
    if (!n || n <= 0) return;
    setBusy(true);
    try {
      await trpc.assets.adjust.mutate({
        assetId,
        qty: mode === "kirim" ? n : -n,
        reason: mode === "kirim" ? "kirim" : reason,
        responsibleId: mode === "chiqim" && responsibleId ? responsibleId : undefined,
        note: note.trim() || undefined,
      });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border bg-zinc-50 p-3">
      <div className="grid grid-cols-2 gap-2">
        <input
          autoFocus
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          placeholder="сон"
          className="rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-brand"
        />
        {mode === "chiqim" && (
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as "sindi" | "yoqoldi" | "tuzatish")}
            className="rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-brand"
          >
            <option value="sindi">Синди</option>
            <option value="yoqoldi">Йўқолди</option>
            <option value="tuzatish">Тузатиш</option>
          </select>
        )}
      </div>
      {mode === "chiqim" && (
        <select
          value={responsibleId}
          onChange={(e) => setResponsibleId(e.target.value)}
          className="w-full rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-brand"
        >
          <option value="">Айбдор (ихтиёрий)</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="изоҳ (ихтиёрий)"
        className="w-full rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-brand"
      />
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy || !amount}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Сақлаш
        </button>
        <button onClick={onCancel} className="rounded-lg border px-3 py-1.5 text-sm">
          Бекор
        </button>
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
