---
name: w3-director
description: Фаза W3 «Директор-люкс» из docs/PREMIUM-POS-REJA-2026-07-04.md — спарклайны, тепловая карта столов, live-пульс зала, «vs прошлая пятница», P&L one-pager. Пункты 3.1–3.5, всё dep-free SVG + directorProcedure.
argument-hint: "[пункт, напр. 3.4 — или пусто = порядок Спринта 2]"
---

# W3 · Директор-люкс 📊

Цель: Dashboard — любимый утренний экран Рустама ака.
Пункты: таблица W3 в [docs/PREMIUM-POS-REJA-2026-07-04.md](docs/PREMIUM-POS-REJA-2026-07-04.md). Аргумент = один пункт.

## Порядок (обязательный)

1. Прочитать раздел W3 + карту кода. Допущения по-русски → подтверждение Шерхона → код.
2. Каждый новый агрегат: сначала tRPC-процедура + PG17-интеграционный тест, потом UI.
3. Хирургически; существующие процедуры денег не переписывать — переиспользовать хелперы.

## Карта кода

- `apps/web/src/Dashboard.tsx` — hero «Бугун» (`Big`-тайлы), `trpc.analytics.digest`, аудит-журнал.
- `apps/api/src/router.ts` — `analytics.digest`, `report.byCategory/topDishes`, хелперы `orderRevenueFraction` (доля реализованной выручки заказа: comp=0, split, debt), `expectedCashForWindow`.
- `apps/api/src/time.ts` — `businessDayBounds`, `businessRangeBounds`, `previousDayKey` — **граница дня 06:00 Ташкент, все даты только через эти хелперы, не `new Date()` напрямую**.
- Роли: новые endpoints = `directorProcedure` (`apps/api/src/trpc.ts`).
- SVG-паттерн без библиотек уже есть: иконки в `Pos.tsx:109`.

## Правила по пунктам

- **3.1 Спарклайны**: endpoint `report.trend` (director): 14 дней — тушум/чеки/средний чек по дням (`businessRangeBounds`). UI: SVG `polyline` ~100×28, последняя точка золотая, тренд цветом (зелёный/красный); вставить в `Big`-тайлы hero.
- **3.2 Тепловая карта зала**: endpoint `report.byTable` (выручка по столам за период, join через orders.tableId с учётом `orderRevenueFraction`). Режим «💰» на карте зала (директор only): заливка столов по квантилям cream→gold→brand-deep, сумма по тапу.
- **3.3 Пульс зала**: автообновление digest каждые 30 с в Dashboard: `setInterval` + guard `document.visibilityState === "visible"` + cleanup в useEffect; индикатор «жонли» пульсирует. Не спамить сервер со скрытой вкладки.
- **3.4 vs прошлый такой же день**: расширить `analytics.digest`: `revenueLastWeekSameDay`, `checksLastWeekSameDay` (тот же день недели, −7 дней, те же business-bounds) → в hero «↑ 12% ўтган жумага нисбатан» + та же строка в Telegram-дайджест (`sendDailyDigest`).
- **3.5 P&L one-pager**: endpoint `report.pnl` (месяц по неделям: тушум / COGS / OPEX / иш ҳақи / эга олди / соф фойда — переиспользовать существующие агрегаты и правило «эга олди не входит в прибыль»). UI: печатная страница `@media print` A4 (одна страница!), кнопка «🖨 P&L» в Ҳисобот (директор).

## PG17-интеграционный протокол (для каждого нового агрегата)

```bash
docker run -d --name limon-itest -e POSTGRES_PASSWORD=t -p 5499:5432 postgres:17-alpine
cd apps/api
export DATABASE_URL=postgres://postgres:t@localhost:5499/postgres
pnpm exec tsx src/db/migrate.ts && pnpm exec tsx src/db/seed.ts
# при нужде: seed-tables.ts, seed-stock.ts, seed-gramnorm.ts
# написать src/_w3_itest.ts: (appRouter as any).createCaller({ c: {}, user: {role:"director",...} })
pnpm exec tsx src/_w3_itest.ts        # обязательные кейсы: пустой день · comp · split cash+debt · возврат · скидка
rm src/_w3_itest.ts && docker rm -f limon-itest
```

## Gate W3

```bash
pnpm --filter @limon/api typecheck && pnpm --filter @limon/web typecheck && pnpm --filter @limon/web build
pnpm --filter @limon/api exec tsx src/obvalka-norms.test.ts   # 23 — без регресса
```
- PG17-тесты зелёные (включая split-оплату — через `orderRevenueFraction`).
- Все новые endpoints — directorProcedure (проверить: waiter/cashier получают FORBIDDEN).
- Скриншоты до/после Dashboard.

## Анти-scope

Никаких chart-библиотек — только рукописный SVG. Существующие цифры digest не менять (только добавлять поля). P&L — читает, ничего не пишет.
