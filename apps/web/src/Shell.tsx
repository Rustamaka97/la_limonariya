import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "./App";
import { Analitika } from "./Analitika";
import { BRAND } from "./brand";
import { Catalog } from "./Catalog";
import { Dashboard } from "./Dashboard";
import { Hisobot } from "./Hisobot";
import { Inventarizatsiya } from "./Inventarizatsiya";
import { Moliya } from "./Moliya";
import { Obvalka } from "./Obvalka";
import { Ombor } from "./Ombor";
import { Pos } from "./Pos";
import { Purchases } from "./Purchases";
import { Recipes } from "./Recipes";
import { Taannarx } from "./Taannarx";
import { trpc } from "./trpc";

const ROLE_LABEL: Record<string, string> = {
  director: "Директор",
  manager: "Менежер",
  buyer: "Бозорчи",
  cashier: "Кассир",
  waiter: "Официант",
};

type Tab =
  | "dashboard"
  | "analitika"
  | "moliya"
  | "pos"
  | "harid"
  | "obvalka"
  | "inventarizatsiya"
  | "ombor"
  | "hisobot"
  | "taannarx"
  | "catalog"
  | "recipes"
  | "staff";

export function Shell({
  user,
  onLogout,
}: {
  user: SessionUser;
  onLogout: () => void;
}) {
  const isDirector = user.role === "director";
  const canObvalka = ["director", "manager", "buyer"].includes(user.role);
  const canPos = ["director", "manager", "cashier", "waiter"].includes(
    user.role,
  );
  const [tab, setTab] = useState<Tab>(
    isDirector
      ? "dashboard"
      : user.role === "cashier" || user.role === "waiter"
        ? "pos"
        : canObvalka
          ? "obvalka"
          : "catalog",
  );

  async function logout() {
    await trpc.auth.logout.mutate().catch(() => {});
    onLogout();
  }

  const tabs: { key: Tab; label: string }[] = [
    ...(isDirector ? [{ key: "dashboard" as Tab, label: "Бошқарув" }] : []),
    ...(isDirector ? [{ key: "analitika" as Tab, label: "Аналитика" }] : []),
    ...(isDirector ? [{ key: "moliya" as Tab, label: "Молия" }] : []),
    ...(canPos ? [{ key: "pos" as Tab, label: "Касса" }] : []),
    ...(canObvalka ? [{ key: "harid" as Tab, label: "Харид" }] : []),
    ...(canObvalka ? [{ key: "obvalka" as Tab, label: "Обвалка" }] : []),
    ...(["director", "manager"].includes(user.role)
      ? [{ key: "inventarizatsiya" as Tab, label: "Инвентаризация" }]
      : []),
    ...(["director", "manager"].includes(user.role)
      ? [{ key: "ombor" as Tab, label: "Омбор" }]
      : []),
    ...(["director", "manager"].includes(user.role)
      ? [{ key: "hisobot" as Tab, label: "Ҳисобот" }]
      : []),
    ...(isDirector ? [{ key: "taannarx" as Tab, label: "Таннарх" }] : []),
    { key: "catalog", label: "Каталог" },
    { key: "recipes", label: "Рецептлар" },
    ...(isDirector ? [{ key: "staff" as Tab, label: "Ходимлар" }] : []),
  ];

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900">
      <header className="flex items-center justify-between border-b bg-white px-5 py-3">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2">
            <img src={BRAND.logoSmall} alt="" className="h-8 w-8 rounded-full object-cover" />
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold">{BRAND.name}</span>
              <span className="text-xs text-zinc-400">{BRAND.city}</span>
            </div>
          </div>
          <nav className="flex flex-wrap gap-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  tab === t.key
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-500 hover:bg-zinc-100"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="font-medium">{user.name}</span>
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
            {ROLE_LABEL[user.role] ?? user.role}
          </span>
          <button onClick={logout} className="text-zinc-400 hover:text-red-500">
            Чиқиш
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl p-5">
        {tab === "dashboard" && <Dashboard onGoObvalka={() => setTab("obvalka")} />}
        {tab === "analitika" && <Analitika />}
        {tab === "moliya" && <Moliya />}
        {tab === "pos" && <Pos user={user} />}
        {tab === "harid" && <Purchases />}
        {tab === "obvalka" && <Obvalka />}
        {tab === "inventarizatsiya" && <Inventarizatsiya user={user} />}
        {tab === "ombor" && <Ombor />}
        {tab === "hisobot" && <Hisobot />}
        {tab === "taannarx" && <Taannarx />}
        {tab === "catalog" && <Catalog user={user} />}
        {tab === "recipes" && <Recipes />}
        {tab === "staff" && <StaffSection />}
      </main>
    </div>
  );
}

type Staff = {
  id: string;
  name: string;
  role: string;
  active: boolean;
  hasPin: boolean;
};

function StaffSection() {
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [editing, setEditing] = useState<Staff | null>(null);

  const refresh = useCallback(() => {
    trpc.users.list
      .query()
      .then(setStaff)
      .catch(() => setStaff(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-zinc-500">
        Ходимлар ({staff?.length ?? "…"})
      </h2>
      <div className="divide-y rounded-xl border bg-white">
        {staff?.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between px-4 py-2.5"
          >
            <span>{s.name}</span>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-zinc-400">
                {ROLE_LABEL[s.role] ?? s.role}
              </span>
              <span className={s.hasPin ? "text-green-600" : "text-amber-500"}>
                {s.hasPin ? "PIN ✓" : "PIN йўқ"}
              </span>
              <button
                onClick={() => setEditing(s)}
                className="rounded-lg bg-zinc-100 px-2.5 py-1 font-medium text-zinc-700 hover:bg-zinc-200"
              >
                {s.hasPin ? "ўзгартир" : "PIN бер"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <SetPinModal
          staff={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </section>
  );
}

function SetPinModal({
  staff,
  onClose,
  onSaved,
}: {
  staff: Staff;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!/^\d{4}$/.test(pin)) {
      setError("PIN — 4 та рақам");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await trpc.users.setPin.mutate({ userId: staff.id, pin });
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error && e.message ? e.message : "Хато");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs space-y-4 rounded-2xl bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-lg font-semibold">{staff.name}</h3>
          <p className="text-sm text-zinc-500">4 рақамли PIN ўрнатинг</p>
        </div>
        <input
          autoFocus
          inputMode="numeric"
          value={pin}
          onChange={(e) => {
            setError(null);
            setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
          }}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="••••"
          className="w-full rounded-xl border px-4 py-3 text-center text-2xl tracking-[0.5em] outline-none focus:border-green-500"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border py-2.5 text-zinc-600"
          >
            Бекор
          </button>
          <button
            onClick={save}
            disabled={busy || pin.length !== 4}
            className="flex-1 rounded-xl bg-green-600 py-2.5 font-medium text-white disabled:opacity-40"
          >
            Сақлаш
          </button>
        </div>
      </div>
    </div>
  );
}
