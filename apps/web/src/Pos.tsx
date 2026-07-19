import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { SessionUser } from "./App";
import { BRAND } from "./brand";
import { swr } from "./lib/cache";
import { uuid } from "./lib/uuid";
import {
  deriveOrder,
  enqueueAddItem,
  enqueueCreate,
  enqueueMeta,
  enqueueSendToKitchen,
  flush,
  getOverlay,
  isOnline,
  listOverlayOpenOrders,
  localUnsent,
  mergeOpenOrders,
  patchOverlayHead,
  pendingOpsFor,
  syncBaseFromServer,
} from "./lib/outbox";
import { trpc } from "./trpc";
import QRCode from "qrcode";
import { payUrl, type PayConfig } from "./payqr";
import {
  Svg, type IP, IPlus, IMinus, IBack, ISearch, IFlame, IGift, IPrinter, IChevron,
  IUser, IUsers, IBank, ICard, IReceipt, IPlate, IClock, IPencil, ITrash, IChat,
  IPercent, ISplit, ILock, ILockOpen, ICheck, ISwap, IStop, IArrange, IWifiOff,
  IScale, IGear, IWarn, ILink, IMoped, IBag, ISpin, ILogout,
} from "./icons";

// Заказ-toolbar 3D Clay иконкалари (Higgsfield премиум сет, расмдан crop) — эга танлови.
const TOOL_POS: Record<string, string> = {
  percent: "0% 0%", chat: "50% 0%", clock: "100% 0%",
  split: "0% 50%", card: "50% 50%", lock: "100% 50%",
  printer: "0% 100%", user: "50% 100%", more: "100% 100%",
};
// ?toolbar=gold|glass|enamel|clay URL параметр билан вариант танланади (дефолт = металл-олтин).
const TOOL_VARIANT = (() => {
  const v = new URLSearchParams(window.location.search).get("toolbar");
  return v && ["gold", "glass", "enamel", "clay"].includes(v) ? v : "gold";
})();
function ToolIcon({ k, className = "h-7 w-7" }: { k: string; className?: string }) {
  return (
    <span
      className={`inline-block shrink-0 bg-no-repeat ${className}`}
      style={{ backgroundImage: `url(/brand/icons-toolbar-${TOOL_VARIANT}.webp)`, backgroundSize: "300% 300%", backgroundPosition: TOOL_POS[k] }}
      aria-hidden="true"
    />
  );
}

type Hall = { id: string; name: string; servicePct: number };
type Table = { id: string; hallId: string; name: string; sort: number; posX: number | null; posY: number | null; w?: number | null; h?: number | null };
type MenuItem = {
  id: string;
  name: string;
  price: number;
  category: string | null;
  stopped: boolean;
  soldByWeight?: boolean;
};
type OpenOrder = {
  id: string;
  tableNo: string | null;
  hallId: string;
  guests: number | null;
  saleType?: string;
  hall: string | null;
  waiter: string | null;
  qty: number;
  total: number | null; // официант учун бошқанинг заказида null (яширилган → "банд")
  mine?: boolean;
  createdAt: string;
};
type PayMethod = "cash" | "card" | "click" | "payme" | "humo" | "debt";
const PAY_METHODS: PayMethod[] = ["cash", "card", "click", "payme", "humo", "debt"];
type Order = {
  id: string;
  checkNo: string;
  tableNo: string | null;
  status: string;
  servicePct: number;
  hallId: string;
  hall: string | null;
  waiter: string | null;
  guests: number | null;
  note: string | null;
  createdAt: string;
  isComp: boolean;
  compReason: string | null;
  discountAmount: number;
  discountReason: string | null;
  locked: boolean;
  serviceWaived: boolean;
  saleType: string;
  items: {
    id: string;
    productId: string | null;
    name: string;
    price: number;
    qty: number;
    weightG?: number | null;
    note?: string | null;
    course?: number | null; // курс/подача (1=биринчи тўлқин); оффлайн-overlay'да йўқ
  }[];
  payments: { method: string; amount: number }[];
  subtotal: number;
  service: number;
  total: number;
  // Бронь аванси (ишлатилмаган) — тўловда −N бўлиб ҳисобга киради.
  // Оффлайн-overlay заказларда йўқ → optional.
  deposit?: number;
  reservationName?: string | null;
};

// Изоҳ учун тез чиплар — залда энг кўп айтиладиган талаблар
const NOTE_CHIPS = ["Пиёзсиз", "Аччиқ эмас", "Соус алоҳида", "Майдалаб", "Тез!"];

const PAY_LABEL: Record<string, string> = {
  cash: "Нақд",
  card: "Карта",
  click: "Click",
  payme: "Payme",
  humo: "Ҳумо",
  debt: "Қарз",
  avans: "Аванс (бронь)",
};

// ── Бронь (олдиндан жой банд қилиш) ──────────────────────────────────────────
type Reservation = {
  id: string;
  tableId: string;
  tableName: string;
  hallId: string;
  name: string;
  phone: string | null;
  guests: number | null;
  reservedFor: string;
  note: string | null;
  status: string;
  depositAmount: number;
  depositMethod: string | null;
  createdBy: string | null;
};
const WEEKDAY = ["Якшанба", "Душанба", "Сешанба", "Чоршанба", "Пайшанба", "Жума", "Шанба"];
const MONTH_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const RES_LATE_MS = 30 * 60 * 1000; // 30 дақиқа кутамиз — кейин «келмади»
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
// «Бугун — Жума» / «Эртага — Шанба» / «Жума, 24-июл» — эга ҳафта кунини кўрсин деди.
function resDayLabel(d: Date) {
  const now = new Date();
  if (sameDay(d, now)) return `Бугун — ${WEEKDAY[d.getDay()]}`;
  if (sameDay(d, new Date(now.getTime() + 86_400_000))) return `Эртага — ${WEEKDAY[d.getDay()]}`;
  return `${WEEKDAY[d.getDay()]}, ${d.getDate()}-${MONTH_SHORT[d.getMonth()]}`;
}
const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const resLate = (r: Reservation) => Date.now() > new Date(r.reservedFor).getTime() + RES_LATE_MS;
// «Келмади»дан +15 дақ (жами 45) — бронь бутунлай учади, стол автомат бўшайди (эга: Б-вариант).
const RES_GONE_MS = RES_LATE_MS + 15 * 60 * 1000;
const resGone = (r: Reservation) => Date.now() > new Date(r.reservedFor).getTime() + RES_GONE_MS;

// Сотув тури — ёрлиқ + иконка (CloPOS «На месте / Доставка / С собой»).
const SALE_TYPES = ["dine_in", "delivery", "takeaway"] as const;
const SALE_TYPE_META: Record<string, { Icon: (p: IP) => ReactNode; label: string }> = {
  dine_in: { Icon: IPlate, label: "Залда" },
  delivery: { Icon: IMoped, label: "Доставка" },
  takeaway: { Icon: IBag, label: "Собой" },
};
// Сотув тури ярлиғи — иконка + матн (учта render ўрни учун битта манба).
function SaleTypeLabel({ type, className }: { type: string; className?: string }) {
  const m = SALE_TYPE_META[type] ?? SALE_TYPE_META.dine_in!;
  return (
    <span className="inline-flex items-center gap-1.5">
      <m.Icon className={className ?? "h-4 w-4"} /> {m.label}
    </span>
  );
}

const fmt = (n: number) => n.toLocaleString("ru-RU");

// CloPOS-бар соати (HH:MM, ҳар 10с) — handoff-макет.
function FloorClock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setT(new Date()), 10_000);
    return () => clearInterval(iv);
  }, []);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="text-[13px] tabular-nums text-white">
      {p(t.getHours())}:{p(t.getMinutes())}
    </span>
  );
}
// Тўлиқ-экран катта соат (☰ панел → Соат).
function BigClock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    <div className="flex flex-col items-center">
      <div className="text-[16vw] font-bold leading-none tabular-nums text-white">
        {p(t.getHours())}:{p(t.getMinutes())}
        <span className="text-[8vw] text-brand-gold">:{p(t.getSeconds())}</span>
      </div>
      <div className="mt-4 text-[3vw] text-white/60">
        {t.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}
      </div>
    </div>
  );
}

function vibrate(pattern: number | number[]) {
  if ("vibrate" in navigator) navigator.vibrate(pattern);
}

// Category colour-coding — fast visual scanning (Clopos has none).
const CAT_COLORS: [RegExp, string][] = [
  [/шашлик/i, "#c1502e"],
  [/салат/i, "#3f7d4e"],
  [/балик|балиқ|рыб/i, "#2f6f8f"],
  [/спиртли|алко|пиво/i, "#7b3f6f"],
  [/ичимлик|напит/i, "#2a9d9d"],
  [/ширин|десерт|сладк/i, "#c8577e"],
  [/морожен/i, "#5b8fd6"],
  [/choy|чой|чай|non/i, "#b07b3e"],
  [/таом|блюд|горяч|ош/i, "#0e7c5a"],
];
const PALETTE = ["#0e4037", "#c1502e", "#2f6f8f", "#7b3f6f", "#3f7d4e", "#b07b3e", "#2a9d9d", "#c8577e"];
function catColor(name?: string | null): string {
  if (!name) return "#9a9a9a";
  for (const [re, c] of CAT_COLORS) if (re.test(name)) return c;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length] ?? "#0e4037";
}

// Директор иссиқ харитаси: 0 → cream, ярим → gold, макс → brand-deep (чизиқли).
const HEAT_STOPS: [number, string][] = [
  [0, "#fff0e5"],
  [0.5, "#f3b759"],
  [1, "#092f28"],
];
function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lerpHeat(pct: number): string {
  let lo = HEAT_STOPS[0]!;
  let hi = HEAT_STOPS[HEAT_STOPS.length - 1]!;
  for (let i = 0; i < HEAT_STOPS.length - 1; i++) {
    const a = HEAT_STOPS[i]!;
    const b = HEAT_STOPS[i + 1]!;
    if (pct >= a[0] && pct <= b[0]) {
      lo = a;
      hi = b;
      break;
    }
  }
  const span = hi[0] - lo[0];
  const t = span === 0 ? 0 : (pct - lo[0]) / span;
  const [r1, g1, b1] = hexToRgb(lo[1]);
  const [r2, g2, b2] = hexToRgb(hi[1]);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

function minsOpen(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}
function minsAgo(iso: string): string {
  const m = minsOpen(iso);
  if (m < 60) return `${m}м`;
  return `${Math.floor(m / 60)}с ${m % 60}м`;
}
// Стол вақт-эскалацияси: STALE = сервер staleOrders сигнали билан бир хил (90′,
// "тўламай кетган мижоз" хатари). WARN — эрта огоҳ (узоқ ўтирибди).
const TABLE_WARN_MIN = 45;
const TABLE_STALE_MIN = 90;

// Иконка тизими → ./icons (Shell/Kds биргаликда ишлатади)

function Spin() {
  return (
    <div className="grid place-items-center py-16">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand-cream-soft border-t-brand" />
    </div>
  );
}

// Бренд бўш-ҳолат арт: лимон бўлаги — инлайн SVG (0 тармоқ сўрови, DESIGN.md §4)
function EmptyLemon({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="grid place-items-center gap-2 px-4 py-8 text-center">
      <svg viewBox="0 0 64 64" className="h-12 w-12" aria-hidden="true">
        <circle cx="32" cy="32" r="22" fill="#f3b759" opacity="0.9" />
        <circle cx="32" cy="32" r="17" fill="#fff0e5" />
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <path
            key={a}
            d="M32 32 L32 17 A15 15 0 0 1 44.5 24.5 Z"
            fill="#f3b759"
            opacity="0.55"
            transform={`rotate(${a} 32 32)`}
          />
        ))}
        <circle cx="32" cy="32" r="2.5" fill="#d99a2b" />
        <path d="M46 12 q6 -6 12 -4 q-2 8 -10 9 Z" fill="#16553f" />
      </svg>
      <p className="text-sm font-medium text-brand-ink/70">{title}</p>
      {hint && <p className="text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}

export function Pos({ user, onLogout, onNavigate }: { user: SessionUser; onLogout: () => void; onNavigate: (tab: string) => void }) {
  const [orderId, setOrderId] = useState<string | null>(null);
  if (orderId)
    return (
      <OrderView
        id={orderId}
        user={user}
        onBack={() => setOrderId(null)}
        onSwitch={setOrderId}
      />
    );
  return <FloorView user={user} onOpen={setOrderId} onNew={setOrderId} onLogout={onLogout} onNavigate={onNavigate} />;
}

// ── FLOOR: visual hall/table map (Clopos only has a flat list) ──────────────
function FloorView({
  user,
  onOpen,
  onNew,
  onLogout,
  onNavigate,
}: {
  user: SessionUser;
  onOpen: (id: string) => void;
  onNew: (id: string) => void;
  onLogout: () => void;
  onNavigate: (tab: string) => void;
}) {
  const [halls, setHalls] = useState<Hall[]>([]);
  const [tbls, setTbls] = useState<Table[]>([]);
  const [orders, setOrders] = useState<OpenOrder[] | null>(null);
  const [newFor, setNewFor] = useState<{ hall: Hall; table?: string } | null>(null);
  const [conflict, setConflict] = useState<{ table: string; orders: OpenOrder[] } | null>(null);
  const [quickFor, setQuickFor] = useState<OpenOrder | null>(null);
  const [online, setOnline] = useState(isOnline());
  const [heatOn, setHeatOn] = useState(false);
  const [heat, setHeat] = useState<{ hallId: string; hallName: string; tableNo: string; revenue: number }[] | null>(null);
  const [arrange, setArrange] = useState(false);
  const [showChecks, setShowChecks] = useState(false); // Чеки → очиқ-чеклар рўйхати
  const [checksQ, setChecksQ] = useState(""); // рўйхат қидируви (стол/официант)
  const [showPanel, setShowPanel] = useState(false); // ☰ → бошқарув панели (CloPOS)
  const [showClock, setShowClock] = useState(false); // 🕐 тўлиқ-экран соат
  const [soundOff, setSoundOff] = useState(() => localStorage.getItem("pos-sound-off") === "1");
  const [hallFilter, setHallFilter] = useState<string>("all");
  const [resList, setResList] = useState<Reservation[]>([]); // фаол бронлар
  const [showRes, setShowRes] = useState(false); // Бронь рўйхати/яратиш модали
  const [seatFor, setSeatFor] = useState<{ table: Table; res: Reservation } | null>(null); // ўтирғизиш тасдиғи
  // Стол вақт-ҳалқаси жонли ўтсин — рефетчсиз (openOrders фақат mount/drain'да
  // янгиланади). Дақиқа гранулярлиги учун 60с кифоя.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const refresh = useCallback(async () => {
    // Сервер + локал (offline'да яратилган) очиқ заказларни бирлаштириш.
    const local = (await listOverlayOpenOrders()) as unknown as OpenOrder[];
    try {
      const server = await trpc.pos.openOrders.query();
      setOrders(mergeOpenOrders(server, local));
    } catch {
      setOrders(local); // оффлайн — фақат локал overlay
    }
    // Бронлар — оффлайнда эскиси кўринаверади (фақат кўрсатиш учун, хавфсиз).
    try {
      setResList(await trpc.pos.reservations.query());
    } catch {
      /* оффлайн */
    }
  }, []);
  useEffect(() => {
    // Заллар/столлар — ўзгармас; оффлайнда кэшдан кўринади (фаза 3 refCache).
    swr("pos.halls", () => trpc.pos.halls.query(), setHalls).catch(() => {});
    swr("pos.tables", () => trpc.pos.tables.query(), setTbls).catch(() => {});
    refresh();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("outbox:drain", refresh); // синхрондан кейин пол янгилансин
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("outbox:drain", refresh);
    };
  }, [refresh]);

  const key = (hallId: string, name: string | null) => `${hallId}::${name ?? ""}`;

  function moved(tid: string, x: number, y: number) {
    setTbls((prev) => prev.map((t) => (t.id === tid ? { ...t, posX: x, posY: y } : t)));
    trpc.pos.setTablePosition.mutate({ id: tid, posX: x, posY: y }).catch(() => refresh());
  }

  function resized(tid: string, w: number, h: number) {
    setTbls((prev) => prev.map((t) => (t.id === tid ? { ...t, w, h } : t)));
    trpc.pos.setTableSize.mutate({ id: tid, w, h }).catch(() => refresh());
  }

  useEffect(() => {
    if (!heatOn) return;
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    swr(
      "report.byTable:30d",
      () => trpc.report.byTable.query({ from: iso(from), to: iso(to) }),
      setHeat,
    ).catch(() => {});
  }, [heatOn]);

  const heatMax = heat ? Math.max(0, ...heat.map((h) => h.revenue)) : 0;
  const heatByKey = new Map<string, number>();
  for (const h of heat ?? []) heatByKey.set(key(h.hallId, h.tableNo), h.revenue);
  const heatColor = (revenue: number) => {
    if (heatMax === 0) return "#f5f0e6"; // cream — нейтрал (max===0 ҳимояси)
    const pct = Math.max(0, Math.min(1, revenue / heatMax));
    return lerpHeat(pct);
  };

  const createBusyRef = useRef(false);
  async function create(hallId: string, table: string | undefined, guests: number, saleType = "dine_in") {
    // Double-tap ҳимояси: ҳар тап янги uuid ясайди → гардсиз 2 заказ очилади.
    if (createBusyRef.current) return;
    createBusyRef.current = true;
    try {
      await createInner(hallId, table, guests, saleType);
    } finally {
      createBusyRef.current = false;
    }
  }
  async function createInner(hallId: string, table: string | undefined, guests: number, saleType: string) {
    // Offline-first: локал заказ + навбат; уланганда синхрон (идемпотент client id).
    const hall = halls.find((h) => h.id === hallId);
    const id = uuid();
    // Доставка/собой — сервис олинмайди (сервер ҳам шундай яратади).
    const waive = saleType !== "dine_in";
    const persisted = await enqueueCreate({
      id,
      hallId,
      hall: hall?.name ?? null,
      tableNo: table || undefined,
      servicePct: waive ? 0 : hall?.servicePct ?? 0,
      guests,
      waiter: user.name,
      saleType,
    });
    if (!persisted) {
      // IndexedDB йўқ (private mode) — тўғридан-тўғри серверга (идемпотент).
      try {
        await trpc.pos.create.mutate({
          id,
          hallId,
          tableNo: table || undefined,
          guests,
          saleType: saleType as "dine_in" | "delivery" | "takeaway",
        });
      } catch {
        alert("Заказ очилмади — оффлайн ва хотира ишламаяпти.");
        return;
      }
    }
    onNew(id);
    void flush();
  }

  const byKey = new Map<string, OpenOrder[]>();
  for (const o of orders ?? []) {
    const k = key(o.hallId, o.tableNo);
    const arr = byKey.get(k);
    if (arr) arr.push(o);
    else byKey.set(k, [o]);
  }
  const tableKeys = new Set(tbls.map((t) => key(t.hallId, t.name)));
  const stray = (orders ?? []).filter((o) => !tableKeys.has(key(o.hallId, o.tableNo)));
  const busy = orders?.length ?? 0;

  // Бугунги (+ ҳал қилинмаган кечаги) бронлар — флоор бейджи; ҳар столга энг
  // яқини. Эртанги/кейингилар фақат «Бронь» рўйхатида кўринади.
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const resToday = resList.filter((r) => new Date(r.reservedFor) <= endOfToday);
  const resByTable = new Map<string, Reservation>();
  for (const r of resToday) {
    if (resGone(r)) continue; // 45 дақ+ кечиккан бронь учди — стол бўшайди (бошқа меҳмонга берилади)
    const prev = resByTable.get(r.tableId);
    if (!prev || new Date(r.reservedFor) < new Date(prev.reservedFor)) resByTable.set(r.tableId, r);
  }

  // Бронь ўтирғизиш: заказ броньга уланади (аванс ёпилишда −N бўлиб киради).
  // Онлайн шарт — аванс пул ҳисоби оффлайн-навбатга ишонилмайди.
  async function seatReservation(table: Table, res: Reservation) {
    if (createBusyRef.current) return;
    createBusyRef.current = true;
    try {
      const id = uuid();
      await trpc.pos.create.mutate({
        id,
        hallId: table.hallId,
        tableNo: table.name,
        guests: res.guests ?? 2,
        reservationId: res.id,
      });
      setSeatFor(null);
      onNew(id);
    } catch {
      alert("Ўтирғизиш учун алоқа керак — аванс ҳисоби онлайн ёзилади.");
    } finally {
      createBusyRef.current = false;
    }
  }

  return (
    <div className="flex flex-1 flex-col" style={{ fontFamily: "'Segoe UI', system-ui, -apple-system, Tahoma, sans-serif" }}>
      {/* ── CloPOS индиго-бар 34px (handoff-макет, точь-в-точь): зал-таблар чап,
          ўнгда Новый заказ · Чеки · ☰ · исм · 🔔 · соат · wifi ─────────────── */}
      <div className="flex h-[34px] min-w-0 items-stretch bg-clopos-bar">
        <div className="flex min-w-0 items-stretch overflow-x-auto">
          {halls.map((h) => {
            const act = hallFilter === h.id || (hallFilter === "all" && halls[0]?.id === h.id);
            return (
              <button
                key={h.id}
                onClick={() => setHallFilter(h.id)}
                className={`flex shrink-0 items-center px-[18px] text-[13px] transition ${
                  act ? "bg-clopos-bar-active font-bold text-white" : "font-normal text-[#C9C7DD] hover:text-white"
                }`}
              >
                {h.name}
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-4 pr-3.5">
          {user.role === "director" && (
            <button
              onClick={() => setHeatOn((v) => !v)}
              title="Иссиқ харита — 30 кунлик пул"
              className={`grid h-6 w-6 place-items-center rounded-[3px] transition ${heatOn ? "bg-brand-gold text-brand-ink" : "text-white/60 hover:text-white"}`}
            >
              <IFlame className="h-4 w-4" />
            </button>
          )}
          {user.role === "director" && (
            <button
              onClick={() => setArrange((a) => !a)}
              title={arrange ? "Тайёр" : "Жойлаштириш"}
              className={`grid h-6 w-6 place-items-center rounded-[3px] transition ${arrange ? "bg-white text-brand-ink" : "text-white/60 hover:text-white"}`}
            >
              {arrange ? <ICheck className="h-4 w-4" /> : <IArrange className="h-4 w-4" />}
            </button>
          )}
          <button
            onClick={() => halls[0] && setNewFor({ hall: halls[0] })}
            className="flex h-6 items-center gap-1.5 rounded-[3px] bg-clopos-gold px-3 shadow-[0_1px_0_rgba(0,0,0,.2)] transition hover:brightness-105"
          >
            <span className="text-[15px] font-bold leading-none text-clopos-gold-text">+</span>
            <span className="whitespace-nowrap text-[13px] font-semibold text-clopos-gold-text">Новый заказ</span>
          </button>
          <button
            onClick={() => setShowRes(true)}
            title="Бронь — олдиндан жой банд қилиш"
            className="flex items-center gap-1.5 rounded-[3px] px-2 py-0.5 transition hover:bg-white/15"
          >
            <span className="whitespace-nowrap text-[13px] text-white">Бронь</span>
            {resList.length > 0 && (
              <span className="grid h-[17px] min-w-[17px] place-items-center rounded-full border-[1.5px] border-white bg-clopos-gold px-1 text-[10px] font-bold text-clopos-gold-text">
                {resList.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowChecks(true)}
            title="Очиқ чеклар рўйхати"
            className="flex items-center gap-1.5 rounded-[3px] px-2 py-0.5 transition hover:bg-white/15"
          >
            <span className="whitespace-nowrap text-[13px] text-white">Чеки</span>
            <span className="grid h-[17px] w-[17px] place-items-center rounded-full border-[1.5px] border-white bg-clopos-badge text-[10px] font-bold text-clopos-gold-text">
              {busy}
            </span>
          </button>
          <button
            onClick={() => setShowPanel(true)}
            title="Меню — бошқарув панели"
            className="grid h-6 w-6 place-items-center rounded-[3px] text-white/80 transition hover:bg-white/15 hover:text-white"
          >
            <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true">
              <rect x="0" y="0" width="18" height="2" rx="1" fill="currentColor" />
              <rect x="0" y="6" width="18" height="2" rx="1" fill="currentColor" />
              <rect x="0" y="12" width="18" height="2" rx="1" fill="currentColor" />
            </svg>
          </button>
          <button
            onClick={onLogout}
            title="Чиқиш — сеансни ёпиш"
            className="hidden items-center gap-1.5 rounded-[3px] px-2 py-0.5 text-[13px] text-white transition hover:bg-white/15 sm:flex"
          >
            <ILogout className="h-4 w-4" /> {user.name}
          </button>
          <FloorClock />
          <span title={online ? "Алоқа бор" : "Оффлайн"}>
            {online ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="3" cy="13" r="1.6" fill="#4CAF50" />
                <path d="M2 9a5 5 0 0 1 5 5M2 5a9 9 0 0 1 9 9" stroke="#4CAF50" strokeWidth="2" fill="none" />
              </svg>
            ) : (
              <IWifiOff className="h-4 w-4 text-red-400" />
            )}
          </span>
        </div>
      </div>

      <div className="flex-1 space-y-4 bg-clopos-bg floor-cinematic p-3">
      {!online && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <IWifiOff className="h-4 w-4 shrink-0" /> Оффлайн — заказлар шу қурилмада сақланиб, уланганда синхронланади. Тўлов уланганда мумкин.
        </div>
      )}

      {orders === null ? (
        <Spin />
      ) : (
        <>
          {halls
            .filter((h) => (hallFilter === "all" ? halls[0]?.id === h.id : h.id === hallFilter))
            .map((h) => {
            const hallTables = tbls.filter((t) => t.hallId === h.id);
            return (
              <section key={h.id} className="space-y-2.5">
                <HallCanvas
                  tables={hallTables}
                  arrange={arrange}
                  onMoved={moved}
                  onResized={resized}
                  renderTile={(t) => {
                    const os = byKey.get(key(h.id, t.name)) ?? [];
                    const rev = heatByKey.get(key(h.id, t.name)) ?? 0;
                    const rsv = resByTable.get(t.id); // бугунги энг яқин бронь
                    if (os.length === 0) {
                      // Бронли бўш стол = ТЎЛИҚ оч яшил (олтин ҳошия), кечикса қизил
                      // — банд(тўқ яшил)/бўш(кулранг)дан ажралиб турсин.
                      const resView = rsv && !heatOn;
                      const late = resView && resLate(rsv);
                      return (
                        <button
                          style={heatOn ? { backgroundColor: heatColor(rev) } : undefined}
                          onClick={() =>
                            heatOn
                              ? alert(`${t.name}: ${fmt(rev)} so'm за 30 кун`)
                              : rsv
                                ? setSeatFor({ table: t, res: rsv })
                                : void create(h.id, t.name, 2, "dine_in")
                          }
                          className={`flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-[2px] px-2 py-2 text-center leading-tight shadow-[2px_3px_0_0_rgba(0,0,0,.24)] transition hover:brightness-105 active:scale-[.98] motion-reduce:active:scale-100 ${
                            !resView
                              ? "floor-free text-white"
                              : late
                                ? "bg-red-600 text-white"
                                : "bg-clopos-reserved text-clopos-reserved-text"
                          }`}
                        >
                          <span className="line-clamp-2 text-[13px] font-bold">{t.name}</span>
                          {rsv && !heatOn && (
                            <>
                              <span className="text-[11px] font-bold">
                                🕐 {hhmm(new Date(rsv.reservedFor))} · {rsv.name}
                                {rsv.guests ? ` · ${rsv.guests}` : ""}
                              </span>
                              {rsv.createdBy && (
                                <span className={`text-[9px] ${late ? "text-white/80" : "opacity-70"}`}>
                                  админ: {rsv.createdBy}
                                </span>
                              )}
                              {late && (
                                <span className="mt-0.5 rounded-full bg-white px-1.5 py-0.5 text-[9px] font-bold text-red-700">
                                  келмади
                                </span>
                              )}
                            </>
                          )}
                        </button>
                      );
                    }
                    const first = os[0] as OpenOrder;
                    return (
                      <TableTile
                        table={t.name}
                        order={first}
                        conflict={os.length > 1}
                        heatColor={heatOn ? heatColor(rev) : undefined}
                        fill
                        resChip={
                          rsv && !heatOn
                            ? { time: hhmm(new Date(rsv.reservedFor)), late: resLate(rsv) }
                            : undefined
                        }
                        onClick={() =>
                          heatOn
                            ? alert(`${t.name}: ${fmt(rev)} so'm за 30 кун`)
                            : os.length > 1
                              ? setConflict({ table: t.name, orders: os })
                              : onOpen(first.id)
                        }
                        onLongPress={heatOn ? undefined : () => setQuickFor(first)}
                      />
                    );
                  }}
                />
              </section>
            );
          })}

          {stray.length > 0 && (
            <section className="space-y-2.5">
              <h3 className="px-1 text-sm font-bold uppercase tracking-wide text-brand-ink">Бошқа очиқ</h3>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {stray.map((o) => {
                  const label = o.tableNo || o.hall || "заказ";
                  const rev = heatByKey.get(key(o.hallId, o.tableNo)) ?? 0;
                  return (
                    <TableTile
                      key={o.id}
                      table={label}
                      order={o}
                      heatColor={heatOn ? heatColor(rev) : undefined}
                      onClick={() => (heatOn ? alert(`${label}: ${fmt(rev)} so'm за 30 кун`) : onOpen(o.id))}
                      onLongPress={heatOn ? undefined : () => setQuickFor(o)}
                    />
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
      </div>

      {newFor && (
        <NewOrderSheet
          halls={halls}
          preset={newFor}
          onClose={() => setNewFor(null)}
          onCreate={create}
        />
      )}

      {/* ☰ Бошқарув панели (CloPOS «Панель управления») — бўлимларга ўтиш */}
      {showPanel && (() => {
        const isDir = user.role === "director";
        const dm = isDir || user.role === "manager";
        const cashierUp = ["director", "manager", "cashier"].includes(user.role);
        const items = [
          { emoji: "📊", label: "Ҳисобот", sub: "Отчёты", tab: "hisobot", show: dm },
          { emoji: "💰", label: "Молия / касса", sub: "Операции · Открыть кассу", tab: "moliya", show: isDir },
          { emoji: "🗂", label: "Чек архиви", sub: "Архив чеков", tab: "chekQidirish", show: cashierUp },
          { emoji: "📦", label: "Харид", sub: "Поставка", tab: "harid", show: dm },
          { emoji: "🗑", label: "Омбор", sub: "Списания", tab: "ombor", show: dm },
          { emoji: "👥", label: "Мижозлар", sub: "Клиенты", tab: "mijozlar", show: dm },
          { emoji: "🪪", label: "Ходимлар", sub: "Сотрудник", tab: "staff", show: isDir },
          { emoji: "🍽", label: "Каталог", sub: "Стоп-лист · меню", tab: "catalog", show: true },
          { emoji: "📈", label: "Аналитика", sub: "", tab: "analitika", show: isDir },
          { emoji: "🍳", label: "KDS", sub: "Кухня", tab: "kds", show: dm },
        ].filter((x) => x.show);
        return (
          // CloPOS «Панель управления» — ТЎЛИҚ ЭКРАН (яшил header · кулранг грид · паст утилита-бар)
          <div className="fixed inset-0 z-50 flex flex-col bg-clopos-bg" style={{ fontFamily: "'Segoe UI', system-ui, -apple-system, Tahoma, sans-serif" }}>
            <div className="flex items-center gap-3 bg-brand px-4 py-3 text-white shadow-md">
              <button
                onClick={() => setShowPanel(false)}
                title="Орқага"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg transition hover:bg-white/15"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M12 4l-6 6 6 6" />
                </svg>
              </button>
              <h3 className="text-lg font-bold">Бошқарув панели</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {items.map((it) => (
                  <button
                    key={it.tab}
                    onClick={() => { setShowPanel(false); onNavigate(it.tab); }}
                    className="flex items-center gap-3 rounded-xl border border-brand-cream-soft bg-white px-4 py-4 text-left shadow-sm transition hover:border-brand hover:bg-brand-cream/30 active:scale-[.98] motion-reduce:active:scale-100"
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand-cream text-2xl">{it.emoji}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold text-brand-ink">{it.label}</span>
                      {it.sub && <span className="block truncate text-xs text-zinc-400">{it.sub}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 border-t border-brand-cream-soft bg-white p-3 sm:grid-cols-6">
              <button
                onClick={() => window.location.reload()}
                className="flex items-center justify-center gap-2 rounded-xl border border-brand-cream-soft py-3 text-[13px] font-medium text-zinc-700 transition hover:border-brand hover:bg-brand-cream/30"
              >
                <span className="text-lg">🔄</span> Янгилаш
              </button>
              <button
                onClick={() => {
                  const v = !soundOff;
                  setSoundOff(v);
                  localStorage.setItem("pos-sound-off", v ? "1" : "0");
                }}
                className="flex items-center justify-center gap-2 rounded-xl border border-brand-cream-soft py-3 text-[13px] font-medium text-zinc-700 transition hover:border-brand hover:bg-brand-cream/30"
              >
                <span className="text-lg">{soundOff ? "🔇" : "🔊"}</span> {soundOff ? "Овоз ўчиқ" : "Овоз"}
              </button>
              <button
                onClick={() => { setShowPanel(false); setShowClock(true); }}
                className="flex items-center justify-center gap-2 rounded-xl border border-brand-cream-soft py-3 text-[13px] font-medium text-zinc-700 transition hover:border-brand hover:bg-brand-cream/30"
              >
                <span className="text-lg">🕐</span> Соат
              </button>
              <button
                onClick={() => {
                  if (document.fullscreenElement) void document.exitFullscreen?.();
                  else void document.documentElement.requestFullscreen?.();
                }}
                className="flex items-center justify-center gap-2 rounded-xl border border-brand-cream-soft py-3 text-[13px] font-medium text-zinc-700 transition hover:border-brand hover:bg-brand-cream/30"
              >
                <span className="text-lg">⤢</span> Экран
              </button>
              <button
                onClick={() => { setShowPanel(false); onNavigate("moliya"); }}
                className="flex items-center justify-center gap-2 rounded-xl border border-brand-cream-soft py-3 text-[13px] font-medium text-zinc-700 transition hover:border-brand hover:bg-brand-cream/30"
              >
                <span className="text-lg">🧾</span> Касса
              </button>
              <button
                onClick={() => { setShowPanel(false); onLogout(); }}
                className="flex items-center justify-center gap-2 rounded-xl border border-red-200 py-3 text-[13px] font-medium text-red-600 transition hover:bg-red-50"
              >
                <span className="text-lg">⎋</span> Чиқиш
              </button>
            </div>
          </div>
        );
      })()}

      {/* 🕐 Тўлиқ-экран соат (☰ панел → Соат) — экранга бос ёпилади */}
      {showClock && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-brand-deep"
          onClick={() => setShowClock(false)}
        >
          <BigClock />
          <p className="absolute bottom-8 text-sm text-white/40">Экранга бос — ёпиш</p>
        </div>
      )}

      {/* Открытые чеки — барча очиқ чеклар рўйхати (CloPOS «Чеки»), босса → очилади */}
      {showChecks && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
          onClick={() => setShowChecks(false)}
        >
          <div
            className="flex max-h-[85dvh] w-full max-w-2xl flex-col gap-3 rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-brand-ink">Очиқ чеклар — {(orders ?? []).length}</h3>
              <button
                onClick={() => setShowChecks(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 transition hover:bg-zinc-100"
              >
                Ёпиш
              </button>
            </div>
            <input
              value={checksQ}
              onChange={(e) => setChecksQ(e.target.value)}
              placeholder="Стол ёки официант…"
              className="w-full rounded-lg border border-brand-cream-soft px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
              {(orders ?? [])
                .filter((o) => {
                  const q = checksQ.trim().toLowerCase();
                  if (!q) return true;
                  return (o.tableNo ?? "").toLowerCase().includes(q) || (o.waiter ?? "").toLowerCase().includes(q);
                })
                .slice()
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                .map((o) => (
                  <button
                    key={o.id}
                    onClick={() => {
                      setShowChecks(false);
                      onOpen(o.id);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl border border-brand-cream-soft bg-white px-3 py-2.5 text-left transition hover:border-brand hover:bg-brand-cream/30"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-brand-ink">
                        {o.tableNo ?? "—"} <span className="font-normal text-zinc-400">· {o.hall ?? ""}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-500">
                        {o.waiter && <span>{o.waiter}</span>}
                        <span>· {SALE_TYPE_META[o.saleType ?? "dine_in"]?.label ?? "Залда"}</span>
                        <span>· {minsAgo(o.createdAt)}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-sm font-bold tabular-nums text-brand">
                      {o.total === null ? "банд" : `${fmt(o.total)} so'm`}
                    </div>
                  </button>
                ))}
              {(orders ?? []).length === 0 && (
                <p className="py-8 text-center text-sm text-zinc-400">Очиқ чек йўқ</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Бронь рўйхати + янги бронь (менежер/директор) */}
      {showRes && (
        <ReservationsSheet
          user={user}
          halls={halls}
          tables={tbls}
          list={resList}
          onClose={() => setShowRes(false)}
          onChanged={refresh}
        />
      )}

      {/* Бронли столга тап — ўтирғизиш тасдиғи */}
      {seatFor && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
          onClick={() => setSeatFor(null)}
        >
          <div
            className="w-full max-w-sm space-y-2.5 rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-brand-ink">🕐 Бронь — {seatFor.table.name}</h3>
            <div className="rounded-xl bg-brand-cream/40 p-3 text-sm">
              <div className="font-semibold text-brand-ink">
                {seatFor.res.name}
                {seatFor.res.guests ? ` · ${seatFor.res.guests} киши` : ""}
              </div>
              <div className="text-zinc-600">
                {resDayLabel(new Date(seatFor.res.reservedFor))} · {hhmm(new Date(seatFor.res.reservedFor))}
                {resLate(seatFor.res) && <span className="ml-1 font-semibold text-red-600">· кечикди</span>}
              </div>
              {seatFor.res.phone && <div className="text-zinc-600">📞 {seatFor.res.phone}</div>}
              {seatFor.res.createdBy && (
                <div className="text-zinc-500">Брон қилган: {seatFor.res.createdBy}</div>
              )}
              {seatFor.res.depositAmount > 0 && (
                <div className="mt-1 font-semibold text-emerald-700">
                  Аванс: {fmt(seatFor.res.depositAmount)} so'm ({PAY_LABEL[seatFor.res.depositMethod ?? ""] ?? "—"}) — чекда −ҳисобга киради
                </div>
              )}
              {seatFor.res.note && <div className="mt-0.5 text-zinc-500">{seatFor.res.note}</div>}
            </div>
            <button
              onClick={() => void seatReservation(seatFor.table, seatFor.res)}
              disabled={!online}
              title={online ? undefined : "Аванс ҳисоби учун алоқа керак"}
              className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white transition hover:bg-brand-soft disabled:opacity-40"
            >
              Ўтирғизиш — заказ очиш
            </button>
            <button
              onClick={() => {
                const t = seatFor.table;
                setSeatFor(null);
                void create(t.hallId, t.name, 2, "dine_in");
              }}
              className="w-full rounded-xl border border-brand-cream-soft py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
            >
              Бошқа меҳмон — бронсиз заказ
            </button>
            <button
              onClick={() => setSeatFor(null)}
              className="w-full rounded-xl py-2 text-sm text-zinc-400 transition hover:bg-zinc-50"
            >
              Орқага
            </button>
          </div>
        </div>
      )}

      {conflict && (
        <ConflictSheet
          data={conflict}
          onPick={(oid) => {
            setConflict(null);
            onOpen(oid);
          }}
          onClose={() => setConflict(null)}
          canMerge={online && ["director", "manager"].includes(user.role)}
          onMerge={async (fromId, toId) => {
            try {
              await trpc.pos.mergeOrders.mutate({ fromId, toId });
            } catch {
              /* 403/BAD_REQUEST — жим, refresh ҳақиқий ҳолатни кўрсатади */
            }
            setConflict(null);
            refresh();
          }}
          onNew={() => {
            // #3 Банд столга атайин янги заказ (CloPOS «Новый заказ»).
            const hallId = conflict.orders[0]?.hallId;
            if (hallId) void create(hallId, conflict.table, 1);
            setConflict(null);
          }}
        />
      )}

      {quickFor && (
        <QuickActionsSheet
          order={quickFor}
          onClose={() => setQuickFor(null)}
          onMoved={(orderId, hall, tableNo) => {
            // Оптимистик — кўчириш оддий присвоение, дарҳол кўрсатамиз.
            setOrders((os) =>
              os
                ? os.map((o) => (o.id === orderId ? { ...o, hallId: hall.id, hall: hall.name, tableNo: tableNo ?? null } : o))
                : os,
            );
            setQuickFor(null);
            trpc.pos.moveTable
              .mutate({ id: orderId, hallId: hall.id, tableNo })
              .then(() => vibrate([15]))
              .catch((e: unknown) => {
                alert(e instanceof Error ? e.message : "Кўчириш бажарилмади");
                console.error("moveTable failed", e);
              })
              // Хатода ҳам, муваффақиятда ҳам — серверга солиштириб чиқамиз
              // (иккита тезкор кўчиришда ким ютганини ҳам шу тиклайди).
              .finally(refresh);
          }}
          onGuests={(orderId, guests) => {
            setOrders((os) => (os ? os.map((o) => (o.id === orderId ? { ...o, guests } : o)) : os));
            setQuickFor(null);
            enqueueMeta(orderId, { guests }).then(() => void flush()).catch(() => {});
          }}
          onNote={(orderId, note) => {
            setQuickFor(null);
            enqueueMeta(orderId, { note }).then(() => void flush()).catch(() => {});
          }}
        />
      )}
    </div>
  );
}

// Битта столда 2+ очиқ заказ (оффлайн икки қурилма) — огоҳлантириш + танлаш.
// Авто-бирлаштирмаймиз (бизнес қарори) — кассир қайси заказни очишни танлайди.
function ConflictSheet({
  data,
  onPick,
  onClose,
  canMerge,
  onMerge,
  onNew,
}: {
  data: { table: string; orders: OpenOrder[] };
  onPick: (orderId: string) => void;
  onClose: () => void;
  canMerge: boolean;
  onMerge: (fromId: string, toId: string) => void;
  onNew: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-brand-ink/40 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-brand-ink">«{data.table}» — {data.orders.length} та очиқ заказ</h3>
        <p className="mt-1 text-xs text-zinc-500">Заказни танланг ёки шу столга янгисини очинг:</p>
        <div className="mt-3 space-y-2">
          {data.orders.map((o) => (
            <button
              key={o.id}
              onClick={() => onPick(o.id)}
              className="flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm hover:border-brand hover:bg-brand-cream/40"
            >
              <span>
                <span className="font-medium">#{o.id.slice(0, 5).toUpperCase()}</span>
                {o.waiter ? <span className="text-zinc-400"> · {o.waiter}</span> : null}
              </span>
              <span className="tabular-nums font-semibold text-brand-ink">{o.total === null ? "банд" : fmt(o.total)}</span>
            </button>
          ))}
        </div>
        {canMerge && data.orders.length === 2 && data.orders[0] && data.orders[1] && (
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              // 2-чини 1-чига бирлаштириш (итемлар қўшилади, 2-чи cancelled).
              onMerge(data.orders[1]!.id, data.orders[0]!.id);
            }}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-gold py-3 text-sm font-semibold text-brand-ink disabled:opacity-40"
          >
            <ILink className="h-4 w-4" /> Битта заказга бирлаштириш
          </button>
        )}
        <button
          onClick={onNew}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-semibold text-white transition hover:bg-brand-deep"
        >
          <IPlus className="h-4 w-4" /> Янги заказ шу столга
        </button>
      </div>
    </div>
  );
}

// Заказни бошқа зал/столга кўчириш (столни нотўғри танлаган бўлса).
function MoveSheet({
  onClose,
  onMove,
}: {
  onClose: () => void;
  onMove: (hall: Hall, tableNo?: string) => void;
}) {
  const [halls, setHalls] = useState<Hall[]>([]);
  const [tbls, setTbls] = useState<Table[]>([]);
  const [hallId, setHallId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    swr("pos.halls", () => trpc.pos.halls.query(), (h) => {
      setHalls(h);
      setHallId((cur) => cur || h[0]?.id || "");
    }).catch(() => {});
    swr("pos.tables", () => trpc.pos.tables.query(), setTbls).catch(() => {});
  }, []);
  const hallTables = tbls.filter((t) => t.hallId === hallId);
  const pick = (tableNo?: string) => {
    const hall = halls.find((h) => h.id === hallId);
    if (!hall) return;
    setBusy(true);
    onMove(hall, tableNo);
  };
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-brand-ink/40 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-brand-ink">⇄ Бошқа столга кўчириш</h3>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {halls.map((h) => (
            <button
              key={h.id}
              onClick={() => setHallId(h.id)}
              className={`rounded-lg px-3 py-1.5 text-sm ${hallId === h.id ? "bg-brand text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"}`}
            >
              {h.name}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {hallTables.map((t) => (
            <button
              key={t.id}
              disabled={busy}
              onClick={() => pick(t.name)}
              className="rounded-xl border border-brand-cream-soft bg-white px-2 py-3 text-center text-xs font-medium leading-tight text-brand-ink/80 transition hover:border-brand hover:text-brand disabled:opacity-40"
            >
              <span className="line-clamp-2">{t.name}</span>
            </button>
          ))}
          <button
            disabled={busy}
            onClick={() => pick(undefined)}
            className="rounded-xl border border-dashed border-brand-cream-soft px-2 py-3 text-center text-xs text-zinc-400 transition hover:text-brand disabled:opacity-40"
          >
            Столсиз
          </button>
        </div>
      </div>
    </div>
  );
}

// Пол харитасидан long-press билан очиладиган тезкор амаллар — тўлиқ заказ
// экранига ўтмасдан кўчириш/меҳмонлар/изоҳ. Ҳаммаси оптимистик (сервер ҳисоблашсиз).
function QuickActionsSheet({
  order,
  onClose,
  onMoved,
  onGuests,
  onNote,
}: {
  order: OpenOrder;
  onClose: () => void;
  onMoved: (orderId: string, hall: Hall, tableNo?: string) => void;
  onGuests: (orderId: string, guests: number) => void;
  onNote: (orderId: string, note: string) => void;
}) {
  const [mode, setMode] = useState<"menu" | "move" | "guests" | "note">("menu");
  const [guests, setGuestsInput] = useState(order.guests ?? 1);
  const [note, setNoteInput] = useState("");

  if (mode === "move") {
    return (
      <MoveSheet
        onClose={() => setMode("menu")}
        onMove={(hall, tableNo) => onMoved(order.id, hall, tableNo)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-brand-ink/40 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        {mode === "menu" && (
          <>
            <h3 className="font-semibold text-brand-ink">Тезкор амаллар</h3>
            <div className="mt-3 space-y-2">
              <button
                onClick={() => setMode("move")}
                className="flex w-full items-center gap-2 rounded-xl border border-brand-cream-soft px-4 py-3 text-left text-sm font-medium text-brand-ink transition hover:border-brand hover:bg-brand-cream/40"
              >
                <ISwap className="h-5 w-5 text-brand" /> Кўчириш
              </button>
              <button
                onClick={() => { setGuestsInput(order.guests ?? 1); setMode("guests"); }}
                className="flex w-full items-center gap-2 rounded-xl border border-brand-cream-soft px-4 py-3 text-left text-sm font-medium text-brand-ink transition hover:border-brand hover:bg-brand-cream/40"
              >
                <IUsers className="h-5 w-5 text-brand" /> Меҳмонлар
              </button>
              <button
                onClick={() => { setNoteInput(""); setMode("note"); }}
                className="flex w-full items-center gap-2 rounded-xl border border-brand-cream-soft px-4 py-3 text-left text-sm font-medium text-brand-ink transition hover:border-brand hover:bg-brand-cream/40"
              >
                <IChat className="h-5 w-5 text-brand" /> Изоҳ
              </button>
            </div>
            <button onClick={onClose} className="mt-3 w-full py-1 text-xs text-zinc-400 transition hover:text-zinc-600">
              Бекор
            </button>
          </>
        )}

        {mode === "guests" && (
          <>
            <h3 className="flex items-center gap-2 font-semibold text-brand-ink"><IUsers className="h-5 w-5 text-brand" /> Меҳмонлар сони</h3>
            <div className="mt-3 flex items-center justify-center gap-4">
              <Step onClick={() => setGuestsInput((g) => Math.max(1, g - 1))}>
                <IMinus className="h-4 w-4" />
              </Step>
              <span className="w-10 text-center text-2xl font-bold tabular-nums text-brand-ink">{guests}</span>
              <Step onClick={() => setGuestsInput((g) => Math.min(99, g + 1))}>
                <IPlus className="h-4 w-4" />
              </Step>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setMode("menu")}
                className="flex-1 rounded-xl border border-brand-cream-soft py-2.5 text-sm font-medium text-zinc-600"
              >
                Орқага
              </button>
              <button
                onClick={() => onGuests(order.id, guests)}
                className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-deep"
              >
                Сақлаш
              </button>
            </div>
          </>
        )}

        {mode === "note" && (
          <>
            <h3 className="flex items-center gap-2 font-semibold text-brand-ink"><IChat className="h-5 w-5 text-brand" /> Изоҳ</h3>
            <input
              autoFocus
              value={note}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="масалан: аччиқ эмас, музсиз..."
              className="mt-3 w-full rounded-xl border border-brand-cream-soft px-3 py-2.5 text-sm outline-none focus:border-brand"
            />
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setMode("menu")}
                className="flex-1 rounded-xl border border-brand-cream-soft py-2.5 text-sm font-medium text-zinc-600"
              >
                Орқага
              </button>
              <button
                onClick={() => onNote(order.id, note)}
                className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-deep"
              >
                Сақлаш
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 10;

// ── FLOOR эркин жойлашув: столлар сақланган (x,y)да; директор "Жойлаштириш"да
// судрайди. Жойлаштирилмаган столлар авто-тўрга тушади. ─────────────────────
const CANVAS_COLS = 6;
const CELL_W = 164;
const CELL_H = 116;
const TILE_W = 148;
const TILE_H = 96;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
function defaultPos(i: number, cols: number): { x: number; y: number } {
  return { x: 12 + (i % cols) * CELL_W, y: 12 + Math.floor(i / cols) * CELL_H };
}

function HallCanvas({
  tables,
  arrange,
  onMoved,
  onResized,
  renderTile,
}: {
  tables: Table[];
  arrange: boolean;
  onMoved: (id: string, x: number, y: number) => void;
  onResized: (id: string, w: number, h: number) => void;
  renderTile: (t: Table) => ReactNode;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; offX: number; offY: number } | null>(null);
  const [live, setLive] = useState<{ id: string; x: number; y: number } | null>(null);
  // Ўлчам судраш (resize-даста): бошланғич сичқон + плитка ўлчами.
  const [rez, setRez] = useState<{ id: string; startX: number; startY: number; w0: number; h0: number } | null>(null);
  const [liveSize, setLiveSize] = useState<{ id: string; w: number; h: number } | null>(null);

  // Контейнер ўлчами (авто-грид фолбек + кўринадиган бутун майдонни судраш зонаси
  // қилиш учун). Қўлда қўйилган posX/posY эркин жойлашувни сақлайди; катта плитка
  // (w/h) банкет-зал/кабина учун.
  const [contW, setContW] = useState(CANVAS_COLS * CELL_W + 24);
  const [contH, setContH] = useState(0);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const update = () => {
      setContW(el.clientWidth);
      // Канвас юқорисидан экран тагигача — судраш зонаси шу баланд бўлсин.
      const top = el.getBoundingClientRect().top;
      setContH(Math.max(200, window.innerHeight - top - 8));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  const sizeOf = (t: Table) => {
    if (liveSize?.id === t.id) return { w: liveSize.w, h: liveSize.h };
    return { w: t.w ?? TILE_W, h: t.h ?? TILE_H };
  };
  const cols = Math.max(CANVAS_COLS, Math.floor((Math.max(contW, CANVAS_COLS * CELL_W + 24) - 24) / CELL_W));

  function posOf(t: Table, i: number): { x: number; y: number } {
    if (live?.id === t.id) return { x: live.x, y: live.y };
    if (t.posX != null && t.posY != null) return { x: t.posX, y: t.posY };
    return defaultPos(i, cols);
  }

  // Канвас = жойлаштирилган плиткалар + кўринадиган майдон; Жойлаштиришда пастга/
  // ўнгга қўшимча жой (директор столларни бўш ерга ҳам судраб қўйсин — «пастгача»).
  const pad = arrange ? 320 : 12;
  const maxRight = tables.reduce((m, t, i) => Math.max(m, posOf(t, i).x + sizeOf(t).w), 0);
  const maxBottom = tables.reduce((m, t, i) => Math.max(m, posOf(t, i).y + sizeOf(t).h), 0);
  const canvasW = Math.max(contW, maxRight + pad);
  const canvasH = Math.max(contH, maxBottom + pad, 180);

  function startDrag(e: ReactPointerEvent, t: Table, i: number) {
    if (!arrange || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const p = posOf(t, i);
    setDrag({ id: t.id, offX: e.clientX - rect.left - p.x, offY: e.clientY - rect.top - p.y });
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function startResize(e: ReactPointerEvent, t: Table) {
    if (!arrange) return;
    e.stopPropagation();
    const sz = sizeOf(t);
    setRez({ id: t.id, startX: e.clientX, startY: e.clientY, w0: sz.w, h0: sz.h });
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: ReactPointerEvent) {
    if (rez) {
      // 4px тўрга ёпишиб, минимал/максимал орасида (CloPOS каби катта плитка).
      const w = clamp(Math.round((rez.w0 + (e.clientX - rez.startX)) / 4) * 4, 80, 600);
      const h = clamp(Math.round((rez.h0 + (e.clientY - rez.startY)) / 4) * 4, 60, 400);
      setLiveSize({ id: rez.id, w, h });
      return;
    }
    if (!drag || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const dt = tables.find((t) => t.id === drag.id);
    const sz = dt ? sizeOf(dt) : { w: TILE_W, h: TILE_H };
    const x = clamp(e.clientX - rect.left - drag.offX, 0, canvasW - sz.w);
    const y = clamp(e.clientY - rect.top - drag.offY, 0, canvasH - sz.h);
    setLive({ id: drag.id, x, y });
  }
  function endDrag() {
    if (rez && liveSize) onResized(liveSize.id, liveSize.w, liveSize.h);
    if (drag && live) onMoved(live.id, Math.round(live.x), Math.round(live.y));
    setDrag(null);
    setLive(null);
    setRez(null);
    setLiveSize(null);
  }

  return (
    <div
      ref={canvasRef}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={`relative w-full overflow-x-auto rounded-xl transition-colors ${
        arrange ? "border border-dashed border-brand bg-brand-cream/30" : ""
      }`}
      style={{ height: canvasH, touchAction: arrange ? "none" : undefined }}
    >
      <div style={{ position: "relative", width: canvasW, height: canvasH }}>
        {tables.map((t, i) => {
          const p = posOf(t, i);
          const dragging = drag?.id === t.id;
          const resizing = rez?.id === t.id;
          const sz = sizeOf(t);
          const style: CSSProperties = {
            position: "absolute",
            left: p.x,
            top: p.y,
            width: sz.w,
            height: sz.h,
            zIndex: dragging || resizing ? 10 : 1,
            transition: dragging || resizing ? "none" : "left .12s, top .12s",
          };
          return (
            <div key={t.id} style={style}>
              {renderTile(t)}
              {arrange && (
                <>
                  <div
                    onPointerDown={(e) => startDrag(e, t, i)}
                    className="absolute inset-0 cursor-grab rounded-xl border-2 border-brand/50 bg-brand/5"
                    style={{ touchAction: "none", zIndex: 20 }}
                  />
                  {/* Ўлчам дастаси (ўнг-паст бурчак) — судраб катта/кичик қил */}
                  <div
                    onPointerDown={(e) => startResize(e, t)}
                    title="Ўлчамни ўзгартириш"
                    className="absolute -bottom-1.5 -right-1.5 grid h-6 w-6 cursor-nwse-resize place-items-center rounded-md border-2 border-white bg-brand-gold text-brand-ink shadow-md"
                    style={{ touchAction: "none", zIndex: 30 }}
                  >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                      <path d="M9.5 3v6.5H3M9.5 9.5L4.5 4.5" />
                    </svg>
                  </div>
                  {/* Ўлчам ёзуви судраш пайтида */}
                  {resizing && (
                    <div className="absolute left-1 top-1 z-30 rounded bg-brand-ink/85 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
                      {sz.w}×{sz.h}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TableTile({
  table,
  order,
  onClick,
  onLongPress,
  conflict,
  heatColor,
  fill,
  resChip,
}: {
  table: string;
  order: OpenOrder;
  onClick: () => void;
  onLongPress?: () => void;
  conflict?: boolean;
  heatColor?: string;
  fill?: boolean;
  // Банд стол устида кейинги бронь: официант «21:00 га банд» деб билсин.
  resChip?: { time: string; late: boolean };
}) {
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressed = useRef(false);

  const clearPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pressStart.current = null;
  };
  // Плитка (масалан заказ ёпилиб/кўчирилиб бошқа рендер турига ўтганда) ушлаб
  // турилган ҳолатда unmount бўлса — кутилаётган таймер ҳали жонли қолмасин.
  useEffect(() => clearPress, []);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!onLongPress) return;
    longPressed.current = false;
    pressStart.current = { x: e.clientX, y: e.clientY };
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      pressTimer.current = null;
      onLongPress();
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pressStart.current) return;
    const dx = e.clientX - pressStart.current.x;
    const dy = e.clientY - pressStart.current.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) clearPress();
  };
  const onPointerUp = () => clearPress();
  const onPointerLeave = () => clearPress();
  const handleClick = () => {
    if (longPressed.current) {
      longPressed.current = false; // long-press ишлаган — оддий tap'ни ўтказмаймиз
      return;
    }
    if (order.total === null) return; // официант: бошқанинг банд столи — очилмайди
    onClick();
  };

  return (
    <button
      onClick={handleClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      style={heatColor ? { backgroundColor: heatColor } : undefined}
      className={`flex ${fill ? "h-full w-full" : "min-h-[96px]"} flex-col items-center justify-center gap-0.5 rounded-[2px] p-1 text-center shadow-[2px_3px_0_0_rgba(0,0,0,.24)] transition hover:brightness-105 active:scale-[.98] motion-reduce:active:scale-100 ${
        heatColor
          ? "text-brand-ink"
          : conflict
            ? "bg-amber-600 text-white"
            : "bg-clopos-busy text-white"
      }`}
    >
      <div className="line-clamp-2 text-[13px] font-bold leading-tight">
        {conflict && !heatColor ? "⚠ " : ""}
        {table}
      </div>
      {order.waiter && !heatColor ? (
        <div className={`line-clamp-1 text-[10px] ${heatColor ? "text-brand-ink/60" : "text-clopos-busy-text"}`}>({order.waiter})</div>
      ) : order.guests ? (
        <div className={`text-[10px] ${heatColor ? "text-brand-ink/50" : "text-clopos-busy-text"}`}>
          <IUser className="inline h-3 w-3" /> {order.guests}
        </div>
      ) : null}
      <div>
        <div className={`flex items-center justify-center gap-1 text-[10px] tabular-nums ${heatColor ? "text-brand-ink" : "text-clopos-busy-text"}`}>
          {order.total === null ? <><ILock className="h-3 w-3" /> банд</> : `${fmt(order.total)} so'm`}
        </div>
        {(() => {
          // Хит-харита режимида ранг = 30 кунлик пул (вақт-эскалация аралашмасин).
          const mins = minsOpen(order.createdAt);
          const stale = !heatColor && mins >= TABLE_STALE_MIN;
          const warn = !heatColor && !stale && mins >= TABLE_WARN_MIN;
          if (stale || warn)
            return (
              <div
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  stale ? "animate-pulse bg-red-600 text-white motion-reduce:animate-none" : "bg-amber-400 text-brand-ink"
                }`}
                title={stale ? "Узоқ очиқ — тўламай кетган бўлиши мумкин" : "Узоқ ўтирибди"}
              >
                <IClock className="h-3 w-3" />
                {minsAgo(order.createdAt)}
              </div>
            );
          return (
            <div className={`flex items-center gap-1 text-[10px] ${heatColor ? "text-brand-ink/60" : "text-white/60"}`}>
              <IClock className="h-3 w-3" />
              {minsAgo(order.createdAt)}
            </div>
          );
        })()}
        {resChip && !heatColor && (
          <div
            className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
              resChip.late ? "bg-red-600 text-white" : "bg-clopos-gold text-clopos-gold-text"
            }`}
            title="Бу столга бронь бор"
          >
            🕐 {resChip.time} бронь
          </div>
        )}
      </div>
    </button>
  );
}

// ── Бронь рўйхати + яратиш (CloPOS «Бронирование» паритети) ──────────────────
// Кўриш — ҳамма; яратиш/бекор — менежер/директор. Аванс тақдири бекорда
// мажбурий танланади: қайтариш (касса чиқим) ёки куйдириш.
function ReservationsSheet({
  user,
  halls,
  tables,
  list,
  onClose,
  onChanged,
}: {
  user: SessionUser;
  halls: Hall[];
  tables: Table[];
  list: Reservation[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const canManage = ["director", "manager"].includes(user.role);
  const [view, setView] = useState<"list" | "new">("list");
  const [cancelFor, setCancelFor] = useState<Reservation | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isoDay = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayIso = isoDay(new Date());
  const [hallId, setHallId] = useState(halls[0]?.id ?? "");
  const [tableId, setTableId] = useState("");
  const [date, setDate] = useState(todayIso);
  const [time, setTime] = useState("19:00");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [guests, setGuests] = useState("");
  const [note, setNote] = useState("");
  const [depAmount, setDepAmount] = useState("");
  const [depMethod, setDepMethod] = useState<PayMethod>("cash");

  const hallTables = tables.filter((t) => t.hallId === hallId);
  const when = new Date(`${date}T${time || "00:00"}`);
  const dep = Math.round(Number(depAmount) || 0);

  async function save() {
    if (!tableId || !name.trim() || Number.isNaN(when.getTime())) return;
    setBusy(true);
    setErr(null);
    try {
      await trpc.pos.reservationCreate.mutate({
        tableId,
        name: name.trim(),
        phone: phone.trim() || undefined,
        guests: Math.round(Number(guests)) > 0 ? Math.round(Number(guests)) : undefined,
        reservedFor: when.toISOString(),
        note: note.trim() || undefined,
        depositAmount: dep,
        depositMethod: dep > 0 ? (depMethod as "cash" | "card" | "click" | "payme" | "humo") : undefined,
      });
      onChanged();
      setView("list");
      setName("");
      setPhone("");
      setGuests("");
      setNote("");
      setDepAmount("");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Хато");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(r: Reservation, resolution?: "refund" | "forfeit") {
    setBusy(true);
    setErr(null);
    try {
      await trpc.pos.reservationCancel.mutate({ id: r.id, resolution });
      setCancelFor(null);
      onChanged();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Хато");
    } finally {
      setBusy(false);
    }
  }

  // Кун бўйича гуруҳлаш: «Бугун — Жума» / «Эртага — Шанба» / «Жума, 24-июл».
  const groups: [string, Reservation[]][] = [];
  for (const r of [...list].sort((a, b) => a.reservedFor.localeCompare(b.reservedFor))) {
    const lbl = resDayLabel(new Date(r.reservedFor));
    const g = groups.find((x) => x[0] === lbl);
    if (g) g[1].push(r);
    else groups.push([lbl, [r]]);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88dvh] w-full max-w-2xl flex-col gap-3 rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-brand-ink">
            {view === "new" ? "🕐 Янги бронь" : `🕐 Бронлар — ${list.length}`}
          </h3>
          <div className="flex items-center gap-2">
            {view === "list" && canManage && (
              <button
                onClick={() => setView("new")}
                className="rounded-lg bg-clopos-gold px-3 py-1.5 text-sm font-semibold text-clopos-gold-text transition hover:brightness-105"
              >
                + Янги бронь
              </button>
            )}
            <button
              onClick={() => (view === "new" ? setView("list") : onClose())}
              className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 transition hover:bg-zinc-100"
            >
              {view === "new" ? "Орқага" : "Ёпиш"}
            </button>
          </div>
        </div>
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}

        {view === "new" ? (
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pb-1">
            <div className="grid grid-cols-2 gap-2">
              <select
                value={hallId}
                onChange={(e) => {
                  setHallId(e.target.value);
                  setTableId("");
                }}
                className="rounded-xl border border-brand-cream-soft px-3 py-2 text-sm outline-none focus:border-brand"
              >
                {halls.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
              <select
                value={tableId}
                onChange={(e) => setTableId(e.target.value)}
                className="rounded-xl border border-brand-cream-soft px-3 py-2 text-sm outline-none focus:border-brand"
              >
                <option value="">Стол танланг…</option>
                {hallTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={date}
                min={todayIso}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-xl border border-brand-cream-soft px-3 py-2 text-sm outline-none focus:border-brand"
              />
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-28 rounded-xl border border-brand-cream-soft px-3 py-2 text-sm outline-none focus:border-brand"
              />
              {!Number.isNaN(when.getTime()) && (
                <span className="text-sm font-bold text-brand">{WEEKDAY[when.getDay()]}</span>
              )}
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Мижоз исми *"
              className="w-full rounded-xl border border-brand-cream-soft px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Телефон"
                inputMode="tel"
                className="rounded-xl border border-brand-cream-soft px-3 py-2 text-sm outline-none focus:border-brand"
              />
              <input
                value={guests}
                onChange={(e) => setGuests(e.target.value.replace(/\D/g, ""))}
                placeholder="Меҳмон сони"
                inputMode="numeric"
                className="rounded-xl border border-brand-cream-soft px-3 py-2 text-sm outline-none focus:border-brand"
              />
            </div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Изоҳ (туғилган кун, торт…)"
              className="w-full rounded-xl border border-brand-cream-soft px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <div className="space-y-2 rounded-xl border border-brand-cream-soft p-3">
              <p className="text-xs font-semibold text-brand-ink">Аванс (банкет олди тўлов) — ихтиёрий</p>
              <input
                value={depAmount}
                onChange={(e) => setDepAmount(e.target.value.replace(/\D/g, ""))}
                placeholder="Сумма (so'm)"
                inputMode="numeric"
                className="w-full rounded-xl border border-brand-cream-soft px-3 py-2 text-sm tabular-nums outline-none focus:border-brand"
              />
              {dep > 0 && (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {(["cash", "card", "click", "payme", "humo"] as PayMethod[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setDepMethod(m)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                          depMethod === m
                            ? "bg-brand text-white"
                            : "border border-brand-cream-soft text-zinc-600 hover:bg-zinc-50"
                        }`}
                      >
                        {PAY_LABEL[m]}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] leading-snug text-zinc-500">
                    Аванс кассага киради ва чек ёпилишида −{fmt(dep)} бўлиб ҳисобга киради. Бекорда:
                    қайтариш (касса чиқим) ёки куйдириш.
                  </p>
                </>
              )}
            </div>
            <button
              onClick={() => void save()}
              disabled={busy || !tableId || !name.trim()}
              className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white transition hover:bg-brand-soft disabled:opacity-40"
            >
              {busy ? "…" : `Бронь қилиш${dep > 0 ? ` · аванс ${fmt(dep)}` : ""}`}
            </button>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            {groups.map(([lbl, rs]) => (
              <div key={lbl} className="space-y-1.5">
                <div className="px-1 text-[11px] font-bold uppercase tracking-wide text-zinc-400">{lbl}</div>
                {rs.map((r) => {
                  const late = resLate(r);
                  return (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 rounded-xl border border-brand-cream-soft px-3 py-2.5"
                    >
                      <div
                        className={`grid h-10 w-14 shrink-0 place-items-center rounded-lg text-sm font-bold tabular-nums ${
                          late ? "bg-red-100 text-red-700" : "bg-brand-cream/60 text-brand-ink"
                        }`}
                      >
                        {hhmm(new Date(r.reservedFor))}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-brand-ink">
                          {r.tableName}{" "}
                          <span className="font-normal text-zinc-400">
                            · {r.name}
                            {r.guests ? ` · ${r.guests} киши` : ""}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-500">
                          {r.phone && <span>📞 {r.phone}</span>}
                          {r.depositAmount > 0 && (
                            <span className="font-semibold text-emerald-700">
                              аванс {fmt(r.depositAmount)} · {PAY_LABEL[r.depositMethod ?? ""] ?? ""}
                            </span>
                          )}
                          {late && <span className="font-semibold text-red-600">келмади (30+ дақ)</span>}
                          {r.createdBy && <span>админ: {r.createdBy}</span>}
                          {r.note && <span className="truncate">{r.note}</span>}
                        </div>
                      </div>
                      {canManage && (
                        <button
                          onClick={() => (r.depositAmount > 0 ? setCancelFor(r) : void cancel(r))}
                          disabled={busy}
                          className="shrink-0 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-40"
                        >
                          Бекор
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {list.length === 0 && <p className="py-10 text-center text-sm text-zinc-400">Фаол бронь йўқ</p>}
          </div>
        )}

        {/* Авансли бронь бекори — пул тақдири мажбурий (Шерхон қоидаси: аудитли) */}
        {cancelFor && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
            onClick={() => setCancelFor(null)}
          >
            <div
              className="w-full max-w-sm space-y-2.5 rounded-2xl bg-white p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h4 className="text-base font-bold text-brand-ink">Бекор — аванс тақдири?</h4>
              <p className="text-sm text-zinc-600">
                {cancelFor.name} · аванс <b className="tabular-nums">{fmt(cancelFor.depositAmount)} so'm</b>
              </p>
              <button
                onClick={() => void cancel(cancelFor, "refund")}
                disabled={busy}
                className="w-full rounded-xl bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-soft disabled:opacity-40"
              >
                💵 Қайтарилди — кассадан нақд чиқим
              </button>
              <button
                onClick={() => void cancel(cancelFor, "forfeit")}
                disabled={busy}
                className="w-full rounded-xl border border-brand-cream-soft py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-40"
              >
                🔥 Куйди — келмади, пул ресторанда қолади
              </button>
              <button
                onClick={() => setCancelFor(null)}
                className="w-full rounded-xl py-2 text-sm text-zinc-400 transition hover:bg-zinc-50"
              >
                Орқага
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NewOrderSheet({
  halls,
  preset,
  onClose,
  onCreate,
}: {
  halls: Hall[];
  preset: { hall: Hall; table?: string };
  onClose: () => void;
  onCreate: (hallId: string, table: string | undefined, guests: number, saleType: string) => void;
}) {
  const [hallId, setHallId] = useState(preset.hall.id);
  const [table, setTable] = useState(preset.table ?? "");
  const [guests, setGuests] = useState(2);
  const [saleType, setSaleType] = useState<string>("dine_in");
  const [busy, setBusy] = useState(false);
  const fixedTable = preset.table !== undefined;

  async function go() {
    setBusy(true);
    try {
      onCreate(hallId, table || undefined, guests, saleType);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-brand-ink/40 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm space-y-4 rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-lg font-bold text-brand-ink">
            {fixedTable ? preset.table : "Янги заказ"}
          </h3>
          <p className="text-xs text-zinc-400">{preset.hall.name}</p>
        </div>

        {!fixedTable && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {halls.map((h) => (
                <button
                  key={h.id}
                  onClick={() => setHallId(h.id)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    hallId === h.id ? "bg-brand text-white" : "bg-brand-cream text-brand hover:bg-brand-cream-soft"
                  }`}
                >
                  {h.name}
                </button>
              ))}
            </div>
            <input
              value={table}
              onChange={(e) => setTable(e.target.value)}
              placeholder="Стол № (ихтиёрий)"
              className="w-full rounded-xl border border-brand-cream-soft px-3 py-2.5 text-sm outline-none focus:border-brand"
            />
          </>
        )}

        <div>
          <p className="mb-1.5 text-xs font-semibold text-zinc-500">Сотув тури</p>
          <div className="flex gap-1.5">
            {SALE_TYPES.map((st) => (
              <button
                key={st}
                onClick={() => setSaleType(st)}
                className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition ${
                  saleType === st ? "bg-brand text-white" : "bg-brand-cream text-brand hover:bg-brand-cream-soft"
                }`}
              >
                <SaleTypeLabel type={st} />
              </button>
            ))}
          </div>
          {saleType !== "dine_in" && (
            <p className="mt-1.5 text-[11px] text-zinc-400">Хизмат ҳақи олинмайди (кейин ёқса бўлади)</p>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold text-zinc-500">Меҳмонлар сони</p>
          <div className="flex items-center gap-3">
            <Step onClick={() => setGuests((g) => Math.max(1, g - 1))}>
              <IMinus className="h-4 w-4" />
            </Step>
            <span className="inline-flex items-center gap-1.5 text-2xl font-bold tabular-nums text-brand-ink">
              <IUsers className="h-5 w-5 text-brand" />
              {guests}
            </span>
            <Step onClick={() => setGuests((g) => Math.min(99, g + 1))}>
              <IPlus className="h-4 w-4" />
            </Step>
            <div className="ml-auto flex gap-1">
              {[2, 4, 6].map((n) => (
                <button
                  key={n}
                  onClick={() => setGuests(n)}
                  className={`h-9 w-9 rounded-lg text-sm font-semibold transition ${
                    guests === n ? "bg-brand text-white" : "bg-brand-cream text-brand hover:bg-brand-cream-soft"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-brand-cream-soft py-3 text-sm font-medium text-zinc-600"
          >
            Бекор
          </button>
          <button
            onClick={go}
            disabled={busy}
            className="flex-[2] rounded-xl bg-brand py-3 text-sm font-semibold text-white transition hover:bg-brand-deep disabled:opacity-50"
          >
            Очиш ва таом қўшиш
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ORDER SCREEN ────────────────────────────────────────────────────────────
function OrderView({
  id,
  user,
  onBack,
  onSwitch,
}: {
  id: string;
  user: SessionUser;
  onBack: () => void;
  onSwitch: (id: string) => void;
}) {
  const canComp = ["director", "manager", "cashier"].includes(user.role);
  const isManager = ["director", "manager"].includes(user.role); // reassignWaiter (manager+)
  const canDiscount = ["director", "manager"].includes(user.role);
  // Чек ёпиш = кассир иши (сервер ҳам cashierProcedure билан ҳимоялайди).
  const canClose = canComp;
  const [order, setOrder] = useState<Order | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [paying, setPaying] = useState(false);
  const [compReason, setCompReason] = useState("");
  const [showComp, setShowComp] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [showCash, setShowCash] = useState(false);
  // Payme/Click QR тўлов: усул танланса QR-экран, мижоз сканерлаб тўлайди.
  const [showQr, setShowQr] = useState<"payme" | "click" | null>(null);
  const [payCfg, setPayCfg] = useState<PayConfig | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgDraft, setCfgDraft] = useState({ paymeMerchantId: "", clickServiceId: "", clickMerchantId: "" });
  const [cfgBusy, setCfgBusy] = useState(false);
  const [cashGot, setCashGot] = useState("");
  const [paidCash, setPaidCash] = useState<number | null>(null);
  const [splits, setSplits] = useState<Record<string, string>>({});
  const [pendingDebt, setPendingDebt] = useState<{ method: PayMethod; amount: number }[] | null>(null);
  const [showDiscount, setShowDiscount] = useState(false);
  const [discountInput, setDiscountInput] = useState("");
  const [discountReasonInput, setDiscountReasonInput] = useState("");
  const [discount, setDiscount] = useState<{ amount: number; reason: string } | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeErr, setCloseErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [menuCat, setMenuCat] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [portionsOnly, setPortionsOnly] = useState(false); // CloPOS «Продажи по порциям»
  const [unsent, setUnsent] = useState(0);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [tickets, setTickets] = useState<{ id: string; createdAt: string; itemCount: number }[]>([]);
  const [showTickets, setShowTickets] = useState(false);
  // 📜 История чека (CloPOS) — заказ амаллари timeline (audit_log'дан).
  const [showHistory, setShowHistory] = useState(false);
  const [events, setEvents] = useState<
    { action: string; summary: string | null; actorName: string | null; createdAt: string }[]
  >([]);
  // 👨‍🍳 Официант алмаштириш + 🧹 чек тозалаш (CloPOS toolbar).
  const [showReassign, setShowReassign] = useState(false);
  const [staff, setStaff] = useState<{ id: string; name: string; role: string; active: boolean }[]>([]);
  const [reassignBusy, setReassignBusy] = useState(false);
  const [showClear, setShowClear] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  // 👤 Мижоз бириктириш + 🏷 чегирма (CloPOS ⋯ меню).
  const [showCustomer, setShowCustomer] = useState(false);
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState<{ id: string; name: string; phone: string | null }[]>([]);
  const [custBusy, setCustBusy] = useState(false);
  const [showDiscMenu, setShowDiscMenu] = useState(false);
  const [discAmount, setDiscAmount] = useState("");
  const [discReason, setDiscReason] = useState("");
  const [discBusy, setDiscBusy] = useState(false);
  const [discMode, setDiscMode] = useState<"sum" | "pct">("sum"); // чегирма: сумма ёки %
  // 👥 Гости сони + 🚚 тип продажи (CloPOS ⋯ меню).
  const [showGuests, setShowGuests] = useState(false);
  const [guestsInput, setGuestsInput] = useState("");
  const [guestsBusy, setGuestsBusy] = useState(false);
  const [showSaleType, setShowSaleType] = useState(false);
  const [showMore, setShowMore] = useState(false); // ⋯ қўшимча амаллар менюси (CloPOS)
  const [cancelling, setCancelling] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelErr, setCancelErr] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [online, setOnline] = useState(isOnline());
  const [syncErr, setSyncErr] = useState<string | null>(null);
  const [precheckBusy, setPrecheckBusy] = useState(false);
  const [precheckOk, setPrecheckOk] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [weighFor, setWeighFor] = useState<MenuItem | null>(null);
  // #3 Столда кўп заказ: бир столдаги очиқ оғайни-заказлар (шу заказдан ташқари).
  const [siblings, setSiblings] = useState<OpenOrder[]>([]);
  const [openCount, setOpenCount] = useState<number | null>(null);
  const [showSiblings, setShowSiblings] = useState(false);
  const [newBusy, setNewBusy] = useState(false);
  // #4 ⑂ Счёт-бўлиш.
  const [showSplitBill, setShowSplitBill] = useState(false);
  const [splitBusy, setSplitBusy] = useState(false);
  const [showStop, setShowStop] = useState(false);
  const [stopQ, setStopQ] = useState("");
  const [stopCat, setStopCat] = useState<string | null>(null);
  const [stopBusy, setStopBusy] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<{ productId: string; name: string } | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);

  const refresh = useCallback(async () => {
    const ov = await getOverlay(id);
    setSyncErr(ov?.error ?? null);
    const pending = await pendingOpsFor(id);
    const local = await deriveOrder(id);
    // Синхрон тугамагунча — локални кўрсатамиз (сервер stale бўлиши мумкин).
    if (pending > 0 && local) {
      setOrder(local as unknown as Order);
      setNote(local.note ?? "");
      setUnsent(await localUnsent(id));
      return;
    }
    try {
      const o = await trpc.pos.order.query({ id });
      setOrder(o);
      setNote(o.note ?? "");
      void syncBaseFromServer(o); // base snapshot → кейинги offline таҳрир fold бўлади
      trpc.pos.unsentCount.query({ orderId: id }).then((r) => setUnsent(r.unsent)).catch(() => {});
      trpc.pos.ticketsForOrder.query({ orderId: id }).then(setTickets).catch(() => {});
    } catch {
      // сервер етмади ёки NOT_FOUND (локал заказ ҳали синхронланмаган) → overlay'дан
      if (local) {
        setOrder(local as unknown as Order);
        setNote(local.note ?? "");
        setUnsent(await localUnsent(id));
      }
    }
  }, [id]);

  // Курс/подача: cart'да курс-чипини тап → 1→2→3→1 айланади (оптимистик).
  async function cycleCourse(itemId: string, cur: number) {
    const next = ((cur || 1) % 3) + 1;
    setOrder((o) =>
      o ? { ...o, items: o.items.map((it) => (it.id === itemId ? { ...it, course: next } : it)) } : o,
    );
    try {
      await trpc.pos.setItemCourse.mutate({ orderItemId: itemId, course: next });
    } catch {
      refresh();
    }
  }

  useEffect(() => {
    refresh();
    // Меню — ўзгармас; оффлайнда кэшдан кўринади (фаза 3 refCache).
    swr("pos.menu", () => trpc.pos.menu.query(), setMenu).catch(() => {});
    // Payme/Click merchant ID — QR ясаш учун (кэшланади).
    swr("settings.payment", () => trpc.settings.paymentConfig.query(), setPayCfg).catch(() => {});
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("outbox:drain", refresh); // синхрондан кейин серверга солиштир
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("outbox:drain", refresh);
    };
  }, [refresh]);

  async function add(productId: string, delta: number) {
    // 🔒 Блокланган заказ — ўзгартириб бўлмайди (сервер ҳам рад этади).
    if (order?.locked) {
      setSyncErr("Заказ блокланган — аввал 🔓 ечинг");
      return;
    }
    // Void кейси: кухняга юборилган таомни камайтириш (директор/менежер) — сабаб
    // сўралади ва журналга ёзилади (тешик №11/22). Online + камёб → тўғридан-тўғри.
    if (delta < 0 && tickets.length > 0 && ["director", "manager"].includes(user.role) && isOnline()) {
      const r = window.prompt("Кухняга юборилган таомни камайтириш сабаби?");
      if (r === null) return; // бекор
      try {
        await trpc.pos.addItem.mutate({
          orderId: id,
          productId,
          delta,
          opId: uuid(),
          voidReason: r.trim() || undefined,
        });
      } catch (e) {
        setSyncErr(e instanceof Error ? e.message : "Хато");
      }
      refresh();
      return;
    }
    // ном/нарх snapshot — менюдан ёки жорий қатордан (бўш 0-нархли қаторни олдини олиш).
    const m = menu.find((x) => x.id === productId);
    // Стоп-лист клиент-гарди: оффлайн оптимистик қўшишни ҳам тўсади
    // (сервер барибир рад этади, лекин официант дарҳол кўрсин).
    if (delta > 0 && m?.stopped) {
      setSyncErr(`«${m.name}» стопда — тугаган`);
      return;
    }
    const cur = order?.items.find((i) => i.productId === productId);
    if (!m && !cur) return;
    const name = m?.name ?? cur?.name ?? "";
    const price = m?.price ?? cur?.price ?? 0;
    const persisted = await enqueueAddItem(id, productId, delta, { name, price });
    if (!persisted) {
      // хотира йўқ — тўғридан-тўғри серверга (идемпотент opId)
      try {
        await trpc.pos.addItem.mutate({ orderId: id, productId, delta, opId: uuid() });
      } catch {
        setSyncErr("Таом қўшилмади");
        return;
      }
      refresh();
      vibrate([10]);
      return;
    }
    const local = await deriveOrder(id);
    if (local) setOrder(local as unknown as Order); // оптимистик
    await flush().catch(() => {});
    refresh();
    vibrate([10]);
  }

  async function saveNote() {
    await enqueueMeta(id, { note });
    await flush().catch(() => {});
  }

  async function sendToKitchen() {
    setSending(true);
    try {
      if (!isOnline() || (await pendingOpsFor(id)) > 0) {
        // Оффлайн/кутилаётган: навбатга — уланганда кухняга чиқади (чоп ҳам).
        await enqueueSendToKitchen(id);
        setUnsent(await localUnsent(id)); // send'дан кейин қўшилганлар қолади
        void flush();
        vibrate([20]);
        return;
      }
      // ticketId — retry replay икки марта кухняга юбормайди (мавжудни қайтаради).
      const t = await trpc.pos.sendToKitchen.mutate({ orderId: id, ticketId: uuid() });
      if (t.id) setTicketId(t.id);
      refresh();
      vibrate([20]);
    } finally {
      setSending(false);
    }
  }

  async function doCancel() {
    setCancelBusy(true);
    setCancelErr(null);
    try {
      await trpc.pos.cancel.mutate({ id });
      onBack();
    } catch (e: unknown) {
      setCancelErr(e instanceof Error ? e.message : "Хато");
    } finally {
      setCancelBusy(false);
    }
  }

  async function doPrecheck() {
    setPrecheckBusy(true);
    try {
      await trpc.pos.precheck.mutate({ orderId: id });
      vibrate([10]);
      setPrecheckOk(true);
      setTimeout(() => setPrecheckOk(false), 2000);
    } catch (e: unknown) {
      setSyncErr(e instanceof Error ? e.message : "Пречек босилмади");
    } finally {
      setPrecheckBusy(false);
    }
  }

  // 🔒 Заказ-блок: блокланганда таом қўшиб/ўзгартириб бўлмайди (сервер ҳам рад
  // этади). Официант хатодан ҳимоя; кассир/менежер ечади.
  async function toggleLock() {
    if (!order) return;
    const next = !order.locked;
    setLockBusy(true);
    try {
      await trpc.pos.setLock.mutate({ orderId: id, locked: next });
      vibrate([10]);
      setOrder((o) => (o ? { ...o, locked: next } : o));
    } catch (e) {
      setSyncErr(e instanceof Error ? e.message : "Блок ўзгармади");
    } finally {
      setLockBusy(false);
    }
  }

  // 🍽 Хизмат ҳақини кечириш/тиклаш (CloPOS «Удалить плату за обслуживание»).
  // Кечирилса сервис 0 бўлади — олиб кетиш/шикоят/ходим учун.
  const [serviceBusy, setServiceBusy] = useState(false);
  async function toggleService() {
    if (!order) return;
    const next = !order.serviceWaived;
    setServiceBusy(true);
    try {
      const r = await trpc.pos.setService.mutate({ orderId: id, waived: next });
      // Overlay head ҳам янгилансин — pending op бор пайтда derived stale бўлмасин.
      await patchOverlayHead(id, { serviceWaived: next, servicePct: r.pct });
      vibrate([10]);
      await refresh();
    } catch (e) {
      setSyncErr(e instanceof Error ? e.message : "Хизмат ҳақи ўзгармади");
    } finally {
      setServiceBusy(false);
    }
  }

  // Сотув турини ўзгартириш (зал/доставка/собой).
  async function changeSaleType(st: string) {
    if (!order || order.saleType === st) return;
    try {
      const r = await trpc.pos.setSaleType.mutate({ orderId: id, saleType: st as "dine_in" | "delivery" | "takeaway" });
      await patchOverlayHead(id, { saleType: st, serviceWaived: st !== "dine_in", servicePct: r.pct });
      vibrate([10]);
      await refresh();
    } catch (e) {
      setSyncErr(e instanceof Error ? e.message : "Сотув тури ўзгармади");
    }
  }

  // ⚖️ Оғирлик билан таом қўшиш (гўшт кг): вазн киритилади → сервер чизиқ нархини
  // (кг-нарх × грамм/1000) ҳисоблайди. Ҳар вазнлаш алоҳида чизиқ.
  async function addWeighed(grams: number) {
    if (!weighFor) return;
    const m = weighFor;
    setWeighFor(null);
    try {
      await trpc.pos.addWeighed.mutate({ orderId: id, productId: m.id, grams, opId: uuid() });
      vibrate([10]);
      await refresh();
    } catch (e) {
      setSyncErr(e instanceof Error ? e.message : "Вазн қўшилмади");
    }
  }

  // #3 Столда кўп заказ: шу столнинг бошқа очиқ заказлари (dropdown учун).
  const tno = order?.tableNo ?? null;
  const hid = order?.hallId ?? null;
  const loadSiblings = useCallback(async () => {
    try {
      const all = await trpc.pos.openOrders.query();
      setOpenCount(all.length); // CloPOS-бар «Чеки N»
      if (!tno || !hid) {
        setSiblings([]);
        return;
      }
      setSiblings(all.filter((o) => o.id !== id && o.hallId === hid && o.tableNo === tno));
    } catch {
      /* оффлайн — жим */
    }
  }, [id, hid, tno]);
  useEffect(() => {
    loadSiblings();
  }, [loadSiblings]);

  // #3 «+ Янги заказ»: шу столга яна бир очиқ заказ (CloPOS «Новый заказ»). Online.
  async function createSibling() {
    if (!order || newBusy) return;
    setNewBusy(true);
    try {
      const nid = uuid();
      await trpc.pos.create.mutate({
        id: nid,
        hallId: order.hallId,
        tableNo: order.tableNo ?? undefined,
      });
      vibrate([10]);
      setShowSiblings(false);
      onSwitch(nid);
    } catch (e) {
      setSyncErr(e instanceof Error ? e.message : "Янги заказ очилмади");
    } finally {
      setNewBusy(false);
    }
  }

  // #4 ⑂ Счётни бўлиш: танланган таомлар ЯНГИ заказга кўчади → уни тўлашга ўтамиз.
  async function doSplit(moves: { orderItemId: string; qty: number }[]) {
    if (!order || splitBusy || moves.length === 0) return;
    setSplitBusy(true);
    try {
      const res = await trpc.pos.splitOrder.mutate({ sourceId: id, items: moves, newId: uuid() });
      vibrate([30, 40, 30]);
      setShowSplitBill(false);
      onSwitch(res.id);
    } catch (e) {
      setSyncErr(e instanceof Error ? e.message : "Счёт бўлинмади");
    } finally {
      setSplitBusy(false);
    }
  }

  async function submitClose(payments: { method: PayMethod; amount: number }[], customerId?: string) {
    if (!order || closing) return;
    setCloseErr(null);
    setClosing(true);
    try {
      await trpc.pos.close.mutate({
        id,
        payments,
        ...(customerId ? { customerId } : {}),
        ...(discount ? { discount } : {}),
      });
      cancelPay();
      refresh();
      vibrate([30, 50, 30]);
    } catch (e: unknown) {
      setCloseErr(e instanceof Error ? e.message : "Хато");
    } finally {
      setClosing(false);
    }
  }

  function pay(method: PayMethod) {
    if (!order || closing) return;
    const payments = [{ method, amount: payTotal }];
    // Қарз танланса — аввал мижоз танлаш (МАЖБУРИЙ).
    if (method === "debt") { setPendingDebt(payments); return; }
    submitClose(payments);
  }

  function paySplit() {
    if (!order || closing) return;
    const payments = (Object.entries(splits) as [PayMethod, string][])
      .map(([method, v]) => ({ method, amount: Math.round(Number(v) || 0) }))
      .filter((p) => p.amount > 0);
    if (payments.some((p) => p.method === "debt")) { setPendingDebt(payments); return; }
    submitClose(payments);
  }

  function applyDiscount() {
    const amt = Math.round(Number(discountInput) || 0);
    if (!order || amt <= 0 || amt > order.total || !discountReasonInput.trim()) return;
    setDiscount({ amount: amt, reason: discountReasonInput.trim() });
    setShowDiscount(false);
  }

  async function payComp() {
    if (!compReason.trim() || closing) return;
    setCloseErr(null);
    setClosing(true);
    try {
      await trpc.pos.close.mutate({ id, comp: { reason: compReason.trim() } });
      setShowComp(false);
      setPaying(false);
      refresh();
    } catch (e: unknown) {
      setCloseErr(e instanceof Error ? e.message : "Хато");
    } finally {
      setClosing(false);
    }
  }

  // QR-экранни очиш ва мижоз QR'ини (deep-link'дан) ясаш. Барча hook'лар эрта-
  // return'дан ОЛДИН туриши шарт (Rules of Hooks) — суммани ичида ҳисоблаймиз.
  useEffect(() => {
    if (!showQr) { setQrDataUrl(null); return; }
    const amount = order ? order.total - (discount?.amount ?? 0) : 0;
    const ref = String(order?.checkNo ?? id);
    const url = payCfg && amount > 0 ? payUrl(showQr, payCfg, amount, ref) : null;
    if (!url) { setQrDataUrl(null); return; }
    let alive = true;
    QRCode.toDataURL(url, { width: 240, margin: 1 })
      .then((d) => { if (alive) setQrDataUrl(d); })
      .catch(() => { if (alive) setQrDataUrl(null); });
    return () => { alive = false; };
  }, [showQr, payCfg, order?.total, discount?.amount, order?.checkNo, id]);

  if (ticketId) return <KitchenTicketView ticketId={ticketId} onBack={() => setTicketId(null)} />;
  if (!order) return <Spin />;
  if (order.status === "closed") return <Chek order={order} cashReceived={paidCash} onBack={onBack} />;

  const menuCats = [...new Set(menu.map((m) => m.category).filter((c): c is string => !!c))];
  const filtered = menu
    .filter((m) => !menuCat || m.category === menuCat)
    .filter((m) => !portionsOnly || m.soldByWeight)
    .filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()));
  const shown = filtered.slice(0, 120);
  const itemCount = order.items.reduce((s, it) => s + it.qty, 0);
  const empty = order.items.length === 0;
  const stopList = menu
    .filter((m) => !stopCat || m.category === stopCat)
    .filter((m) => !stopQ || m.name.toLowerCase().includes(stopQ.toLowerCase()))
    .sort((a, b) => Number(b.stopped) - Number(a.stopped) || a.name.localeCompare(b.name, "ru"))
    .slice(0, 200);
  const stoppedCount = menu.filter((m) => m.stopped).length;

  function openItemNote(productId: string, name: string, current: string) {
    setNoteDraft(current);
    setNoteFor({ productId, name });
  }

  async function saveItemNote() {
    if (!noteFor) return;
    setNoteBusy(true);
    try {
      await trpc.pos.setItemNote.mutate({
        orderId: id,
        productId: noteFor.productId,
        note: noteDraft.trim(),
      });
      setOrder((o) =>
        o
          ? {
              ...o,
              items: o.items.map((x) =>
                x.productId === noteFor.productId ? { ...x, note: noteDraft.trim() || null } : x,
              ),
            }
          : o,
      );
      setNoteFor(null);
    } catch (e) {
      setSyncErr(e instanceof Error ? e.message : "Изоҳ сақланмади");
    } finally {
      setNoteBusy(false);
    }
  }

  async function toggleStop(pId: string, next: boolean) {
    setStopBusy(pId);
    try {
      await trpc.catalog.products.setStopped.mutate({ id: pId, stopped: next });
      setMenu((mm) => mm.map((x) => (x.id === pId ? { ...x, stopped: next } : x)));
    } catch (e) {
      setSyncErr(e instanceof Error ? e.message : "Стоп сақланмади");
    } finally {
      setStopBusy(null);
    }
  }

  async function saveCfg() {
    setCfgBusy(true);
    try {
      await trpc.settings.setPaymentConfig.mutate(cfgDraft);
      setPayCfg({ ...cfgDraft });
      setCfgOpen(false);
    } catch (e) {
      setCloseErr(e instanceof Error ? e.message : "Сақланмади");
    } finally {
      setCfgBusy(false);
    }
  }

  function cancelPay() {
    setPaying(false);
    setShowComp(false);
    setShowSplit(false);
    setShowQr(null);
    setCfgOpen(false);
    setSplits({});
    setPendingDebt(null);
    setShowDiscount(false);
    setDiscount(null);
    setDiscountInput("");
    setDiscountReasonInput("");
    setCloseErr(null);
  }

  // Аванс (бронь) чекнинг бир қисмини қоплайди — кассир фақат қолганини олади.
  // Сервер ёпишда 'avans' қаторини ўзи ёзади ва тенгликни қайта текширади.
  const deposit = order.deposit ?? 0;
  const payTotal = order.total - (discount?.amount ?? 0) - deposit;
  const cashGotNum = Math.round(Number(cashGot) || 0);
  const cashChange = cashGotNum - payTotal;
  const cashQuick = [
    ...new Set([
      payTotal,
      Math.ceil(payTotal / 10000) * 10000,
      Math.ceil(payTotal / 50000) * 50000,
      Math.ceil(payTotal / 100000) * 100000,
    ]),
  ]
    .filter((v) => v >= payTotal)
    .slice(0, 4);
  const splitSum = (Object.values(splits) as string[]).reduce(
    (s, v) => s + Math.round(Number(v) || 0),
    0,
  );

  return (
    <div className="flex gap-2 pb-24 lg:min-h-0 lg:flex-1 lg:gap-0 lg:pb-0">
      {/* ── CloPOS-услуб чап амал-рельси (тўқ, оқ иконкалар) — десктопда заказ
          панелига туташади (gap-0, бурчак тўғри) ────────────────────────────── */}
      <nav className="sticky top-24 flex h-fit w-11 shrink-0 flex-col items-center gap-0.5 self-start rounded-r-lg border-r border-brand-deep bg-clopos-rail py-2.5 lg:h-auto lg:self-stretch lg:rounded-r-none lg:border-r-0">
        {/* ══ CloPOS тартиби: клиент · скидка · хизмат · изоҳ · история · split ══ */}
        {/* 👤 Мижоз бириктириш (CloPOS «Добавить клиента») — чап панель юқорисида */}
        <button
          onClick={() => {
            setShowCustomer(true);
            setCustQuery("");
            trpc.finance.customers.search.query({}).then(setCustResults).catch(() => {});
          }}
          disabled={!online || order.locked}
          title="Мижоз бириктириш"
          className="grid h-10 w-9 place-items-center rounded-md text-clopos-icon transition hover:bg-brand-deep hover:text-white disabled:opacity-30"
        >
          <ToolIcon k="user" />
        </button>
        {/* 🏷 Скидка (CloPOS «Скидка») — фақат manager+ */}
        {isManager && (
          <button
            onClick={() => {
              setShowDiscMenu(true);
              setDiscAmount("");
              setDiscReason("");
            }}
            disabled={!online || order.locked || order.items.length === 0}
            title="Чегирма"
            className="grid h-10 w-9 place-items-center rounded-md text-clopos-icon transition hover:bg-brand-deep hover:text-white disabled:opacity-30"
          >
            <ToolIcon k="percent" />
          </button>
        )}
        {/* 🍽 Хизмат ҳақи */}
        {canComp && (order.servicePct > 0 || order.serviceWaived) && (
          <button
            onClick={toggleService}
            disabled={serviceBusy || !online || order.locked}
            title={order.serviceWaived ? "Хизмат ҳақини тиклаш" : "Хизмат ҳақини кечириш"}
            className={`grid h-10 w-9 place-items-center rounded-md transition disabled:opacity-30 ${
              order.serviceWaived ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "text-clopos-icon hover:bg-brand-deep hover:text-white"
            }`}
          >
            <IPlate className="h-6 w-6" />
          </button>
        )}
        {/* 💬 Чекка изоҳ (комментарий) */}
        <button
          onClick={() => setNoteOpen((v) => !v)}
          title="Чекка изоҳ"
          className="grid h-10 w-9 place-items-center rounded-md text-clopos-icon transition hover:bg-brand-deep hover:text-white"
        >
          <ToolIcon k="chat" />
        </button>
        {/* 🕐 История чека — амаллар тарихи (CloPOS «История чека») */}
        <button
          onClick={() => {
            setShowHistory(true);
            trpc.pos.orderEvents.query({ orderId: id }).then(setEvents).catch(() => {});
          }}
          title="История чека — амаллар тарихи"
          className="grid h-10 w-9 place-items-center rounded-md text-clopos-icon transition hover:bg-brand-deep hover:text-white"
        >
          <ToolIcon k="clock" />
        </button>
        {/* ⤴ Счётни бўлиш (разделить) */}
        {order.items.reduce((s, i) => s + i.qty, 0) >= 2 && !order.locked && (
          <button
            onClick={() => setShowSplitBill(true)}
            disabled={!online}
            title="Счётни бўлиш — таомларни алоҳида чекка"
            className="grid h-10 w-9 place-items-center rounded-md text-clopos-icon transition hover:bg-brand-deep hover:text-white disabled:opacity-30"
          >
            <ToolIcon k="split" />
          </button>
        )}
        <div className="my-1 h-px w-6 bg-clopos-line" />
        {/* ══ Паст гуруҳ: тўлов · блок · пречек · ⋯ ══ */}
        {/* 💳 Тўлов */}
        {canClose && (
          <button
            onClick={() => order.items.length > 0 && setPaying(true)}
            disabled={order.items.length === 0 || !online}
            title="Тўлов — чекни ёпиш"
            className="grid h-10 w-9 place-items-center rounded-md text-clopos-icon transition hover:bg-brand-deep hover:text-white disabled:opacity-30"
          >
            <ToolIcon k="card" />
          </button>
        )}
        {/* 🔒 Блок */}
        {canComp && (
          <button
            onClick={toggleLock}
            disabled={lockBusy || !online}
            title={order.locked ? "Блокни ечиш" : "Заказни блоклаш"}
            className={`grid h-10 w-9 place-items-center rounded-md transition disabled:opacity-30 ${
              order.locked ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "text-clopos-icon hover:bg-brand-deep hover:text-white"
            }`}
          >
            <ToolIcon k="lock" />
          </button>
        )}
        {/* 🖨 Пречек */}
        <button
          onClick={doPrecheck}
          disabled={precheckBusy}
          title="Пречек чоп этиш"
          className={`grid h-10 w-9 place-items-center rounded-md transition disabled:opacity-30 ${
            precheckOk ? "bg-emerald-100 text-emerald-700" : "text-clopos-icon hover:bg-brand-deep hover:text-white"
          }`}
        >
          {precheckOk ? <ICheck className="h-5 w-5" /> : <ToolIcon k="printer" />}
        </button>
        {/* ⋯ Қўшимча амаллар (CloPOS — официант · тозалаш · стол · тикет · стоп · бекор) */}
        <button
          onClick={() => setShowMore(true)}
          title="Қўшимча амаллар"
          className="grid h-10 w-9 place-items-center rounded-md text-clopos-icon transition hover:bg-brand-deep hover:text-white"
        >
          <ToolIcon k="more" />
        </button>
      </nav>

      {/* ── Асосий устун (header + меню + cart + модаллар) ──────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 lg:min-h-0">
        {/* ── CloPOS сплит-бар (эга: каттароқ — олинган header ўрнини эгаллади):
            чапда тўқ панел (стол · таймер · #чек · ⌄), ўнгда Новый заказ · Чеки
            · тур · исм · соат · wifi ──── */}
        <div className="flex h-12 items-stretch overflow-hidden">
          <div className="flex w-full min-w-0 items-center gap-2.5 bg-clopos-dark px-2.5 lg:w-[490px] lg:shrink-0">
            <button
              onClick={onBack}
              title="Залларга қайтиш"
              className="grid h-6 w-6 shrink-0 place-items-center text-[#cfcde4] transition hover:text-white"
            >
              <IBack className="h-4 w-4" />
            </button>
            <span className="truncate text-[13px] font-bold text-white">{order.tableNo ?? order.hall ?? "Заказ"}</span>
            <span className="flex-1 text-center text-[12px] tabular-nums text-[#b9b7d2]">
              {minsAgo(order.createdAt)}
            </span>
            <span className="shrink-0 text-[12px] text-[#b9b7d2]">#{order.checkNo}</span>
            <button
              onClick={() => siblings.length > 0 && setShowSiblings(true)}
              disabled={siblings.length === 0}
              title="Шу столдаги заказлар орасида ўтиш"
              className="grid h-5 w-[26px] shrink-0 place-items-center rounded-[3px] bg-clopos-chip transition enabled:hover:brightness-125 disabled:opacity-50"
            >
              <IChevron className="h-3 w-3 text-white" />
            </button>
          </div>
          <div className="hidden flex-1 items-center justify-end gap-4 bg-clopos-dark pr-3.5 lg:flex">
            {order.tableNo && (
              <button
                onClick={createSibling}
                disabled={!online || newBusy}
                className="flex h-6 items-center gap-1.5 rounded-[3px] bg-clopos-gold px-3 shadow-[0_1px_0_rgba(0,0,0,.2)] transition hover:brightness-105 disabled:opacity-40"
              >
                <span className="text-[15px] font-bold leading-none text-clopos-gold-text">+</span>
                <span className="whitespace-nowrap text-[13px] font-semibold text-clopos-gold-text">Новый заказ</span>
              </button>
            )}
            {openCount !== null && (
              <span className="flex cursor-default items-center gap-1.5">
                <span className="whitespace-nowrap text-[13px] text-white">Чеки</span>
                <span className="grid h-[17px] w-[17px] place-items-center rounded-full border-[1.5px] border-white bg-clopos-badge text-[10px] font-bold text-clopos-gold-text">
                  {openCount}
                </span>
              </span>
            )}
            {/* Сотув тури — кассир+ айлантиради (сервис %га тегади), бошқаларга ярлиқ */}
            {canComp ? (
              <button
                onClick={() => {
                  const i = SALE_TYPES.indexOf(order.saleType as (typeof SALE_TYPES)[number]);
                  changeSaleType(SALE_TYPES[(i + 1) % SALE_TYPES.length]!);
                }}
                disabled={!online || order.locked}
                title="Сотув турини ўзгартириш (зал/доставка/собой)"
                className={`flex h-6 items-center rounded-[3px] px-2 text-[13px] font-semibold transition disabled:opacity-40 ${
                  order.saleType === "dine_in" ? "text-white/75 hover:text-white" : "bg-brand-gold text-brand-ink"
                }`}
              >
                <SaleTypeLabel type={order.saleType} className="h-3.5 w-3.5" />
              </button>
            ) : (
              <span
                className={`flex h-6 items-center rounded-[3px] px-2 text-[13px] font-semibold ${
                  order.saleType === "dine_in" ? "text-white/75" : "bg-brand-gold text-brand-ink"
                }`}
              >
                <SaleTypeLabel type={order.saleType} className="h-3.5 w-3.5" />
              </span>
            )}
            <span className="hidden items-center gap-1.5 text-[13px] text-white xl:flex">
              <ILogout className="h-4 w-4" /> {user.name}
            </span>
            <FloorClock />
            <span title={online ? "Алоқа бор" : "Оффлайн"}>
              {online ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="3" cy="13" r="1.6" fill="#4CAF50" />
                  <path d="M2 9a5 5 0 0 1 5 5M2 5a9 9 0 0 1 9 9" stroke="#4CAF50" strokeWidth="2" fill="none" />
                </svg>
              ) : (
                <IWifiOff className="h-4 w-4 text-red-400" />
              )}
            </span>
          </div>
        </div>

      {moving && (
        <MoveSheet
          onClose={() => setMoving(false)}
          onMove={(hall, tableNo) => {
            // Оптимистик: кўчириш — оддий присвоение (сервер ҳисоблашсиз), шунинг
            // учун натижани дарҳол кўрсатиш мумкин (пул/ҳисоб эмас).
            setOrder((o) => (o ? { ...o, hall: hall.name, hallId: hall.id, tableNo: tableNo ?? null, servicePct: hall.servicePct } : o));
            setMoving(false);
            onBack();
            trpc.pos.moveTable
              .mutate({ id, hallId: hall.id, tableNo })
              .then(() => vibrate([15]))
              .catch((e: unknown) => {
                alert(e instanceof Error ? e.message : "Кўчириш бажарилмади");
                console.error("moveTable failed", e);
              });
          }}
        />
      )}

      {weighFor && (
        <WeighSheet
          name={weighFor.name}
          pricePerKg={weighFor.price}
          onClose={() => setWeighFor(null)}
          onWeigh={addWeighed}
        />
      )}

      {/* #3 Оғайни-заказлар свитчери */}
      {showSiblings && (
        <SiblingsSheet
          current={order}
          siblings={siblings}
          busy={newBusy}
          online={online}
          onClose={() => setShowSiblings(false)}
          onPick={(oid) => {
            setShowSiblings(false);
            onSwitch(oid);
          }}
          onNew={createSibling}
        />
      )}

      {/* #4 ⑂ Счёт-бўлиш */}
      {showSplitBill && (
        <SplitSheet
          order={order}
          busy={splitBusy}
          onClose={() => setShowSplitBill(false)}
          onSplit={doSplit}
        />
      )}

      {syncErr && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700"><IWarn className="h-4 w-4 shrink-0" /> {syncErr} — синхронизация тўхтади.</div>
      )}
      {!online && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <IWifiOff className="h-4 w-4 shrink-0" /> Оффлайн — таом қўшиш ва кухняга юбориш ишлайди, уланганда синхрон. Тўлов уланганда.
        </div>
      )}

      {cancelling && (
        <div className="space-y-2 rounded-2xl border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-semibold text-red-700">Заказни бекор қиласизми?</p>
          <p className="text-xs text-red-600">
            Кухняга юборилган таом бўлса, йўқотиш сифатида ёзилади ва фақат директор/менежер бажара олади.
          </p>
          {cancelErr && <p className="text-xs text-red-700">{cancelErr}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => setCancelling(false)}
              disabled={cancelBusy}
              className="flex-1 rounded-xl border border-red-200 py-2 text-sm font-medium text-zinc-600 disabled:opacity-40"
            >
              Йўқ
            </button>
            <button
              onClick={doCancel}
              disabled={cancelBusy}
              className="flex-1 rounded-xl bg-red-600 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Ҳа, бекор қилиш
            </button>
          </div>
        </div>
      )}

      {/* Меҳмон+Изоҳ header олиб ташланди (эга: уртадаги бўш банд). Изоҳ рельс
          чат-иконкасида (setNoteOpen), меҳмон сони заказ очишда/флоор амалларида. */}
      {noteOpen && (
        <input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            saveNote();
            setNoteOpen(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          placeholder="Изоҳ — масалан: аччиқ эмас, музсиз..."
          className="w-full rounded-xl border border-brand-cream-soft px-3 py-2.5 text-sm outline-none focus:border-brand"
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:-mt-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[449px_minmax(0,1fr)] lg:gap-0 lg:items-stretch">
        {/* MENU (CloPOS: ЎНГДА, фон #F0F1F4, handoff-макет) */}
        <section className="order-1 min-w-0 space-y-2.5 border-clopos-line bg-clopos-menu p-2.5 lg:order-2 lg:overflow-y-auto lg:border-l">
          {/* CloPOS тулбар: уй-плитка чапда, ўнгда қидирув · порция · ⚙ · ☆ · стоп · сетка */}
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => { setMenuCat(null); setQ(""); setSearchOpen(false); setPortionsOnly(false); }}
              title="Категорияларга қайтиш"
              className="grid h-[34px] w-[65px] shrink-0 place-items-center rounded-[4px] rounded-bl-none bg-white shadow-[0_1px_2px_rgba(0,0,0,.08)] transition hover:brightness-95"
            >
              <svg width="17" height="16" viewBox="0 0 17 16" fill="none" stroke="#4A4A55" strokeWidth="1.5" aria-hidden="true">
                <path d="M1.5 7.5L8.5 1l7 6.5M3.5 6v8.5h10V6" />
              </svg>
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setSearchOpen((v) => !v); if (searchOpen) setQ(""); }}
                title="Таом қидириш"
                className={`grid h-[30px] w-8 place-items-center rounded-[4px] shadow-[0_1px_2px_rgba(0,0,0,.08)] transition ${searchOpen || q ? "bg-clopos-bar text-white" : "bg-white text-[#63637A] hover:brightness-95"}`}
              >
                <ISearch className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setPortionsOnly((v) => !v)}
                title="Оғирлик билан сотиладиган таомлар"
                className={`flex h-[30px] items-center gap-1.5 rounded-[4px] px-3 shadow-[0_1px_2px_rgba(0,0,0,.08)] transition ${portionsOnly ? "bg-clopos-bar text-white" : "bg-white text-[#4A4A55] hover:brightness-95"}`}
              >
                <IScale className="h-3.5 w-3.5" />
                <span className="whitespace-nowrap text-[11px]">Продажи по порциям</span>
              </button>
              {canComp && (
                <button
                  onClick={() => setShowStop(true)}
                  disabled={!online}
                  title="Стоп-лист — тугаган таомлар"
                  className="relative grid h-[30px] w-8 place-items-center rounded-[4px] bg-white text-[#7A5FC7] shadow-[0_1px_2px_rgba(0,0,0,.08)] transition hover:brightness-95 disabled:opacity-40"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                    <circle cx="8" cy="8" r="6.5" />
                    <path d="M6.3 5.5v5M9.7 5.5v5" strokeWidth="1.6" />
                  </svg>
                  {stoppedCount > 0 && (
                    <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                      {stoppedCount}
                    </span>
                  )}
                </button>
              )}
              <button
                onClick={() => { setMenuCat(null); setQ(""); }}
                title="Категория-сетка"
                className="grid h-[30px] w-8 place-items-center rounded-[4px] bg-white shadow-[0_1px_2px_rgba(0,0,0,.08)] transition hover:brightness-95"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="#63637A" aria-hidden="true">
                  <rect x="0" y="0" width="6" height="6" rx="1" />
                  <rect x="8" y="0" width="6" height="6" rx="1" />
                  <rect x="0" y="8" width="6" height="6" rx="1" />
                  <rect x="8" y="8" width="6" height="6" rx="1" />
                </svg>
              </button>
            </div>
          </div>
          {(searchOpen || q) && (
            <div className="flex items-center gap-2 rounded-[4px] bg-white px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,.08)]">
              <ISearch className="h-4 w-4 shrink-0 text-zinc-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Таом қидириш..."
                className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-400"
              />
            </div>
          )}
          {/* CloPOS drill-down: қидирув/фильтрсиз — 5× КАТЕГОРИЯ-СЕТКА (бирюза,
              handoff-макет); категория/қидирув танланса — таомлар. */}
          {!q && !menuCat && !portionsOnly ? (
            <div className="grid grid-cols-2 gap-[7px] sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {menuCats.map((c) => (
                <button
                  key={c}
                  onClick={() => setMenuCat(c)}
                  className={`flex min-h-[52px] items-center justify-center rounded-[2px] px-2 py-2.5 text-center text-[14px] font-normal leading-[1.3] text-white shadow-[2px_3px_0_0_rgba(0,0,0,.22)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold ${
                    /non\s*choy/i.test(c) ? "bg-clopos-cat-alt" : "bg-clopos-cat"
                  }`}
                >
                  <span className="line-clamp-2">{c}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2.5">
              {/* Орқага категория-сеткага + жорий контекст */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setMenuCat(null); setQ(""); setPortionsOnly(false); }}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-[3px] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#4A4A55] shadow-[0_1px_2px_rgba(0,0,0,.08)] transition hover:brightness-95"
                >
                  <IBack className="h-3.5 w-3.5" /> Категориялар
                </button>
                {menuCat && (
                  <span className="inline-flex items-center gap-1.5 truncate rounded-[3px] bg-clopos-cat px-3 py-1.5 text-[13px] font-bold text-white">
                    {menuCat} <span className="font-semibold text-white/75">· {filtered.length}</span>
                  </span>
                )}
                {portionsOnly && !menuCat && (
                  <span className="inline-flex items-center gap-1 truncate rounded-[3px] bg-clopos-bar px-3 py-1.5 text-[13px] font-semibold text-white">
                    <IScale className="h-3.5 w-3.5" /> Порциялар · {filtered.length}
                  </span>
                )}
                {q && (
                  <span className="truncate text-[13px] text-zinc-500">«{q}» — {filtered.length} та</span>
                )}
              </div>
              {shown.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-brand-cream-soft bg-white/60">
                  <EmptyLemon title="Топилмади" hint="Қидирув ёки категорияни ўзгартиринг" />
                </div>
              ) : (
                // CloPOS-услуб таом ГРИДИ (dc.html v2) — 4 устун карточка, олтин ＋
                <div className="grid grid-cols-2 gap-[7px] sm:grid-cols-3 lg:grid-cols-4">
                  {shown.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => !m.stopped && (m.soldByWeight ? setWeighFor(m) : add(m.id, 1))}
                      disabled={m.stopped}
                      className={`flex min-h-[76px] flex-col justify-between rounded-[2px] bg-white p-2.5 text-left shadow-[2px_3px_0_0_rgba(0,0,0,.14)] transition ${
                        m.stopped ? "opacity-50 grayscale" : "hover:bg-brand-cream-soft active:brightness-95"
                      }`}
                    >
                      <span className="line-clamp-2 text-[13px] font-semibold leading-tight text-brand-ink">
                        {m.name}
                      </span>
                      <span className="mt-1.5 flex items-end justify-between gap-1.5">
                        <span className="text-[12px] tabular-nums text-[#8a938f]">
                          {fmt(m.price)}{m.soldByWeight ? "/кг" : ""} so'm
                        </span>
                        {m.stopped ? (
                          <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold tracking-wide text-red-600">
                            СТОП
                          </span>
                        ) : (
                          <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[3px] bg-clopos-gold text-[16px] font-bold text-clopos-gold-text shadow-[0_1px_0_rgba(0,0,0,.2)]">
                            {m.soldByWeight ? <IScale className="h-4 w-4" /> : <IPlus className="h-4 w-4" />}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {filtered.length > shown.length && (
                <p className="text-center text-xs text-zinc-400">
                  яна {filtered.length - shown.length} та — қидирувдан фойдаланинг
                </p>
              )}
            </div>
          )}
          {showStop && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6">
              <div className="flex max-h-[85dvh] w-full max-w-2xl flex-col gap-3 rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-brand-ink">
                    🛑 Стоп-лист{stoppedCount > 0 ? ` — ${stoppedCount} та стопда` : ""}
                  </h3>
                  <button
                    onClick={() => setShowStop(false)}
                    className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 transition hover:bg-zinc-100"
                  >
                    Ёпиш
                  </button>
                </div>
                <input
                  value={stopQ}
                  onChange={(e) => setStopQ(e.target.value)}
                  placeholder="Таом қидириш…"
                  className="w-full rounded-lg border border-brand-cream-soft px-3 py-2 text-sm outline-none focus:border-brand"
                />
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setStopCat(null)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      stopCat === null ? "bg-brand text-white" : "bg-brand-cream text-brand"
                    }`}
                  >
                    Барчаси
                  </button>
                  {menuCats.map((c) => (
                    <button
                      key={c}
                      onClick={() => setStopCat(c)}
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                        stopCat === c ? "bg-brand text-white" : "bg-brand-cream text-brand"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                  {stopList.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-brand-cream-soft px-3 py-2"
                    >
                      <span
                        className={`min-w-0 truncate text-sm ${
                          m.stopped ? "text-red-600 line-through" : "text-brand-ink"
                        }`}
                      >
                        {m.name}
                      </span>
                      <button
                        onClick={() => toggleStop(m.id, !m.stopped)}
                        disabled={stopBusy === m.id}
                        className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50 ${
                          m.stopped ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
                        }`}
                      >
                        {stopBusy === m.id ? "…" : m.stopped ? "Стопдан олиш" : "Стопга қўйиш"}
                      </button>
                    </div>
                  ))}
                  {stopList.length === 0 && (
                    <p className="py-6 text-center text-sm text-zinc-400">Топилмади</p>
                  )}
                </div>
              </div>
            </div>
          )}
          {noteFor && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6">
              <div className="flex w-full max-w-md flex-col gap-3 rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="flex min-w-0 items-center gap-2 truncate text-base font-bold text-brand-ink">
                    <IPencil className="h-5 w-5 shrink-0" /> {noteFor.name}
                  </h3>
                  <button
                    onClick={() => setNoteFor(null)}
                    className="shrink-0 rounded-lg px-3 py-1.5 text-sm text-zinc-500 transition hover:bg-zinc-100"
                  >
                    Ёпиш
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {NOTE_CHIPS.map((c) => {
                    const on = noteDraft.includes(c);
                    return (
                      <button
                        key={c}
                        onClick={() =>
                          setNoteDraft((d) =>
                            on
                              ? d
                                  .split(", ")
                                  .filter((x) => x !== c)
                                  .join(", ")
                              : d
                                ? `${d}, ${c}`
                                : c,
                          )
                        }
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                          on ? "bg-brand text-white" : "bg-brand-cream text-brand"
                        }`}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
                <input
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  maxLength={120}
                  placeholder="Изоҳ ёзинг… (кухня тикетида чиқади)"
                  className="w-full rounded-lg border border-brand-cream-soft px-3 py-2 text-sm outline-none focus:border-brand"
                />
                <div className="flex gap-2">
                  {noteDraft && (
                    <button
                      onClick={() => setNoteDraft("")}
                      className="rounded-lg px-3 py-2 text-sm text-zinc-500 transition hover:bg-zinc-100"
                    >
                      Тозалаш
                    </button>
                  )}
                  <button
                    onClick={saveItemNote}
                    disabled={noteBusy}
                    className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white transition hover:bg-brand-soft disabled:opacity-50"
                  >
                    {noteBusy ? "…" : "Сақлаш"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* CART */}
        <aside className="order-2 flex min-w-0 flex-col border border-clopos-line bg-white lg:order-1 lg:overflow-hidden">
          <div className="flex min-h-[300px] flex-1 flex-col">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-[13px] font-semibold text-[#3a3a44]">Заказ</span>
              <span className="text-[12px] text-[#95959f]">{itemCount} таом</span>
            </div>
            {empty ? (
              <EmptyLemon title="Заказ ҳали бўш" hint="Менюдан таом танланг" />
            ) : (
              <div className="max-h-[42vh] divide-y divide-brand-cream-soft/60 overflow-auto lg:max-h-[52vh]">
                {order.items.map((it) => (
                  <div key={it.id} className="flex items-center gap-2 px-4 py-2.5">
                    <button
                      type="button"
                      disabled={!it.productId || !online}
                      onClick={() => it.productId && openItemNote(it.productId, it.name, it.note ?? "")}
                      title={online ? "Изоҳ (пиёзсиз, соус алоҳида...)" : "Оффлайн — уланганда"}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-sm text-brand-ink">{it.name}</div>
                      <div className="text-xs tabular-nums text-zinc-400">
                        {it.weightG ? `${(it.weightG / 1000).toFixed(3)} кг · ${fmt(it.price)}` : fmt(it.price)}
                      </div>
                      {it.note ? (
                        <div className="flex items-center gap-1 truncate text-xs font-medium text-amber-600">
                          <IPencil className="h-3 w-3 shrink-0" /> {it.note}
                        </div>
                      ) : (
                        it.productId && (
                          <div className="flex items-center gap-1 text-[10px] text-zinc-300">
                            <IPencil className="h-2.5 w-2.5" /> изоҳ
                          </div>
                        )
                      )}
                    </button>
                    {it.productId && online && (
                      <button
                        type="button"
                        onClick={() => cycleCourse(it.id, it.course ?? 1)}
                        title="Курс/подача — тап билан ўзгартиринг (1→2→3)"
                        className={`shrink-0 rounded-md px-1.5 py-1 text-[11px] font-bold tabular-nums transition ${
                          (it.course ?? 1) > 1
                            ? "bg-brand-gold text-brand-ink"
                            : "bg-zinc-100 text-zinc-400 hover:bg-zinc-200"
                        }`}
                      >
                        {it.course ?? 1}к
                      </button>
                    )}
                    {it.weightG ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums text-brand">
                        <IScale className="h-3.5 w-3.5" /> {(it.weightG / 1000).toFixed(2)}кг
                      </span>
                    ) : it.productId ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <Step onClick={() => add(it.productId!, -1)}><IMinus className="h-4 w-4" /></Step>
                        <span className="w-6 text-center text-sm font-semibold tabular-nums">{it.qty}</span>
                        <Step onClick={() => add(it.productId!, 1)}><IPlus className="h-4 w-4" /></Step>
                      </div>
                    ) : (
                      <span className="shrink-0 text-sm tabular-nums text-zinc-500">×{it.qty}</span>
                    )}
                    <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums text-brand-ink">
                      {fmt(it.price * it.qty)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* CloPOS пунктир-итоги (handoff-макет, точь-в-точь) */}
          <div className="mx-3 flex flex-col gap-[5px] border-t border-dashed border-[#d3d3de] pb-1.5 pt-2.5">
            <div className="flex justify-between text-[12px]">
              <span className="text-[#95959f]">Промежуточный итог:</span>
              <span className="tabular-nums text-[#3a3a44]">{fmt(order.subtotal)}so'm</span>
            </div>
            <div className="flex justify-between text-[12px]">
              <span className="text-[#95959f]">Сервис:</span>
              <span className="tabular-nums text-[#3a3a44]">{fmt(order.service)}so'm ({order.servicePct}%)</span>
            </div>
            {deposit > 0 && (
              <div className="flex justify-between text-[12px]">
                <span className="text-emerald-700">
                  Аванс (бронь{order.reservationName ? ` — ${order.reservationName}` : ""}):
                </span>
                <span className="font-semibold tabular-nums text-emerald-700">−{fmt(deposit)}so'm</span>
              </div>
            )}
            <div className="flex justify-between text-[14px]">
              <span className="font-bold text-[#1d1d24]">Итого:</span>
              <span className="font-bold tabular-nums text-[#1d1d24]">{fmt(order.total)}so'm</span>
            </div>
          </div>

          {/* CloPOS тугма-қатор: Отправить/Оплата · ··· · Отменить продажу */}
          <div className="flex gap-0.5 px-3 pb-3 pt-2">
            {unsent > 0 ? (
              <button
                onClick={sendToKitchen}
                disabled={sending}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-l-[3px] bg-clopos-green text-[14px] font-semibold text-white transition hover:brightness-105 disabled:opacity-60"
              >
                {sending ? <ISpin className="h-4 w-4" /> : null}
                {sending ? "Юборилмоқда…" : `Отправить (${unsent})`}
              </button>
            ) : canClose && online && !empty ? (
              <button
                onClick={() => setPaying(true)}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-l-[3px] bg-clopos-green text-[14px] font-semibold text-white transition hover:brightness-105"
              >
                <ICard className="h-4 w-4" /> Оплата
              </button>
            ) : (
              <div
                className="flex h-12 flex-1 cursor-not-allowed items-center justify-center rounded-l-[3px] bg-clopos-disabled text-[14px] font-semibold text-clopos-disabled-text"
                title={!online ? "Тўлов уланганда" : empty ? "Заказ бўш" : "Чекни кассир ёпади"}
              >
                {empty || unsent > 0 ? "Отправить" : "Оплата"}
              </div>
            )}
            <button
              onClick={() => tickets.length > 0 && setShowTickets((v) => !v)}
              disabled={tickets.length === 0}
              title={tickets.length === 0 ? "Ҳали тикет йўқ" : `Тикетлар (${tickets.length})`}
              className="grid h-12 w-[34px] place-items-center rounded-r-[3px] bg-clopos-disabled text-[14px] font-bold text-clopos-disabled-text transition enabled:hover:brightness-95 disabled:opacity-60"
            >
              ···
            </button>
            <button
              onClick={() => setCancelling((v) => !v)}
              disabled={!online}
              className="ml-2 flex h-12 shrink-0 items-center justify-center gap-2 rounded-[3px] bg-clopos-gold px-4 text-[13px] font-semibold text-clopos-gold-text transition hover:brightness-95 disabled:opacity-50"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.8" fill="none" aria-hidden="true">
                <path d="M1 1l10 10M11 1L1 11" />
              </svg>
              Отменить продажу
            </button>
          </div>

          {showTickets && tickets.length > 0 && (
            <div className="border-t border-clopos-line">
              {tickets.map((t) => {
                const d = new Date(t.createdAt);
                const p = (n: number) => String(n).padStart(2, "0");
                return (
                  <button
                    key={t.id}
                    onClick={() => setTicketId(t.id)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-[12px] transition hover:bg-clopos-bg"
                  >
                    <span className="tabular-nums text-[#3a3a44]">
                      {p(d.getHours())}:{p(d.getMinutes())}
                    </span>
                    <span className="tabular-nums text-[#95959f]">{t.itemCount} дона</span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>
      </div>

      {/* MOBILE STICKY BAR */}
      {!empty && !paying && (
        <div
          className="fixed inset-x-0 bottom-0 z-20 border-t border-brand-cream-soft bg-white/95 backdrop-blur lg:hidden"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 pt-3">
            <div className="min-w-0">
              <div className="text-[11px] text-zinc-400">Жами · {itemCount} таом</div>
              <div className="truncate text-lg font-bold tabular-nums text-brand-ink">
                {fmt(order.total)} <span className="text-xs font-normal text-zinc-400">so'm</span>
              </div>
            </div>
            {unsent > 0 ? (
              <button
                onClick={sendToKitchen}
                disabled={sending}
                className="ml-auto inline-flex items-center gap-2 rounded-xl bg-brand-gold px-5 py-3 font-semibold text-brand-ink transition active:scale-[.98] disabled:opacity-50 motion-reduce:active:scale-100"
              >
                {sending ? <ISpin className="h-5 w-5" /> : <IFlame className="h-5 w-5" />}
                {sending ? "Юборилмоқда…" : `Кухняга (${unsent})`}
              </button>
            ) : canClose && online ? (
              <button
                onClick={() => setPaying(true)}
                className="ml-auto inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-3 font-semibold text-white transition active:scale-[.98] motion-reduce:active:scale-100"
              >
                <IReceipt className="h-5 w-5" />
                Ёпиш ва чек
              </button>
            ) : (
              <span className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-brand-ink/50">
                {!online ? <><IWifiOff className="h-4 w-4" /> Тўлов уланганда</> : <><ICard className="h-4 w-4" /> Кассир ёпади</>}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ⋯ ҚЎШИМЧА АМАЛЛАР MODAL (CloPOS) — официант · тозалаш · стол · тикет · стоп · бекор */}
      {showMore && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-brand-ink/40 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setShowMore(false)}
        >
          <div
            className="w-full max-w-sm rounded-t-3xl bg-white p-3 shadow-xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-2 py-2">
              <h3 className="text-[15px] font-bold text-brand-ink">Қўшимча амаллар</h3>
              <button
                onClick={() => setShowMore(false)}
                className="grid h-8 w-8 place-items-center rounded-md text-zinc-400 transition hover:bg-clopos-bg"
              >
                <span className="text-lg leading-none" aria-hidden>✕</span>
              </button>
            </div>
            <div className="grid gap-1">
              {/* 👤 Мижоз бириктириш (CloPOS «Добавить клиента») */}
              <button
                onClick={() => {
                  setShowMore(false);
                  setShowCustomer(true);
                  setCustQuery("");
                  trpc.finance.customers.search
                    .query({})
                    .then(setCustResults)
                    .catch(() => {});
                }}
                disabled={!online || order.locked}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-brand-ink transition hover:bg-clopos-bg disabled:opacity-40"
              >
                <IUser className="h-5 w-5 text-clopos-icon" /> Мижоз бириктириш
              </button>
              {/* 🏷 Чегирма (CloPOS «Скидка») — фақат manager+ */}
              {isManager && (
                <button
                  onClick={() => {
                    setShowMore(false);
                    setShowDiscMenu(true);
                    setDiscAmount("");
                    setDiscReason("");
                  }}
                  disabled={!online || order.locked || order.items.length === 0}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-brand-ink transition hover:bg-clopos-bg disabled:opacity-40"
                >
                  <span className="w-5 text-center text-[17px]" aria-hidden>🏷</span> Чегирма
                </button>
              )}
              {isManager && (
                <button
                  onClick={() => {
                    setShowMore(false);
                    setShowReassign(true);
                    trpc.users.list
                      .query()
                      .then((r) => setStaff(r.filter((u) => u.active)))
                      .catch(() => {});
                  }}
                  disabled={!online || order.locked}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-brand-ink transition hover:bg-clopos-bg disabled:opacity-40"
                >
                  <IUser className="h-5 w-5 text-clopos-icon" /> Официантни алмаштириш
                </button>
              )}
              {order.items.length > 0 && !order.locked && (
                <button
                  onClick={() => {
                    setShowMore(false);
                    setShowClear(true);
                  }}
                  disabled={!online}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-brand-ink transition hover:bg-clopos-bg disabled:opacity-40"
                >
                  <span className="w-5 text-center" aria-hidden>🧹</span> Чекни тозалаш
                </button>
              )}
              <button
                onClick={() => {
                  setShowMore(false);
                  setMoving(true);
                }}
                disabled={!online}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-brand-ink transition hover:bg-clopos-bg disabled:opacity-40"
              >
                <ISwap className="h-5 w-5 text-clopos-icon" /> Бошқа столга кўчириш
              </button>
              {/* 👥 Меҳмонлар сони (CloPOS «Изменить кол-во гостей») */}
              <button
                onClick={() => {
                  setShowMore(false);
                  setShowGuests(true);
                  setGuestsInput(order.guests ? String(order.guests) : "");
                }}
                disabled={!online || order.locked}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-brand-ink transition hover:bg-clopos-bg disabled:opacity-40"
              >
                <IUsers className="h-5 w-5 text-clopos-icon" /> Меҳмонлар сони{order.guests ? ` (${order.guests})` : ""}
              </button>
              {/* 🚚 Тип продажи (CloPOS «Изменить тип продажи») — зал/доставка/собой */}
              <button
                onClick={() => {
                  setShowMore(false);
                  setShowSaleType(true);
                }}
                disabled={!online || order.locked}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-brand-ink transition hover:bg-clopos-bg disabled:opacity-40"
              >
                <IMoped className="h-5 w-5 text-clopos-icon" /> Тип продажи
              </button>
              {tickets.length > 0 && (
                <button
                  onClick={() => {
                    setShowMore(false);
                    setShowTickets(true);
                  }}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-brand-ink transition hover:bg-clopos-bg"
                >
                  <IReceipt className="h-5 w-5 text-clopos-icon" /> Заказ тарихи (тикетлар)
                </button>
              )}
              {canComp && (
                <button
                  onClick={() => {
                    setShowMore(false);
                    setShowStop(true);
                  }}
                  disabled={!online}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-brand-ink transition hover:bg-clopos-bg disabled:opacity-40"
                >
                  <IStop className="h-5 w-5 text-clopos-icon" /> Стоп-лист{stoppedCount > 0 ? ` (${stoppedCount})` : ""}
                </button>
              )}
              <button
                onClick={() => {
                  setShowMore(false);
                  setCancelling(true);
                }}
                disabled={!online}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-red-600 transition hover:bg-red-50 disabled:opacity-40"
              >
                <ITrash className="h-5 w-5" /> Заказни бекор қилиш
              </button>
            </div>
          </div>
        </div>
      )}

      {/* МЕҲМОНЛАР СОНИ MODAL (CloPOS «Изменить кол-во гостей») */}
      {showGuests && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-brand-ink/40 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setShowGuests(false)}
        >
          <div
            className="w-full max-w-sm space-y-3 rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[15px] font-bold text-brand-ink">Меҳмонлар сони</h3>
            <input
              value={guestsInput}
              onChange={(e) => setGuestsInput(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              autoFocus
              placeholder="Нечта меҳмон?"
              className="w-full rounded-xl border border-clopos-line px-3 py-2.5 text-[14px] outline-none focus:border-brand-deep"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowGuests(false)}
                className="flex-1 rounded-xl border border-clopos-line py-2.5 text-[14px] font-medium text-brand-ink transition hover:bg-clopos-bg"
              >
                Бекор
              </button>
              <button
                disabled={guestsBusy}
                onClick={async () => {
                  setGuestsBusy(true);
                  try {
                    await trpc.pos.updateMeta.mutate({ id, guests: Number(guestsInput) || 0 });
                    setShowGuests(false);
                    await refresh();
                  } catch (e) {
                    setSyncErr(e instanceof Error ? e.message : "Сақланмади");
                  } finally {
                    setGuestsBusy(false);
                  }
                }}
                className="flex-1 rounded-xl bg-brand-deep py-2.5 text-[14px] font-semibold text-white transition hover:bg-brand-ink disabled:opacity-50"
              >
                {guestsBusy ? "…" : "Сақлаш"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ТИП ПРОДАЖИ MODAL (CloPOS «Изменить тип продажи») — зал/доставка/собой */}
      {showSaleType && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-brand-ink/40 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setShowSaleType(false)}
        >
          <div
            className="w-full max-w-sm space-y-2 rounded-t-3xl bg-white p-4 shadow-xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="px-1 pb-1 text-[15px] font-bold text-brand-ink">Тип продажи</h3>
            {(
              [
                ["dine_in", "🍽 Залда", "Зал сервиси (10%)"],
                ["delivery", "🚚 Доставка", "Хизмат ҳақисиз"],
                ["takeaway", "🥡 Собой", "Олиб кетиш, хизмат ҳақисиз"],
              ] as const
            ).map(([st, label, sub]) => (
              <button
                key={st}
                onClick={async () => {
                  setShowSaleType(false);
                  await changeSaleType(st);
                }}
                className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition ${
                  order.saleType === st
                    ? "border-brand-deep bg-brand-deep/5"
                    : "border-clopos-line hover:bg-clopos-bg"
                }`}
              >
                <span className="text-[14px] text-brand-ink">{label}</span>
                <span className="text-[11px] text-zinc-400">
                  {order.saleType === st ? "✓ жорий" : sub}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* МИЖОЗ БИРИКТИРИШ MODAL (CloPOS «Добавить клиента») — қидирув + янги */}
      {showCustomer && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-brand-ink/40 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setShowCustomer(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-clopos-line px-5 py-3.5">
              <h3 className="text-[15px] font-bold text-brand-ink">Мижоз бириктириш</h3>
              <button
                onClick={() => setShowCustomer(false)}
                className="grid h-8 w-8 place-items-center rounded-md text-zinc-400 transition hover:bg-clopos-bg"
              >
                <span className="text-lg leading-none" aria-hidden>✕</span>
              </button>
            </div>
            <div className="border-b border-clopos-line p-3">
              <input
                value={custQuery}
                onChange={(e) => {
                  const q = e.target.value;
                  setCustQuery(q);
                  trpc.finance.customers.search
                    .query({ query: q })
                    .then(setCustResults)
                    .catch(() => {});
                }}
                placeholder="Исм ёки телефон…"
                className="w-full rounded-xl border border-clopos-line px-3 py-2.5 text-[14px] outline-none focus:border-brand-deep"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {custResults.length === 0 ? (
                <div className="py-6 text-center">
                  <p className="text-[13px] text-zinc-400">Мижоз топилмади</p>
                  {custQuery.trim() && (
                    <button
                      disabled={custBusy}
                      onClick={async () => {
                        setCustBusy(true);
                        try {
                          const c = await trpc.finance.customers.create.mutate({ name: custQuery.trim() });
                          await trpc.pos.attachCustomer.mutate({ orderId: id, customerId: c.id });
                          setShowCustomer(false);
                          await refresh();
                        } catch (e) {
                          setSyncErr(e instanceof Error ? e.message : "Мижоз яратилмади");
                        } finally {
                          setCustBusy(false);
                        }
                      }}
                      className="mt-3 rounded-xl bg-brand-deep px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-brand-ink disabled:opacity-50"
                    >
                      «{custQuery.trim()}» — янги мижоз яратиш
                    </button>
                  )}
                </div>
              ) : (
                <ul className="space-y-1">
                  {custResults.map((c) => (
                    <li key={c.id}>
                      <button
                        disabled={custBusy}
                        onClick={async () => {
                          setCustBusy(true);
                          try {
                            await trpc.pos.attachCustomer.mutate({ orderId: id, customerId: c.id });
                            setShowCustomer(false);
                            await refresh();
                          } catch (e) {
                            setSyncErr(e instanceof Error ? e.message : "Мижоз бириктирилмади");
                          } finally {
                            setCustBusy(false);
                          }
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition hover:bg-clopos-bg disabled:opacity-50"
                      >
                        <span className="text-[14px] text-brand-ink">{c.name}</span>
                        {c.phone && <span className="text-[12px] text-zinc-400">{c.phone}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ЧЕГИРМА MODAL (CloPOS «Скидка») — сумма + мажбурий сабаб */}
      {showDiscMenu && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-brand-ink/40 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setShowDiscMenu(false)}
        >
          <div
            className="w-full max-w-sm space-y-3 rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[15px] font-bold text-brand-ink">Чегирма</h3>
            {/* Сумма / % тоггл (CloPOS каби) */}
            <div className="flex rounded-xl border border-clopos-line p-0.5 text-[13px]">
              {(["sum", "pct"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setDiscMode(m)}
                  className={`flex-1 rounded-lg py-1.5 font-medium transition ${
                    discMode === m ? "bg-brand-deep text-white" : "text-brand-ink hover:bg-clopos-bg"
                  }`}
                >
                  {m === "sum" ? "Сумма (so'm)" : "Фоиз (%)"}
                </button>
              ))}
            </div>
            <input
              value={discAmount}
              onChange={(e) => setDiscAmount(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              placeholder={discMode === "pct" ? "Фоиз (масалан 10)" : "Сумма (so'm)"}
              className="w-full rounded-xl border border-clopos-line px-3 py-2.5 text-[14px] outline-none focus:border-brand-deep"
            />
            {discMode === "pct" && !!discAmount && (
              <p className="px-1 text-[12px] text-zinc-500">
                ={" "}
                {Math.round(
                  (order.items.reduce((s, i) => s + i.price * i.qty, 0) * Number(discAmount)) / 100,
                ).toLocaleString()}{" "}
                so'm чегирма
              </p>
            )}
            <input
              value={discReason}
              onChange={(e) => setDiscReason(e.target.value)}
              placeholder="Сабаб (мажбурий)"
              className="w-full rounded-xl border border-clopos-line px-3 py-2.5 text-[14px] outline-none focus:border-brand-deep"
            />
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowDiscMenu(false)}
                className="flex-1 rounded-xl border border-clopos-line py-2.5 text-[14px] font-medium text-brand-ink transition hover:bg-clopos-bg"
              >
                Бекор
              </button>
              <button
                disabled={discBusy || !discAmount || !discReason.trim()}
                onClick={async () => {
                  setDiscBusy(true);
                  const subtotal = order.items.reduce((s, i) => s + i.price * i.qty, 0);
                  const amount =
                    discMode === "pct"
                      ? Math.round((subtotal * Number(discAmount)) / 100)
                      : Number(discAmount);
                  try {
                    await trpc.pos.setDiscount.mutate({
                      orderId: id,
                      amount,
                      reason: discReason.trim(),
                    });
                    setShowDiscMenu(false);
                    await refresh();
                  } catch (e) {
                    setSyncErr(e instanceof Error ? e.message : "Чегирма қўйилмади");
                  } finally {
                    setDiscBusy(false);
                  }
                }}
                className="flex-1 rounded-xl bg-brand-deep py-2.5 text-[14px] font-semibold text-white transition hover:bg-brand-ink disabled:opacity-50"
              >
                {discBusy ? "…" : "Қўллаш"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ОФИЦИАНТ АЛМАШТИРИШ MODAL (CloPOS «Изменить Сотрудник») — ходим пикери */}
      {showReassign && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-brand-ink/40 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setShowReassign(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-clopos-line px-5 py-3.5">
              <h3 className="text-[15px] font-bold text-brand-ink">Официантни алмаштириш</h3>
              <button
                onClick={() => setShowReassign(false)}
                className="grid h-8 w-8 place-items-center rounded-md text-zinc-400 transition hover:bg-clopos-bg"
              >
                <span className="text-lg leading-none" aria-hidden>✕</span>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {staff.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-zinc-400">Ходим топилмади</p>
              ) : (
                <ul className="space-y-1">
                  {staff.map((s) => (
                    <li key={s.id}>
                      <button
                        disabled={reassignBusy}
                        onClick={async () => {
                          setReassignBusy(true);
                          try {
                            await trpc.pos.reassignWaiter.mutate({ orderId: id, waiterId: s.id });
                            setShowReassign(false);
                            await refresh();
                          } catch (e) {
                            setSyncErr(e instanceof Error ? e.message : "Официант алмашмади");
                          } finally {
                            setReassignBusy(false);
                          }
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition hover:bg-clopos-bg disabled:opacity-50"
                      >
                        <span className="text-[14px] text-brand-ink">{s.name}</span>
                        <span className="text-[11px] uppercase text-zinc-400">{s.role}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ЧЕК ТОЗАЛАШ ТАСДИҒИ (CloPOS «Очистить чек») */}
      {showClear && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-brand-ink/40 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setShowClear(false)}
        >
          <div
            className="w-full max-w-sm space-y-4 rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[15px] font-bold text-brand-ink">Чекни тозалаш</h3>
            <p className="text-[13px] text-zinc-500">
              Юборилмаган позициялар олиб ташланади. Кухняга кетган таомга тегилмайди.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowClear(false)}
                className="flex-1 rounded-xl border border-clopos-line py-2.5 text-[14px] font-medium text-brand-ink transition hover:bg-clopos-bg"
              >
                Бекор
              </button>
              <button
                disabled={clearBusy}
                onClick={async () => {
                  setClearBusy(true);
                  try {
                    await trpc.pos.clearOrder.mutate({ orderId: id });
                    setShowClear(false);
                    await refresh();
                  } catch (e) {
                    setSyncErr(e instanceof Error ? e.message : "Тозаланмади");
                  } finally {
                    setClearBusy(false);
                  }
                }}
                className="flex-1 rounded-xl bg-red-500 py-2.5 text-[14px] font-semibold text-white transition hover:bg-red-600 disabled:opacity-50"
              >
                {clearBusy ? "Тозаланмоқда…" : "Тозалаш"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ИСТОРИЯ ЧЕКА MODAL (CloPOS «История чека») — амаллар timeline */}
      {showHistory && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-brand-ink/40 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setShowHistory(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-clopos-line px-5 py-3.5">
              <h3 className="text-[15px] font-bold text-brand-ink">История чека</h3>
              <button
                onClick={() => setShowHistory(false)}
                className="grid h-8 w-8 place-items-center rounded-md text-zinc-400 transition hover:bg-clopos-bg"
              >
                <span className="text-lg leading-none" aria-hidden>✕</span>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {events.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-zinc-400">Ҳали амал йўқ</p>
              ) : (
                <ol className="space-y-2.5">
                  {events.map((ev, i) => {
                    const d = new Date(ev.createdAt);
                    const p = (n: number) => String(n).padStart(2, "0");
                    return (
                      <li key={i} className="border-l-2 border-brand-gold/50 pl-3">
                        <div className="text-[13px] text-brand-ink">{ev.summary ?? ev.action}</div>
                        <div className="mt-0.5 text-[11px] text-zinc-400">
                          {ev.actorName ?? "—"} · {p(d.getHours())}:{p(d.getMinutes())} {p(d.getDate())}.
                          {p(d.getMonth() + 1)}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PAY MODAL */}
      {paying && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-brand-ink/40 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={cancelPay}
        >
          <div
            className="w-full max-w-sm space-y-4 rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl"
            style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-baseline justify-between">
              <h3 className="font-semibold text-brand-ink">Тўлов усули</h3>
              <span className="text-lg font-bold tabular-nums text-brand-ink">
                {discount || deposit > 0 ? (
                  <>
                    <span className="mr-1 text-xs font-normal text-zinc-400 line-through">{fmt(order.total)}</span>
                    {fmt(payTotal)}
                  </>
                ) : (
                  fmt(order.total)
                )}{" "}
                <span className="text-xs font-normal text-zinc-400">so'm</span>
              </span>
            </div>
            {discount && (
              <div className="flex items-center justify-between rounded-lg bg-brand-gold/10 px-3 py-1.5 text-xs text-brand-gold-deep">
                <span>Чегирма: −{fmt(discount.amount)} · {discount.reason}</span>
                <button onClick={() => setDiscount(null)} className="font-medium underline">олиб ташлаш</button>
              </div>
            )}
            {deposit > 0 && (
              <div className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">
                Бронь аванси{order.reservationName ? ` (${order.reservationName})` : ""}: −{fmt(deposit)} —
                олдин олинган, кассага қайта кирмайди
              </div>
            )}

            {pendingDebt ? (
              <CustomerPicker
                closing={closing}
                onBack={() => setPendingDebt(null)}
                onPick={(customerId) => submitClose(pendingDebt, customerId)}
              />
            ) : showQr ? (
              <div className="space-y-3 rounded-2xl border border-brand-cream-soft bg-brand-cream/20 p-3 text-center">
                <p className="text-sm font-semibold text-brand-ink">
                  {PAY_LABEL[showQr]} — <span className="tabular-nums">{fmt(payTotal)}</span> so'm
                </p>
                {qrDataUrl ? (
                  <>
                    <img
                      src={qrDataUrl}
                      alt="QR"
                      className="mx-auto rounded-xl border border-brand-cream-soft bg-white p-2"
                      width={200}
                      height={200}
                    />
                    <p className="text-xs text-zinc-500">
                      Мижоз {PAY_LABEL[showQr]} иловасида QR'ни сканерлаб тўласин
                    </p>
                  </>
                ) : cfgOpen ? (
                  <div className="space-y-2 text-left">
                    <p className="text-xs font-semibold text-brand-ink">
                      {showQr === "payme" ? "Payme merchant ID" : "Click service_id + merchant_id"}
                    </p>
                    {showQr === "payme" ? (
                      <input
                        value={cfgDraft.paymeMerchantId}
                        onChange={(e) => setCfgDraft((d) => ({ ...d, paymeMerchantId: e.target.value.trim() }))}
                        placeholder="Payme merchant_id"
                        className="w-full rounded-xl border border-brand-cream-soft px-3 py-2 text-sm outline-none focus:border-brand"
                      />
                    ) : (
                      <div className="space-y-2">
                        <input
                          value={cfgDraft.clickServiceId}
                          onChange={(e) => setCfgDraft((d) => ({ ...d, clickServiceId: e.target.value.trim() }))}
                          placeholder="Click service_id"
                          className="w-full rounded-xl border border-brand-cream-soft px-3 py-2 text-sm outline-none focus:border-brand"
                        />
                        <input
                          value={cfgDraft.clickMerchantId}
                          onChange={(e) => setCfgDraft((d) => ({ ...d, clickMerchantId: e.target.value.trim() }))}
                          placeholder="Click merchant_id"
                          className="w-full rounded-xl border border-brand-cream-soft px-3 py-2 text-sm outline-none focus:border-brand"
                        />
                      </div>
                    )}
                    <button
                      onClick={saveCfg}
                      disabled={cfgBusy}
                      className="w-full rounded-xl bg-brand py-2 text-sm font-semibold text-white transition hover:bg-brand-soft disabled:opacity-50"
                    >
                      {cfgBusy ? "…" : "Сақлаш"}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2 py-2">
                    <p className="text-xs text-amber-600">
                      {PAY_LABEL[showQr]} ID созланмаган — QR йўқ
                    </p>
                    {canDiscount ? (
                      <button
                        onClick={() => {
                          setCfgDraft({
                            paymeMerchantId: payCfg?.paymeMerchantId ?? "",
                            clickServiceId: payCfg?.clickServiceId ?? "",
                            clickMerchantId: payCfg?.clickMerchantId ?? "",
                          });
                          setCfgOpen(true);
                        }}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-brand underline"
                      >
                        <IGear className="h-3.5 w-3.5" /> ID киритиш
                      </button>
                    ) : (
                      <p className="text-xs text-zinc-400">Директор созлайди</p>
                    )}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowQr(null); setCfgOpen(false); }}
                    disabled={closing}
                    className="flex-1 rounded-xl border border-brand-cream-soft py-2.5 text-sm font-medium text-zinc-600 disabled:opacity-40"
                  >
                    Орқага
                  </button>
                  <button
                    onClick={() => pay(showQr)}
                    disabled={closing}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40"
                  >
                    {closing ? <ISpin className="h-4 w-4" /> : <ICheck className="h-4 w-4" />} Тўланди
                  </button>
                </div>
              </div>
            ) : showCash ? (
              <div className="space-y-3 rounded-2xl border border-brand-cream-soft bg-brand-cream/20 p-3">
                <p className="text-xs font-semibold text-brand-ink">Нақд — олинган пулни киритинг</p>
                <input
                  autoFocus
                  inputMode="numeric"
                  value={cashGot}
                  onChange={(e) => setCashGot(e.target.value.replace(/\D/g, ""))}
                  placeholder="0"
                  className="w-full rounded-xl border border-brand-cream-soft px-3 py-3 text-right text-2xl font-bold tabular-nums text-brand-ink outline-none focus:border-brand"
                />
                <div className="grid grid-cols-4 gap-1.5">
                  {cashQuick.map((v) => (
                    <button
                      key={v}
                      onClick={() => setCashGot(String(v))}
                      className="grid min-h-11 place-items-center rounded-lg border border-brand-cream-soft bg-white px-1 py-2 text-xs font-semibold tabular-nums text-brand-ink transition hover:border-brand active:scale-[.97] motion-reduce:active:scale-100"
                    >
                      {v === payTotal ? "Тўлиқ" : fmt(v)}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
                  <span className="text-sm text-zinc-500">Қайтим</span>
                  <span
                    className={`text-lg font-bold tabular-nums ${cashChange < 0 ? "text-zinc-300" : "text-emerald-600"}`}
                  >
                    {cashChange < 0 ? "—" : fmt(cashChange)}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowCash(false); setCashGot(""); }}
                    disabled={closing}
                    className="flex-1 rounded-xl border border-brand-cream-soft py-2.5 text-sm font-medium text-zinc-600 disabled:opacity-40"
                  >
                    Орқага
                  </button>
                  <button
                    onClick={() => {
                      setPaidCash(cashGotNum);
                      submitClose([{ method: "cash", amount: payTotal }]);
                    }}
                    disabled={closing || cashGotNum < payTotal}
                    className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-deep disabled:opacity-40"
                  >
                    Ёпиш
                  </button>
                </div>
                {closing && <p className="text-center text-xs text-zinc-400">ёпилмоқда…</p>}
              </div>
            ) : showSplit ? (
              <div className="space-y-2 rounded-2xl border border-brand-cream-soft bg-brand-cream/20 p-3">
                <p className="text-xs font-semibold text-brand-ink">Аралаш тўлов — ҳар турга суммани ёзинг</p>
                {PAY_METHODS.map((m) => (
                  <div key={m} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-sm text-zinc-600">{PAY_LABEL[m]}</span>
                    <input
                      inputMode="numeric"
                      value={splits[m] ?? ""}
                      onChange={(e) =>
                        setSplits((s) => ({ ...s, [m]: e.target.value.replace(/\D/g, "") }))
                      }
                      placeholder="0"
                      className="w-full rounded-xl border border-brand-cream-soft px-3 py-2 text-right text-sm tabular-nums outline-none focus:border-brand"
                    />
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1 text-sm">
                  <span className="text-zinc-500">Йиғилди</span>
                  <span
                    className={`tabular-nums font-semibold ${splitSum === payTotal ? "text-emerald-600" : "text-zinc-700"}`}
                  >
                    {fmt(splitSum)} / {fmt(payTotal)}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowSplit(false); setSplits({}); }}
                    disabled={closing}
                    className="flex-1 rounded-xl border border-brand-cream-soft py-2.5 text-sm font-medium text-zinc-600 disabled:opacity-40"
                  >
                    Орқага
                  </button>
                  <button
                    onClick={paySplit}
                    disabled={closing || splitSum !== payTotal}
                    className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-deep disabled:opacity-40"
                  >
                    Ёпиш
                  </button>
                </div>
              </div>
            ) : !showComp ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {PAY_METHODS.map((m) => {
                    const Icon = m === "cash" ? IBank : m === "debt" ? IReceipt : ICard;
                    return (
                      <button
                        key={m}
                        onClick={() =>
                          m === "cash"
                            ? setShowCash(true)
                            : m === "payme" || m === "click"
                              ? setShowQr(m)
                              : pay(m)
                        }
                        disabled={closing}
                        className="flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-brand-cream-soft bg-brand-cream/30 font-semibold text-brand-ink transition hover:border-brand hover:bg-brand-cream active:scale-[.97] disabled:opacity-40 motion-reduce:active:scale-100"
                      >
                        <Icon className="h-5 w-5 text-brand" />
                        <span className="text-sm">{PAY_LABEL[m]}</span>
                      </button>
                    );
                  })}
                  {canComp && (
                    <button
                      onClick={() => setShowComp(true)}
                      disabled={closing}
                      className="flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-brand-gold/40 bg-brand-gold/15 font-semibold text-brand-gold-deep transition hover:bg-brand-gold/25 active:scale-[.97] disabled:opacity-40 motion-reduce:active:scale-100"
                    >
                      <IGift className="h-5 w-5" />
                      <span className="text-sm">Текин</span>
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowSplit(true)}
                    disabled={closing}
                    className="flex-1 rounded-xl border border-brand-cream-soft py-2 text-sm font-medium text-zinc-600 transition hover:border-brand hover:text-brand disabled:opacity-40"
                  >
                    Аралаш тўлов (бўлиб)
                  </button>
                  {canDiscount && !discount && (
                    <button
                      onClick={() => setShowDiscount(true)}
                      disabled={closing}
                      className="flex-1 rounded-xl border border-brand-gold/40 py-2 text-sm font-medium text-brand-gold-deep transition hover:bg-brand-gold/10 disabled:opacity-40"
                    >
                      Чегирма
                    </button>
                  )}
                </div>
                {showDiscount && (
                  <div className="space-y-2 rounded-2xl border border-brand-gold/40 bg-brand-gold/10 p-3">
                    <p className="text-xs font-semibold text-brand-gold-deep">Чегирма — сумма ва сабаб</p>
                    <input
                      autoFocus
                      inputMode="numeric"
                      value={discountInput}
                      onChange={(e) => setDiscountInput(e.target.value.replace(/\D/g, ""))}
                      placeholder="сумма (so'm)"
                      className="w-full rounded-xl border border-brand-gold/40 px-3 py-2.5 text-right text-sm tabular-nums outline-none focus:border-brand-gold-deep"
                    />
                    <input
                      value={discountReasonInput}
                      onChange={(e) => setDiscountReasonInput(e.target.value)}
                      placeholder="сабаб (мажбурий)"
                      className="w-full rounded-xl border border-brand-gold/40 px-3 py-2.5 text-sm outline-none focus:border-brand-gold-deep"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowDiscount(false)}
                        className="flex-1 rounded-xl border border-brand-cream-soft py-2.5 text-sm font-medium text-zinc-600"
                      >
                        Орқага
                      </button>
                      <button
                        onClick={applyDiscount}
                        disabled={!discountInput || !discountReasonInput.trim()}
                        className="flex-1 rounded-xl bg-brand-gold-deep py-3 text-sm font-semibold text-brand-ink disabled:opacity-40"
                      >
                        Қўллаш
                      </button>
                    </div>
                  </div>
                )}
                {closing && <p className="text-center text-xs text-zinc-400">ёпилмоқда…</p>}
              </>
            ) : (
              <div className="space-y-2 rounded-2xl border border-brand-gold/40 bg-brand-gold/10 p-3">
                <p className="text-xs font-semibold text-brand-gold-deep">Текин — сабабини танланг ёки ёзинг</p>
                {/* CloPOS «Закрыть без оплаты» сабаб-таксономияси — тез танлаш. */}
                <div className="flex flex-wrap gap-1.5">
                  {["Меҳмон кетди", "Компания ҳисобидан", "Официант хатоси", "Директор меҳмони"].map((r) => (
                    <button
                      key={r}
                      onClick={() => setCompReason(r)}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                        compReason === r
                          ? "bg-brand-gold-deep text-brand-ink"
                          : "bg-white text-brand-gold-deep hover:bg-brand-gold/20"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <input
                  autoFocus
                  value={compReason}
                  onChange={(e) => setCompReason(e.target.value)}
                  placeholder="масалан: директор гость"
                  className="w-full rounded-xl border border-brand-gold/40 px-3 py-2.5 text-sm outline-none focus:border-brand-gold-deep"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowComp(false)}
                    disabled={closing}
                    className="flex-1 rounded-xl border border-brand-cream-soft py-2.5 text-sm font-medium text-zinc-600 disabled:opacity-40"
                  >
                    Орқага
                  </button>
                  <button
                    onClick={payComp}
                    disabled={!compReason.trim() || closing}
                    className="flex-1 rounded-xl bg-brand-gold-deep py-3 text-sm font-semibold text-brand-ink transition hover:brightness-95 disabled:opacity-40"
                  >
                    Текин деб ёпиш
                  </button>
                </div>
              </div>
            )}

            {closeErr && <p className="text-center text-sm text-red-500">{closeErr}</p>}
            <button
              onClick={cancelPay}
              disabled={closing}
              className="w-full py-1 text-xs text-zinc-400 transition hover:text-zinc-600 disabled:opacity-40"
            >
              Бекор қилиш
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// Қарзга ёпишда мижоз танлаш/яратиш — исм/тел бўйича қидириш ёки янги қўшиш.
function CustomerPicker({
  closing,
  onBack,
  onPick,
}: {
  closing: boolean;
  onBack: () => void;
  onPick: (customerId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; phone: string | null }[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      trpc.finance.customers.search.query({ query: q.trim() || undefined }).then(setResults).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  async function createAndPick() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const { id } = await trpc.finance.customers.create.mutate({ name: name.trim(), phone: phone.trim() || undefined });
      onPick(id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-2xl border border-brand-cream-soft bg-brand-cream/20 p-3">
      <p className="text-xs font-semibold text-brand-ink">Қарздор мижозни танланг</p>
      {!creating ? (
        <>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="исм ёки телефон бўйича қидириш"
            className="w-full rounded-xl border border-brand-cream-soft px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <div className="max-h-40 divide-y overflow-auto rounded-xl border border-brand-cream-soft bg-white">
            {results.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-zinc-400">топилмади</div>
            ) : (
              results.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onPick(c.id)}
                  disabled={closing}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-brand-cream/40 disabled:opacity-40"
                >
                  <span className="font-medium">{c.name}</span>
                  {c.phone && <span className="text-xs text-zinc-400">{c.phone}</span>}
                </button>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onBack}
              disabled={closing}
              className="flex-1 rounded-xl border border-brand-cream-soft py-2.5 text-sm font-medium text-zinc-600 disabled:opacity-40"
            >
              Орқага
            </button>
            <button
              onClick={() => { setName(q); setCreating(true); }}
              disabled={closing}
              className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-deep disabled:opacity-40"
            >
              Янги мижоз
            </button>
          </div>
        </>
      ) : (
        <>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Исм (мажбурий)"
            className="w-full rounded-xl border border-brand-cream-soft px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <input
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Телефон (ихтиёрий)"
            className="w-full rounded-xl border border-brand-cream-soft px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setCreating(false)}
              disabled={busy}
              className="flex-1 rounded-xl border border-brand-cream-soft py-2.5 text-sm font-medium text-zinc-600 disabled:opacity-40"
            >
              Орқага
            </button>
            <button
              onClick={createAndPick}
              disabled={busy || !name.trim()}
              className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-deep disabled:opacity-40"
            >
              Сақлаб танлаш
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Thermal receipt width — 58mm or 80mm, remembered per device (per printer).
function useReceiptWidth() {
  const [w, setW] = useState<number>(() => {
    const v = Number(localStorage.getItem("receiptWidthMm"));
    return v === 58 || v === 80 ? v : 80;
  });
  const set = (v: number) => {
    localStorage.setItem("receiptWidthMm", String(v));
    setW(v);
  };
  return [w, set] as const;
}
const printCss = (id: string, w: number) =>
  `@media print{@page{size:${w}mm auto;margin:2mm}body *{visibility:hidden}#${id},#${id} *{visibility:visible}#${id}{position:absolute;left:0;top:0;width:${w}mm;max-width:none;border:0;box-shadow:none;padding:1mm}}`;
function WidthToggle({ w, onChange }: { w: number; onChange: (v: number) => void }) {
  return (
    <div className="mx-auto flex max-w-xs items-center justify-center gap-1.5 pt-1 text-xs text-zinc-400">
      <span>Принтер эни:</span>
      {[58, 80].map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded px-2 py-0.5 font-medium transition ${
            w === v ? "bg-brand text-white" : "bg-brand-cream text-brand hover:bg-brand-cream-soft"
          }`}
        >
          {v}мм
        </button>
      ))}
    </div>
  );
}

function Hr() {
  return <div className="my-2 border-t border-dashed border-zinc-300" />;
}
function Line({ l, r }: { l: string; r: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-zinc-500">{l}</span>
      <span className="tabular-nums">{r}</span>
    </div>
  );
}

type Ticket = {
  id: string;
  createdAt: string;
  tableNo: string | null;
  hall: string | null;
  items: { name: string; qty: number; note?: string | null; station: string | null }[];
};

function KitchenTicketView({ ticketId, onBack }: { ticketId: string; onBack: () => void }) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [w, setW] = useReceiptWidth();
  useEffect(() => {
    trpc.pos.ticket.query({ ticketId }).then(setTicket).catch(() => {});
  }, [ticketId]);

  if (!ticket) return <Spin />;

  const byStation = new Map<string, { name: string; qty: number; note?: string | null }[]>();
  for (const it of ticket.items) {
    const key = it.station ?? "Бошқа";
    const a = byStation.get(key) ?? [];
    a.push({ name: it.name, qty: it.qty, note: it.note });
    byStation.set(key, a);
  }
  const d = new Date(ticket.createdAt);
  const p = (n: number) => String(n).padStart(2, "0");
  const when = `${p(d.getHours())}:${p(d.getMinutes())}`;

  return (
    <div className="space-y-3">
      <style>{printCss("ticket", w)}</style>
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-zinc-500 transition hover:bg-white hover:text-brand"
      >
        <IBack className="h-4 w-4" />
        Заказга қайтиш
      </button>
      <div
        id="ticket"
        className="mx-auto max-w-xs space-y-3 rounded-2xl border border-brand-cream-soft bg-white p-5 font-mono text-[13px] text-zinc-800 shadow-sm"
      >
        <div className="text-center font-bold">КУХНЯ ТИКЕТИ</div>
        <Hr />
        <Line l="Зал" r={ticket.hall ?? "—"} />
        {ticket.tableNo && <Line l="Стол" r={ticket.tableNo} />}
        <Line l="Вақт" r={when} />
        {[...byStation.entries()].map(([station, items]) => (
          <div key={station}>
            <Hr />
            <div className="font-semibold tracking-wide">{station.toUpperCase()}</div>
            {items.map((it, i) => (
              <div key={i}>
                <div className="flex justify-between gap-2 text-base">
                  <span>{it.name}</span>
                  <span className="font-bold tabular-nums">×{it.qty}</span>
                </div>
                {it.note && <div className="pl-3 text-sm font-semibold">&gt;&gt; {it.note}</div>}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-xs gap-2">
        <button
          onClick={() => {
            const reason = window.prompt("Қайта чоп сабаби? (масалан: принтер тиқилди)");
            if (reason?.trim()) trpc.pos.reprintTicket.mutate({ ticketId, reason: reason.trim() }).catch(() => {});
          }}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-brand-cream-soft py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-brand-cream/30"
        >
          <IPrinter className="h-4 w-4" />
          Қайта чоп
        </button>
        <button
          onClick={onBack}
          className="flex-1 rounded-xl bg-brand-gold py-2.5 text-sm font-semibold text-brand-ink transition hover:bg-brand-gold-deep"
        >
          Давом этиш
        </button>
      </div>
      <WidthToggle w={w} onChange={setW} />
    </div>
  );
}

function Chek({
  order,
  cashReceived,
  onBack,
}: {
  order: Order;
  cashReceived?: number | null;
  onBack: () => void;
}) {
  const d = new Date(order.createdAt);
  const p = (n: number) => String(n).padStart(2, "0");
  const when = `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  const [w, setW] = useReceiptWidth();
  return (
    <div className="space-y-3">
      <style>{printCss("chek", w)}</style>
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-zinc-500 transition hover:bg-white hover:text-brand"
      >
        <IBack className="h-4 w-4" />
        Заллар
      </button>
      <div
        id="chek"
        className="mx-auto max-w-xs rounded-2xl border border-brand-cream-soft bg-white p-5 font-mono text-[13px] text-zinc-800 shadow-sm"
      >
        <div className="flex flex-col items-center gap-1 text-center">
          <img src={BRAND.logoSmall} alt="" className="h-11 w-11 rounded-full object-cover" />
          <div className="text-base font-bold">{BRAND.name}</div>
          <div className="text-xs text-zinc-500">{BRAND.city} · {BRAND.phone}</div>
        </div>
        <Hr />
        <div className="text-center font-semibold tracking-wide">
          {order.isComp ? "ТЕКИН (ходим/гость)" : "ГОСТЕВОЙ СЧЕТ"}
        </div>
        {order.isComp && order.compReason && (
          <div className="text-center text-xs text-zinc-500">сабаб: {order.compReason}</div>
        )}
        <Hr />
        <Line l="Зал" r={order.hall ?? "—"} />
        {order.tableNo && <Line l="Стол" r={order.tableNo} />}
        {order.guests ? <Line l="Меҳмонлар" r={String(order.guests)} /> : null}
        <Line l="Заказ №" r={order.checkNo} />
        <Line l="Очилди" r={when} />
        <Line l="Официант" r={order.waiter ?? "—"} />
        <Hr />
        {order.items.map((it, i) => (
          <div key={i} className="flex justify-between gap-2">
            <span className="truncate">{it.name}</span>
            <span className="whitespace-nowrap tabular-nums">
              {it.qty}×{fmt(it.price)}
            </span>
          </div>
        ))}
        <Hr />
        <Line l="Полная сумма" r={fmt(order.subtotal)} />
        <Line l={`Плата за услугу ${order.servicePct}%`} r={fmt(order.service)} />
        {order.discountAmount > 0 && (
          <Line l={`Чегирма${order.discountReason ? ` (${order.discountReason})` : ""}`} r={`−${fmt(order.discountAmount)}`} />
        )}
        <div className="my-1 flex justify-between text-base font-bold">
          <span>ИТОГО</span>
          <span className="tabular-nums">{fmt(order.total - order.discountAmount)}</span>
        </div>
        <Hr />
        {order.payments.map((pm, i) => (
          <Line key={i} l={PAY_LABEL[pm.method] ?? pm.method} r={fmt(pm.amount)} />
        ))}
        {cashReceived != null && cashReceived > order.total - order.discountAmount && (
          <>
            <Line l="Олинган" r={fmt(cashReceived)} />
            <Line l="Қайтим" r={fmt(cashReceived - (order.total - order.discountAmount))} />
          </>
        )}
        <Hr />
        <div className="text-center text-xs text-zinc-500">
          СПАСИБО! ЖДЕМ ВАС СНОВА!
        </div>
      </div>
      <div className="mx-auto flex max-w-xs gap-2">
        <button
          onClick={() => {
            const reason = window.prompt("Чекни қайта чоп сабаби?");
            if (reason?.trim()) trpc.pos.reprintCheck.mutate({ orderId: order.id, reason: reason.trim() }).catch(() => {});
          }}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-brand-cream-soft py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-brand-cream/30"
        >
          <IPrinter className="h-4 w-4" />
          Қайта чоп
        </button>
        <button
          onClick={onBack}
          className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-deep"
        >
          Заллар
        </button>
      </div>
      <WidthToggle w={w} onChange={setW} />
    </div>
  );
}

function Step({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand-cream text-brand transition hover:bg-brand-cream-soft active:scale-90 motion-reduce:active:scale-100"
    >
      {children}
    </button>
  );
}

// ⚖️ Оғирлик билан сотиш модали (гўшт кг): грамм киритилади, чизиқ нархи =
// кг-нарх × грамм/1000 жонли кўрсатилади.
function WeighSheet({
  name,
  pricePerKg,
  onClose,
  onWeigh,
}: {
  name: string;
  pricePerKg: number;
  onClose: () => void;
  onWeigh: (grams: number) => void;
}) {
  const [g, setG] = useState("");
  const grams = Math.round(Number(g) || 0);
  const price = Math.round((pricePerKg * grams) / 1000);
  const chips = [250, 500, 750, 1000, 1500, 2000];
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div className="w-full max-w-sm space-y-3 rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold text-brand-ink"><IScale className="h-5 w-5" /> {name}</h3>
            <p className="text-xs text-zinc-400">{fmt(pricePerKg)} so'm/кг — вазн киритинг</p>
          </div>
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100">Ёпиш</button>
        </div>
        <input
          autoFocus
          inputMode="numeric"
          value={g}
          onChange={(e) => setG(e.target.value.replace(/\D/g, "").slice(0, 5))}
          placeholder="грамм (масалан 350)"
          className="w-full rounded-xl border border-brand-cream-soft px-3 py-3 text-right text-2xl font-bold tabular-nums outline-none focus:border-brand"
        />
        <div className="grid grid-cols-3 gap-1.5">
          {chips.map((c) => (
            <button
              key={c}
              onClick={() => setG(String(c))}
              className="rounded-lg bg-brand-cream py-2 text-xs font-semibold text-brand"
            >
              {c < 1000 ? `${c} г` : `${c / 1000} кг`}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between rounded-xl bg-brand-cream/40 px-3 py-2">
          <span className="text-sm text-zinc-500">{grams ? `${(grams / 1000).toFixed(3)} кг` : "—"}</span>
          <span className="text-lg font-extrabold tabular-nums text-brand-ink">
            {fmt(price)} <span className="text-xs font-normal text-zinc-400">so'm</span>
          </span>
        </div>
        <button
          onClick={() => grams > 0 && onWeigh(grams)}
          disabled={grams <= 0}
          className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white transition hover:bg-brand-deep disabled:opacity-40"
        >
          Қўшиш
        </button>
      </div>
    </div>
  );
}

// #3 Столда кўп заказ: жорий столнинг очиқ заказлари орасида ўтиш + янги очиш.
function SiblingsSheet({
  current,
  siblings,
  busy,
  online,
  onClose,
  onPick,
  onNew,
}: {
  current: Order;
  siblings: OpenOrder[];
  busy: boolean;
  online: boolean;
  onClose: () => void;
  onPick: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div className="w-full max-w-sm space-y-3 rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold text-brand-ink"><ISwap className="h-5 w-5" /> {current.tableNo} — заказлар</h3>
            <p className="text-xs text-zinc-400">Шу столда {siblings.length + 1} та очиқ заказ</p>
          </div>
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100">Ёпиш</button>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between rounded-xl border-2 border-brand bg-brand-cream/40 px-3 py-2.5">
            <span className="text-sm font-semibold text-brand-ink">
              №{current.checkNo} <span className="text-xs font-normal text-brand">(жорий)</span>
            </span>
            <span className="text-sm font-bold tabular-nums text-brand-ink">{fmt(current.total)}</span>
          </div>
          {siblings.map((s) => (
            <button
              key={s.id}
              onClick={() => onPick(s.id)}
              className="flex w-full items-center justify-between rounded-xl border border-brand-cream-soft px-3 py-2.5 text-left transition hover:border-brand"
            >
              <span className="text-sm font-medium text-brand-ink">
                №{s.id.slice(0, 5).toUpperCase()} · {s.qty} таом
              </span>
              <span className="text-sm font-semibold tabular-nums text-zinc-500">
                {s.total === null ? "банд" : fmt(s.total)}
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={onNew}
          disabled={!online || busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-semibold text-white transition hover:bg-brand-deep disabled:opacity-40"
        >
          <IPlus className="h-4 w-4" /> Янги заказ шу столга
        </button>
      </div>
    </div>
  );
}

// #4 ⑂ Счётни бўлиш: ҳар таомдан нечтаси янги чекка ўтишини танлаш. Пул math
// ўзгармайди — сервер танланган итемларни янги заказга кўчиради, ҳар чек ўзини
// санайди. Камида битта таом жорий чекда қолиши шарт.
function SplitSheet({
  order,
  busy,
  onClose,
  onSplit,
}: {
  order: Order;
  busy: boolean;
  onClose: () => void;
  onSplit: (moves: { orderItemId: string; qty: number }[]) => void;
}) {
  const [pick, setPick] = useState<Record<string, number>>({});
  const set = (id: string, q: number) => setPick((p) => ({ ...p, [id]: q }));
  const totalQty = order.items.reduce((s, i) => s + i.qty, 0);
  const movedQty = order.items.reduce((s, i) => s + Math.min(pick[i.id] ?? 0, i.qty), 0);
  const movedSum = order.items.reduce((s, i) => s + i.price * Math.min(pick[i.id] ?? 0, i.qty), 0);
  const stayQty = totalQty - movedQty;
  const ok = movedQty >= 1 && stayQty >= 1;
  const moves = order.items
    .map((i) => ({ orderItemId: i.id, qty: Math.min(pick[i.id] ?? 0, i.qty) }))
    .filter((m) => m.qty > 0);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-4 pb-2">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold text-brand-ink"><ISplit className="h-5 w-5" /> Счётни бўлиш</h3>
            <p className="text-xs text-zinc-400">Янги чекка ўтадиган таомларни танланг</p>
          </div>
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100">Ёпиш</button>
        </div>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4">
          {order.items.map((i) => {
            const isWeight = i.weightG != null;
            const q = Math.min(pick[i.id] ?? 0, i.qty);
            return (
              <div key={i.id} className="flex items-center gap-2 rounded-xl border border-brand-cream-soft px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-brand-ink">{i.name}</p>
                  <p className="inline-flex items-center gap-1 text-xs text-zinc-400">
                    {isWeight ? (
                      <><IScale className="h-3 w-3" /> {((i.weightG ?? 0) / 1000).toFixed(2)}кг · </>
                    ) : (
                      `${i.qty} × `
                    )}
                    {fmt(i.price)}
                  </p>
                </div>
                {isWeight ? (
                  <button
                    onClick={() => set(i.id, q ? 0 : 1)}
                    className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${q ? "bg-brand text-white" : "bg-brand-cream text-brand"}`}
                  >
                    {q ? <><ICheck className="h-3.5 w-3.5" /> Кўчади</> : "Кўчириш"}
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => set(i.id, Math.max(0, q - 1))}
                      disabled={q <= 0}
                      className="grid h-10 w-10 place-items-center rounded-lg bg-zinc-100 text-lg font-bold text-zinc-600 disabled:opacity-30"
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-sm font-bold tabular-nums">{q}</span>
                    <button
                      onClick={() => set(i.id, Math.min(i.qty, q + 1))}
                      disabled={q >= i.qty}
                      className="grid h-10 w-10 place-items-center rounded-lg bg-brand-cream text-lg font-bold text-brand disabled:opacity-30"
                    >
                      +
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="space-y-2 border-t border-brand-cream-soft p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-500">Янги чекка: {movedQty} таом</span>
            <span className="font-bold tabular-nums text-brand-ink">{fmt(movedSum)} so'm</span>
          </div>
          <p className="text-xs text-zinc-400">Жорий чекда қолади: {stayQty} таом</p>
          <button
            onClick={() => ok && onSplit(moves)}
            disabled={!ok || busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-semibold text-white transition hover:bg-brand-deep disabled:opacity-40"
          >
            {busy ? <><ISpin className="h-4 w-4" /> Бўлинмоқда…</> : <><ISplit className="h-4 w-4" /> Бўлиш → янги чек</>}
          </button>
          {movedQty > 0 && stayQty < 1 && (
            <p className="text-center text-xs text-red-500">Камида битта таом жорий чекда қолиши керак</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-zinc-500" : "text-brand-ink"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
