import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { trpc } from "./trpc";

type Category = { id: string; name: string; position: number };
type Product = {
  id: string;
  name: string;
  type: string;
  unit: string;
  price: number;
  soldByWeight: boolean;
  category: string | null;
  station: string | null;
};

const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  dish: { label: "Таом", cls: "bg-emerald-100 text-emerald-700" },
  goods: { label: "Товар", cls: "bg-sky-100 text-sky-700" },
  ingredient: { label: "Хом-ашё", cls: "bg-amber-100 text-amber-700" },
  semi: { label: "Ярим-т.", cls: "bg-violet-100 text-violet-700" },
  part: { label: "Қисм", cls: "bg-rose-100 text-rose-700" },
};
const UNIT: Record<string, string> = {
  dona: "дона",
  kg: "кг",
  g: "г",
  l: "л",
  ml: "мл",
};

export function Catalog() {
  const [cats, setCats] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [cat, setCat] = useState<string | null>(null);

  useEffect(() => {
    trpc.catalog.categories.query().then(setCats).catch(() => {});
  }, []);
  useEffect(() => {
    setProducts(null);
    trpc.catalog.products
      .query(cat ? { categoryId: cat } : undefined)
      .then(setProducts)
      .catch(() => setProducts([]));
  }, [cat]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Chip active={cat === null} onClick={() => setCat(null)}>
          Барчаси
        </Chip>
        {cats.map((c) => (
          <Chip key={c.id} active={cat === c.id} onClick={() => setCat(c.id)}>
            {c.name}
          </Chip>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium">Номи</th>
              <th className="px-3 py-2 font-medium">Тур</th>
              <th className="px-3 py-2 font-medium">Станция</th>
              <th className="px-3 py-2 text-right font-medium">Нарх</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {products?.map((p) => {
              const b = TYPE_BADGE[p.type];
              return (
                <tr key={p.id}>
                  <td className="px-4 py-2">{p.name}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${b?.cls ?? ""}`}>
                      {b?.label ?? p.type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{p.station ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p.price
                      ? `${p.price.toLocaleString("ru-RU")} so'm${p.soldByWeight ? "/" + UNIT[p.unit] : ""}`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {products ? (
          <div className="px-4 py-2 text-xs text-zinc-400">
            {products.length} та маҳсулот
          </div>
        ) : (
          <div className="px-4 py-6 text-center text-zinc-400">⏳</div>
        )}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        active
          ? "bg-zinc-900 text-white"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}
