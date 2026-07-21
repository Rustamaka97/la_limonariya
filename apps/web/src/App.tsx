import { useCallback, useEffect, useState } from "react";
import { Login } from "./Login";
import { Shell } from "./Shell";
import { CallPage } from "./CallPage";
import { CallAlerts } from "./CallAlerts";
import { TableQrPage } from "./TableQrPage";
import { BillPage } from "./BillPage";
import { GuestMenuPage } from "./GuestMenuPage";
import { idbGet, idbSet } from "./lib/idb";
import { startOutbox } from "./lib/outbox";
import { trpc } from "./trpc";

export type SessionUser = { id: string; name: string; role: string };

export function App() {
  // Меҳмон стол QR'лари (public, auth йўқ): ?call=<tableId> → официант чақириш,
  // ?pay=<tableId> → чек + QR-тўлов. Hooks'дан ОЛДИН, шартсиз (MainApp алоҳида).
  const params =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const callTable = params?.get("call");
  if (callTable) return <CallPage tableId={callTable} />;
  const payTable = params?.get("pay");
  if (payTable) return <BillPage tableId={payTable} />;
  const menuTable = params?.get("menu");
  if (menuTable) return <GuestMenuPage tableId={menuTable} />;
  return <MainApp />;
}

function MainApp() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  // DEV-ONLY (import.meta.env.DEV): ?devrole=admin|buyer|manager|director — логинсиз
  // мобил UI синови. Production build'да ЎЛИК (DEV=false). Backend оқим синалмайди.
  const devRole =
    import.meta.env.DEV && typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("devrole")
      : null;

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

  if (loading && !devRole) {
    return (
      <main className="grid min-h-dvh place-items-center bg-zinc-900 text-zinc-500">
        ⏳
      </main>
    );
  }
  const activeUser: SessionUser | null = devRole
    ? { id: "dev", name: `Dev·${devRole}`, role: devRole }
    : user;
  if (!activeUser) return <Login onSuccess={setUser} />;
  // Директор стол QR принт-саҳифаси (?tableqr) — логин керак, фақат директор.
  if (activeUser.role === "director" && new URLSearchParams(window.location.search).has("tableqr"))
    return <TableQrPage />;
  return (
    <>
      <Shell user={activeUser} onLogout={() => setUser(null)} />
      {/* Официант чақириқ огоҳлантириши — POS устида, ҳамма экранда кўринади */}
      <CallAlerts />
    </>
  );
}
