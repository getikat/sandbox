import { and, eq, gte, isNull, lte } from "drizzle-orm";
import {
  addDays,
  addMonths,
  budgetProgress,
  categoryKind,
  dayOfMonth,
  daysInMonth,
  detectRecurring,
  diffDays,
  endOfMonth,
  forecastCash,
  groupFor,
  monthKey,
  occurrencesBetween,
  startOfMonth,
  suggestBudgets,
  type BudgetsDTO,
  type CardPaymentPlan,
  type CashflowMonthDTO,
  type ForecastDTO,
  type ForecastEvent,
  type ISODate,
  type RecurringDTO,
  type RecurringInput,
  type SpendingSummaryDTO,
} from "@ikat/core";
import { schema, type DB } from "../db";
import { displayNames, loadAccountRows } from "./accounts";

// One definition of "activity" feeds every spending view, so the page totals,
// budgets, cash flow and forecast can never disagree:
//   - accounts that are duplicates are out (the same money seen twice);
//   - transactions the user excluded are out;
//   - spending = expense-kind categories, net of refunds (a refund keeps its
//     merchant's category, so it reduces that category's spend);
//   - income = income-kind categories; transfers are neither.

export interface ActivityRow {
  id: string;
  accountId: string;
  date: ISODate;
  amountCents: number;
  merchant: string;
  merchantKey: string;
  categoryId: string;
  logoUrl: string | null;
  pending: boolean;
  transferPairId: string | null;
  accountType: string;
}

export function loadActivity(
  db: DB,
  start: ISODate,
  end: ISODate,
): ActivityRow[] {
  return db
    .select({
      id: schema.transactions.id,
      accountId: schema.transactions.accountId,
      date: schema.transactions.date,
      amountCents: schema.transactions.amountCents,
      merchant: schema.transactions.merchantName,
      description: schema.transactions.description,
      merchantKey: schema.transactions.merchantKey,
      categoryId: schema.transactions.categoryId,
      logoUrl: schema.transactions.logoUrl,
      pending: schema.transactions.pending,
      transferPairId: schema.transactions.transferPairId,
      accountType: schema.accounts.type,
    })
    .from(schema.transactions)
    .innerJoin(
      schema.accounts,
      eq(schema.accounts.id, schema.transactions.accountId),
    )
    .where(
      and(
        gte(schema.transactions.date, start),
        lte(schema.transactions.date, end),
        eq(schema.transactions.excluded, false),
        isNull(schema.accounts.duplicateOf),
      ),
    )
    .all()
    .map((r) => ({ ...r, merchant: r.merchant ?? r.description }));
}

const spendOf = (rows: ActivityRow[]) =>
  rows
    .filter((r) => categoryKind(r.categoryId) === "expense")
    .reduce((s, r) => s - r.amountCents, 0);
const incomeOf = (rows: ActivityRow[]) =>
  rows
    .filter((r) => categoryKind(r.categoryId) === "income")
    .reduce((s, r) => s + r.amountCents, 0);

function byCategory(
  rows: ActivityRow[],
): Map<string, { cents: number; count: number }> {
  const m = new Map<string, { cents: number; count: number }>();
  for (const r of rows) {
    if (categoryKind(r.categoryId) !== "expense") continue;
    const e = m.get(r.categoryId) ?? { cents: 0, count: 0 };
    e.cents -= r.amountCents;
    e.count++;
    m.set(r.categoryId, e);
  }
  return m;
}

function monthBounds(month: string): [ISODate, ISODate] {
  const start = `${month}-01`;
  return [start, endOfMonth(start)];
}

// --- Budgets ------------------------------------------------------------------

function loadBudgets(db: DB) {
  return db.select().from(schema.budgets).all();
}

/** Spending per category for each of the `n` months ending with `month` (oldest first). */
function monthlyByCategory(
  db: DB,
  month: string,
  n: number,
): Map<string, number[]> {
  const first = addMonths(`${month}-01`, -(n - 1));
  const rows = loadActivity(db, first, endOfMonth(`${month}-01`));
  const months = Array.from({ length: n }, (_, i) =>
    monthKey(addMonths(first, i)),
  );
  const out = new Map<string, number[]>();
  for (const r of rows) {
    if (categoryKind(r.categoryId) !== "expense") continue;
    const arr = out.get(r.categoryId) ?? months.map(() => 0);
    const i = months.indexOf(monthKey(r.date));
    if (i >= 0) arr[i]! -= r.amountCents;
    out.set(r.categoryId, arr);
  }
  return out;
}

/** Rollover carried into `month`: the sum of (budget − spent) over the months since the budget began, capped at 12. */
function rolloverCarry(
  db: DB,
  categoryId: string,
  amountCents: number,
  since: string,
  month: string,
): number {
  const createdMonth = since.slice(0, 7);
  let carry = 0;
  for (let i = 12; i >= 1; i--) {
    const m = monthKey(addMonths(`${month}-01`, -i));
    if (m < createdMonth) continue;
    const [a, b] = monthBounds(m);
    const spent = spendOf(
      loadActivity(db, a, b).filter((r) => r.categoryId === categoryId),
    );
    carry += amountCents - spent;
  }
  return carry;
}

export function budgetsView(
  db: DB,
  today: ISODate,
  month = monthKey(today),
): BudgetsDTO {
  const [start, end] = monthBounds(month);
  const asOf = month === monthKey(today) ? today : end;
  const spend = byCategory(loadActivity(db, start, end));
  const history = monthlyByCategory(db, monthKey(addMonths(start, -1)), 6);
  const rows = loadBudgets(db).map((b) => {
    const carry = b.rollover
      ? rolloverCarry(db, b.categoryId, b.amountCents, b.createdAt, month)
      : 0;
    return {
      categoryId: b.categoryId,
      rollover: b.rollover,
      progress: budgetProgress(
        b.amountCents,
        spend.get(b.categoryId)?.cents ?? 0,
        asOf,
        carry,
      ),
      history: history.get(b.categoryId) ?? Array(6).fill(0),
    };
  });
  rows.sort((a, b) => b.progress.budgetCents - a.progress.budgetCents);
  const budgeted = new Set(rows.map((r) => r.categoryId));
  // Suggestions come from the last three *full* months.
  const recent = monthlyByCategory(
    db,
    monthKey(addMonths(`${monthKey(today)}-01`, -1)),
    3,
  );
  const suggestions = suggestBudgets(Object.fromEntries(recent)).filter(
    (s) => !budgeted.has(s.categoryId),
  );
  let unbudgeted = 0;
  for (const [cat, v] of spend) if (!budgeted.has(cat)) unbudgeted += v.cents;
  return {
    month,
    rows,
    suggestions,
    totalBudgetCents: rows.reduce((s, r) => s + r.progress.budgetCents, 0),
    totalSpentCents: rows.reduce((s, r) => s + r.progress.spentCents, 0),
    unbudgetedCents: unbudgeted,
  };
}

// --- Spending summary --------------------------------------------------------------

export function spendingSummary(
  db: DB,
  today: ISODate,
  month = monthKey(today),
): SpendingSummaryDTO {
  const [start, end] = monthBounds(month);
  const isCurrent = month === monthKey(today);
  const prevStart = addMonths(start, -1);
  const prevEnd = endOfMonth(prevStart);
  const rows = loadActivity(db, start, end);
  const prev = loadActivity(db, prevStart, prevEnd);
  const cats = byCategory(rows);
  const prevCats = byCategory(prev);
  const budgets = new Map(loadBudgets(db).map((b) => [b.categoryId, b]));
  const asOf = isCurrent ? today : end;

  const categories = [...new Set([...cats.keys(), ...prevCats.keys()])]
    .map((id) => {
      const b = budgets.get(id);
      const spent = cats.get(id)?.cents ?? 0;
      return {
        categoryId: id,
        spentCents: spent,
        prevSpentCents: prevCats.get(id)?.cents ?? 0,
        count: cats.get(id)?.count ?? 0,
        budget: b ? budgetProgress(b.amountCents, spent, asOf) : null,
      };
    })
    .filter((c) => c.spentCents !== 0 || c.prevSpentCents !== 0)
    .sort((a, b) => b.spentCents - a.spentCents);

  const merchants = new Map<
    string,
    {
      merchant: string;
      spentCents: number;
      count: number;
      categoryId: string;
      logoUrl: string | null;
    }
  >();
  for (const r of rows) {
    if (categoryKind(r.categoryId) !== "expense") continue;
    const m = merchants.get(r.merchantKey) ?? {
      merchant: r.merchant,
      spentCents: 0,
      count: 0,
      categoryId: r.categoryId,
      logoUrl: r.logoUrl,
    };
    m.spentCents -= r.amountCents;
    m.count++;
    merchants.set(r.merchantKey, m);
  }

  // Cumulative curves by day of month.
  const cum = (list: ActivityRow[], monthStart: ISODate, lastDay: number) => {
    const perDay = new Array(32).fill(0);
    for (const r of list)
      if (categoryKind(r.categoryId) === "expense")
        perDay[dayOfMonth(r.date)] -= r.amountCents;
    const out: number[] = [];
    let run = 0;
    for (let d = 1; d <= lastDay; d++) {
      run += perDay[d];
      out[d] = run;
    }
    return out;
  };
  const [y, mo] = month.split("-").map(Number) as [number, number];
  const dim = daysInMonth(y, mo);
  const shownDays = isCurrent ? dayOfMonth(today) : dim;
  const thisCum = cum(rows, start, shownDays);
  const prevDim = daysInMonth(
    Number(prevStart.slice(0, 4)),
    Number(prevStart.slice(5, 7)),
  );
  const prevCum = cum(prev, prevStart, prevDim);
  const daily = Array.from({ length: Math.max(dim, prevDim) }, (_, i) => ({
    day: i + 1,
    cents: i + 1 <= shownDays ? (thisCum[i + 1] ?? null) : null,
    prevCents: i + 1 <= prevDim ? (prevCum[i + 1] ?? null) : null,
  }));

  const spent = spendOf(rows);
  const income = incomeOf(rows);
  const toDate = addDays(prevStart, Math.min(dayOfMonth(asOf), prevDim) - 1);
  return {
    month,
    start,
    end,
    isCurrent,
    spentCents: spent,
    incomeCents: income,
    netCents: income - spent,
    savedCents: income - spent,
    savingsRate: income > 0 ? (income - spent) / income : null,
    prevSpentCents: spendOf(prev),
    prevSpentToDateCents: spendOf(prev.filter((r) => r.date <= toDate)),
    categories,
    merchants: [...merchants.values()]
      .sort((a, b) => b.spentCents - a.spentCents)
      .slice(0, 8),
    daily,
  };
}

export function cashflow(
  db: DB,
  today: ISODate,
  months: number,
): CashflowMonthDTO[] {
  const first = addMonths(startOfMonth(today), -(months - 1));
  const rows = loadActivity(db, first, today);
  const out: CashflowMonthDTO[] = [];
  for (let i = 0; i < months; i++) {
    const m = monthKey(addMonths(first, i));
    const inMonth = rows.filter((r) => monthKey(r.date) === m);
    const spending = spendOf(inMonth);
    const income = incomeOf(inMonth);
    out.push({
      month: m,
      incomeCents: income,
      spendingCents: spending,
      netCents: income - spending,
      byCategory: Object.fromEntries(
        [...byCategory(inMonth)].map(([k, v]) => [k, v.cents]),
      ),
    });
  }
  return out;
}

// --- Recurring ---------------------------------------------------------------------

export function recurringView(db: DB, today: ISODate): RecurringDTO {
  const rows = loadActivity(db, addDays(today, -400), today).filter(
    (r) =>
      !r.pending &&
      // Card payments are forecast from the card's statement instead; the
      // receiving side of any transfer is the same money as its sending side.
      r.categoryId !== "card_payment" &&
      !(r.transferPairId && r.amountCents > 0) &&
      // Money back in a spending category is a refund or a card credit, not
      // income; card credits are tracked with the card's benefits.
      !(r.amountCents > 0 && categoryKind(r.categoryId) === "expense"),
  );
  const overrides = db.select().from(schema.recurringOverrides).all();
  const input: RecurringInput[] = rows.map((r) => ({
    id: r.id,
    date: r.date,
    amountCents: r.amountCents,
    merchantKey: r.merchantKey,
    merchant: r.merchant,
    categoryId: r.categoryId,
    categoryKind: categoryKind(r.categoryId),
    accountId: r.accountId,
  }));
  const names = displayNames(loadAccountRows(db));
  const series = detectRecurring(input, today, overrides).map((s) => ({
    ...s,
    accountName: names.get(s.accountId) ?? "",
  }));
  const horizon = addDays(today, 30);
  const upcoming = series
    .flatMap((s) =>
      occurrencesBetween(s, today, horizon).map((date) => ({
        date,
        key: s.key,
        merchant: s.merchant,
        amountCents: s.amountCents,
        kind: s.kind,
        categoryId: s.categoryId,
      })),
    )
    .sort((a, b) =>
      a.date < b.date
        ? -1
        : a.date > b.date
          ? 1
          : a.amountCents - b.amountCents,
    );
  return {
    series,
    upcoming,
    monthlyOutCents: series
      .filter((s) => s.amountCents < 0)
      .reduce((t, s) => t - s.monthlyCents, 0),
    monthlyInCents: series
      .filter((s) => s.amountCents > 0)
      .reduce((t, s) => t + s.monthlyCents, 0),
    subscriptionsMonthlyCents: series
      .filter((s) => s.kind === "subscription")
      .reduce((t, s) => t - s.monthlyCents, 0),
    hidden: overrides
      .filter((o) => o.state === "hidden")
      .map((o) => o.merchantKey),
  };
}

// --- Forecast ------------------------------------------------------------------------

const LOW_BALANCE_CENTS = 50_000;

export function forecastView(
  db: DB,
  today: ISODate,
  days: number,
): ForecastDTO {
  const accounts = loadAccountRows(db).filter(
    (a) => a.includeInNetWorth && !a.closedAt,
  );
  const cash = accounts.filter((a) => groupFor(a.type) === "cash");
  const cashIds = new Set(cash.map((a) => a.id));
  const cards = accounts.filter((a) => groupFor(a.type) === "cards");
  const start = cash.reduce((s, a) => s + (a.currentCents ?? 0), 0);

  const rec = recurringView(db, today);
  const events: ForecastEvent[] = [];
  for (const s of rec.series) {
    if (!cashIds.has(s.accountId)) continue;
    // Moves between your own cash accounts don't change the cash total.
    if (s.categoryId === "transfer") continue;
    for (const date of occurrencesBetween(
      s,
      addDays(today, 1),
      addDays(today, days),
    )) {
      events.push({
        date,
        label: s.merchant,
        amountCents: s.amountCents,
        kind:
          s.kind === "income"
            ? "income"
            : s.kind === "loan"
              ? "loan"
              : s.kind === "transfer"
                ? "transfer"
                : s.kind === "bill"
                  ? "bill"
                  : "subscription",
      });
    }
  }

  // Cards: the statement Plaid reports, then typical monthly spend.
  const liab = new Map(
    db
      .select()
      .from(schema.liabilities)
      .all()
      .map((l) => [l.accountId, l]),
  );
  const names = displayNames(loadAccountRows(db));
  const recent = loadActivity(db, addDays(today, -90), today);
  const payments = db
    .select({
      accountId: schema.transactions.accountId,
      date: schema.transactions.date,
      amountCents: schema.transactions.amountCents,
      categoryId: schema.transactions.categoryId,
      pair: schema.transactions.transferPairId,
    })
    .from(schema.transactions)
    .where(gte(schema.transactions.date, addDays(today, -65)))
    .all()
    .filter(
      (t) => t.amountCents > 0 && (t.categoryId === "card_payment" || t.pair),
    );
  const plans: CardPaymentPlan[] = cards.map((c) => {
    const l = liab.get(c.id);
    const spend = recent
      .filter(
        (r) => r.accountId === c.id && categoryKind(r.categoryId) === "expense",
      )
      .reduce((s, r) => s - r.amountCents, 0);
    const due = l?.nextPaymentDueDate ?? null;
    // What's left of the statement after payments made since it was issued
    // (people often pay early, or several times a cycle).
    const paid = l?.lastStatementDate
      ? payments
          .filter((p) => p.accountId === c.id && p.date > l.lastStatementDate!)
          .reduce((s, p) => s + p.amountCents, 0)
      : 0;
    return {
      label: names.get(c.id) ?? c.name,
      next:
        due && l?.lastStatementBalanceCents != null
          ? {
              date: due,
              amountCents: Math.max(0, l.lastStatementBalanceCents - paid),
            }
          : null,
      monthlySpendCents: Math.round((spend / 90) * 30.44),
      dueDay: due ? dayOfMonth(due) : 25,
    };
  });

  // Everyday spending straight from cash accounts that isn't a known event.
  const recurringIds = new Set(rec.series.flatMap((s) => s.transactionIds));
  const drift = recent
    .filter(
      (r) =>
        cashIds.has(r.accountId) &&
        categoryKind(r.categoryId) === "expense" &&
        !recurringIds.has(r.id) &&
        r.amountCents < 0,
    )
    .reduce((s, r) => s + r.amountCents, 0);

  const f = forecastCash({
    today,
    days,
    startCents: start,
    events,
    cards: plans,
    dailyDriftCents: Math.round(drift / 90),
  });
  let warning: string | null = null;
  if (f.low.balanceCents < LOW_BALANCE_CENTS) {
    const inDays = diffDays(today, f.low.date);
    warning =
      f.low.balanceCents < 0
        ? `Cash could run short by ${Math.abs(Math.round(f.low.balanceCents / 100)).toLocaleString()} dollars in ${inDays} days.`
        : `Cash dips to its low point in ${inDays} days.`;
  }
  return { ...f, thresholdCents: LOW_BALANCE_CENTS, warning };
}
