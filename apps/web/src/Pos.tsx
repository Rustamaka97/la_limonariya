import { type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { SessionUser } from "./App";
import { BRAND } from "./brand";
import { swr } from "./lib/cache";
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
  pendingOpsFor,
  syncBaseFromServer,
} from "./lib/outbox";
import { trpc } from "./trpc";

type Hall = { id: string; name: string; servicePct: number };
type Table = { id: string; hallId: string; name: string; sort: number };
type MenuItem = {
  id: string;
  name: string;
  price: number;
  category: string | null;
};
type OpenOrder = {
  id: string;
  tableNo: string | null;
  hallId: string;
  guests: number | null;
  hall: string | null;
  waiter: string | null;
  qty: number;
  total: number;
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
  hall: string | null;
  waiter: string | null;
  guests: number | null;
  note: string | null;
  createdAt: string;
  isComp: boolean;
  compReason: string | null;
  discountAmount: number;
  discountReason: string | null;
  items: {
    id: string;
    productId: string | null;
    name: string;
    price: number;
    qty: number;
  }[];
  payments: { method: string; amount: number }[];
  subtotal: number;
  service: number;
  total: number;
};

const PAY_LABEL: Record<string, string> = {
  cash: "Нақд",
  card: "Карта",
  click: "Click",
  payme: "Payme",
  humo: "Ҳумо",
  debt: "Қарз",
};

const fmt = (n: number) => n.toLocaleString("ru-RU");

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

function minsAgo(iso: string): string {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}м`;
  return `${Math.floor(m / 60)}с ${m % 60}м`;
}

function Svg({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}
type IP = { className?: string };
const IPlus = (p: IP) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
const IMinus = (p: IP) => <Svg {...p}><path d="M5 12h14" /></Svg>;
const IBack = (p: IP) => <Svg {...p}><path d="M15 18l-6-6 6-6" /></Svg>;
const ISearch = (p: IP) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-3.5-3.5" /></Svg>;
const IFlame = (p: IP) => <Svg {...p}><path d="M12 3s4 3.5 4 8a4 4 0 1 1-8 0c0-1.6.8-2.8 1.6-3.6C10 8.7 12 7 12 3z" /><path d="M12 21a2.4 2.4 0 0 0 2.4-2.4c0-1.6-2.4-3-2.4-3s-2.4 1.4-2.4 3A2.4 2.4 0 0 0 12 21z" /></Svg>;
const IGift = (p: IP) => <Svg {...p}><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v9h14v-9M12 8v13M12 8C10.3 8 8.5 7.2 8.5 5.5 8.5 4.4 9.4 4 10 4.4 11.3 5.2 12 8 12 8zM12 8c1.7 0 3.5-.8 3.5-2.5C15.5 4.4 14.6 4 14 4.4 12.7 5.2 12 8 12 8z" /></Svg>;
const IPrinter = (p: IP) => <Svg {...p}><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="7" rx="1" /></Svg>;
const IChevron = (p: IP) => <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>;
const IUser = (p: IP) => <Svg {...p}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5" /></Svg>;
const IUsers = (p: IP) => <Svg {...p}><circle cx="9" cy="8" r="3" /><path d="M2.5 20c0-3.3 2.8-5 6.5-5s6.5 1.7 6.5 5" /><path d="M16 5.2A3 3 0 0 1 16 11M21.5 20c0-2.6-1.6-4.2-4-4.8" /></Svg>;
const IBank = (p: IP) => <Svg {...p}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></Svg>;
const ICard = (p: IP) => <Svg {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></Svg>;
const IReceipt = (p: IP) => <Svg {...p}><path d="M5 3v18l2-1.2L9 21l2-1.2L13 21l2-1.2L17 21l2-1.2V3l-2 1.2L15 3l-2 1.2L11 3 9 4.2 7 3z" /><path d="M8 9h8M8 13h6" /></Svg>;
const IPlate = (p: IP) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.5" /></Svg>;
const IClock = (p: IP) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
const IPencil = (p: IP) => <Svg {...p}><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z" /><path d="M13.5 6.5l3 3" /></Svg>;
const ITrash = (p: IP) => <Svg {...p}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13" /></Svg>;

function Spin() {
  return (
    <div className="grid place-items-center py-16">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand-cream-soft border-t-brand" />
    </div>
  );
}

export function Pos({ user }: { user: SessionUser }) {
  const [orderId, setOrderId] = useState<string | null>(null);
  if (orderId)
    return <OrderView id={orderId} user={user} onBack={() => setOrderId(null)} />;
  return <FloorView user={user} onOpen={setOrderId} onNew={setOrderId} />;
}

// ── FLOOR: visual hall/table map (Clopos only has a flat list) ──────────────
function FloorView({
  user,
  onOpen,
  onNew,
}: {
  user: SessionUser;
  onOpen: (id: string) => void;
  onNew: (id: string) => void;
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

  const refresh = useCallback(async () => {
    // Сервер + локал (offline'да яратилган) очиқ заказларни бирлаштириш.
    const local = (await listOverlayOpenOrders()) as unknown as OpenOrder[];
    try {
      const server = await trpc.pos.openOrders.query();
      setOrders(mergeOpenOrders(server, local));
    } catch {
      setOrders(local); // оффлайн — фақат локал overlay
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

  async function create(hallId: string, table: string | undefined, guests: number) {
    // Offline-first: локал заказ + навбат; уланганда синхрон (идемпотент client id).
    const hall = halls.find((h) => h.id === hallId);
    const id = crypto.randomUUID();
    const persisted = await enqueueCreate({
      id,
      hallId,
      hall: hall?.name ?? null,
      tableNo: table || undefined,
      servicePct: hall?.servicePct ?? 0,
      guests,
      waiter: user.name,
    });
    if (!persisted) {
      // IndexedDB йўқ (private mode) — тўғридан-тўғри серверга (идемпотент).
      try {
        await trpc.pos.create.mutate({ id, hallId, tableNo: table || undefined, guests });
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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-brand-ink">Заллар</h2>
          <p className="text-xs text-zinc-400">
            {orders === null ? "…" : `${busy} банд · ${tbls.length} стол`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {user.role === "director" && (
            <button
              onClick={() => setHeatOn((v) => !v)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition active:scale-[.98] motion-reduce:active:scale-100 ${
                heatOn ? "bg-brand-gold text-brand-ink" : "bg-white text-brand-ink/70 hover:text-brand"
              }`}
            >
              💰 Иссиқ харита
            </button>
          )}
          <button
            onClick={() => halls[0] && setNewFor({ hall: halls[0] })}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-deep active:scale-[.98] motion-reduce:active:scale-100"
          >
            <IPlus className="h-4 w-4" />
            Тезкор заказ
          </button>
        </div>
      </div>

      {!online && (
        <div className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          📴 Оффлайн — заказлар шу қурилмада сақланиб, уланганда синхронланади. Тўлов уланганда мумкин.
        </div>
      )}

      {orders === null ? (
        <Spin />
      ) : (
        <>
          {halls.map((h) => {
            const hallTables = tbls.filter((t) => t.hallId === h.id);
            const hallBusy = hallTables.filter((t) => byKey.has(key(h.id, t.name))).length;
            return (
              <section key={h.id} className="space-y-2.5">
                <div className="flex items-center gap-2 px-1">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-brand-ink">{h.name}</h3>
                  {h.servicePct > 0 && (
                    <span className="rounded-full bg-brand-cream px-2 py-0.5 text-[10px] font-semibold text-brand">
                      +{h.servicePct}%
                    </span>
                  )}
                  <span className="ml-auto text-xs text-zinc-400">
                    {hallBusy}/{hallTables.length}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                  {hallTables.map((t) => {
                    const os = byKey.get(key(h.id, t.name)) ?? [];
                    const rev = heatByKey.get(key(h.id, t.name)) ?? 0;
                    if (os.length === 0)
                      return (
                        <button
                          key={t.id}
                          style={heatOn ? { backgroundColor: heatColor(rev) } : undefined}
                          onClick={() =>
                            heatOn
                              ? alert(`${t.name}: ${fmt(rev)} so'm за 30 кун`)
                              : setNewFor({ hall: h, table: t.name })
                          }
                          className="grid min-h-[76px] place-items-center rounded-xl border border-brand-cream-soft bg-white px-2 py-2 text-center text-xs font-medium leading-tight text-brand-ink/70 shadow-sm transition hover:border-brand hover:text-brand active:scale-95 motion-reduce:active:scale-100"
                        >
                          <span className="line-clamp-2">{t.name}</span>
                        </button>
                      );
                    const first = os[0] as OpenOrder;
                    return (
                      <TableTile
                        key={t.id}
                        table={t.name}
                        order={first}
                        conflict={os.length > 1}
                        heatColor={heatOn ? heatColor(rev) : undefined}
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
                  })}
                </div>
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

      {newFor && (
        <NewOrderSheet
          halls={halls}
          preset={newFor}
          onClose={() => setNewFor(null)}
          onCreate={create}
        />
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
}: {
  data: { table: string; orders: OpenOrder[] };
  onPick: (orderId: string) => void;
  onClose: () => void;
  canMerge: boolean;
  onMerge: (fromId: string, toId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-brand-ink/40 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-t-2xl bg-white p-4 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-brand-ink">⚠ «{data.table}» — {data.orders.length} та очиқ заказ</h3>
        <p className="mt-1 text-xs text-zinc-500">Оффлайнда икки қурилмада очилган бўлиши мумкин. Заказни танланг:</p>
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
              <span className="tabular-nums font-semibold text-brand-ink">{fmt(o.total)}</span>
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
            className="mt-3 w-full rounded-xl bg-brand-gold py-2.5 text-sm font-semibold text-brand-ink disabled:opacity-40"
          >
            🔗 Битта заказга бирлаштириш
          </button>
        )}
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
                🔄 Кўчириш
              </button>
              <button
                onClick={() => { setGuestsInput(order.guests ?? 1); setMode("guests"); }}
                className="flex w-full items-center gap-2 rounded-xl border border-brand-cream-soft px-4 py-3 text-left text-sm font-medium text-brand-ink transition hover:border-brand hover:bg-brand-cream/40"
              >
                👥 Меҳмонлар
              </button>
              <button
                onClick={() => { setNoteInput(""); setMode("note"); }}
                className="flex w-full items-center gap-2 rounded-xl border border-brand-cream-soft px-4 py-3 text-left text-sm font-medium text-brand-ink transition hover:border-brand hover:bg-brand-cream/40"
              >
                📝 Изоҳ
              </button>
            </div>
            <button onClick={onClose} className="mt-3 w-full py-1 text-xs text-zinc-400 transition hover:text-zinc-600">
              Бекор
            </button>
          </>
        )}

        {mode === "guests" && (
          <>
            <h3 className="font-semibold text-brand-ink">👥 Меҳмонлар сони</h3>
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
            <h3 className="font-semibold text-brand-ink">📝 Изоҳ</h3>
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

function TableTile({
  table,
  order,
  onClick,
  onLongPress,
  conflict,
  heatColor,
}: {
  table: string;
  order: OpenOrder;
  onClick: () => void;
  onLongPress?: () => void;
  conflict?: boolean;
  heatColor?: string;
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
      className={`flex min-h-[76px] flex-col justify-between rounded-xl p-2.5 text-left shadow-sm transition active:scale-95 motion-reduce:active:scale-100 ${
        heatColor
          ? "text-brand-ink"
          : conflict
            ? "bg-amber-600 hover:bg-amber-700 text-white"
            : "bg-brand hover:bg-brand-deep text-white"
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="line-clamp-2 text-xs font-semibold leading-tight">
          {conflict && !heatColor ? "⚠ " : ""}
          {table}
        </span>
        {order.guests ? (
          <span
            className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[10px] font-semibold ${
              heatColor ? "bg-brand-ink/10" : "bg-white/15"
            }`}
          >
            <IUser className="h-3 w-3" />
            {order.guests}
          </span>
        ) : null}
      </div>
      <div>
        <div className={`text-sm font-bold tabular-nums ${heatColor ? "text-brand-ink" : "text-brand-gold"}`}>
          {fmt(order.total)}
        </div>
        <div className={`flex items-center gap-1 text-[10px] ${heatColor ? "text-brand-ink/60" : "text-white/60"}`}>
          <IClock className="h-3 w-3" />
          {minsAgo(order.createdAt)}
        </div>
      </div>
    </button>
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
  onCreate: (hallId: string, table: string | undefined, guests: number) => void;
}) {
  const [hallId, setHallId] = useState(preset.hall.id);
  const [table, setTable] = useState(preset.table ?? "");
  const [guests, setGuests] = useState(2);
  const [busy, setBusy] = useState(false);
  const fixedTable = preset.table !== undefined;

  async function go() {
    setBusy(true);
    try {
      onCreate(hallId, table || undefined, guests);
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
function OrderView({ id, user, onBack }: { id: string; user: SessionUser; onBack: () => void }) {
  const canComp = ["director", "manager", "cashier"].includes(user.role);
  const canDiscount = ["director", "manager"].includes(user.role);
  // Чек ёпиш = кассир иши (сервер ҳам cashierProcedure билан ҳимоялайди).
  const canClose = canComp;
  const [order, setOrder] = useState<Order | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [paying, setPaying] = useState(false);
  const [compReason, setCompReason] = useState("");
  const [showComp, setShowComp] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
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
  const [unsent, setUnsent] = useState(0);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [tickets, setTickets] = useState<{ id: string; createdAt: string; itemCount: number }[]>([]);
  const [showTickets, setShowTickets] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelErr, setCancelErr] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [online, setOnline] = useState(isOnline());
  const [syncErr, setSyncErr] = useState<string | null>(null);

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

  useEffect(() => {
    refresh();
    // Меню — ўзгармас; оффлайнда кэшдан кўринади (фаза 3 refCache).
    swr("pos.menu", () => trpc.pos.menu.query(), setMenu).catch(() => {});
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
          opId: crypto.randomUUID(),
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
    const cur = order?.items.find((i) => i.productId === productId);
    if (!m && !cur) return;
    const name = m?.name ?? cur?.name ?? "";
    const price = m?.price ?? cur?.price ?? 0;
    const persisted = await enqueueAddItem(id, productId, delta, { name, price });
    if (!persisted) {
      // хотира йўқ — тўғридан-тўғри серверга (идемпотент opId)
      try {
        await trpc.pos.addItem.mutate({ orderId: id, productId, delta, opId: crypto.randomUUID() });
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

  async function setGuests(n: number) {
    await enqueueMeta(id, { guests: Math.max(0, n) });
    const local = await deriveOrder(id);
    if (local) setOrder(local as unknown as Order);
    await flush().catch(() => {});
    refresh();
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
      const t = await trpc.pos.sendToKitchen.mutate({ orderId: id, ticketId: crypto.randomUUID() });
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

  if (ticketId) return <KitchenTicketView ticketId={ticketId} onBack={() => setTicketId(null)} />;
  if (!order) return <Spin />;
  if (order.status === "closed") return <Chek order={order} onBack={onBack} />;

  const menuCats = [...new Set(menu.map((m) => m.category).filter((c): c is string => !!c))];
  const filtered = menu
    .filter((m) => !menuCat || m.category === menuCat)
    .filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()));
  const shown = filtered.slice(0, 120);
  const itemCount = order.items.reduce((s, it) => s + it.qty, 0);
  const empty = order.items.length === 0;

  function cancelPay() {
    setPaying(false);
    setShowComp(false);
    setShowSplit(false);
    setSplits({});
    setPendingDebt(null);
    setShowDiscount(false);
    setDiscount(null);
    setDiscountInput("");
    setDiscountReasonInput("");
    setCloseErr(null);
  }

  const payTotal = order.total - (discount?.amount ?? 0);
  const splitSum = (Object.values(splits) as string[]).reduce(
    (s, v) => s + Math.round(Number(v) || 0),
    0,
  );

  return (
    <div className="space-y-3 pb-24 lg:pb-0">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-zinc-500 transition hover:bg-white hover:text-brand"
        >
          <IBack className="h-4 w-4" />
          Заллар
        </button>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <span className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white">
            {order.hall ?? "Зал"}
          </span>
          {order.tableNo && (
            <span className="rounded-lg bg-brand-cream px-3 py-1.5 text-sm font-semibold text-brand">
              {order.tableNo}
            </span>
          )}
          <button
            onClick={() => setMoving(true)}
            disabled={!online}
            title={online ? "Бошқа столга кўчириш" : "Оффлайн — уланганда"}
            className="grid h-9 w-9 place-items-center rounded-lg text-base text-zinc-400 transition hover:bg-brand-cream hover:text-brand disabled:opacity-30"
          >
            ⇄
          </button>
          <button
            onClick={() => setCancelling((v) => !v)}
            disabled={!online}
            title={online ? "Заказни бекор қилиш" : "Оффлайн — уланганда"}
            className="grid h-9 w-9 place-items-center rounded-lg text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
          >
            <ITrash className="h-4 w-4" />
          </button>
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

      {syncErr && (
        <div className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">⚠️ {syncErr} — синхронизация тўхтади.</div>
      )}
      {!online && (
        <div className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          📴 Оффлайн — таом қўшиш ва кухняга юбориш ишлайди, уланганда синхрон. Тўлов уланганда.
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

      {/* meta: guests + note */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-xl border border-brand-cream-soft bg-white px-1.5 py-1 shadow-sm">
          <IUsers className="mx-1 h-4 w-4 text-brand" />
          <button
            onClick={() => setGuests((order.guests ?? 0) - 1)}
            className="grid h-7 w-7 place-items-center rounded-lg text-brand transition hover:bg-brand-cream active:scale-90 motion-reduce:active:scale-100"
          >
            <IMinus className="h-3.5 w-3.5" />
          </button>
          <span className="w-6 text-center text-sm font-bold tabular-nums text-brand-ink">
            {order.guests ?? "—"}
          </span>
          <button
            onClick={() => setGuests((order.guests ?? 0) + 1)}
            className="grid h-7 w-7 place-items-center rounded-lg text-brand transition hover:bg-brand-cream active:scale-90 motion-reduce:active:scale-100"
          >
            <IPlus className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          onClick={() => setNoteOpen((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm shadow-sm transition ${
            note ? "border-brand-gold/50 bg-brand-gold/10 text-brand-gold-deep" : "border-brand-cream-soft bg-white text-zinc-500 hover:text-brand"
          }`}
        >
          <IPencil className="h-4 w-4" />
          <span className="max-w-[9rem] truncate">{note || "Изоҳ"}</span>
        </button>
      </div>
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        {/* MENU */}
        <section className="order-1 min-w-0 space-y-3">
          <div className="flex items-center gap-2 rounded-2xl border border-brand-cream-soft bg-white px-3.5 py-2.5 shadow-sm">
            <ISearch className="h-4 w-4 shrink-0 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Таом қидириш..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-400"
            />
          </div>
          <div className="flex gap-1.5 overflow-x-auto whitespace-nowrap pb-1">
            <button
              onClick={() => setMenuCat(null)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                menuCat === null ? "bg-brand text-white" : "bg-brand-cream text-brand hover:bg-brand-cream-soft"
              }`}
            >
              Барчаси
            </button>
            {menuCats.map((c) => {
              const color = catColor(c);
              const on = menuCat === c;
              return (
                <button
                  key={c}
                  onClick={() => setMenuCat(c)}
                  style={on ? { backgroundColor: color } : { color }}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                    on ? "text-white" : "bg-brand-cream hover:bg-brand-cream-soft"
                  }`}
                >
                  {!on && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
                  {c}
                </button>
              );
            })}
          </div>
          {shown.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-brand-cream-soft bg-white/60 px-4 py-10 text-center text-sm text-zinc-400">
              топилмади
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {shown.map((m) => {
                const color = catColor(m.category);
                return (
                  <button
                    key={m.id}
                    onClick={() => add(m.id, 1)}
                    style={{ borderLeftColor: color }}
                    className="group flex h-full flex-col justify-between gap-2 rounded-xl border border-l-4 border-brand-cream-soft bg-white p-3 text-left shadow-sm transition hover:border-brand hover:shadow-md active:scale-95 motion-reduce:active:scale-100"
                  >
                    <span className="line-clamp-2 text-sm font-medium leading-snug text-brand-ink">
                      {m.name}
                    </span>
                    <span className="flex items-center justify-between">
                      <span className="text-sm font-bold tabular-nums text-brand">{fmt(m.price)}</span>
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-cream text-brand transition group-hover:bg-brand group-hover:text-white">
                        <IPlus className="h-3.5 w-3.5" />
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {filtered.length > shown.length && (
            <p className="text-center text-xs text-zinc-400">
              яна {filtered.length - shown.length} та — қидирувдан фойдаланинг
            </p>
          )}
        </section>

        {/* CART */}
        <aside className="order-2 min-w-0 space-y-3 lg:sticky lg:top-24 lg:self-start">
          <div className="overflow-hidden rounded-2xl border border-brand-cream-soft bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-brand-cream-soft px-4 py-3">
              <span className="font-semibold text-brand-ink">Заказ</span>
              <span className="text-xs text-zinc-400">{itemCount} таом</span>
            </div>
            {empty ? (
              <div className="grid place-items-center gap-1.5 px-4 py-8 text-center">
                <IPlate className="h-7 w-7 text-brand-cream-soft" />
                <p className="text-sm text-zinc-400">Таом танланг</p>
              </div>
            ) : (
              <div className="max-h-[42vh] divide-y divide-brand-cream-soft/60 overflow-auto lg:max-h-[52vh]">
                {order.items.map((it) => (
                  <div key={it.productId ?? it.id} className="flex items-center gap-2 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-brand-ink">{it.name}</div>
                      <div className="text-xs tabular-nums text-zinc-400">{fmt(it.price)}</div>
                    </div>
                    {it.productId ? (
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
            <div className="space-y-1 border-t border-brand-cream-soft bg-brand-cream/30 px-4 py-3 text-sm">
              <Row label="Оралиқ сумма" value={fmt(order.subtotal)} />
              <Row label={`Хизмат ҳақи (${order.servicePct}%)`} value={fmt(order.service)} muted />
              <div className="flex items-baseline justify-between pt-1">
                <span className="font-bold text-brand-ink">ЖАМИ</span>
                <span className="text-xl font-bold tabular-nums text-brand-ink">
                  {fmt(order.total)} <span className="text-xs font-normal text-zinc-400">so'm</span>
                </span>
              </div>
            </div>
          </div>

          {unsent > 0 && (
            <button
              onClick={sendToKitchen}
              disabled={sending}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-gold py-3 font-semibold text-brand-ink shadow-sm transition hover:bg-brand-gold-deep active:scale-[.99] disabled:opacity-50 motion-reduce:active:scale-100"
            >
              <IFlame className="h-5 w-5" />
              Кухняга юбориш ({unsent} та)
            </button>
          )}

          {tickets.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-brand-cream-soft bg-white shadow-sm">
              <button
                onClick={() => setShowTickets((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-zinc-500 transition hover:bg-brand-cream/30"
              >
                <span className="inline-flex items-center gap-1.5">
                  <IReceipt className="h-4 w-4" />
                  Тикетлар ({tickets.length})
                </span>
                <IChevron className={`h-4 w-4 transition ${showTickets ? "rotate-180" : ""}`} />
              </button>
              {showTickets && (
                <div className="divide-y divide-brand-cream-soft/60 border-t border-brand-cream-soft">
                  {tickets.map((t) => {
                    const d = new Date(t.createdAt);
                    const p = (n: number) => String(n).padStart(2, "0");
                    return (
                      <button
                        key={t.id}
                        onClick={() => setTicketId(t.id)}
                        className="flex w-full items-center justify-between px-4 py-2 text-left text-sm transition hover:bg-brand-cream/30"
                      >
                        <span className="tabular-nums text-zinc-500">
                          {p(d.getHours())}:{p(d.getMinutes())}
                        </span>
                        <span className="tabular-nums text-zinc-400">{t.itemCount} дона</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {canClose && online ? (
            <button
              onClick={() => setPaying(true)}
              disabled={empty}
              className="hidden w-full items-center justify-center gap-2 rounded-2xl bg-brand py-3.5 font-semibold text-white shadow-sm transition hover:bg-brand-deep active:scale-[.99] disabled:opacity-40 lg:flex motion-reduce:active:scale-100"
            >
              <IReceipt className="h-5 w-5" />
              Ёпиш ва чек
            </button>
          ) : (
            <div className="hidden rounded-2xl bg-brand-cream-soft py-3.5 text-center text-sm font-medium text-brand-ink/60 lg:block">
              {!online ? "📴 Тўлов уланганда" : "💳 Чекни кассир ёпади"}
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
                <IFlame className="h-5 w-5" />
                Кухняга ({unsent})
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
              <span className="ml-auto text-sm font-medium text-brand-ink/50">
                {!online ? "📴 Тўлов уланганда" : "💳 Кассир ёпади"}
              </span>
            )}
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
                {discount ? (
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

            {pendingDebt ? (
              <CustomerPicker
                closing={closing}
                onBack={() => setPendingDebt(null)}
                onPick={(customerId) => submitClose(pendingDebt, customerId)}
              />
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
                        onClick={() => pay(m)}
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
                        className="flex-1 rounded-xl bg-brand-gold-deep py-2.5 text-sm font-semibold text-white disabled:opacity-40"
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
                <p className="text-xs font-semibold text-brand-gold-deep">Текин — сабабини ёзинг</p>
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
                    className="flex-1 rounded-xl bg-brand-gold-deep py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-40"
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
  items: { name: string; qty: number; station: string | null }[];
};

function KitchenTicketView({ ticketId, onBack }: { ticketId: string; onBack: () => void }) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [w, setW] = useReceiptWidth();
  useEffect(() => {
    trpc.pos.ticket.query({ ticketId }).then(setTicket).catch(() => {});
  }, [ticketId]);

  if (!ticket) return <Spin />;

  const byStation = new Map<string, { name: string; qty: number }[]>();
  for (const it of ticket.items) {
    const key = it.station ?? "Бошқа";
    const a = byStation.get(key) ?? [];
    a.push({ name: it.name, qty: it.qty });
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
              <div key={i} className="flex justify-between gap-2 text-base">
                <span>{it.name}</span>
                <span className="font-bold tabular-nums">×{it.qty}</span>
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

function Chek({ order, onBack }: { order: Order; onBack: () => void }) {
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
      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-cream text-brand transition hover:bg-brand-cream-soft active:scale-90 motion-reduce:active:scale-100"
    >
      {children}
    </button>
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
