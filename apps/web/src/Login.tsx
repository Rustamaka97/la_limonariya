import { useState } from "react";
import type { SessionUser } from "./App";
import { BRAND } from "./brand";
import { trpc } from "./trpc";

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function Login({ onSuccess }: { onSuccess: (u: SessionUser) => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(value: string) {
    setBusy(true);
    setError(null);
    try {
      onSuccess(await trpc.auth.login.mutate({ pin: value }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setError(msg.includes("кутинг") ? msg : "PIN нотўғри");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  function press(d: string) {
    if (busy || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) void submit(next);
  }

  const key =
    "rounded-2xl bg-brand-soft py-4 text-2xl font-mono font-semibold transition-transform active:bg-brand active:scale-95 disabled:opacity-40";

  return (
    <main className="grid min-h-dvh place-items-center bg-brand-deep text-white">
      <div className="w-full max-w-xs space-y-8 px-6 text-center">
        <div className="animate-brand-fade">
          <img
            src="/brand/logo-320.png"
            alt=""
            className="mx-auto mb-3 h-32 w-32 rounded-full object-cover ring-4 ring-brand-gold/40 shadow-[0_0_24px_rgba(243,183,89,0.35)]"
          />
          <h1 className="font-display text-2xl font-bold">{BRAND.name}</h1>
          <p className="mt-1 text-sm text-brand-cream-soft/70">PIN кодни киритинг</p>
        </div>

        <div className="flex justify-center gap-3">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`h-4 w-4 rounded-full border-2 ${
                error ? "border-red-500" : "border-brand-cream-soft/40"
              } ${pin.length > i ? (error ? "bg-red-500" : "bg-brand-gold") : ""}`}
            />
          ))}
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="grid grid-cols-3 gap-3">
          {DIGITS.map((d) => (
            <button key={d} onClick={() => press(d)} disabled={busy} className={key}>
              {d}
            </button>
          ))}
          <span />
          <button onClick={() => press("0")} disabled={busy} className={key}>
            0
          </button>
          <button
            onClick={() => {
              setError(null);
              setPin((p) => p.slice(0, -1));
            }}
            disabled={busy}
            className="rounded-2xl py-4 text-2xl transition-transform active:bg-brand-soft active:scale-95 disabled:opacity-40"
          >
            ⌫
          </button>
        </div>
      </div>
    </main>
  );
}
