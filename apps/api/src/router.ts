import { and, count, desc, eq, gt, gte, inArray, isNotNull, lt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import {
  hashPin,
  hashToken,
  newSessionToken,
  pinLookup,
  verifyPin,
} from "./auth";
import { SESSION_COOKIE } from "./context";
import {
  clientIp,
  loginBlockedFor,
  recordLoginFail,
  recordLoginSuccess,
} from "./rate-limit";
import { db } from "./db/client";
import {
  cashCollections,
  categories,
  clientOps,
  customers,
  debtPayments,
  expenses,
  halls,
  inventoryCounts,
  inventoryItems,
  kitchenTicketItems,
  kitchenTickets,
  marinadeBatches,
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
  refunds,
  sessions,
  stations,
  stockMovements,
  tables,
  tillCounts,
  users,
  voidedItems,
} from "./db/schema";
import { computeObvalka } from "./obvalka-calc";
import {
  type CheckData,
  printCheck,
  printKitchenTicket,
} from "./printing/escpos";
import { businessDayBounds, businessRangeBounds, previousDayKey } from "./time";
import { TRPCError } from "@trpc/server";
import {
  cashierProcedure,
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
  const cashCollected = Number(
    (
      await db
        .select({ s: sql<number>`coalesce(sum(${cashCollections.amount}), 0)` })
        .from(cashCollections)
        .where(
          and(gte(cashCollections.createdAt, start), lt(cashCollections.createdAt, end)),
        )
    )[0]?.s ?? 0,
  );
  const expectedCash =
    TILL_FLOAT + cashRevenue + cashDebtRepaid - cashExpenses - cashCollected;
  return { cashRevenue, cashDebtRepaid, cashExpenses, cashCollected, expectedCash };
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
const STALE_ORDER_MINUTES = 90; // open table this long with no close → possible walked-out guest
const GRAMM_LEAK_TOLERANCE_PCT = 5; // маринад vs сотилган сих: >5% фарқ → грамм оқмаси

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
  const underDelivery: {
    id: string;
    carcassType: string;
    weightG: number;
    sumPartsG: number;
    lossPct: number;
    missingG: number;
    missingCost: number;
    shortReason: string | null;
    supplier: string | null;
    createdAt: Date;
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
    // Кам келтириш: обвалка вазни (харид) − қисмлар йиғиндиси > 5% (КАМ келди).
    // Бозорчи қассобдан кам гўшт олиб келган ёки ёзувда йўқ бўлган бўлиши мумкин.
    if (c.lossPct > 5)
      underDelivery.push({
        id: o.id,
        carcassType: o.carcassType,
        weightG: o.weightG,
        sumPartsG: c.totalPartsG,
        lossPct: c.lossPct,
        missingG: c.lossG,
        missingCost: Math.round((c.lossG / 1000) * o.pricePerKg),
        shortReason: o.shortReason,
        supplier: o.supplier,
        createdAt: o.createdAt,
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
  const cashVariance =
    tillRow?.countedCash != null
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

  // №14 очиқ стол сигнали: узоқ ёпилмаган стол — мижоз тўламай кетган
  // ёки касса эсдан чиқарган бўлиши мумкин.
  const staleCutoff = new Date(Date.now() - STALE_ORDER_MINUTES * 60_000);
  const staleRows = await db
    .select({
      id: orders.id,
      tableNo: orders.tableNo,
      hall: halls.name,
      waiter: users.name,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .leftJoin(halls, eq(orders.hallId, halls.id))
    .leftJoin(users, eq(orders.waiterId, users.id))
    .where(and(eq(orders.status, "open"), lt(orders.createdAt, staleCutoff)))
    .orderBy(orders.createdAt);
  const staleOrders = staleRows.map((r) => ({
    ...r,
    minutesOpen: Math.floor((Date.now() - r.createdAt.getTime()) / 60_000),
  }));

  // ── Сих грамм-оқма сигнали (M3): маринадланган гўшт (кг) vs сотилган сих ──
  // Ошпаз ҳар сихга нормадан кўп гўшт қўйса (ёки сих йўқолса), маринад кўп,
  // сотилган сих кам → оқма. Кунлик дарча, faqat qoy/mol лаҳм (товуқ/помидор
  // алоҳида омбор — киритилмайди).
  const marRows = await db
    .select({ carcassType: marinadeBatches.carcassType, marinatedG: marinadeBatches.marinatedG })
    .from(marinadeBatches)
    .where(and(gte(marinadeBatches.createdAt, startUTC), lt(marinadeBatches.createdAt, endUTC)));
  const marinated: Record<"qoy" | "mol", number> = { qoy: 0, mol: 0 };
  for (const m of marRows) marinated[m.carcassType] += m.marinatedG;

  // productId → carcassType (рецепт гўшт stockHint'идан)
  const meatHints = await db
    .select({ productId: recipes.productId, stockHint: recipeItems.stockHint })
    .from(recipeItems)
    .innerJoin(recipes, eq(recipeItems.recipeId, recipes.id))
    .where(isNotNull(recipes.productId));
  // Ҳар product'нинг қайси carcass(лар)га тегиши. Аралаш (мол ВА қўй) таом
  // аниқ бир carcass'га тегишли эмас — grammLeak'дан ЧИҚАРИЛАДИ (нотўғри
  // ҳисоблашдан кўра ҳисобламаган яхши; query tartibiga bog'liq bo'lmaslik uchun).
  const prodCarcassSet = new Map<string, Set<"qoy" | "mol">>();
  for (const h of meatHints) {
    if (!h.productId) continue;
    const s = h.stockHint ?? "";
    const set = prodCarcassSet.get(h.productId) ?? new Set<"qoy" | "mol">();
    if (/мол/i.test(s)) set.add("mol");
    else if (/қўй|қуй|куй/i.test(s)) set.add("qoy");
    if (set.size) prodCarcassSet.set(h.productId, set);
  }
  const prodCarcass = new Map<string, "qoy" | "mol">();
  for (const [pid, set] of prodCarcassSet) {
    const only = [...set][0];
    if (set.size === 1 && only) prodCarcass.set(pid, only);
  }

  const soldRows = await db
    .select({ productId: orderItems.productId, qty: orderItems.qty, gramNorm: products.gramNorm })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .innerJoin(products, eq(orderItems.productId, products.id))
    .where(
      and(
        eq(orders.status, "closed"),
        isNotNull(products.gramNorm),
        gte(orders.closedAt, startUTC),
        lt(orders.closedAt, endUTC),
      ),
    );
  const sold: Record<"qoy" | "mol", { qty: number; usedG: number }> = {
    qoy: { qty: 0, usedG: 0 },
    mol: { qty: 0, usedG: 0 },
  };
  for (const r of soldRows) {
    const ct = r.productId ? prodCarcass.get(r.productId) : undefined;
    if (!ct || r.gramNorm == null) continue;
    sold[ct].qty += r.qty;
    sold[ct].usedG += r.qty * r.gramNorm;
  }

  const grammLeak = (["qoy", "mol"] as const)
    .map((ct) => {
      const marinatedG = marinated[ct];
      const { qty: soldSikh, usedG } = sold[ct];
      const avgNormG = soldSikh > 0 ? Math.round(usedG / soldSikh) : 0;
      const expectedSikh = avgNormG > 0 ? Math.round(marinatedG / avgNormG) : 0;
      const leakG = marinatedG - usedG;
      const leakPct = marinatedG > 0 ? Math.round((leakG / marinatedG) * 100) : 0;
      return {
        carcassType: ct,
        marinatedG,
        soldSikh,
        usedG,
        expectedSikh,
        leakG,
        leakPct,
        // Флаг faqat СОТУВ бўлганда — соtilmasдan оқма ҳисобланмайди (акс ҳолда
        // эрталаб маринад тайёрланса ҳар куни сохта 100% тревога чиқади).
        flag: marinatedG > 0 && soldSikh > 0 && Math.abs(leakPct) > GRAMM_LEAK_TOLERANCE_PCT,
      };
    })
    .filter((g) => g.marinatedG > 0 || g.soldSikh > 0);

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
    staleOrders,
    underDelivery,
    grammLeak,
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
    (byMethod.card ?? 0) + (byMethod.click ?? 0) + (byMethod.payme ?? 0) + (byMethod.humo ?? 0);
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
  // эга олди — фойда ТАҚСИМОТИ, OPEX эмас: нақддан чиқади (expectedCash санайди),
  // лекин соф фойдани камайтирмайди. Алоҳида ownerDraw сифатида кўрсатилади.
  let opex = 0;
  let ownerDraw = 0;
  const opexByCat: Record<string, number> = {};
  for (const e of expRows) {
    if (e.category === "ega_oldi") {
      ownerDraw += e.amount;
      continue;
    }
    opex += e.amount;
    opexByCat[e.category] = (opexByCat[e.category] ?? 0) + e.amount;
  }

  const refundRows = await db
    .select({ amount: refunds.amount })
    .from(refunds)
    .where(and(gte(refunds.createdAt, start), lt(refunds.createdAt, end)));
  const refundTotal = refundRows.reduce((s, r) => s + r.amount, 0);

  // Чегирма — фақат informational (revenue аллақачон камроқ тўловни акс
  // эттиради, шунинг учун sofFoyda'дан ҚАЙТА айирилмайди). Директор кўради.
  const discountRows = await db
    .select({ amount: orders.discountAmount })
    .from(orders)
    .where(
      and(
        eq(orders.status, "closed"),
        gte(orders.closedAt, start),
        lt(orders.closedAt, end),
      ),
    );
  const discountTotal = discountRows.reduce((s, r) => s + r.amount, 0);

  const sofFoyda = revenue - cogsRes.cogs - opex - cardTax - refundTotal;
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
    refundTotal,
    discountTotal,
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
  ticketId?: string,
) {
  // advisory lock keyed on orderId — serializes concurrent sendToKitchen calls
  // (and sendToKitchen racing pos.close's auto-flush) so they can't both read
  // the same "sent so far" snapshot and double-ticket the same items.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orderId}))`);

  // Идемпотентлик: клиент ticketId берса ва ўша тикет аллақачон бор бўлса
  // (offline/retry replay) — янги тикет ЯРАТМАЙ, мавжудини қайтарамиз (қайта чоп).
  if (ticketId) {
    const prev = (
      await tx
        .select({ id: kitchenTickets.id, createdAt: kitchenTickets.createdAt })
        .from(kitchenTickets)
        .where(eq(kitchenTickets.id, ticketId))
        .limit(1)
    )[0];
    if (prev) {
      const prevItems = await tx
        .select({ name: kitchenTicketItems.name, qty: kitchenTicketItems.qty, station: kitchenTicketItems.station })
        .from(kitchenTicketItems)
        .where(eq(kitchenTicketItems.ticketId, prev.id));
      return {
        id: prev.id,
        createdAt: prev.createdAt,
        items: prevItems.map((it) => ({ name: it.name, qty: it.qty, station: it.station ?? "Бошқа" })),
      };
    }
  }

  const toSend = await computeUnsentItems(tx, orderId);
  if (toSend.length === 0) return null;

  const ticket = (
    await tx
      .insert(kitchenTickets)
      .values({ ...(ticketId ? { id: ticketId } : {}), orderId, createdById })
      .returning({ id: kitchenTickets.id, createdAt: kitchenTickets.createdAt })
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

// Recipe-based stock write-off for an order's items — shared by pos.close
// (moveType="sale_writeoff", full qty) and pos.cancel (moveType="loss",
// qtyOverride = only the already-kitchen-sent portion per product — food
// that was actually cooked/wasted, not the whole never-prepared order).
async function computeOrderStockMoves(
  exec: { select: typeof db.select },
  orderId: string,
  createdById: string,
  moveType: "sale_writeoff" | "loss",
  qtyOverride?: Map<string, number>,
) {
  const carc = await exec
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(inArray(products.name, ["Мол лаҳм", "Қўй лаҳм"]))
    .orderBy(products.createdAt);
  const molId = carc.find((c) => c.name === "Мол лаҳм")?.id ?? null;
  const qoyId = carc.find((c) => c.name === "Қўй лаҳм")?.id ?? null;

  // product type/unit lookup — only deduct stock-leaf, non-dona components (in grams)
  const prodMap = new Map(
    (
      await exec
        .select({ id: products.id, type: products.type, unit: products.unit })
        .from(products)
    ).map((p) => [p.id, p]),
  );

  const items = await exec
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
    .where(eq(orderItems.orderId, orderId));

  const moves: (typeof stockMovements.$inferInsert)[] = [];
  const skippedNames = new Set<string>();

  for (const it of items) {
    const qty = qtyOverride ? qtyOverride.get(it.productId ?? "") ?? 0 : it.qty;
    if (qty <= 0) continue;
    if (!it.productId) {
      skippedNames.add(it.name);
      continue;
    }
    if (it.ptype === "goods") {
      // goods are sold per piece; only deduct dona-unit goods (native count)
      if (it.punit === "dona")
        moves.push({
          productId: it.productId,
          type: moveType,
          qty: -qty,
          unit: "dona",
          refType: "order",
          refId: orderId,
          createdById,
        });
      else skippedNames.add(it.name);
      continue;
    }
    if (it.soldByWeight) {
      skippedNames.add(it.name);
      continue;
    }
    const rec = (
      await exec
        .select({ id: recipes.id })
        .from(recipes)
        .where(eq(recipes.productId, it.productId))
        .limit(1)
    )[0];
    if (!rec) {
      skippedNames.add(it.name);
      continue;
    }
    const ris = await exec.select().from(recipeItems).where(eq(recipeItems.recipeId, rec.id));
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
          type: moveType,
          qty: -(ri.qtyG * qty),
          unit: "g",
          refType: "order",
          refId: orderId,
          note: ri.componentName,
          createdById,
        });
      else skippedNames.add(ri.componentName);
    }
  }
  return { moves, skippedNames };
}

// ── Принтер уланиш helper'лари (fire-and-forget, тx'дан ТАШҚАРИ чақирилади) ──
const BAR_STATION = "BAR";

async function stationIpMap(): Promise<Map<string, string | null>> {
  const rows = await db.select({ name: stations.name, ip: stations.ip }).from(stations);
  return new Map(rows.map((r) => [r.name, r.ip]));
}

const BRAND_PRINT = {
  name: "La Limonariya",
  city: "Навоий",
  phone: "+998 95 429 36 34",
};

// Кухня тикетини принтерларга юбориш — заказ ёпилишини блокламайди. Бутун тана
// try/catch'да: DB/net хатоси ҳеч қачон unhandled rejection бўлмасин (API crash).
async function firePrintKitchen(
  orderId: string,
  items: { name: string; qty: number; station: string | null }[],
): Promise<void> {
  try {
    if (items.length === 0) return;
    const meta = (
      await db
        .select({ hall: halls.name, tableNo: orders.tableNo, createdAt: orders.createdAt })
        .from(orders)
        .leftJoin(halls, eq(orders.hallId, halls.id))
        .where(eq(orders.id, orderId))
        .limit(1)
    )[0];
    if (!meta) return;
    const ipMap = await stationIpMap();
    printKitchenTicket(
      meta,
      items.map((it) => ({ name: it.name, qty: it.qty, station: it.station ?? "Бошқа" })),
      ipMap,
    );
  } catch (e) {
    console.error("[print] firePrintKitchen:", e instanceof Error ? e.message : e);
  }
}

// Мижоз чекини BAR принтерига — заказ ёпилишини блокламайди (try/catch билан).
async function firePrintCheck(orderId: string): Promise<void> {
  try {
    const head = (
      await db
        .select({
          checkNo: orders.id,
          tableNo: orders.tableNo,
          servicePct: orders.servicePct,
          createdAt: orders.createdAt,
          isComp: orders.isComp,
          compReason: orders.compReason,
          discountAmount: orders.discountAmount,
          hall: halls.name,
          waiter: users.name,
        })
        .from(orders)
        .leftJoin(halls, eq(orders.hallId, halls.id))
        .leftJoin(users, eq(orders.waiterId, users.id))
        .where(eq(orders.id, orderId))
        .limit(1)
    )[0];
    if (!head) return;
    const items = await db
      .select({ name: orderItems.name, price: orderItems.price, qty: orderItems.qty })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    const pays = await db
      .select({ method: orderPayments.method, amount: orderPayments.amount })
      .from(orderPayments)
      .where(eq(orderPayments.orderId, orderId));
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const service = Math.round((subtotal * head.servicePct) / 100);
    const barIp = (await stationIpMap()).get(BAR_STATION) ?? null;
    const check: CheckData = {
      brandName: BRAND_PRINT.name,
      brandCity: BRAND_PRINT.city,
      brandPhone: BRAND_PRINT.phone,
      checkNo: head.checkNo.slice(0, 5).toUpperCase(),
      hall: head.hall,
      tableNo: head.tableNo,
      waiter: head.waiter,
      createdAt: head.createdAt,
      isComp: head.isComp,
      compReason: head.compReason,
      items,
      subtotal,
      service,
      servicePct: head.servicePct,
      discount: head.discountAmount,
      total: subtotal + service - head.discountAmount,
      payments: pays,
    };
    printCheck(check, barIp);
  } catch (e) {
    console.error("[print] firePrintCheck:", e instanceof Error ? e.message : e);
  }
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
        const now = Date.now();
        const ip = clientIp(ctx.c);
        const blockedMs = loginBlockedFor(ip, now);
        if (blockedMs > 0) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `Кўп марта нотўғри. ${Math.ceil(blockedMs / 1000)} сония кутинг.`,
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
          recordLoginFail(ip, now);
          throw new TRPCError({ code: "UNAUTHORIZED", message: "PIN noto'g'ri" });
        }
        recordLoginSuccess(ip);

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

    create: directorProcedure
      .input(
        z.object({
          name: z.string().trim().min(1),
          role: z.enum(["director", "manager", "buyer", "cashier", "waiter"]),
        }),
      )
      .mutation(async ({ input }) => {
        const row = (
          await db
            .insert(users)
            .values({ name: input.name, role: input.role })
            .returning({ id: users.id })
        )[0];
        return { id: row?.id };
      }),

    update: directorProcedure
      .input(
        z.object({
          userId: z.string().uuid(),
          name: z.string().trim().min(1).optional(),
          role: z.enum(["director", "manager", "buyer", "cashier", "waiter"]).optional(),
          active: z.boolean().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const { userId, ...patch } = input;
        if (Object.keys(patch).length === 0) return { ok: true };
        await db.update(users).set(patch).where(eq(users.id, userId));
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
              hasRecipe: sql<boolean>`exists (select 1 from ${recipes} where ${recipes.productId} = ${products.id})`,
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
            gramNorm: z.number().int().positive().nullable().optional(),
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
                gramNorm: input.gramNorm ?? null,
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
            gramNorm: z.number().int().positive().nullable().optional(),
            active: z.boolean().optional(),
          }),
        )
        .mutation(async ({ input }) => {
          const { id, ...patch } = input;
          if (Object.keys(patch).length === 0) return { ok: true };
          await db.update(products).set(patch).where(eq(products.id, id));
          return { ok: true };
        }),

      get: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .query(async ({ input }) => {
          const row = (
            await db
              .select({
                id: products.id,
                name: products.name,
                type: products.type,
                unit: products.unit,
                price: products.price,
                costPrice: products.costPrice,
                soldByWeight: products.soldByWeight,
                gramNorm: products.gramNorm,
                active: products.active,
                categoryId: products.categoryId,
                stationId: products.stationId,
                category: categories.name,
                station: stations.name,
                hasRecipe: sql<boolean>`exists (select 1 from ${recipes} where ${recipes.productId} = ${products.id})`,
              })
              .from(products)
              .leftJoin(categories, eq(products.categoryId, categories.id))
              .leftJoin(stations, eq(products.stationId, stations.id))
              .where(eq(products.id, input.id))
              .limit(1)
          )[0];
          return row ?? null;
        }),
    }),

    stations: protectedProcedure.query(async () => {
      return db
        .select({ id: stations.id, name: stations.name, ip: stations.ip })
        .from(stations)
        .orderBy(stations.name);
    }),

    // Станция принтери IP'сини созлаш (директор). null = принтер йўқ.
    setStationIp: directorProcedure
      .input(
        z.object({
          stationId: z.string().uuid(),
          ip: z
            .string()
            .trim()
            .regex(/^(\d{1,3}\.){3}\d{1,3}$/, "IP формати нотўғри")
            .nullable(),
        }),
      )
      .mutation(async ({ input }) => {
        await db
          .update(stations)
          .set({ ip: input.ip })
          .where(eq(stations.id, input.stationId));
        return { ok: true };
      }),

    // Products usable as tech-card lines: raw + carcass parts + semi-finished.
    components: protectedProcedure.query(async () => {
      return db
        .select({ id: products.id, name: products.name, unit: products.unit, type: products.type })
        .from(products)
        .where(
          and(eq(products.active, true), inArray(products.type, ["ingredient", "part", "semi"])),
        )
        .orderBy(products.type, products.name);
    }),

    recipeForProduct: protectedProcedure
      .input(z.object({ productId: z.string().uuid() }))
      .query(async ({ input }) => {
        const head = (
          await db
            .select({ id: recipes.id, yieldG: recipes.yieldG })
            .from(recipes)
            .where(eq(recipes.productId, input.productId))
            .limit(1)
        )[0];
        if (!head) return null;
        const items = await db
          .select({
            componentId: recipeItems.componentId,
            componentName: recipeItems.componentName,
            qtyG: recipeItems.qtyG,
          })
          .from(recipeItems)
          .where(eq(recipeItems.recipeId, head.id))
          .orderBy(recipeItems.sort);
        return { yieldG: head.yieldG, items };
      }),

    recipeUpsert: directorProcedure
      .input(
        z.object({
          productId: z.string().uuid(),
          yieldG: z.number().int().positive().nullable().optional(),
          items: z
            .array(
              z
                .object({
                  componentId: z.string().uuid().optional(),
                  componentName: z.string().trim().min(1).optional(),
                  qtyG: z.number().int().positive(),
                })
                .refine((it) => !!it.componentId || !!it.componentName, {
                  message: "component required",
                }),
            )
            .min(1),
        }),
      )
      .mutation(async ({ input }) => {
        return db.transaction(async (tx) => {
          const p = (
            await tx
              .select({ id: products.id, name: products.name })
              .from(products)
              .where(eq(products.id, input.productId))
              .limit(1)
          )[0];
          if (!p) throw new TRPCError({ code: "NOT_FOUND" });
          const ids = input.items
            .map((i) => i.componentId)
            .filter((x): x is string => !!x);
          const comps = ids.length
            ? await tx
                .select({ id: products.id, name: products.name })
                .from(products)
                .where(inArray(products.id, ids))
            : [];
          const nameById = new Map(comps.map((c) => [c.id, c.name]));
          let recipeId = (
            await tx
              .select({ id: recipes.id })
              .from(recipes)
              .where(eq(recipes.productId, input.productId))
              .limit(1)
          )[0]?.id;
          if (recipeId) {
            await tx
              .update(recipes)
              .set({ name: p.name, yieldG: input.yieldG ?? null })
              .where(eq(recipes.id, recipeId));
            await tx.delete(recipeItems).where(eq(recipeItems.recipeId, recipeId));
          } else {
            recipeId = (
              await tx
                .insert(recipes)
                .values({ productId: p.id, name: p.name, yieldG: input.yieldG ?? null })
                .returning({ id: recipes.id })
            )[0]!.id;
          }
          await tx.insert(recipeItems).values(
            input.items.map((it, i) => ({
              recipeId: recipeId!,
              componentId: it.componentId ?? null,
              componentName: it.componentId
                ? nameById.get(it.componentId) ?? it.componentName ?? "—"
                : it.componentName ?? "—",
              qtyG: it.qtyG,
              sort: i,
            })),
          );
          return { ok: true };
        });
      }),

    recipes: protectedProcedure.query(async () => {
      return db
        .select({
          id: recipes.id,
          name: recipes.name,
          kind: recipes.kind,
          category: recipes.category,
          yieldG: recipes.yieldG,
          productId: recipes.productId,
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
      .input(z.object({ carcassType: z.enum(["qoy", "mol"]) }))
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

    // Обвалкани расмий харидга улаш учун — сўнгги харидлар рўйхати (менежер
    // танлайди). Гўшт харидда product сифатида сақланмайди, шунинг учун барча
    // сўнгги харид кўрсатилади; аллақачон уланганлари белгиланади.
    purchases: protectedProcedure.query(async () => {
      const rows = await db
        .select({
          id: purchases.id,
          supplier: purchases.supplier,
          total: purchases.total,
          createdAt: purchases.createdAt,
          linkedId: obvalka.id,
        })
        .from(purchases)
        .leftJoin(obvalka, eq(obvalka.purchaseId, purchases.id))
        .orderBy(desc(purchases.createdAt))
        .limit(30);
      return rows.map((r) => ({
        id: r.id,
        supplier: r.supplier,
        total: r.total,
        createdAt: r.createdAt,
        alreadyLinked: r.linkedId != null,
      }));
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
          carcassType: z.enum(["qoy", "mol"]),
          weightG: z.number().int().positive(),
          pricePerKg: z.number().int().nonnegative(),
          supplier: z.string().optional(),
          note: z.string().optional(),
          purchaseId: z.string().uuid().optional(),
          shortReason: z.string().optional(),
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
          // Бир харид = бир обвалка (тасдиқланган модель): агар шу харид
          // аллақачон бошқа обвалкага уланган бўлса — рад этамиз.
          if (input.purchaseId) {
            const dup = (
              await tx
                .select({ id: obvalka.id })
                .from(obvalka)
                .where(eq(obvalka.purchaseId, input.purchaseId))
                .limit(1)
            )[0];
            if (dup)
              throw new TRPCError({
                code: "CONFLICT",
                message: "Бу харид аллақачон обвалкага уланган",
              });
          }
          let row;
          try {
            row = (
              await tx
                .insert(obvalka)
                .values({
                  carcassType: input.carcassType,
                  weightG: input.weightG,
                  pricePerKg: input.pricePerKg,
                  supplier: input.supplier ?? null,
                  note: input.note ?? null,
                  purchaseId: input.purchaseId ?? null,
                  shortReason: input.shortReason ?? null,
                  createdById: ctx.user.id,
                })
                .returning()
            )[0];
          } catch (e) {
            // partial unique index (obvalka_purchase_uq) — race'да иккинчиси
            if (e && typeof e === "object" && "code" in e && e.code === "23505")
              throw new TRPCError({ code: "CONFLICT", message: "Бу харид аллақачон обвалкага уланган" });
            throw e;
          }
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
            input.carcassType === "mol" ? "Мол лаҳм" : "Қўй лаҳм";
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

  // Маринад партияси (M3): хом лаҳм омбордан чиқади, маринадланган гўшт чиқади.
  // Сих грамм-оқма сигнали шу партиялардан ҳисобланади (computeSignals.grammLeak).
  marinade: router({
    create: managerProcedure
      .input(
        z.object({
          carcassType: z.enum(["qoy", "mol"]),
          rawG: z.number().int().positive(),
          growthPct: z.number().int().min(0).max(50),
          note: z.string().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const marinatedG = Math.round(input.rawG * (1 + input.growthPct / 100));
        // ДИҚҚАТ: маринад омбордан ЛАҲМ ЧИҚАРМАЙДИ. Лаҳм pooled product сифатида
        // фақат сотувда (sale_writeoff, рецепт лаҳм hint орқали) камаяди — маринадда
        // ҳам чиқарсак ИККИ БОРА камаяди (омбор бузилади). Партия ёзуви faqat
        // грамм-оқма сигнали учун (marinatedG vs сотилган сих).
        const batch = (
          await db
            .insert(marinadeBatches)
            .values({
              carcassType: input.carcassType,
              rawG: input.rawG,
              growthPct: input.growthPct,
              marinatedG,
              note: input.note ?? null,
              createdById: ctx.user.id,
            })
            .returning({ id: marinadeBatches.id })
        )[0];
        if (!batch) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        return { id: batch.id, marinatedG };
      }),

    list: protectedProcedure.query(async () => {
      return db
        .select({
          id: marinadeBatches.id,
          carcassType: marinadeBatches.carcassType,
          rawG: marinadeBatches.rawG,
          growthPct: marinadeBatches.growthPct,
          marinatedG: marinadeBatches.marinatedG,
          createdAt: marinadeBatches.createdAt,
        })
        .from(marinadeBatches)
        .orderBy(desc(marinadeBatches.createdAt))
        .limit(50);
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

      const recentVoids = await db
        .select({
          id: voidedItems.id,
          orderId: voidedItems.orderId,
          name: voidedItems.name,
          qty: voidedItems.qty,
          note: voidedItems.note,
          createdAt: voidedItems.createdAt,
          performedByName: users.name,
        })
        .from(voidedItems)
        .leftJoin(users, eq(users.id, voidedItems.performedById))
        .orderBy(desc(voidedItems.createdAt))
        .limit(10);

      // Чегирма журнали (ким берди — closedById): сохта чегирма назорати №12.
      const recentDiscounts = await db
        .select({
          id: orders.id,
          amount: orders.discountAmount,
          reason: orders.discountReason,
          closedAt: orders.closedAt,
          performedByName: users.name,
        })
        .from(orders)
        .leftJoin(users, eq(users.id, orders.closedById))
        .where(and(eq(orders.status, "closed"), gt(orders.discountAmount, 0)))
        .orderBy(desc(orders.closedAt))
        .limit(10);

      return { meatCost, catalog, recipeCount, recentObvalka, thinDishes, recentVoids, recentDiscounts };
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

    tables: protectedProcedure.query(async () => {
      return db
        .select({
          id: tables.id,
          hallId: tables.hallId,
          name: tables.name,
          sort: tables.sort,
        })
        .from(tables)
        .where(eq(tables.active, true))
        .orderBy(tables.sort);
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
          hallId: orders.hallId,
          guests: orders.guests,
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
              discountAmount: orders.discountAmount,
              discountReason: orders.discountReason,
              guests: orders.guests,
              note: orders.note,
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
        z.object({
          // Клиент id беради → флаки тармоқ/offline retry дубль заказ яратмайди
          // (идемпотент). Берилмаса — сервер яратади (эски мижоз мослиги).
          id: z.string().uuid().optional(),
          hallId: z.string().uuid(),
          tableNo: z.string().optional(),
          guests: z.number().int().positive().max(999).optional(),
          note: z.string().max(500).optional(),
        }),
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
              ...(input.id ? { id: input.id } : {}),
              hallId: hall.id,
              tableNo: input.tableNo ?? null,
              guests: input.guests ?? null,
              note: input.note?.trim() || null,
              waiterId: ctx.user.id,
              servicePct: hall.servicePct,
            })
            .onConflictDoNothing()
            .returning()
        )[0];
        if (row) return { id: row.id };
        // Конфликт = ўша client id билан такрорий сўров → мавжудини қайтарамиз.
        if (input.id) {
          const existing = (
            await db
              .select({ id: orders.id })
              .from(orders)
              .where(eq(orders.id, input.id))
              .limit(1)
          )[0];
          if (existing) return { id: existing.id };
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      }),

    updateMeta: protectedProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          guests: z.number().int().nonnegative().max(999).optional(),
          note: z.string().max(500).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const patch: { guests?: number | null; note?: string | null } = {};
        if (input.guests !== undefined) patch.guests = input.guests || null;
        if (input.note !== undefined) patch.note = input.note.trim() || null;
        if (Object.keys(patch).length === 0) return { ok: true };
        const done = await db
          .update(orders)
          .set(patch)
          .where(and(eq(orders.id, input.id), eq(orders.status, "open")))
          .returning({ id: orders.id });
        if (!done.length) throw new TRPCError({ code: "NOT_FOUND" });
        return { ok: true };
      }),

    // Стол кўчириш: очиқ заказни бошқа зал/столга. servicePct янги залдан олинади.
    moveTable: protectedProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          hallId: z.string().uuid(),
          tableNo: z.string().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const hall = (
          await db.select().from(halls).where(eq(halls.id, input.hallId)).limit(1)
        )[0];
        if (!hall) throw new TRPCError({ code: "NOT_FOUND", message: "Зал топилмади" });
        const done = await db
          .update(orders)
          .set({ hallId: hall.id, tableNo: input.tableNo ?? null, servicePct: hall.servicePct })
          .where(and(eq(orders.id, input.id), eq(orders.status, "open")))
          .returning({ id: orders.id });
        if (!done.length) throw new TRPCError({ code: "NOT_FOUND", message: "Очиқ заказ топилмади" });
        return { ok: true };
      }),

    // Заказларни бирлаштириш: from → to. Итемлар (қиймати бирлашади) ва кухня
    // тикетлари to'га кўчади; from "cancelled" бўлади (ўчирилмайди → аудит,
    // cascade хавфи йўқ). Иккиси ҳам очиқ бўлиши шарт. Менежер/директор.
    mergeOrders: managerProcedure
      .input(z.object({ fromId: z.string().uuid(), toId: z.string().uuid() }))
      .mutation(async ({ input }) => {
        if (input.fromId === input.toId)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Бир хил заказ" });
        return db.transaction(async (tx) => {
          const [lockA, lockB] = [input.fromId, input.toId].sort();
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockA}))`);
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockB}))`);

          // FOR UPDATE — параллел pos.close заказ қаторини қулфлаб турсин
          // (мерге тугагунча ёпилмасин → item йўқолмасин).
          const both = await tx
            .select({ id: orders.id, status: orders.status })
            .from(orders)
            .where(inArray(orders.id, [input.fromId, input.toId]))
            .for("update");
          if (both.length !== 2 || both.some((o) => o.status !== "open"))
            throw new TRPCError({ code: "BAD_REQUEST", message: "Иккала заказ ҳам очиқ бўлиши шарт" });

          const fromItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, input.fromId));
          const toItems = await tx.select().from(orderItems).where(eq(orderItems.orderId, input.toId));
          const toByProduct = new Map(
            toItems.filter((i) => i.productId).map((i) => [i.productId, i]),
          );
          for (const fi of fromItems) {
            const match = fi.productId ? toByProduct.get(fi.productId) : undefined;
            if (match) {
              await tx.update(orderItems).set({ qty: match.qty + fi.qty }).where(eq(orderItems.id, match.id));
              await tx.delete(orderItems).where(eq(orderItems.id, fi.id));
            } else {
              await tx.update(orderItems).set({ orderId: input.toId }).where(eq(orderItems.id, fi.id));
            }
          }
          // Кухня тикетлари to'га (юборилган-миқдор назорати ҳам кўчади).
          await tx.update(kitchenTickets).set({ orderId: input.toId }).where(eq(kitchenTickets.orderId, input.fromId));
          // from — бўш cancelled шелл (ўчирилмайди: cascade йўқ, аудит қолади).
          await tx
            .update(orders)
            .set({ status: "cancelled", closedAt: new Date(), note: `Бирлаштирилди → ${input.toId.slice(0, 5).toUpperCase()}` })
            .where(eq(orders.id, input.fromId));
          return { ok: true };
        });
      }),

    addItem: protectedProcedure
      .input(
        z.object({
          orderId: z.string().uuid(),
          productId: z.string().uuid(),
          delta: z.number().int(),
          // Клиент op-id → offline/retry replay delta'ни икки марта қўлламайди.
          opId: z.string().uuid().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        // Serialize concurrent adds of the SAME product to one order (rapid
        // double-taps) so they merge into one row instead of racing two inserts.
        return db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`${input.orderId}:${input.productId}`}))`,
          );
          // Идемпотентлик: op-id аллақачон қўлланган бўлса — skip (delta дубль эмас).
          if (input.opId) {
            const fresh = await tx
              .insert(clientOps)
              .values({ opId: input.opId })
              .onConflictDoNothing()
              .returning({ opId: clientOps.opId });
            if (fresh.length === 0) return { ok: true };
          }
          const existing = (
            await tx
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
            if (input.delta < 0) {
              // "Ўчирилган таом" гейти: агар бу камайтириш кухняга аллақачон
              // юборилган (пиширилган/берилган) миқдорга тегса — director/
              // manager рухсати ва журнал ёзуви шарт. Send'дан олдинги оддий
              // таҳрир (waiter ҳали юбормаган) эркин, гейтланмайди.
              const sentRow = (
                await tx
                  .select({ s: sql<number>`coalesce(sum(${kitchenTicketItems.qty}), 0)` })
                  .from(kitchenTicketItems)
                  .innerJoin(kitchenTickets, eq(kitchenTicketItems.ticketId, kitchenTickets.id))
                  .where(
                    and(
                      eq(kitchenTickets.orderId, input.orderId),
                      eq(kitchenTicketItems.productId, input.productId),
                      gte(kitchenTickets.createdAt, existing.createdAt),
                    ),
                  )
              )[0];
              const sentQty = Number(sentRow?.s ?? 0);
              if (qty < sentQty) {
                if (!["director", "manager"].includes(ctx.user.role))
                  throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "Кухняга юборилган таомни фақат директор/менежер камайтира олади",
                  });
                await tx.insert(voidedItems).values({
                  orderId: input.orderId,
                  productId: input.productId,
                  name: existing.name,
                  qty: existing.qty - Math.max(qty, 0),
                  performedById: ctx.user.id,
                });
              }
            }
            if (qty <= 0)
              await tx.delete(orderItems).where(eq(orderItems.id, existing.id));
            else
              await tx
                .update(orderItems)
                .set({ qty })
                .where(eq(orderItems.id, existing.id));
          } else if (input.delta > 0) {
            const p = (
              await tx
                .select()
                .from(products)
                .where(eq(products.id, input.productId))
                .limit(1)
            )[0];
            if (!p) throw new TRPCError({ code: "NOT_FOUND" });
            await tx.insert(orderItems).values({
              orderId: input.orderId,
              productId: p.id,
              name: p.name,
              price: p.price,
              qty: input.delta,
            });
          }
          return { ok: true };
        });
      }),

    sendToKitchen: protectedProcedure
      .input(
        z.object({
          orderId: z.string().uuid(),
          // Клиент ticketId → offline/retry replay икки марта кухняга юбормайди.
          ticketId: z.string().uuid().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const ticket = await db.transaction(async (tx) => {
          return flushKitchenTicket(tx, input.orderId, ctx.user.id, input.ticketId);
        });
        // тx COMMIT'дан кейин — принтерга (net I/O тx ушламасин, блокламасин)
        if (ticket) void firePrintKitchen(input.orderId, ticket.items);
        return ticket ?? { id: null, createdAt: null, items: [] };
      }),

    // Принтер ўчиб қолган бўлса — мавжуд тикетни/чекни қайта чоп.
    reprintTicket: protectedProcedure
      .input(z.object({ ticketId: z.string().uuid() }))
      .mutation(async ({ input }) => {
        const head = (
          await db
            .select({ orderId: kitchenTickets.orderId })
            .from(kitchenTickets)
            .where(eq(kitchenTickets.id, input.ticketId))
            .limit(1)
        )[0];
        if (!head) throw new TRPCError({ code: "NOT_FOUND" });
        const items = await db
          .select({ name: kitchenTicketItems.name, qty: kitchenTicketItems.qty, station: kitchenTicketItems.station })
          .from(kitchenTicketItems)
          .where(eq(kitchenTicketItems.ticketId, input.ticketId));
        void firePrintKitchen(head.orderId, items);
        return { ok: true };
      }),

    reprintCheck: protectedProcedure
      .input(z.object({ orderId: z.string().uuid() }))
      .mutation(async ({ input }) => {
        void firePrintCheck(input.orderId);
        return { ok: true };
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

    close: cashierProcedure
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
          customerId: z.string().uuid().optional(),
          comp: z.object({ reason: z.string().trim().min(1) }).optional(),
          discount: z
            .object({ amount: z.number().int().positive(), reason: z.string().trim().min(1) })
            .optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const pays = (input.payments ?? []).filter((p) => p.amount > 0);
        // Multi-tender: ҳар усул фақат бир марта (қарз рўйхати ва payGuestDebt
        // бир заказда битта debt қаторни кутади — иккита бўлса ledger бузилади).
        if (new Set(pays.map((p) => p.method)).size !== pays.length)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Ҳар тўлов тури фақат бир марта",
          });
        // Қарз танланса мижоз МАЖБУРИЙ (kim qarzdor — running-balans uchun).
        const hasDebt = pays.some((p) => p.method === "debt");
        if (hasDebt && !input.customerId)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Қарзга ёпишда мижоз танланг",
          });
        // Чегирма — фақат директор/менежер, comp билан бирга эмас (текин=бепул).
        if (input.discount) {
          if (!["director", "manager"].includes(ctx.user.role))
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Чегирма фақат директор/менежер",
            });
          if (input.comp)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Текин заказга чегирма қўшиб бўлмайди",
            });
        }
        if (input.comp) {
          if (!["director", "manager", "cashier"].includes(ctx.user.role))
            throw new TRPCError({ code: "FORBIDDEN" });
          if (pays.length)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Текин заказга тўлов қўшиб бўлмайди",
            });
        }
        const result = await db.transaction(async (tx) => {
          const head = (
            await tx
              .select({ status: orders.status, servicePct: orders.servicePct })
              .from(orders)
              .where(eq(orders.id, input.id))
              .limit(1)
          )[0];
          if (!head) throw new TRPCError({ code: "NOT_FOUND" });
          if (head.status === "cancelled")
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Бекор қилинган заказни ёпиб бўлмайди",
            });
          if (head.status === "closed")
            return { ok: true, alreadyClosed: true, deducted: 0, skipped: 0 };

          // МАЖБУРИЙ: чек тўлов турисиз/нотўғри сумма билан ёпилмайди — тушум
          // яширилмаслиги учун (comp'дан ташқари, унда pays.length=0 юқорида
          // текширилган). Total клиентдан эмас, шу ерда, жойида ҳисобланади.
          if (!input.comp) {
            const items = await tx
              .select({ price: orderItems.price, qty: orderItems.qty })
              .from(orderItems)
              .where(eq(orderItems.orderId, input.id));
            const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
            const total = subtotal + Math.round((subtotal * head.servicePct) / 100);
            const discount = input.discount?.amount ?? 0;
            if (discount > total)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Чегирма (${discount}) чек жамидан (${total}) катта`,
              });
            const paid = pays.reduce((s, p) => s + p.amount, 0);
            if (paid !== total - discount)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Тўлов суммаси (${paid}) чек жамига (${total - discount}) тенг эмас.`,
              });
          }

          // Idempotent: only the tx that flips open→closed writes payments + списание.
          const flipped = await tx
            .update(orders)
            .set({
              status: "closed",
              closedAt: new Date(),
              closedById: ctx.user.id,
              ...(hasDebt ? { customerId: input.customerId } : {}),
              ...(input.comp ? { isComp: true, compReason: input.comp.reason } : {}),
              ...(input.discount
                ? { discountAmount: input.discount.amount, discountReason: input.discount.reason }
                : {}),
            })
            .where(and(eq(orders.id, input.id), eq(orders.status, "open")))
            .returning({ id: orders.id });
          if (flipped.length === 0)
            return { ok: true, alreadyClosed: true, deducted: 0, skipped: 0 };

          // safety net: ticket anything the waiter forgot to send before closing
          // ("тикетсиз таом ЙЎҚ" must hold even for fast/closed-without-send orders)
          const flushed = await flushKitchenTicket(tx, input.id, ctx.user.id);

          // текин/ходим: stock is still written off below (food was actually
          // served) — only revenue (payments) is skipped.
          if (pays.length && !input.comp)
            await tx
              .insert(orderPayments)
              .values(pays.map((p) => ({ orderId: input.id, ...p })));

          // Carcass meat balances (meat is tracked at carcass, not cut, level).
          const { moves, skippedNames } = await computeOrderStockMoves(
            tx,
            input.id,
            ctx.user.id,
            "sale_writeoff",
          );

          if (moves.length) await tx.insert(stockMovements).values(moves);
          return {
            ok: true,
            alreadyClosed: false,
            deducted: moves.length,
            skipped: skippedNames.size,
            skippedNames: [...skippedNames].slice(0, 12),
            flushedItems: flushed?.items ?? [],
          };
        });
        // тx COMMIT'дан кейин: юборилмай қолган таомлар кухняга + мижоз чеки
        // BAR принтерига (net I/O заказ жавобини блокламасин, fire-and-forget).
        if (!result.alreadyClosed) {
          void firePrintKitchen(input.id, result.flushedItems ?? []);
          void firePrintCheck(input.id);
        }
        return result;
      }),

    cancel: protectedProcedure
      .input(z.object({ id: z.string().uuid(), note: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        return db.transaction(async (tx) => {
          const head = (
            await tx
              .select({ status: orders.status })
              .from(orders)
              .where(eq(orders.id, input.id))
              .limit(1)
          )[0];
          if (!head) throw new TRPCError({ code: "NOT_FOUND" });
          if (head.status !== "open")
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Фақат очиқ заказни бекор қилиш мумкин",
            });

          const items = await tx
            .select({
              productId: orderItems.productId,
              name: orderItems.name,
              createdAt: orderItems.createdAt,
            })
            .from(orderItems)
            .where(eq(orderItems.orderId, input.id));

          // "пишган-лекин-бекор" (№6): faqat kuxnyaga allaqachon yuborilgan
          // (tayyorlangan/berilgan) miqdor yo'qotish sifatida yoziladi — hech
          // yuborilmagan qatorlar uchun ombor tegilmaydi (hech narsa isrof
          // bo'lmagan). sentQty hisobi computeUnsentItems bilan bir xil mantiq.
          const sentByProduct = new Map<string, number>();
          for (const it of items) {
            if (!it.productId) continue;
            const sentRow = (
              await tx
                .select({ s: sql<number>`coalesce(sum(${kitchenTicketItems.qty}), 0)` })
                .from(kitchenTicketItems)
                .innerJoin(kitchenTickets, eq(kitchenTicketItems.ticketId, kitchenTickets.id))
                .where(
                  and(
                    eq(kitchenTickets.orderId, input.id),
                    eq(kitchenTicketItems.productId, it.productId),
                    gte(kitchenTickets.createdAt, it.createdAt),
                  ),
                )
            )[0];
            const sentQty = Number(sentRow?.s ?? 0);
            if (sentQty > 0) sentByProduct.set(it.productId, sentQty);
          }

          if (sentByProduct.size > 0 && !["director", "manager"].includes(ctx.user.role))
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Пиширилган таомли заказни фақат директор/менежер бекор қила олади",
            });

          const { moves } = await computeOrderStockMoves(
            tx,
            input.id,
            ctx.user.id,
            "loss",
            sentByProduct,
          );
          if (moves.length) await tx.insert(stockMovements).values(moves);

          if (sentByProduct.size > 0) {
            const byName = new Map(items.map((it) => [it.productId, it.name]));
            await tx.insert(voidedItems).values(
              [...sentByProduct.entries()].map(([productId, qty]) => ({
                orderId: input.id,
                productId,
                name: byName.get(productId) ?? "?",
                qty,
                note: input.note ?? "буюртма бекор қилинди",
                performedById: ctx.user.id,
              })),
            );
          }

          await tx
            .update(orders)
            .set({ status: "cancelled", closedAt: new Date(), closedById: ctx.user.id })
            .where(eq(orders.id, input.id));

          return { ok: true, lossItems: sentByProduct.size };
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

    // Омбор ораси кўчириш (Локация): net-zero жуфт ҳаракат — from'дан −, to'га +.
    // Глобал қолдиққа таъсир қилмайди (икки музлаткич кунлик саноғи билан
    // реконсиляция қилинади), фақат ким-нима-қаердан-қаерга кўчирганини ёзади.
    transfer: managerProcedure
      .input(
        z.object({
          productId: z.string().uuid(),
          qty: z.number().positive(), // кўрсатиладиган бирликда (кг/дона/л)
          fromStorage: z.enum(STORAGES),
          toStorage: z.enum(STORAGES),
          note: z.string().trim().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (input.fromStorage === input.toStorage)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Бир хил омбор танланди" });

        const prod = (
          await db
            .select({ unit: products.unit })
            .from(products)
            .where(eq(products.id, input.productId))
            .limit(1)
        )[0];
        if (!prod) throw new TRPCError({ code: "NOT_FOUND", message: "Маҳсулот топилмади" });

        const factor = prod.unit === "kg" || prod.unit === "l" ? 1000 : 1;
        const base = Math.round(input.qty * factor);
        if (base <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Миқдор нотўғри" });
        const baseUnit =
          prod.unit === "dona" ? "dona" : prod.unit === "l" || prod.unit === "ml" ? "ml" : "g";

        // мавжуд глобал қолдиқдан кўп кўчириб бўлмайди
        const onHand = Number(
          (
            await db
              .select({ s: sql<number>`coalesce(sum(${stockMovements.qty}), 0)` })
              .from(stockMovements)
              .where(eq(stockMovements.productId, input.productId))
          )[0]?.s ?? 0,
        );
        if (base > onHand)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Қолдиқ етарли эмас (бор: ${onHand} ${baseUnit})`,
          });

        const refId = crypto.randomUUID();
        const label = `${input.fromStorage}→${input.toStorage}`;
        const note = input.note ? `${label} · ${input.note}` : label;
        await db.insert(stockMovements).values([
          {
            productId: input.productId,
            type: "transfer" as const,
            qty: -base,
            unit: baseUnit,
            storage: input.fromStorage,
            refType: "transfer",
            refId,
            note,
            createdById: ctx.user.id,
          },
          {
            productId: input.productId,
            type: "transfer" as const,
            qty: base,
            unit: baseUnit,
            storage: input.toStorage,
            refType: "transfer",
            refId,
            note,
            createdById: ctx.user.id,
          },
        ]);
        return { ok: true };
      }),

    // Брак/бузилди списание: маҳсулот бузилса ҳисобдан чиқариш (loss ҳаракати).
    spoilage: managerProcedure
      .input(
        z.object({
          productId: z.string().uuid(),
          qty: z.number().positive(),
          reason: z.string().trim().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const prod = (
          await db
            .select({ unit: products.unit })
            .from(products)
            .where(eq(products.id, input.productId))
            .limit(1)
        )[0];
        if (!prod) throw new TRPCError({ code: "NOT_FOUND", message: "Маҳсулот топилмади" });
        const factor = prod.unit === "kg" || prod.unit === "l" ? 1000 : 1;
        const base = Math.round(input.qty * factor);
        if (base <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Миқдор нотўғри" });
        const baseUnit =
          prod.unit === "dona" ? "dona" : prod.unit === "l" || prod.unit === "ml" ? "ml" : "g";
        await db.insert(stockMovements).values({
          productId: input.productId,
          type: "loss" as const,
          qty: -base,
          unit: baseUnit,
          refType: "spoilage",
          note: input.reason,
          createdById: ctx.user.id,
        });
        return { ok: true };
      }),

    // Ишлаб чиқариш: партия тайёрланганда хом-ашё чиқади (−), ярим-тайёр кирим (+).
    // Масалан Шапок → Фарш. Битта refId остида барча ҳаракат.
    produce: managerProcedure
      .input(
        z.object({
          outputProductId: z.string().uuid(),
          outputQty: z.number().positive(),
          inputs: z
            .array(z.object({ productId: z.string().uuid(), qty: z.number().positive() }))
            .min(1),
          note: z.string().trim().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const ids = [input.outputProductId, ...input.inputs.map((i) => i.productId)];
        const prods = await db
          .select({ id: products.id, unit: products.unit })
          .from(products)
          .where(inArray(products.id, ids));
        const unitOf = new Map(prods.map((p) => [p.id, p.unit]));
        const toBase = (
          id: string,
          qty: number,
        ): { base: number; baseUnit: "g" | "ml" | "dona" } | null => {
          const u = unitOf.get(id);
          if (!u) return null;
          const factor = u === "kg" || u === "l" ? 1000 : 1;
          const base = Math.round(qty * factor);
          const baseUnit: "g" | "ml" | "dona" =
            u === "dona" ? "dona" : u === "l" || u === "ml" ? "ml" : "g";
          return base > 0 ? { base, baseUnit } : null;
        };

        const out = toBase(input.outputProductId, input.outputQty);
        if (!out) throw new TRPCError({ code: "BAD_REQUEST", message: "Чиқиш маҳсулоти нотўғри" });

        const refId = crypto.randomUUID();
        const moves: (typeof stockMovements.$inferInsert)[] = [];
        for (const it of input.inputs) {
          const b = toBase(it.productId, it.qty);
          if (!b) throw new TRPCError({ code: "BAD_REQUEST", message: "Хом-ашё миқдори нотўғри" });
          moves.push({
            productId: it.productId,
            type: "production" as const,
            qty: -b.base,
            unit: b.baseUnit,
            refType: "production",
            refId,
            note: input.note ?? null,
            createdById: ctx.user.id,
          });
        }
        moves.push({
          productId: input.outputProductId,
          type: "production" as const,
          qty: out.base,
          unit: out.baseUnit,
          refType: "production",
          refId,
          note: input.note ?? null,
          createdById: ctx.user.id,
        });
        await db.insert(stockMovements).values(moves);
        return { ok: true };
      }),

    // Қўлда ҳаракатлар журнали: кўчириш, списание, ишлаб чиқариш, тузатиш —
    // refId бўйича гуруҳлаб (transfer/production кўп қаторли), директор кўради.
    journal: managerProcedure.query(async () => {
      const rows = await db
        .select({
          id: stockMovements.id,
          refId: stockMovements.refId,
          type: stockMovements.type,
          name: products.name,
          unit: stockMovements.unit,
          qty: stockMovements.qty,
          storage: stockMovements.storage,
          note: stockMovements.note,
          createdAt: stockMovements.createdAt,
          by: users.name,
        })
        .from(stockMovements)
        .leftJoin(products, eq(products.id, stockMovements.productId))
        .leftJoin(users, eq(users.id, stockMovements.createdById))
        .where(
          inArray(stockMovements.type, ["transfer", "loss", "production", "inventory_adjust"]),
        )
        .orderBy(desc(stockMovements.createdAt))
        .limit(200);

      type Line = { name: string; unit: string; qty: number; storage: string | null };
      type Group = {
        key: string;
        type: string;
        note: string | null;
        createdAt: Date;
        by: string | null;
        lines: Line[];
      };
      const byKey = new Map<string, Group>();
      const order: string[] = [];
      for (const r of rows) {
        const key = r.refId ?? r.id;
        let g = byKey.get(key);
        if (!g) {
          g = { key, type: r.type, note: r.note, createdAt: r.createdAt, by: r.by, lines: [] };
          byKey.set(key, g);
          order.push(key);
        }
        g.lines.push({ name: r.name ?? "?", unit: r.unit, qty: r.qty, storage: r.storage });
      }
      return order.slice(0, 50).map((k) => byKey.get(k) as Group);
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
              "boshqa",
              "ega_oldi",
            ]),
            amount: z.number().int().positive(),
            method: z.enum(["cash", "card", "click", "payme", "humo", "debt"]).optional(),
            recurring: z.boolean().optional(),
            note: z.string().optional(),
            staffId: z.string().uuid().optional(), // кунлик иш ҳақи — ходим
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
                staffId: input.staffId ?? null,
                spentAt,
                createdById: ctx.user.id,
              })
              .returning({ id: expenses.id })
          )[0];
          return { id: row?.id };
        }),

      // Кунлик иш ҳақи: актив ходимлар + бугун тўланган сумма (ish_haqi + staffId).
      wages: directorProcedure
        .input(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).optional())
        .query(async ({ input }) => {
          const { startUTC, endUTC, dayKey } = businessDayBounds(input?.day);
          const staff = await db
            .select({ id: users.id, name: users.name, role: users.role })
            .from(users)
            .where(eq(users.active, true))
            .orderBy(users.role, users.name);
          const paidRows = await db
            .select({ staffId: expenses.staffId, amount: expenses.amount })
            .from(expenses)
            .where(
              and(
                eq(expenses.category, "ish_haqi"),
                isNotNull(expenses.staffId),
                gte(expenses.spentAt, startUTC),
                lt(expenses.spentAt, endUTC),
              ),
            );
          const paidBy: Record<string, number> = {};
          for (const r of paidRows) if (r.staffId) paidBy[r.staffId] = (paidBy[r.staffId] ?? 0) + r.amount;
          const rows = staff.map((s) => ({ ...s, paidToday: paidBy[s.id] ?? 0 }));
          return { dayKey, rows, total: rows.reduce((a, r) => a + r.paidToday, 0) };
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
          customerId: orders.customerId,
          customerName: customers.name,
          customerPhone: customers.phone,
        })
        .from(orderPayments)
        .innerJoin(orders, eq(orderPayments.orderId, orders.id))
        .leftJoin(halls, eq(orders.hallId, halls.id))
        .leftJoin(customers, eq(customers.id, orders.customerId))
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

    customers: router({
      // Қарз танлаганда мижоз танлаш/яратиш учун — исм/тел бўйича қидириш.
      search: protectedProcedure
        .input(z.object({ query: z.string().optional() }))
        .query(async ({ input }) => {
          const q = input.query?.trim();
          const rows = await db
            .select({ id: customers.id, name: customers.name, phone: customers.phone })
            .from(customers)
            .where(
              q
                ? sql`${customers.name} ilike ${`%${q}%`} or ${customers.phone} ilike ${`%${q}%`}`
                : undefined,
            )
            .orderBy(customers.name)
            .limit(20);
          return rows;
        }),

      create: protectedProcedure
        .input(z.object({ name: z.string().trim().min(1), phone: z.string().trim().optional() }))
        .mutation(async ({ input, ctx }) => {
          if (!["director", "manager", "cashier"].includes(ctx.user.role))
            throw new TRPCError({ code: "FORBIDDEN" });
          const row = (
            await db
              .insert(customers)
              .values({ name: input.name, phone: input.phone || null })
              .returning({ id: customers.id })
          )[0];
          if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
          return { id: row.id };
        }),
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

    // №13 назорати: ёпилган чекдан қайтариш — фақат ишонган ролларга, журнал
    // сифатида (оригинал чек ўзгармайди, финанс ойнасидан refundTotal орқали
    // соф фойдадан чиқарилади — financeForWindow'га қаранг).
    refund: protectedProcedure
      .input(
        z.object({
          orderId: z.string().uuid(),
          amount: z.number().int().positive(),
          reason: z.string().trim().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (!["director", "manager", "cashier"].includes(ctx.user.role))
          throw new TRPCError({ code: "FORBIDDEN" });
        const order = (
          await db
            .select({ status: orders.status })
            .from(orders)
            .where(eq(orders.id, input.orderId))
            .limit(1)
        )[0];
        if (!order) throw new TRPCError({ code: "NOT_FOUND" });
        if (order.status !== "closed")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Фақат ёпилган чекни қайтариш мумкин",
          });
        await db.insert(refunds).values({
          orderId: input.orderId,
          amount: input.amount,
          reason: input.reason,
          performedById: ctx.user.id,
        });
        return { ok: true };
      }),

    refunds: protectedProcedure
      .input(z.object({ from: z.string(), to: z.string() }))
      .query(async ({ input }) => {
        const { startUTC, endUTC } = businessRangeBounds(input.from, input.to);
        const rows = await db
          .select({
            id: refunds.id,
            orderId: refunds.orderId,
            amount: refunds.amount,
            reason: refunds.reason,
            createdAt: refunds.createdAt,
            performedByName: users.name,
            checkNo: orders.id,
          })
          .from(refunds)
          .leftJoin(users, eq(users.id, refunds.performedById))
          .leftJoin(orders, eq(orders.id, refunds.orderId))
          .where(and(gte(refunds.createdAt, startUTC), lt(refunds.createdAt, endUTC)))
          .orderBy(desc(refunds.createdAt));
        return rows.map((r) => ({
          ...r,
          checkNo: r.checkNo ? r.checkNo.slice(0, 5).toUpperCase() : "—",
        }));
      }),

    // "Чек қидириш": берилган давр ичида ёпилган чеклар, checkNo/стол бўйича
    // қидириш билан. checkNo омборда сақланмайди (id'нинг биринчи 5 белгиси),
    // шунинг учун ҳисоблаб чиқилиб JS'да фильтрланади.
    searchOrders: protectedProcedure
      .input(z.object({ from: z.string(), to: z.string(), query: z.string().optional() }))
      .query(async ({ input }) => {
        const { startUTC, endUTC } = businessRangeBounds(input.from, input.to);
        const rows = await db
          .select({
            id: orders.id,
            tableNo: orders.tableNo,
            hall: halls.name,
            waiter: users.name,
            closedAt: orders.closedAt,
            isComp: orders.isComp,
            servicePct: orders.servicePct,
          })
          .from(orders)
          .leftJoin(halls, eq(orders.hallId, halls.id))
          .leftJoin(users, eq(orders.waiterId, users.id))
          .where(
            and(
              eq(orders.status, "closed"),
              gte(orders.closedAt, startUTC),
              lt(orders.closedAt, endUTC),
            ),
          )
          .orderBy(desc(orders.closedAt))
          .limit(200);

        const withTotal = await Promise.all(
          rows.map(async (r) => {
            const items = await db
              .select({ price: orderItems.price, qty: orderItems.qty })
              .from(orderItems)
              .where(eq(orderItems.orderId, r.id));
            const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
            const total = subtotal + Math.round((subtotal * r.servicePct) / 100);
            return {
              ...r,
              checkNo: r.id.slice(0, 5).toUpperCase(),
              total,
            };
          }),
        );

        const q = input.query?.trim().toLowerCase();
        const filtered = q
          ? withTotal.filter(
              (r) =>
                r.checkNo.toLowerCase().includes(q) ||
                (r.tableNo ?? "").toLowerCase().includes(q),
            )
          : withTotal;
        return filtered.slice(0, 100);
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
          const { cashRevenue, cashDebtRepaid, cashExpenses, cashCollected, expectedCash } =
            await expectedCashForWindow(startUTC, endUTC);
          const row = (
            await db
              .select({
                openedAt: tillCounts.openedAt,
                openedByName: users.name,
                countedCash: tillCounts.countedCash,
                closedAt: tillCounts.closedAt,
                note: tillCounts.note,
              })
              .from(tillCounts)
              .leftJoin(users, eq(users.id, tillCounts.openedById))
              .where(eq(tillCounts.dayKey, dayKey))
              .limit(1)
          )[0];
          return {
            dayKey,
            floatAmount: TILL_FLOAT,
            cashRevenue,
            cashDebtRepaid,
            cashExpenses,
            cashCollected,
            expectedCash,
            openedAt: row?.openedAt ?? null,
            openedByName: row?.openedByName ?? null,
            countedCash: row?.countedCash ?? null,
            closedAt: row?.closedAt ?? null,
            variance: row?.countedCash != null ? row.countedCash - expectedCash : null,
            note: row?.note ?? null,
          };
        }),

      // Смена очиш: кассир/директор PIN билан кириб куннинг бошланганини
      // қайд этади. Идемпотент — аллақачон очилган бўлса ўзгармайди.
      open: directorProcedure
        .input(
          z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).optional(),
        )
        .mutation(async ({ input, ctx }) => {
          const { dayKey } = businessDayBounds(input?.day);
          await db
            .insert(tillCounts)
            .values({ dayKey, openedAt: new Date(), openedById: ctx.user.id })
            .onConflictDoNothing({ target: tillCounts.dayKey });
          return { ok: true };
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
          const { dayKey, startUTC, endUTC } = businessDayBounds(input.day);
          const existing = (
            await db
              .select({ openedAt: tillCounts.openedAt })
              .from(tillCounts)
              .where(eq(tillCounts.dayKey, dayKey))
              .limit(1)
          )[0];
          if (!existing?.openedAt)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Аввал сменани очинг",
            });
          // МАЖБУРИЙ: кун инвентаризациясиз ЁПИЛМАЙДИ (SPEC §1.5) — шу бизнес-кун
          // ичида камида битта тасдиқланган саноқ бўлиши шарт.
          const approvedCount = (
            await db
              .select({ n: count() })
              .from(inventoryCounts)
              .where(
                and(
                  eq(inventoryCounts.status, "approved"),
                  gte(inventoryCounts.approvedAt, startUTC),
                  lt(inventoryCounts.approvedAt, endUTC),
                ),
              )
          )[0];
          if (!approvedCount || approvedCount.n === 0)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Кун ёпилмайди — аввал инвентаризацияни тасдиқланг",
            });
          await db
            .update(tillCounts)
            .set({
              countedCash: input.countedCash,
              closedAt: new Date(),
              ...(input.note !== undefined ? { note: input.note } : {}),
              createdById: ctx.user.id,
            })
            .where(eq(tillCounts.dayKey, dayKey));
          return { ok: true };
        }),
    }),

    // Инкассация: кун ичи кассадан нақд олиб сейфга ўтказиш — журнал, изоҳ
    // мажбурий (expectedCashForWindow'дан айирилади, сохта камомад чиқмасин).
    collectCash: protectedProcedure
      .input(z.object({ amount: z.number().int().positive(), note: z.string().trim().min(1) }))
      .mutation(async ({ input, ctx }) => {
        if (!["director", "manager"].includes(ctx.user.role))
          throw new TRPCError({ code: "FORBIDDEN" });
        await db.insert(cashCollections).values({
          amount: input.amount,
          note: input.note,
          performedById: ctx.user.id,
        });
        return { ok: true };
      }),

    cashCollections: directorProcedure
      .input(z.object({ from: z.string(), to: z.string() }))
      .query(async ({ input }) => {
        const { startUTC, endUTC } = businessRangeBounds(input.from, input.to);
        return db
          .select({
            id: cashCollections.id,
            amount: cashCollections.amount,
            note: cashCollections.note,
            createdAt: cashCollections.createdAt,
            performedByName: users.name,
          })
          .from(cashCollections)
          .leftJoin(users, eq(users.id, cashCollections.performedById))
          .where(
            and(gte(cashCollections.createdAt, startUTC), lt(cashCollections.createdAt, endUTC)),
          )
          .orderBy(desc(cashCollections.createdAt));
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
        // underDelivery қўшилмайди — ҳар кам-келтириш (lossPct>5) аллақачон
        // obvalkaFlags'да бор (balanceFlag=|lossPct|>5), икки бора саналмасин.
        sig.obvalkaFlags.length +
        sig.thinDishes.length +
        (sig.cashVariance && sig.cashVariance.variance !== 0 ? 1 : 0) +
        (sig.breakEvenFlag ? 1 : 0) +
        sig.priceSpikes.length +
        sig.shortagePattern.length +
        (sig.compFlag ? 1 : 0) +
        sig.staleOrders.length +
        sig.grammLeak.filter((g) => g.flag).length;

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
