import { sql } from "drizzle-orm";
import { db } from "./db/client";
import { publicProcedure, router } from "./trpc";

export const appRouter = router({
  health: publicProcedure.query(async () => {
    await db.execute(sql`select 1`);
    return { ok: true, ts: new Date().toISOString() };
  }),
});

export type AppRouter = typeof appRouter;
