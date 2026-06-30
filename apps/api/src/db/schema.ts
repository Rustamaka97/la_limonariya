import {
  boolean,
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
