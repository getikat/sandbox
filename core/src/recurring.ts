// Recurring detection: subscriptions, bills, income and regular transfers,
// found from history alone. Stateless — recomputed on every request — so a
// cancelled subscription drops off by itself; only the user's overrides
// (hide / pin) persist.
//
// The rules below each exist because the naive version got real data wrong:
//  - Find the regular series *inside* a merchant's charges (cluster by amount,
//    then test cadence), rather than demanding every charge fit: one ad-hoc
//    payment must not erase a monthly pattern.
//  - A series must cover a real share of the merchant's charges, or three of
//    ten similar Lyft rides a month apart read as a subscription.
//  - Same-day charges collapse to one event: $25 twice each Monday is $50/week,
//    not a series with zero-day gaps.
//  - A series whose newest charge is older than its rhythm allows has stopped
//    (or changed shape) — never report it as running.
//  - Biweekly and semi-monthly overlap on gaps (the 5th and 20th are 15 days
//    apart); they are told apart by whether the days of the month hold steady.

import {
  addDays,
  addMonths,
  dayOfMonth,
  diffDays,
  type ISODate,
} from "./dates";
import type { Cents } from "./money";

export type Cadence =
  | "weekly"
  | "biweekly"
  | "semimonthly"
  | "monthly"
  | "bimonthly"
  | "quarterly"
  | "semiannual"
  | "annual";

export type RecurringKind =
  "income" | "subscription" | "bill" | "loan" | "transfer";

export interface RecurringInput {
  id: string;
  date: ISODate;
  amountCents: Cents;
  merchantKey: string;
  merchant: string;
  categoryId: string;
  categoryKind: "expense" | "income" | "transfer";
  accountId: string;
}

export interface RecurringSeries {
  key: string;
  merchantKey: string;
  merchant: string;
  categoryId: string;
  accountId: string;
  kind: RecurringKind;
  cadence: Cadence;
  /** Signed like transactions: + in, − out. */
  amountCents: Cents;
  /** True for bills whose amount moves (utilities): amount is the median. */
  variable: boolean;
  count: number;
  firstDate: ISODate;
  lastDate: ISODate;
  nextDate: ISODate;
  /** Normalised to a month (e.g. weekly ×4.35), signed. */
  monthlyCents: Cents;
  /** The most recent price change within the series, if any. */
  priceChange: { fromCents: Cents; toCents: Cents; date: ISODate } | null;
  transactionIds: string[];
  pinned: boolean;
}

export interface RecurringOverride {
  merchantKey: string;
  state: "hidden" | "pinned";
}

const CADENCE_DAYS: Record<Cadence, [number, number, number]> = {
  // [typical, min gap, max gap]
  weekly: [7, 5, 9],
  biweekly: [14, 12, 16],
  semimonthly: [15, 12, 18],
  monthly: [30.44, 26, 35],
  bimonthly: [60.9, 54, 68],
  quarterly: [91.3, 84, 99],
  semiannual: [182.6, 170, 196],
  annual: [365.25, 345, 385],
};

const PER_MONTH: Record<Cadence, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  semimonthly: 2,
  monthly: 1,
  bimonthly: 1 / 2,
  quarterly: 1 / 3,
  semiannual: 1 / 6,
  annual: 1 / 12,
};

const MIN_SERIES_SHARE = 0.5;
const FIXED_TOLERANCE = 0.25;
const BILL_CATEGORIES = new Set([
  "utilities",
  "phone_internet",
  "insurance",
  "rent",
  "taxes",
]);

interface Occurrence {
  date: ISODate;
  amount: Cents;
  ids: string[];
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Best-fitting cadence for a run of dates, or null when nothing fits well. */
export function inferCadence(dates: ISODate[]): Cadence | null {
  if (dates.length < 2) return null;
  const gaps = dates.slice(1).map((d, i) => diffDays(dates[i]!, d));
  const med = median(gaps);
  const candidates = (Object.keys(CADENCE_DAYS) as Cadence[]).filter((c) => {
    const [, lo, hi] = CADENCE_DAYS[c];
    return med >= lo && med <= hi;
  });
  const days = dates.map(dayOfMonth);
  const anchor = median(days);
  let best: Cadence | null = null;
  let bestFit = 0;
  for (const c of candidates) {
    const [, lo, hi] = CADENCE_DAYS[c];
    let fit = gaps.filter((g) => g >= lo && g <= hi).length / gaps.length;
    // Calendar cadences can also be judged by the day of the month: one charge
    // a week late spoils two gaps but only one date. Only as a second opinion —
    // three grocery runs near the 8th, 95 and 33 days apart, aren't a rhythm.
    if (
      (c === "monthly" || c === "bimonthly" || c === "quarterly") &&
      fit >= 0.5
    ) {
      const onDay =
        days.filter(
          (d) => Math.min(Math.abs(d - anchor), 31 - Math.abs(d - anchor)) <= 4,
        ).length / days.length;
      fit = Math.max(fit, onDay);
    }
    if (fit > bestFit) {
      best = c;
      bestFit = fit;
    }
  }
  // Allow one skipped or shifted occurrence in four.
  if (!best || bestFit < 0.75) return null;
  if (best === "biweekly" || best === "semimonthly") {
    // Semi-monthly keeps to (about) the same two days of the month.
    const distinct = new Set(days.map((d) => Math.round(d / 3)));
    return distinct.size <= 3 && dates.length >= 4 ? "semimonthly" : "biweekly";
  }
  return best;
}

function nextAfter(
  last: ISODate,
  cadence: Cadence,
  anchorDay: number,
): ISODate {
  switch (cadence) {
    case "weekly":
      return addDays(last, 7);
    case "biweekly":
      return addDays(last, 14);
    case "semimonthly":
      return addDays(last, 15);
    case "monthly":
      return addMonths(last, 1, anchorDay);
    case "bimonthly":
      return addMonths(last, 2, anchorDay);
    case "quarterly":
      return addMonths(last, 3, anchorDay);
    case "semiannual":
      return addMonths(last, 6, anchorDay);
    case "annual":
      return addMonths(last, 12, anchorDay);
  }
}

function kindFor(
  categoryId: string,
  categoryKind: RecurringInput["categoryKind"],
  amount: Cents,
): RecurringKind {
  if (amount > 0) return categoryKind === "transfer" ? "transfer" : "income";
  if (categoryKind === "transfer") return "transfer";
  if (categoryId === "loan_payment") return "loan";
  if (BILL_CATEGORIES.has(categoryId)) return "bill";
  return "subscription";
}

/** Greedy clustering by amount: each occurrence joins the first cluster whose median is within tolerance. */
function clusterByAmount(occ: Occurrence[]): Occurrence[][] {
  const clusters: Occurrence[][] = [];
  for (const o of [...occ].sort(
    (a, b) => Math.abs(a.amount) - Math.abs(b.amount),
  )) {
    const home = clusters.find((c) => {
      const m = Math.abs(median(c.map((x) => x.amount)));
      return (
        Math.abs(Math.abs(o.amount) - m) <= Math.max(m * FIXED_TOLERANCE, 300)
      );
    });
    if (home) home.push(o);
    else clusters.push([o]);
  }
  return clusters.map((c) => c.sort((a, b) => (a.date < b.date ? -1 : 1)));
}

function buildSeries(
  occ: Occurrence[],
  merchantOcc: Occurrence[],
  sample: RecurringInput,
  today: ISODate,
  variable: boolean,
  pinned: boolean,
): RecurringSeries | null {
  const dates = occ.map((o) => o.date);
  const cadence = inferCadence(dates);
  if (!cadence) return null;
  const sparse = cadence === "annual" || cadence === "semiannual";
  if (occ.length < (sparse ? 2 : 3)) return null;
  // Two charges a year apart prove little unless they're the same charge:
  // a renewal repeats its price; two furniture trips don't.
  if (sparse && !variable) {
    const amounts = occ.map((o) => Math.abs(o.amount));
    if (Math.max(...amounts) > Math.min(...amounts) * 1.03) return null;
  }
  // Most of what the merchant charged while this series ran must be the
  // series itself (a café's regular-looking latte is lost among its other
  // visits). Charges before or after it — an old price, a paused plan —
  // don't count against it.
  const during = merchantOcc.filter(
    (o) => o.date >= occ[0]!.date && o.date <= occ.at(-1)!.date,
  ).length;
  if (!pinned && occ.length / during < MIN_SERIES_SHARE) return null;

  const last = occ.at(-1)!;
  const anchorDay = Math.round(median(dates.map(dayOfMonth)));
  const next = nextAfter(last.date, cadence, anchorDay);
  // Stopped: overdue by more than one rhythm's worth of slack.
  const slack = Math.max(5, Math.round(CADENCE_DAYS[cadence][0] * 0.35));
  if (diffDays(next, today) > slack) return null;

  const amount = variable
    ? Math.round(median(occ.map((o) => o.amount)))
    : last.amount;
  let priceChange: RecurringSeries["priceChange"] = null;
  if (!variable) {
    for (let i = occ.length - 1; i > 0; i--) {
      const prev = occ[i - 1]!.amount;
      const cur = occ[i]!.amount;
      if (Math.abs(cur - prev) > Math.max(Math.abs(prev) * 0.02, 50)) {
        priceChange = { fromCents: prev, toCents: cur, date: occ[i]!.date };
        break;
      }
    }
  }
  return {
    key: `${sample.merchantKey}|${Math.sign(amount)}|${Math.round(Math.abs(amount) / 100)}`,
    merchantKey: sample.merchantKey,
    merchant: sample.merchant,
    categoryId: sample.categoryId,
    accountId: sample.accountId,
    kind: kindFor(sample.categoryId, sample.categoryKind, amount),
    cadence,
    amountCents: amount,
    variable,
    count: occ.length,
    firstDate: occ[0]!.date,
    lastDate: last.date,
    nextDate: next,
    monthlyCents: Math.round(amount * PER_MONTH[cadence]),
    priceChange,
    transactionIds: occ.flatMap((o) => o.ids),
    pinned,
  };
}

export function detectRecurring(
  txs: RecurringInput[],
  today: ISODate,
  overrides: RecurringOverride[] = [],
): RecurringSeries[] {
  const hidden = new Set(
    overrides.filter((o) => o.state === "hidden").map((o) => o.merchantKey),
  );
  const pinned = new Set(
    overrides.filter((o) => o.state === "pinned").map((o) => o.merchantKey),
  );

  const groups = new Map<string, RecurringInput[]>();
  for (const t of txs) {
    if (t.amountCents === 0 || hidden.has(t.merchantKey)) continue;
    const k = `${t.merchantKey}|${t.amountCents > 0 ? "in" : "out"}`;
    const list = groups.get(k) ?? [];
    list.push(t);
    groups.set(k, list);
  }

  const out: RecurringSeries[] = [];
  for (const list of groups.values()) {
    // One event per day.
    const byDay = new Map<ISODate, Occurrence>();
    for (const t of list) {
      const o = byDay.get(t.date) ?? { date: t.date, amount: 0, ids: [] };
      o.amount += t.amountCents;
      o.ids.push(t.id);
      byDay.set(t.date, o);
    }
    const occ = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    const sample = list.reduce((a, b) => (a.date > b.date ? a : b));
    const isPinned = pinned.has(sample.merchantKey);

    const amounts = occ.map((o) => Math.abs(o.amount));
    const mid = median(amounts);
    const spread = median(amounts.map((a) => Math.abs(a - mid))) / (mid || 1);
    const whole = (variable: boolean) =>
      buildSeries(occ, occ, sample, today, variable, isPinned);

    const found: RecurringSeries[] = [];
    if (BILL_CATEGORIES.has(sample.categoryId)) {
      // Bills move with usage; judge them by their dates, as one series.
      const s = whole(spread > 0.03);
      if (s) found.push(s);
    }
    if (!found.length) {
      for (const cluster of clusterByAmount(occ)) {
        const s = buildSeries(cluster, occ, sample, today, false, isPinned);
        if (s) found.push(s);
      }
    }
    // Something regular whose amount wanders but isn't a known bill.
    if (!found.length && (isPinned || occ.length >= 4) && spread <= 0.35) {
      const s = whole(true);
      if (s) found.push(s);
    }
    out.push(...found);
  }
  return out.sort(
    (a, b) => Math.abs(b.monthlyCents) - Math.abs(a.monthlyCents),
  );
}

/** Every expected occurrence of the series between two dates (inclusive). */
export function occurrencesBetween(
  s: RecurringSeries,
  from: ISODate,
  to: ISODate,
): ISODate[] {
  const out: ISODate[] = [];
  const anchorDay = dayOfMonth(s.nextDate);
  let d = s.nextDate;
  for (let i = 0; d <= to && i < 400; i++) {
    if (d >= from) out.push(d);
    d = nextAfter(d, s.cadence, anchorDay);
  }
  return out;
}

export const CADENCE_LABELS: Record<Cadence, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  semimonthly: "Twice a month",
  monthly: "Monthly",
  bimonthly: "Every 2 months",
  quarterly: "Quarterly",
  semiannual: "Twice a year",
  annual: "Yearly",
};
