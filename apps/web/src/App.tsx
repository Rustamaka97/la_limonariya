import { useEffect, useState } from "react";
import { trpc } from "./trpc";

type Status = "checking" | "ok" | "error";

export function App() {
  const [status, setStatus] = useState<Status>("checking");
  const [ts, setTs] = useState<string>();

  useEffect(() => {
    trpc.health
      .query()
      .then((r) => {
        setStatus(r.ok ? "ok" : "error");
        setTs(r.ts);
      })
      .catch(() => setStatus("error"));
  }, []);

  const label =
    status === "ok"
      ? "🟢 уланди"
      : status === "error"
        ? "🔴 уланмади"
        : "⏳ текширилмоқда";

  return (
    <main className="grid min-h-dvh place-items-center bg-zinc-50 text-zinc-900">
      <div className="space-y-3 text-center">
        <h1 className="text-3xl font-bold">La Limonariya</h1>
        <p className="text-zinc-500">Ресторан бошқарув тизими</p>
        <p>
          Сервер: <span className="font-medium">{label}</span>
        </p>
        {ts && <p className="text-xs text-zinc-400">{ts}</p>}
      </div>
    </main>
  );
}
