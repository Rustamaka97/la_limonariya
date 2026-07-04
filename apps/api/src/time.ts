// Operational day cuts at 06:00 Asia/Tashkent (UTC+5, no DST). Late-night sales
// land on the correct business day. The single tz primitive every aggregate uses.
export const TZ_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDay(day?: string): { y: number; m: number; d: number } {
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const [y = 0, m = 1, d = 1] = day.split("-").map(Number);
    return { y, m, d };
  }
  const tash = new Date(Date.now() + TZ_OFFSET_MS); // UTC fields now read as Tashkent wall clock
  if (tash.getUTCHours() < 6) tash.setUTCDate(tash.getUTCDate() - 1); // before 06:00 → yesterday's day
  return {
    y: tash.getUTCFullYear(),
    m: tash.getUTCMonth() + 1,
    d: tash.getUTCDate(),
  };
}

// UTC window [startUTC, endUTC) for one operational day (06:00 Tashkent = 01:00 UTC).
export function businessDayBounds(day?: string): {
  startUTC: Date;
  endUTC: Date;
  dayKey: string;
} {
  const { y, m, d } = parseDay(day);
  const startUTC = new Date(Date.UTC(y, m - 1, d, 1, 0, 0, 0));
  const endUTC = new Date(startUTC.getTime() + DAY_MS);
  const dayKey = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { startUTC, endUTC, dayKey };
}

export function previousDayKey(dayKey: string): string {
  const [y = 0, m = 1, d = 1] = dayKey.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-${String(prev.getUTCDate()).padStart(2, "0")}`;
}

// UTC window spanning [from business day .. to business day] inclusive.
export function businessRangeBounds(
  from: string,
  to: string,
): { startUTC: Date; endUTC: Date; days: number } {
  const a = businessDayBounds(from);
  const b = businessDayBounds(to);
  const start = a.startUTC <= b.startUTC ? a.startUTC : b.startUTC;
  const end = a.endUTC >= b.endUTC ? a.endUTC : b.endUTC;
  return {
    startUTC: start,
    endUTC: end,
    days: Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS)),
  };
}
