// Node тест (tsx): in-memory store + mock net. Post-review хатти-ҳаракат.
import {
  __reset,
  __setDeps,
  classify,
  deriveOrderFrom,
  enqueueAddItem,
  enqueueCreate,
  enqueueMeta,
  enqueueSendToKitchen,
  flush,
  foldItems,
  getOverlay,
  listOverlayOpenOrders,
  localUnsent,
  mergeOpenOrders,
  type Net,
  type OutboxOp,
  type OverlayHead,
  type Store,
  syncBaseFromServer,
} from "./outbox";

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string) => {
  if (c) pass++;
  else {
    fail++;
    console.log(`✗ FAIL: ${m}`);
  }
};

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
type Mem = { outbox: Map<unknown, unknown>; overlay: Map<unknown, unknown>; kv: Map<unknown, unknown> };
function memStore() {
  const m: Mem = { outbox: new Map(), overlay: new Map(), kv: new Map() };
  const pick = (s: string) => m[s as keyof Mem];
  const keyOf = (s: string, v: any) => (s === "outbox" ? v.seq : s === "overlay" ? v.id : undefined);
  const s: Store = {
    all: async <T,>(store: string) => [...pick(store).values()].map((x) => clone(x)) as T[],
    put: async (store: string, v: unknown, k?: IDBValidKey) => {
      const key = k !== undefined ? k : keyOf(store, v);
      pick(store).set(key, clone(v));
    },
    del: async (store: string, k: IDBValidKey) => {
      pick(store).delete(k);
    },
    getIn: async <T,>(store: string, k: IDBValidKey) => clone(pick(store).get(k)) as T | undefined,
    kvGet: async <T,>(k: string) => clone(m.kv.get(k)) as T | undefined,
    kvSet: async (k: string, v: unknown) => {
      m.kv.set(k, clone(v));
    },
  };
  return { s, m };
}
function mockNet(behavior: (op: OutboxOp) => void = () => {}) {
  const calls: string[] = [];
  const run = (op: OutboxOp) => {
    calls.push(op.kind);
    behavior(op);
    return Promise.resolve({});
  };
  const net: Net = { create: (o) => run(o), addItem: (o) => run(o), updateMeta: (o) => run(o), sendToKitchen: (o) => run(o) };
  return { net, calls };
}
const httpErr = (status: number) => ({ data: { httpStatus: status } });
const oplist = (m: Mem) => [...m.outbox.values()] as OutboxOp[];

const HEAD = (over: Partial<OverlayHead> = {}): OverlayHead => ({
  id: "abcdef01-0000-0000-0000-000000000001",
  hallId: "h1",
  hall: "Асосий",
  tableNo: "5",
  servicePct: 10,
  guests: 2,
  note: null,
  waiter: "Али",
  createdAt: "2026-07-03T10:00:00.000Z",
  base: [],
  error: null,
  ...over,
});
const addOp = (seq: number, productId: string, delta: number, price: number, orderId = HEAD().id): OutboxOp => ({
  kind: "addItem",
  seq,
  tries: 0,
  ts: 0,
  orderId,
  opId: `op${seq}`,
  productId,
  delta,
  name: productId,
  price,
});

async function main() {
  // ── PURE: deriveOrder math + checkNo ──
  {
    const d = deriveOrderFrom(HEAD({ servicePct: 10 }), [addOp(1, "p", 1, 12345)]);
    ok(d.subtotal === 12345, "subtotal Σprice*qty");
    ok(d.service === 1235, "service=round(12345*10/100)=1235");
    ok(d.total === 13580, "total=subtotal+service");
    ok(d.checkNo === "ABCDE", "checkNo=id.slice(0,5).upper");
    ok(deriveOrderFrom(HEAD({ servicePct: 0 }), [addOp(1, "p", 1, 5000)]).service === 0, "servicePct 0 → service 0");
    ok(deriveOrderFrom(HEAD({ servicePct: 15 }), [addOp(1, "p", 1, 3333)]).service === 500, "servicePct 15 → 500");
  }
  // ── PURE: foldItems + BASE snapshot ──
  {
    const items = foldItems(HEAD(), [addOp(1, "p", 1, 100), addOp(2, "p", 1, 100)]);
    ok(items.length === 1 && items[0]?.qty === 2, "two +1 → qty 2");
    ok(items[0]?.id === "local:p" && items[0]?.productId === "p", "synthetic id local:<pid>");
    ok(foldItems(HEAD(), [addOp(1, "p", 2, 100), addOp(2, "p", -3, 100)]).length === 0, "-1 to <=0 drops row");
    // base seeding: server had 2× p, add +1 → qty 3
    const withBase = HEAD({ base: [{ id: "local:p", productId: "p", name: "Шашлик", price: 30000, qty: 2 }] });
    const folded = foldItems(withBase, [addOp(1, "p", 1, 30000)]);
    ok(folded.length === 1 && folded[0]?.qty === 3, "base(2)+op(+1) → qty 3 (server baseline + offline edit)");
    ok(deriveOrderFrom(withBase, [addOp(1, "p", 1, 30000)]).subtotal === 90000, "derive folds base+ops for subtotal");
    // passthrough: productId-less server row survives
    const pt = foldItems(HEAD({ base: [{ id: "srv:x", productId: null, name: "X", price: 5, qty: 1 }] }), []);
    ok(pt.length === 1 && pt[0]?.productId === null, "productId-less base row passes through");
  }
  // ── PURE: classify (post-review categories) ──
  {
    ok(classify(httpErr(401)) === "auth", "401 → auth (do NOT drop)");
    ok(classify(httpErr(403)) === "op-rejected", "403 → op-rejected");
    ok(classify(httpErr(400)) === "op-rejected", "400 → op-rejected");
    ok(classify(httpErr(404)) === "order-gone", "404 → order-gone");
    ok(classify(httpErr(410)) === "order-gone", "410 → order-gone");
    ok(classify(httpErr(408)) === "retry", "408 → retry");
    ok(classify(httpErr(429)) === "retry", "429 → retry");
    ok(classify(httpErr(500)) === "retry", "500 → retry");
    ok(classify(new TypeError("fetch failed")) === "net", "TypeError → net");
    ok(classify(new SyntaxError("Unexpected token < in JSON")) === "retry", "parse error → retry (capped)");
  }
  // ── PURE: mergeOpenOrders ──
  {
    const merged = mergeOpenOrders([{ id: "a" }], [{ id: "a" }, { id: "b" }]);
    ok(merged.length === 2 && merged.some((o) => o.id === "b"), "merge: local-only appended, dup skipped");
  }

  // ── STATEFUL: enqueue returns boolean; idb-blocked → false ──
  {
    __reset();
    const { s } = memStore();
    __setDeps(s, mockNet().net);
    ok((await enqueueCreate({ id: "x1", hallId: "h1", hall: "A", servicePct: 10, waiter: null })) === true, "enqueueCreate ok → true");
    ok((await enqueueAddItem("x1", "p", 1, { name: "p", price: 1 })) === true, "enqueueAddItem ok → true");
    const throwStore: Store = {
      all: async () => { throw new Error("blocked"); },
      put: async () => { throw new Error("blocked"); },
      del: async () => { throw new Error("blocked"); },
      getIn: async () => { throw new Error("blocked"); },
      kvGet: async () => { throw new Error("blocked"); },
      kvSet: async () => { throw new Error("blocked"); },
    };
    __setDeps(throwStore, mockNet().net);
    ok((await enqueueCreate({ id: "x2", hallId: "h1", hall: "A", servicePct: 10, waiter: null })) === false, "idb-blocked create → false (caller online-fallback)");
    ok((await enqueueAddItem("x2", "p", 1, { name: "p", price: 1 })) === false, "idb-blocked addItem → false");
  }
  // ── STATEFUL: enqueueMeta collapse — fresh seq (flush del cannot clobber) ──
  {
    __reset();
    const { s, m } = memStore();
    __setDeps(s, mockNet().net);
    await enqueueCreate({ id: HEAD().id, hallId: "h1", hall: "A", servicePct: 10, guests: 2, waiter: "Али" });
    await enqueueMeta(HEAD().id, { guests: 4 });
    const firstMetaSeq = (oplist(m).find((o) => o.kind === "updateMeta") as any).seq;
    await enqueueMeta(HEAD().id, { guests: 6 });
    const metas = oplist(m).filter((o) => o.kind === "updateMeta") as any[];
    ok(metas.length === 1, "meta collapses to one op");
    ok(metas[0].guests === 6, "collapse keeps last value");
    ok(metas[0].seq !== firstMetaSeq, "collapsed op gets a FRESH seq (old del cannot clobber)");
    ok(metas[0].tries === 0, "collapsed op gets fresh tries budget");
    ok((await getOverlay(HEAD().id))?.guests === 6, "overlay head patched to latest");
  }
  // ── STATEFUL: nextSeq concurrent — no shared seq ──
  {
    __reset();
    const { s, m } = memStore();
    __setDeps(s, mockNet().net);
    const id = "seqrace-0000-0000-0000-000000000001";
    await enqueueCreate({ id, hallId: "h1", hall: "A", servicePct: 10, waiter: null });
    // fire 5 concurrent addItems (race the read-increment-write)
    await Promise.all([1, 2, 3, 4, 5].map(() => enqueueAddItem(id, "p", 1, { name: "p", price: 1 })));
    const seqs = oplist(m).map((o) => o.seq);
    ok(new Set(seqs).size === seqs.length, "concurrent enqueue → all seqs unique (serial lock)");
    ok(oplist(m).length === 6, "no op overwritten (1 create + 5 adds)");
  }
  // ── STATEFUL: flush FIFO ──
  {
    __reset();
    const { s } = memStore();
    const { net, calls } = mockNet();
    __setDeps(s, net);
    const id = "bbbb2222-0000-0000-0000-000000000001";
    await enqueueCreate({ id, hallId: "h1", hall: "A", servicePct: 10, waiter: null });
    await enqueueAddItem(id, "p", 1, { name: "p", price: 100 });
    await enqueueSendToKitchen(id);
    await flush();
    ok(JSON.stringify(calls) === JSON.stringify(["create", "addItem", "sendToKitchen"]), "flush FIFO");
  }
  // ── STATEFUL: op deleted only after resolve; net keeps op + stops ──
  {
    __reset();
    const { s, m } = memStore();
    const { net } = mockNet((op) => { if (op.kind === "addItem") throw new TypeError("offline"); });
    __setDeps(s, net);
    const id = "cccc3333-0000-0000-0000-000000000001";
    await enqueueCreate({ id, hallId: "h1", hall: "A", servicePct: 10, waiter: null });
    await enqueueAddItem(id, "p", 1, { name: "p", price: 100 });
    await enqueueSendToKitchen(id);
    await flush();
    const kinds = oplist(m).map((o) => o.kind);
    ok(!kinds.includes("create"), "create ok → removed");
    ok(kinds.includes("addItem") && kinds.includes("sendToKitchen"), "net error → op + all later RETAINED (FIFO stop)");
  }
  // ── STATEFUL: 401 auth → STOP, keep queue (no data loss) ──
  {
    __reset();
    const { s, m } = memStore();
    let expired = true;
    const net: Net = {
      create: () => (expired ? Promise.reject(httpErr(401)) : Promise.resolve({})),
      addItem: () => Promise.resolve({}),
      updateMeta: () => Promise.resolve({}),
      sendToKitchen: () => Promise.resolve({}),
    };
    __setDeps(s, net);
    const id = "auth1111-0000-0000-0000-000000000001";
    await enqueueCreate({ id, hallId: "h1", hall: "A", servicePct: 10, waiter: null });
    await enqueueAddItem(id, "p", 1, { name: "p", price: 100 });
    await flush();
    ok(oplist(m).length === 2, "401: queue PRESERVED (create+addItem still there), not dropped");
    ok((m.overlay.get(id) as any)?.error == null, "401: order NOT errored");
    expired = false;
    await flush(); // after re-login
    ok(oplist(m).length === 0, "401: after re-auth, queue drains");
  }
  // ── STATEFUL: op-rejected (403) drops only that op, order lives ──
  {
    __reset();
    const { s, m } = memStore();
    const id = "rej11111-0000-0000-0000-000000000001";
    const net: Net = {
      create: () => Promise.resolve({}),
      addItem: () => Promise.reject(httpErr(403)),
      updateMeta: () => Promise.resolve({}),
      sendToKitchen: () => Promise.resolve({}),
    };
    __setDeps(s, net);
    await enqueueCreate({ id, hallId: "h1", hall: "A", servicePct: 10, waiter: null });
    await enqueueAddItem(id, "p", 1, { name: "p", price: 100 });
    await enqueueSendToKitchen(id);
    await flush();
    ok(oplist(m).length === 0, "403: only the addItem dropped, create+send still delivered");
    ok((m.overlay.get(id) as any)?.error == null, "403: order NOT errored (still live)");
  }
  // ── STATEFUL: order-gone (404) on create drops order; good order continues ──
  {
    __reset();
    const { s, m } = memStore();
    const badId = "eeee5555-0000-0000-0000-000000000001";
    const goodId = "ffff6666-0000-0000-0000-000000000001";
    const net: Net = {
      create: (o) => (o.orderId === badId ? Promise.reject(httpErr(404)) : Promise.resolve({})),
      addItem: () => Promise.resolve({}),
      updateMeta: () => Promise.resolve({}),
      sendToKitchen: () => Promise.resolve({}),
    };
    __setDeps(s, net);
    await enqueueCreate({ id: badId, hallId: "h1", hall: "A", servicePct: 10, waiter: null });
    await enqueueAddItem(badId, "p", 2, { name: "Шашлик", price: 30000 });
    await enqueueCreate({ id: goodId, hallId: "h1", hall: "A", servicePct: 10, waiter: null });
    await flush();
    ok(oplist(m).length === 0, "404: bad order's ops dropped, good order flushed");
    ok((m.overlay.get(badId) as any)?.error != null, "404: bad order errored (visible, not silent)");
    // #19: content snapshotted to base — errored order still shows its items
    const badDerived = await import("./outbox").then((mod) => mod.deriveOrder(badId));
    ok(badDerived?.items.length === 1 && badDerived.items[0]?.qty === 2, "404: errored order RETAINS captured items (base snapshot, not lost)");
  }
  // ── STATEFUL: order-gone (404) on updateMeta drops ONLY meta, keeps siblings ──
  {
    __reset();
    const { s, m } = memStore();
    const id = "meta4041-0000-0000-0000-000000000001";
    const net: Net = {
      create: () => Promise.resolve({}),
      addItem: () => Promise.resolve({}),
      updateMeta: () => Promise.reject(httpErr(404)),
      sendToKitchen: () => Promise.resolve({}),
    };
    __setDeps(s, net);
    await enqueueCreate({ id, hallId: "h1", hall: "A", servicePct: 10, waiter: null });
    await enqueueMeta(id, { guests: 4 });
    await enqueueAddItem(id, "p", 1, { name: "p", price: 100 });
    await flush();
    ok(oplist(m).length === 0, "updateMeta 404: meta dropped, create+addItem still delivered");
    ok((m.overlay.get(id) as any)?.error == null, "updateMeta 404: order NOT poisoned");
  }
  // ── STATEFUL: retry (5xx) DEFERS this order, others continue same pass ──
  {
    __reset();
    const { s, m } = memStore();
    const aId = "aaaa0001-0000-0000-0000-000000000001";
    const bId = "bbbb0002-0000-0000-0000-000000000001";
    const net: Net = {
      create: (o) => (o.orderId === aId ? Promise.reject(httpErr(500)) : Promise.resolve({})),
      addItem: () => Promise.resolve({}),
      updateMeta: () => Promise.resolve({}),
      sendToKitchen: () => Promise.resolve({}),
    };
    __setDeps(s, net);
    await enqueueCreate({ id: aId, hallId: "h1", hall: "A", servicePct: 10, waiter: null });
    await enqueueAddItem(aId, "p", 1, { name: "p", price: 1 });
    await enqueueCreate({ id: bId, hallId: "h1", hall: "A", servicePct: 10, waiter: null });
    await flush();
    const aOps = oplist(m).filter((o) => o.orderId === aId);
    ok(aOps.length === 2 && (aOps[0]?.tries ?? 0) >= 1, "retry: order A deferred (ops kept, tries++)");
    ok(oplist(m).filter((o) => o.orderId === bId).length === 0, "retry: unrelated order B still flushed (loop not wedged)");
  }
  // ── STATEFUL: poison cap (5xx × 5) drops order + seeds dropped (no orphan children) ──
  {
    __reset();
    const { s, m } = memStore();
    const id = "aaaa7777-0000-0000-0000-000000000001";
    let addCalls = 0;
    const net: Net = {
      create: () => Promise.reject(httpErr(500)),
      addItem: () => { addCalls++; return Promise.resolve({}); },
      updateMeta: () => Promise.resolve({}),
      sendToKitchen: () => Promise.resolve({}),
    };
    __setDeps(s, net);
    await enqueueCreate({ id, hallId: "h1", hall: "A", servicePct: 10, waiter: null });
    await enqueueAddItem(id, "p", 1, { name: "p", price: 1 });
    for (let i = 0; i < 5; i++) await flush();
    ok(oplist(m).length === 0, "poison: create + child addItem both purged after 5 tries");
    ok(addCalls === 0, "poison: orphan child addItem NEVER dispatched (dropped seeded)");
    ok((m.overlay.get(id) as any)?.error != null, "poison: overlay errored");
  }
  // ── STATEFUL: single-flight ──
  {
    __reset();
    const { s } = memStore();
    const { net, calls } = mockNet();
    __setDeps(s, net);
    const id = "cccc9999-0000-0000-0000-000000000001";
    await enqueueCreate({ id, hallId: "h1", hall: "A", servicePct: 10, waiter: null });
    await enqueueAddItem(id, "p", 1, { name: "p", price: 100 });
    await Promise.all([flush(), flush()]);
    ok(calls.length === 2, "single-flight: each op sent exactly once under concurrent flush");
  }
  // ── STATEFUL: syncBaseFromServer round-trip + closed deletes overlay ──
  {
    __reset();
    const { s, m } = memStore();
    __setDeps(s, mockNet().net);
    const id = "sync0001-0000-0000-0000-000000000001";
    await syncBaseFromServer({
      id, tableNo: "5", servicePct: 10, hall: "Асосий", waiter: "Али", guests: 2, note: null,
      createdAt: "2026-07-03T10:00:00.000Z", status: "open",
      items: [{ productId: "p", name: "Шашлик", price: 30000, qty: 2 }],
    });
    const d = await import("./outbox").then((mod) => mod.deriveOrder(id));
    ok(d?.subtotal === 60000, "syncBaseFromServer: base cached, derive uses it (2×30000)");
    await syncBaseFromServer({
      id, tableNo: "5", servicePct: 10, hall: "Асосий", waiter: "Али", guests: 2, note: null,
      createdAt: "x", status: "closed", items: [],
    });
    ok(m.overlay.get(id) === undefined, "syncBaseFromServer closed → overlay deleted");
  }
  // ── STATEFUL: listOverlay includes errored + pending; localUnsent after-send ──
  {
    __reset();
    const { s } = memStore();
    __setDeps(s, mockNet().net);
    const id = "dddd0000-0000-0000-0000-000000000001";
    await enqueueCreate({ id, hallId: "h1", hall: "Асосий", tableNo: "5", servicePct: 10, guests: 2, waiter: "Али" });
    await enqueueAddItem(id, "p", 2, { name: "Шашлик", price: 30000 });
    const open = await listOverlayOpenOrders();
    ok(open.length === 1 && open[0]?.qty === 2 && open[0]?.total === 66000, "listOverlay: pending shown, qty/total derived");
    ok((await localUnsent(id)) === 2, "localUnsent: no send → 2");
    await enqueueSendToKitchen(id);
    ok((await localUnsent(id)) === 0, "localUnsent: all sent → 0");
    await enqueueAddItem(id, "q", 3, { name: "Салат", price: 10000 });
    ok((await localUnsent(id)) === 3, "localUnsent: 3 added AFTER send → 3 (not hidden)");
  }

  __reset();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();
