import { and, count, desc, eq } from "drizzle-orm";
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
import { db } from "./db/client";
import {
  categories,
  halls,
  obvalka,
  obvalkaParts,
  orderItems,
  orderPayments,
  orders,
  partTypes,
  products,
  recipeItems,
  recipes,
  sessions,
  stations,
  users,
} from "./db/schema";
import { computeObvalka } from "./obvalka-calc";
import { TRPCError } from "@trpc/server";
import {
  directorProcedure,
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
    for (const it of byRecipe.get(r.id) ?? []) {
      const c = carcassOf(it.stockHint, r.category);
      const cost = c ? meatCost[c] : null;
      if (c && cost && it.qtyG) {
        meatCostTotal += (it.qtyG / 1000) * cost;
        meatG += it.qtyG;
      }
    }
    meatCostTotal = Math.round(meatCostTotal);
    const salePrice = r.salePrice ?? 0;
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      salePrice,
      meatCostTotal,
      meatG,
      meatPct:
        salePrice > 0 ? Math.round((meatCostTotal / salePrice) * 100) : null,
    };
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
          throw new TRPCError({ code: "UNAUTHORIZED", message: "PIN noto'g'ri" });
        }

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
    categories: protectedProcedure.query(async () => {
      return db
        .select({
          id: categories.id,
          name: categories.name,
          position: categories.position,
        })
        .from(categories)
        .where(eq(categories.active, true))
        .orderBy(categories.position, categories.name);
    }),

    products: protectedProcedure
      .input(z.object({ categoryId: z.string().uuid().optional() }).optional())
      .query(async ({ input }) => {
        return db
          .select({
            id: products.id,
            name: products.name,
            type: products.type,
            unit: products.unit,
            price: products.price,
            soldByWeight: products.soldByWeight,
            category: categories.name,
            station: stations.name,
          })
          .from(products)
          .leftJoin(categories, eq(products.categoryId, categories.id))
          .leftJoin(stations, eq(products.stationId, stations.id))
          .where(
            and(
              eq(products.active, true),
              input?.categoryId
                ? eq(products.categoryId, input.categoryId)
                : undefined,
            ),
          )
          .orderBy(products.type, products.name);
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
        const row = (
          await db
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

        const ptList = await db
          .select()
          .from(partTypes)
          .where(eq(partTypes.carcassType, input.carcassType));
        const ptMap = new Map(ptList.map((p) => [p.id, p]));
        const toInsert = input.parts
          .filter((p) => p.weightG > 0)
          .map((p) => ({
            obvalkaId: row.id,
            partTypeId: p.partTypeId,
            name: ptMap.get(p.partTypeId)?.name ?? "?",
            weightG: p.weightG,
          }));
        if (toInsert.length) await db.insert(obvalkaParts).values(toInsert);
        return { id: row.id };
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

    close: protectedProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          payments: z
            .array(
              z.object({
                method: z.enum(["cash", "card", "click", "payme", "debt"]),
                amount: z.number().int().nonnegative(),
              }),
            )
            .optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await db
          .update(orders)
          .set({
            status: "closed",
            closedAt: new Date(),
            closedById: ctx.user.id,
          })
          .where(eq(orders.id, input.id));
        const pays = (input.payments ?? []).filter((p) => p.amount > 0);
        if (pays.length)
          await db
            .insert(orderPayments)
            .values(pays.map((p) => ({ orderId: input.id, ...p })));
        return { ok: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
