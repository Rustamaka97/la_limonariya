# La Limonariya — Frontend + Backend Full Structure

> Тех-ҳужжат · меъморий якуний лойиҳа · senior dev (aka) кўриб чиқиши учун
> Версия: greenfield design (apps/ ва packages/ ҳали мавжуд эмас) · сана: 2026-06-27

---

## 1. Қисқача (Overview)

La Limonariya — ресторан бошқарув тизими, **Clopos POS'ни тўлиқ алмаштиради**. Уни шунчаки касса эмас, балки **ўз-ўзини текширадиган анализ-машина** деб қараш керак: остаток, таннарх ва аномалияларни тарихдан ўрганиб, директорни алдашнинг 23 та "тешиги"ни ёпади.

**Учта асосий cheklov (constraints) — бутун дизайн шуларга бўйсунади:**

1. **Offline-first.** Кассa/официант интернетсиз ишлаши шарт. Барча ёзишлар — append-only outbox (UUID идемпотентлик), реконнектда flush. Ҳеч қандай маълумот йўқолмайди.
2. **Алдаб бўлмайдиган ҳисоб-китоб (un-fakeable).** Остаток (qoldiq), таннарх ва баланслар **ҳеч қачон қўлда таҳрирланмайди** — улар фақат event ledger'дан (`stock_movements`, `finance_transactions`, `customer_ledger`) ҳисобланади.
3. **Multi-branch day 1.** `branch_id` биринчи кундан **ҳар бир жадвалда**. Ҳозир битта филиал (Навои), лекин tenant-изоляция кейин қўшиладиган нарса эмас.

Қўшимча кесувчи қоидалар: UZS бутун сон (Math.round, касрсиз), вақт UTC сақланади / UTC+5 (Asia/Tashkent) кўрсатилади, иш-куни **06:00→06:00**, UI тили **узбек-кирилл**.

### Стек (битта жадвалда)

| Қатлам | Технология |
|---|---|
| Frontend | Vite + React 19 + TypeScript SPA, installable PWA (`vite-plugin-pwa`, injectManifest) |
| UI | Tailwind v4 + shadcn/ui, i18next (uz-Cyrl) |
| State/Data | TanStack Query + tRPC client · Dexie/IndexedDB (offline cache + outbox) |
| Routing | React Router (lazy per-feature) |
| Admin | Refine v5 — **айни SPA ичида** `/admin/*` остида |
| API | Hono (Node 22) + end-to-end **tRPC** · `/api/v1/*` REST фақат ташқи webhook'лар учун |
| Auth | Better Auth (4 рақамли PIN, RBAC) |
| DB | self-hosted PostgreSQL 17 + **Drizzle ORM** |
| Realtime | Postgres `LISTEN/NOTIFY` → битта WebSocket (Hono hub) |
| Offline sync | Service Worker + Dexie outbox + UUID идемпотентлик; LWW (orders) / 2-step reconcile (stock/обвалка) |
| Деплой | Docker Compose (Caddy + api + postgres + pgBackRest), Sanoat ERP ёнида изоляцияда |
| Observability | GlitchTip |
| Monorepo | pnpm workspace + turbo |

---

## 2. Monorepo дарахти

```
la_limonariya/
├── apps/
│   ├── web/                 # Vite React 19 SPA + PWA (POS + Refine admin)
│   └── api/                 # Hono + tRPC server (sync server + realtime + webhooks)
├── packages/
│   ├── db/                  # Drizzle schema + migrations + triggers + seed
│   └── shared/              # Zod contracts, domain enums, sync envelope, money/date utils
├── infra/                   # docker-compose, Caddyfile, postgres/pgbackrest, deploy scripts
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── biome.json              # (yoki eslint)
├── .env.example
└── README.md
```

Тўрт пакет, иккита илова. `packages/shared` — клиент ва сервер **бир хил** Zod схемаларни ва sync контрактини импорт қилади (drift йўқ). `packages/db` — Drizzle схемасининг ягона манбаси; ундан `drizzle-zod` орқали `shared` Zod схемалари ҳосил бўлади.

---

## 3. Frontend — `apps/web`

Vite + React 19 SPA, installable PWA. **Feature-first** (қатлам бўйича эмас, домен бўйича гуруҳлаш). Ҳар бир feature ўз `components/ hooks/ api/ pages/` ва barrel `index.ts`'сига эга; feature'лар бир-бирининг ичига импорт қилмайди — фақат `src/lib` ва `src/components` орқали.

```
apps/web/
├── index.html
├── vite.config.ts            # react + tailwind v4 + pwa(injectManifest → src/offline/pwa/sw.ts)
├── components.json           # shadcn/ui CLI
├── tailwind.css              # @import "tailwindcss"; @theme tokens; shadcn vars
├── public/
│   ├── manifest.webmanifest  # "La Limonariya", standalone, lang uz-Cyrl, shortcuts (POS/Обвалка)
│   ├── offline.html          # SW navigation fallback
│   ├── icons/  fonts/        # maskable PWA icons; self-hosted Cyrillic font (offline-safe)
└── src/
    ├── main.tsx              # createRoot; SW register; GlitchTip boot
    ├── App.tsx               # <AppProviders> + <RouterProvider/>
    │
    ├── app/                  # ── APP SHELL ──
    │   ├── providers/        # AppProviders (order: I18n→Query→Trpc→Auth→Branch→Realtime)
    │   ├── router/           # index.tsx, routes.ts (typed paths), guards.tsx, lazy.ts
    │   ├── layouts/          # RootLayout, PosLayout(kiosk), BackofficeLayout, AdminLayout
    │   ├── ErrorBoundary.tsx
    │   └── PwaUpdatePrompt.tsx
    │
    ├── features/             # ── FEATURE-FIRST bounded contexts ──
    │   ├── auth/             # PinPad, LockScreen, usePinLogin, useLockOnIdle
    │   ├── pos-waiter/       # TableMap, MenuGrid, OrderCart; useOpenOrder/useAddLine/useSendToKitchen
    │   ├── pos-cashier/      # CheckSummary, PaymentSplitter, ServiceChargeBadge, DebtDialog,
    │   │                     #   DeleteLineAuthDialog(director-PIN); useShift(50k/X/Z), useCashOut
    │   ├── obvalka/          # CORE: CarcassForm, PartSplitTable, BalanceMeter(±5%), NormHint,
    │   │                     #   lib/costing.ts (cost → sellable parts only; suyak/charvi/brak=0),
    │   │                     #   TwoStepReconcileDialog; useObvalkaDraft (Dexie)
    │   ├── warehouse/        # StockTable(from movements), SkewerStageBoard(raw→marinade→vitrina),
    │   │                     #   InventoryCountSheet, BatchLabel(FIFO/expiry), LocationMoveDialog
    │   ├── finance/          # AccountsPanel, CashOutDialog, PnlCard(Income−COGS−OPEX), TaxNote
    │   ├── director/         # KpiStrip, AnomalyFeed, SignalCard(gram>150g, ±5%), TaskBoard, FineDialog
    │   └── catalog/          # ProductPicker, CategoryTree, PriceHistoryTable
    │
    ├── admin/                # ── REFINE v5, айни SPA ичида /admin остида ──
    │   ├── AdminApp.tsx      # <Refine> + trpcDataProvider + authProvider + accessControlProvider
    │   ├── dataProvider.ts   # Refine list/getOne/create/update → tRPC procedures
    │   ├── authProvider.ts   # Better Auth PIN session → Refine auth contract
    │   ├── accessControlProvider.ts  # RBAC → Refine can() (director-only edits)
    │   ├── resources.ts
    │   └── resources/        # products/ categories/ tech-cards/ halls/ payment-types/ users/
    │
    ├── offline/              # ── OFFLINE LAYER ──
    │   ├── db/               # dexie.ts (LimonariyaDB; har bir store branchId bilan), schema.ts, seed.ts
    │   ├── outbox/           # outbox.ts (append-only, UUID idempotencyKey), enqueue.ts, types.ts
    │   ├── sync/             # syncEngine.ts (flush-on-reconnect, ordered drain), conflict.ts
    │   │                     #   (LWW | 2-step reconcile), backoff.ts, status.ts
    │   ├── hooks/            # useLiveQuery, useOutbox, useSyncStatus, useOnline
    │   └── pwa/              # registerSW.ts, sw.ts (custom SW: cache + nav fallback)
    │
    ├── lib/                  # ── CROSS-CUTTING INFRA (non-feature) ──
    │   ├── trpc/             # client.ts, links.ts (auth → offline/outbox → httpBatchLink), queryClient.ts
    │   ├── realtime/         # socket.ts (one reconnecting WS), channels.ts, useRealtime.ts,
    │   │                     #   configVersion.ts (bump → refetch config + soft reload)
    │   ├── auth/             # session.ts, permissions.ts (role→perm matrix), can.ts
    │   ├── printing/         # printer.ts (transport), escpos.ts (CP866), templates/, routing.ts, usePrint.ts
    │   ├── i18n/             # i18n.ts (uz-Cyrl default, ru fallback), locales/uz-Cyrl/*.json
    │   ├── money.ts  datetime.ts  observability.ts  utils.ts(cn)
    │
    ├── components/           # ── SHARED UI ──
    │   ├── ui/               # shadcn primitives
    │   ├── feedback/         # OfflineBanner, SyncBadge, EmptyState
    │   ├── data/             # DataTable, MoneyText, DateText
    │   ├── layout/           # Sidebar, Topbar, BranchSwitcher
    │   └── numpad/           # NumPad, QtyStepper (kitchen-friendly large touch)
    │
    ├── config/               # branches.ts, stations.ts (6), halls.ts (service %), constants.ts
    ├── styles/globals.css
    └── test/                 # vitest + fake-indexeddb + msw (offline/sync tests)
```

**POS + Refine admin + offline бирлашуви:**

- **POS** иккита feature'га бўлинган — `pos-waiter` (чек очиш, қаторлар, станцияга юбориш; **очган официант** attribution'и) ва `pos-cashier` (чек ёпиш, multi-tender, қарз, смена X/Z; **ёпган кассир** attribution'и). Сабаб: пул/қарз/смена юзаси меню юзасидан кескин фарқ қилади ва role-gate бошқача.
- **Refine admin** — алоҳида илова эмас, айни SPA ичида `/admin/*` lazy-route subtree. Битта build, битта Better Auth сессия, битта shadcn тема, **айни tRPC backend** — adapter provider'лар (`dataProvider`/`authProvider`/`accessControlProvider`) орқали. Director-only, lazy юкланади, шунинг учун bundle нархи cheklangan.
- **Offline қатлами** — UI'нинг ягона ёзиш йўли. Component'лар **ҳеч қачон** tRPC mutate'ни тўғридан-тўғри чақирмайди → `features/*/api` `enqueue()` орқали outbox'га ёзади. Ўқишлар `useLiveQuery` (Dexie, instant/offline) орқали; TanStack Query сервердан реконсиляция қилади. `qoldiq`/`cost`/`balance` Dexie'да **ҳеч қачон** таҳрирланувчи майдон эмас — улар `stock_movements` устидаги selector'лар.

---

## 4. Backend — `apps/api`

Hono HTTP server + end-to-end tRPC. Қатъий **router → service → repository** қатламлаш. tRPC ички; `/api/v1/*` фақат ташқи webhook.

```
apps/api/
├── package.json              # hono, @hono/node-server, @trpc/server, @hono/trpc-server,
│                             #   better-auth, ws, superjson, pino, zod, drizzle
├── Dockerfile                # multi-stage: pnpm deploy --filter @limon/api → node:22-alpine
└── src/
    ├── index.ts              # entrypoint: env → HTTP listen → WS hub + pg LISTEN + jobs; graceful shutdown
    ├── app.ts                # Hono assembly: mounts /trpc, /api/v1, /auth/*, /health; global middleware
    │
    ├── config/               # env.ts (zod, fail-fast), constants.ts (06:00, 50k, tax 4%, ±5%, 150g,
    │                         #   STATIONS[6], HALLS[]), logger.ts (pino + redaction)
    │
    ├── trpc/                 # ── tRPC core ──
    │   ├── context.ts        # { db, session(user+role+branchId), deviceId, reqId, now() }
    │   ├── trpc.ts           # initTRPC; superjson; errorFormatter (AppError→TRPCError + zod flatten)
    │   ├── procedures.ts     # public / protected / branch / permission(perm) / director procedures
    │   ├── middleware/       # auth, rbac, branch(pin+reject cross-branch), audit(set_config), idempotency
    │   └── router.ts         # appRouter = mergeRouters(...); export type AppRouter  ← contract boundary
    │
    ├── routers/              # ── THIN: validate(Zod from shared) → call ONE service → shape ──
    │   ├── foundation/       # auth, users, branches, audit
    │   ├── catalog/          # products(type discr.), categories, units, halls, stations, prices(eff-dated)
    │   ├── recipes/          # techCards (recipe_lines; ad-hoc Фарш Шапок→Фарш)
    │   ├── obvalka/          # carcass, obvalka(commit, ±5% preview), norms(read)
    │   ├── stock/            # movements, balances(read-only), locations, production(skewer), inventory, labels
    │   ├── pos/              # orders(open/addLine/split/transfer/close), orderLines(delete-after-print), checks
    │   ├── payments/         # payments(multi-tender), paymentTypes, customers, debt
    │   ├── finance/          # accounts, transactions(double-entry), cashouts, pnl, shift(50k/X/Z)
    │   ├── anomaly/          # signals, alerts
    │   ├── admin/            # config(bump config_version), roles, tasks, integrations
    │   ├── reports/          # daily/weekly/monthly (06:00 boundary)
    │   └── sync/             # sync.router.ts (push/pull), apply.ts, handlers/, conflict.ts, cursor.ts
    │
    ├── services/             # ── USE-CASE: invariants + transactions + post-commit NOTIFY ──
    │   ├── obvalka/          # obvalka.service.ts, cost-engine.service.ts (CORE: cost→sellable, suyak/charvi/brak=0)
    │   ├── stock/            # movement(single append-point), balance(derive qoldiq+WAC), production, inventory(2-step)
    │   ├── pos/              # order(LWW, transfer/split), checkout(CLOSE: write-off+payments+finance tx+print)
    │   ├── payments/         # payment(split, tax 4% card-only), debt(running balance, immutable journal)
    │   ├── finance/          # ledger(double-entry before/after invariant), shift(X/Z, камомад→director), pnl
    │   ├── anomaly/          # anomaly.service.ts ("heart": norms vs thresholds → signals + alerts)
    │   ├── admin/            # config.service.ts (tx: edit → bump config_version → notify)
    │   └── reports/          # report.service.ts (businessDay() aggregation)
    │
    ├── repositories/         # ── ONLY layer that imports packages/db (Drizzle) ──
    │   ├── base.repo.ts      # withTx, branch-scoped builders (auto branch_id), soft-delete (is_active=false)
    │   ├── stockMovement.repo.ts  # append-only; SUM/window for balances
    │   └── catalog/ order/ payment/ finance/ anomaly/ config/ report.repo.ts (raw SQL where Drizzle awkward)
    │
    ├── auth/                 # better-auth.ts (PIN plugin + drizzleAdapter), handler.ts (/auth/*),
    │                         #   pin.ts (argon2 + lockout), rbac.ts (hasPermission — re-checked in services)
    │
    ├── realtime/             # listen.ts (one pg LISTEN 'limon_changes'), ws-hub.ts (per-branch rooms,
    │                         #   auth handshake), channels.ts, publish.ts (post-commit NOTIFY)
    │
    ├── webhooks/             # ── /api/v1/* (signature-verified raw body → same services) ──
    │   ├── index.ts          # Hono sub-app
    │   ├── click.webhook.ts  # prepare/complete + MD5
    │   ├── payme.webhook.ts  # JSON-RPC Merchant API + Basic
    │   ├── fiscal.webhook.ts # marking-apparatus / fiscal
    │   └── telegram.webhook.ts
    │
    ├── printing/             # printer.service.ts (route → 5 kitchen + 1 cassa), escpos.ts (CP866),
    │                         #   templates/ (kitchen-ticket, guest-check=Clopos format), queue.ts (offline-tolerant)
    │
    ├── jobs/                 # scheduler.ts; recompute-norms (nightly sliding-median+confidence/n),
    │                         #   expiry-check, business-day-close(06:00 snapshots), anomaly-sweep(23-hole)
    │
    ├── notifications/        # telegram.client.ts, sms.client.ts
    ├── lib/                  # errors.ts (AppError hierarchy), business-day.ts, money.ts, http.ts (sig verify)
    └── health/               # health.router.ts (/health liveness + /ready db+listener probes)
```

**Қатламлаш (layering):** `router` (юпқа: validate → service → shape, **ҳеч қачон** Drizzle'га тегмайди) → `service` (барча инвариантлар, транзакциялар, бир неча repo чақириши) → `repository` (Drizzle'ни импорт қиладиган **ягона** жой, branch-scoping ва soft-delete марказлашган). Бу business rule'ларни HTTP'сиз test қилишга имкон беради.

**Auth + RBAC:** Better Auth 4 рақамли PIN (argon2 + per-user lockout), Drizzle adapter. RBAC **икки жойда** — `permissionProcedure(perm)` tRPC чегарасида **ва** ҳассос service'ларда `hasPermission()` қайта текширилади → authorization data-йўлда, фақат middleware'да эмас. Bypass қилинган router escalate қила олмайди.

**Realtime:** битта узоқ яшайдиган pg client `LISTEN limon_changes` қилади; `ws-hub` per-branch room'ларга **битта** WebSocket орқали fan-out қилади (handshake'да session-token auth). `publish.ts` service'лар томонидан **commit'дан кейин** чақирилади — rollback бўлган checkout ҳеч қачон NOTIFY юбормайди.

**Webhooks:** `/api/v1/*` — ягона non-tRPC юза. Ҳар бири raw body'да имзони текширади, кейин **айни** service'ларга йўналади (дубль business logic йўқ). Сессия/branch йўқ → branch order/customer'дан service ичида аниқланади, "system" principal остида ишлайди.

---

## 5. Маълумотлар базаси — `packages/db`

Drizzle ORM, numeric-prefix файллар (`01_…10_`) FK/migration тартибини кодлайди; `index.ts` барчасини re-export қилади (drizzle-kit битта схема кўради).

```
packages/db/src/
├── client.ts                # drizzle(pool, { schema }) — connection'ni egallaydigan yagona joy
├── schema/
│   ├── _shared.ts           # column helpers: id()=uuid pk, branchId()=NOT NULL FK (HAR jadvalda),
│   │                        #   money()=bigint UZS, timestamps(), businessDay(), softDelete(); shared pgEnums
│   ├── 01_foundation.ts … 10_ops.ts
│   ├── relations.ts         # barcha drizzle relations() (import sikllarini oldini olish)
├── triggers/
│   ├── audit.sql            # generic plpgsql audit trigger (table,row_id,old/new jsonb,editor,branch,ts)
│   ├── config_bump.sql      # har config_* yozuvi → config_version++ + pg_notify('limon_changes')
│   ├── change_log.sql       # change_log + pg_notify (sync pull cursor + realtime)
│   └── finance_invariant.sql# after_amount == before_amount + amount
├── functions/business_date.sql  # business_date(ts) = (ts at +5, shifted −6h)::date
├── migrations/              # drizzle-kit generated SQL + meta/_journal.json (committed)
└── seed/                    # 01_branches_roles … 06_payment_finance (idempotent, FK-safe order)
```

### Жадваллар — 10 модул бўйича (table → асосий устунлар)

**1 — Foundation** (`01_foundation.ts`)
- `branches` (id, name, is_active)
- `users` (id, branch_id, name, pin_hash, is_active) — Better Auth
- `roles`, `permissions`, `role_permissions`, `user_branches` (M2M) — RBAC: директор/админ/кассир/складчи/официант
- `sessions` (Better Auth)
- `audit_log` (table, row_id, action, old jsonb, new jsonb, editor, branch_id, ts) — **DB trigger ёзади**
- `config_version` (version monotonic int) — админ таҳрирда bump, клиентларга push

**2 — Catalog** (`02_catalog.ts`)
- `products` (id, branch_id, **type**: INGREDIENT/PART/SEMI/DISH/GOODS, name, category_id, station_id, unit_id, is_active) — **битта жадвал, type discriminator**
- `categories` (tree), `stations` (6: OSHXONA/BAR/SALAT/SHASHLIK/BALIQ/NON CHOY), `units` (+conversion), `halls` (service %: Асосий 10/Катта 10/Собой 0/Терраса 15)
- `restaurant_tables` (hall_id, plan x/y/w/h/shape)
- `price_history` (product_id, price, **effective_from**) — **effective-dated append-only**, current = latest `effective_from ≤ now()`, ҳеч қачон overwrite йўқ

**3 — Recipes / тех-карта** (`03_recipes.ts`)
- `tech_cards` (effective-dated header, product_id, effective_from)
- `recipe_lines` (tech_card_id, component_product_id, grams, marinade_gain_pct OR absolute)
- `production_docs` + `production_lines` — ad-hoc Фарш (Шапок→Фарш, fixed recipe йўқ; output=tarozi, cost=Σ(input×cost)÷output_kg)

**4 — Обвалка + cost engine** (`04_obvalka.ts`) — **CORE**
- `carcass_templates` (qo'y/mol), `carcass_template_parts` (canonical part list + norm bands)
- `carcasses` (id, branch_id, type, weight, purchase_price) — битта харид = битта carcass, ўз нархи
- `carcass_parts` (carcass_id, name, weight, **is_sellable**, computed_cost, balance_pct) — cost фақат sellable'га тарқалади (suyak/charvi/brak=0), ±5% balance check
- `obvalka_norms` (carcass_type, part, median, n, confidence) — sliding-median ўрганилган нормалар

**5 — Stock** (`05_stock.ts`) — **event-sourced, balance жадвали ЙЎҚ**
- `stock_movements` (id=client UUID, branch_id, product_id, location_id, **type**: PURCHASE/OBVALKA/PRODUCTION/WRITE_OFF/COUNT/LOSS/LOCATION_MOVE, qty_g signed, unit_cost frozen, source_type, source_id, batch_id, moved_by, occurred_at) — **ягона ҳақиқат манбаси**; `qoldiq`+cost = Postgres VIEW (SUM over movements)
- `locations` (Fridge/Marinad/Vitrina), `batches` (FIFO/expiry)
- `inventory_counts` + `inventory_count_lines` (computed vs actual, reason on diff, director approval gate)
- 3-bosqichли skewer (raw kg → marinade kg → vitrina dona) = movement занжири

**6 — Orders / POS** (`06_orders.ts`)
- `orders` (id, branch_id, sale_type зал/собой, hall_id, table_id, **waiter_id**(opened), **cashier_id**(closed), business_day, status)
- `order_lines` (order_id, product_id, snapshot_price, qty, station_id)
- `order_line_events` — delete-after-print (director perm), split, transfer учун **immutable journal**. Write-off → `stock_movements` фақат CLOSE'да ("no ticket = no dish")

**7 — Payments + debt** (`07_payments.ts`)
- `payment_types` (Cash/Card/Click/Payme/Humo/Customer-balance; flags: can_split/customer_required/account_id) — configurable
- `customers` (name, phone), `payments` (order_id, type, amount) — multi-tender
- `customer_ledger` — **immutable append-only** қарз журнали; debt = running sum (negative = қарздор), қисман тўлов, лимитсиз

**8 — Finance + shift** (`08_finance.ts`)
- `balance_accounts` (Cash/Card/Bank/Safe/Supplier/Customer)
- `finance_transactions` — **double-entry**, before_amount/after_amount (trigger: after==before+amount), group_hash legs'ни боғлайди
- `shifts` (open 50k float, X, Z, business_date), `shift_counts`, `cash_outs` (typed: purchase/expense/owner-draw)
- P&L derived (Income − COGS-on-sale − OPEX, owner-draw+debt **истисно**); tax 4% фақат card; **камомад → директор** (auto-charge йўқ)

**9 — Anomaly** (`09_anomaly.ts`) — **"юрак"**
- `signal_rules` (configurable: shashlik gram >150g yellow/>160 red, обвалка balance >±5%, daily revenue <9M, margin drift)
- `derived_norms` (sliding-median, n/confidence/window) — обвалка ва POS portion-check'ни озиқлантиради
- `signals` (type, severity, payload jsonb, status open/ack/resolved, director-targeted, 23-hole leak taxonomy)

**10 — Ops** (`10_ops.ts`)
- `tasks` (director→staff, status), `fines` (user/signal, amount, reason — **payroll'дан auto-deduct ЙЎҚ**)
- `report_snapshots` (materialized daily/weekly/monthly KPI: revenue/net-profit/debt/top-dish/breakeven)
- `print_jobs` (5 kitchen + 1 cassa, CP866 render, status/retry)

**+ Sync infra** (`sync.ts`): `processed_mutations` (PK mutation_id, идемпотентлик ledger), `change_log` (bigserial **seq** = global pull cursor, branch_id, entity, payload jsonb), `device_registry` (device_id↔user/branch, last_seq_acked).

### Кесувчи DB қоидалари

- **`branch_id` NOT NULL ҳар бир жадвалда** day 1; composite index'лар `branch_id` билан бошланади.
- **Money = bigint UZS** (numeric/float эмас, Math.round, касрсиз). Вақт = timestamptz UTC сақланади, UTC+5 кўрсатилади; `business_day` алоҳида date устун, 06:00 cutoff'да ҳисобланган.
- **Event-sourcing** иккита ҳақиқат-критик доменда: qoldiq/cost ← `stock_movements`, debt ← `customer_ledger`, balance ← `finance_transactions`. **Қўлда таҳрирланувчи balance устуни ЙЎҚ.** Append-only + reversal rows, ҳеч қачон UPDATE/DELETE.
- **Effective-dated append-only**: `price_history`, `tech_cards` — тарихий сотувлар тўғри re-price бўлади.
- **Soft delete** `is_active=false`; `audit_log` + `order_line_events` immutable who/when/what беради.
- **UUID PK client-side** (`crypto.randomUUID()`) — offline outbox идемпотентлиги.
- **Governance DB қатламида**: `audit_log` plpgsql trigger ёзади (app кодга ишонмайди, editor = `set_config('app.user_id')` GUC); `config_version` админ ёзувда bump + push.

### `packages/shared`

```
packages/shared/src/
├── zod/          # drizzle-zod createInsert/SelectSchema → refined (PIN 4-digit, money +int, biz-day)
├── contracts/    # tRPC contract types + DTOs (ObvalkaResult, DashboardKpis, PnLBreakdown, StockQoldiqRow);
│                 #   shared enums (ProductType, MovementType, Role, SignalSeverity…) re-exported from db pgEnums
├── sync/         # envelope.ts (MutationEnvelope: mutation_id, device_id, client_seq, branch_id,
│                 #   business_date, type, payload, client_ts), mutations.ts (discriminated union), config.ts
└── utils/        # money.ts (UZS int), date.ts (businessDate() 06:00, Asia/Tashkent, DD.MM.YYYY HH:mm), constants.ts
```

`drizzle-zod` — кўприк: DB схемаси ягона манба, tRPC контрактлари жадваллардан drift қила олмайди.

---

## 6. Асосий оқимлар (Key flows)

### Flow 1 — Order → Close → Write-off → Cost
1. Официант **offline** `order.create` (Dexie optimistic + outbox).
2. Ҳар таом `order.line.add` → ўз станциясига чоп этилади (OSHXONA/BAR/SALAT/SHASHLIK/BALIQ/NON CHOY). "No ticket = no dish" — қатор **ўзи** чек.
3. Кассир ёпади → `order.close` handler **битта tx'да**: hall бўйича service charge (Асосий/Катта 10, Собой 0, Терраса 15) → ҳар DISH'ни `tech_card recipe_lines` бўйича explode (marinade gain % билан) → WriteOff `stock_movements` (фақат CLOSE'да) → COGS movement-cost'дан қайта ҳисоб → multi-tender payments + double-entry finance tx + tax 4% card-only → print.
4. `change_log` row → NOTIFY → бошқа терминаллар янгиланади. `business_date` close вақтидан (06:00 қоида).

### Flow 2 — Обвалка → per-carcass cost → learned-norm
1. `obvalka.record`: carcass (qo'y/mol, weight, purchase_price) + ўлчанган parts.
2. Handler: cost'ни **фақат sellable** parts'га тарқатади (suyak/charvi/brak=0) → ±5% balance check (Σparts четлашса flag) → Obvalka `stock_movements` append → learned norm'ни янгилайди (sliding median + confidence/n).
3. **Reconcile-class** (LWW эмас): иккита қурилма айни carcass'ни юборса, иккинчиси mutation_id no-op; ҳақиқий count дисути → **директор approval**.

### Flow 3 — Shift open → Z → камомад
1. `shift.open` → 50k float + business_date. X = read.
2. `shift.zclose` handler: tendered cash − typed cash-outs (purchase/expense/owner-draw) − refund'ларни санаб, ҳисобланган нақд билан солиштиради → **kamomad row → ДИРЕКТОР** (кассирга auto-charge ЙЎҚ) → кун охири нақд Сейф account'га double-entry → Z-report. P&L owner-draw+debt истисно.

### Flow 4 — Offline order → synced
1. Offline: optimistic local apply + outbox enqueue.
2. Reconnect: `flusher` `client_seq` тартибида push.
3. Server `mutation_id` бўйича dedupe → apply → `change_log` emit.
4. Ҳар қурилма `puller` `last_pulled_seq`дан pull қилиб реконсиляция. Ярим юборилган batch қайта юборилса — зарарсиз (идемпотент).

---

## 7. Офлайн-синхрон протоколи (қисқа)

- **Wire contract** = `packages/shared/src/sync` (`MutationEnvelope` + discriminated-union payloads). Клиент ва сервер **айни** шакилни импорт қилади.
- **Идемпотентлик**: `mutation_id` (client UUID) → `processed_mutations` `ON CONFLICT DO NOTHING`. Қайта push = no-op, оригинал натижани қайтаради. Flaky network, SW retry, double-tap — хавфсиз.
- **Тартиб**: `(device_id, client_seq)` — outbox append-only, per-device `client_seq` тартибида flush (causal: `order.create` → `order.line.add`). Server pull cursor = global `change_log.seq`.
- **Conflict policy (битта жойда — `conflict.ts`)**:
  - **LWW** (`client_ts`, `device_id` bo'yicha) — single-owner объектлар (официант эгалик қилган order).
  - **2-step reconcile** — `inventory_count` ва **обвалка**: сервер client+server иккала қийматни сақлайди, **директор approve** қилади. Silent overwrite маҳсулот тутиши керак бўлган leak сигналини ўчириб юбормайди.
- **bg-sync**: SW Background Sync + iOS `visibilitychange`/`online`/foreground-interval fallback (Safari BG Sync ишончсиз; терминаллар always-on desktop, official телефонлари focus'да flush).

```ts
// apps/api/src/sync/apply.ts — идемпотент apply + change-feed
export async function applyEnvelope(ctx, env) {
  return ctx.db.transaction(async (tx) => {
    const fresh = await tx.insert(processedMutations)
      .values({ mutationId: env.mutation_id, branchId: env.branch_id })
      .onConflictDoNothing().returning();
    if (!fresh.length) return getCachedResult(tx, env.mutation_id);   // replay → no-op
    const result = await handlers[env.type](tx, ctx, env.payload);    // domain effect
    await tx.insert(changeLog).values({ branchId: env.branch_id, entity: env.type, payload: result });
    await cacheResult(tx, env.mutation_id, result);                   // trigger → pg_notify
    return result;
  });
}
```

---

## 8. Рустам таҳрирлайдиган config механизми (қисқа)

Эга/админ ўзгартирадиган қийматлар (hall service %, smena float, signal threshold'лар, payment types, tax %) **end-to-end typed**:

1. `config_*` typed жадвал + мос **Zod** (`shared`) + Postgres **CHECK** constraint (бир хил чегаралар) — defense in depth (edge'да Zod, DB'да CHECK).
2. Админ ёзуви → `config_bump.sql` trigger: `config_version++` + `pg_notify('limon_changes', kind='config')`.
3. `listen.ts` → WS hub → клиентлар "stale" эканини билиб **re-pull** қилади (`configVersion.ts`: refetch config + soft-prompt reload).

Клиент ҳеч қачон admin таҳририни ўтказиб юбормайди — config_version trigger кафолатлайди.

---

## 9. Деплой — `infra/`

Self-host Docker Compose, мавжуд **Sanoat ERP ёнида** ишлайди, тўлиқ изоляцияда.

```
infra/
├── docker-compose.yml          # caddy, api, postgres, pgbackrest (+opt glitchtip)
├── Caddyfile                   # SPA static (try_files→index.html) + reverse-proxy /api,/trpc,/ws; auto-TLS
├── .env.example                # POSTGRES_*, DATABASE_URL(host 'postgres'), BETTER_AUTH_SECRET,
│                               #   APP_DOMAIN, DEFAULT_BRANCH_ID, BUSINESS_DAY_CUTOFF=06:00, TZ=Asia/Tashkent
├── api.Dockerfile
├── postgres/                   # Dockerfile(pg17+pgbackrest), postgresql.conf(wal_level=logical, tz=UTC),
│                               #   init/ (00-extensions pgcrypto/pg_trgm, 10-app-role least-priv)
├── pgbackrest/                 # pgbackrest.conf (encrypted, daily full+WAL), crontab (03:00 full, hourly incr)
├── caddy/snippets/security-headers   # HSTS, CSP, COOP
└── scripts/                    # deploy.sh (pull→build→migrate→up→healthcheck→rollback), migrate.sh,
                                #   backup-now.sh, restore.sh, seed.sh, healthcheck.sh
```

**Изоляция калити:** app Postgres **фақат Compose ички тармоғида** (`host 'postgres'`), хостга `:5432` **публиш қилинмайди** → Sanoat ERP'нинг Postgres'и билан конфликт йўқ. Фақат Caddy `:80/:443` публиш қилади. Realtime = `LISTEN/NOTIFY` → битта WS (иккинчи message broker йўқ). Backup'лар (03:00 full, hourly incr) 06:00 иш-куни flip'дан олдин. `deploy.sh` healthcheck fail'да олдинги image tag'га rollback.

---

## 10. ⚠️ Reviewer учун саволлар / қарорлар

Aka, қуйидагилар очиқ қолган — фикрингиз керак:

**Stack / framework танлови**
1. **Drizzle vs Prisma** — Drizzle танладик (енгил, SQL-яқин, raw SQL осон report учун, edge-friendly). Лекин Prisma migration/DX етукроқ. Greenfield'да Drizzle'да қоламизми?
2. **Refine vs Directus (vs hand-rolled CRUD)** — Refine'ни айни SPA ичида `/admin`'да mount қилдик (битта build, shared auth). Lekin Refine енгил эмас. Альтернативалар: алоҳида `apps/admin` entry, ёки Directus (бутун admin'ни tashqaridan), ёки кичик qўлда CRUD. Director-only + lazy bo'lgani uchun runtime nархи cheklangan — bundle/maintenance tradeoff'ни qabul qilamizmi?
3. **Hono vs Fastify** — Hono танладик (енгил, tRPC adapter, edge-friendly, WS). Fastify етукроқ ecosystem/plugin'га эга. Hono'да қоламизми?

**Sync / offline edge case'лар**
4. **LWW (orders) vs 2-step reconcile (inventory/обвалка)** split UX-жиҳатдан maqbulmi? Обвалка conflict'ни **складчи** қурилмада ҳал қиладими ёки **директорга** escalate qiladimi? Бу `TwoStepReconcileDialog`'нинг қаерда яшашини белгилайди.
5. **Write-off-on-sale идемпотентлиги**: order-close'ни **terminal + idempotent** деб моделладик (line-level эмас). Ёпилган чек икки марта flush бўлса — terminal transition етарлими, ёки line-level идемпотентлик керакми?
6. **`change_log` retention** — append-only, чексиз ўсади. Барча `device_registry.last_seq_acked` ўтгандан кейин N кундан эски row'ларни prune қилиш керак. Сиёсат hali yo'q — qaror керак.
7. **config_version: global vs per-branch** — ҳозир битта global counter. Лекин hall service % arguably branch-scoped. Multi-branch divergence'да per-branch versioning'га ўтиш керакми?
8. **iOS PWA**: Safari Background Sync ишончсиз → `visibilitychange`/foreground fallback. Background'даги iPad sync'ни кечиктириши mumkin. Терминаллар always-on bo'lgani uchun maqbul — aggressive keep-alive керакми?

**DB / invariant'лар**
9. **qoldiq/cost: VIEW vs materialized** — соф event-sourcing (compute-on-read) тўғри, лекин dashboard кўп qoldiq ўқийди. VIEW now + profiling кўрсатса materialized snapshot. **Mutable `stock_balance` жадвали ҚЎШМАЙМИЗ** — тасдиқлайсизми?
10. **Cost basis: WAC vs FIFO** — `stock_movements.unit_cost` move-вақтида frozen. Айни маҳсулот турли нархдаги бир неча carcass'дан келганда WAC'ми FIFO'ми? Анализ aniqligiga (52.6% COGS) тўғридан таъсир қилади.
11. **Double-entry invariant: DB trigger vs service-only** — immutable нарсалар (append-only ledger, audit_log, config_version) DB trigger; лекин ±5% обвалка balance, double-entry before/after, write-off-on-CLOSE service'да. Double-entry'ни **ҳам** DB constraint qilaylikmi (defense in depth) ёки service'да qoldiramizmi (testable)?
12. **Audit editor identity** — `set_config('app.user_id')` GUC'га боғлиқ. API ҳар connection-checkout'да буни ишончли set qilishi shart, акс ҳолда `audit_log.editor` null. Bu db↔api cross-package contract — hozir lock qilamiz.

**Auth / xavfsizlik**
13. **4 рақамли PIN энтропияси паст** — argon2 + lockout режа. Сессия device-bound bo'lsinmi? WS handshake fresh short-lived token talab qilsinmi (session cookie qayta ishlatish o'rniga)? Device revocation v1'dami yoki defer?

**Жараён / process**
14. **Single API process vs split** — WS hub + pg LISTEN + cron jobs hammasi `index.ts`'da bitta Node process'da. Single-server Compose uchun sodda, lekin multi-replica'da cron double-fire + har replica o'z LISTEN'i. `JOB_RUNNER=true` env flag yoki pg advisory-lock leader-election'ni **hozir** qo'shamizmi (keyin refactor emas)?
15. **Printing transactionality** — print commit'dan keyin enqueue qilinadi (rollback bo'lgan checkout chop etmaydi), lekin commit↔enqueue orasida crash ticket'ni yo'qotishi mumkin. "No ticket = no dish" core bo'lgani uchun **transactional outbox** print row'ga moyilmiz. Tasdiqlaysizmi?
16. **Printing transport** — WebUSB vs network ESC/POS box vs cassa-PC print-agent? CP866 + guest-check template aniq, lekin transport hali pinned emas — end-to-end ulashdan oldin qaror kerak.
17. **config_version + open check** — narx smena o'rtasida o'zgarsa, ochiq chekni re-price qilamizmi yoki open-time narxda muzlatamizmi? Bu finance/correctness qarori configVersion hard vs deferred reload'ni belgilaydi.
