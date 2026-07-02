import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
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

export const obvalka = pgTable("obvalka", {
  id: uuid("id").primaryKey().defaultRandom(),
  carcassType: carcassType("carcass_type").notNull(),
  weightG: integer("weight_g").notNull(),
  pricePerKg: integer("price_per_kg").notNull().default(0),
  supplier: text("supplier"),
  note: text("note"),
  branchId: uuid("branch_id").references(() => branches.id),
  createdById: uuid("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
  active: boolean("active").notNull().default(true),
});

export const orderStatus = pgEnum("order_status", ["open", "closed", "cancelled"]);

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
    guests: integer("guests"),
    note: text("note"),
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

export const paymentMethod = pgEnum("payment_method", [
  "cash",
  "card",
  "click",
  "payme",
  "debt",
]);

export const orderPayments = pgTable("order_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  method: paymentMethod("method").notNull(),
  amount: integer("amount").notNull(),
});

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

export const expenseCategory = pgEnum("expense_category", [
  "ijara", // аренда
  "gaz", // газ
  "elektr", // свет/электр
  "ish_haqi", // ойлик (зарплата)
  "jihoz", // жиҳоз/техника
  "boshqa", // прочее
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
