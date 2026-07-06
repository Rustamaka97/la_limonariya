# Чек «Действия» — амаллар журнали (audit trail) — backend + frontend spec

> CloPOS'да ҳар чекнинг **тўлиқ тарихи**: ким, қачон, қайси терминалда қайси амални қилган. Фрод/назорат учун жуда муҳим (La Limon'нинг подделкага-чидамли фалсафасига айнан мос). Приоритет: **P1–P2**.

## 1. CloPOS'да (жонли кўрилди — Чек #29329 «Действия»)
- Чек ичида **«История чека №N»** (Действия) — timeline. Ҳар ёзув: **амал матни + вақт (12:16:10 05.07.2026) + ким (Sanjarr) + 💻 терминал (2)**.
- **Фильтр (action тури бўйича):** «Действия :» dropdown — Создание нового чека · Добавление товара · Удаление товара из чека · Удаление после отправки в отдел... (timeline'ни битта тур бўйича фильтрлаш; X = тозалаш).
- **Ёзув формати:** «**добавлено 1 x Нон**», «**добавлено 1 x ҚОЗОН КАБОБ (қуй гушти)**» — амал + миқдор + маҳсулот номи (`detail` jsonb'да).
- Жонли мисол (чек #29329): «Отправлен в отдел» → «отправлено на печать» → «закрыл чек с Наличными 30,000» → «распечатан чек на сумму 30,000 uzs».
- **Логланадиган амал турлари (~20):** Создание нового чека · Добавление товара · Удаление товара · **Удаление товара после отправки в отдел** · Изменение цены товара · Добавление/Удаление скидки · Добавление/Удаление платы за обслуживание · Применение/Удаление клиента · **Печать чека** · Отправка в отдел · **Смена официанта** · **Смена стола** · Изменение количества гостей · **Закрытие чека** (тўлов усули+сумма) · **Объединение чеков** · ...

## 2. La Limonariya — ҲОЗИР
- **Қисман аудит бор** (append-only ledger'лар, ҳар бири `createdById`/`createdAt` билан):
  - `kitchenTickets` + `kitchenTicketItems` — кухняга юбориш (ким/қачон/нима).
  - `voidedItems` — юборилгандан кейин ўчириш («Удаление после отправки»).
  - `orderPayments` (ёпиш), `refunds`, `debtPayments`, `stockMovements` — ҳар бири изланади.
- **ЙЎҚ:** ягона **per-cheque timeline** UI, ва кўп амал логланмайди — нарх ўзгартириш, скидка қўшиш/олиш, сервис ўзгартириш, официант/стол алмаштириш, гостей ўзгартириш, print, мижоз боғлаш, объединение.

## 3. BACKEND spec (янги — `apps/api/src`)
### Схема (`schema.ts`)
- **`order_events` (янги, append-only):** `id, orderId uuid→orders (cascade), type pgEnum(...~20 тур...), detail jsonb (масалан {productId, oldPrice, newPrice} ёки {method,amount}), performedById uuid→users, terminalId text?, createdAt`. Индекс: `(orderId, createdAt)`.
- `type` enum: `create, add_item, remove_item, void_after_send, change_price, add_discount, remove_discount, add_service, remove_service, attach_customer, detach_customer, print, send_kitchen, change_waiter, change_table, change_guests, close, merge, cancel, refund`.
### Логлаш (мавжуд procedure'ларга inline insert)
- Ҳар POS мутациясида → `order_events`га 1 қатор:
  - `pos.create` → create · `pos.addItem` → add_item/remove_item (+ void_after_send мавжуд voidedItems билан бирга) · `pos.sendToKitchen` → send_kitchen · `pos.updateMeta` → change_guests · `pos.close` → close (detail: {method, amount}) · `pos.cancel` → cancel · `finance.refund` → refund.
  - Янги амаллар келганда (Скидка, Смена стола/официанта, Объединение — бошқа feature'лар) → тегишли event.
- **Ledger фалсafаси:** append-only, ҳеч қачон таҳрирланмайди/ўчирилмайди.
### tRPC
- **`pos.orderEvents({orderId})`** — timeline (type, detail, performedByName, createdAt) — сана бўйича. Иерархия: официант ўзиникини (`assertOrderAccess`).

## 4. FRONTEND spec
- **«История чека №N» модал/панел** (`OrderDetail`/`Pos.tsx` чек ичида): вертикал timeline — нуқта + амал матни («добавлено 1 x Нон») + **вақт + ким + 💻 терминал** (CloPOS каби). Ҳар тип учун иконка/ранг.
- **Фильтр:** «Действия :» dropdown — action тури бўйича фильтрлаш (Добавление товара, Удаление, Скидка...) + X тозалаш.
- Директорга — фрод сигналлари билан боғлаш (масалан кўп скидка/нарх ўзгартириш → `computeSignals`га).

## 5. Хулоса Шерхонга
- **Аудит журнали = P1–P2**, назорат учун катта қиймат. La Limon'да яримтаси бор (voidedItems/kitchenTickets) — уларни **`order_events`га бирлаштириб**, қолган амалларни ҳам логлаш.
- Босқич: 1) `order_events` жадвал + асосий амаллар (create/close/send/void) · 2) қолган амаллар (нарх/скидка/официант/стол) уларнинг feature'лари билан · 3) frontend timeline.
