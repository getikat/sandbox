import { and, eq, inArray } from "drizzle-orm";
import {
  addDays,
  displayTicker,
  endOfMonth,
  looksLikeCompany,
  merchantKey,
  prettifyMerchant,
} from "@ikat/core";
import { followMerchantCodes, recategorize } from "../recategorize";
import { markMicroDeposits, pairWithBrokerage } from "../sync/transfers";
import * as schema from "./schema";
import type { DB } from "./index";

/**
 * Bump when merchant cleanup rules change, so rows stored under the old rules
 * are re-keyed once and a merchant's old and new transactions stay one series.
 */
const MERCHANT_RULES_VERSION = 4;

/** v2 learned to strip ACH boilerplate ("… ACH PAY PPD ID: 123456789"). */
const ACH_NOISE =
  /\b(ach (pay|pmt|payment|debit|credit|trnsfr|transfer|withdrawal|deposit|web)|(ppd|ccd|web|tel|ctx|iat) id|des)\b/;
/** v3 learned more processor prefixes; rows keyed as the bare prefix ("cl" for "CL *Chase Travel"). */
const BARE_PROCESSOR = /^(cl|fsi|eb|fs|ls|dd|ic)$/;
/** v4 drops "… ending in 2082" from card payments. */
const ENDING_IN = / ending in$/;

/**
 * One-time repairs when derived data's rules change. Each runs once per
 * database, at its version.
 */
const FIXUPS: Array<{ key: string; version: number; run: (db: DB) => void }> = [
  {
    key: "fixups.merchantRules",
    version: MERCHANT_RULES_VERSION,
    run: (db) =>
      rekeyMerchants(
        db,
        (key) =>
          ACH_NOISE.test(key) ||
          BARE_PROCESSOR.test(key) ||
          ENDING_IN.test(key),
      ),
  },
  // v2: Plaid's newer categories (INCOME_SALARY is a paycheck; loan disbursements aren't income).
  {
    key: "fixups.categoryMap",
    version: 2,
    run: (db) =>
      recategorize(
        db,
        inArray(schema.transactions.providerCategory, [
          "INCOME",
          "LOAN_DISBURSEMENTS",
        ]),
      ),
  },
  // Coins stored as cash equivalents before the Plaid mapping stopped taking that flag for crypto.
  {
    key: "fixups.cryptoNotCash",
    version: 1,
    run: (db) =>
      db
        .update(schema.securities)
        .set({ isCashEquivalent: false })
        .where(eq(schema.securities.type, "cryptocurrency"))
        .run(),
  },
  // Wash-sale alerts raised for coins in the hours before crypto was exempted from the watch.
  { key: "fixups.cryptoWashAlerts", version: 1, run: dropCryptoWashAlerts },
  // A merchant's uncoded rows follow the category its coded rows agree on.
  {
    key: "fixups.merchantCodes",
    version: 1,
    run: (db) => followMerchantCodes(db),
  },
  // In-person "music and audio" / "TV and movies" filed as streaming.
  {
    key: "fixups.inStoreStreaming",
    version: 1,
    run: (db) =>
      recategorize(
        db,
        and(
          eq(schema.transactions.paymentChannel, "in store"),
          inArray(schema.transactions.providerCategoryDetailed, [
            "ENTERTAINMENT_MUSIC_AND_AUDIO",
            "ENTERTAINMENT_TV_AND_MOVIES",
          ]),
        ),
      ),
  },
  // Bank rows moving money to or from a brokerage, stored unpaired (vest proceeds read as income).
  {
    key: "fixups.brokeragePairs",
    version: 1,
    run: (db) => pairWithBrokerage(db),
  },
  // Micro-deposit handshakes stored as income and a bank fee.
  {
    key: "fixups.microDeposits",
    version: 1,
    run: (db) => markMicroDeposits(db),
  },
  // Fidelity's core cash position stored as a stock.
  {
    key: "fixups.coreCash",
    version: 1,
    run: (db) =>
      db
        .update(schema.securities)
        .set({ type: "cash", isCashEquivalent: true })
        .where(eq(schema.securities.ticker, "FCASH"))
        .run(),
  },
  // Companies' units stored as funds before the Plaid mapping learned to tell them apart.
  {
    key: "fixups.companiesNotFunds",
    version: 1,
    run: (db) => {
      for (const sec of db
        .select()
        .from(schema.securities)
        .where(eq(schema.securities.type, "mutual fund"))
        .all()) {
        if (looksLikeCompany(sec.name))
          db.update(schema.securities)
            .set({ type: "equity" })
            .where(eq(schema.securities.id, sec.id))
            .run();
      }
    },
  },
];

function dropCryptoWashAlerts(db: DB) {
  const coins = new Set(
    db
      .select()
      .from(schema.securities)
      .where(eq(schema.securities.type, "cryptocurrency"))
      .all()
      .map((s) => displayTicker(s.ticker)),
  );
  for (const a of db
    .select()
    .from(schema.alerts)
    .where(eq(schema.alerts.kind, "wash_sale"))
    .all()) {
    if (coins.has(a.key.split(":")[1] ?? ""))
      db.delete(schema.alerts).where(eq(schema.alerts.id, a.id)).run();
  }
}

export function runFixups(db: DB) {
  for (const f of FIXUPS) {
    const row = db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, f.key))
      .get();
    if ((row?.value as number | undefined) === f.version) continue;
    f.run(db);
    db.insert(schema.settings)
      .values({ key: f.key, value: f.version })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: f.version },
      })
      .run();
  }
}

/**
 * Re-derive merchant keys (and names Ikat derived itself) under the current
 * rules, for the keys a rule change `affects`. A provider's own merchant name
 * only ever gets trimmed (the new key must be a prefix of the old one), so it
 * is never swapped for a descriptor's; a name Ikat derived is re-derived.
 */
export function rekeyMerchants(
  db: DB,
  affects: (key: string) => boolean,
): number {
  const rows = db
    .select({
      id: schema.transactions.id,
      description: schema.transactions.description,
      name: schema.transactions.merchantName,
      key: schema.transactions.merchantKey,
    })
    .from(schema.transactions)
    .all();
  const renamed = new Map<string, string>();
  let changed = 0;
  db.transaction((tx) => {
    for (const r of rows) {
      if (!affects(r.key)) continue;
      // A name Ikat derived from the descriptor reads back as its own key, and
      // that key is a run of the descriptor's words. A provider's name isn't.
      const words = r.description
        .toLowerCase()
        .replace(/[^a-z0-9&' ]+/g, " ")
        .replace(/\s+/g, " ");
      const derived =
        !r.name || (r.name.toLowerCase() === r.key && words.includes(r.key));
      const key = merchantKey(derived ? r.description : r.name!);
      // A provider's name only ever loses noise; a name Ikat derived is simply re-derived.
      if (key === r.key || (!derived && !r.key.startsWith(key))) continue;
      tx.update(schema.transactions)
        .set({
          merchantKey: key,
          ...(derived ? { merchantName: prettifyMerchant(r.description) } : {}),
        })
        .where(eq(schema.transactions.id, r.id))
        .run();
      renamed.set(r.key, key);
      changed++;
    }
    for (const [from, to] of renamed) {
      tx.update(schema.categoryRules)
        .set({ merchantKey: to })
        .where(eq(schema.categoryRules.merchantKey, from))
        .run();
      const o = tx
        .select()
        .from(schema.recurringOverrides)
        .where(eq(schema.recurringOverrides.merchantKey, from))
        .get();
      if (o) {
        tx.delete(schema.recurringOverrides)
          .where(eq(schema.recurringOverrides.merchantKey, from))
          .run();
        tx.insert(schema.recurringOverrides)
          .values({ ...o, merchantKey: to })
          .onConflictDoNothing()
          .run();
      }
    }
  });
  return changed;
}
