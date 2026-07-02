import { and, count, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import {
  checkLoginRateLimit,
  clearLoginAttempts,
  hashPin,
  hashToken,
  newSessionToken,
  pinLookup,
  recordFailedLogin,
  verifyPin,
} from "./auth";
import { SESSION_COOKIE } from "./context";
import { db } from "./db/client";
import {
  assetMovements,
  assets,
  categories,
  debtPayments,
  expenses,
  halls,
  inventoryCounts,
  inventoryItems,
  kitchenTicketItems,
  kitchenTickets,
  obvalka,
  obvalkaParts,
  orderItems,
  orderPayments,
  orders,
  partTypes,
  products,
  purchaseItems,
  purchases,
  recipeItems,
  recipes,
  sessions,
  stations,
  stockMovements,
  tillCounts,
  users,
} from "./db/schema";
import { computeObvalka } from "./obvalka-calc";
import { businessDayBounds, businessRangeBounds, previousDayKey } from "./time";
import { TRPCError } from "@trpc/server";
import {
  directorProcedure,
  managerProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "./trpc";

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const pinSchema = z.string().regex(/^\d{4}$/, "PIN — 4 ta raqam");

// Real per-kg meat cost = cost of the latest recorded carcass of this type.
async function latestMeatCost(ct: "qoy" | "mol"): Promise<number | null> {
  const head = (
    await db
      .select()
      .from(obvalka)
      .where(eq(obvalka.carcassType, ct))
      .orderBy(desc(obvalka.createdAt))
      .limit(1)
  )[0];
  if (!head) return null;
  const parts = await db
    .select({
      name: obvalkaParts.name,
      weightG: obvalkaParts.weightG,
      isWaste: partTypes.isWaste,
      normMinPct: partTypes.normMinPct,
      normMaxPct: partTypes.normMaxPct,
    })
    .from(obvalkaParts)
    .leftJoin(partTypes, eq(obvalkaParts.partTypeId, partTypes.id))
    .where(eq(obvalkaParts.obvalkaId, head.id));
  const c = computeObvalka(
    head.weightG,
    head.pricePerKg,
    parts.map((p) => ({
      name: p.name,
      weightG: p.weightG,
      isWaste: p.isWaste ?? false,
      normMinPct: p.normMinPct,
      normMaxPct: p.normMaxPct,
    })),
  );
  return c.costPerKg || null;
}

// Per-dish meat cost: Σ (meat-ingredient grams × current per-kg meat cost).
// Meat is detected from recipe item stock_hint; carcass from мол/қўй in hint/category.
async function computeDishTaannarx(meatCost: {
  qoy: number | null;
  mol: number | null;
}) {
  const recs = await db
    .select({
      id: recipes.id,
      productId: recipes.productId,
      name: recipes.name,
      kind: recipes.kind,
      category: recipes.category,
      salePrice: products.price,
    })
    .from(recipes)
    .leftJoin(products, eq(recipes.productId, products.id))
    .orderBy(recipes.kind, recipes.name);

  const items = await db
    .select({
      recipeId: recipeItems.recipeId,
      qtyG: recipeItems.qtyG,
      stockHint: recipeItems.stockHint,
    })
    .from(recipeItems);
  const byRecipe = new Map<
    string,
    { qtyG: number | null; stockHint: string | null }[]
  >();
  for (const it of items) {
    const a = byRecipe.get(it.recipeId) ?? [];
    a.push(it);
    byRecipe.set(it.recipeId, a);
  }

  const carcassOf = (
    hint: string | null,
    category: string | null,
  ): "qoy" | "mol" | null => {
    if (!/обвалка|лаҳм|гўшт|гушт/i.test(`${hint ?? ""}`)) return null;
    const s = `${hint ?? ""} ${category ?? ""}`;
    if (/мол/i.test(s)) return "mol";
    if (/қўй|қуй|куй/i.test(s)) return "qoy";
    return null;
  };

  return recs.map((r) => {
    let meatCostTotal = 0;
    let meatG = 0;
    let hasUnpricedMeat = false; // meat ingredient present but its carcass has no obvalka cost yet
    for (const it of byRecipe.get(r.id) ?? []) {
      const c = carcassOf(it.stockHint, r.category);
      const cost = c ? meatCost[c] : null;
      if (c && cost && it.qtyG) {
        meatCostTotal += (it.qtyG / 1000) * cost;
        meatG += it.qtyG;
      } else if (c && !cost) {
        hasUnpricedMeat = true;
      }
    }
    meatCostTotal = Math.round(meatCostTotal);
    const salePrice = r.salePrice ?? 0;
    return {
      id: r.id,
      productId: r.productId,
      name: r.name,
      kind: r.kind,
      salePrice,
      meatCostTotal,
      meatG,
      meatPct:
        salePrice > 0 ? Math.round((meatCostTotal / salePrice) * 100) : null,
      hasUnpricedMeat,
    };
  });
}

// CRITICAL: products.costPrice is per-DISPLAY-unit (per-kg / per-dona / per-l),
// set in purchase.create as price/qty. baseAbs is in base units (g for kg/g,
// ml for l/ml, dona). Carcass meat (Мол/Қўй лаҳм) has NULL costPrice — value via
// per-kg carcass cost instead. Returns null when cost is unknown.
function valuePortion(
  baseAbs: number,
  unit: string,
  costPrice: number | null,
  carcassPerKg: number | null,
): number | null {
  if (carcassPerKg != null) return Math.round((baseAbs / 1000) * carcassPerKg);
  if (costPrice == null) return null;
  const div = unit === "kg" || unit === "l" ? 1000 : 1;
  return Math.round((baseAbs / div) * costPrice);
}

// COGS for a window = Σ valued sale_writeoff movements. Partial by design:
// списание skips soldByWeight/no-recipe/unmapped items, and some products lack
// a costPrice → reported as unpriced so the UI can flag "COGS qisman".
async function cogsForWindow(start: Date, end: Date) {
  const meat = {
    qoy: await latestMeatCost("qoy"),
    mol: await latestMeatCost("mol"),
  };
  const rows = await db
    .select({
      qty: stockMovements.qty,
      name: products.name,
      unit: products.unit,
      costPrice: products.costPrice,
    })
    .from(stockMovements)
    .innerJoin(products, eq(stockMovements.productId, products.id))
    .where(
      and(
        eq(stockMovements.type, "sale_writeoff"),
        gte(stockMovements.createdAt, start),
        lt(stockMovements.createdAt, end),
      ),
    );
  let cogs = 0;
  let priced = 0;
  const unpriced = new Set<string>();
  for (const r of rows) {
    const carc =
      r.name === "Мол лаҳм" ? meat.mol : r.name === "Қўй лаҳм" ? meat.qoy : null;
    const v = valuePortion(Math.abs(r.qty), r.unit, r.costPrice, carc);
    if (v == null) {
      unpriced.add(r.name);
      continue;
    }
    cogs += v;
    priced++;
  }
  return {
    cogs,
    priced,
    unpricedCount: unpriced.size,
    unpricedNames: [...unpriced].slice(0, 10),
  };
}

// Shared revenue/COGS/OPEX aggregation over a UTC window — used by dayClose + pnl.
const TILL_FLOAT = 50_000; // owner-confirmed start-of-shift register float

async function expectedCashForWindow(start: Date, end: Date) {
  const cashRevenue = Number(
    (
      await db
        .select({ s: sql<number>`coalesce(sum(${orderPayments.amount}), 0)` })
        .from(orderPayments)
        .innerJoin(orders, eq(orderPayments.orderId, orders.id))
        .where(
          and(
            eq(orderPayments.method, "cash"),
            eq(orders.status, "closed"),
            gte(orders.closedAt, start),
            lt(orders.closedAt, end),
          ),
        )
    )[0]?.s ?? 0,
  );
  const cashDebtRepaid = Number(
    (
      await db
        .select({ s: sql<number>`coalesce(sum(${debtPayments.amount}), 0)` })
        .from(debtPayments)
        .where(
          and(
            eq(debtPayments.method, "cash"),
            gte(debtPayments.createdAt, start),
            lt(debtPayments.createdAt, end),
          ),
        )
    )[0]?.s ?? 0,
  );
  const cashExpenses = Number(
    (
      await db
        .select({ s: sql<number>`coalesce(sum(${expenses.amount}), 0)` })
        .from(expenses)
        .where(
          and(
            eq(expenses.method, "cash"),
            gte(expenses.spentAt, start),
            lt(expenses.spentAt, end),
          ),
        )
    )[0]?.s ?? 0,
  );
  const expectedCash = TILL_FLOAT + cashRevenue + cashDebtRepaid - cashExpenses;
  return { cashRevenue, cashDebtRepaid, cashExpenses, expectedCash };
}

// Lightweight revenue-only aggregation (no COGS) for trend/report views where
// looping cogsForWindow per day would be wasteful — distinct from financeForWindow.
async function revenueForWindow(start: Date, end: Date) {
  const payRows = await db
    .select({ method: orderPayments.method, amount: orderPayments.amount })
    .from(orderPayments)
    .innerJoin(orders, eq(orderPayments.orderId, orders.id))
    .where(
      and(eq(orders.status, "closed"), gte(orders.closedAt, start), lt(orders.closedAt, end)),
    );
  let revenue = 0;
  const byMethod: Record<string, number> = {};
  for (const p of payRows) {
    byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
    if (p.method !== "debt") revenue += p.amount;
  }
  const checks = Number(
    (
      await db
        .select({ n: count() })
        .from(orders)
        .where(
          and(
            eq(orders.status, "closed"),
            eq(orders.isComp, false),
            gte(orders.closedAt, start),
            lt(orders.closedAt, end),
          ),
        )
    )[0]?.n ?? 0,
  );
  return { revenue, byMethod, checks, avgCheck: checks ? Math.round(revenue / checks) : 0 };
}

// Orders (closed, in window) that carry a debt payment — used to keep item-level
// revenue consistent with the rest of the app's "debt is not realized revenue"
// convention. Qty (food actually served) still counts; revenue doesn't.
// Orders that don't count as revenue: debt-financed (cash not yet received)
// and текин/ходим comp orders (intentionally zero revenue). Qty/stock still
// count for both — only money is excluded.
async function nonRevenueOrderIds(start: Date, end: Date): Promise<Set<string>> {
  const debtRows = await db
    .select({ orderId: orderPayments.orderId })
    .from(orderPayments)
    .innerJoin(orders, eq(orderPayments.orderId, orders.id))
    .where(
      and(
        eq(orderPayments.method, "debt"),
        eq(orders.status, "closed"),
        gte(orders.closedAt, start),
        lt(orders.closedAt, end),
      ),
    );
  const compRows = await db
    .select({ orderId: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.isComp, true),
        eq(orders.status, "closed"),
        gte(orders.closedAt, start),
        lt(orders.closedAt, end),
      ),
    );
  return new Set([...debtRows.map((r) => r.orderId), ...compRows.map((r) => r.orderId)]);
}

async function debtTotals() {
  const supplierTotal = Number(
    (
      await db
        .select({
          s: sql<number>`coalesce(sum(${purchases.total} - ${purchases.paidTotal}), 0)`,
        })
        .from(purchases)
        .where(sql`${purchases.paidTotal} < ${purchases.total}`)
    )[0]?.s ?? 0,
  );
  const debtAmounts = await db
    .select({ orderId: orderPayments.orderId, amount: orderPayments.amount })
    .from(orderPayments)
    .where(eq(orderPayments.method, "debt"));
  const paidRows = await db
    .select({ orderId: debtPayments.orderId, paid: sql<number>`sum(${debtPayments.amount})` })
    .from(debtPayments)
    .groupBy(debtPayments.orderId);
  const paidMap = new Map(paidRows.map((r) => [r.orderId, Number(r.paid)]));
  const guestTotal = debtAmounts.reduce(
    (s, r) => s + Math.max(0, r.amount - (paidMap.get(r.orderId) ?? 0)),
    0,
  );
  return { supplierTotal, guestTotal };
}

// Stockable products (what a physical count covers) — LEFT JOIN so zero-movement
// products still appear with onHand=0 (stock.onHand's INNER JOIN would omit them).
async function stockableOnHand(exec: { select: typeof db.select } = db) {
  const rows = await exec
    .select({
      id: products.id,
      name: products.name,
      type: products.type,
      unit: products.unit,
      costPrice: products.costPrice,
      onHand: sql<number>`coalesce(sum(${stockMovements.qty}), 0)`,
    })
    .from(products)
    .leftJoin(stockMovements, eq(stockMovements.productId, products.id))
    .where(
      and(eq(products.active, true), inArray(products.type, ["ingredient", "part", "goods"])),
    )
    .groupBy(products.id, products.name, products.type, products.unit, products.costPrice)
    .orderBy(products.type, products.name);
  return rows.map((r) => ({ ...r, onHand: Number(r.onHand) }));
}

// Owner-confirmed storages — must match apps/web/src/Inventarizatsiya.tsx STORAGES.
const STORAGES = ["Ошхона музлаткич", "Катта музлаткич"] as const;

// Owner-stated constants (phase-1: hardcoded, not a sliding median — see delivery plan).
const BREAK_EVEN_HINT = 8_900_000;
const BLENDED_COGS_PCT = 0.526;
const THIN_MARGIN_PCT = 60;
const MEAT_PRICE_SPIKE_PCT = 1.15;
const COMP_DAILY_CAP = 500_000; // owner-stated daily текин/ходим volume limit

async function computeSignals() {
  const recentObv = await db
    .select()
    .from(obvalka)
    .orderBy(desc(obvalka.createdAt))
    .limit(20);
  const obvalkaFlags: {
    id: string;
    carcassType: string;
    weightG: number;
    createdAt: Date;
    lossPct: number;
    balanceFlag: boolean;
    anomalies: number;
  }[] = [];
  for (const o of recentObv) {
    const parts = await db
      .select({
        name: obvalkaParts.name,
        weightG: obvalkaParts.weightG,
        isWaste: partTypes.isWaste,
        normMinPct: partTypes.normMinPct,
        normMaxPct: partTypes.normMaxPct,
      })
      .from(obvalkaParts)
      .leftJoin(partTypes, eq(obvalkaParts.partTypeId, partTypes.id))
      .where(eq(obvalkaParts.obvalkaId, o.id));
    const c = computeObvalka(
      o.weightG,
      o.pricePerKg,
      parts.map((p) => ({
        name: p.name,
        weightG: p.weightG,
        isWaste: p.isWaste ?? false,
        normMinPct: p.normMinPct,
        normMaxPct: p.normMaxPct,
      })),
    );
    const anomalies = c.items.filter((i) => i.outOfNorm).length;
    if (c.balanceFlag || anomalies > 0)
      obvalkaFlags.push({
        id: o.id,
        carcassType: o.carcassType,
        weightG: o.weightG,
        createdAt: o.createdAt,
        lossPct: c.lossPct,
        balanceFlag: c.balanceFlag,
        anomalies,
      });
  }

  const meatCost = { qoy: await latestMeatCost("qoy"), mol: await latestMeatCost("mol") };
  const dishes = await computeDishTaannarx(meatCost);
  const thinDishes = dishes
    .filter(
      (d) =>
        d.salePrice > 0 &&
        d.meatCostTotal > 0 &&
        d.meatPct != null &&
        d.meatPct >= THIN_MARGIN_PCT &&
        d.meatPct <= 100, // exclude batch/pot recipes (meatPct>100 = per-pot not per-portion)
    )
    .sort((a, b) => (b.meatPct ?? 0) - (a.meatPct ?? 0))
    .slice(0, 8);

  const { startUTC, endUTC, dayKey } = businessDayBounds();
  const { expectedCash } = await expectedCashForWindow(startUTC, endUTC);
  const tillRow = (
    await db.select().from(tillCounts).where(eq(tillCounts.dayKey, dayKey)).limit(1)
  )[0];
  const cashVariance = tillRow
    ? {
        dayKey,
        countedCash: tillRow.countedCash,
        expectedCash,
        variance: tillRow.countedCash - expectedCash,
      }
    : null;

  // yesterday = a CLOSED, complete business day — fair break-even comparison
  // (today's still-accumulating revenue would always look "below" mid-shift).
  const yKey = previousDayKey(dayKey);
  const yBounds = businessDayBounds(yKey);
  const yFin = await financeForWindow(yBounds.startUTC, yBounds.endUTC);
  const breakEvenFlag = yFin.checks > 0 && yFin.revenue < BREAK_EVEN_HINT;

  const priceSpikes: {
    carcassType: "qoy" | "mol";
    latestPrice: number;
    medianPrice: number;
    pct: number;
  }[] = [];
  for (const ct of ["qoy", "mol"] as const) {
    const rows = await db
      .select({ pricePerKg: obvalka.pricePerKg })
      .from(obvalka)
      .where(eq(obvalka.carcassType, ct))
      .orderBy(desc(obvalka.createdAt))
      .limit(11);
    if (rows.length >= 4) {
      const [latest, ...rest] = rows;
      const sorted = rest.map((r) => r.pricePerKg).sort((a, b) => a - b);
      const mid = sorted.length / 2;
      const median = Number.isInteger(mid)
        ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
        : (sorted[Math.floor(mid)] ?? 0);
      if (latest != null && median > 0 && latest.pricePerKg > median * MEAT_PRICE_SPIKE_PCT)
        priceSpikes.push({
          carcassType: ct,
          latestPrice: latest.pricePerKg,
          medianPrice: median,
          pct: Math.round((latest.pricePerKg / median - 1) * 100),
        });
    }
  }

  const recentApproved = await db
    .select({ id: inventoryCounts.id })
    .from(inventoryCounts)
    .where(eq(inventoryCounts.status, "approved"))
    .orderBy(desc(inventoryCounts.approvedAt))
    .limit(5);
  let shortagePattern: { productId: string; name: string; count: number }[] = [];
  const historyPending = recentApproved.length < 2;
  if (recentApproved.length) {
    const ids = recentApproved.map((r) => r.id);
    const negRows = await db
      .select({
        productId: stockMovements.productId,
        name: products.name,
        refId: stockMovements.refId,
      })
      .from(stockMovements)
      .innerJoin(products, eq(stockMovements.productId, products.id))
      .where(
        and(
          eq(stockMovements.type, "inventory_adjust"),
          inArray(stockMovements.refId, ids),
          sql`${stockMovements.qty} < 0`,
        ),
      );
    const byProduct = new Map<string, { name: string; counts: Set<string> }>();
    for (const r of negRows) {
      if (!r.refId) continue;
      const e = byProduct.get(r.productId) ?? { name: r.name, counts: new Set<string>() };
      e.counts.add(r.refId);
      byProduct.set(r.productId, e);
    }
    shortagePattern = [...byProduct.entries()]
      .filter(([, v]) => v.counts.size >= 2)
      .map(([productId, v]) => ({ productId, name: v.name, count: v.counts.size }));
  }

  // текин/ходим daily volume — valued at menu price (the foregone revenue), not cost
  const compRows = await db
    .select({
      qty: orderItems.qty,
      price: orderItems.price,
      reason: orders.compReason,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(
      and(
        eq(orders.isComp, true),
        eq(orders.status, "closed"),
        gte(orders.closedAt, startUTC),
        lt(orders.closedAt, endUTC),
      ),
    );
  const compToday = compRows.reduce((s, r) => s + r.qty * r.price, 0);
  const compFlag = compToday > COMP_DAILY_CAP;

  return {
    obvalkaFlags,
    thinDishes,
    cashVariance,
    breakEvenFlag,
    yesterdayRevenue: yFin.revenue,
    priceSpikes,
    shortagePattern,
    historyPending,
    compToday,
    compFlag,
  };
}

async function financeForWindow(start: Date, end: Date) {
  const payRows = await db
    .select({ method: orderPayments.method, amount: orderPayments.amount })
    .from(orderPayments)
    .innerJoin(orders, eq(orderPayments.orderId, orders.id))
    .where(
      and(
        eq(orders.status, "closed"),
        gte(orders.closedAt, start),
        lt(orders.closedAt, end),
      ),
    );
  const byMethod: Record<string, number> = {};
  let revenue = 0;
  for (const p of payRows) {
    byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
    // debt = receivable (cash not received) — kept as guestDebt, NOT realized revenue
    if (p.method !== "debt") revenue += p.amount;
  }
  const electronic =
    (byMethod.card ?? 0) +
    (byMethod.click ?? 0) +
    (byMethod.payme ?? 0) +
    (byMethod.humo ?? 0);
  const cardTax = Math.round((electronic * 4) / 100);
  const guestDebt = byMethod.debt ?? 0;

  const checks = Number(
    (
      await db
        .select({ n: count() })
        .from(orders)
        .where(
          and(
            eq(orders.status, "closed"),
            eq(orders.isComp, false),
            gte(orders.closedAt, start),
            lt(orders.closedAt, end),
          ),
        )
    )[0]?.n ?? 0,
  );

  const cogsRes = await cogsForWindow(start, end);

  const expRows = await db
    .select({ category: expenses.category, amount: expenses.amount })
    .from(expenses)
    .where(and(gte(expenses.spentAt, start), lt(expenses.spentAt, end)));
  // ega_oldi (owner draw) is a distribution, NOT an operating expense — it must
  // NOT reduce sofFoyda, otherwise "real profit" silently shrinks every time the
  // owner takes cash out. Kept in opexByCat (for visibility) but excluded from opex.
  let opex = 0;
  let ownerDraw = 0;
  const opexByCat: Record<string, number> = {};
  for (const e of expRows) {
    if (e.category === "ega_oldi") ownerDraw += e.amount;
    else opex += e.amount;
    opexByCat[e.category] = (opexByCat[e.category] ?? 0) + e.amount;
  }

  const sofFoyda = revenue - cogsRes.cogs - opex - cardTax;
  return {
    revenue,
    byMethod,
    cardTax,
    guestDebt,
    checks,
    avgCheck: checks ? Math.round(revenue / checks) : 0,
    cogs: cogsRes.cogs,
    // partial = some movements unpriced OR there's revenue but списание produced
    // no COGS at all (salads/drinks/by-weight items never write sale_writeoff)
    cogsPartial:
      cogsRes.unpricedCount > 0 || (revenue > 0 && cogsRes.cogs === 0),
    unpricedCount: cogsRes.unpricedCount,
    unpricedNames: cogsRes.unpricedNames,
    opex,
    opexByCat,
    ownerDraw,
    sofFoyda,
  };
}

// "Тикетсиз таом ЙЎҚ": tickets the UNSENT remainder of an order's items to the
// kitchen — sent-so-far is derived from kitchen_ticket_items (ledger, never
// stored as a mutable counter). Returns null if nothing new to send. MUST be
// called inside the caller's transaction (tx) for correctness.
// Computes the per-product UNSENT remainder for an order. "Sent so far" only
// counts tickets created SINCE this product's current order_items row
// appeared — if the waiter zeroed it out (row deleted) and re-added it, that's
// a NEW row with a fresh createdAt, so old ticket history for the deleted row
// no longer masks the re-add as "already sent" (the codebase's append-only
// ledger philosophy, made createdAt-scoped instead of all-time-cumulative).
async function computeUnsentItems(
  exec: { select: typeof db.select },
  orderId: string,
) {
  const items = await exec
    .select({
      productId: orderItems.productId,
      name: orderItems.name,
      qty: orderItems.qty,
      createdAt: orderItems.createdAt,
      station: stations.name,
    })
    .from(orderItems)
    .leftJoin(products, eq(orderItems.productId, products.id))
    .leftJoin(stations, eq(products.stationId, stations.id))
    .where(eq(orderItems.orderId, orderId));

  // group by productId (defense: addItem upserts by orderId+productId so
  // duplicates shouldn't occur, but don't let it corrupt the math if they do).
  // Keep the EARLIEST createdAt per product — conservative, avoids masking.
  const grouped = new Map<
    string,
    { name: string; qty: number; createdAt: Date; station: string | null }
  >();
  for (const it of items) {
    if (!it.productId) continue;
    const g = grouped.get(it.productId);
    if (g) {
      g.qty += it.qty;
      if (it.createdAt < g.createdAt) g.createdAt = it.createdAt;
    } else {
      grouped.set(it.productId, {
        name: it.name,
        qty: it.qty,
        createdAt: it.createdAt,
        station: it.station,
      });
    }
  }

  const toSend: { productId: string; name: string; unsent: number; station: string | null }[] = [];
  for (const [productId, g] of grouped) {
    const sentRow = (
      await exec
        .select({ s: sql<number>`coalesce(sum(${kitchenTicketItems.qty}), 0)` })
        .from(kitchenTicketItems)
        .innerJoin(kitchenTickets, eq(kitchenTicketItems.ticketId, kitchenTickets.id))
        .where(
          and(
            eq(kitchenTickets.orderId, orderId),
            eq(kitchenTicketItems.productId, productId),
            gte(kitchenTickets.createdAt, g.createdAt),
          ),
        )
    )[0];
    const unsent = g.qty - Number(sentRow?.s ?? 0);
    if (unsent > 0) toSend.push({ productId, name: g.name, unsent, station: g.station });
  }
  return toSend;
}

async function flushKitchenTicket(
  tx: { select: typeof db.select; insert: typeof db.insert; execute: typeof db.execute },
  orderId: string,
  createdById: string,
) {
  // advisory lock keyed on orderId — serializes concurrent sendToKitchen calls
  // (and sendToKitchen racing pos.close's auto-flush) so they can't both read
  // the same "sent so far" snapshot and double-ticket the same items.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orderId}))`);

  const toSend = await computeUnsentItems(tx, orderId);
  if (toSend.length === 0) return null;

  const ticket = (
    await tx.insert(kitchenTickets).values({ orderId, createdById }).returning({
      id: kitchenTickets.id,
      createdAt: kitchenTickets.createdAt,
    })
  )[0];
  if (!ticket) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

  await tx.insert(kitchenTicketItems).values(
    toSend.map((it) => ({
      ticketId: ticket.id,
      productId: it.productId,
      name: it.name,
      qty: it.unsent,
      station: it.station ?? "Бошқа",
    })),
  );

  return {
    id: ticket.id,
    createdAt: ticket.createdAt,
    items: toSend.map((it) => ({ name: it.name, qty: it.unsent, station: it.station ?? "Бошқа" })),
  };
}

export const appRouter = router({
  health: publicProcedure.query(async () => {
    await db.execute(sql`select 1`);
    return { ok: true, ts: new Date().toISOString() };
  }),

  auth: router({
    login: publicProcedure
      .input(z.object({ pin: pinSchema }))
      .mutation(async ({ input, ctx }) => {
        const ip =
          ctx.c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

        const rl = checkLoginRateLimit(ip);
        if (rl.blocked) {
          const min = Math.ceil(rl.retryAfterMs / 60000);
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `Жуда кўп хато уриниш. ${min} дақиқадан сўнг қайта уринг.`,
          });
        }

        const u = (
          await db
            .select()
            .from(users)
            .where(
              and(eq(users.pinLookup, pinLookup(input.pin)), eq(users.active, true)),
            )
            .limit(1)
        )[0];

        if (!u || !u.pinHash || !verifyPin(input.pin, u.pinHash)) {
          recordFailedLogin(ip);
          throw new TRPCError({ code: "UNAUTHORIZED", message: "PIN noto'g'ri" });
        }
        clearLoginAttempts(ip);

        const { token, tokenHash } = newSessionToken();
        const expiresAt = new Date(Date.now() + SESSION_MS);
        await db.insert(sessions).values({ userId: u.id, tokenHash, expiresAt });
        setCookie(ctx.c, SESSION_COOKIE, token, {
          httpOnly: true,
          sameSite: "Lax",
          path: "/",
          expires: expiresAt,
        });

        return { id: u.id, name: u.name, role: u.role };
      }),

    me: publicProcedure.query(({ ctx }) => ctx.user),

    logout: publicProcedure.mutation(async ({ ctx }) => {
      const token = getCookie(ctx.c, SESSION_COOKIE);
      if (token) {
        await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
        deleteCookie(ctx.c, SESSION_COOKIE, { path: "/" });
      }
      return { ok: true };
    }),
  }),

  users: router({
    list: protectedProcedure.query(async () => {
      return db
        .select({
          id: users.id,
          name: users.name,
          role: users.role,
          active: users.active,
          hasPin: sql<boolean>`${users.pinHash} is not null`,
        })
        .from(users)
        .orderBy(users.role, users.name);
    }),

    setPin: directorProcedure
      .input(z.object({ userId: z.string().uuid(), pin: pinSchema }))
      .mutation(async ({ input }) => {
        try {
          await db
            .update(users)
            .set({ pinHash: hashPin(input.pin), pinLookup: pinLookup(input.pin) })
            .where(eq(users.id, input.userId));
        } catch (e) {
          if (e && typeof e === "object" && "code" in e && e.code === "23505") {
            throw new TRPCError({ code: "CONFLICT", message: "Бу PIN банд" });
          }
          throw e;
        }
        return { ok: true };
      }),
  }),

  catalog: router({
    categories: router({
      list: protectedProcedure
        .input(z.object({ includeInactive: z.boolean().optional() }).optional())
        .query(async ({ input, ctx }) => {
          const showInactive = input?.includeInactive && ctx.user.role === "director";
          return db
            .select({
              id: categories.id,
              name: categories.name,
              position: categories.position,
              active: categories.active,
            })
            .from(categories)
            .where(showInactive ? undefined : eq(categories.active, true))
            .orderBy(categories.position, categories.name);
        }),

      create: directorProcedure
        .input(z.object({ name: z.string().min(1), position: z.number().int().optional() }))
        .mutation(async ({ input }) => {
          const row = (
            await db
              .insert(categories)
              .values({ name: input.name, position: input.position ?? 0 })
              .returning({ id: categories.id })
          )[0];
          return { id: row?.id };
        }),

      update: directorProcedure
        .input(
          z.object({
            id: z.string().uuid(),
            name: z.string().min(1).optional(),
            position: z.number().int().optional(),
            active: z.boolean().optional(),
          }),
        )
        .mutation(async ({ input }) => {
          const { id, ...patch } = input;
          if (Object.keys(patch).length === 0) return { ok: true };
          await db.update(categories).set(patch).where(eq(categories.id, id));
          return { ok: true };
        }),
    }),

    products: router({
      list: protectedProcedure
        .input(
          z
            .object({
              categoryId: z.string().uuid().optional(),
              includeInactive: z.boolean().optional(),
            })
            .optional(),
        )
        .query(async ({ input, ctx }) => {
          const showInactive = input?.includeInactive && ctx.user.role === "director";
          return db
            .select({
              id: products.id,
              name: products.name,
              type: products.type,
              unit: products.unit,
              price: products.price,
              costPrice: products.costPrice,
              soldByWeight: products.soldByWeight,
              active: products.active,
              categoryId: products.categoryId,
              stationId: products.stationId,
              category: categories.name,
              station: stations.name,
            })
            .from(products)
            .leftJoin(categories, eq(products.categoryId, categories.id))
            .leftJoin(stations, eq(products.stationId, stations.id))
            .where(
              and(
                showInactive ? undefined : eq(products.active, true),
                input?.categoryId ? eq(products.categoryId, input.categoryId) : undefined,
              ),
            )
            .orderBy(products.type, products.name);
        }),

      create: directorProcedure
        .input(
          z.object({
            name: z.string().min(1),
            type: z.enum(["ingredient", "part", "semi", "dish", "goods"]),
            unit: z.enum(["dona", "kg", "g", "l", "ml"]),
            price: z.number().int().nonnegative().optional(),
            categoryId: z.string().uuid().optional(),
            stationId: z.string().uuid().optional(),
            soldByWeight: z.boolean().optional(),
          }),
        )
        .mutation(async ({ input }) => {
          const row = (
            await db
              .insert(products)
              .values({
                name: input.name,
                type: input.type,
                unit: input.unit,
                price: input.price ?? 0,
                categoryId: input.categoryId ?? null,
                stationId: input.stationId ?? null,
                soldByWeight: input.soldByWeight ?? false,
              })
              .returning({ id: products.id })
          )[0];
          return { id: row?.id };
        }),

      update: directorProcedure
        .input(
          z.object({
            id: z.string().uuid(),
            name: z.string().min(1).optional(),
            type: z.enum(["ingredient", "part", "semi", "dish", "goods"]).optional(),
            unit: z.enum(["dona", "kg", "g", "l", "ml"]).optional(),
            price: z.number().int().nonnegative().optional(),
            categoryId: z.string().uuid().nullable().optional(),
            stationId: z.string().uuid().nullable().optional(),
            soldByWeight: z.boolean().optional(),
            active: z.boolean().optional(),
          }),
        )
        .mutation(async ({ input }) => {
          const { id, ...patch } = input;
          if (Object.keys(patch).length === 0) return { ok: true };
          await db.update(products).set(patch).where(eq(products.id, id));
          return { ok: true };
        }),
    }),

    stations: protectedProcedure.query(async () => {
      return db
        .select({ id: stations.id, name: stations.name })
        .from(stations)
        .orderBy(stations.name);
    }),

    recipes: protectedProcedure.query(async () => {
      return db
        .select({
          id: recipes.id,
          name: recipes.name,
          kind: recipes.kind,
          category: recipes.category,
          yieldG: recipes.yieldG,
          linked: sql<boolean>`${recipes.productId} is not null`,
        })
        .from(recipes)
        .orderBy(recipes.kind, recipes.name);
    }),

    recipe: protectedProcedure
      .input(z.object({ recipeId: z.string().uuid() }))
      .query(async ({ input }) => {
        return db
          .select({
            componentName: recipeItems.componentName,
            qtyG: recipeItems.qtyG,
            stockHint: recipeItems.stockHint,
            product: products.name,
          })
          .from(recipeItems)
          .leftJoin(products, eq(recipeItems.componentId, products.id))
          .where(eq(recipeItems.recipeId, input.recipeId))
          .orderBy(recipeItems.sort);
      }),
  }),

  obvalka: router({
    partTypes: protectedProcedure
      .input(z.object({ carcassType: z.enum(["qoy", "mol", "tovuq"]) }))
      .query(async ({ input }) => {
        return db
          .select({
            id: partTypes.id,
            name: partTypes.name,
            normMinPct: partTypes.normMinPct,
            normMaxPct: partTypes.normMaxPct,
            isWaste: partTypes.isWaste,
          })
          .from(partTypes)
          .where(eq(partTypes.carcassType, input.carcassType))
          .orderBy(partTypes.sort);
      }),

    list: protectedProcedure.query(async () => {
      return db
        .select({
          id: obvalka.id,
          carcassType: obvalka.carcassType,
          weightG: obvalka.weightG,
          pricePerKg: obvalka.pricePerKg,
          supplier: obvalka.supplier,
          createdAt: obvalka.createdAt,
        })
        .from(obvalka)
        .orderBy(desc(obvalka.createdAt))
        .limit(50);
    }),

    get: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ input }) => {
        const head = (
          await db.select().from(obvalka).where(eq(obvalka.id, input.id)).limit(1)
        )[0];
        if (!head) throw new TRPCError({ code: "NOT_FOUND" });
        const parts = await db
          .select({
            name: obvalkaParts.name,
            weightG: obvalkaParts.weightG,
            isWaste: partTypes.isWaste,
            normMinPct: partTypes.normMinPct,
            normMaxPct: partTypes.normMaxPct,
          })
          .from(obvalkaParts)
          .leftJoin(partTypes, eq(obvalkaParts.partTypeId, partTypes.id))
          .where(eq(obvalkaParts.obvalkaId, input.id));
        const computed = computeObvalka(
          head.weightG,
          head.pricePerKg,
          parts.map((p) => ({
            name: p.name,
            weightG: p.weightG,
            isWaste: p.isWaste ?? false,
            normMinPct: p.normMinPct,
            normMaxPct: p.normMaxPct,
          })),
        );
        return {
          id: head.id,
          carcassType: head.carcassType,
          weightG: head.weightG,
          pricePerKg: head.pricePerKg,
          supplier: head.supplier,
          createdAt: head.createdAt,
          ...computed,
        };
      }),

    create: protectedProcedure
      .input(
        z.object({
          carcassType: z.enum(["qoy", "mol", "tovuq"]),
          weightG: z.number().int().positive(),
          pricePerKg: z.number().int().nonnegative(),
          supplier: z.string().optional(),
          note: z.string().optional(),
          parts: z
            .array(
              z.object({
                partTypeId: z.string().uuid(),
                weightG: z.number().int().nonnegative(),
              }),
            )
            .min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        return db.transaction(async (tx) => {
          const row = (
            await tx
              .insert(obvalka)
              .values({
                carcassType: input.carcassType,
                weightG: input.weightG,
                pricePerKg: input.pricePerKg,
                supplier: input.supplier ?? null,
                note: input.note ?? null,
                createdById: ctx.user.id,
              })
              .returning()
          )[0];
          if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

          const ptList = await tx
            .select()
            .from(partTypes)
            .where(eq(partTypes.carcassType, input.carcassType));
          const ptMap = new Map(ptList.map((p) => [p.id, p]));
          const parts = input.parts.filter((p) => p.weightG > 0);
          if (parts.length)
            await tx.insert(obvalkaParts).values(
              parts.map((p) => ({
                obvalkaId: row.id,
                partTypeId: p.partTypeId,
                name: ptMap.get(p.partTypeId)?.name ?? "?",
                weightG: p.weightG,
              })),
            );

          // Carcass-level meat inflow = sum of sellable (non-waste) flesh.
          const sellableG = parts.reduce((s, p) => {
            const pt = ptMap.get(p.partTypeId);
            return pt && !pt.isWaste ? s + p.weightG : s;
          }, 0);
          const carcassName =
            input.carcassType === "mol"
              ? "Мол лаҳм"
              : input.carcassType === "qoy"
                ? "Қўй лаҳм"
                : "Товуқ гўшти";
          const cp = (
            await tx
              .select({ id: products.id })
              .from(products)
              .where(eq(products.name, carcassName))
              .orderBy(products.createdAt)
              .limit(1)
          )[0];
          if (cp && sellableG > 0)
            await tx.insert(stockMovements).values({
              productId: cp.id,
              type: "obvalka",
              qty: sellableG,
              unit: "g",
              refType: "obvalka",
              refId: row.id,
              createdById: ctx.user.id,
            });

          return { id: row.id };
        });
      }),
  }),

  // Идиш-товоқ/мебель/техника — food/COGS'дан алоҳида. Ҳозирги сон saqlanmaydi,
  // stock_movements каби ledger'dan SUM орқали ҳисобланади (drift bo'lmasligi uchun).
  assets: router({
    list: managerProcedure.query(async () => {
      return db
        .select({
          id: assets.id,
          category: assets.category,
          name: assets.name,
          note: assets.note,
          price: assets.price,
          qty: sql<number>`coalesce(sum(${assetMovements.qty}), 0)`.mapWith(Number),
        })
        .from(assets)
        .leftJoin(assetMovements, eq(assetMovements.assetId, assets.id))
        .where(eq(assets.active, true))
        .groupBy(assets.id)
        .orderBy(assets.category, assets.name);
    }),

    create: managerProcedure
      .input(
        z.object({
          category: z.enum(["idish", "mebel", "texnika", "boshqa"]),
          name: z.string().trim().min(1),
          note: z.string().optional(),
          price: z.number().int().nonnegative().optional(),
          initialQty: z.number().int().positive().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const row = (
          await db
            .insert(assets)
            .values({
              category: input.category,
              name: input.name,
              note: input.note ?? null,
              price: input.price ?? null,
            })
            .returning()
        )[0];
        if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        if (input.initialQty)
          await db.insert(assetMovements).values({
            assetId: row.id,
            qty: input.initialQty,
            reason: "kirim",
            createdById: ctx.user.id,
          });
        return { id: row.id };
      }),

    setPrice: managerProcedure
      .input(z.object({ assetId: z.string().uuid(), price: z.number().int().nonnegative() }))
      .mutation(async ({ input }) => {
        await db.update(assets).set({ price: input.price }).where(eq(assets.id, input.assetId));
        return { ok: true };
      }),

    adjust: managerProcedure
      .input(
        z.object({
          assetId: z.string().uuid(),
          qty: z.number().int().refine((n) => n !== 0),
          reason: z.enum(["kirim", "sindi", "yoqoldi", "tuzatish"]),
          note: z.string().optional(),
          responsibleId: z.string().uuid().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        // Зарар суммаси faqat sindi/yoqoldi'да, faqat narx maʼlum bo'lsa —
        // snapshot qilamiz (keyin narx o'zgarsa ham eski voqea o'zgarmasin).
        let unitPrice: number | null = null;
        if (input.reason === "sindi" || input.reason === "yoqoldi") {
          const a = (
            await db.select({ price: assets.price }).from(assets).where(eq(assets.id, input.assetId)).limit(1)
          )[0];
          unitPrice = a?.price ?? null;
        }
        await db.insert(assetMovements).values({
          assetId: input.assetId,
          qty: input.qty,
          reason: input.reason,
          note: input.note ?? null,
          responsibleId: input.responsibleId ?? null,
          unitPrice,
          createdById: ctx.user.id,
        });
        return { ok: true };
      }),

    history: managerProcedure
      .input(z.object({ assetId: z.string().uuid() }))
      .query(async ({ input }) => {
        const responsible = alias(users, "responsible");
        return db
          .select({
            id: assetMovements.id,
            qty: assetMovements.qty,
            reason: assetMovements.reason,
            note: assetMovements.note,
            unitPrice: assetMovements.unitPrice,
            createdAt: assetMovements.createdAt,
            createdByName: users.name,
            responsibleName: responsible.name,
          })
          .from(assetMovements)
          .leftJoin(users, eq(users.id, assetMovements.createdById))
          .leftJoin(responsible, eq(responsible.id, assetMovements.responsibleId))
          .where(eq(assetMovements.assetId, input.assetId))
          .orderBy(desc(assetMovements.createdAt));
      }),

    // "Официантга пул берадиган вақт" учун — ким қанча зарар қилгани,
    // faqat narxi maʼlum (unitPrice snapshot qilingan) voqealardan.
    damageByStaff: managerProcedure.query(async () => {
      const responsible = alias(users, "responsible");
      const rows = await db
        .select({
          responsibleId: assetMovements.responsibleId,
          responsibleName: responsible.name,
          totalSom: sql<number>`sum(abs(${assetMovements.qty}) * ${assetMovements.unitPrice})`.mapWith(Number),
          totalQty: sql<number>`sum(abs(${assetMovements.qty}))`.mapWith(Number),
        })
        .from(assetMovements)
        .innerJoin(responsible, eq(responsible.id, assetMovements.responsibleId))
        .where(
          and(
            inArray(assetMovements.reason, ["sindi", "yoqoldi"]),
            sql`${assetMovements.unitPrice} is not null`,
          ),
        )
        .groupBy(assetMovements.responsibleId, responsible.name)
        .orderBy(desc(sql`sum(abs(${assetMovements.qty}) * ${assetMovements.unitPrice})`));
      return rows;
    }),

    deactivate: managerProcedure
      .input(z.object({ assetId: z.string().uuid() }))
      .mutation(async ({ input }) => {
        await db.update(assets).set({ active: false }).where(eq(assets.id, input.assetId));
        return { ok: true };
      }),
  }),

  taannarx: router({
    list: directorProcedure.query(async () => {
      const meatCost = {
        qoy: await latestMeatCost("qoy"),
        mol: await latestMeatCost("mol"),
      };
      return { meatCost, dishes: await computeDishTaannarx(meatCost) };
    }),
  }),

  dashboard: router({
    summary: directorProcedure.query(async () => {
      const meatCost = {
        qoy: await latestMeatCost("qoy"),
        mol: await latestMeatCost("mol"),
      };

      const typeRows = await db
        .select({ type: products.type, n: count() })
        .from(products)
        .groupBy(products.type);
      const catalog: Record<string, number> = {};
      for (const r of typeRows) catalog[r.type] = Number(r.n);
      const recipeCount = Number(
        (await db.select({ n: count() }).from(recipes))[0]?.n ?? 0,
      );

      const recent = await db
        .select()
        .from(obvalka)
        .orderBy(desc(obvalka.createdAt))
        .limit(6);
      const recentObvalka = [];
      for (const o of recent) {
        const parts = await db
          .select({
            name: obvalkaParts.name,
            weightG: obvalkaParts.weightG,
            isWaste: partTypes.isWaste,
            normMinPct: partTypes.normMinPct,
            normMaxPct: partTypes.normMaxPct,
          })
          .from(obvalkaParts)
          .leftJoin(partTypes, eq(obvalkaParts.partTypeId, partTypes.id))
          .where(eq(obvalkaParts.obvalkaId, o.id));
        const c = computeObvalka(
          o.weightG,
          o.pricePerKg,
          parts.map((p) => ({
            name: p.name,
            weightG: p.weightG,
            isWaste: p.isWaste ?? false,
            normMinPct: p.normMinPct,
            normMaxPct: p.normMaxPct,
          })),
        );
        recentObvalka.push({
          id: o.id,
          carcassType: o.carcassType,
          weightG: o.weightG,
          supplier: o.supplier,
          createdAt: o.createdAt,
          lossPct: c.lossPct,
          balanceFlag: c.balanceFlag,
          costPerKg: c.costPerKg,
          anomalies: c.items.filter((i) => i.outOfNorm).length,
        });
      }

      const dishes = await computeDishTaannarx(meatCost);
      const thinDishes = dishes
        .filter(
          (d) =>
            d.salePrice > 0 &&
            d.meatCostTotal > 0 &&
            d.meatPct != null &&
            d.meatPct <= 100,
        )
        .sort((a, b) => (b.meatPct ?? 0) - (a.meatPct ?? 0))
        .slice(0, 6);

      return { meatCost, catalog, recipeCount, recentObvalka, thinDishes };
    }),
  }),

  pos: router({
    halls: protectedProcedure.query(async () => {
      return db
        .select({
          id: halls.id,
          name: halls.name,
          servicePct: halls.servicePct,
        })
        .from(halls)
        .orderBy(halls.sort);
    }),

    menu: protectedProcedure.query(async () => {
      return db
        .select({
          id: products.id,
          name: products.name,
          price: products.price,
          category: categories.name,
        })
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(and(eq(products.active, true), sql`${products.price} > 0`))
        .orderBy(products.type, products.name);
    }),

    openOrders: protectedProcedure.query(async () => {
      const rows = await db
        .select({
          id: orders.id,
          tableNo: orders.tableNo,
          createdAt: orders.createdAt,
          hall: halls.name,
          waiter: users.name,
          qty: sql<number>`coalesce(sum(${orderItems.qty}), 0)`,
          total: sql<number>`coalesce(sum(${orderItems.qty} * ${orderItems.price}), 0)`,
        })
        .from(orders)
        .leftJoin(halls, eq(orders.hallId, halls.id))
        .leftJoin(users, eq(orders.waiterId, users.id))
        .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
        .where(eq(orders.status, "open"))
        .groupBy(orders.id, halls.name, users.name)
        .orderBy(desc(orders.createdAt));
      return rows.map((r) => ({ ...r, qty: Number(r.qty), total: Number(r.total) }));
    }),

    order: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ input }) => {
        const head = (
          await db
            .select({
              id: orders.id,
              tableNo: orders.tableNo,
              status: orders.status,
              servicePct: orders.servicePct,
              createdAt: orders.createdAt,
              closedAt: orders.closedAt,
              isComp: orders.isComp,
              compReason: orders.compReason,
              hall: halls.name,
              waiter: users.name,
            })
            .from(orders)
            .leftJoin(halls, eq(orders.hallId, halls.id))
            .leftJoin(users, eq(orders.waiterId, users.id))
            .where(eq(orders.id, input.id))
            .limit(1)
        )[0];
        if (!head) throw new TRPCError({ code: "NOT_FOUND" });
        const items = await db
          .select({
            id: orderItems.id,
            productId: orderItems.productId,
            name: orderItems.name,
            price: orderItems.price,
            qty: orderItems.qty,
          })
          .from(orderItems)
          .where(eq(orderItems.orderId, input.id));
        const payments = await db
          .select({ method: orderPayments.method, amount: orderPayments.amount })
          .from(orderPayments)
          .where(eq(orderPayments.orderId, input.id));
        const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
        const service = Math.round((subtotal * head.servicePct) / 100);
        return {
          ...head,
          checkNo: input.id.slice(0, 5).toUpperCase(),
          items,
          payments,
          subtotal,
          service,
          total: subtotal + service,
        };
      }),

    create: protectedProcedure
      .input(
        z.object({ hallId: z.string().uuid(), tableNo: z.string().optional() }),
      )
      .mutation(async ({ input, ctx }) => {
        const hall = (
          await db.select().from(halls).where(eq(halls.id, input.hallId)).limit(1)
        )[0];
        if (!hall) throw new TRPCError({ code: "NOT_FOUND" });
        const row = (
          await db
            .insert(orders)
            .values({
              hallId: hall.id,
              tableNo: input.tableNo ?? null,
              waiterId: ctx.user.id,
              servicePct: hall.servicePct,
            })
            .returning()
        )[0];
        if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        return { id: row.id };
      }),

    addItem: protectedProcedure
      .input(
        z.object({
          orderId: z.string().uuid(),
          productId: z.string().uuid(),
          delta: z.number().int(),
        }),
      )
      .mutation(async ({ input }) => {
        const existing = (
          await db
            .select()
            .from(orderItems)
            .where(
              and(
                eq(orderItems.orderId, input.orderId),
                eq(orderItems.productId, input.productId),
              ),
            )
            .limit(1)
        )[0];
        if (existing) {
          const qty = existing.qty + input.delta;
          if (qty <= 0)
            await db.delete(orderItems).where(eq(orderItems.id, existing.id));
          else
            await db
              .update(orderItems)
              .set({ qty })
              .where(eq(orderItems.id, existing.id));
        } else if (input.delta > 0) {
          const p = (
            await db
              .select()
              .from(products)
              .where(eq(products.id, input.productId))
              .limit(1)
          )[0];
          if (!p) throw new TRPCError({ code: "NOT_FOUND" });
          await db.insert(orderItems).values({
            orderId: input.orderId,
            productId: p.id,
            name: p.name,
            price: p.price,
            qty: input.delta,
          });
        }
        return { ok: true };
      }),

    sendToKitchen: protectedProcedure
      .input(z.object({ orderId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        return db.transaction(async (tx) => {
          const ticket = await flushKitchenTicket(tx, input.orderId, ctx.user.id);
          return ticket ?? { id: null, createdAt: null, items: [] };
        });
      }),

    unsentCount: protectedProcedure
      .input(z.object({ orderId: z.string().uuid() }))
      .query(async ({ input }) => {
        const toSend = await computeUnsentItems(db, input.orderId);
        return { unsent: toSend.reduce((s, it) => s + it.unsent, 0) };
      }),

    ticketsForOrder: protectedProcedure
      .input(z.object({ orderId: z.string().uuid() }))
      .query(async ({ input }) => {
        const tix = await db
          .select({ id: kitchenTickets.id, createdAt: kitchenTickets.createdAt })
          .from(kitchenTickets)
          .where(eq(kitchenTickets.orderId, input.orderId))
          .orderBy(desc(kitchenTickets.createdAt));
        const counts = await db
          .select({
            ticketId: kitchenTicketItems.ticketId,
            n: sql<number>`coalesce(sum(${kitchenTicketItems.qty}), 0)`,
          })
          .from(kitchenTicketItems)
          .innerJoin(kitchenTickets, eq(kitchenTicketItems.ticketId, kitchenTickets.id))
          .where(eq(kitchenTickets.orderId, input.orderId))
          .groupBy(kitchenTicketItems.ticketId);
        const countMap = new Map(counts.map((c) => [c.ticketId, Number(c.n)]));
        return tix.map((t) => ({ id: t.id, createdAt: t.createdAt, itemCount: countMap.get(t.id) ?? 0 }));
      }),

    ticket: protectedProcedure
      .input(z.object({ ticketId: z.string().uuid() }))
      .query(async ({ input }) => {
        const head = (
          await db
            .select()
            .from(kitchenTickets)
            .where(eq(kitchenTickets.id, input.ticketId))
            .limit(1)
        )[0];
        if (!head) throw new TRPCError({ code: "NOT_FOUND" });
        const items = await db
          .select({ name: kitchenTicketItems.name, qty: kitchenTicketItems.qty, station: kitchenTicketItems.station })
          .from(kitchenTicketItems)
          .where(eq(kitchenTicketItems.ticketId, input.ticketId));
        const order = (
          await db
            .select({ tableNo: orders.tableNo, hall: halls.name })
            .from(orders)
            .leftJoin(halls, eq(orders.hallId, halls.id))
            .where(eq(orders.id, head.orderId))
            .limit(1)
        )[0];
        return {
          id: head.id,
          createdAt: head.createdAt,
          tableNo: order?.tableNo ?? null,
          hall: order?.hall ?? null,
          items,
        };
      }),

    close: protectedProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          payments: z
            .array(
              z.object({
                method: z.enum(["cash", "card", "click", "payme", "humo", "debt"]),
                amount: z.number().int().nonnegative(),
              }),
            )
            .optional(),
          comp: z.object({ reason: z.string().trim().min(1) }).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const pays = (input.payments ?? []).filter((p) => p.amount > 0);
        if (input.comp) {
          if (!["director", "manager", "cashier"].includes(ctx.user.role))
            throw new TRPCError({ code: "FORBIDDEN" });
          if (pays.length)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Текин заказга тўлов қўшиб бўлмайди",
            });
        }
        return db.transaction(async (tx) => {
          // Idempotent: only the tx that flips open→closed writes payments + списание.
          const flipped = await tx
            .update(orders)
            .set({
              status: "closed",
              closedAt: new Date(),
              closedById: ctx.user.id,
              ...(input.comp ? { isComp: true, compReason: input.comp.reason } : {}),
            })
            .where(and(eq(orders.id, input.id), eq(orders.status, "open")))
            .returning({ id: orders.id });
          if (flipped.length === 0)
            return { ok: true, alreadyClosed: true, deducted: 0, skipped: 0 };

          // safety net: ticket anything the waiter forgot to send before closing
          // ("тикетсиз таом ЙЎҚ" must hold even for fast/closed-without-send orders)
          await flushKitchenTicket(tx, input.id, ctx.user.id);

          // текин/ходим: stock is still written off below (food was actually
          // served) — only revenue (payments) is skipped.
          if (pays.length && !input.comp)
            await tx
              .insert(orderPayments)
              .values(pays.map((p) => ({ orderId: input.id, ...p })));

          // Carcass meat balances (meat is tracked at carcass, not cut, level).
          const carc = await tx
            .select({ id: products.id, name: products.name })
            .from(products)
            .where(inArray(products.name, ["Мол лаҳм", "Қўй лаҳм"]))
            .orderBy(products.createdAt);
          const molId = carc.find((c) => c.name === "Мол лаҳм")?.id ?? null;
          const qoyId = carc.find((c) => c.name === "Қўй лаҳм")?.id ?? null;

          // product type/unit lookup — only deduct stock-leaf, non-dona components (in grams)
          const prodMap = new Map(
            (
              await tx
                .select({
                  id: products.id,
                  type: products.type,
                  unit: products.unit,
                })
                .from(products)
            ).map((p) => [p.id, p]),
          );

          const items = await tx
            .select({
              productId: orderItems.productId,
              name: orderItems.name,
              qty: orderItems.qty,
              ptype: products.type,
              punit: products.unit,
              soldByWeight: products.soldByWeight,
            })
            .from(orderItems)
            .leftJoin(products, eq(orderItems.productId, products.id))
            .where(eq(orderItems.orderId, input.id));

          const moves: (typeof stockMovements.$inferInsert)[] = [];
          const skippedNames = new Set<string>();

          for (const it of items) {
            if (!it.productId) {
              skippedNames.add(it.name);
              continue;
            }
            if (it.ptype === "goods") {
              // goods are sold per piece; only deduct dona-unit goods (native count)
              if (it.punit === "dona")
                moves.push({
                  productId: it.productId,
                  type: "sale_writeoff",
                  qty: -it.qty,
                  unit: "dona",
                  refType: "order",
                  refId: input.id,
                  createdById: ctx.user.id,
                });
              else skippedNames.add(it.name);
              continue;
            }
            if (it.soldByWeight) {
              skippedNames.add(it.name);
              continue;
            }
            const rec = (
              await tx
                .select({ id: recipes.id })
                .from(recipes)
                .where(eq(recipes.productId, it.productId))
                .limit(1)
            )[0];
            if (!rec) {
              skippedNames.add(it.name);
              continue;
            }
            const ris = await tx
              .select()
              .from(recipeItems)
              .where(eq(recipeItems.recipeId, rec.id));
            for (const ri of ris) {
              if (ri.qtyG == null) continue;
              const hint = ri.stockHint ?? "";
              let target: string | null = null;
              if (/обвалка|лаҳм/i.test(hint)) {
                // carcass meat → grams against the 2 carcass products
                target = /мол/i.test(hint)
                  ? molId
                  : /қўй|қуй|куй/i.test(hint)
                    ? qoyId
                    : null;
              } else if (ri.componentId) {
                // mapped ingredient: only a stock-leaf, weight-unit product (grams)
                const c = prodMap.get(ri.componentId);
                if (c && c.type !== "dish" && c.type !== "semi" && c.unit !== "dona")
                  target = ri.componentId;
              }

              if (target)
                moves.push({
                  productId: target,
                  type: "sale_writeoff",
                  qty: -(ri.qtyG * it.qty),
                  unit: "g",
                  refType: "order",
                  refId: input.id,
                  note: ri.componentName,
                  createdById: ctx.user.id,
                });
              else skippedNames.add(ri.componentName);
            }
          }

          if (moves.length) await tx.insert(stockMovements).values(moves);
          return {
            ok: true,
            deducted: moves.length,
            skipped: skippedNames.size,
            skippedNames: [...skippedNames].slice(0, 12),
          };
        });
      }),
  }),

  stock: router({
    onHand: protectedProcedure.query(async () => {
      const rows = await db
        .select({
          productId: stockMovements.productId,
          name: products.name,
          type: products.type,
          unit: products.unit,
          onHand: sql<number>`sum(${stockMovements.qty})`,
        })
        .from(stockMovements)
        .innerJoin(products, eq(stockMovements.productId, products.id))
        .groupBy(
          stockMovements.productId,
          products.name,
          products.type,
          products.unit,
        )
        .orderBy(products.type, products.name);
      return rows.map((r) => ({ ...r, onHand: Number(r.onHand) }));
    }),
  }),

  purchase: router({
    // Purchasable goods/raw — meat comes via obvalka, dishes/semi are produced.
    products: protectedProcedure.query(async () => {
      return db
        .select({
          id: products.id,
          name: products.name,
          unit: products.unit,
          type: products.type,
          costPrice: products.costPrice,
        })
        .from(products)
        .where(
          and(
            eq(products.active, true),
            inArray(products.type, ["ingredient", "goods"]),
          ),
        )
        .orderBy(products.name);
    }),

    list: protectedProcedure.query(async () => {
      const rows = await db
        .select({
          id: purchases.id,
          supplier: purchases.supplier,
          total: purchases.total,
          createdAt: purchases.createdAt,
          buyer: users.name,
          lines: sql<number>`count(${purchaseItems.id})`,
        })
        .from(purchases)
        .leftJoin(users, eq(purchases.createdById, users.id))
        .leftJoin(purchaseItems, eq(purchaseItems.purchaseId, purchases.id))
        .groupBy(purchases.id, users.name)
        .orderBy(desc(purchases.createdAt))
        .limit(50);
      return rows.map((r) => ({ ...r, lines: Number(r.lines) }));
    }),

    create: protectedProcedure
      .input(
        z.object({
          supplier: z.string().optional(),
          note: z.string().optional(),
          items: z
            .array(
              z.object({
                productId: z.string().uuid(),
                qty: z.number().positive(),
                price: z.number().int().nonnegative(),
              }),
            )
            .min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        return db.transaction(async (tx) => {
          const prods = await tx
            .select({ id: products.id, unit: products.unit })
            .from(products)
            .where(
              inArray(
                products.id,
                input.items.map((i) => i.productId),
              ),
            );
          const unitOf = new Map(prods.map((p) => [p.id, p.unit]));

          // build persisted lines first so `total` matches only what's recorded
          const draft: {
            productId: string;
            qty: number;
            unit: "g" | "ml" | "dona";
            price: number;
          }[] = [];
          let total = 0;
          for (const it of input.items) {
            const u = unitOf.get(it.productId);
            if (!u) continue;
            const factor = u === "kg" || u === "l" ? 1000 : 1;
            const base = Math.round(it.qty * factor);
            if (base <= 0) continue;
            const baseUnit =
              u === "dona" ? "dona" : u === "l" || u === "ml" ? "ml" : "g";
            total += it.price;
            draft.push({ productId: it.productId, qty: base, unit: baseUnit, price: it.price });
            // remember last purchase price per display unit (kg/dona/l)
            const perUnit = Math.round(it.price / it.qty);
            if (perUnit > 0)
              await tx
                .update(products)
                .set({ costPrice: perUnit })
                .where(eq(products.id, it.productId));
          }
          if (!draft.length)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Маҳсулот танланг",
            });

          const head = (
            await tx
              .insert(purchases)
              .values({
                supplier: input.supplier ?? null,
                note: input.note ?? null,
                total,
                createdById: ctx.user.id,
              })
              .returning()
          )[0];
          if (!head) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

          await tx.insert(purchaseItems).values(
            draft.map((l) => ({
              purchaseId: head.id,
              productId: l.productId,
              qty: l.qty,
              unit: l.unit,
              price: l.price,
            })),
          );
          await tx.insert(stockMovements).values(
            draft.map((l) => ({
              productId: l.productId,
              type: "purchase" as const,
              qty: l.qty,
              unit: l.unit,
              refType: "purchase",
              refId: head.id,
              createdById: ctx.user.id,
            })),
          );
          return { id: head.id, lines: draft.length, total };
        });
      }),
  }),

  finance: router({
    expenses: router({
      list: directorProcedure
        .input(
          z
            .object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
            .optional(),
        )
        .query(async ({ input }) => {
          const { startUTC, endUTC, dayKey } = businessDayBounds(input?.day);
          const rows = await db
            .select({
              id: expenses.id,
              category: expenses.category,
              amount: expenses.amount,
              method: expenses.method,
              recurring: expenses.recurring,
              note: expenses.note,
              spentAt: expenses.spentAt,
            })
            .from(expenses)
            .where(
              and(gte(expenses.spentAt, startUTC), lt(expenses.spentAt, endUTC)),
            )
            .orderBy(desc(expenses.spentAt));
          const total = rows.reduce((s, r) => s + r.amount, 0);
          const byCat: Record<string, number> = {};
          for (const r of rows) byCat[r.category] = (byCat[r.category] ?? 0) + r.amount;
          return { dayKey, rows, total, byCat };
        }),

      create: directorProcedure
        .input(
          z.object({
            category: z.enum([
              "ijara",
              "gaz",
              "elektr",
              "ish_haqi",
              "jihoz",
              "ega_oldi",
              "boshqa",
            ]),
            amount: z.number().int().positive(),
            method: z.enum(["cash", "card", "click", "payme", "humo", "debt"]).optional(),
            recurring: z.boolean().optional(),
            note: z.string().optional(),
            day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          // backdate to noon of the chosen business day (lands inside its 06:00 window)
          const spentAt = input.day
            ? new Date(businessDayBounds(input.day).startUTC.getTime() + 12 * 3600 * 1000)
            : new Date();
          const row = (
            await db
              .insert(expenses)
              .values({
                category: input.category,
                amount: input.amount,
                method: input.method ?? "cash",
                recurring: input.recurring ?? false,
                note: input.note ?? null,
                spentAt,
                createdById: ctx.user.id,
              })
              .returning({ id: expenses.id })
          )[0];
          return { id: row?.id };
        }),

      delete: directorProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ input }) => {
          await db.delete(expenses).where(eq(expenses.id, input.id));
          return { ok: true };
        }),
    }),

    dayClose: directorProcedure
      .input(
        z
          .object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
          .optional(),
      )
      .query(async ({ input }) => {
        const { startUTC, endUTC, dayKey } = businessDayBounds(input?.day);
        const fin = await financeForWindow(startUTC, endUTC);
        return { dayKey, ...fin };
      }),

    pnl: directorProcedure
      .input(
        z.object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        }),
      )
      .query(async ({ input }) => {
        const { startUTC, endUTC, days } = businessRangeBounds(input.from, input.to);
        const fin = await financeForWindow(startUTC, endUTC);
        const cogsShare = fin.revenue > 0 ? fin.cogs / fin.revenue : 0;
        const denom = 1 - cogsShare;
        return {
          ...fin,
          days,
          dailyAvg: Math.round(fin.revenue / days),
          marginPct: fin.revenue > 0 ? Math.round((fin.sofFoyda / fin.revenue) * 100) : null,
          breakEvenPerDay: denom > 0 ? Math.round(fin.opex / days / denom) : null,
        };
      }),

    debts: directorProcedure.query(async () => {
      const supplierRows = await db
        .select({
          id: purchases.id,
          supplier: purchases.supplier,
          total: purchases.total,
          paidTotal: purchases.paidTotal,
          createdAt: purchases.createdAt,
        })
        .from(purchases)
        .where(sql`${purchases.paidTotal} < ${purchases.total}`)
        .orderBy(desc(purchases.createdAt));
      const supplier = supplierRows.map((r) => ({
        ...r,
        outstanding: r.total - r.paidTotal,
      }));
      const supplierTotal = supplier.reduce((s, r) => s + r.outstanding, 0);

      // guest debt = order_payments(method='debt') minus later debt_payments repayments
      const debtRows = await db
        .select({
          orderId: orders.id,
          tableNo: orders.tableNo,
          closedAt: orders.closedAt,
          hall: halls.name,
          amount: orderPayments.amount,
        })
        .from(orderPayments)
        .innerJoin(orders, eq(orderPayments.orderId, orders.id))
        .leftJoin(halls, eq(orders.hallId, halls.id))
        .where(eq(orderPayments.method, "debt"));
      const paidRows = await db
        .select({
          orderId: debtPayments.orderId,
          paid: sql<number>`sum(${debtPayments.amount})`,
        })
        .from(debtPayments)
        .groupBy(debtPayments.orderId);
      const paidMap = new Map(paidRows.map((r) => [r.orderId, Number(r.paid)]));
      const guestAll = debtRows
        .map((r) => ({ ...r, outstanding: r.amount - (paidMap.get(r.orderId) ?? 0) }))
        .filter((r) => r.outstanding > 0)
        .sort((a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0));
      const guestTotal = guestAll.reduce((s, r) => s + r.outstanding, 0);
      const guest = guestAll.slice(0, 50);

      return { supplier, supplierTotal, guest, guestTotal };
    }),

    payGuestDebt: protectedProcedure
      .input(
        z.object({
          orderId: z.string().uuid(),
          amount: z.number().int().positive(),
          method: z.enum(["cash", "card", "click", "payme", "humo"]).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (!["director", "manager", "cashier"].includes(ctx.user.role))
          throw new TRPCError({ code: "FORBIDDEN" });
        return db.transaction(async (tx) => {
          // lock the order row so concurrent repayments serialize (no lost-update over-pay)
          await tx.execute(
            sql`select id from ${orders} where id = ${input.orderId} for update`,
          );
          const debt = (
            await tx
              .select({ amount: orderPayments.amount })
              .from(orderPayments)
              .where(
                and(
                  eq(orderPayments.orderId, input.orderId),
                  eq(orderPayments.method, "debt"),
                ),
              )
              .limit(1)
          )[0];
          if (!debt) throw new TRPCError({ code: "NOT_FOUND" });
          const paid = Number(
            (
              await tx
                .select({ s: sql<number>`coalesce(sum(${debtPayments.amount}), 0)` })
                .from(debtPayments)
                .where(eq(debtPayments.orderId, input.orderId))
            )[0]?.s ?? 0,
          );
          const outstanding = debt.amount - paid;
          if (input.amount > outstanding)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Қолган қарз ${outstanding.toLocaleString("ru-RU")} so'm`,
            });
          await tx.insert(debtPayments).values({
            orderId: input.orderId,
            amount: input.amount,
            method: input.method ?? "cash",
            createdById: ctx.user.id,
          });
          return { ok: true, outstanding: outstanding - input.amount };
        });
      }),

    tillCount: router({
      get: directorProcedure
        .input(
          z
            .object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })
            .optional(),
        )
        .query(async ({ input }) => {
          const { startUTC, endUTC, dayKey } = businessDayBounds(input?.day);
          const { cashRevenue, cashDebtRepaid, cashExpenses, expectedCash } =
            await expectedCashForWindow(startUTC, endUTC);
          const row = (
            await db
              .select()
              .from(tillCounts)
              .where(eq(tillCounts.dayKey, dayKey))
              .limit(1)
          )[0];
          return {
            dayKey,
            floatAmount: TILL_FLOAT,
            cashRevenue,
            cashDebtRepaid,
            cashExpenses,
            expectedCash,
            countedCash: row?.countedCash ?? null,
            variance: row ? row.countedCash - expectedCash : null,
            note: row?.note ?? null,
          };
        }),

      set: directorProcedure
        .input(
          z.object({
            day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
            countedCash: z.number().int().nonnegative(),
            note: z.string().optional(),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          const { dayKey } = businessDayBounds(input.day);
          await db
            .insert(tillCounts)
            .values({
              dayKey,
              countedCash: input.countedCash,
              note: input.note ?? null,
              createdById: ctx.user.id,
            })
            .onConflictDoUpdate({
              target: tillCounts.dayKey,
              // note omitted on a later call → keep the existing value, don't null it out
              set: {
                countedCash: input.countedCash,
                ...(input.note !== undefined ? { note: input.note } : {}),
              },
            });
          return { ok: true };
        }),
    }),

    paySupplier: protectedProcedure
      .input(
        z.object({
          purchaseId: z.string().uuid(),
          amount: z.number().int().positive(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (!["director", "manager", "buyer"].includes(ctx.user.role))
          throw new TRPCError({ code: "FORBIDDEN" });
        return db.transaction(async (tx) => {
          const p = (
            await tx
              .select({ total: purchases.total, paidTotal: purchases.paidTotal })
              .from(purchases)
              .where(eq(purchases.id, input.purchaseId))
              .limit(1)
          )[0];
          if (!p) throw new TRPCError({ code: "NOT_FOUND" });
          const outstanding = p.total - p.paidTotal;
          if (input.amount > outstanding)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Қолган қарз ${outstanding.toLocaleString("ru-RU")} so'm`,
            });
          // atomic + guarded: bump in SQL, reject if a concurrent payment would
          // push paidTotal over total (lost-update / over-pay protection)
          const updated = await tx
            .update(purchases)
            .set({ paidTotal: sql`${purchases.paidTotal} + ${input.amount}` })
            .where(
              and(
                eq(purchases.id, input.purchaseId),
                sql`${purchases.paidTotal} + ${input.amount} <= ${purchases.total}`,
              ),
            )
            .returning({ paidTotal: purchases.paidTotal });
          if (updated.length === 0)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Қарз ўзгарган — қайта уриниб кўринг",
            });
          return { ok: true, paidTotal: updated[0]!.paidTotal };
        });
      }),
  }),

  analytics: router({
    onHandAll: managerProcedure.query(() => stockableOnHand()),

    activeCounts: managerProcedure.query(async () => {
      return db
        .select({
          id: inventoryCounts.id,
          storage: inventoryCounts.storage,
          status: inventoryCounts.status,
          createdAt: inventoryCounts.createdAt,
          createdBy: users.name,
        })
        .from(inventoryCounts)
        .leftJoin(users, eq(inventoryCounts.createdById, users.id))
        .where(inArray(inventoryCounts.status, ["open", "submitted"]))
        .orderBy(desc(inventoryCounts.createdAt));
    }),

    countList: managerProcedure
      .input(z.object({ limit: z.number().int().positive().max(50).optional() }).optional())
      .query(async ({ input }) => {
        return db
          .select({
            id: inventoryCounts.id,
            storage: inventoryCounts.storage,
            status: inventoryCounts.status,
            createdAt: inventoryCounts.createdAt,
            submittedAt: inventoryCounts.submittedAt,
            approvedAt: inventoryCounts.approvedAt,
            createdBy: users.name,
          })
          .from(inventoryCounts)
          .leftJoin(users, eq(inventoryCounts.createdById, users.id))
          .orderBy(desc(inventoryCounts.createdAt))
          .limit(input?.limit ?? 20);
      }),

    startCount: managerProcedure
      .input(z.object({ storage: z.enum(STORAGES) }))
      .mutation(async ({ input, ctx }) => {
        return db.transaction(async (tx) => {
          // advisory lock keyed on storage — serializes concurrent startCount
          // calls for the same storage so the existence-check+insert is atomic
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.storage}))`);
          const existing = (
            await tx
              .select({ id: inventoryCounts.id })
              .from(inventoryCounts)
              .where(
                and(
                  eq(inventoryCounts.storage, input.storage),
                  inArray(inventoryCounts.status, ["open", "submitted"]),
                ),
              )
              .limit(1)
          )[0];
          if (existing) return { id: existing.id, resumed: true };

          const row = (
            await tx
              .insert(inventoryCounts)
              .values({ storage: input.storage, createdById: ctx.user.id })
              .returning({ id: inventoryCounts.id })
          )[0];
          if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

          const snapshot = await stockableOnHand(tx);
          if (snapshot.length)
            await tx.insert(inventoryItems).values(
              snapshot.map((p, i) => ({
                countId: row.id,
                productId: p.id,
                theoreticalQty: p.onHand,
                unit: p.unit,
                sort: i,
              })),
            );
          return { id: row.id, resumed: false };
        });
      }),

    count: managerProcedure
      .input(z.object({ countId: z.string().uuid() }))
      .query(async ({ input }) => {
        const head = (
          await db
            .select()
            .from(inventoryCounts)
            .where(eq(inventoryCounts.id, input.countId))
            .limit(1)
        )[0];
        if (!head) throw new TRPCError({ code: "NOT_FOUND" });
        const items = await db
          .select({
            id: inventoryItems.id,
            productId: inventoryItems.productId,
            name: products.name,
            type: products.type,
            unit: inventoryItems.unit,
            theoreticalQty: inventoryItems.theoreticalQty,
            countedQty: inventoryItems.countedQty,
            reason: inventoryItems.reason,
            costPrice: products.costPrice,
          })
          .from(inventoryItems)
          .innerJoin(products, eq(inventoryItems.productId, products.id))
          .where(eq(inventoryItems.countId, input.countId))
          .orderBy(inventoryItems.sort);
        const meatCost = { qoy: await latestMeatCost("qoy"), mol: await latestMeatCost("mol") };
        const rows = items.map((it) => {
          const counted = it.countedQty != null;
          const diff = (it.countedQty ?? it.theoreticalQty) - it.theoreticalQty;
          const diffPct =
            it.theoreticalQty !== 0
              ? Math.round((diff / Math.abs(it.theoreticalQty)) * 100)
              : diff !== 0
                ? null
                : 0;
          const carc =
            it.name === "Мол лаҳм" ? meatCost.mol : it.name === "Қўй лаҳм" ? meatCost.qoy : null;
          const valueGap =
            counted && diff !== 0 ? valuePortion(Math.abs(diff), it.unit, it.costPrice, carc) : null;
          const flag =
            counted && diff !== 0 && (it.theoreticalQty === 0 || (diffPct != null && Math.abs(diffPct) > 5));
          return {
            id: it.id,
            productId: it.productId,
            name: it.name,
            type: it.type,
            unit: it.unit,
            theoreticalQty: it.theoreticalQty,
            countedQty: it.countedQty,
            counted,
            diff,
            diffPct,
            valueGap,
            flag,
            reason: it.reason,
          };
        });
        return {
          id: head.id,
          storage: head.storage,
          status: head.status,
          note: head.note,
          createdAt: head.createdAt,
          submittedAt: head.submittedAt,
          approvedAt: head.approvedAt,
          items: rows,
        };
      }),

    saveCount: managerProcedure
      .input(
        z.object({
          countId: z.string().uuid(),
          items: z.array(
            z.object({
              itemId: z.string().uuid(),
              countedQty: z.number().int().nonnegative().nullable(),
              reason: z.string().optional(),
            }),
          ),
        }),
      )
      .mutation(async ({ input }) => {
        return db.transaction(async (tx) => {
          // lock the count row so a concurrent submit/approve can't race past
          // this status check — same pattern as paySupplier/payGuestDebt
          await tx.execute(
            sql`select id from ${inventoryCounts} where id = ${input.countId} for update`,
          );
          const head = (
            await tx
              .select({ status: inventoryCounts.status })
              .from(inventoryCounts)
              .where(eq(inventoryCounts.id, input.countId))
              .limit(1)
          )[0];
          if (!head) throw new TRPCError({ code: "NOT_FOUND" });
          if (head.status !== "open")
            throw new TRPCError({ code: "BAD_REQUEST", message: "Бу санаш ёпилган" });
          for (const it of input.items) {
            await tx
              .update(inventoryItems)
              .set({ countedQty: it.countedQty, reason: it.reason ?? null })
              .where(
                and(eq(inventoryItems.id, it.itemId), eq(inventoryItems.countId, input.countId)),
              );
          }
          return { ok: true };
        });
      }),

    submitCount: managerProcedure
      .input(z.object({ countId: z.string().uuid() }))
      .mutation(async ({ input }) => {
        return db.transaction(async (tx) => {
          const items = await tx
            .select({
              name: products.name,
              theoreticalQty: inventoryItems.theoreticalQty,
              countedQty: inventoryItems.countedQty,
              reason: inventoryItems.reason,
            })
            .from(inventoryItems)
            .innerJoin(products, eq(inventoryItems.productId, products.id))
            .where(eq(inventoryItems.countId, input.countId));
          const missing = items.filter(
            (it) =>
              it.countedQty != null && it.countedQty !== it.theoreticalQty && !it.reason?.trim(),
          );
          if (missing.length)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Фарқ сабаби кўрсатилмаган: ${missing
                .slice(0, 5)
                .map((m) => m.name)
                .join(", ")}`,
            });
          const flipped = await tx
            .update(inventoryCounts)
            .set({ status: "submitted", submittedAt: new Date() })
            .where(and(eq(inventoryCounts.id, input.countId), eq(inventoryCounts.status, "open")))
            .returning({ id: inventoryCounts.id });
          if (flipped.length === 0) return { ok: true, alreadySubmitted: true };
          return { ok: true };
        });
      }),

    approveCount: directorProcedure
      .input(z.object({ countId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        return db.transaction(async (tx) => {
          const flipped = await tx
            .update(inventoryCounts)
            .set({ status: "approved", approvedById: ctx.user.id, approvedAt: new Date() })
            .where(
              and(eq(inventoryCounts.id, input.countId), eq(inventoryCounts.status, "submitted")),
            )
            .returning({ id: inventoryCounts.id });
          if (flipped.length === 0) return { ok: true, alreadyApproved: true, adjusted: 0 };

          const items = await tx
            .select()
            .from(inventoryItems)
            .where(eq(inventoryItems.countId, input.countId));
          const moves = items
            .filter((it) => it.countedQty != null && it.countedQty !== it.theoreticalQty)
            .map((it) => ({
              productId: it.productId,
              type: "inventory_adjust" as const,
              qty: it.countedQty! - it.theoreticalQty,
              unit: it.unit,
              refType: "inventory",
              refId: input.countId,
              note: it.reason ?? null,
              createdById: ctx.user.id,
            }));
          if (moves.length) await tx.insert(stockMovements).values(moves);
          return { ok: true, alreadyApproved: false, adjusted: moves.length };
        });
      }),

    signals: directorProcedure.query(() => computeSignals()),

    digest: directorProcedure.query(async () => {
      const { startUTC, endUTC } = businessDayBounds();
      const todayFin = await financeForWindow(startUTC, endUTC);
      const estCogs = Math.round(todayFin.revenue * BLENDED_COGS_PCT);
      const estProfit = todayFin.revenue - estCogs - todayFin.opex - todayFin.cardTax;

      const { supplierTotal, guestTotal } = await debtTotals();
      const stock = await stockableOnHand();
      const lowStock = stock.filter((p) => p.onHand < 0).length;

      const sig = await computeSignals();
      const anomalyCount =
        sig.obvalkaFlags.length +
        sig.thinDishes.length +
        (sig.cashVariance && sig.cashVariance.variance !== 0 ? 1 : 0) +
        (sig.breakEvenFlag ? 1 : 0) +
        sig.priceSpikes.length +
        sig.shortagePattern.length +
        (sig.compFlag ? 1 : 0);

      return {
        revenueToday: todayFin.revenue,
        estProfit,
        estCogsPct: BLENDED_COGS_PCT,
        anomalyCount,
        lowStock,
        debtToday: supplierTotal + guestTotal,
        supplierDebt: supplierTotal,
        guestDebt: guestTotal,
      };
    }),
  }),

  report: router({
    salesDaily: managerProcedure
      .input(z.object({ days: z.number().int().positive().max(60).optional() }).optional())
      .query(async ({ input }) => {
        const days = input?.days ?? 14;
        let dayKey = businessDayBounds().dayKey;
        const keys: string[] = [];
        for (let i = 0; i < days; i++) {
          keys.unshift(dayKey);
          dayKey = previousDayKey(dayKey);
        }
        const rows = [];
        for (const k of keys) {
          const { startUTC, endUTC } = businessDayBounds(k);
          const r = await revenueForWindow(startUTC, endUTC);
          rows.push({ dayKey: k, revenue: r.revenue, checks: r.checks, avgCheck: r.avgCheck });
        }
        return { rows, breakEvenHint: BREAK_EVEN_HINT };
      }),

    byCategory: managerProcedure
      .input(
        z.object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        }),
      )
      .query(async ({ input }) => {
        const { startUTC, endUTC } = businessRangeBounds(input.from, input.to);
        const nonRevenue = await nonRevenueOrderIds(startUTC, endUTC);
        const rows = await db
          .select({
            orderId: orderItems.orderId,
            category: categories.name,
            qty: orderItems.qty,
            price: orderItems.price,
          })
          .from(orderItems)
          .innerJoin(orders, eq(orderItems.orderId, orders.id))
          .leftJoin(products, eq(orderItems.productId, products.id))
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .where(
            and(
              eq(orders.status, "closed"),
              gte(orders.closedAt, startUTC),
              lt(orders.closedAt, endUTC),
            ),
          );
        const byCat = new Map<string, { revenue: number; qty: number }>();
        let total = 0;
        for (const r of rows) {
          const key = r.category ?? "Бошқа";
          const e = byCat.get(key) ?? { revenue: 0, qty: 0 };
          e.qty += r.qty; // food served counts regardless of payment status
          if (!nonRevenue.has(r.orderId)) {
            // revenue = realized cash only, matching salesDaily/byWaiter convention
            const rev = r.qty * r.price;
            e.revenue += rev;
            total += rev;
          }
          byCat.set(key, e);
        }
        return [...byCat.entries()]
          .map(([category, v]) => ({
            category,
            revenue: v.revenue,
            qty: v.qty,
            pct: total > 0 ? Math.round((v.revenue / total) * 100) : 0,
          }))
          .sort((a, b) => b.revenue - a.revenue);
      }),

    topDishes: managerProcedure
      .input(
        z.object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          by: z.enum(["qty", "profit"]).optional(),
          limit: z.number().int().positive().max(50).optional(),
        }),
      )
      .query(async ({ input }) => {
        const { startUTC, endUTC } = businessRangeBounds(input.from, input.to);
        const nonRevenue = await nonRevenueOrderIds(startUTC, endUTC);
        const rows = await db
          .select({
            orderId: orderItems.orderId,
            productId: orderItems.productId,
            name: orderItems.name,
            qty: orderItems.qty,
            price: orderItems.price,
          })
          .from(orderItems)
          .innerJoin(orders, eq(orderItems.orderId, orders.id))
          .where(
            and(
              eq(orders.status, "closed"),
              gte(orders.closedAt, startUTC),
              lt(orders.closedAt, endUTC),
            ),
          );
        const byProduct = new Map<string, { name: string; qty: number; revenue: number }>();
        for (const r of rows) {
          if (!r.productId) continue;
          const e = byProduct.get(r.productId) ?? { name: r.name, qty: 0, revenue: 0 };
          e.qty += r.qty; // food served counts regardless of payment status
          if (!nonRevenue.has(r.orderId)) e.revenue += r.qty * r.price; // realized cash only
          byProduct.set(r.productId, e);
        }
        const meatCost = { qoy: await latestMeatCost("qoy"), mol: await latestMeatCost("mol") };
        const dishes = await computeDishTaannarx(meatCost);
        const meatPerUnit = new Map(
          dishes
            // exclude batch/pot recipes (meatPct>100 = per-pot, not per-serving — same
            // exclusion as computeSignals/Taannarx) and meat-present-but-unpriced dishes
            // (would otherwise read as a real 0 and overstate profit to full revenue)
            .filter(
              (d) =>
                d.productId &&
                !(d.meatPct != null && d.meatPct > 100) &&
                !d.hasUnpricedMeat,
            )
            .map((d) => [d.productId as string, d.meatCostTotal]),
        );
        const result = [...byProduct.entries()].map(([productId, v]) => {
          const perUnit = meatPerUnit.get(productId) ?? null;
          const meatCostTotal = perUnit != null ? perUnit * v.qty : null;
          const profit = meatCostTotal != null ? v.revenue - meatCostTotal : null;
          return { productId, name: v.name, qty: v.qty, revenue: v.revenue, meatCostTotal, profit };
        });
        const by = input.by ?? "profit";
        result.sort((a, b) =>
          by === "qty" ? b.qty - a.qty : (b.profit ?? -Infinity) - (a.profit ?? -Infinity),
        );
        return result.slice(0, input.limit ?? 15);
      }),

    byWaiter: managerProcedure
      .input(
        z.object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        }),
      )
      .query(async ({ input }) => {
        const { startUTC, endUTC } = businessRangeBounds(input.from, input.to);
        const rows = await db
          .select({
            waiterId: orders.waiterId,
            waiterName: users.name,
            amount: orderPayments.amount,
            method: orderPayments.method,
            orderId: orders.id,
          })
          .from(orderPayments)
          .innerJoin(orders, eq(orderPayments.orderId, orders.id))
          .leftJoin(users, eq(orders.waiterId, users.id))
          .where(
            and(
              eq(orders.status, "closed"),
              gte(orders.closedAt, startUTC),
              lt(orders.closedAt, endUTC),
            ),
          );
        const byWaiter = new Map<string, { name: string; revenue: number; orders: Set<string> }>();
        for (const r of rows) {
          if (r.method === "debt") continue; // realized revenue only
          const key = r.waiterId ?? "unknown";
          const e = byWaiter.get(key) ?? {
            name: r.waiterName ?? "Номаълум",
            revenue: 0,
            orders: new Set<string>(),
          };
          e.revenue += r.amount;
          e.orders.add(r.orderId);
          byWaiter.set(key, e);
        }
        return [...byWaiter.entries()]
          .map(([waiterId, v]) => ({
            waiterId,
            name: v.name,
            revenue: v.revenue,
            checks: v.orders.size,
          }))
          .sort((a, b) => b.revenue - a.revenue);
      }),
  }),
});

export type AppRouter = typeof appRouter;
