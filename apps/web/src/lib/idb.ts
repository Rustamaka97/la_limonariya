// Юпқа IndexedDB store (dependency'сиз). "limon" базаси, v2:
//   kv      — refCache (фаза 3), out-of-line калит
//   outbox  — offline мутация навбати (фаза 4), keyPath "seq"
//   overlay — локал заказ head'лари (фаза 4), keyPath "id"
const DB = "limon";
const KV = "kv";
const OUTBOX = "outbox";
const OVERLAY = "overlay";

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Аддитив — мавжуд "kv" (фаза 3 кэш) тегилмайди.
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: "seq" });
      if (!db.objectStoreNames.contains(OVERLAY)) db.createObjectStore(OVERLAY, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

export async function idbGetIn<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

// keyPath store'лар (outbox/overlay) → put(val); out-of-line (kv) → put(val, key).
export async function idbPut(store: string, val: unknown, key?: IDBValidKey): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    if (key === undefined) tx.objectStore(store).put(val);
    else tx.objectStore(store).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDel(store: string, key: IDBValidKey): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbAll<T>(store: string): Promise<T[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

// "kv" API — фаза 3 (cache.ts) шуни ишлатади, ЎЗГАРМАЙДИ.
export async function idbGet<T>(key: string): Promise<T | undefined> {
  return idbGetIn<T>(KV, key);
}
export async function idbSet(key: string, val: unknown): Promise<void> {
  return idbPut(KV, val, key);
}
