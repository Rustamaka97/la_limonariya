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
const fmt = (n: number) => n.toLocaleString("ru-RU");

type AssetRow = {
  id: string;
  category: Category;
  name: string;
  note: string | null;
  price: number | null;
  qty: number;
};
type Damage = { responsibleId: string | null; responsibleName: string; totalSom: number; totalQty: number };

export function Inventar() {
  const [rows, setRows] = useState<AssetRow[] | null>(null);
  const [damage, setDamage] = useState<Damage[]>([]);
  const [unpricedDamage, setUnpricedDamage] = useState(0);
  const [err, setErr] = useState(false);
  const [openAsset, setOpenAsset] = useState<AssetRow | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(() => {
    setErr(false);
    trpc.assets.list.query().then(setRows).catch(() => setErr(true));
    trpc.assets.damageByStaff.query().then((d) => {
      setDamage(d.rows);
      setUnpricedDamage(d.unpricedCount);
    }).catch(() => {
      setDamage([]);
      setUnpricedDamage(0);
    });
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

      {damage.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50">
          <div className="border-b border-amber-200 px-4 py-2.5 text-sm font-semibold text-amber-800">
            Ходимлар бўйича зарар (пул ундириш учун)
          </div>
          <div className="divide-y divide-amber-200 text-sm">
            {damage.map((d) => (
              <div key={d.responsibleId} className="flex items-center justify-between px-4 py-2">
                <span>{d.responsibleName}</span>
                <span className="tabular-nums font-medium text-amber-800">
                  {fmt(d.totalSom)} so'm <span className="text-xs text-amber-600">({d.totalQty} дона)</span>
                </span>
              </div>
            ))}
          </div>
          {unpricedDamage > 0 && (
            <div className="border-t border-amber-200 px-4 py-2 text-xs text-amber-700">
              ⚠️ яна {unpricedDamage} та зарар нархсиз турга тегишли — юқоридаги
              сумма тўлиқ эмас. Тур нархини қўйсангиз, ҳисобга қўшилади.
            </div>
          )}
        </div>
      )}
      {damage.length === 0 && unpricedDamage > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
          ⚠️ {unpricedDamage} та зарар қайд этилган, лекин турлар нархсиз —
          нархини қўйсангиз, ходимлар бўйича ҳисоб кўринади.
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
                    {it.price != null && (
                      <span className="ml-1.5 text-xs text-zinc-400">{fmt(it.price)} so'm/дона</span>
                    )}
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
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await trpc.assets.create.mutate({
        category,
        name: name.trim(),
        note: note.trim() || undefined,
        price: price ? Math.round(Number(price)) : undefined,
        initialQty: qty ? Math.round(Number(qty)) : undefined,
      });
      onDone();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Хато");
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
      <div className="grid grid-cols-2 gap-2">
        <input
          inputMode="numeric"
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
          placeholder="нархи so'm/дона (ихтиёрий)"
          className="rounded-lg border px-2 py-1.5 text-right text-sm outline-none focus:border-brand"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="изоҳ (ихтиёрий)"
          className="rounded-lg border px-2 py-1.5 text-sm outline-none focus:border-brand"
        />
      </div>
      {err && <p className="text-sm text-red-500">{err}</p>}
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
  unitPrice: number | null;
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
  const [price, setPrice] = useState(asset.price);
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState(asset.price != null ? String(asset.price) : "");
  const [priceBusy, setPriceBusy] = useState(false);

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

  async function savePrice() {
    const n = Math.round(Number(priceInput));
    if (priceInput === "" || Number.isNaN(n) || n < 0) return;
    setPriceBusy(true);
    try {
      await trpc.assets.setPrice.mutate({ assetId: asset.id, price: n });
      setPrice(n);
      setEditingPrice(false);
    } finally {
      setPriceBusy(false);
    }
  }

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

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border bg-white p-4">
          <div className="text-xs text-zinc-500">Ҳозирги сон</div>
          <div className="text-2xl font-bold tabular-nums">{qty ?? "…"} дона</div>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="text-xs text-zinc-500">Нархи (дона)</div>
          {editingPrice ? (
            <div className="mt-1 flex gap-1.5">
              <input
                autoFocus
                inputMode="numeric"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value.replace(/\D/g, ""))}
                className="w-full rounded-lg border px-2 py-1 text-sm tabular-nums outline-none focus:border-brand"
              />
              <button
                onClick={savePrice}
                disabled={priceBusy}
                className="rounded-lg bg-brand px-2.5 text-sm font-medium text-white disabled:opacity-40"
              >
                ✓
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setPriceInput(price != null ? String(price) : "");
                setEditingPrice(true);
              }}
              className="text-left"
            >
              <span className="text-2xl font-bold tabular-nums">{price != null ? fmt(price) : "—"}</span>
              <span className="ml-1 text-xs text-zinc-400">{price != null ? "so'm" : "қўйиш"}</span>
            </button>
          )}
        </div>
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
                    {m.unitPrice != null ? ` · ${fmt(Math.abs(m.qty) * m.unitPrice)} so'm` : ""}
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
  const [correction, setCorrection] = useState(false);
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
        reason: mode === "kirim" ? (correction ? "tuzatish" : "kirim") : reason,
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
      {mode === "kirim" && (
        <label className="flex items-center gap-1.5 text-xs text-zinc-500">
          <input
            type="checkbox"
            checked={correction}
            onChange={(e) => setCorrection(e.target.checked)}
          />
          Тузатиш сифатида (қайта санашда кўпроқ топилди — янги харид эмас)
        </label>
      )}
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
