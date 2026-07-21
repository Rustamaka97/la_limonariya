import { useEffect, useMemo, useState } from "react";
import { trpc } from "./trpc";

// 🔔 Билдиришнома маркази (CloPOS «Уведомления» 1:1 структура): чап турлар панели +
// Янги/Эски таб + ўнг рўйхат. Турлар La Limon-мос (CloPOS'даги доставка/курьер/киоск —
// ресторанда йўқ, ташланди; QR-меню/тўлов/хато — келажак учун жой қолдирилди).
export type Notif = {
  kind: string;
  title: string;
  detail: string;
  at: string | Date | null;
  severity: "info" | "warn" | "error";
};

// Чап панел турлари (CloPOS «QR меню · Таймер · Общие · Ошибка» каби, La Limon-мос).
const KINDS: { key: string; label: string; icon: string }[] = [
  { key: "all", label: "Барчаси", icon: "📋" },
  { key: "call", label: "Официант чақирув", icon: "🔔" },
  { key: "stale", label: "Таймер — узоқ стол", icon: "⏰" },
  { key: "stop", label: "Стоп-лист", icon: "🛑" },
  { key: "qr", label: "QR-меню буюртма", icon: "📱" },
  { key: "pay", label: "Тўлов", icon: "💳" },
  { key: "error", label: "Хато — принтер", icon: "⚠️" },
];

const iconFor = (k: string) =>
  k === "call" ? "🔔" : k === "stale" ? "⏰" : k === "stop" ? "🛑" : k === "qr" ? "📱" : k === "pay" ? "💳" : "⚠️";

export function NotifCenter({
  notifs,
  onClose,
}: {
  notifs: Notif[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"new" | "old">("new"); // Новый / Старый
  const [kind, setKind] = useState("all"); // танланган тур
  const [old, setOld] = useState<Notif[] | null>(null); // «Эски» — ечилган тарих (lazy)

  // Чап панел сони — доим «Янги» (ечилмаган) бўйича (CloPOS каби).
  const countBy = useMemo(() => {
    const m: Record<string, number> = { all: notifs.length };
    for (const n of notifs) m[n.kind] = (m[n.kind] ?? 0) + 1;
    return m;
  }, [notifs]);

  // «Эски» таб биринчи очилганда — ечилган чақирувлар тарихини юкла.
  useEffect(() => {
    if (tab !== "old" || old !== null) return;
    trpc.pos.resolvedNotifications
      .query()
      .then(setOld)
      .catch(() => setOld([]));
  }, [tab, old]);

  const source = tab === "old" ? (old ?? []) : notifs;
  const list = source.filter((n) => kind === "all" || n.kind === kind);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-stretch justify-end bg-brand-ink/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Чап — турлар панели (CloPOS) */}
        <div className="flex w-52 shrink-0 flex-col border-r border-clopos-line bg-clopos-bg/40">
          <div className="flex items-center gap-2 bg-brand px-4 py-3 text-white">
            <button
              type="button"
              onClick={onClose}
              title="Орқага"
              aria-label="Орқага"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg transition hover:bg-white/15 active:scale-95"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 4l-6 6 6 6" />
              </svg>
            </button>
            <h3 className="text-[15px] font-bold">Билдиришлар</h3>
          </div>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
            {KINDS.map((k) => {
              const n = countBy[k.key] ?? 0;
              return (
                <button
                  key={k.key}
                  onClick={() => setKind(k.key)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[13px] transition ${
                    kind === k.key ? "bg-brand/10 font-semibold text-brand-ink" : "text-zinc-600 hover:bg-clopos-bg"
                  }`}
                >
                  <span className="text-[15px]">{k.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{k.label}</span>
                  {n > 0 && (
                    <span className="grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                      {n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Ўнг — Янги/Эски таб + рўйхат */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center border-b border-clopos-line">
            <div className="flex flex-1">
              {(["new", "old"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 py-3 text-[14px] font-semibold transition ${
                    tab === t ? "border-b-2 border-brand-deep text-brand-ink" : "text-zinc-400 hover:text-zinc-600"
                  }`}
                >
                  {t === "new" ? "Янги" : "Эски"}
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className="grid h-11 w-11 place-items-center text-zinc-400 transition hover:text-brand-ink"
              aria-label="Ёпиш"
            >
              <span className="text-lg leading-none">✕</span>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {list.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-300">
                <span className="text-4xl" aria-hidden>🔔</span>
                <p className="text-[13px]">
                  {tab === "old" ? "Эски билдиришнома йўқ" : "Янги билдиришнома йўқ"}
                </p>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {list.map((n, i) => {
                  const box =
                    n.severity === "error"
                      ? "border-red-400 bg-red-50"
                      : n.severity === "warn"
                        ? "border-amber-400 bg-amber-50"
                        : "border-zinc-200 bg-white";
                  return (
                    <li
                      key={i}
                      className={`flex items-start gap-2.5 rounded-xl border-l-4 ${box} px-3 py-2.5`}
                    >
                      <span className="text-[16px]" aria-hidden>{iconFor(n.kind)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-brand-ink">{n.title}</p>
                        <p className="truncate text-[12px] text-zinc-500">{n.detail}</p>
                      </div>
                      {n.at && (
                        <span className="shrink-0 text-[11px] text-zinc-400">
                          {new Date(n.at).toLocaleTimeString("ru-RU", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
