// Cash forecast: where checking and savings are heading over the next weeks,
// from what is known to be coming (paychecks, bills, loan payments, card
// payments due) plus the everyday spending rate for what isn't. Every event is
// listed so the line can be traced to its causes.

import { addDays, addMonths, eachDay, type ISODate } from "./dates";
import type { Cents } from "./money";

export interface ForecastEvent {
  date: ISODate;
  label: string;
  amountCents: Cents;
  kind:
    "income" | "bill" | "card_payment" | "transfer" | "loan" | "subscription";
}

export interface ForecastPoint {
  date: ISODate;
  balanceCents: Cents;
}

export interface Forecast {
  startCents: Cents;
  points: ForecastPoint[];
  events: ForecastEvent[];
  low: ForecastPoint;
  end: ForecastPoint;
  /** Everyday spending from cash accounts that isn't a known event, per day. */
  dailyDriftCents: Cents;
}

export interface CardPaymentPlan {
  label: string;
  /** Known next payment (statement balance and due date), if the provider gives one. */
  next: { date: ISODate; amountCents: Cents } | null;
  /** Typical monthly card spending, used for statements not yet issued. */
  monthlySpendCents: Cents;
  dueDay: number;
}

export function forecastCash(opts: {
  today: ISODate;
  days: number;
  startCents: Cents;
  events: ForecastEvent[];
  cards: CardPaymentPlan[];
  dailyDriftCents: Cents;
}): Forecast {
  const end = addDays(opts.today, opts.days);
  const events = opts.events.filter(
    (e) => e.date > opts.today && e.date <= end,
  );

  // Card payments: the known statement first, then one estimated payment a
  // month at the usual due day.
  for (const c of opts.cards) {
    let cursor = opts.today;
    if (c.next && c.next.date > opts.today) {
      // A statement already paid off still owns its due date: the next
      // estimated payment is the month after, not that same day.
      if (c.next.amountCents > 0)
        events.push({
          date: c.next.date,
          label: `${c.label} payment`,
          amountCents: -c.next.amountCents,
          kind: "card_payment",
        });
      cursor = c.next.date;
    }
    for (
      let d = addMonths(cursor, c.next ? 1 : 0, c.dueDay);
      d <= end;
      d = addMonths(d, 1, c.dueDay)
    ) {
      if (d <= opts.today || d <= cursor) continue;
      if (c.monthlySpendCents > 0) {
        events.push({
          date: d,
          label: `${c.label} payment (est.)`,
          amountCents: -c.monthlySpendCents,
          kind: "card_payment",
        });
      }
    }
  }
  events.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.amountCents - b.amountCents,
  );

  const byDay = new Map<ISODate, Cents>();
  for (const e of events)
    byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.amountCents);

  let bal = opts.startCents;
  const points: ForecastPoint[] = [{ date: opts.today, balanceCents: bal }];
  for (const d of eachDay(addDays(opts.today, 1), end)) {
    bal += (byDay.get(d) ?? 0) + opts.dailyDriftCents;
    points.push({ date: d, balanceCents: Math.round(bal) });
  }
  const low = points.reduce((m, p) =>
    p.balanceCents < m.balanceCents ? p : m,
  );
  return {
    startCents: opts.startCents,
    points,
    events,
    low,
    end: points.at(-1)!,
    dailyDriftCents: opts.dailyDriftCents,
  };
}
