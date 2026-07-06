# Сотрудники (ходим бошқаруви) — backend + frontend spec

> Ходим CRUD + роль + кириш. **La Limonariya'да ~90% ТАЙЁР.** Асосий CloPOS gap: **Карта (card login)** + фильтрлар. Приоритет: **паст–ўрта**.

## 1. CloPOS'да (жонли — рўйхат + Создать сотрудника формаси кўрилди)
- **Рўйхат** — **Поиск** (қидирув) + устунлар: Полное имя · **Дата создания** · **Карта** · Статус.
- **Фильтрлар:** Статус (Все / Активен / Неактивный) · **Должность** (Manager / Ofitsiant / Kassir).
- Ходимга: **Подробный вид** · **Редактировать** · **Удалить** · «Создать сотрудника».
- **«Создать сотрудника» формаси (майдонлар):**
  - **Полное имя и фамилия** (ex: John Doe)
  - **Должность** (Выберите: Manager / Ofitsiant / Kassir)
  - **Карта** — hex ID (ex: `564as8AFF845f`) — RFID/магнит карта рақами
  - **Пин** (ex: 1234) — 4 рақам
  - **Статус** (Активен / Неактивный) · Отмена / Сохранить
- ★ **Кириш: Карта ВА PIN — иккови ҳам** (ходим иккисидан бири билан киради). «Не добавлено» = карта йўқ.

## 2. La Limonariya — ҲОЗИР (ТАЙЁР)
- **Backend (`router.ts`):** `users` жадвал (name, `role` enum: director/manager/buyer/cashier/waiter, pinHash, pinLookup, active, branchId, createdAt). Procedure'лар: **`users.list`** (protected), **`users.create`** (name, role), **`users.update`** (name, role, active), **`users.setPin`** (4-рақам PIN) — create/update/setPin = **director**.
- **Frontend (`Shell.tsx` «Ходимлар» таб, фақат director):**
  - Рўйхат (`users.list`): исм, роль (ROLE_LABEL), актив (нофаол = хира).
  - **＋ Ходим** → форма: исм · роль (waiter/cashier/manager/buyer/director селектор) · актив checkbox → `users.create`/`users.update`.
  - **PIN** → `users.setPin` (4 рақам).

## 3. Фарқ (нима бор / нима йўқ)
| | CloPOS | La Limon |
|---|:--:|:--:|
| Рўйхат · Create/Edit · роль · актив | ✅ | ✅ |
| **PIN кириш** | ~ | ✅ (setPin) |
| **Карта (RFID/магнит) кириш** | ✅ | ❌ |
| Фильтр (статус/должность) | ✅ | ❌ |
| Дата создания кўрсатиш | ✅ | ◑ (createdAt бор, кўрсатилмайди) |
| Hard delete | ✅ | ◑ (active=false, ўчирмайди) |

## 4. BACKEND spec (қўшимча — кичик)
- **Карта (card login):** `users`га `+ cardId text unique?` (ёки `cardHash`). Янги **`auth.loginCard({cardId})`** — картадан юзерни топиб сессия очиш (PIN логикаси каби, `pinLookup` ўрнига `cardId`). Терминал USB карта-ридер орқали (мост-агент ёки HID keyboard-emulation).
- Дата/фильтр — backend'да ўзгартириш йўқ (`createdAt` бор; фильтр frontend'да).

## 5. FRONTEND spec (қўшимча)
- «Ходимлар»га: **фильтр** (статус: барча/актив/нофаол · роль), **дата создания** устуни.
- **Карта UI:** ходим таҳриридa «Карта бириктириш» (ридер ўқийди → cardId сақланади). Login экранига «Карта билан кириш» опцияси.

## 6. Хулоса Шерхонга
- **Сотрудники ~90% ТАЙЁР** — қайта қуриш шарт эмас.
- Ягона муҳим gap: **Карта (card login)** — карта-ридер + `auth.loginCard`. Приоритет: **паст** (PIN ишлайди; карта — қулайлик).
- Фильтр/дата — кичик frontend enhancement.
