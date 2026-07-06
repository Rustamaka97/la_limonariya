# Станция печати (мост-агент) — backend + frontend spec — ★ P1 ЭНГ МУҲИМ

> Заказ юборилганда таомлар **станцияларга гуруҳланиб**, ҳар станция **ўз тармоқ принтерига** авто босилади (кухня, бар, салат, шашлик...) + мижоз чеки + касса тортмаси. La Limonariya'да ҳозир фақат браузер `window.print()` (битта принтер, диалог). Бу — **ҳар куни энг кўп ишлатиладиган** функция. Приоритет: **P1 №1**.

## 1. CloPOS'да (жонли — принтер созламаси тўлиқ кўрилди)
- **5 Network принтер** (IP), реал карта:

  | IP:порт | MAC | Отдел(лар) |
  |---|---|---|
  | 192.168.1.131:9100 | 00:61:9a:6c:40:5c | SALAT |
  | 192.168.1.132:9100 | 00:61:9a:6c:3e:5e | OSHXONA |
  | 192.168.1.133:9100 | 00:61:a2:64:46:b5 | SHASHLIK |
  | 192.168.1.137:9100 | 00:61:9a:6c:4a:e0 | Чек · BAR |
  | 192.168.1.134:9100 | 00:61:9a:6c:3e:74 | BALIQ |

  > **MAC муҳим:** принтер IP'си DHCP'да ўзгарса — **MAC орқали** (ARP-lookup, `@network-utils/arp-lookup`) қайта топилади. Мост-агент принтерни IP эмас, **MAC**га боғласа барқарорроқ (CloPOS ҳам MAC сақлайди). Схемага `printers.mac` қўшиш.

- **Принтер созламаси (ҳар бири):**
  - **Отделы** (checkbox — қайси станция(лар)ни босади): **Чек · OSHXONA · BAR · SALAT · SHASHLIK · BALIQ · NON CHOY**. Битта принтер **бир нечта** отделга хизмат қила олади.
  - **Настройки:** **Денежный ящик** (cashdraw — очиш) · **Увеличить громкость** (beep) · **Быстрая печать** (raw ESC/POS, драйверсиз) · **Width** (58/80 мм) · **Codepage: Cyrillic (17) = CP866** (+ IBM PC/Multilingual/West Europe/Greek/Baltic) · **Transliteration** · **Контрольный принтер** (X/Z отчёт учун).
- **inject.js API:** `printStationsReceipt` (станцияларга), `printClientReceipt` (мижоз чеки), `printWithCommands` (хом ESC/POS), `findPrinters`, cashdraw.
- **Оқим:** заказ «Отправить» → таомлар отдел бўйича гуруҳланади → ҳар отдел ўз принтерига (raw ESC/POS, порт **9100**, **CP866**). Нақд ёпишда → Чек принтер + касса тортмаси очилади.

## 2. La Limonariya — ҲОЗИР
- **Тайёр (муҳим!):** `stations` жадвал (`printable` флаги) · kitchen ticket **станцияга гуруҳланган** (`kitchenTicketItems.station` snapshot) · `sendToKitchen` · `products.stationId`.
- **Печать:** `Pos.tsx` — `KitchenTicketView` (кухня тикети) ва `Chek` (мижоз чеки) → **`window.print()`** (браузер, 58/80mm CSS, битта принтер, **диалог очади**).
- **ЙЎҚ:** тармоқ принтерга авто, станция→IP маршрутизация, raw ESC/POS, CP866, cashdraw, silent печать, бир нечта принтерга бир вақтда.

## 3. ЕЧИМ — локал мост-агент (архитектура)
Браузер темирга (принтер) тўғридан кира олмайди → **кичик локал агент** (CloPOS'нинг ўзи қилгани):
```
La Limon веб (kassa) ──HTTP/WS──> Мост-агент (кассада, Node.js) ──TCP 9100──> Станция принтерлари
                                   escpos-network + iconv(CP866)
```
- Агент = кичик Node.js хизмат/exe кассада ишлайди. Веб `sendToKitchen`/чек ёпганда агентга юборади → агент керакли **станция IP'сига** raw ESC/POS босади (silent, кесиш/звук/касса тортмаси).
- **Йўллар:** (A) алоҳида агент-хизмат (тавсия — веб кодга тегмайди, PWA қолади) ёки (B) La Limon'ни Electron'га ўраш.

## 4. BACKEND spec

### 4.1. Схема (`schema.ts`)
- **`printers` (янги):** `id, name, type pgEnum('network','usb','windows'), ip, port int default 9100, width int default 80, codepage text default 'cp866', cashdraw bool, beep bool, fastPrint bool, active`.
- **`printer_stations` (янги, many-to-many):** `printerId → printers, stationId → stations` (+ виртуал «receipt»/«чек» отдел учун махсус stationId ёки `role` устуни). Битта принтер кўп станцияга, битта станция кўп принтерга.
- `stations`га `+ printerId?` (содда вариант: 1 станция→1 принтер) — ёки юқоридаги m2m (CloPOS каби).

### 4.2. tRPC (`router.ts`)
- **`printers.list/create/update/delete`** (director) — принтер CRUD (IP, отделы, width, codepage, cashdraw, beep).
- **`printers.test({printerId})`** — тест печать (агентга юборади).
- **`pos.sendToKitchen` кенгайтириш:** тикет тузилгач → ҳар станция учун **агентга print-job** юбориш (station→printer маршрут; `printer_stations`дан). Мавжуд kitchen ticket мантиғи тайёр.
- **`pos.close` кенгайтириш:** ёпилганда → «Чек» отдел принтерига мижоз чеки + нақд бўлса **cashdraw**.
- (Печать хатоси — блокламайди, retry/лог.)

### 4.3. Мост-агент (алоҳида Node сервис — `apps/bridge` ёки standalone)
- Кутубхоналар: **`escpos` + `escpos-network`** (Socket ip:9100), **`iconv-lite`** (CP866 encode), `express`+`ws` (веб'дан қабул).
- **API:** `POST /print { printerIp, port, width, codepage, doc }` — `doc` = ESC/POS буфер ёки {type:'ticket'|'receipt', lines, cut, cashdraw, beep}.
- **ESC/POS:** align/text (CP866 encode), `cut()`, `cashdraw()`, `beep()`. Station'га гуруҳланган таомлар → кухня тикети форматида.
- **`findPrinters`:** subnet (192.168.1.x) 9100-портда сканлаш + тест.

## 5. FRONTEND spec
- **Принтер созлама экрани** (director, янги — `Printerlar.tsx` ёки Устройства): принтер қўшиш/таҳрир — IP, **отделы** (checkbox: Чек/OSHXONA/BAR/SALAT/SHASHLIK/BALIQ/NON CHOY), Width (58/80), Codepage (CP866), Денежный ящик, Звук, Быстрая печать · **Тест печать** тугма · Он-лайн/Оффлайн ҳолат.
- **`Pos.tsx` печать:** `sendToKitchen`/чек ёпиш → **агентга юбориш** (`window.print()` ўрнига). **Fallback:** агент топилмаса → мавжуд `window.print()` (браузер) — ишончлилик.

## 6. Босқичлар / приоритет
1. **Мост-агент MVP** — битта принтерга raw ESC/POS (CP866, 9100) + тест печать.
2. **`printers` схема + станция→IP маршрут** — `sendToKitchen` агентга.
3. **Мижоз чеки + cashdraw** ёпишда.
4. **Принтер созлама UI** (отделы, width, codepage).
5. Fallback (агент йўқ → window.print).

## 7. Хулоса Шерхонга
- **Энг муҳим P1** — ҳар куни, ҳар заказда. `window.print()`нинг заиф жойини (диалог, битта принтер) ёпади.
- La Limon схемаси **тайёр** (stations.printable, kitchen ticket станцияга гуруҳланган) — мост уланиши осон.
- Калит: **порт 9100 · CP866 (кириллица) · станция→IP маршрут · escpos-network**. Реал IP карта: §1 жадвал / [[clopos-printer-map]].
