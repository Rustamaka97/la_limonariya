import { useCallback, useEffect, useState } from "react";
import { Login } from "./Login";
import { Shell } from "./Shell";
import { idbGet, idbSet } from "./lib/idb";
import { startOutbox } from "./lib/outbox";
import { trpc } from "./trpc";

export type SessionUser = { id: string; name: string; role: string };

export function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const u = await trpc.auth.me.query();
      setUser(u);
      idbSet("session.user", u ?? null).catch(() => {});
    } catch {
      // Оффлайн бут: кэшланган сессияни тиклаб, официант POS'да қолади (фаза 4).
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        const cached = await idbGet<SessionUser>("session.user").catch(() => undefined);
        setUser(cached ?? null);
      } else {
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
    // Уланганда/интервалда навбатни синхронлаш (app бўйича битта).
    const stop = startOutbox();
    // Навбат 401 берса (сессия эскирган) — қайта текшир; йўқ бўлса Login'га.
    const reauth = () => void load();
    window.addEventListener("outbox:auth", reauth);
    return () => {
      stop();
      window.removeEventListener("outbox:auth", reauth);
    };
  }, [load]);

  if (loading) {
    return (
      <main className="grid min-h-dvh place-items-center bg-zinc-900 text-zinc-500">
        ⏳
      </main>
    );
  }
  if (!user) return <Login onSuccess={setUser} />;
  return <Shell user={user} onLogout={() => setUser(null)} />;
}
