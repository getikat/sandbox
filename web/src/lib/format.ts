import { diffDays, todayISO, type ISODate } from "@ikat/core";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function shortDate(iso: ISODate, withYear = false): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
}

/** "Sep ’25" — the apostrophe keeps a year from reading as a day. */
export function monthLabel(iso: ISODate, withYear = true): string {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  return withYear ? `${MONTHS[m - 1]} ’${String(y).slice(2)}` : MONTHS[m - 1]!;
}

/** "March 2030" */
export function monthYear(iso: ISODate): string {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  return `${new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} ${y}`;
}

/** "Today", "Yesterday", "Mon, Sep 21", or "Sep 21, 2025" for older years. */
export function dayHeading(iso: ISODate, today: ISODate = todayISO()): string {
  const gap = diffDays(iso, today);
  if (gap === 0) return "Today";
  if (gap === 1) return "Yesterday";
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
  return iso.slice(0, 4) === today.slice(0, 4)
    ? `${dow}, ${MONTHS[m - 1]} ${d}`
    : `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function relativeTime(isoTimestamp: string | null): string {
  if (!isoTimestamp) return "never";
  const s = (Date.now() - new Date(isoTimestamp).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86_400);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

/** "Wednesday, September 23" */
export function longDate(iso: ISODate): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
