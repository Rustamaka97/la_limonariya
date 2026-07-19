import { useEffect, useMemo, useState } from "react";
import { trpc } from "./trpc";

// Меҳмон стол QR'и (?menu=tableId, public) → менюдан ўзи буюртма беради.
// Кухняга автомат юборилмайди — официант кўриб тасдиқлайди («Отправить»).
type MItem = {
  id: string;
  name: string;
  price: number;
  category: string | null;
  stopped: boolean;
  soldByWeight: boolean;
};
const fmt = (n: number) => n.toLocaleString("ru-RU");

export function GuestMenuPage({ tableId }: { tableId: string }) {
  const [menu, setMenu] = useState<MItem[] | null>(null);
  const [err, setErr] = useState(false);
  const [cat, setCat] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    trpc.pos.guestMenu
      .query()
      .then((m) => setMenu(m as MItem[]))
      .catch(() => setErr(true));
  }, []);

  const cats = useMemo(() => {
    const s: string[] = [];
    for (const m of menu ?? []) {
      if (m.soldByWeight) continue; // вазнли таом — меҳмон буюртмасида йўқ
      const c = m.category ?? "Бошқа";
      if (!s.includes(c)) s.push(c);
    }
    return s;
  }, [menu]);
  const activeCat = cat ?? cats[0] ?? null;
  const shown = (menu ?? []).filter(
    (m) => (m.category ?? "Бошқа") === activeCat && !m.soldByWeight,
  );

  const cartItems = Object.entries(cart).filter(([, q]) => q > 0);
  const total = cartItems.reduce((s, [id, q]) => {
    const p = menu?.find((m) => m.id === id);
    return s + (p ? p.price * q : 0);
  }, 0);
  const count = cartItems.reduce((s, [, q]) => s + q, 0);

  const add = (id: string, d: number) =>
    setCart((c) => ({ ...c, [id]: Math.max(0, (c[id] ?? 0) + d) }));

  async function submit() {
    if (busy || count === 0) return;
    setBusy(true);
    try {
      const items = cartItems.map(([productId, qty]) => ({ productId, qty }));
      const r = await trpc.pos.guestAddItems.mutate({ tableId, items });
      setDone(r.added);
      setCart({});
      if ("vibrate" in navigator) navigator.vibrate(30);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Буюртма юборилмади");
    } finally {
      setBusy(false);
    }
  }

  if (done !== null) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-brand-deep px-6 text-white">
        <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-3xl bg-brand-gold px-6 py-10 text-center text-brand-ink shadow-xl">
          <div className="text-5xl">✅</div>
          <p className="text-lg font-bold">Буюртма қабул қилинди</p>
          <p className="text-sm text-brand-ink/70">{done} таом — официант тасдиқлаб, кухняга юборади.</p>
        </div>
        <button
          onClick={() => setDone(null)}
          className="mt-5 rounded-2xl bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur"
        >
          Яна буюртма қўшиш
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-brand-cream pb-28">
      <header className="sticky top-0 z-10 bg-brand-deep px-4 py-3 text-white shadow-md">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🍋</span>
          <div>
            <h1 className="text-lg font-bold leading-none">La Limonariya</h1>
            <p className="mt-0.5 text-xs text-white/60">Менюдан танланг — ўзингиз буюртма беринг</p>
          </div>
        </div>
      </header>

      {err ? (
        <p className="p-10 text-center text-sm text-red-600">Меню юкланмади — қайта уриниб кўринг.</p>
      ) : !menu ? (
        <p className="p-10 text-center text-brand/50">⏳</p>
      ) : (
        <>
          <div className="sticky top-[60px] z-10 flex gap-1.5 overflow-x-auto bg-brand-cream px-3 py-2">
            {cats.map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                  c === activeCat ? "bg-brand text-white" : "bg-white text-brand-ink"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-2 px-3 pt-1 sm:grid-cols-2">
            {shown.map((m) => {
              const q = cart[m.id] ?? 0;
              return (
                <div
                  key={m.id}
                  className={`flex items-center gap-3 rounded-2xl border border-brand-cream-soft bg-white p-3 ${
                    m.stopped ? "opacity-50" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-brand-ink">{m.name}</div>
                    <div className="text-sm tabular-nums text-brand">{fmt(m.price)} so'm</div>
                  </div>
                  {m.stopped ? (
                    <span className="shrink-0 rounded-lg bg-zinc-100 px-2 py-1 text-xs text-zinc-400">СТОП</span>
                  ) : q > 0 ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        onClick={() => add(m.id, -1)}
                        className="grid h-9 w-9 place-items-center rounded-full bg-brand-cream text-lg font-bold text-brand active:scale-90"
                      >
                        −
                      </button>
                      <span className="w-5 text-center font-bold tabular-nums">{q}</span>
                      <button
                        onClick={() => add(m.id, 1)}
                        className="grid h-9 w-9 place-items-center rounded-full bg-brand text-lg font-bold text-white active:scale-90"
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => add(m.id, 1)}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-gold text-lg font-bold text-brand-ink active:scale-90"
                    >
                      +
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-brand-cream-soft bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,.08)]">
          <button
            onClick={submit}
            disabled={busy}
            className="flex w-full items-center justify-between rounded-2xl bg-brand px-5 py-3.5 text-white transition active:scale-[.99] disabled:opacity-50"
          >
            <span className="text-sm font-semibold">
              {busy ? "Юборилмоқда…" : `Буюртма бериш · ${count} таом`}
            </span>
            <span className="tabular-nums font-bold">{fmt(total)} so'm</span>
          </button>
        </div>
      )}
    </main>
  );
}
