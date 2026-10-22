import crypto from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  isAwardPlaceholder,
  merchantKey,
  prettifyMerchant,
  type ISODate,
  type Profile,
} from "@ikat/core";
import type { AppContext } from "../context";
import { categorize, type Rule } from "../categorize";
import { schema, type DB } from "../db";
import { DemoProvider } from "../providers/demo";
import { PlaidProvider } from "../providers/plaid";
import {
  ReauthRequired,
  type ConnectionRow,
  type Provider,
  type SyncResult,
} from "../providers/types";
import { dedupe } from "./duplicates";

export const MERCHANT_ALIASES = "merchants.aliases";
import {
  markMicroDeposits,
  pairTransfers,
  pairWithBrokerage,
} from "./transfers";
import { followMerchantCodes, loadMerchantCategories } from "../recategorize";

const id = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

export interface SyncSummary {
  connectionId: string;
  ok: boolean;
  added: number;
  modified: number;
  removed: number;
  error?: string;
}

/**
 * One write path for every provider. The whole connection's result is applied
 * in a single transaction, so a crash mid-sync never leaves accounts updated
 * but transactions half-written.
 */
export function applySyncResult(
  db: DB,
  conn: ConnectionRow,
  result: SyncResult,
  today: ISODate,
) {
  let added = 0;
  let modified = 0;
  let removed = 0;

  db.transaction((tx) => {
    // Connection metadata
    tx.update(schema.connections)
      .set({
        ...(result.institution
          ? {
              institutionId: result.institution.id,
              institutionName: result.institution.name,
              institutionLogo: result.institution.logo,
              institutionColor: result.institution.color,
            }
          : {}),
        cursor: result.transactions.cursor,
        ...(result.transactions.updateStatus
          ? { historyStatus: result.transactions.updateStatus }
          : {}),
        products: result.products,
        missingConsent: result.missingConsent,
        status: result.missingConsent.length ? "consent" : "ok",
        statusDetail: null,
        lastSyncedAt: nowIso(),
        lastAttemptAt: nowIso(),
      })
      .where(eq(schema.connections.id, conn.id))
      .run();

    // Accounts
    const existing = tx
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.connectionId, conn.id))
      .all();
    const byExt = new Map(existing.map((a) => [a.externalId, a]));
    const acctId = new Map<string, string>();
    const acctType = new Map<string, string>();
    const created = new Set<string>();
    for (const a of result.accounts) {
      const prev = byExt.get(a.externalId);
      const values = {
        name: a.name,
        officialName: a.officialName,
        mask: a.mask,
        type: a.type,
        subtype: a.subtype,
        currency: a.currency,
        currentCents: a.currentCents,
        availableCents: a.availableCents,
        limitCents: a.limitCents,
        balanceAsOf: nowIso(),
      };
      if (prev) {
        tx.update(schema.accounts)
          .set(values)
          .where(eq(schema.accounts.id, prev.id))
          .run();
        acctId.set(a.externalId, prev.id);
      } else {
        const newId = id();
        tx.insert(schema.accounts)
          .values({
            id: newId,
            connectionId: conn.id,
            externalId: a.externalId,
            ...values,
          })
          .run();
        acctId.set(a.externalId, newId);
        created.add(newId);
      }
      acctType.set(a.externalId, a.type);
    }

    // Transactions
    const rules = tx
      .select()
      .from(schema.categoryRules)
      .orderBy(desc(schema.categoryRules.createdAt))
      .all() as Rule[];
    // Merchant names you accepted (from Ask Ikat's suggestions) win over the descriptor's.
    const aliases = (tx
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, MERCHANT_ALIASES))
      .get()?.value ?? {}) as Record<string, string>;
    const byMerchant = loadMerchantCategories(tx);
    // Copies hidden as provider duplicates stay hidden when they're re-sent.
    const hiddenCopies = new Set(
      tx
        .select({
          a: schema.suppressedTransactions.accountId,
          e: schema.suppressedTransactions.externalId,
        })
        .from(schema.suppressedTransactions)
        .where(eq(schema.suppressedTransactions.status, "hidden"))
        .all()
        .map((r) => `${r.a}|${r.e}`),
    );
    const upserts = [
      ...result.transactions.added,
      ...result.transactions.modified,
    ];
    for (const t of upserts) {
      const accountId = acctId.get(t.accountExternalId);
      if (!accountId || hiddenCopies.has(`${accountId}|${t.externalId}`))
        continue;
      const key = merchantKey(t.merchantName ?? t.description);
      const provider = {
        date: t.date,
        authorizedDate: t.authorizedDate,
        amountCents: t.amountCents,
        currency: t.currency,
        description: t.description,
        merchantName:
          aliases[key] ?? t.merchantName ?? prettifyMerchant(t.description),
        merchantKey: key,
        logoUrl: t.logoUrl,
        website: t.website,
        mcc: t.mcc,
        providerCategory: t.providerCategory,
        providerCategoryDetailed: t.providerCategoryDetailed,
        paymentChannel: t.paymentChannel,
        pending: t.pending,
        runningBalanceCents: t.runningBalanceCents,
        location: t.location,
        pendingExternalId: t.pendingExternalId,
        updatedAt: nowIso(),
      };
      const cat = categorize(
        {
          description: t.description,
          merchantKey: key,
          amountCents: t.amountCents,
          accountId,
          accountType: acctType.get(t.accountExternalId) ?? "",
          mcc: t.mcc,
          providerCategory: t.providerCategory,
          providerCategoryDetailed: t.providerCategoryDetailed,
          paymentChannel: t.paymentChannel,
          merchantCategory: t.mcc ? null : byMerchant.get(key),
        },
        rules,
      );

      const prev = tx
        .select()
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.accountId, accountId),
            eq(schema.transactions.externalId, t.externalId),
          ),
        )
        .get();
      if (prev) {
        // Only rewrite what the provider owns. A user's category, notes, tags
        // and exclusions survive every sync.
        tx.update(schema.transactions)
          .set({
            ...provider,
            ...(prev.categorySource === "user" || prev.transferPairId
              ? {}
              : { categoryId: cat.categoryId, categorySource: cat.source }),
          })
          .where(eq(schema.transactions.id, prev.id))
          .run();
        modified++;
        continue;
      }

      // A posted transaction replacing its pending version carries over
      // everything the user did to the pending one.
      let carried: Partial<typeof schema.transactions.$inferInsert> = {};
      if (t.pendingExternalId) {
        const pend = tx
          .select()
          .from(schema.transactions)
          .where(
            and(
              eq(schema.transactions.accountId, accountId),
              eq(schema.transactions.externalId, t.pendingExternalId),
            ),
          )
          .get();
        if (pend) {
          carried = {
            notes: pend.notes,
            tags: pend.tags,
            excluded: pend.excluded,
            ...(pend.categorySource === "user"
              ? { categoryId: pend.categoryId, categorySource: "user" as const }
              : {}),
          };
          tx.delete(schema.transactions)
            .where(eq(schema.transactions.id, pend.id))
            .run();
        }
      }
      tx.insert(schema.transactions)
        .values({
          id: id(),
          accountId,
          externalId: t.externalId,
          categoryId: cat.categoryId,
          categorySource: cat.source,
          ...provider,
          ...carried,
        })
        .run();
      added++;
    }

    const connAccountIds = [...acctId.values()];
    if (result.transactions.removed.length && connAccountIds.length) {
      const res = tx
        .delete(schema.transactions)
        .where(
          and(
            inArray(schema.transactions.accountId, connAccountIds),
            inArray(
              schema.transactions.externalId,
              result.transactions.removed,
            ),
          ),
        )
        .run();
      removed += res.changes;
      tx.delete(schema.suppressedTransactions)
        .where(
          and(
            inArray(schema.suppressedTransactions.accountId, connAccountIds),
            inArray(
              schema.suppressedTransactions.externalId,
              result.transactions.removed,
            ),
          ),
        )
        .run();
    }

    // Investments
    if (result.investments) {
      const secId = new Map<string, string>();
      for (const s of result.investments.securities) {
        const prev = tx
          .select()
          .from(schema.securities)
          .where(eq(schema.securities.externalId, s.externalId))
          .get();
        const values = {
          ticker: s.ticker,
          name: s.name,
          type: s.type,
          cusip: s.cusip,
          isin: s.isin,
          isCashEquivalent: s.isCashEquivalent,
          closePrice: s.closePrice,
          closePriceAsOf: s.closePriceAsOf,
          sector: s.sector,
          industry: s.industry,
        };
        if (prev) {
          tx.update(schema.securities)
            .set(values)
            .where(eq(schema.securities.id, prev.id))
            .run();
          secId.set(s.externalId, prev.id);
        } else {
          const newId = id();
          tx.insert(schema.securities)
            .values({ id: newId, externalId: s.externalId, ...values })
            .run();
          secId.set(s.externalId, newId);
        }
      }
      const investAccounts = result.accounts
        .filter((a) => a.type === "investment")
        .map((a) => acctId.get(a.externalId)!);
      if (investAccounts.length)
        tx.delete(schema.holdings)
          .where(inArray(schema.holdings.accountId, investAccounts))
          .run();
      for (const h of result.investments.holdings) {
        const accountId = acctId.get(h.accountExternalId);
        const securityId = secId.get(h.securityExternalId);
        if (!accountId || !securityId) continue;
        const row = {
          accountId,
          securityId,
          quantity: h.quantity,
          priceCents: h.price != null ? h.price * 100 : null,
          valueCents: h.valueCents,
          costBasisCents: h.costBasisCents,
          vestedQuantity: h.vestedQuantity ?? null,
          vestedValueCents: h.vestedValueCents ?? null,
        };
        tx.insert(schema.holdings)
          .values({ ...row, asOf: today })
          .run();
        tx.insert(schema.holdingSnapshots)
          .values({
            accountId,
            securityId,
            date: today,
            quantity: h.quantity,
            valueCents: h.valueCents,
            costBasisCents: h.costBasisCents,
          })
          .onConflictDoUpdate({
            target: [
              schema.holdingSnapshots.accountId,
              schema.holdingSnapshots.securityId,
              schema.holdingSnapshots.date,
            ],
            set: {
              quantity: h.quantity,
              valueCents: h.valueCents,
              costBasisCents: h.costBasisCents,
            },
          })
          .run();
      }
      // A new account holding nothing but unvested awards starts outside net
      // worth: units aren't shares until they vest. The user can include it.
      const bySec = new Map(
        result.investments.securities.map((x) => [x.externalId, x]),
      );
      for (const accountId of created) {
        const held = result.investments.holdings.filter(
          (h) => acctId.get(h.accountExternalId) === accountId,
        );
        if (
          held.length &&
          held.every((h) => {
            const sec = bySec.get(h.securityExternalId);
            return !!sec && isAwardPlaceholder(sec);
          })
        ) {
          tx.update(schema.accounts)
            .set({ includeInNetWorth: false })
            .where(eq(schema.accounts.id, accountId))
            .run();
        }
      }
      for (const t of result.investments.transactions) {
        const accountId = acctId.get(t.accountExternalId);
        if (!accountId) continue;
        const values = {
          securityId: t.securityExternalId
            ? (secId.get(t.securityExternalId) ?? null)
            : null,
          date: t.date,
          name: t.name,
          type: t.type,
          subtype: t.subtype,
          quantity: t.quantity,
          priceCents: t.price != null ? t.price * 100 : null,
          amountCents: t.amountCents,
          feesCents: t.feesCents,
        };
        tx.insert(schema.investmentTransactions)
          .values({ id: id(), accountId, externalId: t.externalId, ...values })
          .onConflictDoUpdate({
            target: [
              schema.investmentTransactions.accountId,
              schema.investmentTransactions.externalId,
            ],
            set: values,
          })
          .run();
      }
      if (result.history?.prices.length) {
        for (const p of result.history.prices) {
          const securityId = secId.get(p.securityExternalId);
          if (!securityId) continue;
          tx.insert(schema.prices)
            .values({
              securityId,
              date: p.date,
              closeCents: p.close * 100,
              source: "demo",
            })
            .onConflictDoNothing()
            .run();
        }
      }
    }

    // Liabilities
    for (const l of result.liabilities ?? []) {
      const accountId = acctId.get(l.accountExternalId);
      if (!accountId) continue;
      const { accountExternalId: _ext, ...values } = l;
      tx.insert(schema.liabilities)
        .values({ accountId, ...values, updatedAt: nowIso() })
        .onConflictDoUpdate({
          target: schema.liabilities.accountId,
          set: { ...values, updatedAt: nowIso() },
        })
        .run();
    }

    // Balance history. Today's observation always wins; provider-supplied
    // history (demo only) never overwrites something already recorded.
    for (const s of result.history?.snapshots ?? []) {
      const accountId = acctId.get(s.accountExternalId);
      if (!accountId || s.date === today) continue;
      tx.insert(schema.balanceSnapshots)
        .values({
          accountId,
          date: s.date,
          currentCents: s.currentCents,
          availableCents: s.availableCents,
        })
        .onConflictDoNothing()
        .run();
    }
    for (const a of result.accounts) {
      const accountId = acctId.get(a.externalId)!;
      // No balance reported (an imported CSV): nothing observed, nothing recorded.
      if (a.currentCents == null && a.availableCents == null) continue;
      tx.insert(schema.balanceSnapshots)
        .values({
          accountId,
          date: today,
          currentCents: a.currentCents,
          availableCents: a.availableCents,
        })
        .onConflictDoUpdate({
          target: [
            schema.balanceSnapshots.accountId,
            schema.balanceSnapshots.date,
          ],
          set: {
            currentCents: a.currentCents,
            availableCents: a.availableCents,
            recordedAt: nowIso(),
          },
        })
        .run();
    }
  });

  return { added, modified, removed };
}

/** Serialises syncs: a second request while one runs joins the running one. */
export class SyncEngine {
  private running: Promise<SyncSummary[]> | null = null;
  private demo: DemoProvider;

  constructor(private ctx: AppContext) {
    this.demo = new DemoProvider(() => this.demoAnchor());
  }

  get syncing(): boolean {
    return this.running !== null;
  }

  demoAnchor(): ISODate {
    const db = this.ctx.store.db("demo");
    const row = db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, "demo.anchor"))
      .get();
    return (row?.value as string) ?? this.ctx.today();
  }

  private providerFor(conn: ConnectionRow): Provider {
    if (conn.provider === "demo") return this.demo;
    if (conn.provider === "plaid") {
      if (!this.ctx.plaid) throw new Error("Plaid is not configured");
      return new PlaidProvider(this.ctx.plaid);
    }
    throw new Error(`No provider for ${conn.provider}`);
  }

  /**
   * Sync every connection of the active profile. `force` ignores the
   * once-a-day throttle (the throttle exists to respect Plaid's call budget).
   */
  syncAll(
    opts: { force?: boolean; profile?: Profile } = {},
  ): Promise<SyncSummary[]> {
    if (this.running) return this.running;
    this.running = this.run(opts).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run({
    force = false,
    profile,
  }: {
    force?: boolean;
    profile?: Profile;
  }): Promise<SyncSummary[]> {
    const db = this.ctx.store.db(profile);
    const today = this.ctx.today();
    const conns = db.select().from(schema.connections).all();
    const out: SyncSummary[] = [];
    for (const conn of conns) {
      if (conn.provider === "manual") {
        carryManualValues(db, conn.id, today);
        continue;
      }
      if (conn.provider === "file") continue;
      if (!force && !dueForSync(conn, today)) continue;
      out.push(await this.syncOne(db, conn, today));
    }
    if (out.length) {
      dedupe(db);
      pairTransfers(db);
      pairWithBrokerage(db);
      markMicroDeposits(db);
      followMerchantCodes(db);
    }
    return out;
  }

  async syncOne(
    db: DB,
    conn: ConnectionRow,
    today: ISODate,
  ): Promise<SyncSummary> {
    const runId = id();
    db.insert(schema.syncRuns)
      .values({
        id: runId,
        connectionId: conn.id,
        startedAt: nowIso(),
        status: "running",
      })
      .run();
    try {
      const token = conn.accessTokenEnc
        ? this.ctx.secrets.decrypt(conn.accessTokenEnc)
        : null;
      const result = await this.providerFor(conn).sync(conn, token, today);
      const counts = applySyncResult(db, conn, result, today);
      // A fresh link's payments should find their other halves right away.
      dedupe(db);
      pairTransfers(db);
      pairWithBrokerage(db);
      markMicroDeposits(db);
      followMerchantCodes(db);
      db.update(schema.syncRuns)
        .set({ finishedAt: nowIso(), status: "ok", ...counts })
        .where(eq(schema.syncRuns.id, runId))
        .run();
      return { connectionId: conn.id, ok: true, ...counts };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A failed sync never writes a snapshot: a missing day is forward-filled
      // honestly, while a wrong one could never be corrected.
      db.update(schema.connections)
        .set({
          status: err instanceof ReauthRequired ? "reauth" : "error",
          statusDetail: message,
          lastAttemptAt: nowIso(),
        })
        .where(eq(schema.connections.id, conn.id))
        .run();
      db.update(schema.syncRuns)
        .set({ finishedAt: nowIso(), status: "error", error: message })
        .where(eq(schema.syncRuns.id, runId))
        .run();
      if (!this.ctx.config.isTest)
        console.error(`[sync] ${conn.institutionName}: ${message}`);
      return {
        connectionId: conn.id,
        ok: false,
        added: 0,
        modified: 0,
        removed: 0,
        error: message,
      };
    }
  }
}

/**
 * Once a day normally (Plaid's call budget). A fresh link whose history is
 * still arriving is checked hourly for its first three days, so a re-link's
 * two years of transactions show up within the hour, not tomorrow.
 */
function dueForSync(conn: ConnectionRow, today: ISODate): boolean {
  if (!conn.lastSyncedAt) return true;
  if (syncedOn(conn.lastSyncedAt) !== today) return true;
  const fresh = Date.now() - Date.parse(conn.createdAt) < 3 * 86_400_000;
  const incomplete =
    conn.provider === "plaid" &&
    conn.historyStatus !== "HISTORICAL_UPDATE_COMPLETE";
  return (
    fresh &&
    incomplete &&
    Date.now() - Date.parse(conn.lastSyncedAt) > 55 * 60_000
  );
}

/** The local calendar date a sync timestamp fell on. */
function syncedOn(iso: string): ISODate {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * A value you gave stands until you change it, so each day records it again —
 * the history shows it as observed rather than carried forward.
 */
export function carryManualValues(
  db: DB,
  connectionId: string,
  today: ISODate,
) {
  for (const a of db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.connectionId, connectionId))
    .all()) {
    if (a.currentCents == null) continue;
    db.insert(schema.balanceSnapshots)
      .values({ accountId: a.id, date: today, currentCents: a.currentCents })
      .onConflictDoNothing()
      .run();
  }
}
