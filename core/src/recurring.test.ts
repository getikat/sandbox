import { describe, expect, it } from "vitest";
import { addDays, addMonths } from "./dates";
import { budgetProgress, niceBudget, suggestBudgets } from "./budgets";
import { forecastCash } from "./forecast";
import {
  detectRecurring,
  inferCadence,
  type RecurringInput,
} from "./recurring";

const TODAY = "2026-09-23";

function series(
  merchant: string,
  dates: string[],
  amounts: number | number[],
  extra: Partial<RecurringInput> = {},
): RecurringInput[] {
  return dates.map((date, i) => ({
    id: `${merchant}-${i}`,
    date,
    amountCents: Array.isArray(amounts) ? amounts[i]! : amounts,
    merchantKey: merchant.toLowerCase(),
    merchant,
    categoryId: "streaming",
    categoryKind: "expense",
    accountId: "a1",
    ...extra,
  }));
}

const monthly = (start: string, n: number) =>
  Array.from({ length: n }, (_, i) =>
    addMonths(start, i, Number(start.slice(8))),
  );
const every = (start: string, days: number, n: number) =>
  Array.from({ length: n }, (_, i) => addDays(start, i * days));

describe("cadence", () => {
  it("tells biweekly from semi-monthly by the day of the month", () => {
    expect(inferCadence(every("2026-01-02", 14, 10))).toBe("biweekly");
    const semi = [
      "2026-05-05",
      "2026-05-20",
      "2026-06-05",
      "2026-06-20",
      "2026-07-05",
      "2026-07-20",
    ];
    expect(inferCadence(semi)).toBe("semimonthly");
  });

  it("doesn't take dates near the same day of the month for a rhythm", () => {
    expect(inferCadence(["2026-03-05", "2026-06-08", "2026-07-11"])).toBeNull();
  });

  it("tolerates one shifted occurrence but not noise", () => {
    const dates = monthly("2026-01-15", 8);
    dates[4] = "2026-05-22";
    expect(inferCadence(dates)).toBe("monthly");
    expect(
      inferCadence([
        "2026-01-01",
        "2026-01-03",
        "2026-01-19",
        "2026-02-02",
        "2026-02-04",
      ]),
    ).toBeNull();
  });
});

describe("detectRecurring", () => {
  it("finds a subscription and its price increase", () => {
    const dates = monthly("2025-10-09", 12);
    const amounts = dates.map((d) => (d >= "2026-03-09" ? -1799 : -1549));
    const [s] = detectRecurring(series("Netflix", dates, amounts), TODAY);
    expect(s!.cadence).toBe("monthly");
    expect(s!.amountCents).toBe(-1799);
    expect(s!.priceChange).toEqual({
      fromCents: -1549,
      toCents: -1799,
      date: "2026-03-09",
    });
    expect(s!.nextDate).toBe("2026-10-09");
  });

  it("keeps a monthly series through one ad-hoc charge from the same merchant", () => {
    const txs = [
      ...series("Gym", monthly("2026-01-01", 9), -3499),
      ...series("Gym", ["2026-04-12"], -12000).map((t) => ({
        ...t,
        id: "adhoc",
      })),
    ];
    const found = detectRecurring(txs, TODAY);
    expect(found).toHaveLength(1);
    expect(found[0]!.transactionIds).not.toContain("adhoc");
  });

  it("does not call a handful of similar rides a subscription", () => {
    const dates = [
      "2026-06-02",
      "2026-06-03",
      "2026-06-09",
      "2026-07-02",
      "2026-07-15",
      "2026-08-02",
      "2026-08-03",
      "2026-08-21",
      "2026-09-02",
      "2026-09-10",
    ];
    const amounts = [
      -1800, -2400, -3100, -1850, -2900, -1820, -3500, -2600, -1810, -2750,
    ];
    expect(detectRecurring(series("Lyft", dates, amounts), TODAY)).toHaveLength(
      0,
    );
  });

  it("collapses same-day charges into one weekly event", () => {
    const dates = every("2026-06-01", 7, 16).flatMap((d) => [d, d]);
    const [s] = detectRecurring(
      series("Coinbase", dates, -2500, {
        categoryKind: "transfer",
        categoryId: "investment_transfer",
      }),
      TODAY,
    );
    expect(s!.cadence).toBe("weekly");
    expect(s!.amountCents).toBe(-5000);
    expect(s!.kind).toBe("transfer");
  });

  it("follows a plan that came back at a new price after a pause", () => {
    // Spotify: $11.99 until December, nothing for six months, then $6.99 mid-month.
    const txs = [
      ...series("Spotify", monthly("2025-08-25", 5), -1199),
      ...series("Spotify", monthly("2026-07-15", 3), -699).map((t) => ({
        ...t,
        id: `new-${t.id}`,
      })),
    ];
    const found = detectRecurring(txs, TODAY);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      amountCents: -699,
      cadence: "monthly",
      nextDate: "2026-10-15",
    });
  });

  it("drops a series that stopped", () => {
    expect(
      detectRecurring(series("Old", monthly("2025-10-01", 6), -999), TODAY),
    ).toHaveLength(0);
  });

  it("finds a variable utility bill by its regular dates", () => {
    const dates = monthly("2025-10-08", 12);
    const amounts = [
      -7200, -8100, -11800, -13900, -12400, -8000, -7400, -6900, -7700, -10900,
      -11600, -11200,
    ];
    const [s] = detectRecurring(
      series("PG&E", dates, amounts, { categoryId: "utilities" }),
      TODAY,
    );
    expect(s!.variable).toBe(true);
    expect(s!.kind).toBe("bill");
  });

  it("needs a yearly charge to repeat its price", () => {
    expect(
      detectRecurring(
        series("IKEA", ["2026-02-13", "2026-08-13"], [-3745, -3113], {
          categoryId: "home",
        }),
        TODAY,
      ),
    ).toHaveLength(0);
    const prime = detectRecurring(
      series("Amazon Prime", ["2024-10-11", "2025-10-11"], -13900),
      "2025-10-20",
    );
    expect(prime[0]?.cadence).toBe("annual");
  });

  it("respects hide and pin overrides", () => {
    const txs = series("Netflix", monthly("2026-01-09", 9), -1799);
    expect(
      detectRecurring(txs, TODAY, [
        { merchantKey: "netflix", state: "hidden" },
      ]),
    ).toHaveLength(0);
  });
});

describe("budgets", () => {
  it("suggests the median of recent months, rounded to a clean figure", () => {
    const [s] = suggestBudgets({
      dining: [41_200, 38_900, 95_000],
      rent: [285_000, 285_000, 285_000],
    });
    expect(s!.categoryId).toBe("dining");
    expect(s!.amountCents).toBe(42_500);
    expect(niceBudget(12_340)).toBe(12_500);
  });

  it("judges progress by pace through the month", () => {
    expect(budgetProgress(60_000, 45_000, "2026-09-10").state).toBe("ahead");
    expect(budgetProgress(60_000, 45_000, "2026-09-28").state).toBe("on_track");
    expect(budgetProgress(60_000, 61_000, "2026-09-28").state).toBe("over");
  });
});

describe("forecast", () => {
  it("walks the balance through known events and card payments", () => {
    const f = forecastCash({
      today: TODAY,
      days: 40,
      startCents: 500_000,
      events: [
        {
          date: "2026-09-25",
          label: "Paycheck",
          amountCents: 450_000,
          kind: "income",
        },
        {
          date: "2026-10-01",
          label: "Rent",
          amountCents: -300_000,
          kind: "bill",
        },
      ],
      cards: [
        {
          label: "Sapphire",
          next: { date: "2026-09-28", amountCents: 120_000 },
          monthlySpendCents: 150_000,
          dueDay: 28,
        },
      ],
      dailyDriftCents: -1_000,
    });
    expect(f.points).toHaveLength(41);
    // The known statement on the 28th, then an estimated one a month later.
    expect(f.end.balanceCents).toBe(
      500_000 + 450_000 - 300_000 - 120_000 - 150_000 - 40 * 1_000,
    );
    expect(f.events.map((e) => e.label)).toContain("Sapphire payment (est.)");
  });

  it("books nothing on a statement's due date once it's been paid", () => {
    const f = forecastCash({
      today: TODAY,
      days: 45,
      startCents: 500_000,
      events: [],
      // Statement due Oct 14, already paid in full: the next payment is Nov 14, outside the window.
      cards: [
        {
          label: "Sapphire",
          next: { date: "2026-10-14", amountCents: 0 },
          monthlySpendCents: 150_000,
          dueDay: 14,
        },
      ],
      dailyDriftCents: 0,
    });
    expect(f.events).toEqual([]);
    expect(f.end.balanceCents).toBe(500_000);
  });
});
