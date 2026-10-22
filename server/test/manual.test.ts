import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, type AccountDTO, type AccountsDTO } from "@ikat/core";
import { schema } from "../src/db";
import { makeApp, TODAY, type TestApp } from "./helpers";

let app: TestApp;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});

describe("accounts added by hand", () => {
  it("count in net worth, take new values, and are recorded daily", async () => {
    const before = await app.get<AccountsDTO>("/api/accounts");
    const res = await app.server.inject({
      method: "POST",
      url: "/api/accounts/manual",
      payload: { name: "Home", kind: "home", valueCents: 50_000_000 },
    });
    const home = res.json() as AccountDTO;
    expect(home).toMatchObject({
      manual: true,
      group: "property",
      subtypeLabel: "Home",
      balanceCents: 50_000_000,
    });
    expect((await app.get<AccountsDTO>("/api/accounts")).netWorthCents).toBe(
      before.netWorthCents + 50_000_000,
    );

    const car = (
      await app.server.inject({
        method: "POST",
        url: "/api/accounts/manual",
        payload: { name: "Family loan", kind: "debt", valueCents: 200_000 },
      })
    ).json() as AccountDTO;
    expect(car.isLiability).toBe(true);

    await app.server.inject({
      method: "PUT",
      url: `/api/accounts/${home.id}/value`,
      payload: { valueCents: 51_000_000 },
    });
    expect(
      (await app.get<AccountsDTO>("/api/accounts")).accounts.find(
        (a) => a.id === home.id,
      )!.balanceCents,
    ).toBe(51_000_000);

    // The next day's sync records the stated value again.
    app.clock.today = addDays(TODAY, 1);
    await app.engine.syncAll({ force: true });
    const snaps = app.ctx.store
      .db()
      .select()
      .from(schema.balanceSnapshots)
      .where(eq(schema.balanceSnapshots.accountId, home.id))
      .all();
    expect(snaps.map((s) => [s.date, s.currentCents])).toEqual([
      [TODAY, 51_000_000],
      [addDays(TODAY, 1), 51_000_000],
    ]);
    app.clock.today = TODAY;

    // Linked accounts can't be revalued or deleted by hand.
    const linked = before.accounts[0]!;
    expect(
      (
        await app.server.inject({
          method: "DELETE",
          url: `/api/accounts/${linked.id}`,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.server.inject({
          method: "DELETE",
          url: `/api/accounts/${home.id}`,
        })
      ).statusCode,
    ).toBe(200);
  });
});
