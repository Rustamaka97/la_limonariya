// Offline order-capture движоки (фаза 4-5). Ҳақиқат манбаи = append-only op-log
// ("outbox") + overlay head (server baseline snapshot). Заказ элементлари
// base + addItem op'ларини FOLD қилиб ҳосил қилинади. Сервер мутациялари
// идемпотент (фаза 1-2) — reconnect'да қайта юбориш хавфсиз.
import { idbAll, idbDel, idbGetIn, idbPut } from "./idb";
import { idbGet, idbSet } from "./idb";
import { trpc } from "../trpc";

const OUTBOX = "outbox";
const OVERLAY = "overlay";
const SEQ_KEY = "outbox.seq";
const MAX_TRIES = 5;

// ── типлар ────────────────────────────────────────────────────────────────
export type OutboxOp = { seq: number; tries: number; ts: number } & (
  | {
      kind: "create";
      orderId: string;
      hallId: string;
      hall: string | null;
      tableNo?: string;
      servicePct: number;
      guests?: number;
      note?: string;
      waiter: string | null;
    }
  | { kind: "addItem"; orderId: string; opId: string; productId: string; delta: number; name: string; price: number }
  | { kind: "updateMeta"; orderId: string; guests?: number; note?: string }
  | { kind: "sendToKitchen"; orderId: string; opId: string }
);

export type LocalItem = { id: string; productId: string | null; name: string; price: number; qty: number };

export type OverlayHead = {
  id: string;
  hallId: string;
  hall: string | null;
  tableNo: string | null;
  servicePct: number;
  guests: number | null;
  note: string | null;
  waiter: string | null;
  createdAt: string;
  base: LocalItem[]; // сервердаги охирги ҳолат snapshot'и ([] = ҳали синхронланмаган)
  error: string | null;
};

export type LocalOrder = {
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
  items: LocalItem[];
  payments: { method: string; amount: number }[];
  subtotal: number;
  service: number;
  total: number;
};
export type LocalOpen = {
  id: string;
  tableNo: string | null;
  hallId: string;
  guests: number | null;
  hall: string | null;
  waiter: string | null;
  qty: number;
  total: number;
  createdAt: string;
  error?: string | null;
};

// ── инжекция қилинадиган боғлиқликлар (тестда override) ─────────────────────
export type Store = {
  all: <T>(store: string) => Promise<T[]>;
  put: (store: string, v: unknown, k?: IDBValidKey) => Promise<void>;
  del: (store: string, k: IDBValidKey) => Promise<void>;
  getIn: <T>(store: string, k: IDBValidKey) => Promise<T | undefined>;
  kvGet: <T>(k: string) => Promise<T | undefined>;
  kvSet: (k: string, v: unknown) => Promise<void>;
};
export type Net = {
  create: (o: Extract<OutboxOp, { kind: "create" }>) => Promise<unknown>;
  addItem: (o: Extract<OutboxOp, { kind: "addItem" }>) => Promise<unknown>;
  updateMeta: (o: Extract<OutboxOp, { kind: "updateMeta" }>) => Promise<unknown>;
  sendToKitchen: (o: Extract<OutboxOp, { kind: "sendToKitchen" }>) => Promise<unknown>;
};

const realStore: Store = { all: idbAll, put: idbPut, del: idbDel, getIn: idbGetIn, kvGet: idbGet, kvSet: idbSet };
const realNet: Net = {
  create: (o) => trpc.pos.create.mutate({ id: o.orderId, hallId: o.hallId, tableNo: o.tableNo, guests: o.guests, note: o.note }),
  addItem: (o) => trpc.pos.addItem.mutate({ orderId: o.orderId, productId: o.productId, delta: o.delta, opId: o.opId }),
  updateMeta: (o) => trpc.pos.updateMeta.mutate({ id: o.orderId, guests: o.guests, note: o.note }),
  sendToKitchen: (o) => trpc.pos.sendToKitchen.mutate({ orderId: o.orderId, ticketId: o.opId }),
};
let store: Store = realStore;
let net: Net = realNet;

// ── соф функциялар (idb'сиз, тўғридан-тўғри тестланади) ─────────────────────
export function foldItems(head: OverlayHead, ops: OutboxOp[]): LocalItem[] {
  const m = new Map<string, { name: string; price: number; qty: number }>();
  const passthrough: LocalItem[] = []; // productId'сиз server қаторлари (offline таҳрирланмайди)
  for (const b of head.base ?? []) {
    if (b.productId) m.set(b.productId, { name: b.name, price: b.price, qty: b.qty });
    else passthrough.push(b);
  }
  for (const op of ops
    .filter((o): o is Extract<OutboxOp, { kind: "addItem" }> => o.kind === "addItem" && o.orderId === head.id)
    .sort((a, b) => a.seq - b.seq)) {
    const cur = m.get(op.productId) ?? { name: op.name, price: op.price, qty: 0 };
    cur.qty += op.delta;
    if (cur.qty <= 0) m.delete(op.productId);
    else m.set(op.productId, cur);
  }
  return [
    ...passthrough,
    ...[...m.entries()].map(([productId, v]) => ({ id: `local:${productId}`, productId, name: v.name, price: v.price, qty: v.qty })),
  ];
}

export function deriveOrderFrom(head: OverlayHead, ops: OutboxOp[]): LocalOrder {
  const items = foldItems(head, ops);
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const service = Math.round((subtotal * head.servicePct) / 100);
  return {
    id: head.id,
    checkNo: head.id.slice(0, 5).toUpperCase(),
    tableNo: head.tableNo,
    status: "open",
    servicePct: head.servicePct,
    hall: head.hall,
    waiter: head.waiter,
    guests: head.guests,
    note: head.note,
    createdAt: head.createdAt,
    isComp: false,
    compReason: null,
    discountAmount: 0,
    discountReason: null,
    items,
    payments: [],
    subtotal,
    service,
    total: subtotal + service,
  };
}

// TRPCClientError'ни таснифлаш:
//   net        — тармоқ узилди (status йўқ, fetch хатоси) → ТЎХТА, FIFO сақлансин
//   auth       — 401 (сессия эскирган) → ТЎХТА + қайта-логин; навбат сақланади
//   order-gone — 404/410 (заказ серверда йўқ) → шу заказ ўлик
//   op-rejected— 400/403/409/413/422 (шу op рад этилди) → фақат шу op ташланади
//   retry      — 5xx / 408 / 425 / 429 / parse-хатоси → tries++ (poison cap 5)
export type ErrClass = "net" | "auth" | "order-gone" | "op-rejected" | "retry";
export function classify(err: unknown): ErrClass {
  const e = err as {
    data?: { httpStatus?: number };
    shape?: { data?: { httpStatus?: number } };
    name?: string;
    message?: string;
    cause?: { name?: string };
  };
  const status = e?.data?.httpStatus ?? e?.shape?.data?.httpStatus;
  if (typeof status === "number") {
    if (status === 401) return "auth";
    if (status === 408 || status === 425 || status === 429) return "retry";
    if (status >= 500) return "retry";
    if (status === 404 || status === 410) return "order-gone";
    return "op-rejected"; // бошқа 4xx (400/403/409/413/422...)
  }
  // status йўқ: JSON parse хатоси (нуқсонли 5xx body) → capped retry, акс ҳолда тармоқ.
  const isParse =
    e?.name === "SyntaxError" ||
    e?.cause?.name === "SyntaxError" ||
    /JSON|Unexpected token/i.test(String(e?.message ?? ""));
  return isParse ? "retry" : "net";
}

export function mergeOpenOrders<T extends { id: string }>(server: T[], local: T[]): T[] {
  const ids = new Set(server.map((o) => o.id));
  return [...server, ...local.filter((o) => !ids.has(o.id))];
}

// ── seq counter (сериал lock: concurrent enqueue seq'ни бузмайди) ───────────
let seqCache: number | null = null;
let seqLock: Promise<number> = Promise.resolve(0);
async function nextSeq(): Promise<number> {
  seqLock = seqLock.then(async () => {
    if (seqCache === null) seqCache = (await store.kvGet<number>(SEQ_KEY)) ?? 0;
    seqCache += 1;
    await store.kvSet(SEQ_KEY, seqCache);
    return seqCache;
  });
  return seqLock;
}

// ── enqueue (boolean қайтаради: false = idb ёзолмади → чақирувчи online-only) ─
export async function enqueueCreate(p: {
  id: string;
  hallId: string;
  hall: string | null;
  tableNo?: string;
  servicePct: number;
  guests?: number;
  note?: string;
  waiter: string | null;
}): Promise<boolean> {
  try {
    const seq = await nextSeq();
    // Op АВВАЛ ёзилади: узилса ҳам сервер заказни ярата олади (head кейин).
    await store.put(OUTBOX, {
      kind: "create",
      seq,
      tries: 0,
      ts: Date.now(),
      orderId: p.id,
      hallId: p.hallId,
      hall: p.hall,
      tableNo: p.tableNo,
      servicePct: p.servicePct,
      guests: p.guests,
      note: p.note,
      waiter: p.waiter,
    } satisfies OutboxOp);
    const head: OverlayHead = {
      id: p.id,
      hallId: p.hallId,
      hall: p.hall,
      tableNo: p.tableNo ?? null,
      servicePct: p.servicePct,
      guests: p.guests ?? null,
      note: p.note ?? null,
      waiter: p.waiter,
      createdAt: new Date().toISOString(),
      base: [],
      error: null,
    };
    await store.put(OVERLAY, head);
    return true;
  } catch {
    return false;
  }
}

export async function enqueueAddItem(
  orderId: string,
  productId: string,
  delta: number,
  menu: { name: string; price: number },
  opId = crypto.randomUUID(),
): Promise<boolean> {
  try {
    const seq = await nextSeq();
    await store.put(OUTBOX, {
      kind: "addItem",
      seq,
      tries: 0,
      ts: Date.now(),
      orderId,
      opId,
      productId,
      delta,
      name: menu.name,
      price: menu.price,
    } satisfies OutboxOp);
    return true;
  } catch {
    return false;
  }
}

export async function enqueueMeta(orderId: string, patch: { guests?: number; note?: string }): Promise<boolean> {
  try {
    const head = await store.getIn<OverlayHead>(OVERLAY, orderId);
    if (head) {
      if (patch.guests !== undefined) head.guests = patch.guests;
      if (patch.note !== undefined) head.note = patch.note;
      await store.put(OVERLAY, head);
    }
    // Collapse — фақат flush ишламаётганда (in-flight op'ни clobber қилмаслик).
    const ops = await store.all<OutboxOp>(OUTBOX);
    const existing = ops.find((o) => o.kind === "updateMeta" && o.orderId === orderId) as
      | Extract<OutboxOp, { kind: "updateMeta" }>
      | undefined;
    if (existing && !flushing) {
      await store.del(OUTBOX, existing.seq); // эски seq'ни ўчириб, ЯНГИ seq (fresh tries/ts)
      const seq = await nextSeq();
      await store.put(OUTBOX, {
        kind: "updateMeta",
        seq,
        tries: 0,
        ts: Date.now(),
        orderId,
        guests: patch.guests ?? existing.guests,
        note: patch.note ?? existing.note,
      } satisfies OutboxOp);
    } else {
      const seq = await nextSeq();
      await store.put(OUTBOX, { kind: "updateMeta", seq, tries: 0, ts: Date.now(), orderId, ...patch } satisfies OutboxOp);
    }
    return true;
  } catch {
    return false;
  }
}

export async function enqueueSendToKitchen(orderId: string): Promise<boolean> {
  try {
    const seq = await nextSeq();
    await store.put(OUTBOX, {
      kind: "sendToKitchen",
      seq,
      tries: 0,
      ts: Date.now(),
      orderId,
      opId: crypto.randomUUID(),
    } satisfies OutboxOp);
    return true;
  } catch {
    return false;
  }
}

// Сервер заказини локал overlay'га baseline сифатида ёзиш (кейинги offline
// таҳрирлар шу base устига fold бўлади). status "closed" бўлса — overlay ўчади.
export async function syncBaseFromServer(
  o: {
    id: string;
    hallId?: string;
    tableNo: string | null;
    servicePct: number;
    hall: string | null;
    waiter: string | null;
    guests: number | null;
    note: string | null;
    createdAt: string;
    status: string;
    items: { productId: string | null; name: string; price: number; qty: number }[];
  },
): Promise<void> {
  try {
    if (o.status === "closed") {
      await store.del(OVERLAY, o.id);
      return;
    }
    const prev = await store.getIn<OverlayHead>(OVERLAY, o.id);
    const head: OverlayHead = {
      id: o.id,
      hallId: o.hallId ?? prev?.hallId ?? "",
      hall: o.hall,
      tableNo: o.tableNo,
      servicePct: o.servicePct,
      guests: o.guests,
      note: o.note,
      waiter: o.waiter,
      createdAt: o.createdAt,
      base: o.items.map((it) => ({
        id: it.productId ? `local:${it.productId}` : `srv:${it.name}`,
        productId: it.productId,
        name: it.name,
        price: it.price,
        qty: it.qty,
      })),
      error: null,
    };
    await store.put(OVERLAY, head);
  } catch {
    /* noop */
  }
}

// ── ўқиш ───────────────────────────────────────────────────────────────────
export async function getOverlay(id: string): Promise<OverlayHead | undefined> {
  try {
    return await store.getIn<OverlayHead>(OVERLAY, id);
  } catch {
    return undefined;
  }
}

export async function deriveOrder(id: string): Promise<LocalOrder | null> {
  const head = await getOverlay(id);
  if (!head) return null;
  const ops = await store.all<OutboxOp>(OUTBOX).catch(() => [] as OutboxOp[]);
  return deriveOrderFrom(head, ops.filter((o) => o.orderId === id));
}

export async function pendingOpsFor(id: string): Promise<number> {
  try {
    const ops = await store.all<OutboxOp>(OUTBOX);
    return ops.filter((o) => o.orderId === id).length;
  } catch {
    return 0;
  }
}

export async function listOverlayOpenOrders(): Promise<LocalOpen[]> {
  try {
    const overlays = await store.all<OverlayHead>(OVERLAY);
    const ops = await store.all<OutboxOp>(OUTBOX);
    const pendingIds = new Set(ops.map((o) => o.orderId));
    // Кўрсатиладиган: кутилаётган op'и борлар ЁКИ хатолилар (йўқолмасин). Тоза
    // синхронланган (op'сиз, хатосиз) overlay'лар — сервер ўзи қайтаради → скип.
    return overlays
      .filter((h) => pendingIds.has(h.id) || h.error)
      .map((h) => {
        const d = deriveOrderFrom(h, ops.filter((o) => o.orderId === h.id));
        return {
          id: h.id,
          tableNo: h.tableNo,
          hallId: h.hallId,
          guests: h.guests,
          hall: h.hall,
          waiter: h.waiter,
          qty: d.items.reduce((s, i) => s + i.qty, 0),
          total: d.total,
          createdAt: h.createdAt,
          error: h.error,
        };
      });
  } catch {
    return [];
  }
}

// Юборилмаган миқдор: охирги queued sendToKitchen'дан КЕЙИН қўшилганлар.
export async function localUnsent(id: string): Promise<number> {
  try {
    const ops = (await store.all<OutboxOp>(OUTBOX)).filter((o) => o.orderId === id);
    const head = await getOverlay(id);
    if (!head) return 0;
    const total = deriveOrderFrom(head, ops).items.reduce((s, i) => s + i.qty, 0);
    const sends = ops.filter((o) => o.kind === "sendToKitchen").map((o) => o.seq);
    if (sends.length === 0) return total;
    const lastSend = Math.max(...sends);
    // base + охирги send'гача бўлган op'лар = «аллақачон юборилган»
    const coveredHead = { ...head };
    const covered = deriveOrderFrom(coveredHead, ops.filter((o) => o.seq <= lastSend)).items.reduce((s, i) => s + i.qty, 0);
    return Math.max(0, total - covered);
  } catch {
    return 0;
  }
}

async function markError(orderId: string, kind: "order-gone" | "retry"): Promise<void> {
  const h = await getOverlay(orderId);
  if (!h) return;
  // Йўқолаётган content'ни base'га snapshot қиламиз: op'лар ўчгач ҳам errored
  // тайлда таомлар кўринади (директор/официант қўлда қайта киритиши учун).
  const ops = await store.all<OutboxOp>(OUTBOX).catch(() => [] as OutboxOp[]);
  h.base = deriveOrderFrom(h, ops.filter((o) => o.orderId === orderId)).items;
  h.error = kind === "order-gone" ? "Заказ серверда топилмади" : "Синхронизация хатоси";
  await store.put(OVERLAY, h);
}

function emit(name: string): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(name));
}

// ── flush (single-flight; FIFO; per-order isolation; poison cap) ────────────
let flushing = false;
let rerun = false;

export async function flush(onDrain?: () => void): Promise<void> {
  if (flushing) {
    rerun = true;
    return;
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  flushing = true;
  try {
    const ops = (await store.all<OutboxOp>(OUTBOX)).sort((a, b) => a.seq - b.seq);
    const dropped = new Set<string>(); // ўлик заказлар — қолган op'лари ЎЧИРИЛАДИ
    const deferred = new Set<string>(); // вақтинча (retry) — op'лари САҚЛАНАДИ
    for (const op of ops) {
      if (dropped.has(op.orderId)) {
        await store.del(OUTBOX, op.seq);
        continue;
      }
      if (deferred.has(op.orderId)) continue; // бу заказ кейинги tick'да
      try {
        if (op.kind === "create") await net.create(op);
        else if (op.kind === "addItem") await net.addItem(op);
        else if (op.kind === "updateMeta") await net.updateMeta(op);
        else await net.sendToKitchen(op);
        await store.del(OUTBOX, op.seq); // фақат resolve'дан КЕЙИН
      } catch (e) {
        const cls = classify(e);
        if (cls === "net") return; // тармоқ — ҳаммасини тўхтат, FIFO сақлансин
        if (cls === "auth") {
          emit("outbox:auth"); // сессия эскирган → қайта-логин; навбат сақланади
          return;
        }
        if (cls === "op-rejected") {
          await store.del(OUTBOX, op.seq); // фақат шу op рад — заказ тирик, давом
          continue;
        }
        if (cls === "order-gone") {
          if (op.kind === "updateMeta") {
            await store.del(OUTBOX, op.seq); // ёпилган заказга мета — кутилган, жим ташла
            continue;
          }
          await markError(op.orderId, "order-gone");
          await store.del(OUTBOX, op.seq);
          dropped.add(op.orderId);
          continue;
        }
        // retry (5xx/408/429/parse)
        op.tries = (op.tries ?? 0) + 1;
        if (op.tries >= MAX_TRIES) {
          await markError(op.orderId, "retry");
          await store.del(OUTBOX, op.seq);
          dropped.add(op.orderId); // poison → қолган op'лари ҳам ўлик (orphan child'сиз)
          continue;
        }
        await store.put(OUTBOX, op); // tries сақла
        deferred.add(op.orderId); // бошқа заказлар давом этсин (loop қотмайди)
        continue;
      }
    }
    onDrain?.();
    emit("outbox:drain");
  } finally {
    flushing = false;
    if (rerun) {
      rerun = false;
      await flush(onDrain);
    }
  }
}

export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

export function startOutbox(onDrain?: () => void): () => void {
  const kick = () => {
    void flush(onDrain);
  };
  if (typeof window !== "undefined") window.addEventListener("online", kick);
  const iv = setInterval(kick, 15000);
  kick();
  return () => {
    if (typeof window !== "undefined") window.removeEventListener("online", kick);
    clearInterval(iv);
  };
}

// ── тест-only ──────────────────────────────────────────────────────────────
export function __setDeps(s: Store, n: Net): void {
  store = s;
  net = n;
}
export function __reset(): void {
  store = realStore;
  net = realNet;
  seqCache = null;
  seqLock = Promise.resolve(0);
  flushing = false;
  rerun = false;
}
