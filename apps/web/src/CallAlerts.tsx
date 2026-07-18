import { useEffect, useRef, useState } from "react";
import { trpc } from "./trpc";

// Ходим (POS'да логин) устидаги overlay: меҳмон чақириқларини полл қилиб,
// пульсли банер + беп билан кўрсатади. «Бордим» → ёпилади. Ҳамма экранда.
type Call = { id: string; kind: string; createdAt: string; tableName: string; hall: string | null };
const KIND: Record<string, { label: string; emoji: string }> = {
  waiter: { label: "Официант", emoji: "🙋" },
  bill: { label: "Ҳисоб", emoji: "🧾" },
  water: { label: "Сув", emoji: "💧" },
};

function beep() {
  if (localStorage.getItem("pos-sound-off") === "1") return;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.12;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.frequency.setValueAtTime(660, ctx.currentTime + 0.12);
    g.gain.setValueAtTime(0.0001, ctx.currentTime + 0.28);
    o.stop(ctx.currentTime + 0.3);
    o.onended = () => ctx.close();
  } catch {
    /* аудио блок — жим */
  }
}

const minsAgo = (iso: string) => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  return m <= 0 ? "ҳозир" : `${m} дақ`;
};

export function CallAlerts() {
  const [calls, setCalls] = useState<Call[]>([]);
  const prevCount = useRef(0);

  const poll = () =>
    trpc.pos.activeCalls
      .query()
      .then((c) => setCalls(c as Call[]))
      .catch(() => {});

  useEffect(() => {
    poll();
    const iv = setInterval(poll, 15000);
    window.addEventListener("outbox:drain", poll);
    return () => {
      clearInterval(iv);
      window.removeEventListener("outbox:drain", poll);
    };
  }, []);

  useEffect(() => {
    if (calls.length > prevCount.current) beep();
    prevCount.current = calls.length;
  }, [calls.length]);

  async function resolve(id: string) {
    setCalls((c) => c.filter((x) => x.id !== id)); // оптимистик
    prevCount.current = Math.max(0, prevCount.current - 1);
    trpc.pos.resolveCall.mutate({ id }).catch(poll);
  }

  if (calls.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex max-w-[calc(100vw-2rem)] flex-col gap-2">
      {calls.map((c) => {
        const k = KIND[c.kind] ?? KIND.waiter!;
        return (
          <button
            key={c.id}
            onClick={() => resolve(c.id)}
            className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-red-600 px-4 py-3 text-left text-white shadow-xl ring-2 ring-red-300 transition animate-pulse hover:bg-red-700 motion-reduce:animate-none"
          >
            <span className="text-2xl">{k.emoji}</span>
            <span className="flex flex-col leading-tight">
              <span className="text-base font-bold">
                {c.tableName} — {k.label}
              </span>
              <span className="text-xs text-white/80">
                {c.hall ? `${c.hall} · ` : ""}
                {minsAgo(c.createdAt)} · «Бордим» учун бос
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
