import { useState } from "react";
import { trpc } from "./trpc";

// Меҳмон стол QR'ини сканерлаганда очилади (public, auth йўқ). Официант чақиради.
type Kind = "waiter" | "bill" | "water";
const BTNS: { kind: Kind; label: string; sub: string; emoji: string }[] = [
  { kind: "waiter", label: "Официант чақириш", sub: "Ёрдам керак", emoji: "🙋" },
  { kind: "bill", label: "Ҳисоб сўраш", sub: "Тўлайман (пречек)", emoji: "🧾" },
  { kind: "water", label: "Сув", sub: "Сув келтиринг", emoji: "💧" },
];

export function CallPage({ tableId }: { tableId: string }) {
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [err, setErr] = useState(false);

  async function call(kind: Kind, label: string) {
    if (busy) return;
    setBusy(kind);
    setErr(false);
    try {
      await trpc.pos.callWaiter.mutate({ tableId, kind });
      setSent(label);
      if ("vibrate" in navigator) navigator.vibrate(30);
      setTimeout(() => setSent(null), 6000);
    } catch {
      setErr(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-brand-deep px-6 py-10 text-white">
      <div className="mb-8 text-center">
        <div className="text-5xl">🍋</div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">La Limonariya</h1>
        <p className="mt-1 text-sm text-white/60">Нима кераклигини танланг — официант келади</p>
      </div>

      {sent ? (
        <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-3xl bg-brand-gold px-6 py-10 text-center text-brand-ink shadow-xl">
          <div className="text-5xl">✅</div>
          <p className="text-lg font-bold">{sent}</p>
          <p className="text-sm text-brand-ink/70">Официант тез орада келади. Раҳмат!</p>
        </div>
      ) : (
        <div className="flex w-full max-w-sm flex-col gap-3">
          {BTNS.map((b) => (
            <button
              key={b.kind}
              onClick={() => call(b.kind, b.label)}
              disabled={busy !== null}
              className="flex items-center gap-4 rounded-2xl bg-white/10 px-5 py-4 text-left backdrop-blur transition active:scale-[.98] disabled:opacity-50"
            >
              <span className="text-3xl">{b.emoji}</span>
              <span className="flex flex-col">
                <span className="text-lg font-bold">{busy === b.kind ? "Юборилмоқда…" : b.label}</span>
                <span className="text-sm text-white/60">{b.sub}</span>
              </span>
            </button>
          ))}
          {err && (
            <p className="mt-1 text-center text-sm text-red-300">
              Юборилмади — қайта уриниб кўринг ёки официантни қўл билан чақиринг.
            </p>
          )}
        </div>
      )}

      <p className="mt-10 text-center text-xs text-white/30">La Limonariya · зал хизмати</p>
    </main>
  );
}
