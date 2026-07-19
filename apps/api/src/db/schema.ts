import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const userRole = pgEnum("user_role", [
  "director",
  "manager",
  "buyer",
  "cashier",
  "waiter",
]);

export const branches = pgTable("branches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  role: userRole("role").notNull(),
  pinHash: text("pin_hash"),
  pinLookup: text("pin_lookup").unique(),
  active: boolean("active").notNull().default(true),
  branchId: uuid("branch_id").references(() => branches.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const productType = pgEnum("product_type", [
  "ingredient",
  "part",
  "semi",
  "dish",
  "goods",
]);

export const productUnit = pgEnum("product_unit", ["dona", "kg", "g", "l", "ml"]);

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  cloposId: integer("clopos_id").unique(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const stations = pgTable("stations", {
  id: uuid("id").primaryKey().defaultRandom(),
  cloposId: integer("clopos_id").unique(),
  name: text("name").notNull(),
  printable: boolean("printable").notNull().default(true),
  // Тармоқ принтери IP'си (RAW TCP 9100). null = принтер йўқ (чоп ўтказилмайди).
  ip: text("ip"),
});

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  cloposId: integer("clopos_id").unique(),
  name: text("name").notNull(),
  type: productType("type").notNull(),
  unit: productUnit("unit").notNull(),
  categoryId: uuid("category_id").references(() => categories.id),
  stationId: uuid("station_id").references(() => stations.id),
  price: integer("price").notNull().default(0),
  costPrice: integer("cost_price"),
  soldByWeight: boolean("sold_by_weight").notNull().default(false),
  // 1 сихга/порцияга кетадиган гўшт нормаси (г). Faqat сих таомларда тўлади;
  // null = грамм назорати йўқ. Сих грамм-оқма сигнали учун (M3).
  gramNorm: integer("gram_norm"),
  // Яроқлилик муддати (кун). null = муддат назорати йўқ (эга қарори: ҳозирча
  // барчаси null, expiry-флаг ухлайди — M3 витрина/муддат).
  shelfLifeDays: integer("shelf_life_days"),
  // Стоп-лист: таом вақтинча тугади — менюда хира «СТОП», addItem рад этади.
  // active'дан фарқи: вақтинчалик ва кассир ҳам қўя олади (тез реакция).
  stopped: boolean("stopped").notNull().default(false),
  active: boolean("active").notNull().default(true),
  branchId: uuid("branch_id").references(() => branches.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const recipes = pgTable("recipes", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").references(() => products.id),
  name: text("name").notNull(),
  kind: text("kind"),
  category: text("category"),
  yieldG: integer("yield_g"),
  marinade: text("marinade"),
});

export const recipeItems = pgTable("recipe_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipeId: uuid("recipe_id")
    .notNull()
    .references(() => recipes.id, { onDelete: "cascade" }),
  componentId: uuid("component_id").references(() => products.id),
  componentName: text("component_name").notNull(),
  qtyG: integer("qty_g"),
  stockHint: text("stock_hint"),
  sort: integer("sort").notNull().default(0),
});

export const carcassType = pgEnum("carcass_type", ["qoy", "mol"]);

// Маринад партияси: хом лаҳм омбордан ЧИҚАДИ, ўсиш% қўшилиб маринадланган
// гўшт чиқади. Сих грамм-оқма сигнали шу партиялар vs сотилган сихдан
// ҳисобланади. (M3, MVP: pooled лаҳм — алоҳида ярим-тайёр SKU эмас.)
export const marinadeBatches = pgTable("marinade_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  carcassType: carcassType("carcass_type").notNull(),
  rawG: integer("raw_g").notNull(),
  growthPct: integer("growth_pct").notNull(),
  marinatedG: integer("marinated_g").notNull(),
  note: text("note"),
  branchId: uuid("branch_id").references(() => branches.id),
  createdById: uuid("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const partTypes = pgTable(
  "part_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    carcassType: carcassType("carcass_type").notNull(),
    name: text("name").notNull(),
    normMinPct: integer("norm_min_pct"),
    normMaxPct: integer("norm_max_pct"),
    isWaste: boolean("is_waste").notNull().default(false),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [unique().on(t.carcassType, t.name)],
);

export const obvalka = pgTable(
  "obvalka",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    carcassType: carcassType("carcass_type").notNull(),
    weightG: integer("weight_g").notNull(),
    pricePerKg: integer("price_per_kg").notNull().default(0),
    supplier: text("supplier"),
    note: text("note"),
    // Бозорчи киритган расмий харидга ихтиёрий боғлаш (бир харид = бир обвалка,
    // аудит изи учун). Гўшт харидда product сифатида сақланмайди — обвалканинг
    // ЎЗИ харид ёзуви (weightG = харид вазни).
    purchaseId: uuid("purchase_id").references(() => purchases.id),
    // Кам-келтириш сабаби (баланс ±5%дан ошса менежер изоҳи).
    shortReason: text("short_reason"),
    branchId: uuid("branch_id").references(() => branches.id),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // "Бир харид = бир обвалка" — race'да иккита обвалка бир харидга уланмасин
  // (DB даражасида, application SELECT текшируви етарли эмас).
  (t) => [
    uniqueIndex("obvalka_purchase_uq")
      .on(t.purchaseId)
      .where(sql`${t.purchaseId} is not null`),
  ],
);

export const obvalkaParts = pgTable("obvalka_parts", {
  id: uuid("id").primaryKey().defaultRandom(),
  obvalkaId: uuid("obvalka_id")
    .notNull()
    .references(() => obvalka.id, { onDelete: "cascade" }),
  partTypeId: uuid("part_type_id").references(() => partTypes.id),
  name: text("name").notNull(),
  weightG: integer("weight_g").notNull(),
});

export const halls = pgTable("halls", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  servicePct: integer("service_pct").notNull().default(0),
  sort: integer("sort").notNull().default(0),
});

export const tables = pgTable("tables", {
  id: uuid("id").primaryKey().defaultRandom(),
  hallId: uuid("hall_id")
    .notNull()
    .references(() => halls.id),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
  // Витрина/зал харитасидаги эркин жойлашув (директор судраб созлайди); null =
  // ҳали жойлаштирилмаган → авто-тўр.
  posX: integer("pos_x"),
  posY: integer("pos_y"),
  // Плитка ўлчами px (CloPOS каби катта банкет-зал/кабина); null = дефолт 148×96.
  w: integer("w"),
  h: integer("h"),
  active: boolean("active").notNull().default(true),
});

export const orderStatus = pgEnum("order_status", ["open", "closed", "cancelled"]);

// Сотув тури (CloPOS «На месте / Доставка / С собой»): dine_in = залда (стол
// керак), delivery = етказиб бериш, takeaway = олиб кетиш (стол шарт эмас).
// Фақат метадата + чек/KDS ёрлиғи + ҳисобот — пул математикасига тегмайди.
export const saleType = pgEnum("sale_type", ["dine_in", "delivery", "takeaway"]);

// Қарздор меҳмон: қарз танланганда МАЖБУРИЙ бириктирилади (kim qarzdor —
// running-balans shu customer bo'yicha). Nom majburiy, telefon ixtiyoriy.
export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone: text("phone"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Мижоз ҳамёни (лоялти/кешбэк) — append-only ledger, баланс = SUM(amount).
// amount ИШОРАЛИ: + кешбэк/бонус, − сарфлаш/тузатиш. Ombor/asset каби —
// счётчик drift bo'lmасин, подделкага чидамли (money-safety фалсафа).
export const walletKind = pgEnum("wallet_kind", [
  "cashback", // харид учун кешбэк (+)
  "bonus", // директор бонуси — туғилган кун, лоялти (+)
  "redeem", // мижоз сарфлади (−)
  "adjust", // қўлда тузатиш (+/−)
]);

export const customerWalletMovements = pgTable(
  "customer_wallet_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(), // so'm, ишорали
    kind: walletKind("kind").notNull(),
    orderId: uuid("order_id").references(() => orders.id),
    note: text("note"),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cwm_customer_idx").on(t.customerId)],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hallId: uuid("hall_id")
      .notNull()
      .references(() => halls.id),
    tableNo: text("table_no"),
    waiterId: uuid("waiter_id").references(() => users.id),
    status: orderStatus("status").notNull().default("open"),
    servicePct: integer("service_pct").notNull().default(0),
    branchId: uuid("branch_id").references(() => branches.id),
    // debt qaytariladigan mijoz — faqat qarzli yopilgan orderlarda to'ladi.
    customerId: uuid("customer_id").references(() => customers.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedById: uuid("closed_by_id").references(() => users.id),
    // текин/ходим: food still served + stock still deducted, but zero revenue —
    // distinct from debt (which is revenue expected later); comp never is.
    isComp: boolean("is_comp").notNull().default(false),
    compReason: text("comp_reason"),
    // Чегирма (директор/менежер рухсати билан): чек жамидан айирилади,
    // мижоз кам тўлайди. Сабаб мажбурий. Ким берди = closedById. Тешик №12.
    discountAmount: integer("discount_amount").notNull().default(0),
    discountReason: text("discount_reason"),
    guests: integer("guests"),
    note: text("note"),
    // Заказ-блок (CloPOS-паритет): официант хатодан таом қўшмасин/ўзгартирмасин
    // деб кассир/менежер заказни "музлатади". Блокланганда pos.addItem ва
    // ўзгартиришлар рад этилади; фақат блок қўйган/директор ечади.
    locked: boolean("locked").notNull().default(false),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedById: uuid("locked_by_id").references(() => users.id),
    // 🍽 Хизмат ҳақи (сервис %) кечирилдими (CloPOS «Удалить плату за
    // обслуживание») — олиб кетиш/шикоят/ходим. Кечирилганда servicePct=0
    // қилинади (пул автоматик 0), бу флаг фақат UI ҳолати + аудит учун.
    serviceWaived: boolean("service_waived").notNull().default(false),
    // Сотув тури (зал/доставка/собой). Дефолт залда.
    saleType: saleType("sale_type").notNull().default("dine_in"),
  },
  (t) => [index("orders_status_closed_idx").on(t.status, t.closedAt)],
);

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  productId: uuid("product_id").references(() => products.id),
  name: text("name").notNull(),
  price: integer("price").notNull().default(0),
  qty: integer("qty").notNull().default(1),
  // Оғирлик билан сотилган таом (гўшт кг) — киритилган грамм. price = кг-нарх ×
  // грамм/1000 (jami), qty=1 → пул математикаси (price×qty) ЎЗГАРМАЙДИ, weightG
  // фақат кўрсатиш/чек учун (масалан "0.35 кг × 125 000"). null = оддий дона.
  weightG: integer("weight_g"),
  // Официант изоҳи («пиёзсиз», «соус алоҳида»...). Кухняга юборилганда
  // kitchen_ticket_items.note'га snapshot бўлиб кўчади ва тикетда босилади.
  note: text("note"),
  // Курс/подача (CloPOS-паритет): таом қайси тўлқинга тегишли (1=биринчи, 2=…).
  // Кухня тикетида «N-курс» бўлиб чиқади → ошпаз кетма-кетликни билади (банкет).
  course: integer("course").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// "Тикетсиз таом ЙЎҚ" control: an append-only record of what was actually sent
// to the kitchen/station, when, and how much. Never edited — only inserted.
// "Sent so far" for a product in an order = SUM(kitchen_ticket_items.qty) for
// that (order, product); the unsent remainder is what the NEXT send tickets.
export const kitchenTickets = pgTable(
  "kitchen_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // KDS (кухня экрани): ошпаз таом тайёр бўлганда «✓ Тайёр» босади → экрандан
    // кетади. NULL = ҳали пишяпти (KDS'да кўринади). Тикет content'и ўзгармайди.
    bumpedAt: timestamp("bumped_at", { withTimezone: true }),
    bumpedById: uuid("bumped_by_id").references(() => users.id),
  },
  (t) => [index("kt_order_idx").on(t.orderId)],
);

export const kitchenTicketItems = pgTable(
  "kitchen_ticket_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => kitchenTickets.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    name: text("name").notNull(), // snapshot at send-time
    qty: integer("qty").notNull(),
    station: text("station"), // snapshot of products.station at send-time
    note: text("note"), // изоҳ snapshot'и юбориш пайтида («пиёзсиз»...)
    course: integer("course").notNull().default(1), // курс snapshot (KDS/тикет «N-курс»)
  },
  (t) => [index("kti_ticket_idx").on(t.ticketId)],
);

// "Ўчирилган таом" journal: only written when addItem removes/reduces an item
// that was already ticketed to the kitchen (already cooked/served) — a plain
// pre-send edit never touches this table. Append-only, never edited.
export const voidedItems = pgTable(
  "voided_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id),
    name: text("name").notNull(),
    qty: integer("qty").notNull(),
    note: text("note"),
    performedById: uuid("performed_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("vi_order_idx").on(t.orderId)],
);

// Қайта чоп журнали (тешик №22): кухня тикети ёки чек қайта чоп этилса — ким,
// қачон, нима учун. Append-only. Дубликат-чоп/икки-марта-пишир йўлини кузатади.
export const reprintLog = pgTable(
  "reprint_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id"),
    kind: text("kind").notNull(), // "ticket" | "check"
    reason: text("reason"),
    performedById: uuid("performed_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rl_created_idx").on(t.createdAt)],
);

// Норма ўзгариши журнали (immutable audit): ким, қачон, қайси қисм нормасини
// нимадан-нимага ўзгартирди. Анти-ўғирлик назорати базасини ким ва қачон
// ўзгартиргани изланиши учун.
export const normChanges = pgTable(
  "norm_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partTypeId: uuid("part_type_id").references(() => partTypes.id),
    oldMinPct: integer("old_min_pct"),
    oldMaxPct: integer("old_max_pct"),
    newMinPct: integer("new_min_pct"),
    newMaxPct: integer("new_max_pct"),
    source: text("source").notNull(), // "learned" | "manual"
    changedById: uuid("changed_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("nc_created_idx").on(t.createdAt)],
);

// Умумий ўзгармас аудит журнали (immutable): кимнинг қандай ҳимоя-муҳим амали
// (PIN, ходим/роль, нарх, рецепт, буюртма бекор қилиш ...). Ёзилади, ўчирилмайди.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(), // "pin.reset" | "user.update" | "product.update" ...
    entity: text("entity"), // "user" | "product" | "order" | "station" | "recipe"
    entityId: uuid("entity_id"),
    summary: text("summary"), // human-readable qisqa izoh
    meta: jsonb("meta"), // old→new yoki qo'shimcha
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("al_created_idx").on(t.createdAt),
    // Чек тарихи (per-order timeline) тез бўлиши учун: entity='order' + entityId.
    index("al_entity_idx").on(t.entity, t.entityId, t.createdAt),
  ],
);

export const paymentMethod = pgEnum("payment_method", [
  "cash",
  "card",
  "click",
  "payme",
  "humo", // Ҳумо — банк картаси (electronic, card tax'га киради, нақд эмас)
  "debt",
  // Бронь аванси: кассир танламайди — заказ ёпилишида сервер ўзи ёзади
  // (пул броньда олдин олинган; нақд тортма ҳисобига КИРМАЙДИ, тушумга киради).
  "avans",
]);

export const orderPayments = pgTable("order_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  method: paymentMethod("method").notNull(),
  amount: integer("amount").notNull(),
});

export const reservationStatus = pgEnum("reservation_status", [
  "active", // кутиляпти (флоорда бейдж)
  "seated", // меҳмон келди — заказга уланди (orderId)
  "cancelled", // бекор (авансли бўлса resolution мажбурий)
]);

// Бронь (олдиндан жой банд қилиш, CloPOS-паритет). Аванс — пул мутацияси:
// олинган куни кассага киради (expectedCash'да +), заказ ёпилишида 'avans'
// тўлов қатори бўлиб тушумга айланади (depositAppliedAt = идемпотент-гард),
// бекорда директор ҳал қилади: refund (кассадан нақд чиқади) ёки forfeit
// (куяди — касса ўзгармайди). Ҳамма қадам audit_log'да.
export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => tables.id),
    name: text("name").notNull(), // мижоз исми (мажбурий)
    phone: text("phone"),
    guests: integer("guests"),
    reservedFor: timestamp("reserved_for", { withTimezone: true }).notNull(),
    note: text("note"),
    status: reservationStatus("status").notNull().default("active"),
    depositAmount: integer("deposit_amount").notNull().default(0), // 0 = авансиз
    depositMethod: paymentMethod("deposit_method"), // аванс қандай олинди (cash/card/...)
    depositAppliedAt: timestamp("deposit_applied_at", { withTimezone: true }),
    // Бекорда аванс тақдири: "refund" | "forfeit" (авансли броньда мажбурий).
    depositResolution: text("deposit_resolution"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedById: uuid("resolved_by_id").references(() => users.id),
    orderId: uuid("order_id").references(() => orders.id),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("res_table_time_idx").on(t.tableId, t.reservedFor),
    index("res_status_idx").on(t.status, t.reservedFor),
  ],
);

// Официант чақириш (CloPOS-паритет): меҳмон стол QR'ини сканерлаб сигнал беради.
// Auth йўқ (public) — фақат сигнал, маълумот очилмайди. kind = нима сўралди.
export const callKind = pgEnum("call_kind", ["waiter", "bill", "water"]);
export const waiterCalls = pgTable(
  "waiter_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tableId: uuid("table_id")
      .notNull()
      .references(() => tables.id),
    kind: callKind("kind").notNull().default("waiter"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedById: uuid("resolved_by_id").references(() => users.id),
  },
  // Фаол чақириқлар (resolved_at IS NULL) тез сўралади — полл ҳар 15с.
  (t) => [index("wc_active_idx").on(t.resolvedAt, t.createdAt)],
);

export const purchases = pgTable("purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplier: text("supplier"),
  note: text("note"),
  total: integer("total").notNull().default(0),
  paidTotal: integer("paid_total").notNull().default(0), // supplier debt = total − paidTotal
  branchId: uuid("branch_id").references(() => branches.id),
  createdById: uuid("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const purchaseItems = pgTable(
  "purchase_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    qty: integer("qty").notNull(), // base unit: grams for kg/g, ml for l/ml, dona for dona
    unit: productUnit("unit").notNull(),
    price: integer("price").notNull().default(0), // line total, so'm
  },
  (t) => [index("pi_purchase_idx").on(t.purchaseId)],
);

export const movementType = pgEnum("movement_type", [
  "purchase",
  "obvalka",
  "production",
  "sale_writeoff",
  "inventory_adjust",
  "loss",
  "transfer",
]);

// Append-only stock ledger. on-hand = SUM(qty) per product. qty is SIGNED
// (+ inflow, − outflow), in the product's base unit (grams for kg/g/l/ml, dona for dona).
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    type: movementType("type").notNull(),
    qty: integer("qty").notNull(),
    unit: productUnit("unit").notNull(),
    // Локация (омбор) — ҳозирча фақат transfer ҳаракатлари тўлдиради (кўчириш
    // қайси музлаткичдан-қайси музлаткичга). Бошқа ҳаракатларда null.
    storage: text("storage"),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    note: text("note"),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("sm_product_idx").on(t.productId),
    index("sm_ref_idx").on(t.refType, t.refId),
  ],
);

// Offline-first идемпотентлик: клиент ҳар ёзиш амалига op-id беради. Такрор
// (offline навбат/тармоқ retry) юборилса, op-id аллақачон борлиги учун амал
// қайта БАЖАРИЛМАЙДИ. Эскиларини вақти-вақти билан тозалаш мумкин (retention).
export const clientOps = pgTable("client_ops", {
  opId: uuid("op_id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const expenseCategory = pgEnum("expense_category", [
  "ijara", // аренда
  "gaz", // газ
  "elektr", // свет/электр
  "ish_haqi", // ойлик (зарплата)
  "jihoz", // жиҳоз/техника
  "boshqa", // прочее
  "ega_oldi", // 👑 эга олди — фойда ТАҚСИМОТИ (OPEX эмас, соф фойдани камайтирмайди)
]);

// OPEX / cash-out. Aggregated by spentAt (operational day, 06:00 boundary), not createdAt.
export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category: expenseCategory("category").notNull(),
    amount: integer("amount").notNull(), // so'm
    method: paymentMethod("method").notNull().default("cash"),
    recurring: boolean("recurring").notNull().default(false),
    note: text("note"),
    // Кунлик иш ҳақи — қайси ходимга (ish_haqi категорияда). Бошқа харажатларда null.
    staffId: uuid("staff_id").references(() => users.id),
    spentAt: timestamp("spent_at", { withTimezone: true }).notNull().defaultNow(),
    branchId: uuid("branch_id").references(() => branches.id),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("exp_spent_idx").on(t.spentAt)],
);

// Repayments of guest debt (order_payments.method='debt' is a write-once close
// snapshot — this is the running ledger of later repayments against it).
export const debtPayments = pgTable(
  "debt_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    method: paymentMethod("method").notNull().default("cash"),
    note: text("note"),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("dp_order_idx").on(t.orderId)],
);

// Возврат: ёпилган чекдан мижозга қайтарилган пул — журнал, ёзилган order
// ўзи ўзгармайди (тарихий чек тўғри қолади). #13 тешик назорати.
export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    performedById: uuid("performed_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("rf_order_idx").on(t.orderId)],
);

// Инкассация: кун ичи кассадан нақд пул олиш (сейфга) — журнал, изоҳ
// мажбурий. expectedCashForWindow'дан айирилади (пул касса ичида йўқ, лекин
// харажат ҳам эмас), акс ҳолда директорнинг кунлик санашида сохта камомад
// кўринади.
export const cashCollections = pgTable("cash_collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  amount: integer("amount").notNull(),
  note: text("note").notNull(),
  performedById: uuid("performed_by_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// One physical cash count per operational day (директор санайди, камомад кўради).
// Смена = business day (битта кассир, битта смена/кун). "Очиш" — кассир
// PIN билан кириб куннинг бошланганини қайд этади (размен ҳар доим TILL_FLOAT,
// алоҳида сақланмайди). "Ёпиш" (Z) — countedCash киритилганда. Очилмаган
// кунда Z-ёпиш блокланади (tillCount.set'га қаранг).
export const tillCounts = pgTable("till_counts", {
  dayKey: text("day_key").primaryKey(), // 'YYYY-MM-DD' businessDayBounds.dayKey
  openedAt: timestamp("opened_at", { withTimezone: true }),
  openedById: uuid("opened_by_id").references(() => users.id),
  countedCash: integer("counted_cash"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  note: text("note"),
  createdById: uuid("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const inventoryCountStatus = pgEnum("inventory_count_status", [
  "open", // менежер ҳали санаяпти
  "submitted", // менежер юборди, директор тасдиғини кутади
  "approved", // директор тасдиқлади — ledger тузатилди (inventory_adjust)
]);

// One physical count of one storage (Ошхона музлаткич | Катта музлаткич).
// 2-step: manager counts+submits with a reason per gap, director approves —
// only approval writes the reconciling stock_movements (owner-confirmed flow).
export const inventoryCounts = pgTable("inventory_counts", {
  id: uuid("id").primaryKey().defaultRandom(),
  storage: text("storage").notNull(),
  status: inventoryCountStatus("status").notNull().default("open"),
  note: text("note"),
  branchId: uuid("branch_id").references(() => branches.id),
  createdById: uuid("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedById: uuid("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
});

// theoreticalQty is a SNAPSHOT taken at startCount (base units: g/ml/dona) so
// later sales during counting don't retro-shift it. countedQty filled by manager.
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countId: uuid("count_id")
      .notNull()
      .references(() => inventoryCounts.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    theoreticalQty: integer("theoretical_qty").notNull(),
    countedQty: integer("counted_qty"),
    unit: productUnit("unit").notNull(),
    reason: text("reason"),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [index("ii_count_idx").on(t.countId)],
);

export const assetCategory = pgEnum("asset_category", [
  "idish",
  "mebel",
  "texnika",
  "boshqa",
]);

export const assetMovementReason = pgEnum("asset_movement_reason", [
  "kirim",
  "sindi",
  "yoqoldi",
  "tuzatish",
]);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category: assetCategory("category").notNull(),
    name: text("name").notNull(),
    note: text("note"),
    // Дона нархи (so'm) — синган/йўқолганда айбдордан ундириладиган сумма учун.
    // Ихтиёрий: реал нарх маълум бўлмагунча null, ёлғон рақам йўқ.
    price: integer("price"),
    active: boolean("active").notNull().default(true),
    branchId: uuid("branch_id").references(() => branches.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.category, t.name)],
);

export const assetMovements = pgTable("asset_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => assets.id, { onDelete: "cascade" }),
  qty: integer("qty").notNull(),
  reason: assetMovementReason("reason").notNull(),
  note: text("note"),
  // Дона нархининг shu воқеа пайтидаги snapshot'и (assets.price кейин ўзгарса
  // ҳам, эски зарар суммаси ўзгармасин учун).
  unitPrice: integer("unit_price"),
  // sindi/yoqoldi'да айбдор ходим — тизимга кирган director/manager'дан фарқли
  // (createdById), чунки одатда официант/кассир синдиради, лекин ёзувни улар
  // эмас, director/manager киритади.
  responsibleId: uuid("responsible_id").references(() => users.id),
  createdById: uuid("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// M3 витрина/сих: хом гўшт → N сих партияси (norm_g = рецептдаги 1 сих гўшти,
// null = номаълум). Витрина баланси шу партиялардан ҳисобланади.
export const skewerBatches = pgTable(
  "skewer_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    meatG: integer("meat_g").notNull(),
    skewerCount: integer("skewer_count").notNull(),
    normG: integer("norm_g"),
    note: text("note"),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sb_created_idx").on(t.createdAt)],
);

// Витрина кунлик санаш (кунига битта таом учун upsert). Реконсиляция:
// кутилган = кечаги саналган + бугун сихланган − сотилган.
export const vitrinaCounts = pgTable(
  "vitrina_counts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dayKey: text("day_key").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    countedQty: integer("counted_qty").notNull(),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.dayKey, t.productId)],
);
