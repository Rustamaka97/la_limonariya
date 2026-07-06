import { useState } from "react";
import type { SessionUser } from "./App";
import { BRAND } from "./brand";
import { trpc } from "./trpc";

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function Login({ onSuccess }: { onSuccess: (u: SessionUser) => void }) {
  const isTerminal =
    typeof navigator !== "undefined" &&
    (navigator.userAgent.includes("LaLimonPOS") ||
      (typeof location !== "undefined" && location.search.includes("terminal")));
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(value: string) {
    setBusy(true);
    setError(false);
    try {
      onSuccess(await trpc.auth.login.mutate({ pin: value }));
    } catch {
      setError(true);
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

  function backspace() {
    setError(false);
    setPin((p) => p.slice(0, -1));
  }

  const key =
    "rounded-2xl bg-brand-soft py-5 text-3xl font-semibold text-brand-cream transition active:scale-95 active:bg-brand-gold active:text-brand-ink disabled:opacity-40";
  const utilKey =
    "grid place-items-center rounded-2xl py-5 text-2xl text-brand-cream-soft/80 transition active:scale-95 active:bg-brand-soft disabled:opacity-40";

  return (
    <main className="flex min-h-dvh flex-col bg-brand-deep text-brand-cream">
      <div className="flex min-h-0 flex-1">
        {/* Chap panel — restorani (mobil'da yashiriladi) */}
        <section className="relative hidden w-[55%] overflow-hidden bg-brand md:block">
          <svg
            viewBox="0 0 400 440"
            preserveAspectRatio="xMidYMid slice"
            className="absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            <rect x="0" y="0" width="400" height="250" fill="#fff0e5" />
            <rect x="0" y="230" width="400" height="60" fill="#f3b759" />
            <rect x="0" y="290" width="400" height="150" fill="#0e4037" />
            <circle cx="310" cy="120" r="40" fill="#d99a2b" />
            <path d="M20 70 Q120 120 220 72 T400 76" fill="none" stroke="#16553f" strokeWidth="2" />
            <circle cx="70" cy="92" r="5" fill="#0e4037" />
            <circle cx="125" cy="100" r="5" fill="#d99a2b" />
            <circle cx="180" cy="94" r="5" fill="#16553f" />
            <circle cx="235" cy="80" r="5" fill="#d99a2b" />
            <circle cx="300" cy="80" r="5" fill="#0e4037" />
            <circle cx="120" cy="360" r="26" fill="#f3b759" />
            <circle cx="120" cy="360" r="26" fill="none" stroke="#d99a2b" strokeWidth="2" />
            <circle cx="270" cy="380" r="20" fill="#f3b759" />
            <circle cx="270" cy="380" r="20" fill="none" stroke="#d99a2b" strokeWidth="2" />
          </svg>

          <div className="absolute left-5 top-5 rounded-full bg-brand-cream px-4 py-2 text-sm text-brand-ink shadow">
            {BRAND.name} <span className="text-brand-ink/50">· {BRAND.city}</span>
          </div>
        </section>

        {/* O'ng panel — PIN */}
        <section className="flex flex-1 flex-col items-center justify-center px-6">
          <div className="w-full max-w-xs space-y-8 text-center">
            <div>
              <img
                src={BRAND.logoSmall}
                alt=""
                className="mx-auto mb-3 h-16 w-16 rounded-full object-cover ring-2 ring-brand-gold/40"
              />
              <h1 className="text-2xl font-bold">{BRAND.name}</h1>
              <p className="mt-1 text-sm tracking-wide text-brand-cream-soft/70">
                PIN кодни киритинг
              </p>
            </div>

            <div className="flex h-4 justify-center gap-3">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`h-4 w-4 rounded-full border-2 transition ${
                    error ? "border-red-500" : "border-brand-cream-soft/40"
                  } ${pin.length > i ? (error ? "bg-red-500" : "bg-brand-gold") : ""}`}
                />
              ))}
            </div>
            <p className={`h-4 text-sm text-red-400 ${error ? "" : "invisible"}`}>
              PIN нотўғри
            </p>

            <div className="grid grid-cols-3 gap-3">
              {DIGITS.map((d) => (
                <button key={d} onClick={() => press(d)} disabled={busy} className={key}>
                  {d}
                </button>
              ))}
              <button
                onClick={backspace}
                disabled={busy || pin.length === 0}
                className={utilKey}
                aria-label="ўчириш"
              >
                ⌫
              </button>
              <button onClick={() => press("0")} disabled={busy} className={key}>
                0
              </button>
              <button
                onClick={() => {
                  setError(false);
                  setPin("");
                }}
                disabled={busy || pin.length === 0}
                className={utilKey}
                aria-label="тозалаш"
              >
                ✕
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Pastki panel */}
      <footer className="flex items-center justify-between border-t border-brand-soft/40 px-6 py-3 text-xs text-brand-cream-soft/50">
        <span>{BRAND.name}</span>
        <span>{isTerminal ? "🖥️ Терминал" : BRAND.instagram}</span>
        <span>Филиал: {BRAND.city}</span>
      </footer>
    </main>
  );
}
