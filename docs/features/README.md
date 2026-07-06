# La Limonariya — CloPOS функцияларини кўчириш (feature spec'лар)

> Ҳар функция учун **backend + frontend** implementation MD. Шерхон битталаб олади. Умумий анализ: [../CLOPOS-KOCHIRISH-SHERXON.md](../CLOPOS-KOCHIRISH-SHERXON.md).

## ✅ Тайёр feature MD'лар

| # | Функция | Файл | La Limon'да ҳолат | Приоритет |
|---|---|---|---|---|
| 1 | **Возврат** (пул қайтариш) | [vozvrat-refund.md](vozvrat-refund.md) | ✅ **ТАЙЁР** (finance.refund + ChekQidirish). Фақат keypad quick-find ихтиёрий | паст |
| 2 | **Клиенты** (CRM + ҳамён: баланс/бонус/гуруҳ/скидка/тарих) | [klienty-crm-wallet.md](klienty-crm-wallet.md) | ❌ **ЯНГИ** (катта, босқичли) | P1–P2 |
| 3 | **Касса операциялари** + кўп пул ҳисоби (Касса/Карта/Банк/Сейф) | [kassa-operatsiyalari-hisoblar.md](kassa-operatsiyalari-hisoblar.md) | ◑ қисман (Расход+Инкассация бор; Доход/Перевод/ҳисоблар йўқ) | **P1** |
| 4 | **Чеки** рўйхат + фильтрлар (open/closed/offline) | [cheki-royxat-filtr.md](cheki-royxat-filtr.md) | ◑ қисман (ChekQidirish + FloorView) | P2 |
| 5 | **Чек «Действия»** (амаллар журнали / audit trail) | [chek-deystviya-audit.md](chek-deystviya-audit.md) | ◑ қисман (voidedItems/kitchenTickets; timeline йўқ) | P1–P2 |
| 6 | **Сотрудники** (ходим бошқаруви) | [xodimlar-staff.md](xodimlar-staff.md) | ✅ ~90% тайёр (gap: Карта/card login, фильтр) | паст |
| 7 | ★ **Станция печати** (мост-агент, ESC/POS, CP866, 9100) | [stansiya-pechati-bridge.md](stansiya-pechati-bridge.md) | ◑ қисман (window.print бор; тармоқ/станция→IP/CP866 йўқ) | **P1 №1** |
| 8 | **Мулти-терминал** (Локальные/Мобильные) + KDS | [multi-terminal-kds.md](multi-terminal-kds.md) | ✅ асос тайёр (PWA); gap: KDS экрани + real-time push | P2–P3 |
| 9 | **Создать отчет** (X-отчёт) | [otchet-x-report.md](otchet-x-report.md) | ◑ қисман (financeForWindow/pnl бор; оралиқ/меҳмон/печать йўқ) | P2 |
| 10 | **Стоп-лист** (таом тугади) | [stop-list.md](stop-list.md) | ❌ янги (оддий — products.stopped флаги) | P2 |
| 11 | **Юқори панель** (зал/Новый заказ/Чеки/🔔/🟢/юзер) | [top-bar-navigation.md](top-bar-navigation.md) | ✅ асосан тайёр; gap: 🔔bell-center, 🟢Статус | P3 |
| 12 | **Заказ амаллари** (side toolbar — барча амал) | [zakaz-amallari-toolbar.md](zakaz-amallari-toolbar.md) | ◑ бир қисми бор (send/cancel/note/guests); янги: разделить/объединить/изменить стол·официант | P2 |
| 13 | **Скидка** (чегирма) | [skidka.md](skidka.md) | ❌ янги (сервис бор, скидка йўқ) | **P1** |
| 14 | **Пречек** (тўловдан олдин счёт) | [precheck.md](precheck.md) | ❌ янги | **P1** |
| 15 | **Разделить / Объединить чеки** (split/merge bill) | [razdelit-obedinit-chek.md](razdelit-obedinit-chek.md) | ❌ янги (multi-tender бор, split bill йўқ) | P2 |
| 16 | **Оплата** (Произвести платеж) | [oplata-payment.md](oplata-payment.md) | ✅ **ТАЙЁР** (pos.close — 5 усул + split + comp, CloPOS'дан бойроқ) | — |
| 17 | **Тарози / Продажи по порциям** (тортиб сотув) | [tarozi-porciyalar.md](tarozi-porciyalar.md) | ◑ soldByWeight майдон бор; тарози темир/оқим йўқ | P2 |
| 18 | **Доставка / Курьер** (delivery) | [dostavka-courier.md](dostavka-courier.md) | ❌ янги (фақат зал/собой; доставка/курьер/манзил йўқ) | P2 |
| 19 | **QR меню** (контактсиз рақамли меню) | [qr-menu.md](qr-menu.md) | ❌ янги (веб — осон) | P3 |
| 20 | **Оффлайн режим** (SQLite/queue + sync) | [offline-rejim.md](offline-rejim.md) | ❌ янги (катта иш) | P3 |

## 🎉 БАРЧА АСОСИЙ ФУНКЦИЯ ҲУЖЖАТЛАШТИРИЛДИ (20 MD)
CloPOS'нинг барча реал функцияси (панель · устройства · заказ экрани · тўлов · доставка · тарози · оффлайн · QR) — 20 та backend+frontend MD.

### Майда UI (критик эмас — Шерхон La Limon UI'ни ўзи қуради)
- Заказ меню-тулбар: 🔍search · ⚙️settings · ⭐favorites · ▦grid-view · ⏸/🔒 lock (терминал/чек блокировкаси)
- «Платежи» модул = Click/Payme провайдер интеграцияси (§ oplata-payment §4) — P3, алоҳида

## Қайд
- Иерархия/роль қонунлари — **кодда бажарилган** (§ CLOPOS-KOCHIRISH-SHERXON.md 8.1).
- Ҳар MD: CloPOS'да қандай → La Limon'да ҳозир → backend spec → frontend spec → босқич/приоритет.
