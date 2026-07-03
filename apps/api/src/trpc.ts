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

// Чек ёпиш = кассир иши (SPEC: «чекни фақат КАССИР ёпади»). Официант/бозорчи
// тўлов қабул қила олмайди — фақат директор/менежер/кассир.
export const cashierProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!["director", "manager", "cashier"].includes(ctx.user.role))
    throw new TRPCError({ code: "FORBIDDEN" });
  return next();
});
