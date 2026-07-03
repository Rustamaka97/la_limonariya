# 📴 Offline-first — архитектура ва босқичли режа

**Сана:** 2026-07-03 · **Ҳолат:** Foundation бошланди (1-фаза: идемпотент заказ яратиш ✅)

Мақсад (gap-audit P0/P1): _«интернет/свет ўчса официант заказ бера олади, улангач синхрон»._

---

## 0. Реал шароит ва ЧЕГАРА (нима offline, нима йўқ)

Бутун стек — **серверда** (OptiPlex, LAN): Postgres + API + Caddy. Демак:

| Ҳолат | Нима бўлади | Offline-first фойдаси |
|---|---|---|
| **Wi-Fi/роутер лаги** (сервер ишлаяпти) | Телефон вақтинча серверга етмайди | ✅ Официант заказ ёзади → навбат → уланганда синхрон |
| **Свет ўчди** (сервер ҳам ўчди) | Сервер, принтерлар — ҳаммаси ўчиқ | ✅ Официант телефонида заказ ёзади (локал), свет келгач синхрон |

**ЧЕГАРА — фақат ЗАКАЗ ОЛИШ offline.** Қуйидагилар ONLINE-only (сервер+нақд+принтер керак, свет ўчса барибир ишламайди):

- ❌ Чек ёпиш / тўлов қабул қилиш (`pos.close`) — нақд ҳисоби, списание, чоп
- ❌ Возврат (`refund`), чегирма тасдиғи, инвентаризация тасдиғи
- ❌ Молия/ҳисобот кўринишлари

Спец айнан шуни айтади: _«официант **заказ** бера олади»_ — тўлов эмас.

---

## 1. Ўзак муаммо: ёзиш йўли replay-safe бўлиши шарт

Offline навбат уланганда сақланган мутацияларни **қайта юборади**. Жавоб йўқолиб,
аслида ўтган мутация такрор юборилса — **дубль бўлмаслиги** керак (идемпотентлик).

| Мутация | Ҳозирги ҳолат | Offline учун керак |
|---|---|---|
| `pos.create` | ✅ **БАЖАРИЛДИ** (ф1) — client UUID + `onConflictDoNothing` (replay → битта заказ) | — |
| `pos.addItem` | ✅ **БАЖАРИЛДИ** (ф2) — client `opId` + `client_ops` dedup → replay delta'ни қайта қўлламайди | — |
| `pos.sendToKitchen` | ✅ **БАЖАРИЛДИ** (ф2) — client `ticketId`; мавжуд бўлса тикетни қайтаради (икки марта юбормайди) | — |
| `pos.updateMeta` | ✅ табиий идемпотент (set patch) | — |

### addItem фикс — (A) op-id ТАНЛАНДИ ✅
Икки йўл кўриб чиқилди:
- **(A) op-id (idempotency key) — ТАНЛАНГАН:** ҳар тап `{opId, orderId, productId, delta}`
  юборади; сервер `client_ops(op_id pk)` жадвалига `onConflictDoNothing` ёзади, такрор
  op-id → **skip** (delta дубль эмас). Delta логикаси ЎЗГАРМАЙДИ.
- **(B) абсолют setQty:** заказ элементи учун абсолют `qty` юбориш. Replay идемпотент,
  лекин **рад этилди**: setQty оралиқ камайтиришни (5→3) йўқотади, ҳолбуки бу
  **директор-гейт + void журнали** (сохта таом назорати) учун ҳар бир камайтириш
  алоҳида аудит воқеаси бўлиши шарт. (A) буни бус-бутун сақлайди + камроқ хавф.

👉 **Қарор: (A) op-id** — anti-theft void аудитини сақлайди, эҳтиёткор delta логикасига
тегмайди, `client_ops` битта кичик жадвал.

---

## 2. Клиент маълумот қатлами (tRPC POST → SW кэш ишламайди)

tRPC `httpBatchLink` — ҳамма сўров **POST** (батчли). Service Worker'нинг runtime
кэши POST'ни кэшламайди. Демак **клиент-томон store** керак:

- **Dexie (IndexedDB)** — 2 та store:
  - `refCache` — меню, заллар, столлар (охирги муваффақ query натижаси). Query
    оффлайнда фейл берса — кэшдан ўқийди (POS кўринади).
  - `mutationQueue` — навбатдаги ёзишлар (`{opId, kind, payload, createdAt, status}`),
    FIFO, уланганда кетма-кет flush.
- **Локал заказ ҳолати** — очиқ заказлар IndexedDB'да; официант оффлайнда item
  қўшади/олади (локал), навбат серверга push қилади.

---

## 3. Синхрон механизми (навбат)

```
online?  ── йўқ ──▶ мутацияни queue'га ёз (optimistic UI янгиланади)
   │ ҳа
   ▼
queue бўш эмасми? ── ҳа ──▶ FIFO flush: ҳар op'ни серверга (idempotent) юбор
   │                              муваффақ → queue'дан ўчир
   ▼                              хато(тармоқ) → тўхта, кейин қайта ур
оддий онлайн сўров
```

- `navigator.onLine` + `online`/`offline` эвентлари + муваффақиятсиз сўровда fallback.
- Flush **кетма-кет** (create → addItem → sendKitchen тартиби бузилмасин).
- Ҳар op **идемпотент** (1-бўлим) — қайта урса хавфсиз.

---

## 4. Конфликт қоидалари

- **Икки қурилма, бир стол, оффлайн:** ҳар бири ЎЗ client order-id билан заказ яратади
  → серверда икки заказ. Реконсиляция: FloorView'да «бир столда 2 очиқ заказ» огоҳи
  (мавжуд stray-order кўриниши кенгайтирилади) → кассир бирлаштиради/танлайди.
- **Бир заказ, икки таҳрир (setQty):** last-write-wins по `updatedAt`; йўқолган
  таҳрир журналга (кейинчалик).
- **Оффлайнда яратилган заказ серверда ёпилган:** replay `onConflictDoNothing` → skip,
  клиент «аллақачон ёпилган» ҳолатини оладi.

---

## 5. Босқичли режа

| Фаза | Иш | Хавф | Тест |
|---|---|---|---|
| **1 ✅** | Идемпотент `pos.create` (client UUID) | паст | PG17 replay ✅ |
| **2 ✅** | `addItem` client `opId` (delta сақланди) + `sendToKitchen` client `ticketId` идемпотент | ўрта | PG17 replay ✅ |
| **3 ✅** | IndexedDB `refCache` (меню/заллар/столлар оффлайн ўқилади, SWR) | паст (read-only) | swr логика 6/6 ✅ + браузер (offline render) |
| **4 ✅** | Локал заказ (op-log + base snapshot) + `outbox` + flush | **юқори** | **59/59 unit ✅ + 3-агент дизайн + 6-дименсия adversarial review (22 fix)** |
| **5 ✅** | Конфликт огоҳи (бир столда 2 заказ) + online/offline indicator | ўрта | unit ✅ · UX жойида |

**4-5 фаза logic шу ерда тўлиқ текширилди** (59 unit + adversarial review), лекин
**охирги қабул-тести — ЖОЙИДА, 2 телефон + Wi-Fi ўчириш билан канари** (навбат
хатти-ҳаракатининг реал тармоқ узилиши/уланишидаги timing'и лаборанда симуляция
қилинмайди). Prod'га канари билан чиқарилсин.

---

## 6. Бажарилди

**Фаза 1 (`cf0027e`):**
- ✅ `pos.create` — `id?: uuid` (client беради), `onConflictDoNothing`, конфликтда
  мавжудни қайтаради. Pos.tsx `crypto.randomUUID()` юборади.
- ✅ PG17 replay: бир client id × 3 → 1 заказ.

**Фаза 2:**
- ✅ `client_ops(op_id pk)` жадвали (mig 0031).
- ✅ `pos.addItem` — `opId?: uuid`; тx ичида `client_ops`'га `onConflictDoNothing`,
  такрор бўлса delta қўлланмай `{ok:true}` қайтаради. Delta/директор-гейт/void журнал
  ЎЗГАРМАДИ. Pos.tsx ҳар тапга `opId` юборади.
- ✅ `pos.sendToKitchen` — `ticketId?: uuid`; `flushKitchenTicket` мавжуд тикетни
  қайтаради (икки марта кухняга юбормайди). Pos.tsx `ticketId` юборади.
- ✅ PG17: opId replay → delta SKIP (client_ops=1); тикет client-id × 2 → 1 тикет.

**Фаза 3:**
- ✅ `apps/web/src/lib/idb.ts` — dependency'сиз IndexedDB KV ("limon" базаси; фаза 4
  навбати ҳам шуни ишлатади).
- ✅ `apps/web/src/lib/cache.ts` `swr()` — stale-while-revalidate: кэшдан дарров, сўнг
  тармоқдан янгилайди; оффлайнда кэшни кўрсатади, кэш ҳам йўқ бўлса throw.
- ✅ Pos.tsx: `pos.menu` / `pos.halls` / `pos.tables` swr орқали → оффлайнда POS
  рендер бўлади (заказлар динамик — кэшланмайди).
- ✅ swr логика unit 6/6 (online/offline/private-mode). IndexedDB'нинг ўзи браузерда
  синалади (DevTools → Offline).
- ⚠️ **Чеклов (жойидаги тестчига):** фаза 3 «сессия ичида» ишлайди — app ОЧИҚ туриб
  тармоқ узилса, меню/пол кэшдан рендер бўлади. Лекин оффлайн **hard-reload** қилинса,
  бут вақтида `auth.me` тармоқ талаб қилади → Login экрани. Сессияни оффлайн сақлаш
  (тўлиқ оффлайн-бут) — **фаза 4** иши (локал сессия + queue). Шунинг учун тест:
  online кир → POS оч (кэш иситилади) → DevTools Offline → навигация қил (reload ЭМАС).

**Фаза 4-5:**
- ✅ `apps/web/src/lib/idb.ts` v2 — "outbox"(keyPath seq) + "overlay"(keyPath id) store'лар.
- ✅ `apps/web/src/lib/outbox.ts` — движок: op-log (ҳақиқат манбаи) + overlay head
  (server **base snapshot**) → `deriveOrder` = base + folded ops (server математикасини
  айнан такрорлайди). Сериал-lock'ли `nextSeq` (FIFO, reload'дан ошади). `flush`
  single-flight, per-order изоляция: `classify` → net(тўхта) / auth(401→тўхта+қайта-логин) /
  order-gone(404→заказ ўлик, мета истисно) / op-rejected(403/400→фақат шу op) /
  retry(5xx/408/429/parse→tries≤5 poison). enqueue* **boolean** қайтаради (idb йўқ →
  чақирувчи online-fallback). Deadletter'да content base'га snapshot (йўқолмайди).
- ✅ Pos.tsx: FloorView.create (enqueue + online-fallback + флоор merge server∪local),
  OrderView (optimistic deriveOrder, refresh overlay-fallback + base-cache, offline
  send→localUnsent), офлайн/хато banner'лари, offline'да тўлов/ёпиш/бекор гейтланган,
  **фаза 5** конфликт тайли (⚠ + chooser). App.tsx: `startOutbox` + offline сессия кэш
  + `outbox:auth`→қайта-логин. `outbox:drain` эвенти → UI серверга солиштиради.
- ✅ **59/59 unit** (in-memory idb + mock net): FIFO, идемпотент replay, 401-сақлаш,
  op-rejected vs order-gone, retry-defer, poison-no-orphan, base-fold, nextSeq-race,
  meta-collapse-fresh-seq, localUnsent-after-send, deadletter-content-retain.
- ✅ **Adversarial review** (3-агент дизайн → 6-дименсия → скептик верификация):
  27 топилма, 22 тасдиқланган (1 critical: 401 заказ йўқолиши) — ҳаммаси тузатилди.

⚠️ **Қолди — ЖОЙИДА канари:** 2 телефон бир столни оффлайн очиб иккаласи flush;
navigator.onLine captive-Wi-Fi ишончлилиги; iOS Safari IDB durability; реал 401 shape;
оффлайн send'да чоп реплейда чиқиши. Prod'га канари билан.
