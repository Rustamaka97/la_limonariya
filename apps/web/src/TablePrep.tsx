import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { trpc } from "./trpc";

type Hall = { id: string; name: string };
type Prep = {
  id: string;
  hallId: string | null;
  items: Record<string, boolean>;
  photoUrl: string | null;
  note: string | null;
  createdAt: string | Date;
};

// Эрталабки стол-тайёрлаш чек-листи (серверовка/админ) — зал безаги элементлари.
const PREP_ITEMS = [
  { key: "tarelka", label: "Тарелка" },
  { key: "vilka", label: "Вилка" },
  { key: "qoshiq", label: "Қошиқ" },
  { key: "pepelnitsa", label: "Пепелница" },
  { key: "zubochistka", label: "Зубочистка" },
  { key: "salfetka", label: "Салфетка" },
];

// Расм телефон камерасидан — 900px/jpeg0.6 ~60КБ (харид/жарима билан бир хил).
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 900;
      let { width, height } = img;
      if (Math.max(width, height) > max) {
        const s = max / Math.max(width, height);
        width = Math.round(width * s);
        height = Math.round(height * s);
      }
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const ctx = c.getContext("2d");
      if (!ctx) return reject(new Error("no-ctx"));
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.6));
    };
    img.onerror = () => reject(new Error("img"));
    img.src = URL.createObjectURL(file);
  });
}

const chip = (active: boolean) =>
  `rounded-full px-3 py-1.5 text-xs font-medium ${
    active ? "bg-brand text-white" : "bg-zinc-100 text-zinc-600"
  }`;

export function TablePrep() {
  const [halls, setHalls] = useState<Hall[]>([]);
  const [today, setToday] = useState<Prep[] | null>(null);
  const [hallId, setHallId] = useState<string | "all">("all");
  const [items, setItems] = useState<Record<string, boolean>>({});
  const [photo, setPhoto] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function refresh() {
    trpc.tablePrep.byDay
      .query()
      .then((r) => setToday(r as Prep[]))
      .catch(() => setToday(null));
  }
  useEffect(() => {
    trpc.pos.halls
      .query()
      .then((h) => setHalls(h as Hall[]))
      .catch(() => {});
    refresh();
  }, []);

  const doneCount = PREP_ITEMS.filter((it) => items[it.key]).length;

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      setPhoto(await compressImage(f));
    } catch {
      setMsg("Расм юкланмади");
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await trpc.tablePrep.submit.mutate({
        hallId: hallId === "all" ? null : hallId,
        items: PREP_ITEMS.reduce(
          (a, it) => ({ ...a, [it.key]: !!items[it.key] }),
          {} as Record<string, boolean>,
        ),
        photoUrl: photo ?? undefined,
        note: note.trim() || undefined,
      });
      setItems({});
      setPhoto(null);
      setNote("");
      setMsg("Сақланди ✓");
      refresh();
    } catch {
      setMsg("Хато");
    } finally {
      setBusy(false);
    }
  }

  const hallName = (id: string | null) =>
    id ? (halls.find((h) => h.id === id)?.name ?? "Зал") : "Умумий";

  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-xl border bg-white p-4">
        <h2 className="text-sm font-semibold">
          Стол тайёрлаш — {new Date().toLocaleDateString("ru-RU")}
        </h2>

        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setHallId("all")} className={chip(hallId === "all")}>
            Умумий
          </button>
          {halls.map((h) => (
            <button
              key={h.id}
              onClick={() => setHallId(h.id)}
              className={chip(hallId === h.id)}
            >
              {h.name}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {PREP_ITEMS.map((it) => (
            <button
              key={it.key}
              onClick={() => setItems((s) => ({ ...s, [it.key]: !s[it.key] }))}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm ${
                items[it.key]
                  ? "border-brand bg-brand-cream text-brand"
                  : "border-zinc-200 text-zinc-600"
              }`}
            >
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded text-xs ${
                  items[it.key] ? "bg-brand text-white" : "bg-zinc-100"
                }`}
              >
                {items[it.key] ? "✓" : ""}
              </span>
              {it.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onPhoto}
            className="hidden"
          />
          {photo ? (
            <div className="relative">
              <img
                src={photo}
                alt="стол"
                className="h-16 w-16 rounded-lg object-cover ring-1 ring-black/10"
              />
              <button
                onClick={() => setPhoto(null)}
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-red-500 text-xs text-white"
                aria-label="Расмни ўчириш"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-sm text-zinc-500 hover:border-brand hover:text-brand"
            >
              📷 Стол расми
            </button>
          )}
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Изоҳ (ихтиёрий)"
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand"
        />

        {msg && (
          <p
            className={`text-sm ${
              msg.includes("✓") ? "text-brand" : "text-red-500"
            }`}
          >
            {msg}
          </p>
        )}

        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400">
            {doneCount === PREP_ITEMS.length
              ? "Ҳаммаси тайёр ✓"
              : `${doneCount}/${PREP_ITEMS.length} белгиланди`}
          </span>
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-brand px-6 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? "…" : "Сақлаш"}
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-500">
          Бугунги текширувлар
        </h2>
        <div className="space-y-2">
          {today?.map((p) => {
            const items = (p.items ?? {}) as Record<string, boolean>;
            const done = PREP_ITEMS.filter((it) => items[it.key]).length;
            const full = done === PREP_ITEMS.length;
            return (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-xl border bg-white px-4 py-3"
              >
                {p.photoUrl && (
                  <img
                    src={p.photoUrl}
                    alt=""
                    className="h-11 w-11 shrink-0 rounded-lg object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{hallName(p.hallId)}</div>
                  <div className="truncate text-xs text-zinc-400">
                    {p.note || `${done}/${PREP_ITEMS.length} тайёр`}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                    full
                      ? "bg-brand-cream text-brand"
                      : "bg-amber-50 text-amber-600"
                  }`}
                >
                  {full ? "Тайёр" : `${done}/${PREP_ITEMS.length}`}
                </span>
              </div>
            );
          })}
          {today && today.length === 0 && (
            <div className="rounded-xl border bg-white px-4 py-8 text-center text-sm text-zinc-400">
              Ҳали текширув йўқ
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
