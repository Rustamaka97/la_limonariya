---
name: w2-brand
description: Фаза W2 «Бренд-полировка» из docs/PREMIUM-POS-REJA-2026-07-04.md — люкс-вход с 3D-лого, лого на чеке (ESC/POS), фирменные шрифты, PWA-иконки, тёмная тема POS, микро-анимации. Пункты 2.1–2.6.
argument-hint: "[пункт, напр. 2.3 — или пусто = порядок Спринта 1]"
---

# W2 · Бренд-полировка 🎨

Цель: узнаваемая красота La Limonariya в каждом пикселе и на каждом чеке.
Пункты: таблица W2 в [docs/PREMIUM-POS-REJA-2026-07-04.md](docs/PREMIUM-POS-REJA-2026-07-04.md). Аргумент = один пункт.

## Порядок (обязательный)

1. Прочитать раздел W2 + файлы ниже. Допущения по-русски одним сообщением → подтверждение Шерхона → код.
2. Скриншот ДО каждого изменяемого экрана (preview), после — скриншот ПОСЛЕ. Без пары до/после пункт не считается сделанным.
3. Хирургически: логику auth/денег/печати не менять — только внешний слой.

## Карта кода и активов

- Палитра: `apps/web/src/index.css` `@theme` (`--color-brand #0e4037`, `--color-brand-gold #f3b759`, cream…) и `apps/web/src/brand.ts` (`BRAND`, телефон, инстаграм).
- Исходник 3D-лого: `docs/imgs/limonariyalogo.jpg` (+ `restlogo.jpg`).
- PWA: `apps/web/vite.config.ts` (manifest), иконки `apps/web/public/brand/` (icon-192/512, maskable, logo-96).
- Вход: `apps/web/src/Login.tsx` (PIN-pad, уже brand-deep + gold).
- Печать: `apps/api/src/printing/escpos.ts` (`encodeCp866`, `buildCheck`, `buildKitchenTicket`, `sendToPrinter`).

## Правила по пунктам

- **2.1 Вход-люкс**: лого 128–160px из 3D-jpg (обработать → `public/brand/logo-320.png`), мягкое появление (CSS keyframes fade+scale 400 мс), золотое кольцо/тень, тап-анимация клавиш. Логику `auth.login`/rate-limit НЕ трогать.
- **2.2 Чек с лого**: ESC/POS raster `GS v 0`. Битмап генерировать ОФФЛАЙН-скриптом из `docs/imgs/limonariyalogo.jpg` → grayscale → Floyd–Steinberg 1-bit → ширины 384px (58мм) и 576px (80мм) → закоммитить как base64-модуль `apps/api/src/printing/logo-bitmap.ts`. **Никаких image-библиотек в runtime api.** В `buildCheck` — лого перед шапкой; низ: «Раҳмат! · la-limonariya.uz · @la_limonariya» (константа в escpos.ts с комментом-ссылкой на brand.ts — api не импортирует web). Юнит: буфер начинается с `1D 76 30`, ширина 48/72 байта. Реальная печать — только в W6; до неё пункт = «готов к печати», не DONE.
- **2.3 Шрифты**: self-hosted woff2 в `apps/web/public/fonts/`: Playfair Display 600/700 (заголовки), Manrope 400/500/700 (текст), JetBrains Mono 500 (цифры/суммы). **Обязательно кириллические subset — весь UI на узбекской кириллице.** `@font-face` + `@theme` `--font-display/--font-sans/--font-mono`, `font-display: swap`. Проверка: Network tab = 0 внешних запросов, оффлайн-режим — шрифты живы.
- **2.4 PWA-иконки**: из 3D-лого → 192/512/maskable-512 (safe zone 80%, фон #0e4037), заменить в `public/brand/`; `apple-touch-icon` + iOS meta в `index.html`. Проверить «Добавить на главный экран» на планшете.
- **2.5 «Вечерний зал»**: тёмная тема ТОЛЬКО для POS-экрана: `data-theme="dark"` на контейнере Pos, поверхности brand-deep/ink, золотые акценты; переключатель 🌙 в шапке POS + localStorage. Красный/зелёный статусы столов должны остаться различимы (контраст ≥ 4.5:1).
- **2.6 Микро-анимации**: CSS-only + один хук `useCountUp` (rAF, 400 мс, tabular-nums уже стоит): галочка-пульс после закрытия чека, мягкое свечение карточки аномалии, count-up цифр Big в Dashboard. Уважать `prefers-reduced-motion`.

## Gate W2

```bash
pnpm --filter @limon/web typecheck && pnpm --filter @limon/web build
pnpm --filter @limon/api typecheck   # для 2.2
```
- Скриншоты до/после каждого экрана — показать пользователю.
- 0 внешних сетевых запросов (шрифты/иконки локально) — оффлайн-first не сломан.
- 2.2: юнит-тест структуры буфера зелёный; тест-печать запланирована в W6.

## Анти-scope

Не менять поведение auth, печатной логики отправки (`sendToPrinter`), денег. Никаких CDN/Google Fonts. Никаких UI-библиотек.
