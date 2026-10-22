import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  readStatement,
  type ImportedTransaction,
  type ISODate,
} from "@ikat/core";
import type { AppContext } from "./context";
import { schema } from "./db";
import type {
  ConnectionRow,
  ProviderTransaction,
  SyncResult,
} from "./providers/types";
import { applySyncResult } from "./sync/engine";
import { dedupe } from "./sync/duplicates";
import { pairTransfers, pairWithBrokerage } from "./sync/transfers";
import { followMerchantCodes } from "./recategorize";

// A bank's own category words, mapped to the Plaid categories Ikat's
// categoriser already understands.
const CATEGORY_HINTS: Array<[RegExp, string, string | null]> = [
  [/grocer/i, "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"],
  [/coffee/i, "FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE"],
  [/food|dining|restaurant/i, "FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT"],
  [/gas|fuel/i, "TRANSPORTATION", "TRANSPORTATION_GAS"],
  [/travel|airline|hotel|lodging/i, "TRAVEL", null],
  [/auto|car\b/i, "GENERAL_SERVICES", "GENERAL_SERVICES_AUTOMOTIVE"],
  [/utilit|bills/i, "RENT_AND_UTILITIES", null],
  [/health|medical|pharmac/i, "MEDICAL", null],
  [/entertain/i, "ENTERTAINMENT", null],
  [/personal/i, "PERSONAL_CARE", null],
  [/home/i, "HOME_IMPROVEMENT", null],
  [/educat/i, "GENERAL_SERVICES", "GENERAL_SERVICES_EDUCATION"],
  [
    /gift|donat|charit/i,
    "GOVERNMENT_AND_NON_PROFIT",
    "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
  ],
  [/fee|interest charge/i, "BANK_FEES", null],
  [/shopping|merchandise/i, "GENERAL_MERCHANDISE", null],
];

export interface ImportRequest {
  filename: string;
  content: string;
  flipSign?: boolean;
  accountId?: string;
  newAccount?: { name: string; type: "checking" | "savings" | "credit" };
  /** Only for files without one (CSV): the balance today, if you know it. */
  balanceCents?: number | null;
}

export function previewImport(ctx: AppContext, req: ImportRequest) {
  const parsed = readStatement(req.filename, req.content, {
    flipSign: req.flipSign,
  });
  if (!parsed || parsed.transactions.length === 0) return null;
  const dates = parsed.transactions.map((t) => t.date).sort();
  const known = req.accountId
    ? new Set(
        ctx.store
          .db()
          .select({ ext: schema.transactions.externalId })
          .from(schema.transactions)
          .where(eq(schema.transactions.accountId, req.accountId))
          .all()
          .map((r) => r.ext),
      )
    : new Set<string>();
  const outflows = parsed.transactions.filter((t) => t.amountCents < 0).length;
  return {
    format: parsed.format,
    count: parsed.transactions.length,
    alreadyImported: parsed.transactions.filter((t) => known.has(t.externalId))
      .length,
    skipped: parsed.skipped,
    from: dates[0] as ISODate,
    to: dates.at(-1) as ISODate,
    balanceCents: parsed.balanceCents,
    suggestedType: parsed.account?.type ?? null,
    // A file that's mostly positive numbers is usually spending written positive.
    looksFlipped:
      parsed.format === "csv" && outflows < parsed.transactions.length * 0.5,
    sample: parsed.transactions
      .slice(0, 8)
      .map(({ date, description, amountCents }) => ({
        date,
        description,
        amountCents,
      })),
  };
}

/**
 * Import through the one write path: the file becomes a SyncResult for an
 * "Imported files" connection, so categorisation, rules, transfer pairing and
 * duplicate handling work exactly as for linked banks. Re-importing the same
 * file adds nothing — rows keep stable ids.
 */
export function commitImport(ctx: AppContext, req: ImportRequest) {
  const db = ctx.store.db();
  const parsed = readStatement(req.filename, req.content, {
    flipSign: req.flipSign,
  });
  if (!parsed || parsed.transactions.length === 0) return null;

  let conn = db
    .select()
    .from(schema.connections)
    .where(eq(schema.connections.provider, "file"))
    .get();
  if (!conn) {
    db.insert(schema.connections)
      .values({
        id: randomUUID(),
        provider: "file",
        institutionName: "Imported files",
        institutionColor: "#6c717b",
      })
      .run();
    conn = db
      .select()
      .from(schema.connections)
      .where(eq(schema.connections.provider, "file"))
      .get()!;
  }

  let account = req.accountId
    ? db
        .select()
        .from(schema.accounts)
        .where(eq(schema.accounts.id, req.accountId))
        .get()
    : undefined;
  if (req.accountId && (!account || account.connectionId !== conn.id))
    throw new Error(
      "Statements import into imported accounts only — a linked account already gets these from its bank.",
    );
  const type = account
    ? (account.subtype as "checking" | "savings" | "credit")
    : (req.newAccount?.type ?? parsed.account?.type ?? "checking");
  const externalId = account?.externalId ?? `file-${randomUUID()}`;
  const stated = parsed.balanceCents ?? req.balanceCents ?? null;
  const balance =
    stated != null
      ? type === "credit"
        ? Math.abs(stated)
        : stated
      : (account?.currentCents ?? null);

  const tx = (t: ImportedTransaction): ProviderTransaction => {
    const hint = t.category
      ? CATEGORY_HINTS.find(([re]) => re.test(t.category!))
      : undefined;
    return {
      externalId: t.externalId,
      pendingExternalId: null,
      accountExternalId: externalId,
      date: t.date,
      authorizedDate: null,
      amountCents: t.amountCents,
      currency: "USD",
      description: t.description,
      merchantName: null,
      logoUrl: null,
      website: null,
      mcc: null,
      providerCategory: hint?.[1] ?? null,
      providerCategoryDetailed: hint?.[2] ?? null,
      paymentChannel: null,
      pending: false,
      runningBalanceCents: null,
      location: null,
    };
  };

  const result: SyncResult = {
    institution: null,
    accounts: [
      {
        externalId,
        name:
          account?.name ??
          req.newAccount?.name ??
          req.filename.replace(/\.[^.]+$/, ""),
        officialName: null,
        mask: parsed.account?.id?.slice(-4) ?? account?.mask ?? null,
        type: type === "credit" ? "credit" : "depository",
        subtype: type,
        currentCents: balance,
        availableCents: null,
        limitCents: null,
        currency: "USD",
      },
    ],
    transactions: {
      added: parsed.transactions.map(tx),
      modified: [],
      removed: [],
      cursor: null,
    },
    investments: null,
    liabilities: null,
    missingConsent: [],
    products: [],
  };
  const before = db
    .select({ ext: schema.transactions.externalId })
    .from(schema.transactions)
    .all().length;
  applySyncResult(db, conn as ConnectionRow, result, ctx.today());
  dedupe(db);
  pairTransfers(db);
  pairWithBrokerage(db);
  followMerchantCodes(db);
  const after = db
    .select({ ext: schema.transactions.externalId })
    .from(schema.transactions)
    .all().length;
  const accountId = db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.externalId, externalId))
    .get()!.id;
  return {
    accountId,
    added: after - before,
    total: parsed.transactions.length,
  };
}
