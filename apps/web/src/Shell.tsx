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
import { TablePrep } from "./TablePrep";
import { Recipes } from "./Recipes";
import { Taannarx } from "./Taannarx";
import { Vitrina } from "./Vitrina";
import { trpc } from "./trpc";
import { IMenu, IBell, ILogout, IPencil, IWarn, IWifi } from "./icons";
import { NotifCenter } from "./NotifCenter";
import { StatusPanel } from "./StatusPanel";
import { useHeartbeat } from "./lib/heartbeat";

// POS иконка стил синови — Higgsfield премиум сет (расмдан crop). URL: ?icons=clay|material.
const ICON_SHEET: Record<string, { img: string; size: string }> = {
  clay: { img: "/brand/icons-clay.webp", size: "300% 300%" },
  material: { img: "/brand/icons-material.webp", size: "400% 400%" },
  gold: { img: "/brand/icons-nav-gold.webp", size: "400% 300%" },
};
const ICON_POS: Record<string, Record<string, string>> = {
  clay: { dashboard: "0% 0%", cash: "50% 0%", chef: "100% 0%", chart: "100% 50%", gift: "0% 50%", receipt: "50% 50%", staff: "100% 100%" },
  material: { dashboard: "0% 0%", cash: "33.33% 0%", chef: "66.67% 0%", chart: "100% 0%", gift: "0% 33.33%", receipt: "33.33% 33.33%", staff: "100% 100%" },
  gold: { dashboard: "0% 0%", tv: "33.33% 0%", chart: "66.67% 0%", wallet: "100% 0%", cash: "0% 50%", receipt: "33.33% 50%", bag: "66.67% 50%", chef: "100% 50%", boxes: "0% 100%", gift: "33.33% 100%", book: "66.67% 100%", staff: "100% 100%" },
};
function NavIcon({ k, sheet }: { k?: string; sheet: string | null }) {
  if (!k || !sheet || !ICON_SHEET[sheet] || !ICON_POS[sheet]?.[k]) return null;
  return (
    <span
      className="mr-1.5 inline-block h-5 w-5 shrink-0 rounded align-[-4px] bg-no-repeat"
      style={{ backgroundImage: `url(${ICON_SHEET[sheet].img})`, backgroundSize: ICON_SHEET[sheet].size, backgroundPosition: ICON_POS[sheet][k] }}
      aria-hidden="true"
    />
  );
}

const ROLE_LABEL: Record<string, string> = {
  director: "Директор",
  manager: "Менежер",
  admin: "Админ",
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
  | "officiants"
  | "tablePrep"
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
  // Қурилма heartbeat — «Статус → Қурилмалар» панели учун (30с интервал).
  useHeartbeat(true);
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
  // 🔔 билдиришнома маркази (CloPOS «Уведомления») — POS роллари учун.
  const [showNotif, setShowNotif] = useState(false);
  // 📶 «Статус» панели (CloPOS «Статус») — принтер/уланиш ҳолати, ҳамма роль учун.
  const [showStatus, setShowStatus] = useState(false);
  const [notifs, setNotifs] = useState<
    { kind: string; title: string; detail: string; at: string | Date | null; severity: "info" | "warn" | "error" }[]
  >([]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!canPos) return;
    let alive = true;
    const load = () =>
      trpc.pos.notifications
        .query()
        .then((n) => alive && setNotifs(n))
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [canPos]);
  const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  // CloPOS каби: PIN'дан кейин биринчи ойна — доим Касса (пол). POS ролларининг
  // ҳаммаси (директор ҳам) кириши билан столларни кўради; директор истаса
  // «Бошқарув» табига ўтади. POS'сиз роллар (бозорчи) — обвалка/каталог.
  const [tab, setTab] = useState<Tab>(
    canPos
      ? "pos"
      : user.role === "admin"
        ? "officiants"
        : canObvalka
          ? "obvalka"
          : "catalog",
  );

  async function logout() {
    await trpc.auth.logout.mutate().catch(() => {});
    onLogout();
  }

  const iconStyle = new URLSearchParams(window.location.search).get("icons") || "gold";
  const tabs: { key: Tab; label: string; icon?: string }[] = [
    ...(isDirector ? [{ key: "dashboard" as Tab, label: "Бошқарув", icon: "dashboard" }] : []),
    ...(isDirector ? [{ key: "tv" as Tab, label: "ТВ", icon: "tv" }] : []),
    ...(isDirector ? [{ key: "analitika" as Tab, label: "Аналитика", icon: "chart" }] : []),
    ...(isDirector ? [{ key: "moliya" as Tab, label: "Молия", icon: "wallet" }] : []),
    ...(canPos ? [{ key: "pos" as Tab, label: "Касса", icon: "cash" }] : []),
    ...(["director", "admin"].includes(user.role)
      ? [{ key: "officiants" as Tab, label: "Официантлар", icon: "staff" }]
      : []),
    ...(["director", "admin"].includes(user.role)
      ? [{ key: "tablePrep" as Tab, label: "Мажлис" }]
      : []),
    ...(["director", "manager", "cashier"].includes(user.role)
      ? [{ key: "chekQidirish" as Tab, label: "Чек қидириш", icon: "receipt" }]
      : []),
    ...(canObvalka ? [{ key: "harid" as Tab, label: "Харид", icon: "bag" }] : []),
    ...(canObvalka ? [{ key: "obvalka" as Tab, label: "Обвалка" }] : []),
    ...(["director", "manager"].includes(user.role)
      ? [{ key: "inventarizatsiya" as Tab, label: "Инвентаризация" }]
      : []),
    ...(["director", "manager", "admin"].includes(user.role)
      ? [{ key: "assets" as Tab, label: "Инвентарь" }]
      : []),
    ...(["director", "manager"].includes(user.role)
      ? [{ key: "vitrina" as Tab, label: "Витрина" }, { key: "kds" as Tab, label: "KDS", icon: "chef" }]
      : []),
    ...(["director", "manager"].includes(user.role)
      ? [{ key: "ombor" as Tab, label: "Омбор", icon: "boxes" }]
      : []),
    ...(["director", "manager"].includes(user.role)
      ? [{ key: "hisobot" as Tab, label: "Ҳисобот" }]
      : []),
    ...(["director", "manager"].includes(user.role)
      ? [{ key: "mijozlar" as Tab, label: "Мижозлар", icon: "gift" }]
      : []),
    ...(isDirector ? [{ key: "taannarx" as Tab, label: "Таннарх" }] : []),
    { key: "catalog", label: "Каталог", icon: "book" },
    { key: "recipes", label: "Рецептлар" },
    ...(isDirector ? [{ key: "staff" as Tab, label: "Ходимлар", icon: "staff" }] : []),
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-zinc-50 text-zinc-900">
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
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 font-medium transition hover:bg-white/25"
              >
                <IMenu className="h-5 w-5" /> Меню
              </button>
              <span className="hidden font-medium sm:inline">{user.name}</span>
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">
                {ROLE_LABEL[user.role] ?? user.role}
              </span>
              {canPos && (
                <button
                  onClick={() => setShowNotif(true)}
                  className="relative grid h-8 w-8 place-items-center rounded-lg text-white/80 transition hover:bg-white/15"
                  title="Билдиришлар"
                  aria-label="Билдиришлар"
                >
                  <IBell className="h-5 w-5" />
                  {notifs.length > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                      {notifs.length}
                    </span>
                  )}
                </button>
              )}
              <button
                onClick={() => setShowStatus(true)}
                className="grid h-8 w-8 place-items-center rounded-lg text-white/80 transition hover:bg-white/15"
                title="Статус (принтер/уланиш)"
                aria-label="Статус"
              >
                <IWifi className="h-5 w-5" />
              </button>
              <span className="tabular-nums text-white/80">{clock}</span>
              <button
                onClick={logout}
                className="grid h-9 w-9 place-items-center rounded-lg text-white/70 transition hover:bg-white/15 hover:text-white"
                title="Чиқиш"
                aria-label="Чиқиш"
              >
                <ILogout className="h-5 w-5" />
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
                      <NavIcon k={t.icon} sheet={iconStyle} />
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
              {canPos && (
                <button
                  onClick={() => setShowNotif(true)}
                  className="relative grid h-8 w-8 place-items-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-brand"
                  title="Билдиришлар"
                  aria-label="Билдиришлар"
                >
                  <IBell className="h-5 w-5" />
                  {notifs.length > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                      {notifs.length}
                    </span>
                  )}
                </button>
              )}
              <button
                onClick={() => setShowStatus(true)}
                className="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-brand"
                title="Статус (принтер/уланиш)"
                aria-label="Статус"
              >
                <IWifi className="h-5 w-5" />
              </button>
              <button onClick={logout} className="text-zinc-400 hover:text-red-500">
                Чиқиш
              </button>
            </div>
          </div>
          <nav className="hidden gap-1 overflow-x-auto whitespace-nowrap border-t px-4 py-1.5 sm:flex sm:px-5">
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
                <NavIcon k={t.icon} sheet={iconStyle} />
                {t.label}
              </button>
            ))}
          </nav>
        </header>
      )}

      {!online && (
        <div className="flex items-center justify-center gap-2 bg-red-600 px-4 py-1.5 text-center text-sm font-medium text-white">
          <IWarn className="h-4 w-4 shrink-0" /> Интернет йўқ — маълумот сақланмайди, уланишни кутинг
        </div>
      )}

      <main className={tab === "pos" ? "flex flex-1 flex-col p-0 pb-14 sm:pb-0" : `mx-auto w-full p-5 pb-20 sm:pb-6 ${tab === "tv" ? "max-w-6xl" : "max-w-4xl"}`}>
        {tab === "dashboard" && <Dashboard onGoObvalka={() => setTab("obvalka")} />}
        {tab === "tv" && <Tv />}
        {tab === "kds" && <Kds />}
        {tab === "mijozlar" && <Mijozlar canAdjust={isDirector} />}
        {tab === "analitika" && <Analitika />}
        {tab === "moliya" && <Moliya />}
        {tab === "pos" && <Pos user={user} onLogout={logout} onNavigate={(t) => setTab(t as Tab)} />}
        {tab === "chekQidirish" && <ChekQidirish />}
        {tab === "harid" && <Purchases />}
        {tab === "obvalka" && <Obvalka user={user} />}
        {tab === "inventarizatsiya" && <Inventarizatsiya user={user} />}
        {tab === "assets" && <Inventar />}
        {tab === "officiants" && (
          <>
            <AdminOfficiants />
            <AdminTables />
          </>
        )}
        {tab === "tablePrep" && <TablePrep />}
        {tab === "vitrina" && <Vitrina />}
        {tab === "ombor" && <Ombor />}
        {tab === "hisobot" && <Hisobot />}
        {tab === "taannarx" && <Taannarx />}
        {tab === "catalog" && <Catalog user={user} />}
        {tab === "recipes" && <Recipes canManage={isDirector} />}
        {tab === "staff" && <StaffSection />}
      </main>

      {/* Мобил пастки навигация — фақат телефон (sm:hidden). Терминал exe'га
          тегмайди (у ўзининг ☰ менюсини ишлатади). */}
      {!isTerminal && (
        <MobileNav tabs={tabs} tab={tab} setTab={setTab} iconStyle={iconStyle} />
      )}

      {/* 🔔 Билдиришнома маркази (CloPOS «Уведомления» 1:1) — Янги/Эски таб + чап турлар */}
      {showNotif && <NotifCenter notifs={notifs} onClose={() => setShowNotif(false)} />}

      {showStatus && (
        <StatusPanel canTest={isDirector} onClose={() => setShowStatus(false)} />
      )}
    </div>
  );
}

// Телефон навигацияси: горизонтал скролл таб бар ўрнига пастки нав — биринчи 4
// роль-таби доим кўзда, қолгани «Яна» → пастки варақ (bottom-sheet).
function MobileNav({
  tabs,
  tab,
  setTab,
  iconStyle,
}: {
  tabs: { key: Tab; label: string; icon?: string }[];
  tab: Tab;
  setTab: (t: Tab) => void;
  iconStyle: string | null;
}) {
  const [open, setOpen] = useState(false);
  const MAX = 5;
  const hasMore = tabs.length > MAX;
  const bar = hasMore ? tabs.slice(0, MAX - 1) : tabs;
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-black/5 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
        {bar.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium ${
              tab === t.key ? "text-brand" : "text-zinc-400"
            }`}
          >
            <NavIcon k={t.icon} sheet={iconStyle} />
            <span className="max-w-full truncate px-0.5">{t.label}</span>
          </button>
        ))}
        {hasMore && (
          <button
            onClick={() => setOpen(true)}
            className={`flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium ${
              open ? "text-brand" : "text-zinc-400"
            }`}
          >
            <IMenu className="h-5 w-5" />
            <span>Яна</span>
          </button>
        )}
      </nav>

      {open && (
        <div className="fixed inset-0 z-40 sm:hidden">
          <button
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-label="Ёпиш"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-200" />
            <div className="grid grid-cols-3 gap-2">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => {
                    setTab(t.key);
                    setOpen(false);
                  }}
                  className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-3 text-xs font-medium ${
                    tab === t.key
                      ? "bg-brand text-white"
                      : "bg-zinc-50 text-zinc-600"
                  }`}
                >
                  <NavIcon k={t.icon} sheet={iconStyle} />
                  <span className="max-w-full truncate">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

type Staff = {
  id: string;
  name: string;
  role: string;
  active: boolean;
  hasPin: boolean;
};

// Зал администратори панели — официант рўйхати + шу ойги жарима (сони/жами) +
// «Жарима» тугма. Чақирувлар глобал CallAlerts overlay'да, посуда «Инвентарь»да.
function AdminOfficiants() {
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [pens, setPens] = useState<
    Record<string, { count: number; total: number }>
  >({});
  const [target, setTarget] = useState<Staff | null>(null);

  const refresh = useCallback(() => {
    trpc.users.list
      .query()
      .then(setStaff)
      .catch(() => setStaff(null));
    trpc.penalties.byStaff
      .query()
      .then((rows) =>
        setPens(
          Object.fromEntries(
            rows.map((r) => [r.staffId, { count: r.count, total: r.total }]),
          ),
        ),
      )
      .catch(() => {});
  }, []);
  useEffect(() => refresh(), [refresh]);

  const waiters = (staff ?? []).filter((s) => s.role === "waiter");
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-zinc-500">
        Официантлар ({staff ? waiters.length : "…"})
      </h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {waiters.map((w) => {
          const p = pens[w.id];
          return (
            <div
              key={w.id}
              className="flex items-center gap-3 rounded-xl border bg-white px-4 py-3"
            >
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold uppercase ${
                  w.active
                    ? "bg-brand-cream text-brand"
                    : "bg-zinc-100 text-zinc-400"
                }`}
              >
                {w.name.slice(0, 2)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{w.name}</div>
                <div className="text-xs text-zinc-400">
                  {w.active ? "Актив" : "Нофаол"}
                  {p && p.count > 0 && (
                    <span className="text-red-500">
                      {" · "}
                      {p.count} жарима · {p.total.toLocaleString("ru-RU")} сўм
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setTarget(w)}
                className="shrink-0 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100"
              >
                Жарима
              </button>
            </div>
          );
        })}
      </div>
      {staff && waiters.length === 0 && (
        <div className="rounded-xl border bg-white px-4 py-8 text-center text-sm text-zinc-400">
          Официант йўқ
        </div>
      )}
      {target && (
        <PenaltyModal
          officiant={target}
          monthCount={pens[target.id]?.count ?? 0}
          onClose={() => setTarget(null)}
          onSaved={() => {
            setTarget(null);
            refresh();
          }}
        />
      )}
    </section>
  );
}

// Жарима қўйиш — зинапоя (30/50/100к, шу ой N-жаримага қараб авто-таклиф), сабаб
// preset ёки эркин, изоҳ. Админ суммани ўзгартира олади.
const PENALTY_STEPS = [30000, 50000, 100000];
const PENALTY_REASONS = ["Стол йиғиштирмади", "Кеч келди", "Мижоз шикояти", "Бошқа"];
function PenaltyModal({
  officiant,
  monthCount,
  onClose,
  onSaved,
}: {
  officiant: Staff;
  monthCount: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const suggested =
    PENALTY_STEPS[Math.min(monthCount, PENALTY_STEPS.length - 1)]!;
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState(String(suggested));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!reason.trim() || !Number(amount)) return;
    setBusy(true);
    try {
      await trpc.penalties.create.mutate({
        staffId: officiant.id,
        amount: Number(amount),
        reason: reason.trim(),
        note: note.trim() || undefined,
      });
      onSaved();
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Ёпиш"
      />
      <div className="relative w-full max-w-sm rounded-t-3xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-2xl sm:rounded-3xl sm:pb-5">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-200 sm:hidden" />
        <h3 className="text-base font-semibold">Жарима — {officiant.name}</h3>
        <p className="mt-1 text-xs text-zinc-400">
          Бу ойда: {monthCount} жарима · таклиф {(suggested / 1000).toFixed(0)}к
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {PENALTY_REASONS.map((r) => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                reason === r ? "bg-brand text-white" : "bg-zinc-100 text-zinc-600"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Сабаб"
          className="mt-2 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <div className="mt-2 flex items-center gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="сумма"
            className="w-32 rounded-lg border px-3 py-2 text-right text-sm outline-none focus:border-brand"
          />
          <span className="text-sm text-zinc-400">сўм</span>
          <div className="ml-auto flex gap-1">
            {PENALTY_STEPS.map((s) => (
              <button
                key={s}
                onClick={() => setAmount(String(s))}
                className="rounded-lg bg-zinc-100 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-200"
              >
                {s / 1000}к
              </button>
            ))}
          </div>
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Изоҳ (ихтиёрий)"
          rows={2}
          className="mt-2 w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand"
        />

        <div className="mt-4 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border py-2.5 text-sm font-medium text-zinc-600"
          >
            Бекор
          </button>
          <button
            onClick={save}
            disabled={busy || !reason.trim() || !Number(amount)}
            className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? "…" : "Жарима қўйиш"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Стол банд — зал администратори столни «банд»/«бўш» белгилайди (меҳмон келди,
// официант ҳали заказ очмаган). Босиш = ҳолатни алмаштириш. POS floor'да ҳам
// сариқ кўринади (кейинги фаза, Pos.tsx floor интеграцияси).
type PosTable = {
  id: string;
  name: string;
  heldAt: string | Date | null;
  heldNote: string | null;
};
function AdminTables() {
  const [tables, setTables] = useState<PosTable[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    trpc.pos.tables
      .query()
      .then((t) => setTables(t as PosTable[]))
      .catch(() => setTables(null));
  }, []);
  useEffect(() => refresh(), [refresh]);

  async function toggle(t: PosTable) {
    setBusy(t.id);
    try {
      if (t.heldAt) await trpc.pos.releaseTable.mutate({ id: t.id });
      else await trpc.pos.holdTable.mutate({ id: t.id });
      refresh();
    } finally {
      setBusy(null);
    }
  }

  const heldCount = (tables ?? []).filter((t) => t.heldAt).length;
  return (
    <section className="mt-6 space-y-3">
      <h2 className="text-sm font-semibold text-zinc-500">
        Столлар{" "}
        {heldCount > 0 && (
          <span className="text-amber-600">· {heldCount} банд</span>
        )}
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {(tables ?? []).map((t) => (
          <button
            key={t.id}
            onClick={() => toggle(t)}
            disabled={busy === t.id}
            className={`rounded-xl border px-3 py-3 text-left transition disabled:opacity-50 ${
              t.heldAt
                ? "border-amber-300 bg-amber-50"
                : "border-zinc-200 bg-white hover:border-brand"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t.name}</span>
              {t.heldAt && <span className="text-xs">🔒</span>}
            </div>
            <div
              className={`mt-1 text-xs ${
                t.heldAt ? "text-amber-600" : "text-zinc-400"
              }`}
            >
              {t.heldAt ? "Банд · бўшатиш" : "Бўш · банд қилиш"}
            </div>
          </button>
        ))}
      </div>
      {tables && tables.length === 0 && (
        <div className="rounded-xl border bg-white px-4 py-8 text-center text-sm text-zinc-400">
          Стол йўқ
        </div>
      )}
    </section>
  );
}

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
                className="grid h-8 w-8 place-items-center rounded-lg bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                title="Исм/рол"
                aria-label="Исм/рол таҳрирлаш"
              >
                <IPencil className="h-4 w-4" />
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
