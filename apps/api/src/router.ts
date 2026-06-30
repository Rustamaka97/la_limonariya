import { and, eq } from "drizzle-orm";
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
import { sessions, users } from "./db/schema";
import { TRPCError } from "@trpc/server";
import {
  directorProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "./trpc";

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const pinSchema = z.string().regex(/^\d{4}$/, "PIN — 4 ta raqam");

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
});

export type AppRouter = typeof appRouter;
