import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import type {
  BudgetsDTO,
  CashflowMonthDTO,
  ForecastDTO,
  Page,
  RecurringDTO,
  RuleDTO,
  SpendingSummaryDTO,
  TransactionDTO,
} from "@ikat/core";
import { schema } from "../src/db";
import { makeApp, type TestApp } from "./helpers";

let app: TestApp;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});

const req = async <T>(
  method: "PATCH" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
): Promise<T> => {
  const res = await app.server.inject({
    method,
    url,
    payload: payload as object,
  });
  if (res.statusCode >= 400)
    throw new Error(`${url} → ${res.statusCode} ${res.body}`);
  return res.json() as T;
};

describe("spending summary", () => {
  it("adds up: categories sum to the month's spending", async () => {
    const s = await app.get<SpendingSummaryDTO>("/api/spending?month=2026-08");
    expect(s.categories.reduce((t, c) => t + c.spentCents, 0)).toBe(
      s.spentCents,
    );
    expect(s.spentCents).toBeGreaterThan(300_000);
    expect(s.incomeCents).toBeGreaterThan(800_000);
    expect(s.categories[0]!.categoryId).toBe("rent");
  });

  it("saved is what is left of income after spending", async () => {
    const s = await app.get<SpendingSummaryDTO>("/api/spending?month=2026-08");
    expect(s.savedCents).toBe(s.netCents);
    expect(s.savingsRate).toBeCloseTo(s.netCents / s.incomeCents);
  });

  it("never counts card payments or savings transfers as spending", async () => {
    const s = await app.get<SpendingSummaryDTO>("/api/spending?month=2026-08");
    const ids = s.categories.map((c) => c.categoryId);
    expect(ids).not.toContain("card_payment");
    expect(ids).not.toContain("transfer");
    expect(ids).not.toContain("investment_transfer");
  });

  it("reports cash flow by month that matches the summary", async () => {
    const months = await app.get<CashflowMonthDTO[]>("/api/cashflow?months=3");
    const aug = months.find((m) => m.month === "2026-08")!;
    const s = await app.get<SpendingSummaryDTO>("/api/spending?month=2026-08");
    expect(aug.spendingCents).toBe(s.spentCents);
    expect(aug.incomeCents).toBe(s.incomeCents);
  });
});

describe("recurring", () => {
  let r: RecurringDTO;
  beforeAll(async () => {
    r = await app.get<RecurringDTO>("/api/recurring");
  });
  const find = (name: string) =>
    r.series.find((s) => s.merchant.includes(name));

  it("finds the household's subscriptions, bills, income and loan", () => {
    expect(find("Netflix")?.cadence).toBe("monthly");
    expect(find("Spotify")?.kind).toBe("subscription");
    expect(find("Northwind")?.kind).toBe("income");
    expect(find("Northwind")?.cadence).toBe("biweekly");
    expect(find("Toyota")?.kind).toBe("loan");
    expect(find("PG&E")?.variable).toBe(true);
    expect(find("Coinbase")?.cadence).toBe("weekly");
  });

  it("flags price increases (Netflix, the rent renewal)", () => {
    expect(find("Netflix")!.priceChange!.toCents).toBe(-1799);
    expect(find("AvalonBay")!.priceChange!.toCents).toBe(-297_500);
  });

  it("does not mistake frequent spending for a subscription", () => {
    for (const name of [
      "Blue Bottle",
      "Sweetgreen",
      "Uber",
      "Lyft",
      "Trader Joe",
      "Amazon",
    ]) {
      expect(
        r.series.find((s) => s.merchant === name),
        name,
      ).toBeUndefined();
    }
  });

  it("hides a series on request and brings it back", async () => {
    const netflix = find("Netflix")!;
    const hidden = await req<RecurringDTO>("POST", "/api/recurring/override", {
      merchantKey: netflix.merchantKey,
      state: "hidden",
    });
    expect(
      hidden.series.find((s) => s.merchant.includes("Netflix")),
    ).toBeUndefined();
    const back = await req<RecurringDTO>("POST", "/api/recurring/override", {
      merchantKey: netflix.merchantKey,
      state: null,
    });
    expect(
      back.series.find((s) => s.merchant.includes("Netflix")),
    ).toBeTruthy();
  });
});

describe("budgets", () => {
  it("proposes budgets from recent months and adopts them in one call", async () => {
    const before = await app.get<BudgetsDTO>("/api/budgets");
    expect(before.rows).toHaveLength(0);
    expect(before.suggestions.map((s) => s.categoryId)).toContain("dining");
    expect(before.suggestions.map((s) => s.categoryId)).not.toContain("rent");
    const after = await req<BudgetsDTO>("POST", "/api/budgets/accept", {});
    expect(after.rows.length).toBe(before.suggestions.length);
    expect(after.suggestions).toHaveLength(0);
    const dining = after.rows.find((r) => r.categoryId === "dining")!;
    expect(dining.progress.paceCents).toBeLessThan(dining.progress.budgetCents);
  });
});

describe("forecast", () => {
  it("starts from today's cash and runs through paychecks, rent and card payments", async () => {
    const f = await app.get<ForecastDTO>("/api/forecast?days=45");
    expect(f.points).toHaveLength(46);
    const labels = f.events.map((e) => e.label);
    expect(labels.some((l) => l.includes("Northwind"))).toBe(true);
    expect(labels.some((l) => l.includes("AvalonBay"))).toBe(true);
    expect(f.events.some((e) => e.kind === "card_payment")).toBe(true);
    // Savings transfers move money between cash accounts; they aren't events.
    expect(labels.some((l) => l.includes("Ally"))).toBe(false);
  });
});

describe("editing and rules", () => {
  it("recategorises one transaction, then a whole merchant by rule, and undoes it", async () => {
    const db = app.ctx.store.db();
    const target = db
      .select()
      .from(schema.transactions)
      .where(like(schema.transactions.description, "%PHILZ%"))
      .limit(1)
      .get()!;
    await req("PATCH", `/api/transactions/${target.id}`, {
      categoryId: "dining",
    });
    const others = () =>
      db
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.merchantKey, target.merchantKey))
        .all();
    expect(others().filter((t) => t.categoryId === "dining")).toHaveLength(1);

    const res = await req<{ applied: number }>(
      "PATCH",
      `/api/transactions/${target.id}`,
      { categoryId: "dining", applyToMerchant: true },
    );
    expect(res.applied).toBeGreaterThan(10);
    expect(others().every((t) => t.categoryId === "dining")).toBe(true);

    const rules = await app.get<RuleDTO[]>("/api/rules");
    expect(rules).toHaveLength(1);
    await req("DELETE", `/api/rules/${rules[0]!.id}`);
    // Back to coffee, except the one edited by hand.
    expect(others().filter((t) => t.categoryId === "coffee").length).toBe(
      others().length - 1,
    );
  });

  it("finds transactions by amount", async () => {
    const page = await app.get<Page<TransactionDTO>>(
      "/api/transactions?q=%3E1000&limit=5",
    );
    expect(page.items.every((t) => Math.abs(t.amountCents) > 100_000)).toBe(
      true,
    );
    const exact = await app.get<Page<TransactionDTO>>(
      "/api/transactions?q=17.99",
    );
    expect(exact.items.every((t) => Math.abs(t.amountCents) === 1799)).toBe(
      true,
    );
    expect(exact.total).toBeGreaterThan(3);
  });
});
