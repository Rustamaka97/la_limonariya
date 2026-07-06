import { initTRPC, TRPCError } from "@trpc/server";
import type { Ctx } from "./context";

const t = initTRPC.context<Ctx>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const directorProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "director") throw new TRPCError({ code: "FORBIDDEN" });
  return next();
});

export const managerProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "director" && ctx.user.role !== "manager")
    throw new TRPCError({ code: "FORBIDDEN" });
  return next();
});

// Касса даражаси: пул билан боғлиқ амаллар (заказ ёпиш, тўлов) — фақат
// кассир/менежер/директор. Официант заказ вести, лекин пул олмайди.
export const cashierProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!["director", "manager", "cashier"].includes(ctx.user.role))
    throw new TRPCError({ code: "FORBIDDEN" });
  return next();
});

// Харид/склад даражаси: обвалка, харид, омбор — director/manager/buyer
// (бозорчи). Официант/кассир омборга тегмайди.
export const buyerProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!["director", "manager", "buyer"].includes(ctx.user.role))
    throw new TRPCError({ code: "FORBIDDEN" });
  return next();
});
