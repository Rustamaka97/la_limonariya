import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
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
