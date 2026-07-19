import { and, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
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
  appMeta,
  assetMovements,
  assets,
  auditLog,
  cashCollections,
  customerWalletMovements,
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
  normChanges,
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
  reprintLog,
  reservations,
  sessions,
  skewerBatches,
  stations,
  stockMovements,
  tables,
  tillCounts,
  users,
  vitrinaCounts,
  voidedItems,
  waiterCalls,
} from "./db/schema";
import { computeObvalka } from "./obvalka-calc";
import {
  bandsFromCarcasses,
  intersectBand,
  NORM_MIN_SAMPLES,
  type CleanCarcass,
} from "./obvalka-norms";
import { logAudit } from "./audit";
import { bestMatch } from "./match";
import {
  type CheckData,
  printCheck,
  printKitchenTicket,
  printPrecheck,
} from "./printing/escpos";
import { sendTelegram, telegramEnabled } from "./telegram";
import { businessDayBounds, businessRangeBounds, previousDayKey } from "./time";
import {
  buildPurchaseForecast,
  humanizeGrammLeak,
  humanizePriceSpike,
  humanizeUnderDelivery,
  marginDropInsight,
  type DishMarginDay,
  type UnderDeliveryItem,
} from "./insights";
import { TRPCError } from "@trpc/server";
import {
  buyerProcedure,
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
export async function computeDishTaannarx(meatCost: {
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
      componentId: recipeItems.componentId,
      compUnit: products.unit,
      compCost: products.costPrice,
      compType: products.type,
    })
    .from(recipeItems)
    .leftJoin(products, eq(recipeItems.componentId, products.id));
  type RItem = {
    qtyG: number | null;
    stockHint: string | null;
    componentId: string | null;
    compUnit: string | null;
    compCost: number | null;
    compType: string | null;
  };
  const byRecipe = new Map<string, RItem[]>();
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
    // FULL taannarx: meat + every priced weight/volume component. Components we
    // can't value (name-only, dona-unit, dish/semi, or no costPrice yet) are
    // counted as "incomplete" so the margin is honestly flagged, never faked.
    let fullCostTotal = 0;
    let unpricedCount = 0;
    let hasComponents = false;
    for (const it of byRecipe.get(r.id) ?? []) {
      if (!it.qtyG) continue;
      hasComponents = true;
      const c = carcassOf(it.stockHint, r.category);
      if (c) {
        const cost = meatCost[c];
        if (cost) {
          meatCostTotal += (it.qtyG / 1000) * cost;
          meatG += it.qtyG;
          fullCostTotal += (it.qtyG / 1000) * cost;
        } else {
          hasUnpricedMeat = true;
          unpricedCount++;
        }
        continue;
      }
      // non-meat component: value only weight/volume stock-leaf products with a
      // known costPrice (списание treats qtyG as base units the same way).
      const valuable =
        it.componentId != null &&
        it.compCost != null &&
        it.compUnit != null &&
        it.compUnit !== "dona" &&
        it.compType !== "dish" &&
        it.compType !== "semi";
      if (valuable) {
        const v = valuePortion(it.qtyG, it.compUnit!, it.compCost, null);
        if (v != null) fullCostTotal += v;
        else unpricedCount++;
      } else {
        unpricedCount++;
      }
    }
    meatCostTotal = Math.round(meatCostTotal);
    fullCostTotal = Math.round(fullCostTotal);
    const salePrice = r.salePrice ?? 0;
    const costComplete = hasComponents && unpricedCount === 0;
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
      // full-cost margin
      fullCostTotal,
      costComplete,
      unpricedCount,
      marginTotal: salePrice > 0 ? salePrice - fullCostTotal : null,
      marginPct:
        salePrice > 0
          ? Math.round(((salePrice - fullCostTotal) / salePrice) * 100)
          : null,
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
  // Қайтаришлар нақд (refunds жадвалида method йўқ — дизайн бўйича нақд):
  // кассадан физик пул чиқади → expectedCash'дан айирилади (сохта камомад чиқмасин).
  const cashRefunds = Number(
    (
      await db
        .select({ s: sql<number>`coalesce(sum(${refunds.amount}), 0)` })
        .from(refunds)
        .where(and(gte(refunds.createdAt, start), lt(refunds.createdAt, end)))
    )[0]?.s ?? 0,
  );
  // Бронь аванслари: НАҚД олингани ўша куни тортмага киради (тушум эмас —
  // тушум заказ ёпилишида 'avans' қатори бўлади, у нақд саналмайди → иккиланмайди).
  const cashDeposits = Number(
    (
      await db
        .select({ s: sql<number>`coalesce(sum(${reservations.depositAmount}), 0)` })
        .from(reservations)
        .where(
          and(
            eq(reservations.depositMethod, "cash"),
            gt(reservations.depositAmount, 0),
            gte(reservations.createdAt, start),
            lt(reservations.createdAt, end),
          ),
        )
    )[0]?.s ?? 0,
  );
  // Аванс қайтарилди (бронь бекор, resolution=refund): нақд чиқим — усулидан
  // қатъи назар мижозга нақд қайтарилади (refunds жадвали фалсафаси билан бир хил).
  const cashDepositRefunds = Number(
    (
      await db
        .select({ s: sql<number>`coalesce(sum(${reservations.depositAmount}), 0)` })
        .from(reservations)
        .where(
          and(
            sql`${reservations.depositResolution} = 'refund'`,
            gte(reservations.resolvedAt, start),
            lt(reservations.resolvedAt, end),
          ),
        )
    )[0]?.s ?? 0,
  );
  const expectedCash =
    TILL_FLOAT +
    cashRevenue +
    cashDebtRepaid +
    cashDeposits -
    cashExpenses -
    cashCollected -
    cashRefunds -
    cashDepositRefunds;
  return {
    cashRevenue,
    cashDebtRepaid,
    cashExpenses,
    cashCollected,
    cashRefunds,
    cashDeposits,
    cashDepositRefunds,
    expectedCash,
  };
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

// Same weekday, previous week (7 business-days back) — for "vs last week" comparisons.
function sameWeekdayLastWeek(dayKey: string): string {
  let k = dayKey;
  for (let i = 0; i < 7; i++) k = previousDayKey(k);
  return k;
}

// Shared by analytics.digest and sendDailyDigest so the comparison logic lives in one place.
async function lastWeekComparison(
  dayKey: string,
  todayRevenue: number,
): Promise<{ pct: number | null; lastWeekRevenue: number; lastWeekChecks: number }> {
  const lastWeekKey = sameWeekdayLastWeek(dayKey);
  const { startUTC, endUTC } = businessDayBounds(lastWeekKey);
  const r = await revenueForWindow(startUTC, endUTC);
  const pct =
    r.revenue > 0 ? Math.round(((todayRevenue - r.revenue) / r.revenue) * 100) : null;
  return { pct, lastWeekRevenue: r.revenue, lastWeekChecks: r.checks };
}

// Per-order REALIZED-revenue fraction [0..1] for item-level reports, so they stay
// consistent with the app's "debt is not realized revenue" convention AND reconcile
// with financeForWindow/byWaiter (which are per-payment-row). Returned ONLY for
// orders that aren't fully realized: comp = 0, debt-only = 0, split cash+debt =
// nonDebt/total (the CASH part still counts — the earlier whole-order exclusion
// dropped it). Cash-only orders are absent → caller defaults to 1. Qty/stock still
// count fully for every order regardless of this fraction.
async function orderRevenueFraction(
  start: Date,
  end: Date,
): Promise<Map<string, number>> {
  const frac = new Map<string, number>();
  const compRows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.isComp, true),
        eq(orders.status, "closed"),
        gte(orders.closedAt, start),
        lt(orders.closedAt, end),
      ),
    );
  for (const r of compRows) frac.set(r.id, 0);
  const payRows = await db
    .select({
      orderId: orderPayments.orderId,
      method: orderPayments.method,
      amount: orderPayments.amount,
    })
    .from(orderPayments)
    .innerJoin(orders, eq(orderPayments.orderId, orders.id))
    .where(
      and(
        eq(orders.status, "closed"),
        gte(orders.closedAt, start),
        lt(orders.closedAt, end),
      ),
    );
  const agg = new Map<string, { nonDebt: number; total: number; hasDebt: boolean }>();
  for (const p of payRows) {
    const a = agg.get(p.orderId) ?? { nonDebt: 0, total: 0, hasDebt: false };
    a.total += p.amount;
    if (p.method === "debt") a.hasDebt = true;
    else a.nonDebt += p.amount;
    agg.set(p.orderId, a);
  }
  for (const [oid, a] of agg) {
    if (frac.has(oid)) continue; // comp already 0
    if (a.hasDebt) frac.set(oid, a.total > 0 ? a.nonDebt / a.total : 0);
  }
  return frac;
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
      and(eq(products.active, true), inArray(products.type, ["ingredient", "part", "semi", "goods"])),
    )
    .groupBy(products.id, products.name, products.type, products.unit, products.costPrice)
    .orderBy(products.type, products.name);
  return rows.map((r) => ({ ...r, onHand: Number(r.onHand) }));
}

// Битта маҳсулот қолдиғи (base units). Списание/ишлаб чиқаришда мавжуддан кўп
// чиқаришни тақиқлаш учун — манфий қолдиқ билан ўғирликни яширишни олдини олади.
async function productOnHand(
  productId: string,
  exec: { select: typeof db.select } = db,
): Promise<number> {
  return Number(
    (
      await exec
        .select({ s: sql<number>`coalesce(sum(${stockMovements.qty}), 0)` })
        .from(stockMovements)
        .where(eq(stockMovements.productId, productId))
    )[0]?.s ?? 0,
  );
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

  // Возврат / ўчирилган таом / чегирма — кун бўйича сони+суммаси (тешик №6/12/13).
  // Директор кўради; кўп бўлса сохта-возврат/ортиқча-чегирма аломати.
  const refundRows = await db
    .select({ amount: refunds.amount })
    .from(refunds)
    .where(and(gte(refunds.createdAt, startUTC), lt(refunds.createdAt, endUTC)));
  const refundsToday = { count: refundRows.length, sum: refundRows.reduce((s, r) => s + r.amount, 0) };
  const voidRows = await db
    .select({ id: voidedItems.id })
    .from(voidedItems)
    .where(and(gte(voidedItems.createdAt, startUTC), lt(voidedItems.createdAt, endUTC)));
  const voidsToday = { count: voidRows.length };
  const discRows = await db
    .select({ amount: orders.discountAmount })
    .from(orders)
    .where(
      and(
        eq(orders.status, "closed"),
        gt(orders.discountAmount, 0),
        gte(orders.closedAt, startUTC),
        lt(orders.closedAt, endUTC),
      ),
    );
  const discountsToday = { count: discRows.length, sum: discRows.reduce((s, r) => s + r.amount, 0) };
  const reprintRows = await db
    .select({ id: reprintLog.id })
    .from(reprintLog)
    .where(and(gte(reprintLog.createdAt, startUTC), lt(reprintLog.createdAt, endUTC)));
  const reprintsToday = { count: reprintRows.length };

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

  // M3 витрина/сих/муддат сигналлари (P1.4). expiry — shelf_life NULL бўлса бўш
  // қолади (эга қарори, ухлаган). vitrinaMismatch — кечаги тўлиқ кун бўйича.
  const expiryFlags = await expiryFlagsCompute();
  const skewerFlags = await skewerNormFlags();
  const vitrinaMismatch = (await vitrinaReconcile(yKey)).filter(
    (r) => r.diff != null && r.diff !== 0,
  );

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
    expiryFlags,
    skewerFlags,
    vitrinaMismatch,
    refundsToday,
    voidsToday,
    discountsToday,
    reprintsToday,
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
      note: orderItems.note,
      course: orderItems.course,
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
    { name: string; qty: number; note: string | null; course: number; createdAt: Date; station: string | null }
  >();
  for (const it of items) {
    if (!it.productId) continue;
    const g = grouped.get(it.productId);
    if (g) {
      g.qty += it.qty;
      if (it.createdAt < g.createdAt) g.createdAt = it.createdAt;
      g.note = g.note ?? it.note;
    } else {
      grouped.set(it.productId, {
        name: it.name,
        qty: it.qty,
        note: it.note,
        course: it.course ?? 1,
        createdAt: it.createdAt,
        station: it.station,
      });
    }
  }

  const toSend: { productId: string; name: string; unsent: number; note: string | null; course: number; station: string | null }[] = [];
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
    if (unsent > 0)
      toSend.push({ productId, name: g.name, unsent, note: g.note, course: g.course, station: g.station });
  }
  // Курс бўйича тартиб — тикетда 1-курс, 2-курс кетма-кет чиқсин.
  toSend.sort((a, b) => a.course - b.course);
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
        .select({ name: kitchenTicketItems.name, qty: kitchenTicketItems.qty, note: kitchenTicketItems.note, station: kitchenTicketItems.station })
        .from(kitchenTicketItems)
        .where(eq(kitchenTicketItems.ticketId, prev.id));
      return {
        id: prev.id,
        createdAt: prev.createdAt,
        items: prevItems.map((it) => ({ name: it.name, qty: it.qty, note: it.note, station: it.station ?? "Бошқа" })),
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
      note: it.note,
      course: it.course,
    })),
  );

  return {
    id: ticket.id,
    createdAt: ticket.createdAt,
    items: toSend.map((it) => ({ name: it.name, qty: it.unsent, note: it.note, course: it.course, station: it.station ?? "Бошқа" })),
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
        // mapped ingredient: any stock-leaf weight-unit product (grams), incl. semi
        // (Фарш ва ш.к. — stock.produce уни омборга киритади, сотувда чиқарилади;
        // акс ҳолда semi бир томонлама реестр бўлиб қоларди). dish/dona эмас.
        const c = prodMap.get(ri.componentId);
        if (c && c.type !== "dish" && c.unit !== "dona") target = ri.componentId;
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
  const rows = await db
    .select({ name: stations.name, ip: stations.ip, printable: stations.printable })
    .from(stations);
  // printable=false → чоп этилмайди (IP бор бўлса ҳам). Принтинг IP мавжудлигига
  // қараб қарор қилади, шунинг учун чоп этилмайдиган станцияда ip'ни null қиламиз.
  return new Map(rows.map((r) => [r.name, r.printable ? r.ip : null]));
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
  items: { name: string; qty: number; note?: string | null; station: string | null }[],
): Promise<void> {
  try {
    if (items.length === 0) return;
    const meta = (
      await db
        .select({
          hall: halls.name,
          tableNo: orders.tableNo,
          createdAt: orders.createdAt,
          saleType: orders.saleType,
        })
        .from(orders)
        .leftJoin(halls, eq(orders.hallId, halls.id))
        .where(eq(orders.id, orderId))
        .limit(1)
    )[0];
    if (!meta) return;
    const ipMap = await stationIpMap();
    printKitchenTicket(
      meta,
      items.map((it) => ({ name: it.name, qty: it.qty, note: it.note, station: it.station ?? "Бошқа" })),
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

// Пречек (ҳали очиқ стол) — платежлар йўқ, статус ўзгармайди.
async function firePrintPrecheck(orderId: string): Promise<void> {
  try {
    const head = (
      await db
        .select({
          checkNo: orders.id,
          tableNo: orders.tableNo,
          servicePct: orders.servicePct,
          createdAt: orders.createdAt,
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
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const service = Math.round((subtotal * head.servicePct) / 100);
    const barIp = (await stationIpMap()).get(BAR_STATION) ?? null;
    const check: Omit<CheckData, "payments" | "isComp" | "compReason"> = {
      brandName: BRAND_PRINT.name,
      brandCity: BRAND_PRINT.city,
      brandPhone: BRAND_PRINT.phone,
      checkNo: head.checkNo.slice(0, 5).toUpperCase(),
      hall: head.hall,
      tableNo: head.tableNo,
      waiter: head.waiter,
      createdAt: head.createdAt,
      items,
      subtotal,
      service,
      servicePct: head.servicePct,
      discount: head.discountAmount,
      total: subtotal + service - head.discountAmount,
    };
    printPrecheck(check, barIp);
  } catch (e) {
    console.error("[print] firePrintPrecheck:", e instanceof Error ? e.message : e);
  }
}

export function shiftDayKey(dayKey: string, deltaDays: number): string {
  const [y = 0, m = 1, d = 1] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// Mirrors report.topDishes' per-dish margin calc, scoped to one closed business
// day — used to build the 3-day margin-trend history for marginDropInsight().
export async function dishMarginForDay(
  dayKey: string,
  dishes: Awaited<ReturnType<typeof computeDishTaannarx>>,
): Promise<Map<string, { name: string; marginPct: number }>> {
  const { startUTC, endUTC } = businessDayBounds(dayKey);
  const frac = await orderRevenueFraction(startUTC, endUTC);
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
    e.qty += r.qty;
    e.revenue += Math.round(r.qty * r.price * (frac.get(r.orderId) ?? 1));
    byProduct.set(r.productId, e);
  }
  const meatPerUnit = new Map(
    dishes
      .filter(
        (d) => d.productId && !(d.meatPct != null && d.meatPct > 100) && !d.hasUnpricedMeat,
      )
      .map((d) => [d.productId as string, d.meatCostTotal]),
  );
  const out = new Map<string, { name: string; marginPct: number }>();
  for (const [productId, v] of byProduct) {
    if (v.revenue <= 0) continue;
    const perUnit = meatPerUnit.get(productId);
    if (perUnit == null) continue;
    const meatCostTotal = perUnit * v.qty;
    const profit = v.revenue - meatCostTotal;
    out.set(productId, { name: v.name, marginPct: Math.round((profit / v.revenue) * 100) });
  }
  return out;
}

// Кун охири хулосаси: тушум/фойда/чек + очиқ тешиклар → директорга Telegram.
// telegram.digest procedure ва cron скрипти (telegram-digest.ts) шуни чақиради.
export async function sendDailyDigest(): Promise<{ ok: boolean; holes: number }> {
  if (!telegramEnabled()) return { ok: false, holes: 0 };
  const som = (n: number) => n.toLocaleString("ru-RU");
  const { startUTC, endUTC, dayKey } = businessDayBounds();
  const fin = await financeForWindow(startUTC, endUTC);
  const sig = await computeSignals();
  const holes: string[] = [];
  if (sig.obvalkaFlags.length) holes.push(`🩸 Обвалка баланс: ${sig.obvalkaFlags.length}`);
  if (sig.underDelivery.length)
    holes.push(...humanizeUnderDelivery(sig.underDelivery as UnderDeliveryItem[]));
  const grammLeakFlagged = sig.grammLeak.filter((g) => g.flag);
  if (grammLeakFlagged.length) holes.push(...humanizeGrammLeak(grammLeakFlagged));
  if (sig.vitrinaMismatch.length) holes.push(`🍢 Витрина фарқи: ${sig.vitrinaMismatch.length} таом`);
  if (sig.skewerFlags.length) holes.push(`⚖️ Сих норма: ${sig.skewerFlags.length} четлашиш`);
  if (sig.expiryFlags.length) holes.push(`⏳ Муддат ўтган: ${sig.expiryFlags.length}`);
  if (sig.priceSpikes.length) holes.push(...humanizePriceSpike(sig.priceSpikes));
  if (sig.compFlag) holes.push(`🆓 Текин лимитдан ошди: ${som(sig.compToday)}`);
  if (sig.cashVariance && sig.cashVariance.variance < 0)
    holes.push(`💵 Касса камомади: ${som(sig.cashVariance.variance)}`);
  if (sig.staleOrders.length) holes.push(`⏰ Узоқ очиқ стол: ${sig.staleOrders.length}`);
  if (sig.thinDishes.length) holes.push(`📉 Юпқа маржа: ${sig.thinDishes.length} таом`);
  if (sig.refundsToday.count) holes.push(`↩️ Возврат: ${sig.refundsToday.count} та (${som(sig.refundsToday.sum)})`);
  if (sig.voidsToday.count) holes.push(`🗑️ Ўчирилган таом: ${sig.voidsToday.count} та`);
  if (sig.discountsToday.count) holes.push(`🏷️ Чегирма: ${sig.discountsToday.count} та (${som(sig.discountsToday.sum)})`);
  if (sig.reprintsToday.count) holes.push(`🖨️ Қайта чоп: ${sig.reprintsToday.count} та`);
  const lastWeek = await lastWeekComparison(dayKey, fin.revenue);
  const weekdayNames = ["якшанба", "душанба", "сешанба", "чоршанба", "пайшанба", "жума", "шанба"];
  const weekdayName = weekdayNames[new Date(`${dayKey}T00:00:00Z`).getUTCDay()];

  // 4.1 — 3-day margin-drop insight (d0=позавчера-позавчера .. d2=вчера, old→new).
  const d2 = previousDayKey(dayKey);
  const d1 = previousDayKey(d2);
  const d0 = previousDayKey(d1);
  const meatCost = { qoy: await latestMeatCost("qoy"), mol: await latestMeatCost("mol") };
  const dishes = await computeDishTaannarx(meatCost);
  const marginHistory: DishMarginDay[] = [];
  for (const day of [d0, d1, d2]) {
    const m = await dishMarginForDay(day, dishes);
    for (const [productId, v] of m) {
      marginHistory.push({ productId, name: v.name, dayKey: day, marginPct: v.marginPct });
    }
  }
  const insight = marginDropInsight(marginHistory, [d0, d1, d2]);

  // 4.2 — tomorrow's meat purchase forecast (median of same-weekday history).
  const carc = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(inArray(products.name, ["Мол лаҳм", "Қўй лаҳм"]));
  const molId = carc.find((c) => c.name === "Мол лаҳм")?.id ?? null;
  const qoyId = carc.find((c) => c.name === "Қўй лаҳм")?.id ?? null;
  const tomorrowKey = shiftDayKey(dayKey, 1);
  const tomorrowWeekdayName =
    weekdayNames[new Date(`${tomorrowKey}T00:00:00Z`).getUTCDay()] ?? "";
  const floorRows = await db.execute<{ floor: Date | null }>(
    sql`select min(created_at) as floor from stock_movements`,
  );
  const floor = floorRows[0]?.floor ? new Date(floorRows[0].floor) : null;
  async function historyKg(productId: string | null): Promise<number[]> {
    if (!productId || !floor) return [];
    const out: number[] = [];
    for (let i = 1; i <= 4; i++) {
      const histKey = shiftDayKey(tomorrowKey, -7 * i);
      const { startUTC: hStart, endUTC: hEnd } = businessDayBounds(histKey);
      // Skip only if the WHOLE window predates the first-ever movement — if the
      // floor timestamp falls inside this window (system went live mid-day), the
      // window is still valid and the sum query below naturally returns real data.
      if (hEnd <= floor) continue;
      const row = (
        await db
          .select({ s: sql<number>`coalesce(sum(-${stockMovements.qty}), 0)` })
          .from(stockMovements)
          .where(
            and(
              eq(stockMovements.productId, productId),
              lt(stockMovements.qty, 0),
              gte(stockMovements.createdAt, hStart),
              lt(stockMovements.createdAt, hEnd),
            ),
          )
      )[0];
      out.push(Number(row?.s ?? 0) / 1000);
    }
    return out;
  }
  const qoyHistoryKg = await historyKg(qoyId);
  const molHistoryKg = await historyKg(molId);
  const forecastLine = buildPurchaseForecast(tomorrowWeekdayName, qoyHistoryKg, molHistoryKg);

  // 4.4 — ҳафта якуни (фақат якшанба): энг яхши кун + энг яхши официант + рекорд тушум.
  let weekSummaryLine = "";
  let weekRecordLine = "";
  if (weekdayNames[new Date(`${dayKey}T00:00:00Z`).getUTCDay()] === "якшанба") {
    let bestDayKey = dayKey;
    let bestDayRevenue = -1;
    let weekStartKey = dayKey;
    for (let i = 0; i < 7; i++) {
      const k = i === 0 ? dayKey : shiftDayKey(dayKey, -i);
      const { startUTC: dS, endUTC: dE } = businessDayBounds(k);
      const r = await revenueForWindow(dS, dE);
      if (r.revenue > bestDayRevenue) {
        bestDayRevenue = r.revenue;
        bestDayKey = k;
      }
      weekStartKey = k;
    }
    const bestDayName = weekdayNames[new Date(`${bestDayKey}T00:00:00Z`).getUTCDay()];
    const { startUTC: weekStartUTC } = businessDayBounds(weekStartKey);

    const waiterRows = await db
      .select({
        waiterId: orders.waiterId,
        waiterName: users.name,
        amount: orderPayments.amount,
        method: orderPayments.method,
      })
      .from(orderPayments)
      .innerJoin(orders, eq(orderPayments.orderId, orders.id))
      .leftJoin(users, eq(orders.waiterId, users.id))
      .where(
        and(
          eq(orders.status, "closed"),
          gte(orders.closedAt, weekStartUTC),
          lt(orders.closedAt, endUTC),
        ),
      );
    const byWaiterWeek = new Map<string, { name: string; amount: number }>();
    for (const r of waiterRows) {
      if (r.method === "debt" || !r.waiterId) continue;
      const e = byWaiterWeek.get(r.waiterId) ?? { name: r.waiterName ?? "Номаълум", amount: 0 };
      e.amount += r.amount;
      byWaiterWeek.set(r.waiterId, e);
    }
    const bestWaiter = [...byWaiterWeek.values()].sort((a, b) => b.amount - a.amount)[0];

    weekSummaryLine = bestWaiter
      ? `🗓️ Ҳафта якуни: энг яхши кун — ${bestDayName} (${som(bestDayRevenue)}) · энг яхши официант — ${bestWaiter.name} (${som(bestWaiter.amount)})`
      : "";

    // рекорд: аввалги ҳафталардаги ЭНГ ЮҚОРИ business-кун тушуми (шу ҳафта бошланишидан олдин).
    const histRows = await db.execute<{ dkey: string; revenue: number }>(
      sql`select to_char((closed_at - interval '1 hour'), 'YYYY-MM-DD') as dkey,
                 sum(amount) as revenue
          from order_payments op
          join orders o on o.id = op.order_id
          where o.status = 'closed' and op.method != 'debt'
            and o.closed_at < ${weekStartUTC.toISOString()}
          group by 1`,
    );
    // Тарих йўқ (янги ресторан, шу ҳафтадан олдин ёпилган кун йўқ) — "рекорд"
    // деб эълон қилмаймиз, солиштирадиган нарса йўқ (акс ҳолда биринчи бир неча
    // якшанба ҳар доим "рекорд" бўлиб чиқади — сохта сигнал).
    const priorMax = histRows.length ? histRows.reduce((m, r) => Math.max(m, Number(r.revenue)), 0) : null;
    if (priorMax !== null && bestDayRevenue > priorMax) weekRecordLine = "🏆 Рекорд тушум!";
  }

  const lines = [
    `🍋 La Limonariya — кун хулосаси (${dayKey})`,
    "",
    `💵 Тушум: ${som(fin.revenue)}`,
    `📈 Соф фойда: ${som(fin.sofFoyda)}${fin.cogsPartial ? " (COGS қисман)" : ""}`,
    `🧾 Чек: ${fin.checks} · ўрт. ${som(fin.avgCheck)}`,
    lastWeek.lastWeekRevenue > 0
      ? `📊 Ўтган ${weekdayName}га нисбатан: ${lastWeek.pct! >= 0 ? "+" : ""}${lastWeek.pct}%`
      : "",
    fin.guestDebt > 0 ? `🤝 Меҳмон қарзи (олинмаган): ${som(fin.guestDebt)}` : "",
    fin.ownerDraw > 0 ? `👑 Эга олди: ${som(fin.ownerDraw)}` : "",
    "",
    insight ? `💡 ${insight}` : "",
    forecastLine ?? "",
    weekSummaryLine,
    weekRecordLine,
    "",
    holes.length ? `⚠️ Тешиклар:\n${holes.map((h) => `• ${h}`).join("\n")}` : "✅ Тешик йўқ",
  ].filter(Boolean);
  await sendTelegram(lines.join("\n"));
  return { ok: true, holes: holes.length };
}

// Milestone 3 — витрина баланси бир кун учун:
// кутилган қолдиқ = кечаги саналган + бугун сихланган − бугун сотилган.
const SKEWER_NORM_TOLERANCE = 0.1; // Milestone 3: норма граммдан ±10% четлашиш

// Тешик №7 (муддат назорати): FIFO ёши — қолдиқ энг эски қайси киримдан
// қолганини топади. Walk inflows newest→oldest accumulating until the on-hand
// total is covered; the inflow that completes it is the oldest remaining layer
// (FIFO consumption eats old layers first, so what remains is the NEWEST inflows).
async function expiryFlagsCompute() {
  const tracked = await db
    .select({
      id: products.id,
      name: products.name,
      unit: products.unit,
      shelfLifeDays: products.shelfLifeDays,
    })
    .from(products)
    .where(and(eq(products.active, true), sql`${products.shelfLifeDays} is not null`));
  if (tracked.length === 0) return [];

  const flags: {
    productId: string;
    name: string;
    unit: string;
    onHand: number;
    ageDays: number;
    shelfLifeDays: number;
  }[] = [];
  for (const p of tracked) {
    const moves = await db
      .select({ qty: stockMovements.qty, createdAt: stockMovements.createdAt })
      .from(stockMovements)
      .where(eq(stockMovements.productId, p.id))
      .orderBy(desc(stockMovements.createdAt));
    const onHand = moves.reduce((s, m) => s + m.qty, 0);
    if (onHand <= 0) continue;
    let acc = 0;
    let oldest: Date | null = null;
    for (const m of moves) {
      if (m.qty <= 0) continue;
      acc += m.qty;
      oldest = m.createdAt;
      if (acc >= onHand) break;
    }
    if (!oldest) continue;
    const ageDays = Math.floor((Date.now() - oldest.getTime()) / (24 * 60 * 60 * 1000));
    if (ageDays > (p.shelfLifeDays ?? 0))
      flags.push({
        productId: p.id,
        name: p.name,
        unit: p.unit,
        onHand,
        ageDays,
        shelfLifeDays: p.shelfLifeDays ?? 0,
      });
  }
  return flags.sort((a, b) => b.ageDays - a.ageDays);
}

// Milestone 3 — сих грамм назорати: сўнгги батчларда норма ±10% дан четлашиш.
async function skewerNormFlags() {
  const rows = await db
    .select({
      id: skewerBatches.id,
      productId: skewerBatches.productId,
      name: products.name,
      meatG: skewerBatches.meatG,
      skewerCount: skewerBatches.skewerCount,
      normG: skewerBatches.normG,
      createdAt: skewerBatches.createdAt,
      by: users.name,
    })
    .from(skewerBatches)
    .innerJoin(products, eq(skewerBatches.productId, products.id))
    .leftJoin(users, eq(skewerBatches.createdById, users.id))
    .orderBy(desc(skewerBatches.createdAt))
    .limit(15);
  return rows
    .map((r) => {
      const actualG = r.skewerCount > 0 ? Math.round(r.meatG / r.skewerCount) : 0;
      const devPct =
        r.normG && r.normG > 0 ? Math.round(((actualG - r.normG) / r.normG) * 100) : null;
      return { ...r, actualG, devPct };
    })
    .filter((r) => r.devPct != null && Math.abs(r.devPct) > SKEWER_NORM_TOLERANCE * 100);
}

// Milestone 3 — витрина баланси бир кун учун:
// кутилган қолдиқ = кечаги саналган + бугун сихланган − бугун сотилган.

export async function vitrinaReconcile(dayKey: string) {
  const { startUTC, endUTC } = businessDayBounds(dayKey);
  const prevKey = previousDayKey(dayKey);

  const batchRows = await db
    .select({
      productId: skewerBatches.productId,
      skewered: sql<number>`coalesce(sum(${skewerBatches.skewerCount}), 0)`,
    })
    .from(skewerBatches)
    .where(and(gte(skewerBatches.createdAt, startUTC), lt(skewerBatches.createdAt, endUTC)))
    .groupBy(skewerBatches.productId);
  const skeweredMap = new Map(batchRows.map((r) => [r.productId, Number(r.skewered)]));

  const countRows = await db
    .select({
      dayKey: vitrinaCounts.dayKey,
      productId: vitrinaCounts.productId,
      countedQty: vitrinaCounts.countedQty,
    })
    .from(vitrinaCounts)
    .where(inArray(vitrinaCounts.dayKey, [dayKey, prevKey]));
  const countedMap = new Map(
    countRows.filter((r) => r.dayKey === dayKey).map((r) => [r.productId, r.countedQty]),
  );
  const openingMap = new Map(
    countRows.filter((r) => r.dayKey === prevKey).map((r) => [r.productId, r.countedQty]),
  );
  // scope: every product that has EVER been skewer-batched, plus any counted today
  const everBatched = await db
    .select({ productId: skewerBatches.productId })
    .from(skewerBatches)
    .groupBy(skewerBatches.productId);
  const scope = new Set<string>([
    ...everBatched.map((r) => r.productId),
    ...countedMap.keys(),
  ]);
  if (scope.size === 0) return [];

  const soldRows = await db
    .select({
      productId: orderItems.productId,
      sold: sql<number>`coalesce(sum(${orderItems.qty}), 0)`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(
      and(
        eq(orders.status, "closed"),
        gte(orders.closedAt, startUTC),
        lt(orders.closedAt, endUTC),
        inArray(orderItems.productId, [...scope]),
      ),
    )
    .groupBy(orderItems.productId);
  const soldMap = new Map(soldRows.map((r) => [r.productId as string, Number(r.sold)]));

  const nameRows = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(inArray(products.id, [...scope]));
  const nameMap = new Map(nameRows.map((r) => [r.id, r.name]));

  return [...scope]
    .map((productId) => {
      const opening = openingMap.get(productId) ?? null;
      const skewered = skeweredMap.get(productId) ?? 0;
      const sold = soldMap.get(productId) ?? 0;
      const counted = countedMap.get(productId) ?? null;
      const expected = (opening ?? 0) + skewered - sold;
      return {
        productId,
        name: nameMap.get(productId) ?? "?",
        opening,
        openingKnown: opening != null,
        skewered,
        sold,
        expected,
        counted,
        diff: counted != null ? counted - expected : null,
      };
    })
    .filter((r) => r.skewered > 0 || r.sold > 0 || r.counted != null || (r.opening ?? 0) > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

// Официант фақат ЎЗ заказини кўради/ўзгартиради. Старшие роли — ҳаммаси очиқ.
async function assertOrderAccess(
  exec: { select: typeof db.select },
  user: { id: string; role: string },
  orderId: string,
) {
  if (user.role !== "waiter") return;
  const row = (
    await exec
      .select({ waiterId: orders.waiterId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1)
  )[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  if (row.waiterId !== user.id)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Бу сизнинг заказингиз эмас",
    });
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
      .mutation(async ({ input, ctx }) => {
        return db.transaction(async (tx) => {
          try {
            await tx
              .update(users)
              .set({ pinHash: hashPin(input.pin), pinLookup: pinLookup(input.pin) })
              .where(eq(users.id, input.userId));
          } catch (e) {
            if (e && typeof e === "object" && "code" in e && e.code === "23505") {
              throw new TRPCError({ code: "CONFLICT", message: "Бу PIN банд" });
            }
            throw e;
          }
          await logAudit(tx, {
            actorId: ctx.user.id,
            action: "pin.reset",
            entity: "user",
            entityId: input.userId,
            summary: "PIN ўзгартирилди",
          });
          return { ok: true };
        });
      }),

    create: directorProcedure
      .input(
        z.object({
          name: z.string().trim().min(1),
          role: z.enum(["director", "manager", "buyer", "cashier", "waiter"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        return db.transaction(async (tx) => {
          const row = (
            await tx
              .insert(users)
              .values({ name: input.name, role: input.role })
              .returning({ id: users.id })
          )[0];
          await logAudit(tx, {
            actorId: ctx.user.id,
            action: "user.create",
            entity: "user",
            entityId: row?.id ?? null,
            summary: `${input.name} (${input.role})`,
            meta: { name: input.name, role: input.role },
          });
          return { id: row?.id };
        });
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
      .mutation(async ({ input, ctx }) => {
        const { userId, ...patch } = input;
        if (Object.keys(patch).length === 0) return { ok: true };
        return db.transaction(async (tx) => {
          const old = (
            await tx
              .select({ name: users.name, role: users.role, active: users.active })
              .from(users)
              .where(eq(users.id, userId))
              .limit(1)
          )[0];
          await tx.update(users).set(patch).where(eq(users.id, userId));
          await logAudit(tx, {
            actorId: ctx.user.id,
            action: "user.update",
            entity: "user",
            entityId: userId,
            summary:
              patch.role && old && patch.role !== old.role
                ? `роль: ${old.role} → ${patch.role}`
                : "ходим таҳрирланди",
            meta: { old, new: patch },
          });
          return { ok: true };
        });
      }),
  }),

  // Аудит журнали — ким қандай ҳимоя-муҳим ўзгариш қилди (директор кўради).
  audit: router({
    recent: directorProcedure
      .input(
        z.object({ limit: z.number().int().positive().max(200).optional() }).optional(),
      )
      .query(async ({ input }) => {
        return db
          .select({
            id: auditLog.id,
            action: auditLog.action,
            entity: auditLog.entity,
            summary: auditLog.summary,
            createdAt: auditLog.createdAt,
            actor: users.name,
          })
          .from(auditLog)
          .leftJoin(users, eq(auditLog.actorId, users.id))
          .orderBy(desc(auditLog.createdAt))
          .limit(input?.limit ?? 50);
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
          const rows = await db
            .select({
              id: products.id,
              name: products.name,
              type: products.type,
              unit: products.unit,
              price: products.price,
              costPrice: products.costPrice,
              soldByWeight: products.soldByWeight,
              active: products.active,
              stopped: products.stopped,
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
          // Маржа = 100 − гўшт%. Фақат директорга (computeDishTaannarx қиммат).
          if (ctx.user.role !== "director")
            return rows.map((r) => ({ ...r, marginPct: null as number | null }));
          const meatCost = {
            qoy: await latestMeatCost("qoy"),
            mol: await latestMeatCost("mol"),
          };
          const dishes = await computeDishTaannarx(meatCost);
          const marginByProduct = new Map<string, number>();
          for (const d of dishes)
            if (d.productId != null && d.meatPct != null)
              marginByProduct.set(d.productId, 100 - d.meatPct);
          return rows.map((r) => ({ ...r, marginPct: marginByProduct.get(r.id) ?? null }));
        }),

      // Стоп-лист toggle: кассир+ (официант тугаганини кўриб кассирга айтади;
      // менежер/кассир дарҳол стопга қўяди). Аудитга ёзилади — ким қўйди/олди.
      setStopped: cashierProcedure
        .input(z.object({ id: z.string().uuid(), stopped: z.boolean() }))
        .mutation(async ({ input, ctx }) => {
          return db.transaction(async (tx) => {
            const row = (
              await tx
                .update(products)
                .set({ stopped: input.stopped })
                .where(eq(products.id, input.id))
                .returning({ id: products.id, name: products.name })
            )[0];
            if (!row) throw new TRPCError({ code: "NOT_FOUND" });
            await logAudit(tx, {
              actorId: ctx.user.id,
              action: input.stopped ? "product.stop" : "product.unstop",
              entity: "product",
              entityId: row.id,
              summary: `${row.name} — ${input.stopped ? "стопга қўйилди" : "стопдан олинди"}`,
            });
            return { ok: true };
          });
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
        .mutation(async ({ input, ctx }) => {
          return db.transaction(async (tx) => {
            const row = (
              await tx
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
            await logAudit(tx, {
              actorId: ctx.user.id,
              action: "product.create",
              entity: "product",
              entityId: row?.id ?? null,
              summary: `${input.name} · ${input.price ?? 0} so'm`,
              meta: { name: input.name, price: input.price ?? 0 },
            });
            return { id: row?.id };
          });
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
        .mutation(async ({ input, ctx }) => {
          const { id, ...patch } = input;
          if (Object.keys(patch).length === 0) return { ok: true };
          return db.transaction(async (tx) => {
            const old = (
              await tx
                .select({
                  name: products.name,
                  price: products.price,
                  active: products.active,
                })
                .from(products)
                .where(eq(products.id, id))
                .limit(1)
            )[0];
            await tx.update(products).set(patch).where(eq(products.id, id));
            await logAudit(tx, {
              actorId: ctx.user.id,
              action: "product.update",
              entity: "product",
              entityId: id,
              summary:
                patch.price != null && old && patch.price !== old.price
                  ? `нарх: ${old.price} → ${patch.price} so'm`
                  : `${old?.name ?? ""} таҳрирланди`,
              meta: { old, new: patch },
            });
            return { ok: true };
          });
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
      .mutation(async ({ input, ctx }) => {
        return db.transaction(async (tx) => {
          await tx
            .update(stations)
            .set({ ip: input.ip })
            .where(eq(stations.id, input.stationId));
          await logAudit(tx, {
            actorId: ctx.user.id,
            action: "station.ip",
            entity: "station",
            entityId: input.stationId,
            summary: `принтер IP: ${input.ip ?? "йўқ"}`,
            meta: { ip: input.ip },
          });
          return { ok: true };
        });
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
      .mutation(async ({ input, ctx }) => {
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
          await logAudit(tx, {
            actorId: ctx.user.id,
            action: "recipe.upsert",
            entity: "product",
            entityId: input.productId,
            summary: `${p.name} тех-картаси (${input.items.length} компонент)`,
            meta: { yieldG: input.yieldG ?? null, itemCount: input.items.length },
          });
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

    // Тех-карта авто-улаш таклифи: уланмаган рецептларни (productId=null) техкартаси
    // йўқ таомларга ном-ўхшашлиги бўйича мослаштиради (match.ts — ўзбек ҳарф-фолд +
    // фуззи). КЎР-КЎРОНА улаМАЙДИ — фақат таклиф, директор `link` билан тасдиқлайди.
    recipeLinkSuggest: directorProcedure.query(async () => {
      const unlinked = await db
        .select({ id: recipes.id, name: recipes.name })
        .from(recipes)
        .where(isNull(recipes.productId));
      if (unlinked.length === 0) return [];
      // Техкартаси йўқ фаол таомлар (мослаш номзодлари).
      const dishes = await db
        .select({ id: products.id, name: products.name })
        .from(products)
        .where(
          and(
            eq(products.type, "dish"),
            eq(products.active, true),
            sql`not exists (select 1 from ${recipes} r where r.product_id = ${products.id})`,
          ),
        );
      const out = [];
      const taken = new Set<string>(); // битта таом иккита рецептга таклиф этилмасин
      for (const r of unlinked) {
        const pool = dishes.filter((d) => !taken.has(d.id));
        const m = bestMatch(r.name, pool, 0.6);
        if (m) {
          taken.add(m.productId);
          out.push({
            recipeId: r.id,
            recipeName: r.name,
            productId: m.productId,
            productName: m.productName,
            score: Math.round(m.score * 100),
          });
        }
      }
      return out.sort((a, b) => b.score - a.score);
    }),

    // Директор тасдиқлаган битта улаш — рецепт↔таом. Гардлар: рецепт уланмаган
    // бўлсин, таомда аллақачон техкарта бўлмасин (икки марта улаш = таннарх бузилиши).
    recipeLink: directorProcedure
      .input(z.object({ recipeId: z.string().uuid(), productId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        return db.transaction(async (tx) => {
          const rec = (
            await tx
              .select({ id: recipes.id, name: recipes.name, productId: recipes.productId })
              .from(recipes)
              .where(eq(recipes.id, input.recipeId))
              .limit(1)
          )[0];
          if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Рецепт топилмади" });
          if (rec.productId)
            throw new TRPCError({ code: "BAD_REQUEST", message: "Рецепт аллақачон уланган" });
          const p = (
            await tx
              .select({ id: products.id, name: products.name })
              .from(products)
              .where(eq(products.id, input.productId))
              .limit(1)
          )[0];
          if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Таом топилмади" });
          const already = (
            await tx
              .select({ id: recipes.id })
              .from(recipes)
              .where(eq(recipes.productId, input.productId))
              .limit(1)
          )[0];
          if (already)
            throw new TRPCError({ code: "BAD_REQUEST", message: "Бу таомда аллақачон техкарта бор" });
          await tx.update(recipes).set({ productId: p.id }).where(eq(recipes.id, rec.id));
          await logAudit(tx, {
            actorId: ctx.user.id,
            action: "recipe.link",
            entity: "product",
            entityId: p.id,
            summary: `«${rec.name}» → «${p.name}» техкарта уланди`,
          });
          return { ok: true };
        });
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

    create: buyerProcedure
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
        const result = await db.transaction(async (tx) => {
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

          const computed = computeObvalka(
            input.weightG,
            input.pricePerKg,
            parts.map((p) => {
              const pt = ptMap.get(p.partTypeId);
              return {
                name: pt?.name ?? "?",
                weightG: p.weightG,
                isWaste: pt?.isWaste ?? false,
                normMinPct: pt?.normMinPct ?? null,
                normMaxPct: pt?.normMaxPct ?? null,
              };
            }),
          );
          return { id: row.id, computed };
        });

        // тx COMMIT'дан кейин — критик бўлса директорга Telegram push (дарров).
        const c = result.computed;
        const anomalies = c.items.filter((i) => i.outOfNorm).length;
        if (c.balanceFlag || c.lossPct > 5 || anomalies > 0) {
          const kg = (input.weightG / 1000).toFixed(1);
          const lines = [
            `🔴 ОБВАЛКА — ${input.carcassType === "mol" ? "Мол" : "Қўй"} ${kg}кг${input.supplier ? ` · ${input.supplier}` : ""}`,
            `Баланс: ${c.lossPct > 0 ? "−" : "+"}${Math.abs(c.lossPct)}%${c.lossPct > 5 ? " ⚠️ кам келтириш" : ""}${c.balanceFlag ? " 🚩" : ""}`,
          ];
          if (anomalies > 0) lines.push(`Норма аномалияси: ${anomalies} қисм`);
          void sendTelegram(lines.join("\n"));
        }
        return { id: result.id };
      }),

    // Маълумотдан норма (data-informed): рестораннинг ЎЗ сўнгги тоза тушаларидан
    // ҳар қисм учун чиқиш% банди (медиана ± MAD). ХАВФСИЗЛИК: банд фақат ТОРАЯДИ —
    // директор қўлласа детекция кучаяди, ҳеч қачон сусаймайди (жорий/seed банд =
    // ҳалол таянч; ўрганиш ундан кенгайтира олмайди). Тахминий эмас — тасдиқлаб.
    normSuggestions: managerProcedure
      .input(
        z.object({
          carcassType: z.enum(["qoy", "mol"]),
          lastN: z.number().int().positive().max(200).optional(),
        }),
      )
      .query(async ({ input }) => {
        const N = input.lastN ?? 30;
        const heads = await db
          .select({ id: obvalka.id, weightG: obvalka.weightG })
          .from(obvalka)
          .where(eq(obvalka.carcassType, input.carcassType))
          .orderBy(desc(obvalka.createdAt))
          .limit(400);
        const partsByObv = new Map<
          string,
          { partTypeId: string | null; weightG: number }[]
        >();
        if (heads.length) {
          const partRows = await db
            .select({
              obvalkaId: obvalkaParts.obvalkaId,
              partTypeId: obvalkaParts.partTypeId,
              weightG: obvalkaParts.weightG,
            })
            .from(obvalkaParts)
            .where(
              inArray(
                obvalkaParts.obvalkaId,
                heads.map((h) => h.id),
              ),
            );
          for (const r of partRows) {
            const item = { partTypeId: r.partTypeId, weightG: r.weightG };
            const a = partsByObv.get(r.obvalkaId);
            if (a) a.push(item);
            else partsByObv.set(r.obvalkaId, [item]);
          }
        }
        // Newest-first, keep only carcasses that balance within ±5%, take N.
        const clean: CleanCarcass[] = [];
        for (const h of heads) {
          const parts = partsByObv.get(h.id) ?? [];
          const sum = parts.reduce((s, p) => s + p.weightG, 0);
          const lossPct =
            h.weightG > 0 ? ((h.weightG - sum) / h.weightG) * 100 : 0;
          if (Math.abs(lossPct) <= 5) clean.push({ weightG: h.weightG, parts });
          if (clean.length >= N) break;
        }
        const bands = bandsFromCarcasses(clean);
        const pts = await db
          .select({
            id: partTypes.id,
            name: partTypes.name,
            isWaste: partTypes.isWaste,
            normMinPct: partTypes.normMinPct,
            normMaxPct: partTypes.normMaxPct,
          })
          .from(partTypes)
          .where(eq(partTypes.carcassType, input.carcassType))
          .orderBy(partTypes.sort);
        return {
          sampleCarcasses: clean.length,
          minSamples: NORM_MIN_SAMPLES,
          parts: pts.map((pt) => {
            const b = bands.get(pt.id);
            const enough = !!b && b.n >= NORM_MIN_SAMPLES;
            // Effective (apply-able) band = learned ∩ current → never widens.
            const eff = enough
              ? intersectBand(
                  { minPct: pt.normMinPct, maxPct: pt.normMaxPct },
                  { minPct: b!.minPct, maxPct: b!.maxPct },
                )
              : null;
            const changed =
              !!eff &&
              !eff.disjoint &&
              (eff.minPct !== pt.normMinPct || eff.maxPct !== pt.normMaxPct);
            return {
              partTypeId: pt.id,
              name: pt.name,
              isWaste: pt.isWaste,
              currentMin: pt.normMinPct,
              currentMax: pt.normMaxPct,
              n: b?.n ?? 0,
              median: b?.median ?? null,
              mad: b?.mad ?? null,
              // Raw learned band (what the data alone says — shown for transparency).
              learnedMin: b?.minPct ?? null,
              learnedMax: b?.maxPct ?? null,
              // Apply-able band (never wider than current).
              suggestedMin: eff?.minPct ?? null,
              suggestedMax: eff?.maxPct ?? null,
              enough,
              changed,
              // Data пастроқ/юқорироқ диапазонни таклиф қилди, лекин ТОРАЙТИРИЛМАЙДИ.
              wouldWiden: !!eff && eff.widerSides,
              // Data жорий нормадан бутунлай ташқарида — кучли аномалия, текширинг.
              disjoint: !!eff && eff.disjoint,
            };
          }),
        };
      }),

    // Норма қўллаш (директор тасдиғи). ХАВФСИЗЛИК: сервер ҳам жорий банд билан
    // кесиштиради → клиент кенгроқ банд юборса ҳам детекция сусаймайди. Ҳар
    // ўзгариш norm_changes журналига ёзилади (ким, нимадан-нимага).
    applyNorms: directorProcedure
      .input(
        z.object({
          updates: z
            .array(
              z.object({
                partTypeId: z.string().uuid(),
                normMinPct: z.number().int().min(0),
                normMaxPct: z.number().int().positive(),
              }),
            )
            .min(1)
            .max(100),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        let updated = 0;
        await db.transaction(async (tx) => {
          for (const u of input.updates) {
            if (u.normMinPct > u.normMaxPct) continue;
            const cur = (
              await tx
                .select({
                  normMinPct: partTypes.normMinPct,
                  normMaxPct: partTypes.normMaxPct,
                })
                .from(partTypes)
                .where(eq(partTypes.id, u.partTypeId))
                .limit(1)
            )[0];
            if (!cur) continue;
            // Authoritative never-widen: clamp the requested band to within current.
            const eff = intersectBand(
              { minPct: cur.normMinPct, maxPct: cur.normMaxPct },
              { minPct: u.normMinPct, maxPct: u.normMaxPct },
            );
            if (eff.disjoint) continue; // data wholly outside current — refuse
            if (eff.minPct === cur.normMinPct && eff.maxPct === cur.normMaxPct)
              continue; // no-op
            await tx
              .update(partTypes)
              .set({ normMinPct: eff.minPct, normMaxPct: eff.maxPct })
              .where(eq(partTypes.id, u.partTypeId));
            await tx.insert(normChanges).values({
              partTypeId: u.partTypeId,
              oldMinPct: cur.normMinPct,
              oldMaxPct: cur.normMaxPct,
              newMinPct: eff.minPct,
              newMaxPct: eff.maxPct,
              source: "learned",
              changedById: ctx.user.id,
            });
            updated++;
          }
          // norm_changes батафсил old→new сақлайди; шу ерда директорнинг умумий
          // "🧾 Аудит журнали"да ҳам кўринсин (бир хулоса қатор).
          if (updated > 0)
            await logAudit(tx, {
              actorId: ctx.user.id,
              action: "norm.apply",
              entity: "partType",
              summary: `${updated} қисм нормаси торайтирилди`,
              meta: { count: updated },
            });
        });
        return { updated };
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
          posX: tables.posX,
          posY: tables.posY,
          w: tables.w,
          h: tables.h,
        })
        .from(tables)
        .where(eq(tables.active, true))
        .orderBy(tables.sort);
    }),

    setTablePosition: directorProcedure
      .input(z.object({ id: z.string().uuid(), posX: z.number().int(), posY: z.number().int() }))
      .mutation(async ({ input }) => {
        await db
          .update(tables)
          .set({ posX: input.posX, posY: input.posY })
          .where(eq(tables.id, input.id));
        return { ok: true };
      }),

    // Стол плитка ўлчами (Жойлаштиришда судраб; CloPOS каби катта банкет-зал).
    // Директор гейти — фақат директор флоор харитасини созлайди.
    setTableSize: directorProcedure
      .input(z.object({ id: z.string().uuid(), w: z.number().int().min(80).max(600), h: z.number().int().min(60).max(400) }))
      .mutation(async ({ input }) => {
        await db.update(tables).set({ w: input.w, h: input.h }).where(eq(tables.id, input.id));
        return { ok: true };
      }),

    // ── Бронь (олдиндан жой банд қилиш, CloPOS-паритет) ──────────────────────
    // Рўйхат: кечагидан (ҳал қилинмаган no-show кўринсин) 60 кун олдинга.
    // Ҳамма кўради (флоор бейджи); яратиш/бекор — менежер/директор.
    reservations: protectedProcedure.query(async () => {
      const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const to = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      // Авто no-show: бронь вақтидан 45 дақ (30 «келмади» + 15) ўтган 'active' бронь →
      // 'cancelled' (аванс forfeit — куяди, касса ўзгармайди). Флоор поллда лениво ишлайди:
      // стол бўшайди, изи ҳисоботда/audit'да қолади. resolvedById null = авто (директор эмас).
      const staleBefore = new Date(Date.now() - 45 * 60 * 1000);
      const stale = await db
        .select({
          id: reservations.id,
          name: reservations.name,
          depositAmount: reservations.depositAmount,
          depositAppliedAt: reservations.depositAppliedAt,
        })
        .from(reservations)
        .where(and(eq(reservations.status, "active"), lt(reservations.reservedFor, staleBefore)));
      if (stale.length > 0) {
        await db.transaction(async (tx) => {
          for (const r of stale) {
            const pending = r.depositAmount > 0 && !r.depositAppliedAt;
            const upd = await tx
              .update(reservations)
              .set({
                status: "cancelled",
                depositResolution: pending ? "forfeit" : null,
                resolvedAt: new Date(),
              })
              .where(and(eq(reservations.id, r.id), eq(reservations.status, "active")))
              .returning({ id: reservations.id });
            if (upd.length > 0) {
              await logAudit(tx, {
                actorId: null,
                action: "reservation.no_show",
                entity: "reservation",
                entityId: r.id,
                summary: `Авто no-show: ${r.name} — 45 дақ келмади${pending ? ` · аванс ${r.depositAmount} куйди` : ""}`,
                meta: { auto: true, depositAmount: r.depositAmount },
              });
            }
          }
        });
      }
      return db
        .select({
          id: reservations.id,
          tableId: reservations.tableId,
          tableName: tables.name,
          hallId: tables.hallId,
          name: reservations.name,
          phone: reservations.phone,
          guests: reservations.guests,
          reservedFor: reservations.reservedFor,
          note: reservations.note,
          status: reservations.status,
          depositAmount: reservations.depositAmount,
          depositMethod: reservations.depositMethod,
          createdBy: users.name,
        })
        .from(reservations)
        .innerJoin(tables, eq(reservations.tableId, tables.id))
        .leftJoin(users, eq(reservations.createdById, users.id))
        .where(
          and(
            eq(reservations.status, "active"),
            gte(reservations.reservedFor, from),
            lt(reservations.reservedFor, to),
          ),
        )
        .orderBy(reservations.reservedFor);
    }),

    reservationCreate: managerProcedure
      .input(
        z.object({
          tableId: z.string().uuid(),
          name: z.string().trim().min(1).max(100),
          phone: z.string().trim().max(30).optional(),
          guests: z.number().int().positive().max(999).optional(),
          reservedFor: z.string().datetime({ offset: true }),
          note: z.string().trim().max(500).optional(),
          // Аванс: банкет олди тўлов. >0 бўлса усул мажбурий (пул кассага киради).
          depositAmount: z.number().int().nonnegative().max(100_000_000).default(0),
          depositMethod: z.enum(["cash", "card", "click", "payme", "humo"]).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const when = new Date(input.reservedFor);
        if (Number.isNaN(when.getTime()))
          throw new TRPCError({ code: "BAD_REQUEST", message: "Вақт нотўғри" });
        if (when.getTime() < Date.now() - 5 * 60 * 1000)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Ўтган вақтга бронь бўлмайди" });
        if (input.depositAmount > 0 && !input.depositMethod)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Аванс усулини танланг (нақд/карта…)" });
        const tbl = (
          await db.select({ id: tables.id, name: tables.name }).from(tables).where(eq(tables.id, input.tableId)).limit(1)
        )[0];
        if (!tbl) throw new TRPCError({ code: "NOT_FOUND", message: "Стол топилмади" });
        // Тўқнашув: шу столда ±90 дақиқа ичида бошқа фаол бронь бўлса — рад
        // (директор бошқа вақт/стол танласин; жимгина устма-уст ёзилмасин).
        const clashFrom = new Date(when.getTime() - 90 * 60 * 1000);
        const clashTo = new Date(when.getTime() + 90 * 60 * 1000);
        const clash = (
          await db
            .select({ id: reservations.id, at: reservations.reservedFor, name: reservations.name })
            .from(reservations)
            .where(
              and(
                eq(reservations.tableId, input.tableId),
                eq(reservations.status, "active"),
                gte(reservations.reservedFor, clashFrom),
                lt(reservations.reservedFor, clashTo),
              ),
            )
            .limit(1)
        )[0];
        if (clash)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Бу столда яқин вақтга бронь бор (${clash.name})`,
          });
        return db.transaction(async (tx) => {
          const row = (
            await tx
              .insert(reservations)
              .values({
                tableId: input.tableId,
                name: input.name,
                phone: input.phone?.trim() || null,
                guests: input.guests ?? null,
                reservedFor: when,
                note: input.note?.trim() || null,
                depositAmount: input.depositAmount,
                depositMethod: input.depositAmount > 0 ? input.depositMethod : null,
                createdById: ctx.user.id,
              })
              .returning({ id: reservations.id })
          )[0]!;
          await logAudit(tx, {
            actorId: ctx.user.id,
            action: "reservation.create",
            entity: "reservation",
            entityId: row.id,
            summary: `Бронь: ${input.name} · ${tbl.name} · ${when.toISOString()}${
              input.depositAmount > 0 ? ` · аванс ${input.depositAmount} (${input.depositMethod})` : ""
            }`,
            meta: { tableId: input.tableId, depositAmount: input.depositAmount, depositMethod: input.depositMethod },
          });
          return { id: row.id };
        });
      }),

    reservationCancel: managerProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          // Авансли броньда мажбурий: refund = нақд қайтарилди (кассадан чиқим),
          // forfeit = куйди (келмади — пул ресторанда қолади).
          resolution: z.enum(["refund", "forfeit"]).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        return db.transaction(async (tx) => {
          const res = (
            await tx
              .select({
                id: reservations.id,
                status: reservations.status,
                name: reservations.name,
                depositAmount: reservations.depositAmount,
                depositAppliedAt: reservations.depositAppliedAt,
              })
              .from(reservations)
              .where(eq(reservations.id, input.id))
              .limit(1)
              .for("update")
          )[0];
          if (!res) throw new TRPCError({ code: "NOT_FOUND" });
          if (res.status !== "active")
            throw new TRPCError({ code: "BAD_REQUEST", message: "Бронь аллақачон ҳал қилинган" });
          const pendingDeposit = res.depositAmount > 0 && !res.depositAppliedAt;
          if (pendingDeposit && !input.resolution)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Авансли бронь: Қайтариш ёки Куйдиришни танланг",
            });
          await tx
            .update(reservations)
            .set({
              status: "cancelled",
              depositResolution: pendingDeposit ? input.resolution : null,
              resolvedAt: new Date(),
              resolvedById: ctx.user.id,
            })
            .where(and(eq(reservations.id, input.id), eq(reservations.status, "active")));
          await logAudit(tx, {
            actorId: ctx.user.id,
            action: "reservation.cancel",
            entity: "reservation",
            entityId: res.id,
            summary: `Бронь бекор: ${res.name}${
              pendingDeposit
                ? ` · аванс ${res.depositAmount} ${input.resolution === "refund" ? "ҚАЙТАРИЛДИ (касса чиқим)" : "куйди"}`
                : ""
            }`,
            meta: { resolution: pendingDeposit ? input.resolution : null, depositAmount: res.depositAmount },
          });
          return { ok: true };
        });
      }),

    // ── Официант чақириш (CloPOS-паритет) ────────────────────────────────────
    // Меҳмон стол QR'ини сканерлайди → public саҳифа → callWaiter. Ходим POS'да
    // (App overlay) фаол чақириқларни кўради ва «Бордим» билан ёпади.
    callWaiter: publicProcedure
      .input(
        z.object({
          tableId: z.string().uuid(),
          kind: z.enum(["waiter", "bill", "water"]).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const kind = input.kind ?? "waiter";
        const tbl = (
          await db.select({ id: tables.id }).from(tables).where(eq(tables.id, input.tableId)).limit(1)
        )[0];
        if (!tbl) throw new TRPCError({ code: "NOT_FOUND", message: "Стол топилмади" });
        // Дедупе: шу стол+тур учун фаол чақириқ бўлса такрорламаймиз (спам ҳимояси).
        const active = (
          await db
            .select({ id: waiterCalls.id })
            .from(waiterCalls)
            .where(
              and(
                eq(waiterCalls.tableId, input.tableId),
                eq(waiterCalls.kind, kind),
                isNull(waiterCalls.resolvedAt),
              ),
            )
            .limit(1)
        )[0];
        if (active) return { ok: true, deduped: true };
        await db.insert(waiterCalls).values({ tableId: input.tableId, kind });
        return { ok: true, deduped: false };
      }),

    activeCalls: protectedProcedure.query(async () => {
      return db
        .select({
          id: waiterCalls.id,
          kind: waiterCalls.kind,
          createdAt: waiterCalls.createdAt,
          tableName: tables.name,
          hall: halls.name,
        })
        .from(waiterCalls)
        .innerJoin(tables, eq(waiterCalls.tableId, tables.id))
        .leftJoin(halls, eq(tables.hallId, halls.id))
        .where(isNull(waiterCalls.resolvedAt))
        .orderBy(waiterCalls.createdAt);
    }),

    resolveCall: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        await db
          .update(waiterCalls)
          .set({ resolvedAt: new Date(), resolvedById: ctx.user.id })
          .where(and(eq(waiterCalls.id, input.id), isNull(waiterCalls.resolvedAt)));
        return { ok: true };
      }),

    // ── QR-тўлов (стол устида): меҳмон стол QR'ини (?pay=tableId) очади → ўз
    // чекини + Payme/Click тап-линкини кўради. Public (auth йўқ, фақат ЎЗ чеки).
    // Тўлов тасдиғи ҳозирча кассир қўлда (webhook = кейинги фаза — payqr.ts изоҳи).
    guestBill: publicProcedure
      .input(z.object({ tableId: z.string().uuid() }))
      .query(async ({ input }) => {
        const tbl = (
          await db
            .select({ name: tables.name, hallId: tables.hallId })
            .from(tables)
            .where(eq(tables.id, input.tableId))
            .limit(1)
        )[0];
        if (!tbl) return { tableName: null, order: null, pay: null };
        const ord = (
          await db
            .select({
              id: orders.id,
              servicePct: orders.servicePct,
              isComp: orders.isComp,
              discountAmount: orders.discountAmount,
            })
            .from(orders)
            .where(
              and(
                eq(orders.status, "open"),
                eq(orders.hallId, tbl.hallId),
                eq(orders.tableNo, tbl.name),
              ),
            )
            .orderBy(orders.createdAt)
            .limit(1)
        )[0];
        if (!ord) return { tableName: tbl.name, order: null, pay: null };
        const items = await db
          .select({ name: orderItems.name, qty: orderItems.qty, price: orderItems.price })
          .from(orderItems)
          .where(eq(orderItems.orderId, ord.id));
        const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
        const service = Math.round((subtotal * ord.servicePct) / 100);
        const total = ord.isComp ? 0 : subtotal + service - ord.discountAmount;
        const cfgRows = await db
          .select({ key: appMeta.key, value: appMeta.value })
          .from(appMeta)
          .where(inArray(appMeta.key, ["payme_merchant_id", "click_service_id", "click_merchant_id"]));
        const m = new Map(cfgRows.map((r) => [r.key, r.value]));
        return {
          tableName: tbl.name,
          order: {
            orderRef: ord.id.slice(0, 8).toUpperCase(),
            items: items.map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
            subtotal,
            service,
            servicePct: ord.servicePct,
            total,
          },
          pay: {
            paymeMerchantId: m.get("payme_merchant_id") ?? null,
            clickServiceId: m.get("click_service_id") ?? null,
            clickMerchantId: m.get("click_merchant_id") ?? null,
          },
        };
      }),

    // ── QR-меню: меҳмон ўзи буюртма (?menu=tableId, public) ───────────────────
    // Меҳмон менюни кўради, таом танлайди → столнинг очиқ заказига қўшилади
    // (йўқ бўлса яратилади). КУХНЯГА автомат ЮБОРИЛМАЙДИ — официант кўриб
    // «Отправить» босади (нотўғри/сохта буюртмадан ҳимоя, food-safety).
    guestMenu: publicProcedure.query(async () => {
      return db
        .select({
          id: products.id,
          name: products.name,
          price: products.price,
          category: categories.name,
          stopped: products.stopped,
          soldByWeight: products.soldByWeight,
        })
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(and(eq(products.active, true), sql`${products.price} > 0`))
        .orderBy(products.type, products.name);
    }),

    guestAddItems: publicProcedure
      .input(
        z.object({
          tableId: z.string().uuid(),
          items: z
            .array(z.object({ productId: z.string().uuid(), qty: z.number().int().min(1).max(50) }))
            .min(1)
            .max(40),
        }),
      )
      .mutation(async ({ input }) => {
        const tbl = (
          await db
            .select({ name: tables.name, hallId: tables.hallId })
            .from(tables)
            .where(eq(tables.id, input.tableId))
            .limit(1)
        )[0];
        if (!tbl) throw new TRPCError({ code: "NOT_FOUND", message: "Стол топилмади" });
        const hall = (
          await db
            .select({ id: halls.id, servicePct: halls.servicePct })
            .from(halls)
            .where(eq(halls.id, tbl.hallId))
            .limit(1)
        )[0];
        if (!hall) throw new TRPCError({ code: "NOT_FOUND" });
        return db.transaction(async (tx) => {
          // Столнинг очиқ заказини топ ёки яс (меҳмон буюртмаси — waiterId null).
          const ord = (
            await tx
              .select({ id: orders.id, locked: orders.locked })
              .from(orders)
              .where(
                and(
                  eq(orders.status, "open"),
                  eq(orders.hallId, hall.id),
                  eq(orders.tableNo, tbl.name),
                ),
              )
              .orderBy(orders.createdAt)
              .limit(1)
              .for("update")
          )[0];
          let orderId: string;
          if (ord) {
            if (ord.locked)
              throw new TRPCError({ code: "BAD_REQUEST", message: "Чек блокланган — официантни чақиринг" });
            orderId = ord.id;
          } else {
            const row = (
              await tx
                .insert(orders)
                .values({ hallId: hall.id, tableNo: tbl.name, servicePct: hall.servicePct })
                .returning({ id: orders.id })
            )[0]!;
            orderId = row.id;
          }
          const prods = await tx
            .select({
              id: products.id,
              name: products.name,
              price: products.price,
              stopped: products.stopped,
              active: products.active,
              soldByWeight: products.soldByWeight,
            })
            .from(products)
            .where(inArray(products.id, input.items.map((i) => i.productId)));
          const pmap = new Map(prods.map((p) => [p.id, p]));
          let added = 0;
          for (const it of input.items) {
            const p = pmap.get(it.productId);
            // Стоп/вазнли/нофаол — жим ўтказамиз (меҳмон буларни қўшолмайди).
            if (!p || !p.active || p.price <= 0 || p.stopped || p.soldByWeight) continue;
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtext(${`${orderId}:${it.productId}`}))`,
            );
            const existing = (
              await tx
                .select()
                .from(orderItems)
                .where(and(eq(orderItems.orderId, orderId), eq(orderItems.productId, it.productId)))
                .limit(1)
            )[0];
            if (existing)
              await tx
                .update(orderItems)
                .set({ qty: existing.qty + it.qty })
                .where(eq(orderItems.id, existing.id));
            else
              await tx
                .insert(orderItems)
                .values({ orderId, productId: p.id, name: p.name, price: p.price, qty: it.qty });
            added += it.qty;
          }
          if (added === 0)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Танланган таомлар қўшилмади (стоп ёки вазнли — официантни чақиринг)",
            });
          await logAudit(tx, {
            actorId: null,
            action: "order.guest_add",
            entity: "order",
            entityId: orderId,
            summary: `QR-меҳмон буюртмаси: ${added} таом (${tbl.name})`,
            meta: { tableId: input.tableId, source: "qr", added },
          });
          return { ok: true, orderId, added };
        });
      }),

    menu: protectedProcedure.query(async () => {
      return db
        .select({
          id: products.id,
          name: products.name,
          price: products.price,
          category: categories.name,
          // Стоп-лист: менюда хира «СТОП» бўлиб кўринади (яширилмайди —
          // официант «тугаган»ини кўриб туриши мижоз олдида фойдали).
          stopped: products.stopped,
          // Оғирлик билан сотилади (гўшт кг) → плитка босилганда вазн сўралади.
          soldByWeight: products.soldByWeight,
        })
        .from(products)
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(and(eq(products.active, true), sql`${products.price} > 0`))
        .orderBy(products.type, products.name);
    }),

    openOrders: protectedProcedure.query(async ({ ctx }) => {
      const rows = await db
        .select({
          id: orders.id,
          tableNo: orders.tableNo,
          hallId: orders.hallId,
          guests: orders.guests,
          saleType: orders.saleType,
          createdAt: orders.createdAt,
          hall: halls.name,
          waiter: users.name,
          waiterId: orders.waiterId,
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
      // Официант ЎЗ заказини очади; бошқанинг банд столини кўради, лекин суммаси
      // ва ичи беркитилган (total=null → "банд"). Старшие роли — ҳаммаси очиқ.
      const isWaiter = ctx.user.role === "waiter";
      return rows.map((r) => {
        const mine = r.waiterId === ctx.user.id;
        return {
          ...r,
          qty: Number(r.qty),
          total: isWaiter && !mine ? null : Number(r.total),
          mine,
        };
      });
    }),

    order: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        await assertOrderAccess(db, ctx.user, input.id);
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
              locked: orders.locked,
              serviceWaived: orders.serviceWaived,
              saleType: orders.saleType,
              hallId: orders.hallId,
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
            weightG: orderItems.weightG,
            note: orderItems.note,
            course: orderItems.course,
          })
          .from(orderItems)
          .where(eq(orderItems.orderId, input.id));
        const payments = await db
          .select({ method: orderPayments.method, amount: orderPayments.amount })
          .from(orderPayments)
          .where(eq(orderPayments.orderId, input.id));
        // Бронь аванси: заказ броньдан очилган ва аванс ҳали ишлатилмаган бўлса —
        // тўлов экранида "Аванс: −N" бўлиб чиқади (ёпишда сервер avans қаторини ёзади).
        const res = (
          await db
            .select({
              name: reservations.name,
              depositAmount: reservations.depositAmount,
              depositAppliedAt: reservations.depositAppliedAt,
            })
            .from(reservations)
            .where(and(eq(reservations.orderId, input.id), eq(reservations.status, "seated")))
            .limit(1)
        )[0];
        const deposit = res && !res.depositAppliedAt ? res.depositAmount : 0;
        const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
        const service = Math.round((subtotal * head.servicePct) / 100);
        // Чекда чоп этилган жамдек: чегирма айирилади, текин (comp) = 0.
        const total = head.isComp
          ? 0
          : subtotal + service - head.discountAmount;
        return {
          ...head,
          checkNo: input.id.slice(0, 5).toUpperCase(),
          items,
          payments,
          subtotal,
          service,
          total,
          deposit,
          reservationName: res?.name ?? null,
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
          saleType: z.enum(["dine_in", "delivery", "takeaway"]).optional(),
          // Бронь ўтирғизиш: заказ шу броньга уланади (аванс ёпилишда ҳисобга киради).
          reservationId: z.string().uuid().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const hall = (
          await db.select().from(halls).where(eq(halls.id, input.hallId)).limit(1)
        )[0];
        if (!hall) throw new TRPCError({ code: "NOT_FOUND" });
        // Доставка/собой — хизмат ҳақи одатда олинмайди → авто-кечириш
        // (servicePct=0, serviceWaived=true). Кассир кейин қайта ёқа олади.
        const st = input.saleType ?? "dine_in";
        const waive = st !== "dine_in";
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
              servicePct: waive ? 0 : hall.servicePct,
              serviceWaived: waive,
              saleType: st,
            })
            .onConflictDoNothing()
            .returning()
        )[0];
        if (row) {
          // Бронь ўтирғизиш: фақат фаол броньни улаймиз (гонка/такрорда jim ўтамиз —
          // заказ барибир очилган бўлиши керак, бронсиз қолгани хавфсизроқ хато).
          if (input.reservationId) {
            await db
              .update(reservations)
              .set({ status: "seated", orderId: row.id })
              .where(
                and(eq(reservations.id, input.reservationId), eq(reservations.status, "active")),
              );
          }
          await logAudit(db, {
            actorId: ctx.user.id,
            action: "order.create",
            entity: "order",
            entityId: row.id,
            summary: `Заказ очилди${input.tableNo ? ` (стол ${input.tableNo})` : ""}`,
            meta: { saleType: st, tableNo: input.tableNo ?? null },
          });
          return { id: row.id };
        }
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
      .mutation(async ({ input, ctx }) => {
        await assertOrderAccess(db, ctx.user, input.id);
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
        await logAudit(db, {
          actorId: ctx.user.id,
          action: "order.update_meta",
          entity: "order",
          entityId: input.id,
          summary:
            input.guests !== undefined ? `Меҳмонлар сони: ${input.guests}` : "Изоҳ ўзгартирилди",
          meta: patch,
        });
        return { ok: true };
      }),

    // Стол кўчириш: очиқ заказни бошқа зал/столга. servicePct янги залдан олинади,
    // лекин сервис кечирилган (waived) заказда 0 лигича қолади.
    moveTable: protectedProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          hallId: z.string().uuid(),
          tableNo: z.string().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await assertOrderAccess(db, ctx.user, input.id);
        const hall = (
          await db.select().from(halls).where(eq(halls.id, input.hallId)).limit(1)
        )[0];
        if (!hall) throw new TRPCError({ code: "NOT_FOUND", message: "Зал топилмади" });
        const head = (
          await db
            .select({ serviceWaived: orders.serviceWaived })
            .from(orders)
            .where(eq(orders.id, input.id))
            .limit(1)
        )[0];
        if (!head) throw new TRPCError({ code: "NOT_FOUND", message: "Очиқ заказ топилмади" });
        const done = await db
          .update(orders)
          .set({
            hallId: hall.id,
            tableNo: input.tableNo ?? null,
            servicePct: head.serviceWaived ? 0 : hall.servicePct,
          })
          .where(and(eq(orders.id, input.id), eq(orders.status, "open")))
          .returning({ id: orders.id });
        if (!done.length) throw new TRPCError({ code: "NOT_FOUND", message: "Очиқ заказ топилмади" });
        await logAudit(db, {
          actorId: ctx.user.id,
          action: "order.move_table",
          entity: "order",
          entityId: input.id,
          summary: `Стол кўчирилди${input.tableNo ? ` → ${input.tableNo}` : ""}`,
          meta: { hallId: hall.id, tableNo: input.tableNo ?? null },
        });
        return { ok: true };
      }),

    // Заказларни бирлаштириш: from → to. Итемлар (қиймати бирлашади) ва кухня
    // тикетлари to'га кўчади; from "cancelled" бўлади (ўчирилмайди → аудит,
    // cascade хавфи йўқ). Иккиси ҳам очиқ бўлиши шарт. Менежер/директор.
    mergeOrders: managerProcedure
      .input(z.object({ fromId: z.string().uuid(), toId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
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
          // Асосий (to) чек тарихига — қайси чек унга қўшилди.
          await logAudit(tx, {
            actorId: ctx.user.id,
            action: "order.merge",
            entity: "order",
            entityId: input.toId,
            summary: `Чек бирлаштирилди ← ${input.fromId.slice(0, 5).toUpperCase()}`,
            meta: { fromId: input.fromId },
          });
          return { ok: true };
        });
      }),

    // 👨‍🍳 Официант алмаштириш (CloPOS «Изменить Сотрудник»): очиқ заказ
    // официантини бошқа фаол ходимга бириктиради. Роль: manager+ — официант
    // ўзиникини бошқага бера олмайди (тешик: официант жавобгарликдан қочмасин).
    reassignWaiter: managerProcedure
      .input(z.object({ orderId: z.string().uuid(), waiterId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        const head = (
          await db
            .select({ status: orders.status, locked: orders.locked, waiterId: orders.waiterId })
            .from(orders)
            .where(eq(orders.id, input.orderId))
            .limit(1)
        )[0];
        if (!head) throw new TRPCError({ code: "NOT_FOUND" });
        if (head.status !== "open")
          throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ ёпилган" });
        if (head.locked)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ блокланган" });
        if (head.waiterId === input.waiterId) return { ok: true };
        const waiter = (
          await db
            .select({ name: users.name, active: users.active })
            .from(users)
            .where(eq(users.id, input.waiterId))
            .limit(1)
        )[0];
        if (!waiter || !waiter.active)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Ходим топилмади ёки фаол эмас" });
        await db
          .update(orders)
          .set({ waiterId: input.waiterId })
          .where(and(eq(orders.id, input.orderId), eq(orders.status, "open")));
        await logAudit(db, {
          actorId: ctx.user.id,
          action: "order.reassign_waiter",
          entity: "order",
          entityId: input.orderId,
          summary: `Официант → ${waiter.name}`,
        });
        return { ok: true };
      }),

    // 🧹 Чекни тозалаш (CloPOS «Очистить чек»): ЮБОРИЛМАГАН позицияларни олиб
    // ташлайди — кухняга кетган (пиширилаётган) таомга тегмайди. Юборилган
    // миқдор = SUM(kitchen_ticket_items.qty). Блокланган/ёпилган заказда рад.
    clearOrder: protectedProcedure
      .input(z.object({ orderId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        await assertOrderAccess(db, ctx.user, input.orderId);
        return db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.orderId}))`);
          const head = (
            await tx
              .select({ status: orders.status, locked: orders.locked })
              .from(orders)
              .where(eq(orders.id, input.orderId))
              .for("update")
          )[0];
          if (!head) throw new TRPCError({ code: "NOT_FOUND" });
          if (head.status !== "open")
            throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ ёпилган" });
          if (head.locked)
            throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ блокланган" });

          // Маҳсулот бўйича кухняга юборилган умумий миқдор.
          const sentRows = await tx
            .select({
              productId: kitchenTicketItems.productId,
              sent: sql<number>`sum(${kitchenTicketItems.qty})::int`,
            })
            .from(kitchenTicketItems)
            .innerJoin(kitchenTickets, eq(kitchenTicketItems.ticketId, kitchenTickets.id))
            .where(eq(kitchenTickets.orderId, input.orderId))
            .groupBy(kitchenTicketItems.productId);
          const sentMap = new Map(sentRows.map((r) => [r.productId, r.sent]));

          const items = await tx
            .select()
            .from(orderItems)
            .where(eq(orderItems.orderId, input.orderId));
          let removed = 0;
          for (const it of items) {
            const sent = it.productId ? sentMap.get(it.productId) ?? 0 : 0;
            if (it.qty <= sent) continue; // ҳаммаси юборилган — тегмаймиз
            if (sent === 0) {
              await tx.delete(orderItems).where(eq(orderItems.id, it.id));
              removed += it.qty;
            } else {
              await tx.update(orderItems).set({ qty: sent }).where(eq(orderItems.id, it.id));
              removed += it.qty - sent;
            }
          }
          if (removed > 0)
            await logAudit(tx, {
              actorId: ctx.user.id,
              action: "order.clear",
              entity: "order",
              entityId: input.orderId,
              summary: `Чек тозаланди (${removed} та юборилмаган позиция)`,
            });
          return { ok: true, removed };
        });
      }),

    // 👤 Мижоз бириктириш (CloPOS «Добавить клиента»): очиқ заказга лоялти/қарз
    // учун мижоз. Роль: cashier+. Ёпилган/блокланган заказда рад.
    attachCustomer: cashierProcedure
      .input(z.object({ orderId: z.string().uuid(), customerId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        await assertOrderAccess(db, ctx.user, input.orderId);
        const head = (
          await db
            .select({ status: orders.status, locked: orders.locked })
            .from(orders)
            .where(eq(orders.id, input.orderId))
            .limit(1)
        )[0];
        if (!head) throw new TRPCError({ code: "NOT_FOUND" });
        if (head.status !== "open")
          throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ ёпилган" });
        if (head.locked)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ блокланган" });
        const cust = (
          await db
            .select({ name: customers.name })
            .from(customers)
            .where(eq(customers.id, input.customerId))
            .limit(1)
        )[0];
        if (!cust) throw new TRPCError({ code: "NOT_FOUND", message: "Мижоз топилмади" });
        await db
          .update(orders)
          .set({ customerId: input.customerId })
          .where(and(eq(orders.id, input.orderId), eq(orders.status, "open")));
        await logAudit(db, {
          actorId: ctx.user.id,
          action: "order.attach_customer",
          entity: "order",
          entityId: input.orderId,
          summary: `Мижоз: ${cust.name}`,
        });
        return { ok: true };
      }),

    // Мижозни олиб ташлаш (заказдан).
    detachCustomer: cashierProcedure
      .input(z.object({ orderId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        await assertOrderAccess(db, ctx.user, input.orderId);
        await db
          .update(orders)
          .set({ customerId: null })
          .where(and(eq(orders.id, input.orderId), eq(orders.status, "open")));
        await logAudit(db, {
          actorId: ctx.user.id,
          action: "order.detach_customer",
          entity: "order",
          entityId: input.orderId,
          summary: "Мижоз олиб ташланди",
        });
        return { ok: true };
      }),

    // 🏷 Чегирма (CloPOS «Скидка»): очиқ заказга чегирма суммаси (so'm). Роль:
    // director/manager (пулга тегади — тешик №12). Ёпишдан ОЛДИН қўяди (пречек
    // учун); close ҳам input.discount берса устун (қуйида ?? бирлашган). Сабаб
    // мажбурий. amount=0 → чегирмани олиб ташлаш. Текин заказга рад.
    setDiscount: managerProcedure
      .input(
        z.object({
          orderId: z.string().uuid(),
          amount: z.number().int().nonnegative(),
          reason: z.string().trim().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (input.amount > 0 && !input.reason)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Чегирма сабаби мажбурий" });
        const head = (
          await db
            .select({ status: orders.status, locked: orders.locked, isComp: orders.isComp })
            .from(orders)
            .where(eq(orders.id, input.orderId))
            .limit(1)
        )[0];
        if (!head) throw new TRPCError({ code: "NOT_FOUND" });
        if (head.status !== "open")
          throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ ёпилган" });
        if (head.locked)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ блокланган" });
        if (head.isComp)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Текин заказга чегирма қўшиб бўлмайди" });
        await db
          .update(orders)
          .set({
            discountAmount: input.amount,
            discountReason: input.amount > 0 ? (input.reason ?? null) : null,
          })
          .where(and(eq(orders.id, input.orderId), eq(orders.status, "open")));
        await logAudit(db, {
          actorId: ctx.user.id,
          action: input.amount > 0 ? "order.discount" : "order.discount_remove",
          entity: "order",
          entityId: input.orderId,
          summary:
            input.amount > 0 ? `Чегирма: ${input.amount} (${input.reason})` : "Чегирма олиб ташланди",
        });
        return { ok: true };
      }),

    // 📜 Чек тарихи (CloPOS «История чека»): заказ бўйича ҳамма амал timeline'и —
    // ким, қачон, нима қилди. audit_log'дан (entity='order') ўқийди — алоҳида
    // жадвал шарт эмас. Официант фақат ўзиникини (assertOrderAccess).
    orderEvents: protectedProcedure
      .input(z.object({ orderId: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        await assertOrderAccess(db, ctx.user, input.orderId);
        const actor = alias(users, "ev_actor");
        return db
          .select({
            action: auditLog.action,
            summary: auditLog.summary,
            meta: auditLog.meta,
            createdAt: auditLog.createdAt,
            actorName: actor.name,
          })
          .from(auditLog)
          .leftJoin(actor, eq(auditLog.actorId, actor.id))
          .where(and(eq(auditLog.entity, "order"), eq(auditLog.entityId, input.orderId)))
          .orderBy(desc(auditLog.createdAt));
      }),

    addItem: protectedProcedure
      .input(
        z.object({
          orderId: z.string().uuid(),
          productId: z.string().uuid(),
          delta: z.number().int(),
          // Клиент op-id → offline/retry replay delta'ни икки марта қўлламайди.
          opId: z.string().uuid().optional(),
          // Кухняга юборилган таомни камайтиришда сабаб (void журналига ёзилади).
          voidReason: z.string().trim().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        // Serialize concurrent adds of the SAME product to one order (rapid
        // double-taps) so they merge into one row instead of racing two inserts.
        return db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${`${input.orderId}:${input.productId}`}))`,
          );
          await assertOrderAccess(tx, ctx.user, input.orderId);
          // Ёпилган заказга таом қўшиб бўлмайди (списание аллақачон ёзилган →
          // тўланмаган+чегирилмаган "текин" таом бўлмасин; offline replay ҳам
          // ёпилган заказга тушмасин). Бошқа мутациялар ҳам шу гейтни ишлатади.
          const oHead = (
            await tx
              .select({ status: orders.status, locked: orders.locked })
              .from(orders)
              .where(eq(orders.id, input.orderId))
              .limit(1)
              .for("update")
          )[0];
          if (!oHead) throw new TRPCError({ code: "NOT_FOUND" });
          if (oHead.status !== "open")
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Заказ ёпилган — таом қўшиб бўлмайди",
            });
          // Заказ-блок: блокланган чекка таом қўшиб/ўзгартириб бўлмайди.
          if (oHead.locked)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Заказ блокланган — аввал блокни ечинг",
            });
          // Стоп-лист: стопдаги таомни ҚЎШИБ бўлмайди. Камайтириш (delta<0)
          // мумкин — тугаган таомни чекдан олиб ташлашга тўсиқ бўлмасин.
          if (input.delta > 0) {
            const pHead = (
              await tx
                .select({ stopped: products.stopped })
                .from(products)
                .where(eq(products.id, input.productId))
                .limit(1)
            )[0];
            if (!pHead)
              throw new TRPCError({ code: "NOT_FOUND", message: "Маҳсулот топилмади" });
            if (pHead.stopped)
              throw new TRPCError({ code: "BAD_REQUEST", message: "Таом стопда — тугаган" });
          }
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
                  note: input.voidReason ?? null,
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
            // Чек тарихи (CloPOS «добавлено/удалено N x таом»).
            if (input.delta !== 0)
              await logAudit(tx, {
                actorId: ctx.user.id,
                action: input.delta > 0 ? "order.add_item" : "order.remove_item",
                entity: "order",
                entityId: input.orderId,
                summary:
                  input.delta > 0
                    ? `Қўшилди: ${input.delta} x ${existing.name}`
                    : `Олинди: ${-input.delta} x ${existing.name}`,
                meta: { productId: input.productId, delta: input.delta, name: existing.name },
              });
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
            await logAudit(tx, {
              actorId: ctx.user.id,
              action: "order.add_item",
              entity: "order",
              entityId: input.orderId,
              summary: `Қўшилди: ${input.delta} x ${p.name}`,
              meta: { productId: p.id, delta: input.delta, name: p.name },
            });
          }
          return { ok: true };
        });
      }),

    // Таом изоҳи («пиёзсиз», «соус алоҳида»...) — официант ўз заказида ёза
    // олади. Изоҳ ЮБОРИЛМАГАН қисм билан кухня тикетига кетади; аллақачон
    // юборилган таомга изоҳ ўзгартирилса — қайта юбормайди (реprint қилса чиқади).
    setItemNote: protectedProcedure
      .input(
        z.object({
          orderId: z.string().uuid(),
          productId: z.string().uuid(),
          note: z.string().trim().max(120),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await assertOrderAccess(db, ctx.user, input.orderId);
        const head = (
          await db
            .select({ status: orders.status, locked: orders.locked })
            .from(orders)
            .where(eq(orders.id, input.orderId))
            .limit(1)
        )[0];
        if (!head) throw new TRPCError({ code: "NOT_FOUND" });
        if (head.status !== "open")
          throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ ёпилган" });
        if (head.locked)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ блокланган" });
        await db
          .update(orderItems)
          .set({ note: input.note === "" ? null : input.note })
          .where(
            and(eq(orderItems.orderId, input.orderId), eq(orderItems.productId, input.productId)),
          );
        return { ok: true };
      }),

    // 🔒 Заказ-блок (CloPOS-паритет): кассир/менежер очиқ заказни музлатади —
    // официант хатодан таом қўшмасин. Блокланганда addItem/setItemNote рад
    // этилади. Ким блокладими/ечдими — аудитга ёзилади.
    setLock: cashierProcedure
      .input(z.object({ orderId: z.string().uuid(), locked: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        await assertOrderAccess(db, ctx.user, input.orderId);
        const head = (
          await db
            .select({ status: orders.status, locked: orders.locked })
            .from(orders)
            .where(eq(orders.id, input.orderId))
            .limit(1)
        )[0];
        if (!head) throw new TRPCError({ code: "NOT_FOUND" });
        if (head.status !== "open")
          throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ ёпилган" });
        if (head.locked === input.locked) return { ok: true, locked: input.locked };
        await db
          .update(orders)
          .set({
            locked: input.locked,
            lockedAt: input.locked ? new Date() : null,
            lockedById: input.locked ? ctx.user.id : null,
          })
          .where(eq(orders.id, input.orderId));
        await logAudit(db, {
          actorId: ctx.user.id,
          action: input.locked ? "order.lock" : "order.unlock",
          entity: "order",
          entityId: input.orderId,
          summary: input.locked ? "Заказ блокланди" : "Заказ блокдан ечилди",
        });
        return { ok: true, locked: input.locked };
      }),

    // 🍽 Хизмат ҳақини кечириш/тиклаш (CloPOS «Удалить плату за обслуживание»):
    // кечирилса servicePct=0 (пул автоматик 0 — ҳисоб-код тегилмайди), тикланса
    // залнинг сервис %и қайтади. serviceWaived флаг — UI/аудит учун.
    setService: cashierProcedure
      .input(z.object({ orderId: z.string().uuid(), waived: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        await assertOrderAccess(db, ctx.user, input.orderId);
        const head = (
          await db
            .select({
              status: orders.status,
              locked: orders.locked,
              serviceWaived: orders.serviceWaived,
              servicePct: orders.servicePct,
              hallId: orders.hallId,
            })
            .from(orders)
            .where(eq(orders.id, input.orderId))
            .limit(1)
        )[0];
        if (!head) throw new TRPCError({ code: "NOT_FOUND" });
        if (head.status !== "open")
          throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ ёпилган" });
        if (head.locked)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ блокланган — аввал блокни ечинг" });
        if (head.serviceWaived === input.waived)
          return { ok: true, waived: input.waived, pct: head.servicePct };
        let pct = 0;
        if (!input.waived) {
          const hall = (
            await db
              .select({ servicePct: halls.servicePct })
              .from(halls)
              .where(eq(halls.id, head.hallId))
              .limit(1)
          )[0];
          pct = hall?.servicePct ?? 0;
        }
        const done = await db
          .update(orders)
          .set({ serviceWaived: input.waived, servicePct: pct })
          .where(and(eq(orders.id, input.orderId), eq(orders.status, "open")))
          .returning({ id: orders.id });
        if (!done.length)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ ёпилган" });
        await logAudit(db, {
          actorId: ctx.user.id,
          action: input.waived ? "order.service_waive" : "order.service_restore",
          entity: "order",
          entityId: input.orderId,
          summary: input.waived ? "Хизмат ҳақи кечирилди" : "Хизмат ҳақи тикланди",
        });
        return { ok: true, waived: input.waived, pct };
      }),

    // Сотув турини ўзгартириш (CloPOS «Изменить тип продажи»): зал/доставка/собой.
    // Сервис create'даги қоида билан қайта ҳисобланади: зал → зал %и, доставка/
    // собой → 0 (авто-кечириш). Пулга тегувчи бўлгани учун setService каби
    // КАССИР-гейт (официант create'да тур танлай олади, кейин ўзгартира олмайди)
    // + audit_log (анти-суистеъмол).
    setSaleType: cashierProcedure
      .input(
        z.object({
          orderId: z.string().uuid(),
          saleType: z.enum(["dine_in", "delivery", "takeaway"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await assertOrderAccess(db, ctx.user, input.orderId);
        const head = (
          await db
            .select({
              status: orders.status,
              locked: orders.locked,
              saleType: orders.saleType,
              servicePct: orders.servicePct,
              hallId: orders.hallId,
            })
            .from(orders)
            .where(eq(orders.id, input.orderId))
            .limit(1)
        )[0];
        if (!head || head.status !== "open")
          throw new TRPCError({ code: "NOT_FOUND", message: "Очиқ заказ топилмади" });
        if (head.locked)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ блокланган — аввал блокни ечинг" });
        if (head.saleType === input.saleType)
          return { ok: true, saleType: input.saleType, pct: head.servicePct };
        const waive = input.saleType !== "dine_in";
        let pct = 0;
        if (!waive) {
          const hall = (
            await db
              .select({ servicePct: halls.servicePct })
              .from(halls)
              .where(eq(halls.id, head.hallId))
              .limit(1)
          )[0];
          pct = hall?.servicePct ?? 0;
        }
        const done = await db
          .update(orders)
          .set({ saleType: input.saleType, serviceWaived: waive, servicePct: pct })
          .where(and(eq(orders.id, input.orderId), eq(orders.status, "open")))
          .returning({ id: orders.id });
        if (!done.length)
          throw new TRPCError({ code: "NOT_FOUND", message: "Очиқ заказ топилмади" });
        await logAudit(db, {
          actorId: ctx.user.id,
          action: "order.sale_type",
          entity: "order",
          entityId: input.orderId,
          summary: `Сотув тури: ${head.saleType} → ${input.saleType} (сервис ${pct}%)`,
        });
        return { ok: true, saleType: input.saleType, pct };
      }),

    // ⚖️ Оғирлик билан сотиш (CloPOS «Продажи по порциям»): гўшт кг таомга вазн
    // киритилади → чизиқ нархи = кг-нарх × грамм/1000 (jami), qty=1. Ҳар вазнлаш
    // алоҳида чизиқ. weightG фақат кўрсатиш/чек учун — пул math ЎЗГАРМАЙДИ.
    addWeighed: protectedProcedure
      .input(
        z.object({
          orderId: z.string().uuid(),
          productId: z.string().uuid(),
          grams: z.number().int().min(1).max(50000),
          opId: z.string().uuid().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await assertOrderAccess(db, ctx.user, input.orderId);
        const head = (
          await db
            .select({ status: orders.status, locked: orders.locked })
            .from(orders)
            .where(eq(orders.id, input.orderId))
            .limit(1)
        )[0];
        if (!head) throw new TRPCError({ code: "NOT_FOUND" });
        if (head.status !== "open")
          throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ ёпилган" });
        if (head.locked) throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ блокланган" });
        if (input.opId) {
          const fresh = await db
            .insert(clientOps)
            .values({ opId: input.opId })
            .onConflictDoNothing()
            .returning({ opId: clientOps.opId });
          if (fresh.length === 0) return { ok: true };
        }
        const p = (
          await db.select().from(products).where(eq(products.id, input.productId)).limit(1)
        )[0];
        if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Маҳсулот топилмади" });
        if (p.stopped) throw new TRPCError({ code: "BAD_REQUEST", message: "Таом стопда — тугаган" });
        const linePrice = Math.round((p.price * input.grams) / 1000);
        await db.insert(orderItems).values({
          orderId: input.orderId,
          productId: p.id,
          name: p.name,
          price: linePrice,
          qty: 1,
          weightG: input.grams,
        });
        return { ok: true };
      }),

    // ⑂ Счётни бўлиш (CloPOS «Разделить заказ»): танланган таомларни (тўлиқ ёки
    // қисман) ЯНГИ оғайни-заказга КЎЧИРАДИ (бир стол). Ҳар заказ ўз субтоталини
    // санайди → пул math ЎЗГАРМАЙДИ (price×qty бўлинади, drift йўқ) — pay/close
    // оқими умуман тегилмайди. Кухня «юборилган»лиги: кўчирилган миқдорнинг
    // ЮБОРИЛГАН қисми (min) янги заказга синтетик "transfer" тикет билан ўтади
    // (bumpedAt=now → KDS'да кўринмайди, босилмайди) → таом иккинчи марта
    // пиширилмайди. Юборилмаган қисм ҳақиқий юборилмаган бўлиб қолади (янги
    // заказ уни кухняга юбора олади). mergeOrders'нинг тескариси.
    splitOrder: protectedProcedure
      .input(
        z.object({
          sourceId: z.string().uuid(),
          items: z
            .array(
              z.object({
                orderItemId: z.string().uuid(),
                qty: z.number().int().positive(),
              }),
            )
            .min(1),
          // идемпотент: retry дубль заказ яратмасин.
          newId: z.string().uuid().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        return db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.sourceId}))`);
          await assertOrderAccess(tx, ctx.user, input.sourceId);
          const src = (
            await tx
              .select({
                status: orders.status,
                locked: orders.locked,
                hallId: orders.hallId,
                tableNo: orders.tableNo,
                servicePct: orders.servicePct,
                saleType: orders.saleType,
                serviceWaived: orders.serviceWaived,
              })
              .from(orders)
              .where(eq(orders.id, input.sourceId))
              .limit(1)
              .for("update")
          )[0];
          if (!src) throw new TRPCError({ code: "NOT_FOUND" });
          if (src.status !== "open")
            throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ ёпилган — бўлиб бўлмайди" });
          if (src.locked)
            throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ блокланган — аввал блокни ечинг" });

          // Идемпотентлик: newId билан заказ аллақачон яратилган бўлса — қайтарамиз.
          if (input.newId) {
            const existing = (
              await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, input.newId)).limit(1)
            )[0];
            if (existing) return { id: existing.id };
          }

          const srcItems = await tx
            .select()
            .from(orderItems)
            .where(eq(orderItems.orderId, input.sourceId));
          const byId = new Map(srcItems.map((i) => [i.id, i]));
          // Дубликат orderItemId сўровини бирлаштириш (клиент хатоси ҳимояси).
          const wanted = new Map<string, number>();
          for (const r of input.items) wanted.set(r.orderItemId, (wanted.get(r.orderItemId) ?? 0) + r.qty);

          const moves: { it: (typeof srcItems)[number]; qty: number }[] = [];
          for (const [oiId, qty] of wanted) {
            const it = byId.get(oiId);
            if (!it) throw new TRPCError({ code: "BAD_REQUEST", message: "Таом бу заказда йўқ" });
            if (qty > it.qty)
              throw new TRPCError({ code: "BAD_REQUEST", message: "Кўчириш миқдори кўп" });
            if (it.weightG != null && qty !== it.qty)
              throw new TRPCError({ code: "BAD_REQUEST", message: "Оғирлик таомини бўлиб бўлмайди" });
            moves.push({ it, qty });
          }
          const totalSrcQty = srcItems.reduce((s, i) => s + i.qty, 0);
          const totalMoveQty = moves.reduce((s, m) => s + m.qty, 0);
          if (totalMoveQty >= totalSrcQty)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Ҳаммасини бўлиб бўлмайди — камида битта таом қолсин",
            });

          // Янги оғайни-заказ (шу стол/зал/servicePct/сотув тури/waived).
          const newRow = (
            await tx
              .insert(orders)
              .values({
                ...(input.newId ? { id: input.newId } : {}),
                hallId: src.hallId,
                tableNo: src.tableNo,
                waiterId: ctx.user.id,
                servicePct: src.servicePct,
                saleType: src.saleType,
                serviceWaived: src.serviceWaived,
              })
              .returning({ id: orders.id })
          )[0];
          if (!newRow) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
          const newId = newRow.id;

          // Итемларни кўчириш + кухня "юборилган" қопламини йиғиш.
          const transfer: { productId: string; name: string; qty: number; note: string | null }[] = [];
          for (const { it, qty } of moves) {
            // Бу чизиқнинг ЮБОРИЛГАН миқдори (генерация floor'и билан — addItem семантикаси).
            let sent = 0;
            if (it.productId) {
              const sentRow = (
                await tx
                  .select({ s: sql<number>`coalesce(sum(${kitchenTicketItems.qty}), 0)` })
                  .from(kitchenTicketItems)
                  .innerJoin(kitchenTickets, eq(kitchenTicketItems.ticketId, kitchenTickets.id))
                  .where(
                    and(
                      eq(kitchenTickets.orderId, input.sourceId),
                      eq(kitchenTicketItems.productId, it.productId),
                      gte(kitchenTickets.createdAt, it.createdAt),
                    ),
                  )
              )[0];
              sent = Math.min(it.qty, Number(sentRow?.s ?? 0));
            }
            const transferSent = Math.min(qty, sent);
            if (it.productId && transferSent > 0)
              transfer.push({ productId: it.productId, name: it.name, qty: transferSent, note: it.note });

            if (qty === it.qty) {
              // Тўлиқ чизиқ — orderId'ни кўчирамиз (weightG ҳам ўзи билан кетади).
              await tx.update(orderItems).set({ orderId: newId }).where(eq(orderItems.id, it.id));
            } else {
              // Қисман — манбани камайтириб, янги заказга янги чизиқ (оддий дона).
              await tx.update(orderItems).set({ qty: it.qty - qty }).where(eq(orderItems.id, it.id));
              await tx.insert(orderItems).values({
                orderId: newId,
                productId: it.productId,
                name: it.name,
                price: it.price,
                qty,
                note: it.note,
              });
            }
          }

          // Синтетик transfer-тикет: юборилган таом янги заказда ҳам "юборилган"
          // саналсин (иккинчи марта пиширилмасин). bumpedAt=now → KDS'да кўринмайди.
          if (transfer.length) {
            const tk = (
              await tx
                .insert(kitchenTickets)
                .values({
                  orderId: newId,
                  createdById: ctx.user.id,
                  bumpedAt: new Date(),
                  bumpedById: ctx.user.id,
                })
                .returning({ id: kitchenTickets.id })
            )[0];
            if (tk) {
              await tx.insert(kitchenTicketItems).values(
                transfer.map((t) => ({
                  ticketId: tk.id,
                  productId: t.productId,
                  name: t.name,
                  qty: t.qty,
                  note: t.note,
                })),
              );
            }
          }

          await logAudit(tx, {
            actorId: ctx.user.id,
            action: "order.split",
            entity: "order",
            entityId: input.sourceId,
            summary: `Счёт бўлинди → ${newId.slice(0, 5).toUpperCase()} (${totalMoveQty} таом)`,
          });
          return { id: newId };
        });
      }),

    // Курс/подача: таомга курс белгилаш (официант cart'да тап билан 1→2→3).
    // Фақат очиқ, блокланмаган заказда. Юборилган таом ҳам қайта белгиланиши
    // мумкин — фақат кейинги тикет snapshot'ига таъсир қилади (аввалгиси ўзгармас).
    setItemCourse: protectedProcedure
      .input(z.object({ orderItemId: z.string().uuid(), course: z.number().int().min(1).max(9) }))
      .mutation(async ({ input, ctx }) => {
        const row = (
          await db
            .select({ orderId: orderItems.orderId })
            .from(orderItems)
            .where(eq(orderItems.id, input.orderItemId))
            .limit(1)
        )[0];
        if (!row) throw new TRPCError({ code: "NOT_FOUND" });
        await assertOrderAccess(db, ctx.user, row.orderId);
        const oHead = (
          await db
            .select({ status: orders.status, locked: orders.locked })
            .from(orders)
            .where(eq(orders.id, row.orderId))
            .limit(1)
        )[0];
        if (!oHead || oHead.status !== "open")
          throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ ёпилган" });
        if (oHead.locked)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Чек блокланган" });
        await db
          .update(orderItems)
          .set({ course: input.course })
          .where(eq(orderItems.id, input.orderItemId));
        return { ok: true };
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
          await assertOrderAccess(tx, ctx.user, input.orderId);
          const oHead = (
            await tx
              .select({ status: orders.status })
              .from(orders)
              .where(eq(orders.id, input.orderId))
              .limit(1)
          )[0];
          if (!oHead) throw new TRPCError({ code: "NOT_FOUND" });
          if (oHead.status !== "open")
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Заказ ёпилган — кухняга юбориб бўлмайди",
            });
          const t = await flushKitchenTicket(tx, input.orderId, ctx.user.id, input.ticketId);
          // Чек тарихи (CloPOS «Отправлен в отдел») — фақат ҳақиқатан юборилса.
          if (t && t.items.length)
            await logAudit(tx, {
              actorId: ctx.user.id,
              action: "order.send_kitchen",
              entity: "order",
              entityId: input.orderId,
              summary: `Кухняга ${t.items.length} хил таом юборилди`,
              meta: { ticketId: t.id },
            });
          return t;
        });
        // тx COMMIT'дан кейин — принтерга (net I/O тx ушламасин, блокламасин)
        if (ticket) void firePrintKitchen(input.orderId, ticket.items);
        return ticket ?? { id: null, createdAt: null, items: [] };
      }),

    // Принтер ўчиб қолган бўлса — мавжуд тикетни/чекни қайта чоп.
    reprintTicket: protectedProcedure
      .input(z.object({ ticketId: z.string().uuid(), reason: z.string().trim().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const head = (
          await db
            .select({ orderId: kitchenTickets.orderId })
            .from(kitchenTickets)
            .where(eq(kitchenTickets.id, input.ticketId))
            .limit(1)
        )[0];
        if (!head) throw new TRPCError({ code: "NOT_FOUND" });
        const items = await db
          .select({ name: kitchenTicketItems.name, qty: kitchenTicketItems.qty, note: kitchenTicketItems.note, station: kitchenTicketItems.station })
          .from(kitchenTicketItems)
          .where(eq(kitchenTicketItems.ticketId, input.ticketId));
        // Дубликат-чоп журнали (тешик №22) — чоп'дан ОЛДИН ёзилади.
        await db.insert(reprintLog).values({
          orderId: head.orderId,
          ticketId: input.ticketId,
          kind: "ticket",
          reason: input.reason,
          performedById: ctx.user.id,
        });
        void firePrintKitchen(head.orderId, items);
        return { ok: true };
      }),

    reprintCheck: protectedProcedure
      .input(z.object({ orderId: z.string().uuid(), reason: z.string().trim().min(1) }))
      .mutation(async ({ input, ctx }) => {
        await db.insert(reprintLog).values({
          orderId: input.orderId,
          kind: "check",
          reason: input.reason,
          performedById: ctx.user.id,
        });
        void firePrintCheck(input.orderId);
        return { ok: true };
      }),

    precheck: protectedProcedure
      .input(z.object({ orderId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        const head = (await db.select({ status: orders.status }).from(orders).where(eq(orders.id, input.orderId)).limit(1))[0];
        if (!head) throw new TRPCError({ code: "NOT_FOUND" });
        if (head.status !== "open")
          throw new TRPCError({ code: "BAD_REQUEST", message: "Заказ ёпилган — пречек керак эмас" });
        await db.insert(reprintLog).values({ orderId: input.orderId, kind: "precheck", reason: null, performedById: ctx.user.id });
        void firePrintPrecheck(input.orderId);
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
          .select({ name: kitchenTicketItems.name, qty: kitchenTicketItems.qty, note: kitchenTicketItems.note, station: kitchenTicketItems.station })
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
          // FOR UPDATE — параллел addItem/sendToKitchen шу қаторни кутсин
          // (ёпилиш пайтида таом қўшилиб, чегирилмай қолмасин; addItem ҳам
          // шу қаторни FOR UPDATE қилади → сериаллашади).
          const head = (
            await tx
              .select({
                status: orders.status,
                servicePct: orders.servicePct,
                // Ёпишдан олдин setDiscount қўйган чегирма (input.discount бермаса шу).
                discountAmount: orders.discountAmount,
              })
              .from(orders)
              .where(eq(orders.id, input.id))
              .limit(1)
              .for("update")
          )[0];
          if (!head) throw new TRPCError({ code: "NOT_FOUND" });
          if (head.status === "cancelled")
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Бекор қилинган заказни ёпиб бўлмайди",
            });
          if (head.status === "closed")
            return { ok: true, alreadyClosed: true, deducted: 0, skipped: 0 };

          // Бронь аванси (FOR UPDATE — параллел close/cancel сериаллашсин):
          // ишлатилмаган аванс чекнинг бир қисмини қоплайди → 'avans' тўлов
          // қатори бўлиб ёзилади (нақд тортмага КИРМАЙДИ — пул бронь куни олинган).
          const resRow = (
            await tx
              .select({
                id: reservations.id,
                depositAmount: reservations.depositAmount,
              })
              .from(reservations)
              .where(
                and(
                  eq(reservations.orderId, input.id),
                  eq(reservations.status, "seated"),
                  isNull(reservations.depositAppliedAt),
                  gt(reservations.depositAmount, 0),
                ),
              )
              .limit(1)
              .for("update")
          )[0];
          const deposit = resRow?.depositAmount ?? 0;
          if (input.comp && deposit > 0)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Авансли заказни текин ёпиб бўлмайди — аввал броньдаги авансни ҳал қилинг",
            });

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
            // input.discount (ёпишда берилган) устун; бўлмаса setDiscount қўйгани.
            const discount = input.discount?.amount ?? head.discountAmount ?? 0;
            if (discount > total)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Чегирма (${discount}) чек жамидан (${total}) катта`,
              });
            if (deposit > total - discount)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Аванс (${deposit}) чек жамидан (${total - discount}) катта — директор броньни бекор қилиб фарқни нақд қайтарсин`,
              });
            const paid = pays.reduce((s, p) => s + p.amount, 0);
            if (paid + deposit !== total - discount)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Тўлов суммаси (${paid}${deposit ? ` + аванс ${deposit}` : ""}) чек жамига (${total - discount}) тенг эмас.`,
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

          // Аванс тушумга айланади: 'avans' қатори + идемпотент-белги (flip
          // ютган транзакциягина ёзади — иккиланиш йўқ).
          if (deposit > 0 && resRow) {
            await tx
              .insert(orderPayments)
              .values({ orderId: input.id, method: "avans", amount: deposit });
            await tx
              .update(reservations)
              .set({ depositAppliedAt: new Date() })
              .where(eq(reservations.id, resRow.id));
          }

          // Carcass meat balances (meat is tracked at carcass, not cut, level).
          const { moves, skippedNames } = await computeOrderStockMoves(
            tx,
            input.id,
            ctx.user.id,
            "sale_writeoff",
          );

          if (moves.length) await tx.insert(stockMovements).values(moves);
          // Чек тарихи (CloPOS «закрыл чек Наличными N») — тўлов усули + сумма.
          const methodUz: Record<string, string> = {
            cash: "Нақд", card: "Карта", click: "Click", payme: "PayMe", humo: "Humo", debt: "Қарз",
          };
          const closeSummary = input.comp
            ? `Текин ёпилди (${input.comp.reason})`
            : `Ёпилди: ${pays.map((p) => `${methodUz[p.method] ?? p.method} ${p.amount}`).join(", ") || "—"}${deposit > 0 ? ` + аванс ${deposit}` : ""}`;
          await logAudit(tx, {
            actorId: ctx.user.id,
            action: "order.close",
            entity: "order",
            entityId: input.id,
            summary: closeSummary,
            meta: { payments: pays, deposit, discount: input.discount?.amount ?? 0, comp: !!input.comp },
          });
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
          // FOR UPDATE — параллел cancel/close шу қаторни кутсин: иккинчи cancel
          // блокланиб, кейин status='cancelled'ни кўради → рад этилади (loss/voided
          // икки бора ёзилмайди). close ҳам шу қаторни FOR UPDATE қилади.
          const head = (
            await tx
              .select({ status: orders.status })
              .from(orders)
              .where(eq(orders.id, input.id))
              .limit(1)
              .for("update")
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

          await logAudit(tx, {
            actorId: ctx.user.id,
            action: "order.cancel",
            entity: "order",
            entityId: input.id,
            summary: sentByProduct.size
              ? `бекор (${sentByProduct.size} пишган йўқотилди)`
              : "бекор қилинди",
            meta: { note: input.note ?? null, lossItems: sentByProduct.size },
          });

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
        return db.transaction(async (tx) => {
          // Advisory lock — параллел списание/кўчириш негатив-гвардни айланиб
          // ўтмасин (check-then-insert атомик бўлсин).
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${input.productId}))`,
          );
          const prod = (
            await tx
              .select({ unit: products.unit })
              .from(products)
              .where(eq(products.id, input.productId))
              .limit(1)
          )[0];
          if (!prod)
            throw new TRPCError({ code: "NOT_FOUND", message: "Маҳсулот топилмади" });

          const factor = prod.unit === "kg" || prod.unit === "l" ? 1000 : 1;
          const base = Math.round(input.qty * factor);
          if (base <= 0)
            throw new TRPCError({ code: "BAD_REQUEST", message: "Миқдор нотўғри" });
          const baseUnit =
            prod.unit === "dona" ? "dona" : prod.unit === "l" || prod.unit === "ml" ? "ml" : "g";

          const onHand = await productOnHand(input.productId, tx);
          if (base > onHand)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Қолдиқ етарли эмас (бор: ${onHand} ${baseUnit})`,
            });

          const refId = crypto.randomUUID();
          const label = `${input.fromStorage}→${input.toStorage}`;
          const note = input.note ? `${label} · ${input.note}` : label;
          await tx.insert(stockMovements).values([
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
        });
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
        return db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${input.productId}))`,
          );
          const prod = (
            await tx
              .select({ unit: products.unit })
              .from(products)
              .where(eq(products.id, input.productId))
              .limit(1)
          )[0];
          if (!prod)
            throw new TRPCError({ code: "NOT_FOUND", message: "Маҳсулот топилмади" });
          const factor = prod.unit === "kg" || prod.unit === "l" ? 1000 : 1;
          const base = Math.round(input.qty * factor);
          if (base <= 0)
            throw new TRPCError({ code: "BAD_REQUEST", message: "Миқдор нотўғри" });
          const baseUnit =
            prod.unit === "dona" ? "dona" : prod.unit === "l" || prod.unit === "ml" ? "ml" : "g";
          const onHand = await productOnHand(input.productId, tx);
          if (base > onHand)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Қолдиқдан кўп списание бўлмайди (бор: ${onHand} ${baseUnit})`,
            });
          await tx.insert(stockMovements).values({
            productId: input.productId,
            type: "loss" as const,
            qty: -base,
            unit: baseUnit,
            refType: "spoilage",
            note: input.reason,
            createdById: ctx.user.id,
          });
          return { ok: true };
        });
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
        return db.transaction(async (tx) => {
        // Барча иштирокчи маҳсулотни tartibланган ҳолда қулфлаймиз (deadlock'сиз) —
        // параллел produce/списание негатив-гвардни айланиб ўтмасин.
        const lockIds = [
          ...new Set([input.outputProductId, ...input.inputs.map((i) => i.productId)]),
        ].sort();
        for (const id of lockIds)
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`);
        const ids = [input.outputProductId, ...input.inputs.map((i) => i.productId)];
        const prods = await tx
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
          const onHand = await productOnHand(it.productId, tx);
          if (b.base > onHand)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Хом-ашё қолдиғи етарли эмас (бор: ${onHand} ${b.baseUnit})`,
            });
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
        await tx.insert(stockMovements).values(moves);
        return { ok: true };
        });
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

    create: buyerProcedure
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
          return db.transaction(async (tx) => {
            const row = (
              await tx
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
            await logAudit(tx, {
              actorId: ctx.user.id,
              action: "expense.create",
              entity: "expense",
              entityId: row?.id ?? null,
              summary: `${input.category} · ${input.amount} so'm`,
              meta: { category: input.category, amount: input.amount, method: input.method ?? "cash" },
            });
            return { id: row?.id };
          });
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
        .mutation(async ({ input, ctx }) => {
          return db.transaction(async (tx) => {
            const old = (
              await tx
                .select({ category: expenses.category, amount: expenses.amount })
                .from(expenses)
                .where(eq(expenses.id, input.id))
                .limit(1)
            )[0];
            await tx.delete(expenses).where(eq(expenses.id, input.id));
            await logAudit(tx, {
              actorId: ctx.user.id,
              action: "expense.delete",
              entity: "expense",
              entityId: input.id,
              summary: old
                ? `${old.category} · ${old.amount} so'm ўчирилди`
                : "харажат ўчирилди",
              meta: { old: old ?? null },
            });
            return { ok: true };
          });
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

    // Ойлик P&L'ни 7-кунлик ҳафталарга бўлиш (сўнгги ҳафта қисқароқ бўлиши мумкин).
    pnlByWeek: directorProcedure
      .input(
        z.object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        }),
      )
      .query(async ({ input }) => {
        const { startUTC, endUTC } = businessRangeBounds(input.from, input.to);
        const pad = (n: number) => String(n).padStart(2, "0");
        const dm = (t: Date) => `${pad(t.getUTCDate())}.${pad(t.getUTCMonth() + 1)}`;
        const DAY_MS = 24 * 3600 * 1000;
        const WEEK_MS = 7 * DAY_MS;
        const weeks: {
          label: string;
          from: string;
          to: string;
          revenue: number;
          cogs: number;
          opexOther: number;
          ishHaqi: number;
          ownerDraw: number;
          sofFoyda: number;
        }[] = [];
        for (let ws = startUTC.getTime(); ws < endUTC.getTime(); ws += WEEK_MS) {
          const weekStart = new Date(ws);
          const weekEnd = new Date(Math.min(ws + WEEK_MS, endUTC.getTime()));
          const fin = await financeForWindow(weekStart, weekEnd);
          const ishHaqi = fin.opexByCat.ish_haqi ?? 0;
          const opexOther = fin.opex - ishHaqi;
          weeks.push({
            // weekEnd — кейинги (ичига кирмайдиган) бизнес-кун бошланиши (01:00 UTC).
            // Охирги ЧИНДАН ҳам ичига кирган бизнес-кунни олиш учун 1мс эмас, бутун
            // суткани (24соат) айириш керак — акс ҳолда сана бир кун олдинга силжийди.
            label: `${dm(weekStart)}–${dm(new Date(weekEnd.getTime() - DAY_MS))}`,
            from: weekStart.toISOString().slice(0, 10),
            to: weekEnd.toISOString().slice(0, 10),
            revenue: fin.revenue,
            cogs: fin.cogs,
            opexOther,
            ishHaqi,
            ownerDraw: fin.ownerDraw,
            sofFoyda: fin.sofFoyda,
          });
        }
        const totals = weeks.reduce(
          (t, w) => ({
            revenue: t.revenue + w.revenue,
            cogs: t.cogs + w.cogs,
            opexOther: t.opexOther + w.opexOther,
            ishHaqi: t.ishHaqi + w.ishHaqi,
            ownerDraw: t.ownerDraw + w.ownerDraw,
            sofFoyda: t.sofFoyda + w.sofFoyda,
          }),
          { revenue: 0, cogs: 0, opexOther: 0, ishHaqi: 0, ownerDraw: 0, sofFoyda: 0 },
        );
        return { weeks, totals };
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

      // Лоялти CRM: мижозлар + ҳамён баланси (= SUM wallet movements).
      list: managerProcedure.query(async () => {
        return db
          .select({
            id: customers.id,
            name: customers.name,
            phone: customers.phone,
            balance: sql<number>`coalesce(sum(${customerWalletMovements.amount}), 0)`.mapWith(Number),
          })
          .from(customers)
          .leftJoin(customerWalletMovements, eq(customerWalletMovements.customerId, customers.id))
          .groupBy(customers.id)
          .orderBy(
            desc(sql`coalesce(sum(${customerWalletMovements.amount}), 0)`),
            customers.name,
          );
      }),

      // Битта мижоз ҳамёни — баланс + ҳаракатлар тарихи.
      wallet: managerProcedure
        .input(z.object({ customerId: z.string().uuid() }))
        .query(async ({ input }) => {
          const balRow = (
            await db
              .select({
                b: sql<number>`coalesce(sum(${customerWalletMovements.amount}), 0)`.mapWith(Number),
              })
              .from(customerWalletMovements)
              .where(eq(customerWalletMovements.customerId, input.customerId))
          )[0];
          const moves = await db
            .select({
              id: customerWalletMovements.id,
              amount: customerWalletMovements.amount,
              kind: customerWalletMovements.kind,
              note: customerWalletMovements.note,
              createdAt: customerWalletMovements.createdAt,
              by: users.name,
            })
            .from(customerWalletMovements)
            .leftJoin(users, eq(users.id, customerWalletMovements.createdById))
            .where(eq(customerWalletMovements.customerId, input.customerId))
            .orderBy(desc(customerWalletMovements.createdAt))
            .limit(30);
          return { balance: balRow?.b ?? 0, moves };
        }),

      // Мижоз таниш: телефон/исмдан танилган мижознинг бой профили — ташрифлар,
      // жами сарф, ўртача чек, охирги ташриф, севган таомлар. Ҳозирча мижозга
      // БОҒЛАНГАН ёпилган заказлардан (қарзли/бириктирилган) — вақт ўтиб тўлади.
      profile: managerProcedure
        .input(z.object({ customerId: z.string().uuid() }))
        .query(async ({ input }) => {
          const ords = await db
            .select({ id: orders.id, closedAt: orders.closedAt })
            .from(orders)
            .where(and(eq(orders.customerId, input.customerId), eq(orders.status, "closed")));
          const ids = ords.map((o) => o.id);
          let totalSpent = 0;
          let topDishes: { name: string; qty: number }[] = [];
          if (ids.length) {
            totalSpent = Number(
              (
                await db
                  .select({ s: sql<number>`coalesce(sum(${orderPayments.amount}), 0)` })
                  .from(orderPayments)
                  .where(inArray(orderPayments.orderId, ids))
              )[0]?.s ?? 0,
            );
            const items = await db
              .select({ name: orderItems.name, qty: orderItems.qty })
              .from(orderItems)
              .where(inArray(orderItems.orderId, ids));
            const byName = new Map<string, number>();
            for (const it of items) byName.set(it.name, (byName.get(it.name) ?? 0) + it.qty);
            topDishes = [...byName.entries()]
              .map(([name, qty]) => ({ name, qty }))
              .sort((a, b) => b.qty - a.qty)
              .slice(0, 5);
          }
          const visits = ords.length;
          const lastVisit = ords.reduce<Date | null>(
            (m, o) => (o.closedAt && (!m || o.closedAt > m) ? o.closedAt : m),
            null,
          );
          return {
            visits,
            totalSpent,
            avgCheck: visits > 0 ? Math.round(totalSpent / visits) : 0,
            lastVisit,
            topDishes,
          };
        }),

      // Директор қўлда ҳамён ҳаракати: + бонус (туғилган кун/лоялти), − редемпшн
      // (сарфлади), ёки тузатиш. Append-only, аудит. Манфий → баланс етарли бўлсин.
      adjust: directorProcedure
        .input(
          z.object({
            customerId: z.string().uuid(),
            amount: z.number().int().refine((n) => n !== 0, "Сумма 0 бўлмасин"),
            kind: z.enum(["bonus", "redeem", "adjust"]),
            note: z.string().trim().max(200).optional(),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          return db.transaction(async (tx) => {
            const cust = (
              await tx
                .select({ name: customers.name })
                .from(customers)
                .where(eq(customers.id, input.customerId))
                .limit(1)
            )[0];
            if (!cust) throw new TRPCError({ code: "NOT_FOUND", message: "Мижоз топилмади" });
            if (input.amount < 0) {
              const bal = (
                await tx
                  .select({
                    b: sql<number>`coalesce(sum(${customerWalletMovements.amount}), 0)`.mapWith(Number),
                  })
                  .from(customerWalletMovements)
                  .where(eq(customerWalletMovements.customerId, input.customerId))
              )[0]?.b ?? 0;
              if (bal + input.amount < 0)
                throw new TRPCError({ code: "BAD_REQUEST", message: "Баланс етарли эмас" });
            }
            await tx.insert(customerWalletMovements).values({
              customerId: input.customerId,
              amount: input.amount,
              kind: input.kind,
              note: input.note ?? null,
              createdById: ctx.user.id,
            });
            await logAudit(tx, {
              actorId: ctx.user.id,
              action: "wallet.adjust",
              entity: "customer",
              entityId: input.customerId,
              summary: `${cust.name}: ${input.amount > 0 ? "+" : ""}${input.amount.toLocaleString("ru-RU")} so'm (${input.kind})`,
            });
            return { ok: true };
          });
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
        return db.transaction(async (tx) => {
          // Advisory lock — параллел иккита қайтариш потолокдан ошиб кетмасин.
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtext(${input.orderId}))`,
          );
          const order = (
            await tx
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
          // Потолок: реал йиғилган (қарздан ташқари) тўлов − олдинги қайтаришлар.
          // Қарз = олинмаган пул → қайтариб бўлмайди; текин чек = 0.
          const pays = await tx
            .select({ method: orderPayments.method, amount: orderPayments.amount })
            .from(orderPayments)
            .where(eq(orderPayments.orderId, input.orderId));
          const collected = pays
            .filter((p) => p.method !== "debt")
            .reduce((s, p) => s + p.amount, 0);
          const prior = (
            await tx
              .select({ amount: refunds.amount })
              .from(refunds)
              .where(eq(refunds.orderId, input.orderId))
          ).reduce((s, r) => s + r.amount, 0);
          const remaining = collected - prior;
          if (input.amount > remaining)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Қайтариш (${input.amount}) қолган тўловдан (${remaining}) катта`,
            });
          await tx.insert(refunds).values({
            orderId: input.orderId,
            amount: input.amount,
            reason: input.reason,
            performedById: ctx.user.id,
          });
          return { ok: true, remaining: remaining - input.amount };
        });
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
            discountAmount: orders.discountAmount,
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
            // Чекда чоп этилгандек: чегирма айирилади, текин (comp) = 0.
            const total = r.isComp
              ? 0
              : subtotal + Math.round((subtotal * r.servicePct) / 100) - r.discountAmount;
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
          const {
            cashRevenue,
            cashDebtRepaid,
            cashExpenses,
            cashCollected,
            cashDeposits,
            cashDepositRefunds,
            expectedCash,
          } = await expectedCashForWindow(startUTC, endUTC);
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
            cashDeposits,
            cashDepositRefunds,
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

  telegram: router({
    enabled: directorProcedure.query(() => ({ enabled: telegramEnabled() })),
    // Кун охири хулосаси: тушум/фойда/чек + очиқ тешиклар → директорга push.
    // Директор тугма билан ёки cron (23:00) чақиради.
    digest: directorProcedure.mutation(async () => {
      if (!telegramEnabled())
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Telegram созланмаган (env)" });
      return sendDailyDigest();
    }),
  }),

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
        let row: (typeof assets.$inferSelect) | undefined;
        try {
          row = (
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
        } catch (e) {
          if (e && typeof e === "object" && "code" in e && e.code === "23505") {
            throw new TRPCError({ code: "CONFLICT", message: "Шу турдан аллақачон бор" });
          }
          throw e;
        }
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
        z
          .object({
            assetId: z.string().uuid(),
            qty: z.number().int().refine((n) => n !== 0),
            reason: z.enum(["kirim", "sindi", "yoqoldi", "tuzatish"]),
            note: z.string().optional(),
            responsibleId: z.string().uuid().optional(),
          })
          // kirim is always an increase, sindi/yoqoldi always a decrease —
          // tuzatish (recount correction) is the only reason allowed either
          // sign. Server-side, not just UI, since qty's sign drives the
          // drift-free SUM the whole ledger design depends on.
          .refine((v) => v.reason !== "kirim" || v.qty > 0, {
            message: "Кирим сони мусбат бўлиши керак",
          })
          .refine((v) => !["sindi", "yoqoldi"].includes(v.reason) || v.qty < 0, {
            message: "Синди/йўқолди сони манфий бўлиши керак",
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
      // Damage on assets with no price set has no unitPrice snapshot and would
      // otherwise vanish from the report above with no signal — surface a count
      // so the owner knows the total understates real losses (same pattern as
      // Moliya's cogsPartial/unpricedNames for missing product prices).
      const unpriced = (
        await db
          .select({ n: count() })
          .from(assetMovements)
          .where(
            and(
              inArray(assetMovements.reason, ["sindi", "yoqoldi"]),
              sql`${assetMovements.unitPrice} is null`,
            ),
          )
      )[0];
      return { rows, unpricedCount: unpriced?.n ?? 0 };
    }),

    deactivate: managerProcedure
      .input(z.object({ assetId: z.string().uuid() }))
      .mutation(async ({ input }) => {
        await db.update(assets).set({ active: false }).where(eq(assets.id, input.assetId));
        return { ok: true };
      }),
  }),

  // Milestone 3 — Витрина/сих назорати: хом гўшт→сих→витрина киритиш + тешик кўрсатиш.
  vitrina: router({
    // танлаш учун фаол таомлар (сих турлари)
    products: managerProcedure.query(() =>
      db
        .select({ id: products.id, name: products.name })
        .from(products)
        .where(eq(products.active, true))
        .orderBy(products.name),
    ),

    // бугунги сих батчлари (норма четлашиши билан) + витрина баланси
    today: managerProcedure.query(async () => {
      const { startUTC, endUTC, dayKey } = businessDayBounds();
      const rows = await db
        .select({
          id: skewerBatches.id,
          name: products.name,
          meatG: skewerBatches.meatG,
          skewerCount: skewerBatches.skewerCount,
          normG: skewerBatches.normG,
          createdAt: skewerBatches.createdAt,
          by: users.name,
        })
        .from(skewerBatches)
        .innerJoin(products, eq(skewerBatches.productId, products.id))
        .leftJoin(users, eq(skewerBatches.createdById, users.id))
        .where(and(gte(skewerBatches.createdAt, startUTC), lt(skewerBatches.createdAt, endUTC)))
        .orderBy(desc(skewerBatches.createdAt));
      const batches = rows.map((r) => {
        const actualG = r.skewerCount > 0 ? Math.round(r.meatG / r.skewerCount) : 0;
        const devPct =
          r.normG && r.normG > 0 ? Math.round(((actualG - r.normG) / r.normG) * 100) : null;
        return { ...r, actualG, devPct };
      });
      const reconcile = await vitrinaReconcile(dayKey);
      return { batches, reconcile };
    }),

    // сих батчи қўшиш: N г гўшт → M сих (нормани рецептдан билмасак normG=NULL)
    addBatch: managerProcedure
      .input(
        z.object({
          productId: z.string().uuid(),
          meatG: z.number().int().positive(),
          skewerCount: z.number().int().positive(),
          normG: z.number().int().positive().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await db.insert(skewerBatches).values({
          productId: input.productId,
          meatG: input.meatG,
          skewerCount: input.skewerCount,
          normG: input.normG ?? null,
          createdById: ctx.user.id,
        });
        return { ok: true };
      }),

    // витрина кунлик санаш — кунига битта таом учун (upsert)
    count: managerProcedure
      .input(
        z.object({
          productId: z.string().uuid(),
          countedQty: z.number().int().nonnegative(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { dayKey } = businessDayBounds();
        await db
          .insert(vitrinaCounts)
          .values({
            dayKey,
            productId: input.productId,
            countedQty: input.countedQty,
            createdById: ctx.user.id,
          })
          .onConflictDoUpdate({
            target: [vitrinaCounts.dayKey, vitrinaCounts.productId],
            set: { countedQty: input.countedQty, createdById: ctx.user.id },
          });
        return { ok: true };
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
          // Adjust against the LIVE ledger sum, NOT the stale start-snapshot
          // (theoreticalQty). Sales during the submit→approve window already posted
          // sale_writeoff to the same ledger; subtracting the snapshot would
          // double-count them. Target invariant: ledger on-hand == countedQty.
          const ids = items.map((it) => it.productId);
          const sumRows = ids.length
            ? await tx
                .select({
                  productId: stockMovements.productId,
                  s: sql<number>`coalesce(sum(${stockMovements.qty}), 0)`,
                })
                .from(stockMovements)
                .where(inArray(stockMovements.productId, ids))
                .groupBy(stockMovements.productId)
            : [];
          const onHand = new Map(sumRows.map((r) => [r.productId, Number(r.s)]));
          const moves = items
            .filter((it) => it.countedQty != null)
            .map((it) => ({
              productId: it.productId,
              type: "inventory_adjust" as const,
              qty: it.countedQty! - (onHand.get(it.productId) ?? 0),
              unit: it.unit,
              refType: "inventory",
              refId: input.countId,
              note: it.reason ?? null,
              createdById: ctx.user.id,
            }))
            .filter((m) => m.qty !== 0);
          if (moves.length) await tx.insert(stockMovements).values(moves);
          return { ok: true, alreadyApproved: false, adjusted: moves.length };
        });
      }),

    signals: directorProcedure.query(() => computeSignals()),

    menuEngineering: directorProcedure
      .input(
        z.object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        }),
      )
      .query(async ({ input }) => {
        const { startUTC, endUTC } = businessRangeBounds(input.from, input.to);
        const frac = await orderRevenueFraction(startUTC, endUTC);
        const sold = await db
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
        for (const r of sold) {
          if (!r.productId) continue;
          const e = byProduct.get(r.productId) ?? { name: r.name, qty: 0, revenue: 0 };
          e.qty += r.qty;
          e.revenue += Math.round(r.qty * r.price * (frac.get(r.orderId) ?? 1));
          byProduct.set(r.productId, e);
        }

        const meatCost = { qoy: await latestMeatCost("qoy"), mol: await latestMeatCost("mol") };
        const dishes = await computeDishTaannarx(meatCost);
        const costPerUnit = new Map(
          dishes
            .filter(
              (d) =>
                d.productId &&
                d.meatCostTotal > 0 &&
                !(d.meatPct != null && d.meatPct > 100) && // batch/pot recipes excluded
                !d.hasUnpricedMeat,
            )
            .map((d) => [d.productId as string, d.meatCostTotal]),
        );

        const known: {
          productId: string;
          name: string;
          qty: number;
          revenue: number;
          unitMargin: number;
          totalMargin: number;
        }[] = [];
        const unknown: { productId: string; name: string; qty: number; revenue: number }[] = [];
        for (const [productId, v] of byProduct) {
          const mc = costPerUnit.get(productId);
          if (mc == null) {
            unknown.push({ productId, ...v });
            continue;
          }
          const avgPrice = v.qty > 0 ? v.revenue / v.qty : 0;
          const unitMargin = Math.round(avgPrice - mc);
          known.push({
            productId,
            ...v,
            unitMargin,
            totalMargin: unitMargin * v.qty,
          });
        }

        const median = (xs: number[]) => {
          if (xs.length === 0) return 0;
          const s = [...xs].sort((a, b) => a - b);
          const mid = Math.floor(s.length / 2);
          return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
        };
        const medQty = median(known.map((k) => k.qty));
        const medMargin = median(known.map((k) => k.unitMargin));
        const rows = known
          .map((k) => ({
            ...k,
            quadrant:
              k.qty >= medQty && k.unitMargin >= medMargin
                ? ("star" as const) // юлдуз: кўп сотилади + яхши маржа
                : k.qty >= medQty
                  ? ("plowhorse" as const) // от: кўп сотилади, юпқа маржа
                  : k.unitMargin >= medMargin
                    ? ("puzzle" as const) // жумбоқ: маржа яхши, кам сотилади
                    : ("dog" as const), // ит: иккиси ҳам паст
          }))
          .sort((a, b) => b.totalMargin - a.totalMargin);
        unknown.sort((a, b) => b.revenue - a.revenue);
        return { medQty, medMargin, rows, unknown: unknown.slice(0, 15) };
      }),

    // Официант KPI/рейтинг: ким кўп сотди — реал тўлов (пул) бўйича. Официант =
    // заказни ОЧГАН ходим (orders.waiterId). Ёпилган заказлар, давр оралиғида.
    waiterKpi: directorProcedure
      .input(
        z.object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        }),
      )
      .query(async ({ input }) => {
        const { startUTC, endUTC } = businessRangeBounds(input.from, input.to);
        const ords = await db
          .select({
            id: orders.id,
            waiterId: orders.waiterId,
            waiter: users.name,
            guests: orders.guests,
          })
          .from(orders)
          .leftJoin(users, eq(orders.waiterId, users.id))
          .where(
            and(
              eq(orders.status, "closed"),
              gte(orders.closedAt, startUTC),
              lt(orders.closedAt, endUTC),
            ),
          );
        if (ords.length === 0) return { rows: [] };
        const ids = ords.map((o) => o.id);
        // Реал пул = order_payments (аванс ҳам киради). Per-order йиғинди.
        const pays = await db
          .select({ orderId: orderPayments.orderId, amount: orderPayments.amount })
          .from(orderPayments)
          .where(inArray(orderPayments.orderId, ids));
        const payByOrder = new Map<string, number>();
        for (const p of pays)
          payByOrder.set(p.orderId, (payByOrder.get(p.orderId) ?? 0) + p.amount);
        const items = await db
          .select({ orderId: orderItems.orderId, qty: orderItems.qty })
          .from(orderItems)
          .where(inArray(orderItems.orderId, ids));
        const qtyByOrder = new Map<string, number>();
        for (const it of items)
          qtyByOrder.set(it.orderId, (qtyByOrder.get(it.orderId) ?? 0) + it.qty);

        const byWaiter = new Map<
          string,
          { waiter: string; revenue: number; orders: number; guests: number; items: number }
        >();
        for (const o of ords) {
          const key = o.waiterId ?? "—";
          const e =
            byWaiter.get(key) ??
            { waiter: o.waiter ?? "—", revenue: 0, orders: 0, guests: 0, items: 0 };
          e.revenue += payByOrder.get(o.id) ?? 0;
          e.orders += 1;
          e.guests += o.guests ?? 0;
          e.items += qtyByOrder.get(o.id) ?? 0;
          byWaiter.set(key, e);
        }
        const rows = [...byWaiter.values()]
          .map((w) => ({
            ...w,
            avgCheck: w.orders > 0 ? Math.round(w.revenue / w.orders) : 0,
            avgPerGuest: w.guests > 0 ? Math.round(w.revenue / w.guests) : 0,
            itemsPerOrder: w.orders > 0 ? Math.round((w.items / w.orders) * 10) / 10 : 0,
          }))
          .sort((a, b) => b.revenue - a.revenue);
        return { rows };
      }),

    digest: directorProcedure.query(async () => {
      const { startUTC, endUTC, dayKey } = businessDayBounds();
      const todayFin = await financeForWindow(startUTC, endUTC);
      const estCogs = Math.round(todayFin.revenue * BLENDED_COGS_PCT);
      const estProfit =
        todayFin.revenue - estCogs - todayFin.opex - todayFin.cardTax - todayFin.refundTotal;

      const lastWeek = await lastWeekComparison(dayKey, todayFin.revenue);

      const { supplierTotal, guestTotal } = await debtTotals();
      const stock = await stockableOnHand();
      const lowStock = stock.filter((p) => p.onHand < 0).length;

      // Live: open orders (столлар) right now. orders has no stored total → count
      // open orders and sum their item subtotals (price·qty) for a live glance.
      const openTables = Number(
        (
          await db
            .select({ n: count() })
            .from(orders)
            .where(eq(orders.status, "open"))
        )[0]?.n ?? 0,
      );
      const openValue = Number(
        (
          await db
            .select({
              v: sql<number>`coalesce(sum(${orderItems.price} * ${orderItems.qty}), 0)`,
            })
            .from(orderItems)
            .innerJoin(orders, eq(orderItems.orderId, orders.id))
            .where(eq(orders.status, "open"))
        )[0]?.v ?? 0,
      );

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
        sig.grammLeak.filter((g) => g.flag).length +
        sig.vitrinaMismatch.length +
        sig.skewerFlags.length +
        sig.expiryFlags.length +
        sig.refundsToday.count +
        sig.voidsToday.count +
        sig.reprintsToday.count;

      return {
        revenueToday: todayFin.revenue,
        cashToday: todayFin.byMethod.cash ?? 0,
        estProfit,
        estCogsPct: BLENDED_COGS_PCT,
        anomalyCount,
        lowStock,
        openTables,
        openValue,
        debtToday: supplierTotal + guestTotal,
        supplierDebt: supplierTotal,
        guestDebt: guestTotal,
        revenueLastWeekSameDay: lastWeek.lastWeekRevenue,
        checksLastWeekSameDay: lastWeek.lastWeekChecks,
        vsLastWeekPct: lastWeek.pct,
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
          const estProfit = r.revenue - Math.round(r.revenue * BLENDED_COGS_PCT);
          rows.push({
            dayKey: k,
            revenue: r.revenue,
            checks: r.checks,
            avgCheck: r.avgCheck,
            estProfit,
          });
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
        const frac = await orderRevenueFraction(startUTC, endUTC);
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
          // realized revenue: scale by the order's cash fraction (split cash+debt
          // keeps its cash part; comp/debt-only = 0; cash-only = full).
          const rev = Math.round(r.qty * r.price * (frac.get(r.orderId) ?? 1));
          e.revenue += rev;
          total += rev;
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
        const frac = await orderRevenueFraction(startUTC, endUTC);
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
          // realized revenue scaled by the order's cash fraction (split-tender safe)
          e.revenue += Math.round(r.qty * r.price * (frac.get(r.orderId) ?? 1));
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

    // Директор-luxury: тепловая карта — стол бўйича тушум. Стол бириктирилмаган
    // (tableNo=null) буюртмалар киритилмайди — иссиқлик харитаси реал столлар учун.
    byTable: directorProcedure
      .input(
        z.object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        }),
      )
      .query(async ({ input }) => {
        const { startUTC, endUTC } = businessRangeBounds(input.from, input.to);
        const frac = await orderRevenueFraction(startUTC, endUTC);
        const rows = await db
          .select({
            orderId: orderItems.orderId,
            hallId: orders.hallId,
            hallName: halls.name,
            tableNo: orders.tableNo,
            qty: orderItems.qty,
            price: orderItems.price,
          })
          .from(orderItems)
          .innerJoin(orders, eq(orderItems.orderId, orders.id))
          .innerJoin(halls, eq(orders.hallId, halls.id))
          .where(
            and(
              eq(orders.status, "closed"),
              isNotNull(orders.tableNo),
              gte(orders.closedAt, startUTC),
              lt(orders.closedAt, endUTC),
            ),
          );
        const byTable = new Map<
          string,
          { hallId: string; hallName: string; tableNo: string; revenue: number }
        >();
        for (const r of rows) {
          if (!r.tableNo) continue;
          const key = `${r.hallId}|${r.tableNo}`;
          const e = byTable.get(key) ?? {
            hallId: r.hallId,
            hallName: r.hallName,
            tableNo: r.tableNo,
            revenue: 0,
          };
          e.revenue += Math.round(r.qty * r.price * (frac.get(r.orderId) ?? 1));
          byTable.set(key, e);
        }
        return [...byTable.values()].sort((a, b) => b.revenue - a.revenue);
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

    // Кассир атрибуцияси (closedById): ким ёпди, ким КЎП ҚАРЗГА берди (сохта
    // қарз назорати). byWaiter revenue'ни очишга (waiterId) боғлайди — бу ёпишга.
    byCashier: managerProcedure
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
            cashierId: orders.closedById,
            cashierName: users.name,
            amount: orderPayments.amount,
            method: orderPayments.method,
            orderId: orders.id,
          })
          .from(orderPayments)
          .innerJoin(orders, eq(orderPayments.orderId, orders.id))
          .leftJoin(users, eq(orders.closedById, users.id))
          .where(
            and(
              eq(orders.status, "closed"),
              gte(orders.closedAt, startUTC),
              lt(orders.closedAt, endUTC),
            ),
          );
        const by = new Map<
          string,
          { name: string; revenue: number; debtIssued: number; orders: Set<string> }
        >();
        for (const r of rows) {
          const key = r.cashierId ?? "unknown";
          const e = by.get(key) ?? {
            name: r.cashierName ?? "Номаълум",
            revenue: 0,
            debtIssued: 0,
            orders: new Set<string>(),
          };
          if (r.method === "debt") e.debtIssued += r.amount;
          else e.revenue += r.amount;
          e.orders.add(r.orderId);
          by.set(key, e);
        }
        return [...by.entries()]
          .map(([cashierId, v]) => ({
            cashierId,
            name: v.name,
            revenue: v.revenue,
            debtIssued: v.debtIssued,
            checks: v.orders.size,
          }))
          .sort((a, b) => b.revenue - a.revenue);
      }),

    // Эга'нинг Excel'и: ҳар маҳсулот × ҳар кун — приход / расход / остаток.
    // stock_movements'дан ҳосил (06:00 бизнес-кун чегараси). Faqat ҳаракатли/қолдиқли.
    stockMatrix: managerProcedure
      .input(
        z.object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        }),
      )
      .query(async ({ input }) => {
        const pad = (n: number) => String(n).padStart(2, "0");
        const dkey = (t: Date) =>
          `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
        const { endUTC } = businessRangeBounds(input.from, input.to);
        const startUTC = businessDayBounds(input.from).startUTC;
        const days: string[] = [];
        for (let d = new Date(startUTC); d < endUTC; d = new Date(d.getTime() + 24 * 3600 * 1000))
          days.push(dkey(d)); // d = 01:00 UTC ҳар кун → санаси = бизнес-кун калити

        const opening = await db
          .select({
            productId: stockMovements.productId,
            s: sql<number>`coalesce(sum(${stockMovements.qty}), 0)`,
          })
          .from(stockMovements)
          .where(lt(stockMovements.createdAt, startUTC))
          .groupBy(stockMovements.productId);
        const openMap = new Map(opening.map((o) => [o.productId, Number(o.s)]));

        const movs = await db
          .select({
            productId: stockMovements.productId,
            qty: stockMovements.qty,
            createdAt: stockMovements.createdAt,
          })
          .from(stockMovements)
          .where(and(gte(stockMovements.createdAt, startUTC), lt(stockMovements.createdAt, endUTC)));
        // ҳаракат кун калити = createdAt − 1соат нинг UTC санаси (01:00 чегарасига мос).
        const cell = new Map<string, { in: number; out: number }>();
        for (const m of movs) {
          const k = `${m.productId}|${dkey(new Date(m.createdAt.getTime() - 3600 * 1000))}`;
          const c = cell.get(k) ?? { in: 0, out: 0 };
          if (m.qty > 0) c.in += m.qty;
          else c.out += -m.qty;
          cell.set(k, c);
        }

        const prods = await stockableOnHand();
        const rows = prods
          .filter((p) => openMap.get(p.id) || days.some((d) => cell.has(`${p.id}|${d}`)))
          .map((p) => {
            let close = openMap.get(p.id) ?? 0;
            const cells = days.map((d) => {
              const c = cell.get(`${p.id}|${d}`) ?? { in: 0, out: 0 };
              close += c.in - c.out;
              return { date: d, in: c.in, out: c.out, close };
            });
            return { productId: p.id, name: p.name, unit: p.unit, cells };
          });
        return { days, rows };
      }),
  }),

  // Payme/Click QR тўлов созламаси — merchant/service ID app_meta'да (key-value).
  // Кассир QR ясаш учун ўқийди (protected); фақат директор ёзади.
  settings: router({
    paymentConfig: protectedProcedure.query(async () => {
      const keys = ["payme_merchant_id", "click_service_id", "click_merchant_id"];
      const rows = await db
        .select({ key: appMeta.key, value: appMeta.value })
        .from(appMeta)
        .where(inArray(appMeta.key, keys));
      const m = new Map(rows.map((r) => [r.key, r.value]));
      return {
        paymeMerchantId: m.get("payme_merchant_id") ?? null,
        clickServiceId: m.get("click_service_id") ?? null,
        clickMerchantId: m.get("click_merchant_id") ?? null,
      };
    }),

    setPaymentConfig: directorProcedure
      .input(
        z.object({
          paymeMerchantId: z.string().trim().max(120),
          clickServiceId: z.string().trim().max(120),
          clickMerchantId: z.string().trim().max(120),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const pairs: [string, string][] = [
          ["payme_merchant_id", input.paymeMerchantId],
          ["click_service_id", input.clickServiceId],
          ["click_merchant_id", input.clickMerchantId],
        ];
        for (const [key, value] of pairs) {
          await db
            .insert(appMeta)
            .values({ key, value })
            .onConflictDoUpdate({ target: appMeta.key, set: { value } });
        }
        await logAudit(db, {
          actorId: ctx.user.id,
          action: "settings.payment",
          entity: "app_meta",
          summary: "Payme/Click тўлов созламаси янгиланди",
        });
        return { ok: true };
      }),
  }),

  // KDS — кухня экрани. Пишаётган (bump қилинмаган) тикетлар; ошпаз «Тайёр» босади.
  kds: router({
    board: protectedProcedure.query(async () => {
      const tix = await db
        .select({
          id: kitchenTickets.id,
          createdAt: kitchenTickets.createdAt,
          tableNo: orders.tableNo,
          hall: halls.name,
          saleType: orders.saleType,
        })
        .from(kitchenTickets)
        .innerJoin(orders, eq(kitchenTickets.orderId, orders.id))
        .leftJoin(halls, eq(orders.hallId, halls.id))
        .where(and(isNull(kitchenTickets.bumpedAt), eq(orders.status, "open")))
        .orderBy(kitchenTickets.createdAt);
      if (tix.length === 0) return [];
      const items = await db
        .select({
          ticketId: kitchenTicketItems.ticketId,
          name: kitchenTicketItems.name,
          qty: kitchenTicketItems.qty,
          note: kitchenTicketItems.note,
          station: kitchenTicketItems.station,
          course: kitchenTicketItems.course,
        })
        .from(kitchenTicketItems)
        .where(inArray(kitchenTicketItems.ticketId, tix.map((t) => t.id)));
      const byTicket = new Map<string, typeof items>();
      for (const it of items) {
        const a = byTicket.get(it.ticketId) ?? [];
        a.push(it);
        byTicket.set(it.ticketId, a);
      }
      return tix.map((t) => ({
        id: t.id,
        createdAt: t.createdAt,
        tableNo: t.tableNo,
        hall: t.hall,
        saleType: t.saleType,
        items: byTicket.get(t.id) ?? [],
      }));
    }),

    bump: protectedProcedure
      .input(z.object({ ticketId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        await db
          .update(kitchenTickets)
          .set({ bumpedAt: new Date(), bumpedById: ctx.user.id })
          .where(and(eq(kitchenTickets.id, input.ticketId), isNull(kitchenTickets.bumpedAt)));
        return { ok: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
