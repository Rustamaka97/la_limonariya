# CloPOS → La Limonariya: ТЎЛИҚ ЯКУНИЙ HANDOFF

> **Кимга:** Шерхон ака (разработчик) · **Кимдан:** Рустам ака + Claude (2 кунлик сессия, 2026-07-04/05)
> **Нима:** CloPOS'нинг ҲАММА функцияси жонли ўрганилиб, La Limonariya'га **backend + frontend** ҳолда қандай кўчириш — тўлиқ spec.
> **Бу файл = БОШЛАШ НУҚТАСИ.** Аввал шуни ўқинг, кейин керакли feature MD'га ўтинг.

---

## 0. Қисқача — нима қилинди

CloPOS'нинг реал ишлаётган кассаси (`pos.clopos.com`, T3 терминал) **ичидан** (жонли, CDP орқали) ва desktop коди (`app.asar`) чуқур ўрганилди. Ҳар экран, диалог, амал очиб кўрилди ва **20 та backend+frontend spec MD** ёзилди. Иерархия/роль қонунлари эса **кодга ёзилди**.

**Асосий хулоса:** La Limonariya аллақачон **кучли, етук POS** (ledger-based, роллар, обвалка, молия, аналитика). CloPOS'нинг кўп функцияси La Limon'да **бор ёки бойроқ** (масалан тўлов, возврат). Етишмайдиган энг муҳими — **станция печати** (тармоқ принтер) ва баъзи UX (клиент CRM, скидка, доставка).

---

## 1. ДЕЛИВЕРАБЛЕС (ҳамма ҳужжат/код)

| Нима | Қаерда |
|---|---|
| **Асосий CloPOS анализ** (архитектура, inject.js API, 24+ gap, скриншотлар) | [CLOPOS-KOCHIRISH-SHERXON.md](CLOPOS-KOCHIRISH-SHERXON.md) |
| **20 та feature MD** (ҳар функция: backend + frontend spec) | [features/](features/) + [features/README.md](features/README.md) (индекс) |
| **Скриншотлар** (жонли CloPOS экранлари) | [features/../clopos-screens/](clopos-screens/) |
| **Иерархия/роль КОДИ** (бажарилган) | §3 қуйида — `trpc.ts`, `router.ts`, `Pos.tsx` |
| **Принтер картаси** (реал IP→станция, CP866) | [features/stansiya-pechati-bridge.md](features/stansiya-pechati-bridge.md) §1 |

---

## 2. 20 ФУНКЦИЯ — тўлиқ рўйхат (приоритет билан)

Батафсил: [features/README.md](features/README.md). Ҳар MD форматı: CloPOS'да қандай → La Limon'да ҳозир → backend spec → frontend spec → приоритет.

### ✅ La Limon'да ТАЙЁР (қайта қуриш шарт эмас — фақат тест)
- **Возврат** (пул қайтариш) — `finance.refund` + ChekQidirish
- **Оплата** (тўлов) — `pos.close`, **5 усул + аралаш + текин** (CloPOS'дан бойроқ)
- **Сотрудники** (~90%) — `users` CRUD + PIN (карта login гап)

### ★ P1 — энг муҳим, биринчи
- **Станция печати** (мост-агент, ESC/POS, **CP866**, порт **9100**) — [stansiya-pechati-bridge.md](features/stansiya-pechati-bridge.md)
- **Скидка** (фоиз %) — [skidka.md](features/skidka.md)
- **Пречек** (тўловдан олдин счёт) — [precheck.md](features/precheck.md)
- **Кўп пул ҳисоби** (Касса/Карта/Банк/Сейф + Перевод) — [kassa-operatsiyalari-hisoblar.md](features/kassa-operatsiyalari-hisoblar.md)
- **Клиенты** (CRM: баланс/бонус/гуруҳ-скидка/манзил/тарих) — [klienty-crm-wallet.md](features/klienty-crm-wallet.md)

### P2 — ўрта
- **Чек «Действия»** (аудит журнали — фрод назорати) — [chek-deystviya-audit.md](features/chek-deystviya-audit.md)
- **Разделить/Объединить чек** (split bill) — [razdelit-obedinit-chek.md](features/razdelit-obedinit-chek.md)
- **Заказ амаллари** (стол/официант/тип/гости алмаштириш) — [zakaz-amallari-toolbar.md](features/zakaz-amallari-toolbar.md)
- **Чеки рўйхат+фильтр** · **Стоп-лист** · **Отчёт (X)** · **Тарози** · **Доставка/Курьер**

### P3 — кейинги босқич
- **Мулти-терминал + KDS** · **QR меню** · **Оффлайн режим** · **Юқори панель** (bell/Статус) · Платежи интеграция

---

## 3. ИЕРАРХИЯ/РОЛЬ КОДИ (АЛЛАҚАЧОН БАЖАРИЛГАН)

CloPOS'даги роль-хавфсизлик La Limon'га **кодга ёзилди** (Рустам ака тасдиқлаган қоида):
- **Официант** — фақат **ўз** заказини кўради/ўзгартиради (чужой → «Доступ запрещён»); чужой стол суммасини кўрмайди; заказ **ёпа олмайди**.
- **Заказни ёпади** — фақат кассир/менежер/директор.
- **Обвалка/харид (API)** — фақат buyer+.

**Ўзгарган файллар:**
- `apps/api/src/trpc.ts` — `cashierProcedure`, `buyerProcedure`
- `apps/api/src/router.ts` — `assertOrderAccess` helper + `pos.*` guards, `close`→cashier, `openOrders` waiter-фильтр, `obvalka/purchase.create`→buyer
- `apps/web/src/Pos.tsx` — официантга «Ёпиш» ўрнига «Заказни кассир ёпади»; чужой сумма «банд»

**Ҳолат:** typecheck тоза, схема ўзгармаган (миграция йўқ), branch: `feature/vitrina-print-digest-menu-expiry`. **Review + merge тайёр.**

---

## 4. КАЛИТ ТЕХНИК ФАКТЛАР

### 4.1. Архитектура фарқи (МУҲИМ)
- **CloPOS** = Electron desktop → Node.js орқали темирга (принтер/тарози) тўғридан кира олади.
- **La Limonariya** = веб/PWA (`@limon/api` + `@limon/web`, Docker) → браузер темирга **кира олмайди**.
- → Темир (принтер/тарози) учун **локал мост-агент** керак (§4.2). Лекин веб/PWA — **мулти-терминал, QR меню, мобил официант**да афзал (URL очиш кифоя).

### 4.2. Станция печати — мост-агент (P1 №1)
- Реал: **5 тармоқ принтер**, IP→станция: `.131 SALAT · .132 OSHXONA · .133 SHASHLIK · .137 Чек+BAR · .134 BALIQ`. Порт **9100**, кодировка **CP866** (кириллица учун МАЖБУРИЙ), MAC билан (ARP).
- Ечим: кичик Node.js агент (кассада) `escpos-network` + iconv(CP866) → веб `sendToKitchen`/чек юборганда станция IP'сига raw ESC/POS. La Limon схемаси тайёр (`stations.printable`, kitchen ticket станцияга гуруҳланган).

### 4.3. Иш асбоби — `drive.js` (CDP реал input)
- Жонли CloPOS'ни ўрганиш учун **CDP реал Input** (`Input.dispatchMouseEvent/dispatchKeyEvent`) асбоби ёзилди (Playwright каби «trusted» эвент). Электрон илова remote-debugging (`--remote-debugging-port=9222`) орқали ичидан кўрилди. (Бу — тадқиқот асбоби, продукт коди эмас.)

---

## 5. ШЕРХОН АКА УЧУН — ИШ ТАРТИБИ

1. **Аввал** [CLOPOS-KOCHIRISH-SHERXON.md](CLOPOS-KOCHIRISH-SHERXON.md) ва бу файлни ўқинг — умумий манзара.
2. **Иерархия коди**ни (§3) review қилинг — тайёр, merge мумкин.
3. **P1'дан бошланг:** Станция печати мост-агенти (энг кўп ишлатилади) → Скидка → Пречек → Кўп пул ҳисоби → Клиенты.
4. Ҳар функция — тегишли [features/*.md](features/) MD'да backend+frontend spec бор.
5. **Муҳим:** La Limon **ledger фалсафаси** (append-only, баланс=SUM, подделкага чидамли) — уни сақланг. Мавжуд кодни **кенгайтиринг**, нолдан эмас.

---

*La Limonariya · CloPOS кўчириш · Рустам ака учун тайёрланди · 2026-07-05*
