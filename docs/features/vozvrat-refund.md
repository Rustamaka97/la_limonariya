# Возврат (пул қайтариш) — backend + frontend spec

> Функция: ёпилган чекдан мижозга пул қайтариш. **Шерхонга хулоса: La Limonariya'да аллақачон ТАЙЁР — қайта қуриш шарт эмас.** Фақат CloPOS-услуб «рақам-панел» quick-find (ихтиёрий, кичик frontend) қўшилса бўлади.

## 1. CloPOS'да қандай (жонли кўрилди)
- Панель → **Возврат** → «**Найти чек**» экрани: рақам-панел (1-9, 0, .) билан **чек рақамини** терасан → чек топилади → **Возврат** тугмаси.
- Тезкор: кассир чек рақамини билса, дарров теради (қидирувсиз).

## 2. La Limonariya — BACKEND (тайёр)
`apps/api/src/`:
- **Схема** — `schema.ts` `refunds` жадвал: `orderId, amount, reason, performedById, createdAt` (append-only журнал; оригинал заказ ўзгармайди). Миграция: `drizzle/0020_refunds.sql`.
- **`router.ts` → `finance.refund`** (protectedProcedure + inline роль): вход `{orderId, amount>0, reason(мажбурий)}`; фақат `status='closed'` чекка; `refunds`га insert. Роль: director/manager/cashier.
- **`router.ts` → `finance.searchOrders`** `{from, to, query?}` — ёпилган чекларни **чек№ ёки стол** бўйича қидиради (checkNo = `id.slice(0,5)` JS'да ҳисобланади).
- **`router.ts` → `finance.refunds`** `{from, to}` — возвратлар рўйхати (ким, қанча, сабаб).
- **Соф фойда** — `financeForWindow`да `refundTotal` тушум/фойдадан айирилади (§13 тешик назорати).

→ **Backend'да ҳеч нарса қўшиш шарт эмас.**

## 3. La Limonariya — FRONTEND (тайёр)
`apps/web/src/ChekQidirish.tsx` (Чек қидириш экрани):
- Юқорида: **сана оралиғи** (from/to) + **қидирув** («чек рақами ёки стол») + Қидириш → `finance.searchOrders`.
- Натижа: чек рўйхати (#checkNo · зал · стол · официант · сумма · сана; «текин» badge).
- Чек босилса → **`OrderDetail`**: receipt кўриниши (`pos.order`) — таомлар, тўловлар, ИТОГО.
- **«Қайтариш (возврат)»** тугмаси → сумма + сабаб (мажбурий) → **Тасдиқлаш** → `finance.refund` → «✓ Возврат ёзилди».

→ **Frontend'да асосий оқим тайёр.**

## 4. CloPOS-услуб фарқи ва ихтиёрий қўшимча
| | CloPOS | La Limonariya (ҳозир) |
|---|---|---|
| Чекни топиш | рақам-панел, чек№ **тўғридан** | сана оралиғи + қидирув майдони |
| Тезлик | кассирга тезроқ (№ билса) | 1-2 қадам кўпроқ, лекин browse қулай |

**Ихтиёрий enhancement (frontend, кичик):** `ChekQidirish`га **рақам-панел quick-find** қўшиш — кассир чек№ни териб дарров топади. Backend ўзгармайди (`searchOrders` `query`'ни аллақачон қабул қилади; фақат checkNo full-match'ни афзал қилиш мумкин). ~1 компонент, 0 backend.

## 5. Хулоса Шерхонга
- **Возврат = ТАЙЁР** (backend + frontend). Test qilib, ишлаётганини тасдиқланг.
- Хоҳиш бўлса: `ChekQidirish`га keypad quick-find (кассир UX). Приоритет: **паст** (мавжуд оқим ишлайди).
