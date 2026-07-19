import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { trpc } from "./trpc";

// Директор принт-саҳифаси: ҳар столга 3 QR (Официант чақириш · Тўлов · Меню).
// Кесиб столга ёпиштирилади. База URL = window.location.origin (staging ёки прод —
// қаерда очилса ўша). ?tableqr билан кирилади (директор, логин керак).
type T = { id: string; name: string; hallId: string };
type H = { id: string; name: string };
const KINDS = [
  { key: "call", label: "Официант чақириш" },
  { key: "pay", label: "Тўлов (QR)" },
  { key: "menu", label: "Меню · буюртma" },
] as const;

export function TableQrPage() {
  const [tables, setTables] = useState<T[]>([]);
  const [halls, setHalls] = useState<H[]>([]);
  const [qr, setQr] = useState<Record<string, string>>({});
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    Promise.all([trpc.pos.tables.query(), trpc.pos.halls.query()])
      .then(([t, h]) => {
        setTables(t as T[]);
        setHalls(h as H[]);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!tables.length) return;
    let alive = true;
    (async () => {
      const map: Record<string, string> = {};
      for (const t of tables) {
        for (const k of KINDS) {
          const url = `${origin}/?${k.key}=${t.id}`;
          map[`${t.id}:${k.key}`] = await QRCode.toDataURL(url, { width: 220, margin: 1 });
        }
      }
      if (alive) setQr(map);
    })();
    return () => {
      alive = false;
    };
  }, [tables, origin]);

  const hallName = (id: string) => halls.find((h) => h.id === id)?.name ?? "";

  return (
    <main className="mx-auto max-w-4xl bg-white p-6 text-brand-ink print:max-w-none print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-xl font-bold">🍋 Стол QR кодлари</h1>
          <p className="text-xs text-zinc-500">
            {tables.length} стол · база: <b>{origin}</b> · кесиб столга ёпиштиринг
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-soft"
          >
            🖨 Чоп этиш
          </button>
          <button
            onClick={() => (window.location.href = "/")}
            className="rounded-lg border border-brand-cream-soft px-4 py-2 text-sm text-zinc-600"
          >
            Орқага
          </button>
        </div>
      </div>

      {tables.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-400">⏳ Столлар юкланмоқда…</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {tables.map((t) => (
            <div
              key={t.id}
              className="break-inside-avoid rounded-2xl border-2 border-brand p-4 text-center"
            >
              <div className="text-lg font-extrabold">{t.name}</div>
              <div className="mb-2 text-xs text-zinc-400">{hallName(t.hallId)}</div>
              <div className="grid grid-cols-3 gap-2">
                {KINDS.map((k) => (
                  <div key={k.key} className="flex flex-col items-center">
                    {qr[`${t.id}:${k.key}`] ? (
                      <img src={qr[`${t.id}:${k.key}`]} alt={k.label} className="w-full" />
                    ) : (
                      <div className="aspect-square w-full animate-pulse bg-zinc-100" />
                    )}
                    <div className="mt-1 text-[10px] font-semibold leading-tight">{k.label}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
