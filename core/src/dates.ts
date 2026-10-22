// Calendar dates travel as ISO strings ("2026-09-23"). A date in a finance app
// is a calendar day, not an instant: a transaction "on the 5th" must stay on the
// 5th in every time zone. So all arithmetic here runs in UTC on day numbers and
// never touches the local clock except in `todayISO`.

export type ISODate = string;

const DAY_MS = 86_400_000;

function toUTC(iso: ISODate): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today's calendar date on this machine's clock. */
export function todayISO(now: Date = new Date()): ISODate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(iso: ISODate, days: number): ISODate {
  return fromUTC(toUTC(iso) + days * DAY_MS);
}

/**
 * Calendar-month arithmetic that clamps to the month's last day, so Jan 31 +
 * 1 month is Feb 28 rather than Mar 3. Pass `anchorDay` when stepping a series
 * repeatedly (a bill on the 31st), or it drifts to the 28th forever after Feb.
 */
export function addMonths(
  iso: ISODate,
  months: number,
  anchorDay?: number,
): ISODate {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const want = anchorDay ?? d;
  const last = daysInMonth(ny, nm + 1);
  return fromUTC(Date.UTC(ny, nm, Math.min(want, last)));
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
}

export function startOfMonth(iso: ISODate): ISODate {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: ISODate): ISODate {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  return `${iso.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
}

export function startOfYear(iso: ISODate): ISODate {
  return `${iso.slice(0, 4)}-01-01`;
}

/** "2026-09" — the key every monthly rollup groups on. */
export function monthKey(iso: ISODate): string {
  return iso.slice(0, 7);
}

export function dayOfMonth(iso: ISODate): number {
  return Number(iso.slice(8, 10));
}

/** 0 = Sunday, matching Date#getUTCDay. */
export function dayOfWeek(iso: ISODate): number {
  return new Date(toUTC(iso)).getUTCDay();
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

/** Every date from `start` to `end`, inclusive. */
export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let t = toUTC(start), e = toUTC(end); t <= e; t += DAY_MS)
    out.push(fromUTC(t));
  return out;
}

/** Month keys from start's month to end's month, inclusive. */
export function eachMonth(start: ISODate, end: ISODate): string[] {
  const out: string[] = [];
  let cur = startOfMonth(start);
  const last = startOfMonth(end);
  while (cur <= last) {
    out.push(monthKey(cur));
    cur = addMonths(cur, 1);
  }
  return out;
}

export function isISODate(value: unknown): value is ISODate {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
