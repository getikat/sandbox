import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  addDays,
  type AccountsDTO,
  type NetWorthChange,
  type NetWorthSeriesDTO,
} from "@ikat/core";
import { schema } from "../src/db";
import { dedupe } from "../src/sync/duplicates";
import { makeApp, TODAY, type TestApp } from "./helpers";

let app: TestApp;
let series: NetWorthSeriesDTO;

beforeAll(async () => {
  app = await makeApp();
  series = await app.get<NetWorthSeriesDTO>("/api/net-worth");
});
afterAll(async () => {
  await app.close();
});

describe("net worth series", () => {
  it("ends at exactly today's net worth", async () => {
    const view = await app.get<AccountsDTO>("/api/accounts");
    const last = series.points.at(-1)!;
    expect(last.date).toBe(TODAY);
    expect(last.netWorthCents).toBe(view.netWorthCents);
  });

  it("has groups that sum to the total on every day", () => {
    for (const p of series.points) {
      const sum = Object.values(p.byGroup).reduce((s, v) => s + (v ?? 0), 0);
      expect(sum).toBe(p.netWorthCents);
    }
  });

  it("marks the observed era and estimates the time before it", () => {
    // The demo has ~400 days of daily snapshots; the rest is estimated.
    const observed = series.points.filter((p) => p.observed);
    const estimated = series.points.filter((p) => !p.observed);
    expect(observed.length).toBeGreaterThan(380);
    expect(estimated.length).toBeGreaterThan(200);
    expect(estimated.at(-1)!.date < observed[0]!.date).toBe(true);
  });

  it("estimates investments by rebuilding holdings, not by flat-lining", () => {
    const early = series.points.filter((p) => !p.observed);
    const values = early.map((p) => p.byGroup.investments ?? 0);
    expect(new Set(values).size).toBeGreaterThan(early.length / 2);
    expect(values[0]!).toBeGreaterThan(0);
  });

  it("joins the estimated and observed eras without a jump", () => {
    const firstObserved = series.points.findIndex((p) => p.observed);
    const before = series.points[firstObserved - 1]!;
    const at = series.points[firstObserved]!;
    const cashJump = Math.abs(
      (at.byGroup.cash ?? 0) - (before.byGroup.cash ?? 0),
    );
    // One day of real flows at most (a paycheck), never a reconstruction seam.
    expect(cashJump).toBeLessThan(1_000_000);
  });

  it("never invents a loan before it was taken out, and marks its arrival as a break", () => {
    expect(series.breaks.length).toBeGreaterThan(0);
    const loanBreak = series.breaks.find((b) => b.names.includes("Auto Loan"));
    expect(loanBreak).toBeTruthy();
    const dayBefore = series.points.find(
      (p) => p.date === addDays(loanBreak!.date, -1),
    );
    expect(dayBefore?.byGroup.loans ?? 0).toBe(0);
    expect(series.comparableFrom! >= loanBreak!.date).toBe(true);
  });
});

describe("net worth change", () => {
  it("splits a year's change into parts that sum to the total", async () => {
    const start = addDays(TODAY, -365);
    const c = await app.get<NetWorthChange>(
      `/api/net-worth/change?start=${start}`,
    );
    expect(c.joined).toEqual([]);
    expect(
      c.marketCents +
        c.contributionsCents +
        c.cashCents +
        c.debtPaydownCents +
        c.otherCents,
    ).toBe(c.changeCents);
    // Contributions: 401(k) + match, HSA, Roth, brokerage, crypto, RSU vests.
    expect(c.contributionsCents).toBeGreaterThan(4_000_000);
    // Debt went down over the year: the car loan amortizes.
    expect(c.debtPaydownCents).toBeGreaterThan(0);
    // Only cash, investments and debt exist in the demo, so nothing is left over.
    expect(c.otherCents).toBe(0);
    expect(c.endCents).toBe(c.netWorthCents);
  });

  it("compares like-for-like across a break instead of calling a new account growth", async () => {
    const c = await app.get<NetWorthChange>(
      `/api/net-worth/change?start=${series.points[0]!.date}`,
    );
    expect(c.joined.map((j) => j.name)).toContain("Auto Loan");
    // The loan isn't in the comparison, so its balance isn't in the end figure.
    expect(c.endCents).toBeGreaterThan(c.netWorthCents);
    expect(
      c.marketCents +
        c.contributionsCents +
        c.cashCents +
        c.debtPaydownCents +
        c.otherCents,
    ).toBe(c.changeCents);
    expect(c.byGroup.loans).toBeUndefined();
  });
});

describe("estimation guards", () => {
  it("never estimates an investment account it has no holdings for", async () => {
    const other = await makeApp();
    try {
      const db = other.ctx.store.db();
      const roth = db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.subtype, "roth"))
        .get()!;
      db.delete(schema.holdings)
        .where(eq(schema.holdings.accountId, roth.id))
        .run();
      const s = await other.get<NetWorthSeriesDTO>("/api/net-worth");
      const b = s.breaks.find((x) => x.names.includes("Roth IRA"));
      expect(b).toBeTruthy();
      const firstSnapshot = db
        .select()
        .from(schema.balanceSnapshots)
        .where(eq(schema.balanceSnapshots.accountId, roth.id))
        .all()
        .map((r) => r.date)
        .sort()[0];
      expect(b!.date).toBe(firstSnapshot);
    } finally {
      await other.close();
    }
  });

  it("handles a re-link end to end: no double count, no gap while history loads, edits carried over", async () => {
    const other = await makeApp();
    try {
      const db = other.ctx.store.db();
      const before = (await other.get<AccountsDTO>("/api/accounts"))
        .netWorthCents;
      const chase = db
        .select()
        .from(schema.connections)
        .where(eq(schema.connections.institutionName, "Chase"))
        .get()!;
      const oldAccounts = db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.connectionId, chase.id))
        .all();
      const oldChecking = oldAccounts.find((a) => a.subtype === "checking")!;
      const edited = db
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.accountId, oldChecking.id))
        .limit(1)
        .get()!;
      db.update(schema.transactions)
        .set({ categoryId: "gifts", categorySource: "user", notes: "birthday" })
        .where(eq(schema.transactions.id, edited.id))
        .run();
      db.update(schema.accounts)
        .set({ nickname: "Everyday checking", owner: "joint" })
        .where(eq(schema.accounts.id, oldChecking.id))
        .run();
      const oldHistory = db
        .select()
        .from(schema.balanceSnapshots)
        .where(eq(schema.balanceSnapshots.accountId, oldChecking.id))
        .all().length;

      // 1. Link Chase again. The new link's accounts arrive before their history.
      const relink = crypto.randomUUID();
      db.insert(schema.connections)
        .values({
          ...chase,
          id: relink,
          externalId: "relinked",
          createdAt: "2099-01-01T00:00:00.000Z",
        })
        .run();
      const newIds = new Map<string, string>();
      for (const a of oldAccounts) {
        const id = crypto.randomUUID();
        newIds.set(a.id, id);
        db.insert(schema.accounts)
          .values({
            ...a,
            id,
            connectionId: relink,
            externalId: `${a.externalId}-new`,
            duplicateOf: null,
            nickname: null,
            owner: "me",
          })
          .run();
      }
      let result = dedupe(db);
      // The old link keeps the feed while the new one loads, and neither retires.
      expect(result.retired).toEqual([]);
      let view = await other.get<AccountsDTO>("/api/accounts");
      expect(view.netWorthCents).toBe(before);
      expect(
        view.accounts
          .filter((a) => a.institutionName === "Chase")
          .every((a) => a.connectionId === chase.id),
      ).toBe(true);

      // 2. The new link's history arrives (new ids, same transactions).
      for (const a of oldAccounts) {
        for (const t of db
          .select()
          .from(schema.transactions)
          .where(eq(schema.transactions.accountId, a.id))
          .all()) {
          db.insert(schema.transactions)
            .values({
              ...t,
              id: crypto.randomUUID(),
              accountId: newIds.get(a.id)!,
              externalId: `${t.externalId}-new`,
              categoryId: t.id === edited.id ? edited.categoryId : t.categoryId,
              categorySource:
                t.id === edited.id ? edited.categorySource : t.categorySource,
              notes: null,
            })
            .run();
        }
      }
      result = dedupe(db);
      expect(result.retired).toEqual([chase.id]);
      view = await other.get<AccountsDTO>("/api/accounts");
      expect(view.netWorthCents).toBe(before);
      expect(
        view.accounts
          .filter((a) => a.institutionName === "Chase")
          .every((a) => a.connectionId === relink),
      ).toBe(true);
      // The user's edit moved across, and the balance history came along.
      const moved = db
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.externalId, `${edited.externalId}-new`))
        .get()!;
      expect(moved.categoryId).toBe("gifts");
      expect(moved.categorySource).toBe("user");
      expect(moved.notes).toBe("birthday");
      const keptAccount = db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, newIds.get(oldChecking.id)!))
        .get()!;
      expect(keptAccount.nickname).toBe("Everyday checking");
      expect(keptAccount.owner).toBe("joint");
      const kept = db
        .select()
        .from(schema.balanceSnapshots)
        .where(
          eq(schema.balanceSnapshots.accountId, newIds.get(oldChecking.id)!),
        )
        .all().length;
      expect(kept).toBeGreaterThanOrEqual(oldHistory);
    } finally {
      await other.close();
    }
  });

  it("rebuilds days Ikat missed between two snapshots, even when the bank's balance lags a day", async () => {
    const other = await makeApp();
    try {
      const db = other.ctx.store.db();
      const checking = db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.subtype, "checking"))
        .get()!;
      const snaps = () =>
        db
          .select()
          .from(schema.balanceSnapshots)
          .where(eq(schema.balanceSnapshots.accountId, checking.id))
          .all()
          .sort((a, b) => (a.date < b.date ? -1 : 1));
      const truth = new Map(snaps().map((r) => [r.date, r.currentCents!]));
      // The bank reports yesterday evening's balance (Chase does).
      for (const r of snaps()) {
        const prev = truth.get(addDays(r.date, -1));
        if (prev != null)
          db.update(schema.balanceSnapshots)
            .set({ currentCents: prev })
            .where(
              and(
                eq(schema.balanceSnapshots.accountId, checking.id),
                eq(schema.balanceSnapshots.date, r.date),
              ),
            )
            .run();
      }
      // Ikat was off for three weeks.
      const gapFrom = addDays(TODAY, -40);
      const gapTo = addDays(TODAY, -20);
      for (let d = gapFrom; d <= gapTo; d = addDays(d, 1)) {
        db.delete(schema.balanceSnapshots)
          .where(
            and(
              eq(schema.balanceSnapshots.accountId, checking.id),
              eq(schema.balanceSnapshots.date, d),
            ),
          )
          .run();
      }
      const s = await other.get<NetWorthSeriesDTO>("/api/net-worth");
      const mid = s.points.find((p) => p.date === addDays(TODAY, -30))!;
      // Rebuilt (dashed), not carried flat (dotted).
      expect(mid.observed).toBe(false);
      expect(mid.carried).toBeUndefined();
      // And right: each day holds that evening's balance (history is in true
      // dates, not the day the bank got round to reporting it)…
      const { accountSeries } = await import("../src/views/networth");
      const acct = accountSeries(db, TODAY).find((a) => a.id === checking.id)!;
      for (let d = gapFrom; d <= gapTo; d = addDays(d, 1))
        expect(acct.values.get(d)).toBe(truth.get(d));
      // …while today still shows the latest report.
      expect(acct.values.get(TODAY)).toBe(truth.get(addDays(TODAY, -1)));
    } finally {
      await other.close();
    }
  });

  it("prices a position no market source covers at your own trade prices", async () => {
    const other = await makeApp();
    try {
      const db = other.ctx.store.db();
      const { accountSeries } = await import("../src/views/networth");
      const before = accountSeries(db, TODAY);
      // A position held across the start of the observed era and since closed,
      // with no market prices anywhere (an expired option).
      const taxable = db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.subtype, "brokerage"))
        .get()!;
      const acct = taxable.id;
      const sec = crypto.randomUUID();
      db.insert(schema.securities)
        .values({
          id: sec,
          ticker: "XYZ261218C00050000",
          name: "XYZ call",
          type: "derivative",
        })
        .run();
      const trade = (date: string, quantity: number, priceCents: number) =>
        db
          .insert(schema.investmentTransactions)
          .values({
            id: crypto.randomUUID(),
            accountId: acct,
            externalId: `opt-${date}`,
            securityId: sec,
            date,
            name: "XYZ call",
            type: quantity > 0 ? "buy" : "sell",
            subtype: quantity > 0 ? "buy" : "sell",
            quantity,
            priceCents,
            amountCents: -Math.round(quantity * priceCents),
          })
          .run();
      trade(addDays(TODAY, -500), 100, 300);
      trade(addDays(TODAY, -380), -100, 420);
      const after = accountSeries(db, TODAY);
      const first = (list: typeof before) =>
        [...list.find((a) => a.id === acct)!.values.keys()].sort()[0];
      expect(first(after)).toBe(first(before));
    } finally {
      await other.close();
    }
  });

  it("rebuilds a 401(k) trust with no public price from what each contribution bought", async () => {
    const other = await makeApp();
    try {
      const db = other.ctx.store.db();
      const { accountSeries } = await import("../src/views/networth");
      const conn = db.select().from(schema.connections).get()!;
      const acct = crypto.randomUUID();
      db.insert(schema.accounts)
        .values({
          id: acct,
          connectionId: conn.id,
          externalId: "trust-401k",
          name: "Plan",
          type: "investment",
          subtype: "401k",
          currentCents: 10_000_000,
        })
        .run();
      const sec = crypto.randomUUID();
      db.insert(schema.securities)
        .values({
          id: sec,
          ticker: "VANG.INST.500.IDX.TR",
          name: "Vang Inst 500 Idx Tr",
          type: "equity",
        })
        .run();
      // 300 units at $333.33 today. Every two weeks a contribution bought 3 units,
      // at a price $10 lower for each step back — the trust's only price record.
      db.insert(schema.holdings)
        .values({
          accountId: acct,
          securityId: sec,
          quantity: 300,
          priceCents: 33_333,
          valueCents: 10_000_000,
          asOf: TODAY,
        })
        .run();
      db.insert(schema.balanceSnapshots)
        .values({ accountId: acct, date: TODAY, currentCents: 10_000_000 })
        .run();
      const priceAt = (i: number) => 33_333 - 1_000 * i;
      for (let i = 1; i <= 10; i++) {
        db.insert(schema.investmentTransactions)
          .values({
            id: crypto.randomUUID(),
            accountId: acct,
            externalId: `c${i}`,
            securityId: sec,
            date: addDays(TODAY, -14 * i),
            name: "contribution",
            type: "cash",
            subtype: "contribution",
            quantity: 3,
            priceCents: 0,
            amountCents: 3 * priceAt(i),
          })
          .run();
      }
      const s = accountSeries(db, TODAY).find((a) => a.id === acct)!;
      expect(s.estimated).toBe(true);
      // Nine contributions back it held 273 units, priced from the contributions either side.
      const price = priceAt(9) + ((priceAt(10) - priceAt(9)) * 4) / 14;
      expect(s.values.get(addDays(TODAY, -130))! / 100).toBeCloseTo(
        (273 * price) / 100,
        -1,
      );
    } finally {
      await other.close();
    }
  });

  it("hides a transfer the provider reported twice, only on evidence from the other side", async () => {
    const other = await makeApp();
    try {
      const db = other.ctx.store.db();
      const checking = db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.subtype, "checking"))
        .get()!;
      const savings = db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.subtype, "savings"))
        .get()!;
      const tx = (
        accountId: string,
        externalId: string,
        amountCents: number,
        description: string,
        date = "2026-09-20",
      ) =>
        db
          .insert(schema.transactions)
          .values({
            id: crypto.randomUUID(),
            accountId,
            externalId,
            date,
            amountCents,
            description,
            merchantKey: description.toLowerCase(),
            categoryId: "transfer",
            providerCategory: amountCents > 0 ? "TRANSFER_IN" : "TRANSFER_OUT",
          })
          .run();
      const rows = (accountId: string, amountCents: number) =>
        db
          .select()
          .from(schema.transactions)
          .where(eq(schema.transactions.accountId, accountId))
          .all()
          .filter((t) => t.amountCents === amountCents);

      // One transfer out, two copies in: the shorter copy is hidden.
      tx(checking.id, "out-1", -1_300_013, "Transfer to savings");
      tx(
        savings.id,
        "in-a",
        1_300_013,
        "Transfer from checking account ending in 1234",
      );
      tx(savings.id, "in-b", 1_300_013, "From Checking");
      // Two real same-day transfers, both seen on each side: nothing hidden.
      tx(checking.id, "out-2", -50_017, "Transfer to savings");
      tx(checking.id, "out-3", -50_017, "Transfer to savings");
      tx(savings.id, "in-c", 50_017, "Transfer from checking");
      tx(savings.id, "in-d", 50_017, "Transfer from checking");
      // Two deposits from somewhere Ikat can't see: no evidence, nothing hidden.
      tx(savings.id, "in-e", 77_719, "Deposit");
      tx(savings.id, "in-f", 77_719, "Deposit");

      expect(dedupe(db).hiddenTransactions).toBe(1);
      expect(rows(savings.id, 1_300_013).map((t) => t.externalId)).toEqual([
        "in-a",
      ]);
      expect(rows(savings.id, 50_017)).toHaveLength(2);
      expect(rows(savings.id, 77_719)).toHaveLength(2);
      // Idempotent.
      expect(dedupe(db).hiddenTransactions).toBe(0);

      // The provider later drops the copy Ikat kept: the hidden one comes back.
      db.delete(schema.transactions)
        .where(eq(schema.transactions.externalId, "in-a"))
        .run();
      dedupe(db);
      expect(rows(savings.id, 1_300_013).map((t) => t.externalId)).toEqual([
        "in-b",
      ]);
      expect(
        db.select().from(schema.suppressedTransactions).all(),
      ).toHaveLength(0);
    } finally {
      await other.close();
    }
  });

  it("only suggests linking again when a link was capped at 90 days", async () => {
    const other = await makeApp();
    try {
      const db = other.ctx.store.db();
      const mk = (
        name: string,
        linked: string,
        firstTx: string,
        requested: number | null,
      ) => {
        const cid = crypto.randomUUID();
        db.insert(schema.connections)
          .values({
            id: cid,
            provider: "plaid",
            institutionName: name,
            createdAt: `${linked}T12:00:00.000Z`,
            historyDaysRequested: requested,
          })
          .run();
        const aid = crypto.randomUUID();
        db.insert(schema.accounts)
          .values({
            id: aid,
            connectionId: cid,
            externalId: `${name}-a`,
            name,
            type: "credit",
            subtype: "credit card",
            mask: name.slice(0, 4),
          })
          .run();
        db.insert(schema.transactions)
          .values({
            id: crypto.randomUUID(),
            accountId: aid,
            externalId: `${name}-t`,
            date: firstTx,
            amountCents: -1000,
            description: "x",
            merchantKey: "x",
            categoryId: "other",
          })
          .run();
      };
      mk("CappedBank", "2026-08-26", "2026-05-28", null); // old default link: exactly 90 days back
      mk("YoungCard", "2026-09-24", "2026-05-19", null); // account opened after the 90-day line
      mk("IkatLink", "2026-09-24", "2026-06-26", 730); // asked for two years; this is all there is
      // A brokerage whose trades only start after it was linked (no bank transactions).
      const broker = crypto.randomUUID();
      db.insert(schema.connections)
        .values({
          id: broker,
          provider: "plaid",
          institutionName: "Brokerage",
          createdAt: "2026-08-29T12:00:00.000Z",
          historyDaysRequested: null,
        })
        .run();
      const brokerAcct = crypto.randomUUID();
      db.insert(schema.accounts)
        .values({
          id: brokerAcct,
          connectionId: broker,
          externalId: "b-a",
          name: "401k",
          type: "investment",
          subtype: "401k",
        })
        .run();
      db.insert(schema.investmentTransactions)
        .values({
          id: crypto.randomUUID(),
          accountId: brokerAcct,
          externalId: "b-t",
          date: "2026-09-15",
          name: "contribution",
          type: "cash",
          subtype: "contribution",
          amountCents: 100,
        })
        .run();
      const status = await other.get<{
        connections: Array<{ institutionName: string; historyCapped: boolean }>;
      }>("/api/status");
      const capped = Object.fromEntries(
        status.connections.map((c) => [c.institutionName, c.historyCapped]),
      );
      expect(capped).toMatchObject({
        CappedBank: true,
        YoungCard: false,
        IkatLink: false,
        Chase: false,
        Brokerage: true,
      });
    } finally {
      await other.close();
    }
  });
});
