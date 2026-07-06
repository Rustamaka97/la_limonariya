# Касса операциялари (кирим/чиқим/перевод) + кўп пул ҳисоби — backend + frontend spec

> CloPOS «Добавить операцию» — 4 тип операция + **кўп пул ҳисоби** (Касса·Карта·Банк·Сейф) орасида перевод. La Limonariya'да қисман (Расход+Инкассация бор; Доход, Перевод, ҳисоблар — ЙЎҚ). Приоритет: **P1** (молиявий аниқлик).

## 1. CloPOS'да (кеча ҳар тип ичи кўрилди)
| Тип | Майдон/категориялар |
|---|---|
| **Расход** (чиқим) | Категория: Другие расходы · Заработная плата · Бонус · Поставки · Корректировка |
| **Доход** (кирим) | Категория: Корректировка · Платеж от поставщиков |
| **Перевод** (кўчириш) | **Баланс:** Касса · Карточный счет · Банковский счет · Сейф (ҳисоблараро) |
| **Инкассация** | Сумма + Описание (кассадан сейфга) |
- ★ **Кўп пул ҳисоби:** Касса · Карточный счет · Банковский счет · Сейф — ва улар орасида **Перевод** билан пул кўчирилади.

## 2. La Limonariya — ҲОЗИР (`apps/api/src`)
- **`expenses`** жадвал (= Расход): `category` enum(ижара/газ/электр/ойлик/жиҳоз/бошқа), amount, method(pay enum), recurring, note, spentAt, createdById. `finance.expenses.create/list/delete` (director).
- **`cashCollections`** (= Инкассация): amount, note, performedById. `finance.collectCash` (director/manager) → `expectedCashForWindow`дан айирилади.
- **ЙЎҚ:** Доход (кирим операцияси), Перевод (ҳисоблараро), **ҳисоблар модели** (Касса/Карта/Банк/Сейф — La Limon'да пул implicit, битта `expectedCash`).
- **Frontend:** `Moliya.tsx` — харажатлар + инкассация + till count (X/Z смена).

## 3. BACKEND spec (янги)
### 3.1. Схема (Drizzle `schema.ts`)
- **`accounts` (янги):** `id, name, kind pgEnum('cash','card','bank','safe'), active`. Seed: Касса, Карточный счет, Банковский счет, Сейф.
- **`cash_operations` (янги, append-only ledger):** `id, type pgEnum('income','expense','collection','transfer'), amount int, accountId uuid→accounts (кирим/чиқим ҳисоби), toAccountId uuid→accounts (фақат transfer'да), category text, note, performedById, createdAt`.
  - **Ҳар ҳисоб баланси = SUM:** account'га `income`/`transfer-in` (+), `expense`/`collection`/`transfer-out` (−). Ledger'дан ҳисобланади (ustunda emas).
  - **Transfer** = битта op: `accountId`дан (−) → `toAccountId`га (+).
- **Migrate:** мавжуд `expenses` → `cash_operations`(type=expense, accountId=Касса), `cashCollections` → (type=collection, Касса→Сейф). Ёки эскиларни қолдириб, устига `income`/`transfer`/`accounts` қўшиш (кам инвазив; тавсия — босқичли).

### 3.2. tRPC (`router.ts`)
- **`finance.operations.create({type, amount, accountId, toAccountId?, category?, note})`** — ledger'га insert. Роль: director/manager (пул). `expense`/`collection`/`transfer`да ҳисоб баланси етарлилигини текшир (over-draw ҳимояси, `paySupplier` каби advisory-lock).
- **`finance.accounts.balances()`** — ҳар ҳисоб жорий баланси (SUM). director.
- **`finance.operations.list({from,to})`** — давр операциялари.
- **Интеграция:** заказ ёпилганда тўлов усулига қараб тегишли ҳисобга кирим (нақд→Касса, карта→Карточный счет...) — келажакда авто. Ҳозир: қўлда операция.
- `expectedCashForWindow`/`till` мантиғини **Касса ҳисоби** бўйича қайта ифодалаш.

## 4. FRONTEND spec (`Moliya.tsx`)
- **«Добавить операцию» modal:** **тип селектор** (Расход/Доход/Инкассация/Перевод) → **динамик майдон:**
  - Расход/Доход: Категория (тип бўйича рўйхат) + Сумма + Ҳисоб + Изоҳ.
  - Перевод: Қайси ҳисобдан → қайси ҳисобга + Сумма.
  - Инкассация: Сумма + Изоҳ (Касса→Сейф).
- **Ҳисоблар панели:** Касса · Карта · Банк · Сейф — ҳар бирининг жорий баланси (`accounts.balances`).
- Операциялар журнали (давр бўйича).

## 5. Босқичлар
1. **`accounts` (4 та) + `cash_operations` ledger** — фундамент.
2. **Доход + Перевод** (кирим + ҳисоблараро).
3. **Frontend** Moliya'да тип-селектор + ҳисоб баланслари.
4. Заказ тўловини авто тегишли ҳисобга (келажак).

## 6. Хулоса Шерхонга
- **Кўп ҳисоб = P1** (реал молиявий аниқлик: нақд/карта/банк/сейф алоҳида кузатилади).
- Мавжуд `expenses`/`cashCollections`ни **кенгайтир** (ёки migrate) — нолдан эмас.
- Ledger фалсафаси: ҳисоб баланси = SUM(operations).
