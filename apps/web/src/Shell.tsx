import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "./App";
import { Analitika } from "./Analitika";
import { BRAND } from "./brand";
import { Catalog } from "./Catalog";
import { ChekQidirish } from "./ChekQidirish";
import { Dashboard } from "./Dashboard";
import { Tv } from "./Tv";
import { Kds } from "./Kds";
import { Mijozlar } from "./Mijozlar";
import { Hisobot } from "./Hisobot";
import { Inventar } from "./Inventar";
import { Inventarizatsiya } from "./Inventarizatsiya";
import { Moliya } from "./Moliya";
import { Obvalka } from "./Obvalka";
import { Ombor } from "./Ombor";
import { Pos } from "./Pos";
import { Purchases } from "./Purchases";
import { Recipes } from "./Recipes";
import { Taannarx } from "./Taannarx";
import { Vitrina } from "./Vitrina";
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
  | "tv"
  | "kds"
  | "analitika"
  | "moliya"
  | "pos"
  | "chekQidirish"
  | "harid"
  | "obvalka"
  | "inventarizatsiya"
  | "assets"
  | "vitrina"
  | "ombor"
  | "hisobot"
  | "taannarx"
  | "catalog"
  | "recipes"
  | "mijozlar"
  | "staff";

// Offline ҳолати — "offline-first"нинг кўринадиган қисми: алоҳida banner, чунки
// сўровлар жимгина муваффақиятсиз бўлса, ходим сабабини билмайди.
function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function Shell({
  user,
  onLogout,
}: {
  user: SessionUser;
  onLogout: () => void;
}) {
  const isDirector = user.role === "director";
  const online = useOnline();
  const canObvalka = ["director", "manager", "buyer"].includes(user.role);
  const canPos = ["director", "manager", "cashier", "waiter"].includes(
    user.role,
  );
  const posHost =
    typeof window !== "undefined" &&
    window.location.hostname.startsWith("pos");
  // Терминал режими: desktop exe (userAgent'да LaLimonPOS) ёки ?terminal — тоза
  // POS chrome (14 таб ўрнига ☰ меню). Браузерда — тўлиқ панель ўзгармайди.
  const isTerminal =
    typeof navigator !== "undefined" &&
    (navigator.userAgent.includes("LaLimonPOS") ||
      (typeof location !== "undefined" && location.search.includes("terminal")));
  const [menuOpen, setMenuOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  // CloPOS каби: PIN'дан кейин биринчи ойна — доим Касса (пол). POS ролларининг
  // ҳаммаси (директор ҳам) кириши билан столларни кўради; директор истаса
  // «Бошқарув» табига ўтади. POS'сиз роллар (бозорчи) — обвалка/каталог.
  const [tab, setTab] = useState<Tab>(
    canPos ? "pos" : canObvalka ? "obvalka" : "catalog",
  );

  async function logout() {
    await trpc.auth.logout.mutate().catch(() => {});
    onLogout();
  }

  const tabs: { key: Tab; label: string }[] = [
    ...(isDirector ? [{ key: "dashboard" as Tab, label: "Бошқарув" }] : []),
    ...(isDirector ? [{ key: "tv" as Tab, label: "📺 ТВ" }] : []),
    ...(isDirector ? [{ key: "analitika" as Tab, label: "Аналитика" }] : []),
    ...(isDirector ? [{ key: "moliya" as Tab, label: "Молия" }] : []),
    ...(canPos ? [{ key: "pos" as Tab, label: "Касса" }] : []),
    ...(["director", "manager", "cashier"].includes(user.role)
      ? [{ key: "chekQidirish" as Tab, label: "Чек қидириш" }]
      : []),
    ...(canObvalka ? [{ key: "harid" as Tab, label: "Харид" }] : []),
    ...(canObvalka ? [{ key: "obvalka" as Tab, label: "Обвалка" }] : []),
    ...(["director", "manager"].includes(user.role)
      ? [{ key: "inventarizatsiya" as Tab, label: "Инвентаризация" }]
      : []),
    ...(["director", "manager"].includes(user.role)
      ? [{ key: "assets" as Tab, label: "Инвентарь" }]
      : []),
    ...(["director", "manager"].includes(user.role)
      ? [{ key: "vitrina" as Tab, label: "Витрина" }, { key: "kds" as Tab, label: "🍳 KDS" }]
      : []),
    ...(["director", "manager"].includes(user.role)
      ? [{ key: "ombor" as Tab, label: "Омбор" }]
      : []),
    ...(["director", "manager"].includes(user.role)
      ? [{ key: "hisobot" as Tab, label: "Ҳисобот" }]
      : []),
    ...(["director", "manager"].includes(user.role)
      ? [{ key: "mijozlar" as Tab, label: "🎁 Мижозлар" }]
      : []),
    ...(isDirector ? [{ key: "taannarx" as Tab, label: "Таннарх" }] : []),
    { key: "catalog", label: "Каталог" },
    { key: "recipes", label: "Рецептлар" },
    ...(isDirector ? [{ key: "staff" as Tab, label: "Ходимлар" }] : []),
  ];

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900">
      {isTerminal ? (
        <header className="sticky top-0 z-20 bg-brand text-white shadow-sm">
          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-2">
              <img src={BRAND.logoSmall} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-white/30" />
              <span className="text-base font-bold">{BRAND.name}</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="rounded-lg bg-white/15 px-3 py-1.5 font-medium transition hover:bg-white/25"
              >
                ☰ Меню
              </button>
              <span className="hidden font-medium sm:inline">{user.name}</span>
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">
                {ROLE_LABEL[user.role] ?? user.role}
              </span>
              <span className="text-base leading-none" title="Билдиришлар">🔔</span>
              <span className="tabular-nums text-white/80">{clock}</span>
              <button onClick={logout} className="text-white/70 transition hover:text-white" title="Чиқиш">
                ⎋
              </button>
            </div>
          </div>
          {menuOpen && (
            <>
              <button
                className="fixed inset-0 z-20 cursor-default"
                onClick={() => setMenuOpen(false)}
                aria-label="Ёпиш"
              />
              <div className="absolute right-2 top-full z-30 mt-1 w-72 rounded-2xl border border-black/5 bg-white p-2 text-zinc-800 shadow-xl">
                <div className="grid grid-cols-2 gap-1">
                  {tabs.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => {
                        setTab(t.key);
                        setMenuOpen(false);
                      }}
                      className={`rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
                        tab === t.key ? "bg-brand text-white" : "text-zinc-600 hover:bg-zinc-100"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </header>
      ) : (
        <header className="sticky top-0 z-10 border-b bg-white">
          <div className="flex items-center justify-between px-4 py-2.5 sm:px-5">
            <div className="flex items-center gap-2">
              <img src={BRAND.logoSmall} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
              <div className="flex items-baseline gap-2">
                <span className="text-base font-bold sm:text-lg">{BRAND.name}</span>
                <span className="hidden text-xs text-zinc-400 sm:inline">{BRAND.city}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm sm:gap-3">
              <span className="hidden font-medium sm:inline">{user.name}</span>
              <span className="rounded-full bg-brand-cream px-2 py-0.5 text-xs text-brand">
                {ROLE_LABEL[user.role] ?? user.role}
              </span>
              <button onClick={logout} className="text-zinc-400 hover:text-red-500">
                Чиқиш
              </button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto whitespace-nowrap border-t px-4 py-1.5 sm:px-5">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${
                  tab === t.key
                    ? "bg-brand text-white"
                    : "text-zinc-500 hover:bg-zinc-100"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </header>
      )}

      {!online && (
        <div className="bg-red-600 px-4 py-1.5 text-center text-sm font-medium text-white">
          ⚠️ Интернет йўқ — маълумот сақланмайди, уланишни кутинг
        </div>
      )}

      <main className={`mx-auto p-5 ${tab === "pos" ? "max-w-6xl" : tab === "tv" ? "max-w-6xl" : "max-w-4xl"}`}>
        {tab === "dashboard" && <Dashboard onGoObvalka={() => setTab("obvalka")} />}
        {tab === "tv" && <Tv />}
        {tab === "kds" && <Kds />}
        {tab === "mijozlar" && <Mijozlar canAdjust={isDirector} />}
        {tab === "analitika" && <Analitika />}
        {tab === "moliya" && <Moliya />}
        {tab === "pos" && <Pos user={user} />}
        {tab === "chekQidirish" && <ChekQidirish />}
        {tab === "harid" && <Purchases />}
        {tab === "obvalka" && <Obvalka user={user} />}
        {tab === "inventarizatsiya" && <Inventarizatsiya user={user} />}
        {tab === "assets" && <Inventar />}
        {tab === "vitrina" && <Vitrina />}
        {tab === "ombor" && <Ombor />}
        {tab === "hisobot" && <Hisobot />}
        {tab === "taannarx" && <Taannarx />}
        {tab === "catalog" && <Catalog user={user} />}
        {tab === "recipes" && <Recipes canManage={isDirector} />}
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
  const [editInfo, setEditInfo] = useState<Staff | "new" | null>(null);

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
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-500">
          Ходимлар ({staff?.length ?? "…"})
        </h2>
        <button
          onClick={() => setEditInfo("new")}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-deep"
        >
          ＋ Ходим
        </button>
      </div>
      <div className="divide-y rounded-xl border bg-white">
        {staff?.map((s) => (
          <div
            key={s.id}
            className={`flex items-center justify-between px-4 py-2.5 ${s.active ? "" : "opacity-40"}`}
          >
            <span>{s.name}</span>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-zinc-400">
                {ROLE_LABEL[s.role] ?? s.role}
              </span>
              <span className={s.hasPin ? "text-green-600" : "text-amber-500"}>
                {s.hasPin ? "PIN ✓" : "PIN йўқ"}
              </span>
              <button
                onClick={() => setEditInfo(s)}
                className="rounded-lg bg-zinc-100 px-2.5 py-1 font-medium text-zinc-700 hover:bg-zinc-200"
                title="Исм/рол"
              >
                ✎
              </button>
              <button
                onClick={() => setEditing(s)}
                className="rounded-lg bg-zinc-100 px-2.5 py-1 font-medium text-zinc-700 hover:bg-zinc-200"
              >
                {s.hasPin ? "PIN" : "PIN бер"}
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
      {editInfo && (
        <StaffModal
          staff={editInfo === "new" ? null : editInfo}
          onClose={() => setEditInfo(null)}
          onSaved={() => {
            setEditInfo(null);
            refresh();
          }}
        />
      )}
    </section>
  );
}

const STAFF_ROLES: [string, string][] = [
  ["waiter", "Официант"],
  ["cashier", "Кассир"],
  ["buyer", "Бозорчи"],
  ["manager", "Менежер"],
  ["director", "Директор"],
];

function StaffModal({
  staff,
  onClose,
  onSaved,
}: {
  staff: Staff | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(staff?.name ?? "");
  const [role, setRole] = useState(staff?.role ?? "waiter");
  const [active, setActive] = useState(staff?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) {
      setError("Исм керак");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (staff) {
        await trpc.users.update.mutate({
          userId: staff.id,
          name: name.trim(),
          role: role as "waiter",
          active,
        });
      } else {
        await trpc.users.create.mutate({ name: name.trim(), role: role as "waiter" });
      }
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error && e.message ? e.message : "Хато");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-xs space-y-3 rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">{staff ? "Ходимни таҳрирлаш" : "Янги ходим"}</h3>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Исм (масалан: Асадбек)"
          className="w-full rounded-xl border px-4 py-3 outline-none focus:border-brand"
        />
        <div className="flex flex-wrap gap-1.5">
          {STAFF_ROLES.map(([v, l]) => (
            <button
              key={v}
              onClick={() => setRole(v)}
              className={`rounded-lg px-2.5 py-1 text-sm font-medium ${
                role === v ? "bg-brand text-white" : "bg-zinc-100 text-zinc-600"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        {staff && (
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Фаол (ўчирилса — тизимга кира олмайди)
          </label>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border py-2.5 text-zinc-600">
            Бекор
          </button>
          <button
            onClick={save}
            disabled={busy || !name.trim()}
            className="flex-1 rounded-xl bg-brand py-2.5 font-medium text-white disabled:opacity-40"
          >
            Сақлаш
          </button>
        </div>
      </div>
    </div>
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
          className="w-full rounded-xl border px-4 py-3 text-center text-2xl tracking-[0.5em] outline-none focus:border-brand"
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
            className="flex-1 rounded-xl bg-brand py-2.5 font-medium text-white disabled:opacity-40"
          >
            Сақлаш
          </button>
        </div>
      </div>
    </div>
  );
}
