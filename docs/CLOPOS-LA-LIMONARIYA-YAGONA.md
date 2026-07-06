# CloPOS → La Limonariya — ЯГОНА ТЎЛИҚ ҲУЖЖАТ

> **Кимга:** Шерхон ака (разработчик) · **Кимдан:** Рустам ака + Claude
> **Нима:** CloPOS'нинг ҲАММА функцияси (1) жонли веб-кассадан, (2) desktop `CloPOS.exe` **декомпиляциясидан** ўрганилди. La Limonariya'га backend + frontend + темир кўприги қандай кўчириш — **битта манбада**.
> **Бу файл = ЯГОНА БОШЛАШ НУҚТАСИ.** Барча бошқа MD'лар — шунинг батафсил манбаси.
> Сана: 2026-07-05

---

# 📑 МУНДАРИЖА

- **А.** Қисқача — нима қилинди (executive summary)
- **Б.** CloPOS архитектураси (2 қисм → 5 қатлам)
- **В.** Темир кўприги (`window.electron`, принтер, тарози, Locter)
- **Г.** 🆕 C# декомпиляция (BridgeDaemon · DeviceProxy · Ingenico фискал)
- **Д.** CloPOS жонли UI (floor · заказ · панель · устройства · отчёт · клиенты)
- **Е.** Роллар/иерархия (+ бажарилган код)
- **Ж.** La Limonariya ҳозирги ҳолати
- **З.** GAP — CloPOS'да бор, La Limon'да йўқ (24)
- **И.** 20 функция spec + frontend инвентаризация
- **К.** Реал принтер картаси
- **Л.** Кўчириш режаси — приоритет
- **М.** Манба файллар + декомпиляция усули

---
---

# А. ҚИСҚАЧА — НИМА ҚИЛИНДИ

1. **CloPOS.electron** (`C:\Users\HP\AppData\Local\Programs\clopos.electron`, v2.4.30) — `app.asar` очилди (JS) **ва** ичидаги **C# бинарлар декомпиляция қилинди** (BridgeDaemon.exe, DeviceProxy.exe).
2. **Жонли CloPOS.exe** remote-debugging (CDP :9222) орқали ичидан кўрилди — floor, панель, устройства, роллар, отчёт, клиенты.
3. **Реал принтер картаси** (5 тармоқ принтер, IP→станция, CP866, 9100).
4. **La Limonariya** кодбазаси тўлиқ ўқилди (schema, router, POS UI).
5. **Иерархия/роль қонунлари** La Limon'га **кодга ёзилди** (ягона код иши).
6. **20 та backend+frontend feature spec** MD ёзилди.

**Асосий хулоса:** La Limonariya аллақачон **кучли, етук POS** (ledger-based, роллар, молия, аналитика). CloPOS'нинг кўп функцияси La Limon'да **бор ёки бойроқ** (тўлов, возврат). Етишмайдиган энг муҳими — **станция печати** (тармоқ принтер) ва баъзи UX (клиент CRM, скидка, пречек, доставка). 🆕 Декомпиляция принтер режасини **тўлиқ тасдиқлади** ва кутилмаган **Ingenico фискал** қатламини очди (Туркия учун).

---

# Б. CloPOS АРХИТЕКТУРАСИ

## Б.1. Икки қисм (юқори даража)

| Қисм | Қаерда | Ичида нима |
|---|---|---|
| **Бизнес-логика** (касса UI, ҳисоб, меню, отчёт) | **Серверда** `pos.clopos.com` | Ҳар сафар интернетдан юкланади. Кэш ўчирилган. Компьютерда сақланмайди. |
| **Desktop қобиқ + темир кўприги** | `.exe` (`app.asar` + C# бинарлар) | Ойна, авто-юклаш, янгиланиш, **принтер, тарози, касса тортмаси, SQLite, мулти-терминал, фискал** |

**Хулоса:** CloPOS веб-коди керак эмас (сервер, минификация, чужой). Керакли — **темирга ёндашув** (exe ичида, очиқ) ва **UI/UX ғоялари** (жонли кўрдик).

## Б.2. Тўлиқ 5 қатлам (декомпиляциядан)

```
1. ВЕБ-POS (браузер — pos.clopos.com)        ← бутун UI/мантиқ
        │  window.electron.* (inject.js) → Electron IPC
2. ELECTRON MAIN (Node — index.js, lib/*)     ← Actions: барча буйруқлар
        │  stdin/stdout: "JOB <id> <command>"
3. BridgeDaemon.exe (C#, .NET 9)              ← Windows RAW принтер + фискал йўлбошчи
        │  JSON-RPC {id, method, hInt, hTrx, ...}
4. DeviceProxy.exe (C#, .NET 9)               ← "таржимон" → P/Invoke
        │  native call
5. GMPSmartDLL.dll (C++ вендор SDK)           ← фискал SDK (нативний)
        │  TCP 7500 / serial 115200
     ══► Ingenico ФИСКАЛ ТЎЛОВ ТЕРМИНАЛИ (темир)
```

**La Limon учун:** 1–2 қатлам асосий (веб + мост-агент). 3–5 фискал (Туркия, Г бўлимга қара).

---

# В. ТЕМИР КЎПРИГИ

## В.1. Веб ↔ темир (`inject.js`) — энг муҳим

CloPOS `pos.clopos.com`ни юклаб, унга `window.electron = {...}` инжект қилади. Механизм: `window.electron.метод(қиймат)` → `ipcRenderer.send("asynchronous-message")` → main бажаради → `id` бўйича Promise (таймаут билан).

**`window.electron` API (La Limon мост-агенти ТЗ):**
```
// ПЕЧАТЬ
findPrinters() / findActivePrinters() / findPrintersWithPort(port)
findWindowsPrinters() / getWindowsPrinterInfo(name)
findIPByMac(mac)                — MAC'дан IP (IP ўзгарса ҳам топади) ★
printWithCommands(pd, buffer)   — хом ESC/POS буфер (network/usb/windows)
printHtml(html, opts)           — HTML'ни офскрин рендер → принтер
testPrinters(list) / nbaCommand({ip,port,data})  — банк/фискал терминал
makeJobRequest({command})       — BridgeDaemon'га JOB (Windows RAW / фискал) ★
// ТАРОЗИ
scaleWeight.listPorts/start/stop/write/getStatus/onData
// SQLite
db.openOrGet/close/runQuery/findOne/findAll
// МУЛТИ-ТЕРМИНАЛ (locter)
startLocterServer/stopLocterServer/findLocters/checkIpPort
// UDP / БОШҚА
udpSendSequence/udpBroadcastDiscover · getIp/getBaseHost/getLocalIPv4List
createBrowser/destroyBrowser (иккинчи экран/KDS) · openLink · toggleFullScreen
```

## В.2. Печать (`lib/printer.js`) — 3 усул

| Усул | Механизм (аниқ код) |
|------|----------------------|
| **network** | `net.Socket` → **IP:9100** → raw ESC/POS буфер, timeout 2с |
| **usb** | `usb` кутубхона, интерфейс class **0x07**, endpoint `transfer()` |
| **windows** | Файлга ёз → BridgeDaemon → `winspool.drv` (`OpenPrinterW`/`StartDocPrinterW` RAW/`WritePrinter`) |

- **Тармоқ топиш:** подсеть (x.x.x.0–255) 9100-портда сканлайди + ARP'дан MAC.
- **`printImage`** — чекни **расм (base64)** сифатида (шрифт/лого муаммосиз) — escpos raster.
- **Қўшимча:** `cashdraw()` (касса тортмаси), `cut()`, `beep()`.
- **Станция:** битта заказ бир нечта станцияга **алоҳида** босилади. Bulk'да ~2с sleep (буфер тўлиши).

## В.3. Тарози (`lib/scaleWeight/reader.js`)
- `serialport` COM-порт ({path, baudRate}) → тарозидан **хом байт** веб'га `scale-weight-data` канали (**парслашни веб қилади**).
- Уланиш узилса **авто-reconnect**: backoff [1с, 5с, 15с].

## В.4. Оффлайн + Мулти-терминал (Locter)
- **SQLite** локал база (`lib/sqlite.js`) — интернет йўқда.
- **`express` (порт 8100) + WebSocket** — бошқа терминаллар (KDS, официант) асосий терминалга команда. POST `/api` → renderer IPC → жавоб (timeout 150с).

---
---

# Г. 🆕 C# ДЕКОМПИЛЯЦИЯ (энг чуқур қатлам)

`CloPOS.exe`нинг C# бинарлари декомпиляция қилинди. Иккита вазифа: (1) Windows RAW принтер, (2) **Ingenico фискал тўлов терминали**.

## Г.1. BridgeDaemon протоколи
`NativeBridge.js` `BridgeDaemon.exe`'ни spawn қилади. **Кириш:** `JOB <jobId> <command>` · **Чиқиш:** ҳар қатор JSON `{jobId, status, command, message, data, error}`.
```
JOB <id> PRINT WINDOW "<printer>" "<file>"      → Windows RAW принтер
JOB <id> INGENICO CONNECT|ECHO|BATCH|X_REPORT|Z_REPORT|
                  GET_DEPARTMENTS|SET_DEPARTMENTS|GET_TICKET|
                  GET_TAX_RATES|GET_PAYMENT_APPS ...
```
Фискал конфиг: INTERFACE_ID=`"CLOPOS"`, TCP порт **7500**, baud **115200**, timeout 90000ms.

## Г.2. DeviceProxy — "таржимон" (JSON-RPC → P/Invoke)
BridgeDaemon `DeviceProxy.exe`'ни spawn қилади. Сўров `{id, method, hInt, hTrx, timeout, jsonIn, extra}` → жавоб `{id, rc, jsonOut, extra, error}` (`rc=0` = OK). Ҳар метод битта нативний `GMPSmartDLL` функциясини (P/Invoke) чақиради: `CreateInterface`, `Start`, `MultipleCommand`, `GetTicket`, `SetInvoice`, `GetTaxRates`, `GetDepartments`, `FunctionReports`(X/Z), `prepare_ItemSale`, `prepare_Payment`, `prepare_Plus_Ex`, `prepare_Close`... (30+ метод).

## Г.3. Фискал сотув оқими (BATCH)
```
START → TICKET_HEADER → ITEM_SALE×N → PLUS/MINUS (устама/чегирма)
      → PAYMENT → CLOSE (фискал ёпиш)
```
Ҳар амал `prepare_*` буфер ясайди → `MultipleCommand` бир юборади. Retcode `0`/`2080` = OK.

## Г.4. Маълумот моделлари ва enum'лар
- **ST_ITEM** (товар): `amount`(нарх, **тийинда**), `count`, `deptIndex`, `unitType`, `name`, `barcode`, `currency`.
- **ST_PAYMENT_REQUEST**: `typeOfPayment`(bitmask), `payAmount`, `numberOfinstallments`.
- **ST_TICKET**: `ZNo`, жами сумма/солиқ/чегирма, `SaleInfo[512]`, `stPayment[24]`.
- **ST_DEPARTMENT**, **ST_TAX_RATE**, **ST_CASHIER** + 100+ модел.
- Enum: `TTicketType`(36 тур), `EPaymentTypes`(нақд/карта/овқат-чеки...), `ECurrency`(TL=949), `EItemUnitTypes`(60+).
- **Пул — доим бутун сон (тийин).**

## Г.5. ⚠️ МУҲИМ — фискал = ТУРКИЯ учун
Терминлар туркча: **Yemekçeki, KDV, EKU, TCKN/VKN, TL, Gider Pusulası**. Ўзбекистонда бошқа солиқ тизими (soliq.uz / ОФД). → **тўғридан кўчириб бўлмайди**; фақат архитектура намунаси. (Gap: фискал терминал — P3+.)

---
---

# Д. CloPOS ЖОНЛИ UI (чуқур)

## Д.1. Floor — заллар/столлар
- Таб: Асосий зал · Катта зал · Собой · Терраса. Столлар **фазовий** жойлашув (сетка эмас).
- Ранг: кулранг=бўш, **бинафша=банд** + официант исми. Стол устида **печать индикатори** 🖨.
- Роль: директор банд столда **суммани кўради**, официант **кўрмайди**.

## Д.2. Заказ/чек экрани
- Стол банд → **«Открытые чеки»** модали (битта столда **бир нечта чек**). Тур: **На месте · Доставка · С собой** (La Limon'да Доставка йўқ).
- **Иккита рақам:** `#29324` (глобал) `/ #66` (кунлик). Формат: ном · ҳажм · миқдор× · нарх · жами.
- Тугмалар: **Отправить** (кухня) · **Закрыть Чек** · Продажи по порциям.
- **Заказ амаллари (★ = La Limon'да ЙЎҚ):** Скидка★ · Разделить счёт★ · Объединить чеки★ · Изменить стол★ · Изменить Сотрудник★ · Добавить клиента · Очистить · Отменить · Изменить тип.
- **Пречек:** тўловдан **олдин** мижозга счёт (фискал эмас). La Limon'да ЙЎҚ.

## Д.3. Панель управления
| Тугма | Офиц. | Дир. |
|---|:--:|:--:|
| Архив чеков · Клиенты · Стоп-лист | ✅ | ✅ |
| Возврат · Создать отчёт · Добавить операцию · Сотрудник · Устройства · Открыть кассу | ❌ | ✅ |

## Д.4. Устройства
- **Принтеры** (К бўлим), **Локальные терминалы** (T3 актив + Terminal 1/T2 недоступен), **Мобильные терминалы** (официант телефони, IP билан).
- ★ La Limon афзаллиги: **PWA** — официант телефон браузеридан URL очади, IP бириктириш шарт эмас.

## Д.5. X-отчёт (жонли)
- Оралиқ: сана+вақт (30-мин). Кун чегараси **06:00** (La Limon `businessDayBounds` билан **бир хил**).
- Фильтр: Терминал + Тип (С операциями / Счета).
- Натижа: Промежуточный итог · Сервис · Скидка · Возврат · ЖАМИ · меҳмонлар сони · очиқ чеклар · тўлов усуллари + **йўқотиш турлари** (Гость ушел · Ошибка сотрудника · За счет компании). Тугма: **Распечатать**.

## Д.6. Клиенты — CRM + лоялти
Мижоз профили: исм+ID · **Харидлар тарихи** (Чек#·закрыт·сумма·усул) · **Создать операцию** (баланс/кэшбэк) · **Кешбэк** (%). La Limon: фақат исм+телефон (қарз учун) → CloPOS анча бойроқ.

## Д.7. Директор амаллари
- **Сотрудник:** жадвал (Имя·Дата·**Карта**·Статус). Карта=RFID login (La Limon'да фақат PIN).
- **Возврат:** «Найти чек» — рақам-панелда чек №.
- **Добавить операцию:** касса пул журнали — **Расход · Доход · Перевод · Инкассация**. ★ **Кўп пул ҳисоби:** Касса · Карточный · Банковский · Сейф — орасида **Перевод**.
- **Модуллар (DOM):** QR меню · Доставка/Курьер · Платежи · Центральная система заказов · Таймер.

---

# Е. РОЛЛАР ВА ИЕРАРХИЯ

| Даража | Кўради/қила олади |
|---|---|
| **Официант** | Фақат **ўз** заказини. Чужойни очолмайди (**«Доступ запрещён»**). Суммани кўрмайди. |
| **Кассир** | Ҳамма заказ, сумма, ёпиш, возврат, қарз. |
| **Менежер** | + инвентаризация, склад, отчёт. |
| **Директор** | Ҳаммаси — устройства, ходим, отчёт, касса. |

## ✅ Иерархия коди — БАЖАРИЛДИ
- `apps/api/src/trpc.ts` — `cashierProcedure`, `buyerProcedure`
- `apps/api/src/router.ts` — `assertOrderAccess` helper + `pos.*` guards, `close`→cashier, `openOrders` waiter-фильтр (чужой сумма null), `obvalka/purchase.create`→buyer
- `apps/web/src/Pos.tsx` — официантга «Заказни кассир ёпади»; чужой сумма «банд»
- **Ҳолат:** typecheck тоза, схема ўзгармаган, branch `feature/vitrina-print-digest-menu-expiry`. **Review + merge тайёр.**

---

# Ж. La Limonariya ҲОЗИРГИ ҲОЛАТИ

**Стек:** Vite + React 19 + TS (PWA, Tailwind v4) · Hono + tRPC + Drizzle · PostgreSQL 17 · Docker, OptiPlex `192.168.1.4:8080`.
**Код:** ~10.6k қатор. Ledger-based (append-only), advisory-lock, идемпотентлик — пухта.
**14 экран:** Бошқарув · Аналитика · Молия · Касса(POS) · Чек қидириш · Харид · Обвалка · Инвентаризация · Омбор · Ҳисобот · Таннарх · Каталог · Рецептлар · Ходимлар.
**POS'да бор:** зал/стол (сетка), меню (ранг-код, қидирув), кухняга юбориш (станцияга гуруҳлаган), multi-tender (нақд/карта/click/payme/қарз), қарз, текин/comp, возврат, чек+кухня **браузер печати** (`window.print()`, 58/80mm).
**Схемада тайёр (ишлатилмаган):** `stations.printable`, `products.soldByWeight`, kitchen tickets станцияга snapshot.

---

# З. GAP — CloPOS'да бор, La Limon'да йўқ/кам

| # | Функция | La Limon | Приоритет |
|---|---|:--:|:--:|
| 1 | Иерархия/роль қонунлари | ✅ **ҚИЛИНДИ** | — |
| 2 | **Станция печати** (IP принтер, ESC/POS) | ❌ (фақат window.print) | **P1** |
| 3 | Тарози (COM-порт) | ❌ (майдон бор) | P2 |
| 4 | **Пречек** | ❌ | **P1** |
| 5 | Стоп-лист | ❌ | P2 |
| 6 | Курьер/Доставка | ❌ | P2 |
| 7 | Битта столда бир нечта чек | ❌ | P3 |
| 8 | Floor фазовий харита | ❌ (сетка) | P3 |
| 9 | Стол печать индикатори 🖨 | ❌ | P3 |
| 10 | Касса тортмаси (cashdraw) | ❌ | P2 |
| 11 | Оффлайн (SQLite) | ❌ | P3 |
| 12 | Мулти-терминал/KDS | ❌ | P3 |
| 13 | Кешбэк/лоялти | ❌ | P3 |
| 15 | **Скидка** | ❌ | **P1** |
| 16 | Разделить/Объединить чек | ❌ | P2 |
| 17 | Изменить стол | ❌ | P2 |
| 18 | Изменить Сотрудник | ❌ | P3 |
| 19 | Карта билан кириш (RFID) | ❌ | P3 |
| 20 | Офлайн архив | ❌ | P3 |
| 21 | **Кўп пул ҳисоби** (Касса·Карта·Банк·Сейф)+Перевод | ❌ | **P1** |
| 22 | Доход операцияси | ❌ | P2 |
| 23 | X-отчёт (принтер, меҳмон/йўқотиш) | ❌ (қисман) | P2 |
| 24 | QR меню · Платежи · Таймер | ❌ | P3 |
| 🆕 | **Фискал терминал (Ingenico GMP3)** | ❌ (Туркия учун) | P3+ |

---

# И. 20 ФУНКЦИЯ SPEC + FRONTEND ИНВЕНТАРИЗАЦИЯ

Ҳар функция: `features/*.md` (CloPOS'да қандай → La Limon ҳозир → backend spec → frontend spec → приоритет).

### ✅ ТАЙЁР (тест)
Возврат · **Оплата** (5 усул+split, CloPOS'дан бойроқ) · Сотрудники (~90%)

### ★ P1 — биринчи
**Станция печати** (№1) · **Скидка** · **Пречек** · **Кўп пул ҳисоби** · **Клиенты (CRM)**

### P2 — ўрта
Чек «Действия» (аудит) · Заказ амаллари · Разделить/Объединить · Чеки фильтр · X-отчёт · Стоп-лист · Тарози · Доставка/Курьер

### P3 — кейин
Мулти-терминал+KDS · Юқори панель · QR меню · Оффлайн

### 🖼️ Frontend — 3 қатлам
| Қатлам | Қаерда | Нима |
|--------|--------|------|
| exe локал HTML | `static/` | splash · update · about · error (4 хизмат ойнаси) |
| Ҳақиқий POS UI | `pos.clopos.com` (булут) | Асосий интерфейс (жонли ўрганилган) |
| La Limon spec | `features/*.md` | 20 функция frontend режаси (✅3 · ◑8 · ❌9) |

---

# К. РЕАЛ ПРИНТЕР КАРТАСИ

| IP | Станция | Ҳолат |
|---|---|---|
| `192.168.1.131` | **SALAT** | 🟢 |
| `192.168.1.132` | **OSHXONA** | 🟢 |
| `192.168.1.133` | **SHASHLIK** | 🟢 |
| `192.168.1.137` | **Чек · BAR** | 🔴 |
| `192.168.1.134` | **BALIQ** | 🔴 |

Порт **9100** · подсеть **192.168.1.x** · кодировка **CP866 (Cyrillic — МАЖБУРИЙ)** · "Тез печать" = драйверсиз raw ESC/POS. Декомпиляция тасдиқлади (В.2).

---

# Л. КЎЧИРИШ РЕЖАСИ — ПРИОРИТЕТ

1. **Иерархия** — тайёр, review + merge.
2. **★ Станция печати мост-агенти** — энг катта қиймат. Ечим: кичик Node.js агент (`escpos-network` + iconv CP866, порт 9100) → веб `sendToKitchen`/чек босганда агентга HTTP/WS → агент станция IP'сига raw ESC/POS. Декомпиляция аниқлади (4 нуқта):
   - `net.Socket` → IP:9100 → raw ESC/POS
   - CP866 буфер веб/агентда тайёрланади
   - **MAC→IP** (ARP) — IP ўзгаришидан ҳимоя
   - Windows RAW (`winspool.drv`) — заҳира усул
   - Керак: `stations`га `ip/width/kind`, агент API `POST /print`, станция маршрутизацияси.
3. **Пречек** — оддий, очиқ заказ учун «Пречек» тугмаси → принтер (ledger'га ёзилмайди).
4. **Кўп пул ҳисоби** + **Скидка** + **Клиенты (CRM)** — P1.
5. **Тарози** + **Касса тортмаси** — мост-агент устига.
6. **Стоп-лист · Курьер · Разделить/Объединить · X-отчёт** — P2.
7. Қолгани (оффлайн, KDS, QR, фискал) — P3+.

**Муҳим:** CloPOS веб-кодини кўчирманг. La Limon **ledger фалсафаси** (append-only, баланс=SUM) — сақланг, мавжуд кодни **кенгайтиринг**, нолдан эмас.

---

# М. МАНБА ФАЙЛЛАР + ДЕКОМПИЛЯЦИЯ УСУЛИ

**JS (app.asar):** `printer.js`, `native-print.js`, `NativeBridge.js`, `actions.js`, `inject.js`, `scaleWeight/reader.js`, `server/*.js`, `index.js`, `conf.js`
**🆕 C# декомпиляция** (`clopos-src/decompiled/`): `BridgeDaemon.decompiled.cs`, `DeviceProxy.decompiled.cs`, `Ingenico.SDK.decompiled.cs`
**Жонли CloPOS:** CDP :9222 → floor, панель, устройства, роллар, отчёт, клиенты
**La Limonariya:** `apps/api/src/{router,trpc,context,auth}.ts`, `db/schema.ts`, `apps/web/src/{Pos,Shell}.tsx`
**Батафсил MD'лар:** `CLOPOS-KOCHIRISH-SHERXON.md` (чуқур анализ + §11), `CLOPOS-EXE-TOLIQ-TAHLIL.md` (декомпиляция тўлиқ), `features/*.md` (20 функция), `clopos-screens/` (скриншот)

**Декомпиляция усули (такрорлаш):**
1. `npx @electron/asar extract app.asar` → JS/HTML/PS.
2. C# `.exe` = .NET single-file bundle → Node скрипт (signature `8b 12 02 b9...` + `zlib.inflateRawSync`) билан `.dll` ажратиш.
3. `.NET 8 SDK` (winget) + `ilspycmd` (`DOTNET_ROLL_FORWARD=Major`) → `.cs`.
4. `GMPSmartDLL.dll` нативний C++ (очилмайди), лекин P/Invoke имзолари `Ingenico.SDK.dll`'да.

---

*La Limonariya · CloPOS кўчириш · ЯГОНА тўлиқ ҳужжат · Рустам ака + Claude · 2026-07-05*
