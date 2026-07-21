import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "./trpc";
import { swr } from "./lib/cache";

type Prod = {
  id: string;
  name: string;
  unit: string;
  type: string;
  costPrice: number | null;
};

type Line = {
  productId: string;
  name: string;
  unit: string;
  qty: string;
  price: string;
};

type Purchase = {
  id: string;
  supplier: string | null;
  total: number;
  createdAt: string;
  buyer: string | null;
  lines: number;
};

const UNIT_LABEL: Record<string, string> = {
  kg: "кг",
  g: "г",
  l: "л",
  ml: "мл",
  dona: "дона",
};

const fmtSom = (n: number) => n.toLocaleString("ru-RU");

// Расмни телефонда сиқиш (макс 900px, jpeg 0.6) — ~60КБ base64, DB'га оғир эмас.
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
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no-ctx"));
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/jpeg", 0.6));
    };
    img.onerror = () => reject(new Error("img-load"));
    img.src = URL.createObjectURL(file);
  });
}

// Харид сақлангандаги GPS — ихтиёрий. Рад этса/timeout — жимгина null (харид
// барибир сақланади). Директорга «бозор харитаси» асоси.
function getGeo(): Promise<{ lat: string; lng: string } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude.toFixed(6),
          lng: p.coords.longitude.toFixed(6),
        }),
      () => resolve(null),
      { timeout: 5000, enableHighAccuracy: false },
    );
  });
}

export function Purchases() {
  const [prods, setProds] = useState<Prod[]>([]);
  const [recent, setRecent] = useState<Purchase[] | null>(null);
  const [supplier, setSupplier] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function refresh() {
    swr("purchase.list", () => trpc.purchase.list.query(), setRecent).catch(() =>
      setRecent([]),
    );
  }
  useEffect(() => {
    swr("purchase.products", () => trpc.purchase.products.query(), setProds).catch(
      () => setProds([]),
    );
    refresh();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const chosen = new Set(lines.map((l) => l.productId));
    return prods
      .filter((p) => !chosen.has(p.id) && p.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [search, prods, lines]);

  const total = lines.reduce((s, l) => s + (Number(l.price) || 0), 0);

  function addLine(p: Prod) {
    setLines((ls) => [
      ...ls,
      { productId: p.id, name: p.name, unit: p.unit, qty: "", price: "" },
    ]);
    setSearch("");
  }
  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }
  function removeLine(i: number) {
    setLines((ls) => ls.filter((_, j) => j !== i));
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhoto(await compressImage(file));
    } catch {
      setError("Расм юкланмади");
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function save() {
    const items = lines
      .map((l) => ({
        productId: l.productId,
        qty: Number(l.qty),
        price: Math.round(Number(l.price) || 0),
      }))
      .filter((i) => i.qty > 0);
    if (!items.length) {
      setError("Миқдор киритинг");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const geo = await getGeo();
      await trpc.purchase.create.mutate({
        supplier: supplier.trim() || undefined,
        items,
        geoLat: geo?.lat,
        geoLng: geo?.lng,
        photoUrl: photo ?? undefined,
      });
      setLines([]);
      setSupplier("");
      setPhoto(null);
      refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Хато");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Янги харид</h2>
          <input
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder="Етказувчи (ихтиёрий)"
            className="min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none focus:border-brand sm:max-w-[240px] sm:flex-none"
          />
        </div>

        <div className="relative">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Маҳсулот қидириш… (масло, пиёз, кола…)"
            className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-brand"
          />
          {filtered.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border bg-white shadow-lg">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addLine(p)}
                  className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-zinc-50"
                >
                  <span>{p.name}</span>
                  <span className="text-xs text-zinc-400">
                    {UNIT_LABEL[p.unit] ?? p.unit}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {lines.length > 0 && (
          <div className="divide-y rounded-lg border">
            {lines.map((l, i) => (
              <div key={l.productId} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">{l.name}</span>
                <div className="flex items-center gap-1">
                  <input
                    inputMode="decimal"
                    value={l.qty}
                    onChange={(e) =>
                      setLine(i, { qty: e.target.value.replace(/[^\d.]/g, "") })
                    }
                    placeholder="0"
                    className="w-16 rounded-lg border px-2 py-1.5 text-right text-sm outline-none focus:border-brand"
                  />
                  <span className="w-8 text-xs text-zinc-400">
                    {UNIT_LABEL[l.unit] ?? l.unit}
                  </span>
                </div>
                <input
                  inputMode="numeric"
                  value={l.price}
                  onChange={(e) =>
                    setLine(i, { price: e.target.value.replace(/\D/g, "") })
                  }
                  placeholder="нарх"
                  className="w-24 rounded-lg border px-2 py-1.5 text-right text-sm outline-none focus:border-brand"
                />
                <button
                  onClick={() => removeLine(i)}
                  className="shrink-0 text-zinc-300 hover:text-red-500"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Чек/бозор расми — ихтиёрий (телефон камерасидан) */}
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
                alt="чек"
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
              📷 Чек расми
            </button>
          )}
          <span className="text-xs text-zinc-400">
            📍 Жойлашув сақлашда авто ёзилади
          </span>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-zinc-500">
            Жами:{" "}
            <span className="font-semibold text-zinc-900">
              {fmtSom(total)} сўм
            </span>
          </span>
          <button
            onClick={save}
            disabled={busy || lines.length === 0}
            className="rounded-lg bg-brand px-6 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? "…" : "Сақлаш"}
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-500">
          Сўнгги харидлар
        </h2>
        {/* Десктоп — жадвал */}
        <div className="hidden overflow-hidden rounded-xl border bg-white sm:block">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Сана</th>
                <th className="px-3 py-2 font-medium">Етказувчи</th>
                <th className="px-3 py-2 text-center font-medium">Қатор</th>
                <th className="px-4 py-2 text-right font-medium">Жами</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {recent?.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2 text-zinc-500">
                    {new Date(p.createdAt).toLocaleString("ru-RU", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-3 py-2">{p.supplier ?? "—"}</td>
                  <td className="px-3 py-2 text-center text-zinc-400">
                    {p.lines}
                  </td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">
                    {fmtSom(p.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Мобил — карта рўйхат */}
        <div className="space-y-2 sm:hidden">
          {recent?.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-xl border bg-white px-4 py-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {p.supplier ?? "Етказувчисиз"}
                </div>
                <div className="text-xs text-zinc-400">
                  {new Date(p.createdAt).toLocaleString("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {p.lines} қатор
                </div>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {fmtSom(p.total)}
              </span>
            </div>
          ))}
        </div>
        {recent && recent.length === 0 && (
          <div className="rounded-xl border bg-white px-4 py-8 text-center text-sm text-zinc-400">
            Ҳали харид йўқ
          </div>
        )}
      </section>
    </div>
  );
}
