import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Conventions:
// - Money is integer cents. Transactions are signed from the account holder's
//   side: + money in, − money out (the reverse of Plaid's convention, converted
//   once at ingestion).
// - Balances are stored as the provider reports them: positive for what you
//   have on an asset, positive for what you owe on a liability.
// - Timestamps are ISO strings; calendar dates are "YYYY-MM-DD".

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the cookie token
  createdAt: text("created_at").notNull().default(now),
  expiresAt: text("expires_at").notNull(),
  userAgent: text("user_agent"),
});

export const connections = sqliteTable("connections", {
  id: text("id").primaryKey(),
  provider: text("provider", {
    enum: ["plaid", "demo", "manual", "file"],
  }).notNull(),
  externalId: text("external_id"), // Plaid item_id
  institutionId: text("institution_id"),
  institutionName: text("institution_name").notNull(),
  institutionLogo: text("institution_logo"), // data: URL
  institutionColor: text("institution_color"),
  accessTokenEnc: text("access_token_enc"),
  cursor: text("cursor"),
  products: text("products", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  missingConsent: text("missing_consent", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  status: text("status", { enum: ["ok", "error", "reauth", "consent"] })
    .notNull()
    .default("ok"),
  statusDetail: text("status_detail"),
  lastSyncedAt: text("last_synced_at"),
  lastAttemptAt: text("last_attempt_at"),
  /** Days of transaction history asked for when linked (730 for Ikat links; null when unknown). */
  historyDaysRequested: integer("history_days_requested"),
  /** The provider's word on whether full history has arrived (Plaid's transactions_update_status). */
  historyStatus: text("history_status"),
  createdAt: text("created_at").notNull().default(now),
});

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    officialName: text("official_name"),
    nickname: text("nickname"),
    mask: text("mask"),
    type: text("type").notNull(),
    subtype: text("subtype"),
    groupOverride: text("group_override"),
    owner: text("owner", { enum: ["me", "partner", "joint"] })
      .notNull()
      .default("me"),
    currency: text("currency").notNull().default("USD"),
    currentCents: integer("current_cents"),
    availableCents: integer("available_cents"),
    limitCents: integer("limit_cents"),
    balanceAsOf: text("balance_as_of"),
    includeInNetWorth: integer("include_in_net_worth", { mode: "boolean" })
      .notNull()
      .default(true),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    closedAt: text("closed_at"),
    /** Set when the same account also arrives through a newer connection. */
    duplicateOf: text("duplicate_of"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("accounts_conn_ext").on(t.connectionId, t.externalId)],
);

// One observed balance per account per day. Plaid has no balance history, so
// these rows are the only record of the past — a day without a sync is a gap
// that can never be filled with an observation (estimates are computed, never
// written here).
export const balanceSnapshots = sqliteTable(
  "balance_snapshots",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    currentCents: integer("current_cents"),
    availableCents: integer("available_cents"),
    recordedAt: text("recorded_at").notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.date] }),
    index("snapshots_date").on(t.date),
  ],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    pendingExternalId: text("pending_external_id"),
    date: text("date").notNull(),
    authorizedDate: text("authorized_date"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    description: text("description").notNull(),
    merchantName: text("merchant_name"),
    merchantKey: text("merchant_key").notNull(),
    logoUrl: text("logo_url"),
    website: text("website"),
    mcc: text("mcc"),
    providerCategory: text("provider_category"),
    providerCategoryDetailed: text("provider_category_detailed"),
    paymentChannel: text("payment_channel"),
    categoryId: text("category_id").notNull(),
    categorySource: text("category_source", {
      enum: ["user", "rule", "mcc", "provider", "inferred"],
    })
      .notNull()
      .default("provider"),
    pending: integer("pending", { mode: "boolean" }).notNull().default(false),
    notes: text("notes"),
    tags: text("tags", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    transferPairId: text("transfer_pair_id"),
    excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
    /** Balance after this transaction as reported by the institution, when it reports one. */
    runningBalanceCents: integer("running_balance_cents"),
    location: text("location", { mode: "json" }).$type<{
      city?: string;
      region?: string;
      lat?: number;
      lon?: number;
    }>(),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("tx_account_ext").on(t.accountId, t.externalId),
    index("tx_date").on(t.date),
    index("tx_account_date").on(t.accountId, t.date),
    index("tx_merchant").on(t.merchantKey),
    index("tx_category").on(t.categoryId),
  ],
);

/**
 * Rows a provider sent twice for one real movement: same account, day and
 * amount, with fewer counterparts on the other side than copies here. The
 * extra copy waits here, out of every total, and goes back into
 * `transactions` if its twin disappears or the user says it's real ("kept",
 * never hidden again).
 */
export const suppressedTransactions = sqliteTable(
  "suppressed_transactions",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    /** The copy that stayed. */
    twinExternalId: text("twin_external_id").notNull(),
    /** The hidden row as it was, to restore; null once kept. */
    row: text("row", { mode: "json" }).$type<
      typeof transactions.$inferSelect
    >(),
    status: text("status", { enum: ["hidden", "kept"] })
      .notNull()
      .default("hidden"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.externalId] })],
);

export const categoryRules = sqliteTable("category_rules", {
  id: text("id").primaryKey(),
  merchantKey: text("merchant_key"),
  descriptionContains: text("description_contains"),
  accountId: text("account_id"),
  minCents: integer("min_cents"),
  maxCents: integer("max_cents"),
  categoryId: text("category_id").notNull(),
  createdAt: text("created_at").notNull().default(now),
});

export const budgets = sqliteTable("budgets", {
  categoryId: text("category_id").primaryKey(),
  amountCents: integer("amount_cents").notNull(),
  /** Unspent (or overspent) amounts carry into the next month. */
  rollover: integer("rollover", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now),
});

/** Which catalog card an account is, when the user picked it (auto-identification needs no row). */
export const cardProfiles = sqliteTable("card_profiles", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  catalogId: text("catalog_id"),
  /** Cents per point the user values this card's points at (null = the program's cash floor). */
  pointValueCents: real("point_value_cents"),
  updatedAt: text("updated_at").notNull().default(now),
});

export const recurringOverrides = sqliteTable("recurring_overrides", {
  merchantKey: text("merchant_key").primaryKey(),
  state: text("state", { enum: ["hidden", "pinned"] }).notNull(),
  createdAt: text("created_at").notNull().default(now),
});

export const syncRuns = sqliteTable("sync_runs", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status", { enum: ["running", "ok", "error"] }).notNull(),
  added: integer("added").notNull().default(0),
  modified: integer("modified").notNull().default(0),
  removed: integer("removed").notNull().default(0),
  error: text("error"),
});

// --- Investments (populated from M3, schema present from the start so the
// sync engine has one shape to write to) --------------------------------------

export const securities = sqliteTable(
  "securities",
  {
    id: text("id").primaryKey(),
    externalId: text("external_id"),
    ticker: text("ticker"),
    name: text("name").notNull(),
    type: text("type"), // equity, etf, mutual fund, fixed income, cash, cryptocurrency, derivative, other
    cusip: text("cusip"),
    isin: text("isin"),
    isCashEquivalent: integer("is_cash_equivalent", { mode: "boolean" })
      .notNull()
      .default(false),
    closePrice: real("close_price"),
    closePriceAsOf: text("close_price_as_of"),
    sector: text("sector"),
    industry: text("industry"),
  },
  (t) => [
    uniqueIndex("securities_ext").on(t.externalId),
    index("securities_ticker").on(t.ticker),
  ],
);

export const holdings = sqliteTable(
  "holdings",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    securityId: text("security_id")
      .notNull()
      .references(() => securities.id),
    quantity: real("quantity").notNull(),
    priceCents: real("price_cents"), // sub-cent precision for share prices
    valueCents: integer("value_cents").notNull(),
    costBasisCents: integer("cost_basis_cents"),
    /** Stock plans: how much of the position has vested (null = not reported). */
    vestedQuantity: real("vested_quantity"),
    vestedValueCents: integer("vested_value_cents"),
    asOf: text("as_of").notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.securityId] })],
);

export const holdingSnapshots = sqliteTable(
  "holding_snapshots",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    securityId: text("security_id").notNull(),
    date: text("date").notNull(),
    quantity: real("quantity").notNull(),
    valueCents: integer("value_cents").notNull(),
    costBasisCents: integer("cost_basis_cents"),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.securityId, t.date] })],
);

export const investmentTransactions = sqliteTable(
  "investment_transactions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    securityId: text("security_id"),
    date: text("date").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(), // buy, sell, cash, fee, transfer, cancel
    subtype: text("subtype"), // dividend, contribution, sell to cover, ...
    quantity: real("quantity").notNull().default(0),
    priceCents: real("price_cents"),
    /** + cash into the account, − cash out (buys are negative) */
    amountCents: integer("amount_cents").notNull(),
    feesCents: integer("fees_cents"),
  },
  (t) => [
    uniqueIndex("itx_account_ext").on(t.accountId, t.externalId),
    index("itx_date").on(t.date),
    index("itx_security").on(t.securityId),
  ],
);

export const prices = sqliteTable(
  "prices",
  {
    securityId: text("security_id").notNull(),
    date: text("date").notNull(),
    closeCents: real("close_cents").notNull(),
    source: text("source").notNull(),
  },
  (t) => [primaryKey({ columns: [t.securityId, t.date] })],
);

// --- Liabilities -------------------------------------------------------------

export const liabilities = sqliteTable("liabilities", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  kind: text("kind", {
    enum: ["credit", "student", "mortgage", "auto", "personal", "other"],
  }).notNull(),
  aprPercent: real("apr_percent"),
  aprs: text("aprs", { mode: "json" }).$type<
    Array<{ type: string; percent: number; balanceCents?: number | null }>
  >(),
  lastStatementBalanceCents: integer("last_statement_balance_cents"),
  lastStatementDate: text("last_statement_date"),
  minimumPaymentCents: integer("minimum_payment_cents"),
  nextPaymentDueDate: text("next_payment_due_date"),
  lastPaymentCents: integer("last_payment_cents"),
  lastPaymentDate: text("last_payment_date"),
  isOverdue: integer("is_overdue", { mode: "boolean" }),
  originationDate: text("origination_date"),
  originationPrincipalCents: integer("origination_principal_cents"),
  termMonths: integer("term_months"),
  maturityDate: text("maturity_date"),
  paymentCents: integer("payment_cents"),
  updatedAt: text("updated_at").notNull().default(now),
});

/** Savings goals: a target, an optional date, and the accounts that fund it. */
export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  targetCents: integer("target_cents").notNull(),
  targetDate: text("target_date"),
  accountIds: text("account_ids", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  createdAt: text("created_at").notNull().default(now),
});

/** The alert inbox. `key` names the event, so the same thing is only raised once. */
export const alerts = sqliteTable(
  "alerts",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    severity: text("severity", { enum: ["info", "warning", "critical"] })
      .notNull()
      .default("info"),
    link: text("link"),
    date: text("date"),
    createdAt: text("created_at").notNull().default(now),
    readAt: text("read_at"),
  },
  (t) => [
    uniqueIndex("alerts_key").on(t.key),
    index("alerts_created").on(t.createdAt),
  ],
);

/** Saved monthly reviews: a record of the month as it looked when it closed. */
export const reviews = sqliteTable("reviews", {
  month: text("month").primaryKey(),
  data: text("data", { mode: "json" }).notNull(),
  summary: text("summary"),
  createdAt: text("created_at").notNull().default(now),
});

/** Every request Ikat sends to Claude, exactly as sent — the "what did Claude see?" record. */
export const aiLog = sqliteTable(
  "ai_log",
  {
    id: text("id").primaryKey(),
    kind: text("kind", {
      enum: ["ask", "review_summary", "suggest"],
    }).notNull(),
    question: text("question").notNull(),
    model: text("model").notNull(),
    system: text("system").notNull(),
    tools: text("tools", { mode: "json" })
      .$type<Array<{ name: string; description: string }>>()
      .notNull()
      .default(sql`'[]'`),
    /** The full message list of the last request, tool results included. */
    messages: text("messages", { mode: "json" }).notNull(),
    answer: text("answer"),
    usage: text("usage", { mode: "json" }).$type<{
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      requests: number;
    }>(),
    error: text("error"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("ai_log_created").on(t.createdAt)],
);

/** Browsers (phones) subscribed to push alerts. Lives with the real data. */
export const pushSubscriptions = sqliteTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: text("created_at").notNull().default(now),
  lastSentAt: text("last_sent_at"),
});

/** Claude's suggestions, waiting for a yes or no. Nothing is applied until accepted. */
export const aiSuggestions = sqliteTable(
  "ai_suggestions",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["fund_class", "merchant_name"] }).notNull(),
    /** The security id or merchant key it's about. */
    subject: text("subject").notNull(),
    label: text("label").notNull(),
    suggestion: text("suggestion", { mode: "json" }).notNull(),
    status: text("status", { enum: ["pending", "accepted", "dismissed"] })
      .notNull()
      .default("pending"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("ai_suggestions_subject").on(t.kind, t.subject)],
);

/** Asset mixes for funds Ikat's curated list doesn't know, confirmed by the user. */
export const securityClasses = sqliteTable("security_classes", {
  securityId: text("security_id").primaryKey(),
  mix: text("mix", { mode: "json" }).$type<Record<string, number>>().notNull(),
  expenseRatio: real("expense_ratio"),
  source: text("source", { enum: ["ai", "user"] }).notNull(),
  createdAt: text("created_at").notNull().default(now),
});
