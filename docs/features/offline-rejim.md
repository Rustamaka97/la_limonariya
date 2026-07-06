# Оффлайн режим — backend + frontend spec

> Интернет узилса — заказлар **локал сақланади**, кейин синхрон. La Limonariya'да ЙЎҚ (серверга боғлиқ). Приоритет: **P3** (катта иш; интернет барқарор бўлса — паст).

## 1. CloPOS'да
- Интернет узилса — заказлар **локал SQLite**'да сақланади (asar `lib/sqlite.js`, `inject.js` `db.runQuery/findAll`).
- Статус панелида (§ top-bar): **Интернет · WS · Syncer** ҳолати; Чекида **«Офлайн архив»** таб (§ Чеки #4).
- Интернет қайтганда **Syncer** локал заказларни серверга юборади.

## 2. La Limonariya — ҲОЗИР
- **ЙЎҚ.** Веб — серверга (`@limon/api`) тўғридан боғлиқ. Интернет узилса POS ишламайди.
- PWA (service worker) бор — лекин фақат static cache, **заказ буфери йўқ**.

## 3. BACKEND / FRONTEND spec (катта, босқичли)
- **Локал буфер (frontend):** PWA **service worker** + **IndexedDB** — заказ/тўлов/тикет локал навбатга (offline queue).
- **Синхрон:** интернет қайтганда навбат серверга юборилади (`navigator.onLine` + retry). Idempotency (мавжуд idempotent close/send мантиғи ёрдам беради).
- **Конфликт ечими:** offline'да ёзилган vs server ҳолати — заказ ID (client-generated UUID) + append-only ledger фалсафаси ёрдам беради (La Limon аллақачон ledger-based).
- **Статус:** online/offline индикатор (§ top-bar #11) + «Офлайн архив» рўйхати (синхронланмаган заказлар).

## 4. Приоритет / эслатма
- **P3, катта иш** — service worker offline queue + sync + конфликт. Мураккаб.
- **Қачон керак:** интернет тез-тез узиладиган жойда. Барқарор бўлса — паст приоритет.
- La Limon **ledger-based** архитектураси (append-only, idempotent) offline sync'ни осонлаштиради — лекin барибир катта иш.
