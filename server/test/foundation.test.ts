import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNotNull, like, sql } from "drizzle-orm";
import {
  categoryKind,
  type AccountsDTO,
  type Page,
  type SetupDTO,
  type StatusDTO,
  type TransactionDTO,
} from "@ikat/core";
import { categorize, merchantCategories } from "../src/categorize";
import { markMicroDeposits, pairWithBrokerage } from "../src/sync/transfers";
import { displayNames } from "../src/views/accounts";
import { schema } from "../src/db";
import { makeApp, type TestApp } from "./helpers";

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});

describe("demo household", () => {
  it("seeds every institution and account type", async () => {
    const status = await app.get<StatusDTO>("/api/status");
    expect(status.profile).toBe("demo");
    expect(status.connections).toHaveLength(8);
    expect(status.connections.every((c) => c.status === "ok")).toBe(true);
    const { accounts } = await app.get<AccountsDTO>("/api/accounts");
    const groups = new Set(accounts.map((a) => a.group));
    expect(groups).toEqual(new Set(["cash", "cards", "investments", "loans"]));
    expect(accounts.find((a) => a.subtype === "401k")?.taxTreatment).toBe(
      "tax_deferred",
    );
    expect(accounts.find((a) => a.subtype === "roth")?.taxTreatment).toBe(
      "tax_free",
    );
  });

  it("keeps every balance sane: checking never overdrawn, cards owe, loan amortizing", async () => {
    const { accounts } = await app.get<AccountsDTO>("/api/accounts");
    const checking = accounts.find((a) => a.subtype === "checking")!;
    expect(checking.balanceCents).toBeGreaterThan(0);
    const db = app.ctx.store.db();
    const min = db
      .select({ v: sql<number>`min(${schema.balanceSnapshots.currentCents})` })
      .from(schema.balanceSnapshots)
      .where(eq(schema.balanceSnapshots.accountId, checking.id))
      .get()!;
    expect(min.v).toBeGreaterThan(0);
    const loan = accounts.find((a) => a.group === "loans")!;
    expect(loan.isLiability).toBe(true);
    expect(loan.balanceCents).toBeGreaterThan(0);
    expect(loan.balanceCents).toBeLessThan(3_150_000);
  });

  it("groups sum exactly to net worth", async () => {
    const view = await app.get<AccountsDTO>("/api/accounts");
    const sum = view.groups.reduce((s, g) => s + g.totalCents, 0);
    expect(sum).toBe(view.netWorthCents);
    expect(view.assetsCents - view.liabilitiesCents).toBe(view.netWorthCents);
    expect(view.groups.reduce((s, g) => s + g.count, 0)).toBe(
      view.accounts.length,
    );
  });
});

describe("sync", () => {
  it("is idempotent: syncing again adds no duplicates", async () => {
    const db = app.ctx.store.db();
    const count = () =>
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.transactions)
        .get()!.n;
    const before = count();
    await app.engine.syncAll({ force: true });
    expect(count()).toBe(before);
  });

  it("never overwrites a user's category", async () => {
    const db = app.ctx.store.db();
    const target = db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.categoryId, "coffee"))
      .limit(1)
      .get()!;
    db.update(schema.transactions)
      .set({ categoryId: "dining", categorySource: "user" })
      .where(eq(schema.transactions.id, target.id))
      .run();
    await app.engine.syncAll({ force: true });
    const after = db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.id, target.id))
      .get()!;
    expect(after.categoryId).toBe("dining");
    expect(after.categorySource).toBe("user");
  });

  it("extends history on the next day instead of rewriting it", async () => {
    const db = app.ctx.store.db();
    const ids = new Set(
      db
        .select({ id: schema.transactions.externalId })
        .from(schema.transactions)
        .all()
        .map((r) => r.id),
    );
    app.clock.today = "2026-09-24";
    await app.engine.syncAll({ force: true });
    const after = db
      .select({
        id: schema.transactions.externalId,
        pending: schema.transactions.pending,
      })
      .from(schema.transactions)
      .all();
    const lost = [...ids].filter(
      (id) => !id.startsWith("p-") && !after.some((a) => a.id === id),
    );
    expect(lost).toEqual([]);
    // Yesterday's pending card charges are now posted, not duplicated.
    const pendingIds = after.filter((a) => a.pending).map((a) => a.id);
    for (const p of pendingIds)
      expect(after.some((a) => a.id === p.slice(2))).toBe(false);
    app.clock.today = "2026-09-23";
  });
});

describe("categorisation", () => {
  it("splits groceries from dining by merchant code", async () => {
    const db = app.ctx.store.db();
    const tj = db
      .select()
      .from(schema.transactions)
      .where(like(schema.transactions.description, "TRADER JOE%"))
      .limit(1)
      .get()!;
    expect(tj.categoryId).toBe("groceries");
    expect(tj.categorySource).toBe("mcc");
  });

  it("files cable (MCC 4899) by the provider, not as streaming", async () => {
    const db = app.ctx.store.db();
    const comcast = db
      .select()
      .from(schema.transactions)
      .where(like(schema.transactions.description, "COMCAST%"))
      .limit(1)
      .get()!;
    expect(comcast.categoryId).toBe("phone_internet");
  });

  it("files a merchant's uncoded charges where its coded ones agree, but never its paychecks", () => {
    const apple = [
      { merchantKey: "apple", mcc: "5818" },
      { merchantKey: "apple", mcc: "5818" },
      { merchantKey: "apple", mcc: null },
      { merchantKey: "lone", mcc: "5818" },
    ];
    const agreed = merchantCategories(apple);
    expect(agreed.get("apple")).toBe("software");
    // One coded charge isn't agreement.
    expect(agreed.has("lone")).toBe(false);
    const base = {
      merchantKey: "apple",
      accountId: "a",
      accountType: "credit",
      mcc: null,
      merchantCategory: agreed.get("apple"),
    };
    // The same $9.99 subscription on a card that doesn't pass the code through.
    expect(
      categorize(
        {
          ...base,
          description: "Apple",
          amountCents: -999,
          providerCategory: "ENTERTAINMENT",
          providerCategoryDetailed: "ENTERTAINMENT_OTHER_ENTERTAINMENT",
        },
        [],
      ),
    ).toEqual({ categoryId: "software", source: "inferred" });
    // A record shop is "music and audio" to the provider, like Spotify; in person it's entertainment.
    const music = {
      merchantKey: "record shop",
      accountId: "a",
      accountType: "credit",
      mcc: "5192",
      description: "SQ *A1 RECORD SHOP",
      amountCents: -6532,
      providerCategory: "ENTERTAINMENT",
      providerCategoryDetailed: "ENTERTAINMENT_MUSIC_AND_AUDIO",
    };
    expect(
      categorize({ ...music, paymentChannel: "in store" }, []).categoryId,
    ).toBe("entertainment");
    expect(
      categorize(
        {
          ...music,
          merchantKey: "spotify",
          mcc: "4899",
          paymentChannel: "online",
        },
        [],
      ).categoryId,
    ).toBe("streaming");
    // Money a merchant pays you keeps its own category.
    expect(
      categorize(
        {
          ...base,
          merchantKey: "acme",
          description: "ACME CORP PAYROLL",
          amountCents: 412_000,
          accountType: "depository",
          providerCategory: "INCOME",
          providerCategoryDetailed: "INCOME_SALARY",
          merchantCategory: "shopping",
        },
        [],
      ).categoryId,
    ).toBe("paycheck");
  });
});

describe("account names", () => {
  it("drops the last four digits an institution repeats in the name", () => {
    const row = (name: string, mask: string | null) =>
      ({
        id: name,
        name,
        mask,
        nickname: null,
        officialName: null,
      }) as unknown as Parameters<typeof displayNames>[0][number];
    const names = displayNames([
      row("Robinhood Credit Card **4242", "4242"),
      row("Checking x1234", "1234"),
      row("Card ...5555", "5555"),
      row("Box4242", "4242"),
    ]);
    expect([...names.values()]).toEqual([
      "Robinhood Credit Card",
      "Checking",
      "Card",
      "Box4242",
    ]);
  });

  it("reads an institution's all-caps name in title case, acronyms left alone", () => {
    const row = (name: string) =>
      ({
        id: name,
        name,
        mask: null,
        nickname: null,
        officialName: null,
      }) as unknown as Parameters<typeof displayNames>[0][number];
    const names = displayNames([
      row("2021 TOYOTA RAV4"),
      row("ACME 401(K) PLAN"),
      row("ACME RSU"),
      row("Primary Savings S0001"),
    ]);
    expect([...names.values()]).toEqual([
      "2021 Toyota RAV4",
      "Acme 401(K) Plan",
      "Acme RSU",
      "Primary Savings S0001",
    ]);
  });
});

describe("transfers", () => {
  it("pairs money moved out of a brokerage with the bank deposit it became", () => {
    const db = app.ctx.store.db();
    const checking = db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.subtype, "checking"))
      .get()!;
    const brokerage = db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.subtype, "brokerage"))
      .get()!;
    db.insert(schema.investmentTransactions)
      .values({
        id: "eft-out",
        accountId: brokerage.id,
        externalId: "eft-out",
        date: "2026-09-01",
        name: "Electronic Funds Transfer Paid (Cash)",
        type: "cash",
        subtype: "withdrawal",
        amountCents: -1_850_000,
      })
      .run();
    db.insert(schema.transactions)
      .values({
        id: "eft-in",
        accountId: checking.id,
        externalId: "eft-in",
        date: "2026-09-02",
        amountCents: 1_850_000,
        description: "FID BKG SVC LLC MONEYLINE",
        merchantKey: "fid bkg svc llc moneyline",
        categoryId: "other_income",
      })
      .run();
    pairWithBrokerage(db);
    const row = db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.id, "eft-in"))
      .get()!;
    expect(row.categoryId).toBe("transfer");
    expect(row.transferPairId).toBe("itx:eft-out");
  });

  it("files a micro-deposit handshake as a transfer, not income and a fee", () => {
    const db = app.ctx.store.db();
    const savings = db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.subtype, "savings"))
      .get()!;
    const add = (
      externalId: string,
      date: string,
      amountCents: number,
      categoryId: string,
    ) =>
      db
        .insert(schema.transactions)
        .values({
          id: externalId,
          accountId: savings.id,
          externalId,
          date,
          amountCents,
          description: "JPMorgan Chase",
          merchantKey: "jpmorgan chase",
          categoryId,
        })
        .run();
    add("md-1", "2026-09-20", 40, "other_income");
    add("md-2", "2026-09-20", 16, "other_income");
    add("md-3", "2026-09-21", -56, "fees");
    add("fee", "2026-09-21", -57, "fees");
    markMicroDeposits(db);
    const cat = (id: string) =>
      db
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.id, id))
        .get()!.categoryId;
    expect(["md-1", "md-2", "md-3"].map(cat)).toEqual([
      "transfer",
      "transfer",
      "transfer",
    ]);
    expect(cat("fee")).toBe("fees");
  });

  it("pairs every card autopay with the card's payment credit", async () => {
    const db = app.ctx.store.db();
    const autopays = db
      .select()
      .from(schema.transactions)
      .where(and(like(schema.transactions.description, "%AUTOPAY PPD%")))
      .all();
    expect(autopays.length).toBeGreaterThan(10);
    const paired = autopays.filter((t) => t.transferPairId);
    expect(paired.length).toBe(autopays.length);
    for (const t of paired) expect(categoryKind(t.categoryId)).toBe("transfer");
  });

  it("keeps the checking side of a loan payment as an expense but pairs it", async () => {
    const db = app.ctx.store.db();
    const pay = db
      .select()
      .from(schema.transactions)
      .where(like(schema.transactions.description, "TOYOTA FINANCIAL%"))
      .limit(1)
      .get()!;
    expect(pay.categoryId).toBe("loan_payment");
    expect(pay.transferPairId).not.toBeNull();
    const mirror = db
      .select()
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.transferPairId, pay.transferPairId!),
          isNotNull(schema.transactions.id),
        ),
      )
      .all();
    expect(mirror).toHaveLength(2);
  });

  it("never pairs a refund with an unrelated purchase", async () => {
    const db = app.ctx.store.db();
    const refunds = db
      .select()
      .from(schema.transactions)
      .innerJoin(
        schema.accounts,
        eq(schema.accounts.id, schema.transactions.accountId),
      )
      .where(
        and(
          eq(schema.accounts.type, "credit"),
          like(schema.transactions.description, "AMAZON MKTPL%"),
        ),
      )
      .all()
      .filter((r) => r.transactions.amountCents > 0);
    expect(refunds.length).toBeGreaterThan(0);
    for (const r of refunds) expect(r.transactions.transferPairId).toBeNull();
  });
});

describe("transactions API", () => {
  it("returns a page with totals over the whole filtered set", async () => {
    const page = await app.get<Page<TransactionDTO>>(
      "/api/transactions?category=groceries&limit=5",
    );
    expect(page.items).toHaveLength(5);
    expect(page.total).toBeGreaterThan(5);
    expect(page.totalAmountCents).toBeLessThan(0);
    expect(page.items.every((t) => t.categoryId === "groceries")).toBe(true);
  });
});

describe("auth", () => {
  it("lets the local machine in without a password", async () => {
    const res = await app.server.inject({ method: "GET", url: "/api/status" });
    expect(res.statusCode).toBe(200);
  });

  it("refuses remote access until a password exists, then requires a session", async () => {
    const remote = { "x-forwarded-for": "100.101.102.103" };
    expect(
      (
        await app.server.inject({
          method: "GET",
          url: "/api/status",
          headers: remote,
        })
      ).statusCode,
    ).toBe(403);
    const set = await app.server.inject({
      method: "POST",
      url: "/api/auth/password",
      payload: { next: "correct horse battery" },
    });
    expect(set.statusCode).toBe(200);
    expect(
      (
        await app.server.inject({
          method: "GET",
          url: "/api/status",
          headers: remote,
        })
      ).statusCode,
    ).toBe(401);
    const bad = await app.server.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: remote,
      payload: { password: "nope" },
    });
    expect(bad.statusCode).toBe(401);
    const login = await app.server.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: remote,
      payload: { password: "correct horse battery" },
    });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const ok = await app.server.inject({
      method: "GET",
      url: "/api/status",
      headers: { ...remote, cookie },
    });
    expect(ok.statusCode).toBe(200);
  });

  it("does not trust a spoofed loopback address ahead of the real proxy hop", async () => {
    const spoof = { "x-forwarded-for": "127.0.0.1, 100.64.0.9" };
    expect(
      (
        await app.server.inject({
          method: "GET",
          url: "/api/status",
          headers: spoof,
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe("setup checklist", () => {
  it("ticks itself off from the data", async () => {
    const app = await makeApp();
    try {
      const s = await app.get<SetupDTO>("/api/setup");
      expect(s.items.find((i) => i.id === "link")!.done).toBe(true);
      await app.server.inject({
        method: "PUT",
        url: "/api/settings/ui.setup.dismissed",
        payload: { value: true },
      });
      expect((await app.get<SetupDTO>("/api/setup")).dismissed).toBe(true);
    } finally {
      await app.close();
    }
  });
});
