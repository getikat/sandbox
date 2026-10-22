// Budgets are proposed, not typed: Ikat drafts one per spending category from
// your own recent months and you accept them with a tap. Progress is judged by
// pace — where spending *should* be by this day of the month — because $600
// of a $800 budget is fine on the 28th and alarming on the 9th.

import { daysInMonth, type ISODate } from "./dates";
import type { Cents } from "./money";

/** Fixed costs aren't budgeted — there's nothing to steer. */
const NOT_BUDGETED = new Set([
  "rent",
  "loan_payment",
  "insurance",
  "taxes",
  "other",
]);

export function isBudgetable(categoryId: string): boolean {
  return !NOT_BUDGETED.has(categoryId);
}

/** Round a budget up to a figure a person would pick. */
export function niceBudget(cents: Cents): Cents {
  const d = cents / 100;
  const step = d < 100 ? 10 : d < 500 ? 25 : d < 2000 ? 50 : 100;
  return Math.ceil(d / step) * step * 100;
}

export interface BudgetSuggestion {
  categoryId: string;
  amountCents: Cents;
  /** Spending in each of the months the suggestion is based on (oldest first). */
  basisCents: Cents[];
}

/**
 * One suggestion per category spent in at least two of the last three full
 * months: the median of those months, rounded up to a clean figure. Median,
 * not mean, so one big trip doesn't set next month's travel budget.
 */
export function suggestBudgets(
  monthly: Record<string, Cents[]>,
): BudgetSuggestion[] {
  const out: BudgetSuggestion[] = [];
  for (const [categoryId, months] of Object.entries(monthly)) {
    if (!isBudgetable(categoryId)) continue;
    const recent = months.slice(-3);
    if (recent.filter((m) => m > 0).length < 2) continue;
    const sorted = [...recent].sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1]!;
    if (med < 1_000) continue; // under $10 a month isn't worth a budget
    out.push({ categoryId, amountCents: niceBudget(med), basisCents: recent });
  }
  return out.sort((a, b) => b.amountCents - a.amountCents);
}

export type BudgetState = "under" | "on_track" | "ahead" | "over";

export interface BudgetProgress {
  budgetCents: Cents;
  /** Budget plus any rollover carried in. */
  availableCents: Cents;
  spentCents: Cents;
  /** Where spending would be today if it tracked the budget evenly. */
  paceCents: Cents;
  /** Straight-line projection to month end. */
  projectedCents: Cents;
  remainingCents: Cents;
  state: BudgetState;
}

export function budgetProgress(
  budgetCents: Cents,
  spentCents: Cents,
  today: ISODate,
  carryCents = 0,
): BudgetProgress {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const dim = daysInMonth(y, m);
  const day = Number(today.slice(8, 10));
  const available = budgetCents + carryCents;
  const pace = Math.round((available * day) / dim);
  const projected = Math.round((spentCents / Math.max(day, 1)) * dim);
  let state: BudgetState;
  if (spentCents > available) state = "over";
  else if (spentCents > pace * 1.1 && projected > available) state = "ahead";
  else if (spentCents < pace * 0.6) state = "under";
  else state = "on_track";
  return {
    budgetCents,
    availableCents: available,
    spentCents,
    paceCents: pace,
    projectedCents: projected,
    remainingCents: available - spentCents,
    state,
  };
}
