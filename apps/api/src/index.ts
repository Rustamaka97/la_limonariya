import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { appRouter } from "./router";

const app = new Hono();

app.use("/trpc/*", cors());
app.use("/trpc/*", trpcServer({ router: appRouter }));

app.get("/api/health", (c) => c.json({ ok: true }));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on :${info.port}`);
});

export type { AppRouter } from "./router";
