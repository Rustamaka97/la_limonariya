import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "./App";
import { trpc } from "./trpc";

const ROLE_LABEL: Record<string, string> = {
  director: "Директор",
  manager: "Менежер",
  buyer: "Бозорчи",
  cashier: "Кассир",
  waiter: "Официант",
};

type Staff = {
  id: string;
  name: string;
  role: string;
  active: boolean;
  hasPin: boolean;
};

export function Shell({
  user,
  onLogout,
}: {
  user: SessionUser;
  onLogout: () => void;
}) {
  const [staff, setStaff] = useState<Staff[] | null>(null);
  const [editing, setEditing] = useState<Staff | null>(null);

  const refresh = useCallback(() => {
    trpc.users.list
      .query()
      .then(setStaff)
      .catch(() => setStaff(null));
  }, []);

  useEffect(() => {
    if (user.role === "director") refresh();
  }, [user.role, refresh]);

  async function logout() {
    await trpc.auth.logout.mutate().catch(() => {});
    onLogout();
  }

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900">
      <header className="flex items-center justify-between border-b bg-white px-5 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold">La Limonariya</span>
          <span className="text-xs text-zinc-400">Навоий</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="font-medium">{user.name}</span>
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
            {ROLE_LABEL[user.role] ?? user.role}
          </span>
          <button onClick={logout} className="text-zinc-400 hover:text-red-500">
            Чиқиш
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl p-5">
        {user.role === "director" ? (
          <section>
            <h2 className="mb-3 text-sm font-semibold text-zinc-500">
              Ходимлар ({staff?.length ?? "…"})
            </h2>
            <div className="divide-y rounded-xl border bg-white">
              {staff?.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between px-4 py-2.5"
                >
                  <span>{s.name}</span>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-zinc-400">
                      {ROLE_LABEL[s.role] ?? s.role}
                    </span>
                    <span
                      className={s.hasPin ? "text-green-600" : "text-amber-500"}
                    >
                      {s.hasPin ? "PIN ✓" : "PIN йўқ"}
                    </span>
                    <button
                      onClick={() => setEditing(s)}
                      className="rounded-lg bg-zinc-100 px-2.5 py-1 font-medium text-zinc-700 hover:bg-zinc-200"
                    >
                      {s.hasPin ? "ўзгартир" : "PIN бер"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <div className="rounded-xl border bg-white p-8 text-center text-zinc-400">
            Бўлимлар тез орада (POS, омбор, обвалка...)
          </div>
        )}
      </main>

      {editing && (
        <SetPinModal
          staff={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function SetPinModal({
  staff,
  onClose,
  onSaved,
}: {
  staff: Staff;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!/^\d{4}$/.test(pin)) {
      setError("PIN — 4 та рақам");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await trpc.users.setPin.mutate({ userId: staff.id, pin });
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error && e.message ? e.message : "Хато");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs space-y-4 rounded-2xl bg-white p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-lg font-semibold">{staff.name}</h3>
          <p className="text-sm text-zinc-500">4 рақамли PIN ўрнатинг</p>
        </div>
        <input
          autoFocus
          inputMode="numeric"
          value={pin}
          onChange={(e) => {
            setError(null);
            setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
          }}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="••••"
          className="w-full rounded-xl border px-4 py-3 text-center text-2xl tracking-[0.5em] outline-none focus:border-green-500"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border py-2.5 text-zinc-600"
          >
            Бекор
          </button>
          <button
            onClick={save}
            disabled={busy || pin.length !== 4}
            className="flex-1 rounded-xl bg-green-600 py-2.5 font-medium text-white disabled:opacity-40"
          >
            Сақлаш
          </button>
        </div>
      </div>
    </div>
  );
}
