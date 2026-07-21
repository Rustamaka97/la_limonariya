import { useEffect, useState } from "react";
import { trpc } from "./trpc";

// 🎁 Лоялти CRM — мижозлар ва ҳамён (кешбэк/бонус). Баланс = SUM(ledger).
// Директор бонус беради / редемпшн (сарф) ёзади. Авто-кешбэк (close'да) ва
// чекаут-редемпшн — кейинги фаза (пул йўли синовдан ўтгач).

type Row = { id: string; name: string; phone: string | null; balance: number };
type Move = {
  id: string;
  amount: number;
  kind: string;
  note: string | null;
  createdAt: string;
  by: string | null;
};
type Profile = {
  visits: number;
  totalSpent: number;
  avgCheck: number;
  lastVisit: string | null;
  topDishes: { name: string; qty: number }[];
};

const fmt = (n: number) => n.toLocaleString("ru-RU");
const KIND_LABEL: Record<string, string> = {
  cashback: "Кешбэк",
  bonus: "Бонус",
  redeem: "Сарф",
  adjust: "Тузатиш",
};

export function Mijozlar({ canAdjust = false }: { canAdjust?: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Row | null>(null);

  function refresh() {
    trpc.finance.customers.list.query().then(setRows).catch(() => setRows([]));
  }
  useEffect(refresh, []);

  const filtered = (rows ?? []).filter(
    (r) => !q || r.name.toLowerCase().includes(q.toLowerCase()) || (r.phone ?? "").includes(q),
  );
  const totalOwed = (rows ?? []).reduce((s, r) => s + Math.max(0, r.balance), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-400">
          {rows?.length ?? "…"} мижоз · ҳамёндаги жами: <b className="text-brand">{fmt(totalOwed)}</b> so'm
        </p>
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Исм ёки телефон бўйича қидириш…"
        className="w-full rounded-xl border border-brand-cream-soft px-3 py-2 text-sm outline-none focus:border-brand"
      />

      <div className="divide-y rounded-xl border border-brand-cream-soft bg-white">
        {filtered.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-zinc-400">Мижоз топилмади</p>
        )}
        {filtered.map((r) => (
          <button
            key={r.id}
            onClick={() => setSel(r)}
            className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-brand-cream/30"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-brand-ink">{r.name}</span>
              {r.phone && <span className="block text-xs text-zinc-400">{r.phone}</span>}
            </span>
            <span
              className={`shrink-0 text-sm font-bold tabular-nums ${
                r.balance > 0 ? "text-emerald-600" : "text-zinc-400"
              }`}
            >
              {fmt(r.balance)}
            </span>
          </button>
        ))}
      </div>

      {sel && (
        <WalletPanel
          customer={sel}
          canAdjust={canAdjust}
          onClose={() => setSel(null)}
          onChanged={() => {
            refresh();
          }}
        />
      )}
    </div>
  );
}

function WalletPanel({
  customer,
  canAdjust,
  onClose,
  onChanged,
}: {
  customer: Row;
  canAdjust: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [balance, setBalance] = useState<number | null>(null);
  const [moves, setMoves] = useState<Move[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [kind, setKind] = useState<"bonus" | "redeem" | "adjust">("bonus");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // ⋮ меню (CloPOS каби «Применить» ёнида): Редактировать + Создать операцию.
  // mode=edit → исм/тел таҳрир; showOp → операция блоки очиқ (доим кўринмайди).
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [showOp, setShowOp] = useState(false);
  const [editName, setEditName] = useState(customer.name);
  const [editPhone, setEditPhone] = useState(customer.phone ?? "");
  const [editBusy, setEditBusy] = useState(false);

  function load() {
    trpc.finance.customers.wallet
      .query({ customerId: customer.id })
      .then((r) => {
        setBalance(r.balance);
        setMoves(r.moves);
      })
      .catch(() => {});
    trpc.finance.customers.profile
      .query({ customerId: customer.id })
      .then(setProfile)
      .catch(() => {});
  }
  useEffect(load, [customer.id]);

  async function save() {
    const raw = Math.round(Number(amount) || 0);
    if (raw <= 0) {
      setErr("Сумма киритинг");
      return;
    }
    // Редемпшн (сарф) — манфий; бонус — мусбат; тузатиш — мусбат (камайтириш учун редемпшн)
    const signed = kind === "redeem" ? -raw : raw;
    setBusy(true);
    setErr(null);
    try {
      await trpc.finance.customers.adjust.mutate({
        customerId: customer.id,
        amount: signed,
        kind,
        note: note.trim() || undefined,
      });
      setAmount("");
      setNote("");
      load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Сақланмади");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!editName.trim()) {
      setErr("Исм киритинг");
      return;
    }
    setEditBusy(true);
    setErr(null);
    try {
      await trpc.finance.customers.update.mutate({
        customerId: customer.id,
        name: editName.trim(),
        phone: editPhone.trim() || undefined,
      });
      setMode("view");
      onChanged(); // рўйхатда исм/тел янгилансин
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Сақланмади");
    } finally {
      setEditBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-6">
      <div className="flex max-h-[88dvh] w-full max-w-lg flex-col gap-3 rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-brand-ink">{customer.name}</h3>
            {customer.phone && <p className="text-xs text-zinc-400">{customer.phone}</p>}
          </div>
          <div className="relative flex items-center gap-1">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="grid h-8 w-8 place-items-center rounded-lg text-xl leading-none text-zinc-500 transition hover:bg-zinc-100"
              title="Амаллар"
              aria-label="Амаллар"
            >
              ⋮
            </button>
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 transition hover:bg-zinc-100"
            >
              Ёпиш
            </button>
            {menuOpen && (
              <>
                <button
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Ёпиш"
                />
                <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-brand-cream-soft bg-white py-1 shadow-xl">
                  <button
                    onClick={() => {
                      setEditName(customer.name);
                      setEditPhone(customer.phone ?? "");
                      setErr(null);
                      setShowOp(false);
                      setMode("edit");
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-brand-ink transition hover:bg-brand-cream/40"
                  >
                    ✎ Редактировать
                  </button>
                  {canAdjust && (
                    <button
                      onClick={() => {
                        setErr(null);
                        setMode("view");
                        setShowOp(true);
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-brand-ink transition hover:bg-brand-cream/40"
                    >
                      ➕ Создать операцию
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-brand-cream/40 p-4 text-center">
          <div className="text-[10px] font-bold uppercase tracking-[.18em] text-brand-gold">Ҳамён баланси</div>
          <div className="text-3xl font-extrabold tabular-nums text-brand-ink">
            {balance == null ? "…" : fmt(balance)} <span className="text-sm font-normal text-zinc-400">so'm</span>
          </div>
        </div>

        {/* ✎ Редактировать — исм/телефон таҳрири (⋮ менюдан) */}
        {mode === "edit" && (
          <div className="space-y-2 rounded-2xl border border-brand-cream-soft p-3">
            <div className="text-xs font-bold uppercase tracking-wide text-brand-gold">Мижозни таҳрирлаш</div>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Исм"
              className="w-full rounded-xl border border-brand-cream-soft px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <input
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              inputMode="tel"
              placeholder="Телефон (ихтиёрий)"
              className="w-full rounded-xl border border-brand-cream-soft px-3 py-2 text-sm tabular-nums outline-none focus:border-brand"
            />
            {err && <p className="text-xs text-red-500">{err}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setMode("view");
                  setErr(null);
                }}
                className="flex-1 rounded-xl border border-brand-cream-soft py-2 text-sm text-zinc-600 transition hover:bg-zinc-50"
              >
                Бекор
              </button>
              <button
                onClick={saveEdit}
                disabled={editBusy || !editName.trim()}
                className="flex-1 rounded-xl bg-brand py-2 text-sm font-semibold text-white transition hover:bg-brand-soft disabled:opacity-50"
              >
                {editBusy ? "…" : "Сақлаш"}
              </button>
            </div>
          </div>
        )}

        {/* Мижоз таниш — профил статистикаси */}
        {mode === "view" && profile && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Ташриф" value={`${profile.visits}`} />
              <Stat label="Жами сарф" value={fmt(profile.totalSpent)} />
              <Stat label="Ўрт. чек" value={fmt(profile.avgCheck)} />
              <Stat
                label="Охирги"
                value={
                  profile.lastVisit
                    ? new Date(profile.lastVisit).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
                    : "—"
                }
              />
            </div>
            {profile.topDishes.length > 0 && (
              <div className="rounded-2xl border border-brand-cream-soft p-3">
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-zinc-400">Севган таомлар</div>
                <div className="flex flex-wrap gap-1.5">
                  {profile.topDishes.map((d) => (
                    <span
                      key={d.name}
                      className="rounded-full bg-brand-cream px-2.5 py-1 text-xs font-medium text-brand-ink"
                    >
                      {d.name} <span className="tabular-nums text-brand">×{d.qty}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {profile.visits === 0 && (
              <p className="px-1 text-[11px] text-zinc-400">
                Ҳали боғланган ташриф йўқ — заказ ёпилганда мижоз бириктирилса, тарих тўлади.
              </p>
            )}
          </div>
        )}

        {mode === "view" && canAdjust && showOp && (
          <div className="space-y-2 rounded-2xl border border-brand-cream-soft p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wide text-brand-gold">Янги операция</span>
              <button
                onClick={() => setShowOp(false)}
                className="rounded-md px-2 py-0.5 text-xs text-zinc-400 transition hover:bg-zinc-100"
                aria-label="Ёпиш"
              >
                ✕
              </button>
            </div>
            <div className="flex gap-1.5">
              {(["bonus", "redeem", "adjust"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${
                    kind === k ? "bg-brand text-white" : "bg-brand-cream text-brand"
                  }`}
                >
                  {k === "bonus" ? "➕ Бонус" : k === "redeem" ? "➖ Сарф" : "✎ Тузатиш"}
                </button>
              ))}
            </div>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="Сумма (so'm)"
              className="w-full rounded-xl border border-brand-cream-soft px-3 py-2 text-right text-sm tabular-nums outline-none focus:border-brand"
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              placeholder="Изоҳ (масалан: туғилган кун бонуси)"
              className="w-full rounded-xl border border-brand-cream-soft px-3 py-2 text-sm outline-none focus:border-brand"
            />
            {err && <p className="text-xs text-red-500">{err}</p>}
            <button
              onClick={save}
              disabled={busy}
              className="w-full rounded-xl bg-brand py-2 text-sm font-semibold text-white transition hover:bg-brand-soft disabled:opacity-50"
            >
              {busy ? "…" : "Сақлаш"}
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mb-1 text-xs font-semibold text-zinc-400">Ҳамён тарихи</div>
          {moves.length === 0 ? (
            <p className="py-4 text-center text-sm text-zinc-400">Ҳали ҳаракат йўқ</p>
          ) : (
            <div className="divide-y divide-brand-cream-soft/60">
              {moves.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="text-brand-ink">{KIND_LABEL[m.kind] ?? m.kind}</span>
                    {m.note && <span className="ml-1 text-xs text-zinc-400">· {m.note}</span>}
                    <span className="block text-[10px] text-zinc-300">
                      {new Date(m.createdAt).toLocaleDateString("ru-RU")} · {m.by ?? "—"}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 font-bold tabular-nums ${
                      m.amount > 0 ? "text-emerald-600" : "text-red-500"
                    }`}
                  >
                    {m.amount > 0 ? "+" : ""}
                    {fmt(m.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-brand-cream/40 p-2.5 text-center">
      <div className="text-[10px] text-zinc-400">{label}</div>
      <div className="mt-0.5 text-sm font-bold tabular-nums text-brand-ink">{value}</div>
    </div>
  );
}
