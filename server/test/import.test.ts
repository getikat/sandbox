import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../src/db";
import { makeApp, type TestApp } from "./helpers";

let app: TestApp;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});

const CSV =
  "Date,Description,Category,Amount\n09/01/2026,TRADER JOES #123,Groceries,54.20\n09/02/2026,SHELL OIL 5522,Gas,41.00\n09/03/2026,PAYMENT THANK YOU,Payment,-300.00\n";

describe("statement import", () => {
  it("previews, then imports once, categorised like any bank", async () => {
    const post = (url: string, payload: object) =>
      app.server.inject({ method: "POST", url, payload });
    const preview = (
      await post("/api/import/statement/preview", {
        filename: "card.csv",
        content: CSV,
      })
    ).json();
    expect(preview).toMatchObject({
      format: "csv",
      count: 3,
      from: "2026-09-01",
      to: "2026-09-03",
      looksFlipped: true,
    });

    const body = {
      filename: "card.csv",
      content: CSV,
      flipSign: true,
      newAccount: { name: "Costco Visa", type: "credit" },
      balanceCents: 12_345,
    };
    const first = (await post("/api/import/statement", body)).json();
    expect(first.added).toBe(3);
    const rows = app.ctx.store
      .db()
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.accountId, first.accountId))
      .all();
    expect(rows.find((r) => r.description.startsWith("TRADER"))).toMatchObject({
      amountCents: -5_420,
      categoryId: "groceries",
    });
    expect(
      rows.find((r) => r.description.startsWith("SHELL"))!.categoryId,
    ).toBe("gas");
    const acct = app.ctx.store
      .db()
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, first.accountId))
      .get()!;
    expect(acct).toMatchObject({ type: "credit", currentCents: 12_345 });

    // The same file again adds nothing.
    const again = (
      await post("/api/import/statement", {
        ...body,
        newAccount: undefined,
        accountId: first.accountId,
      })
    ).json();
    expect(again.added).toBe(0);
  });

  it("never imports into an account a bank already feeds", async () => {
    const linked = app.ctx.store
      .db()
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.type, "depository"))
      .get()!;
    const res = await app.server.inject({
      method: "POST",
      url: "/api/import/statement",
      payload: { filename: "x.csv", content: CSV, accountId: linked.id },
    });
    expect(res.statusCode).toBe(400);
  });

  it("says plainly when a file can't be read", async () => {
    const res = await app.server.inject({
      method: "POST",
      url: "/api/import/statement/preview",
      payload: { filename: "notes.csv", content: "hello,world\n1,2\n" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/date, description and amount/);
  });
});
