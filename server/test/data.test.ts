import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeApp, type TestApp } from "./helpers";

let app: TestApp;
beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
});

describe("export", () => {
  it("writes transactions as CSV, quoting what needs it", async () => {
    const res = await app.server.inject({
      method: "GET",
      url: "/api/export/transactions.csv",
    });
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toMatch(
      /attachment; filename="ikat-demo-transactions-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    const lines = res.body.trim().split("\r\n");
    expect(lines[0]).toBe(
      "Date,Account,Merchant,Description,Amount,Category,Notes,Tags,Pending,Excluded",
    );
    expect(lines.length).toBeGreaterThan(500);
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2},/);
  });

  it("exports everything as JSON without a single secret", async () => {
    const res = await app.server.inject({
      method: "GET",
      url: "/api/export/ikat.json",
    });
    const body = JSON.parse(res.body);
    expect(body.format).toBe("ikat-export");
    expect(body.transactions.length).toBeGreaterThan(500);
    expect(res.body).not.toMatch(
      /accessToken|access_token|passwordHash|ai\.credentials|plaid\.credentials|push\.vapid/,
    );
  });
});

describe("backups", () => {
  it("makes one on demand and lists it for download", async () => {
    const made = await app.server.inject({
      method: "POST",
      url: "/api/backups",
      payload: {},
    });
    const list = made.json() as Array<{
      name: string;
      manual: boolean;
      bytes: number;
    }>;
    expect(list[0]!.manual).toBe(true);
    expect(list[0]!.bytes).toBeGreaterThan(0);
    const file = await app.server.inject({
      method: "GET",
      url: `/api/backups/${list[0]!.name}`,
    });
    expect(file.rawPayload.subarray(0, 15).toString()).toBe("SQLite format 3");
    expect(
      (
        await app.server.inject({
          method: "GET",
          url: "/api/backups/..%2Fikat.db",
        })
      ).statusCode,
    ).toBe(404);
  });
});
