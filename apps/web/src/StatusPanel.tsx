import { useCallback, useEffect, useState } from "react";
import { BRAND } from "./brand";
import { trpc } from "./trpc";
import { idbAll } from "./lib/idb";
import { IPrinter, IWifi, IWifiOff, ISpin, IWarn } from "./icons";

// POS «Статус» панели — CloPOS «Статус» ойнасининг эквиваленти, яшил+олтин бренд.
// Кўрсатади: принтер (станция) онлайн/офлайн + IP · уланиш (Интернет/Сервер/навбат)
// · ушбу терминал/версия. Backend: system.status (принтер TCP-probe). Уланиш ҳолати
// — браузерда ҳисобланади. Self-contained: Shell.tsx'га фақат 1 тугма тегади.

// Версия — қўлда bump қилинади (кейин build-time'га уланади).
const APP_VERSION = "1.0";

type Printer = { id: string; name: string; ip: string | null; online: boolean };
type DotState = "on" | "off" | "none";

function Dot({ state }: { state: DotState }) {
  const c =
    state === "on" ? "bg-emerald-500" : state === "off" ? "bg-red-500" : "bg-zinc-300";
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${c}`} />;
}

export function StatusPanel({ onClose }: { onClose: () => void }) {
  const [printers, setPrinters] = useState<Printer[] | null>(null);
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [serverTime, setServerTime] = useState<string | null>(null);
  const [queue, setQueue] = useState(0);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const d = await trpc.system.status.query();
      setPrinters(d.printers);
      setServerTime(d.serverTime);
      setServerOk(true);
    } catch {
      setServerOk(false);
    }
    try {
      const ops = await idbAll<unknown>("outbox");
      setQueue(ops.length);
    } catch {
      /* idb йўқ — навбат 0 деб оламиз */
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const isTerminal =
    typeof navigator !== "undefined" &&
    (navigator.userAgent.includes("LaLimonPOS") ||
      (typeof location !== "undefined" && location.search.includes("terminal")));

  const withIp = printers?.filter((p) => p.ip) ?? [];
  const printersOnline = withIp.filter((p) => p.online).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Хедер — яшил бренд */}
        <div className="flex items-center justify-between bg-brand px-5 py-3 text-white">
          <div className="flex items-center gap-2">
            {online && serverOk !== false ? (
              <IWifi className="h-5 w-5" />
            ) : (
              <IWifiOff className="h-5 w-5" />
            )}
            <h2 className="text-lg font-bold">Статус</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void refresh()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium transition hover:bg-white/25 disabled:opacity-50"
            >
              {busy ? <ISpin className="h-4 w-4" /> : "↻"} Янгилаш
            </button>
            <button
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-lg text-2xl leading-none transition hover:bg-white/15"
              aria-label="Ёпиш"
            >
              ×
            </button>
          </div>
        </div>

        <div className="grid gap-5 p-5 sm:grid-cols-[190px_1fr]">
          {/* Чап: терминал/бренд инфо */}
          <div className="space-y-2.5 sm:border-r sm:pr-5">
            <Info label="Бренд" value={BRAND.name} />
            <Info label="Шаҳар" value={BRAND.city} />
            <Info label="Терминал" value={isTerminal ? "POS терминал" : "Браузер"} />
            <Info label="Версия" value={APP_VERSION} />
            {serverTime && (
              <Info
                label="Сервер вақти"
                value={new Date(serverTime).toLocaleTimeString("ru-RU")}
              />
            )}
          </div>

          {/* Ўнг: карталар */}
          <div className="space-y-4">
            {/* Уланиш */}
            <section>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Уланиш
              </h3>
              <div className="grid gap-2 sm:grid-cols-3">
                <StatCard
                  dot={online ? "on" : "off"}
                  title="Интернет"
                  sub={online ? "уланган" : "йўқ"}
                />
                <StatCard
                  dot={serverOk === null ? "none" : serverOk ? "on" : "off"}
                  title="Сервер"
                  sub={serverOk === null ? "…" : serverOk ? "ишлаяпти" : "уланмади"}
                />
                <StatCard
                  dot={queue === 0 ? "on" : "off"}
                  title="Навбат"
                  sub={queue === 0 ? "бўш" : `${queue} кутяпти`}
                />
              </div>
            </section>

            {/* Принтерлар (станция) */}
            <section>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                <IPrinter className="h-4 w-4" /> Принтерлар · {printersOnline}/
                {withIp.length}
              </h3>
              {printers === null ? (
                <div className="rounded-xl border bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-400">
                  {serverOk === false ? "Серверга уланмади" : "Юкланмоқда…"}
                </div>
              ) : printers.length === 0 ? (
                <div className="rounded-xl border bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-400">
                  Станция йўқ
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {printers.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 rounded-xl border bg-white px-3.5 py-2.5"
                    >
                      <Dot state={!p.ip ? "none" : p.online ? "on" : "off"} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{p.name}</div>
                        <div className="truncate text-xs tabular-nums text-zinc-400">
                          {p.ip ? `${p.ip}:9100` : "IP созланмаган"}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          !p.ip
                            ? "bg-zinc-100 text-zinc-400"
                            : p.online
                              ? "bg-emerald-50 text-emerald-600"
                              : "bg-red-50 text-red-600"
                        }`}
                      >
                        {!p.ip ? "йўқ" : p.online ? "онлайн" : "офлайн"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {serverOk === false && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-600">
                  <IWarn className="h-3.5 w-3.5 shrink-0" /> Серверга уланмади — принтер
                  ҳолати номаълум (зал серверини текширинг).
                </p>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="font-semibold text-zinc-800">{value}</div>
    </div>
  );
}

function StatCard({ dot, title, sub }: { dot: DotState; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2">
      <Dot state={dot} />
      <div className="min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="truncate text-xs text-zinc-400">{sub}</div>
      </div>
    </div>
  );
}
