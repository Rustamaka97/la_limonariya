import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { reportError } from "./alert";
import { createContext } from "./context";
import { appRouter } from "./router";

process.on("uncaughtException", (err) => reportError("uncaughtException", err));
process.on("unhandledRejection", (err) => reportError("unhandledRejection", err));

const app = new Hono();

app.onError((err, c) => {
  reportError(`${c.req.method} ${c.req.path}`, err);
  return c.json({ error: "internal_error" }, 500);
});

app.use("/trpc/*", trpcServer({ router: appRouter, createContext }));

app.get("/api/health", (c) => c.json({ ok: true }));

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on :${info.port}`);
});

export type { AppRouter } from "./router";
