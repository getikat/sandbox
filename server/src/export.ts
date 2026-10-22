import { CATEGORY_BY_ID } from "@ikat/core";
import { schema, type DB } from "./db";
import { displayNames, loadAccountRows } from "./views/accounts";

/** RFC 4180: quote fields with commas, quotes or line breaks. */
function csv(
  rows: Array<Array<string | number | boolean | null | undefined>>,
): string {
  const cell = (v: string | number | boolean | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

const dollars = (c: number | null | undefined) =>
  c == null ? "" : (c / 100).toFixed(2);

export function transactionsCsv(db: DB): string {
  const names = displayNames(loadAccountRows(db, { includeDuplicates: true }));
  const rows = db
    .select()
    .from(schema.transactions)
    .orderBy(schema.transactions.date)
    .all();
  return csv([
    [
      "Date",
      "Account",
      "Merchant",
      "Description",
      "Amount",
      "Category",
      "Notes",
      "Tags",
      "Pending",
      "Excluded",
    ],
    ...rows.map((t) => [
      t.date,
      names.get(t.accountId) ?? "",
      t.merchantName,
      t.description,
      dollars(t.amountCents),
      CATEGORY_BY_ID[t.categoryId]?.name ?? t.categoryId,
      t.notes,
      t.tags.join("; "),
      t.pending,
      t.excluded,
    ]),
  ]);
}

export function accountsCsv(db: DB): string {
  const rows = loadAccountRows(db);
  const names = displayNames(rows);
  return csv([
    [
      "Account",
      "Institution",
      "Type",
      "Subtype",
      "Mask",
      "Balance",
      "Available",
      "Limit",
      "In net worth",
      "Updated",
    ],
    ...rows.map((a) => [
      names.get(a.id),
      a.institutionName,
      a.type,
      a.subtype,
      a.mask,
      dollars(a.currentCents),
      dollars(a.availableCents),
      dollars(a.limitCents),
      a.includeInNetWorth,
      a.balanceAsOf,
    ]),
  ]);
}

export function holdingsCsv(db: DB): string {
  const names = displayNames(loadAccountRows(db));
  const secs = new Map(
    db
      .select()
      .from(schema.securities)
      .all()
      .map((s) => [s.id, s]),
  );
  return csv([
    [
      "Account",
      "Ticker",
      "Security",
      "Quantity",
      "Price",
      "Value",
      "Cost basis",
      "As of",
    ],
    ...db
      .select()
      .from(schema.holdings)
      .all()
      .map((h) => {
        const s = secs.get(h.securityId);
        return [
          names.get(h.accountId),
          s?.ticker,
          s?.name,
          h.quantity,
          h.priceCents != null ? (h.priceCents / 100).toFixed(4) : "",
          dollars(h.valueCents),
          dollars(h.costBasisCents),
          h.asOf,
        ];
      }),
  ]);
}

/**
 * Everything Ikat knows, as JSON — without secrets: no access tokens, no
 * stored credentials or keys, no sessions.
 */
export function everythingJson(db: DB) {
  const connections = db
    .select({
      id: schema.connections.id,
      provider: schema.connections.provider,
      institutionName: schema.connections.institutionName,
      createdAt: schema.connections.createdAt,
    })
    .from(schema.connections)
    .all();
  return {
    format: "ikat-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    connections,
    accounts: db.select().from(schema.accounts).all(),
    balanceSnapshots: db.select().from(schema.balanceSnapshots).all(),
    transactions: db.select().from(schema.transactions).all(),
    securities: db.select().from(schema.securities).all(),
    holdings: db.select().from(schema.holdings).all(),
    investmentTransactions: db
      .select()
      .from(schema.investmentTransactions)
      .all(),
    liabilities: db.select().from(schema.liabilities).all(),
    budgets: db.select().from(schema.budgets).all(),
    categoryRules: db.select().from(schema.categoryRules).all(),
    recurringOverrides: db.select().from(schema.recurringOverrides).all(),
    cardProfiles: db.select().from(schema.cardProfiles).all(),
    goals: db.select().from(schema.goals).all(),
    reviews: db.select().from(schema.reviews).all(),
    preferences: db
      .select()
      .from(schema.settings)
      .all()
      .filter((s) => /^(ui\.|tax\.profile|alerts\.prefs)/.test(s.key)),
  };
}

export const EXPORTS = {
  "transactions.csv": {
    type: "text/csv; charset=utf-8",
    build: transactionsCsv,
  },
  "accounts.csv": { type: "text/csv; charset=utf-8", build: accountsCsv },
  "holdings.csv": { type: "text/csv; charset=utf-8", build: holdingsCsv },
  "ikat.json": {
    type: "application/json",
    build: (db: DB) => JSON.stringify(everythingJson(db), null, 1),
  },
} as const;
