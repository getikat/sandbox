import { and, eq, isNull, min, or, sql } from "drizzle-orm";
import { categoryKind, diffDays, type ISODate } from "@ikat/core";
import { normalizeType } from "@ikat/core";
import { schema, type DB } from "../db";

/**
 * The same real account can arrive through two connections — someone links
 * an institution again, and the provider issues fresh account ids for the new
 * link. Counting both doubles net worth and every transaction. Accounts match
 * on institution + mask + type + subtype. The copy with the deeper history is
 * canonical — so a fresh re-link doesn't take over (and blank the feed) until
 * its own history has arrived — then the fuller connection, then the newest
 * link. The others are marked `duplicateOf`,
 * which removes them from every total and list. Re-evaluated after each sync,
 * so removing the newer connection brings the older copy back automatically.
 */
export function markDuplicates(db: DB): number {
  const rows = db
    .select({
      id: schema.accounts.id,
      mask: schema.accounts.mask,
      type: schema.accounts.type,
      subtype: schema.accounts.subtype,
      duplicateOf: schema.accounts.duplicateOf,
      connectionId: schema.accounts.connectionId,
      institutionId: schema.connections.institutionId,
      institutionName: schema.connections.institutionName,
      connectionCreated: schema.connections.createdAt,
    })
    .from(schema.accounts)
    .innerJoin(
      schema.connections,
      eq(schema.connections.id, schema.accounts.connectionId),
    )
    .all();

  // How far back each account's own record goes (bank or investment activity).
  const firstSeen = new Map<string, string>();
  for (const table of [
    schema.transactions,
    schema.investmentTransactions,
  ] as const) {
    for (const r of db
      .select({ id: table.accountId, first: min(table.date) })
      .from(table)
      .groupBy(table.accountId)
      .all()) {
      if (r.first && (!firstSeen.has(r.id) || r.first < firstSeen.get(r.id)!))
        firstSeen.set(r.id, r.first);
    }
  }
  const acctCount = new Map<string, number>();
  for (const r of rows)
    acctCount.set(r.connectionId, (acctCount.get(r.connectionId) ?? 0) + 1);
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.mask) continue;
    const key = [
      (r.institutionId || r.institutionName).toLowerCase(),
      r.mask,
      normalizeType(r.type),
      (r.subtype ?? "").toLowerCase(),
    ].join("|");
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const want = new Map<string, string | null>(rows.map((r) => [r.id, null]));
  for (const list of groups.values()) {
    const connections = new Set(list.map((r) => r.connectionId));
    if (connections.size < 2) continue;
    const deeper = (a: (typeof list)[number], b: (typeof list)[number]) => {
      const fa = firstSeen.get(a.id);
      const fb = firstSeen.get(b.id);
      if (fa && !fb) return -1;
      if (fb && !fa) return 1;
      // A few days' difference is noise between two links to the same bank.
      if (fa && fb && Math.abs(diffDays(fa, fb)) > 3) return fa < fb ? -1 : 1;
      return 0;
    };
    const canonical = [...list].sort(
      (a, b) =>
        deeper(a, b) ||
        (acctCount.get(b.connectionId) ?? 0) -
          (acctCount.get(a.connectionId) ?? 0) ||
        (a.connectionCreated < b.connectionCreated ? 1 : -1),
    )[0]!;
    for (const r of list)
      if (r.id !== canonical.id && r.connectionId !== canonical.connectionId)
        want.set(r.id, canonical.id);
  }

  const settings = new Map(
    db
      .select({
        id: schema.accounts.id,
        nickname: schema.accounts.nickname,
        includeInNetWorth: schema.accounts.includeInNetWorth,
        owner: schema.accounts.owner,
        groupOverride: schema.accounts.groupOverride,
        hidden: schema.accounts.hidden,
      })
      .from(schema.accounts)
      .all()
      .map((a) => [a.id, a]),
  );
  db.transaction((tx) => {
    for (const r of rows) {
      const next = want.get(r.id) ?? null;
      if (next !== r.duplicateOf)
        tx.update(schema.accounts)
          .set({ duplicateOf: next })
          .where(eq(schema.accounts.id, r.id))
          .run();
      if (!next) continue;
      // Settings the user gave the other copy (a nickname like "Sapphire
      // Reserve", leaving it out of net worth, who owns it) follow it — but
      // never overwrite a choice already made on the kept copy.
      const dup = settings.get(r.id)!;
      const keep = settings.get(next)!;
      const carry = {
        ...(dup.nickname && !keep.nickname ? { nickname: dup.nickname } : {}),
        ...(!dup.includeInNetWorth && keep.includeInNetWorth
          ? { includeInNetWorth: false }
          : {}),
        ...(dup.owner !== "me" && keep.owner === "me"
          ? { owner: dup.owner }
          : {}),
        ...(dup.groupOverride && !keep.groupOverride
          ? { groupOverride: dup.groupOverride }
          : {}),
        ...(dup.hidden && !keep.hidden ? { hidden: true } : {}),
      };
      if (Object.keys(carry).length) {
        tx.update(schema.accounts)
          .set(carry)
          .where(eq(schema.accounts.id, next))
          .run();
        Object.assign(keep, carry);
      }
      // The kept copy inherits the older copy's balance history, so linking
      // again never costs the days already recorded. Runs on every pass (not
      // only when first marked) so a retirement can never outrun the hand-off.
      tx.run(sql`
        insert or ignore into balance_snapshots (account_id, date, current_cents, available_cents, recorded_at)
        select ${next}, date, current_cents, available_cents, recorded_at from balance_snapshots where account_id = ${r.id}
      `);
    }
  });
  return rows.filter((r) => want.get(r.id)).length;
}

/**
 * A connection whose every account also arrives through a newer connection
 * contributes nothing but a second copy — so it is retired from Ikat: its
 * balance history has already been copied onto the kept accounts (above), and
 * the connection, its accounts and their transactions are removed, so nothing
 * is stored or synced twice. The link itself is left alone at the provider
 * (another app may still use it). Connections with any unique account stay,
 * with just their duplicate accounts hidden.
 */
export function retireRedundantConnections(db: DB): string[] {
  const accts = db
    .select({
      id: schema.accounts.id,
      connectionId: schema.accounts.connectionId,
      duplicateOf: schema.accounts.duplicateOf,
    })
    .from(schema.accounts)
    .all();
  const conns = new Map(
    db
      .select()
      .from(schema.connections)
      .all()
      .map((c) => [c.id, c]),
  );
  const connOf = new Map(accts.map((a) => [a.id, a.connectionId]));
  const byConn = new Map<
    string,
    { total: number; dup: number; newerThanKept: boolean }
  >();
  for (const a of accts) {
    const c = byConn.get(a.connectionId) ?? {
      total: 0,
      dup: 0,
      newerThanKept: false,
    };
    c.total++;
    if (a.duplicateOf) {
      c.dup++;
      // A fresh link that is (for now) the duplicate — its history is still
      // arriving — must never be retired; it takes over once it catches up.
      const kept = conns.get(connOf.get(a.duplicateOf) ?? "");
      if (kept && conns.get(a.connectionId)!.createdAt > kept.createdAt)
        c.newerThanKept = true;
    }
    byConn.set(a.connectionId, c);
  }
  const retired = [...byConn]
    .filter(([, c]) => c.total > 0 && c.dup === c.total && !c.newerThanKept)
    .map(([id]) => id);
  for (const id of retired) {
    carryEdits(db, id);
    db.delete(schema.connections).where(eq(schema.connections.id, id)).run();
  }
  return retired;
}

/**
 * Before a connection retires, anything the user did to its transactions
 * (category, notes, tags, exclusion) moves to the same transaction on the kept
 * copy: same amount, within two days, same merchant preferred. The provider
 * issues new transaction ids per link, so this is matched, not looked up.
 */
function carryEdits(db: DB, connectionId: string) {
  const t = schema.transactions;
  const accounts = db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.connectionId, connectionId))
    .all();
  db.transaction((tx) => {
    for (const acct of accounts) {
      if (!acct.duplicateOf) continue;
      const edited = tx
        .select()
        .from(t)
        .where(
          and(
            eq(t.accountId, acct.id),
            or(
              eq(t.categorySource, "user"),
              sql`${t.notes} is not null`,
              eq(t.excluded, true),
              sql`${t.tags} != '[]'`,
            ),
          ),
        )
        .all();
      if (!edited.length) continue;
      const pool = tx
        .select()
        .from(t)
        .where(
          and(
            eq(t.accountId, acct.duplicateOf),
            isNull(t.notes),
            eq(t.excluded, false),
          ),
        )
        .all();
      const used = new Set<string>();
      for (const e of edited) {
        const match = pool
          .filter(
            (c) =>
              !used.has(c.id) &&
              c.amountCents === e.amountCents &&
              Math.abs(diffDays(c.date, e.date)) <= 2,
          )
          .sort(
            (a, b) =>
              Number(b.merchantKey === e.merchantKey) -
                Number(a.merchantKey === e.merchantKey) ||
              Math.abs(diffDays(a.date, e.date)) -
                Math.abs(diffDays(b.date, e.date)),
          )[0];
        if (!match) continue;
        used.add(match.id);
        tx.update(t)
          .set({
            notes: e.notes,
            tags: e.tags,
            excluded: e.excluded,
            ...(e.categorySource === "user"
              ? { categoryId: e.categoryId, categorySource: "user" as const }
              : {}),
          })
          .where(eq(t.id, match.id))
          .run();
      }
    }
  });
}

/** Days either side of a copy that its counterpart may land on. */
const COUNTERPART_DAYS = 4;

/**
 * A provider sometimes reports one transfer twice under two descriptions
 * ("Transfer from Brokerage …4321" and "From Brokerage", same day and amount).
 * Both would count, and the account's history would walk back through money it
 * never had. Two real same-day transfers of the same amount are possible, so a
 * copy is only hidden on evidence: the other side of the movement — in your
 * other accounts, bank or brokerage — shows fewer matching rows than this
 * account does. Only transfer-shaped rows the user hasn't touched qualify.
 * Hidden copies move to `suppressed_transactions` and come back if their twin
 * disappears (the provider fixed it the other way). Runs after every sync.
 */
export function suppressProviderDuplicates(db: DB): {
  hidden: number;
  restored: number;
} {
  const t = schema.transactions;
  const s = schema.suppressedTransactions;
  let hidden = 0;
  let restored = 0;
  db.transaction((tx) => {
    // Restore copies whose twin is gone.
    const live = new Set(
      tx
        .select({ a: t.accountId, e: t.externalId })
        .from(t)
        .all()
        .map((r) => `${r.a}|${r.e}`),
    );
    for (const h of tx.select().from(s).where(eq(s.status, "hidden")).all()) {
      if (live.has(`${h.accountId}|${h.twinExternalId}`) || !h.row) continue;
      if (!live.has(`${h.accountId}|${h.externalId}`))
        tx.insert(t).values(h.row).run();
      tx.delete(s)
        .where(
          and(eq(s.accountId, h.accountId), eq(s.externalId, h.externalId)),
        )
        .run();
      restored++;
    }

    const kept = new Set(
      tx
        .select({ a: s.accountId, e: s.externalId })
        .from(s)
        .where(eq(s.status, "kept"))
        .all()
        .map((r) => `${r.a}|${r.e}`),
    );
    const accounts = new Map(
      tx
        .select()
        .from(schema.accounts)
        .where(isNull(schema.accounts.duplicateOf))
        .all()
        .map((a) => [a.id, a]),
    );
    const rows = tx
      .select()
      .from(t)
      .where(and(eq(t.pending, false), eq(t.excluded, false)))
      .all()
      .filter((r) => accounts.has(r.accountId));
    const transferish = (r: (typeof rows)[number]) =>
      categoryKind(r.categoryId) === "transfer" ||
      /^TRANSFER_/.test(r.providerCategory ?? "");
    const untouched = (r: (typeof rows)[number]) =>
      r.categorySource !== "user" &&
      r.notes == null &&
      !r.tags.length &&
      !kept.has(`${r.accountId}|${r.externalId}`);

    // Every movement by amount, for counting counterparts.
    const movements = new Map<
      number,
      Array<{ accountId: string; date: ISODate }>
    >();
    const addMovement = (accountId: string, date: ISODate, amount: number) => {
      if (!accounts.has(accountId)) return;
      const list = movements.get(amount) ?? [];
      list.push({ accountId, date });
      movements.set(amount, list);
    };
    for (const r of rows) addMovement(r.accountId, r.date, r.amountCents);
    for (const r of tx.select().from(schema.investmentTransactions).all())
      addMovement(r.accountId, r.date, r.amountCents);

    // Same account, same amount, within a day: one cluster.
    const byKey = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!transferish(r) || !untouched(r)) continue;
      const k = `${r.accountId}|${r.amountCents}`;
      const list = byKey.get(k) ?? [];
      list.push(r);
      byKey.set(k, list);
    }
    for (const list of byKey.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      for (let i = 0; i < list.length;) {
        let j = i + 1;
        while (j < list.length && diffDays(list[i]!.date, list[j]!.date) <= 1)
          j++;
        const cluster = list.slice(i, j);
        i = j;
        if (cluster.length < 2) continue;
        const { accountId, amountCents, date } = cluster[0]!;
        const counterparts = (movements.get(-amountCents) ?? []).filter(
          (m) =>
            m.accountId !== accountId &&
            Math.abs(diffDays(m.date, date)) <= COUNTERPART_DAYS,
        ).length;
        const extra = cluster.length - counterparts;
        if (!counterparts || extra < 1) continue;
        // Keep the paired copy, else the most descriptive one.
        cluster.sort(
          (a, b) =>
            Number(!!b.transferPairId) - Number(!!a.transferPairId) ||
            b.description.length - a.description.length ||
            (a.createdAt < b.createdAt ? -1 : 1),
        );
        const twin = cluster[0]!;
        for (const dup of cluster.slice(-extra)) {
          tx.insert(s)
            .values({
              accountId,
              externalId: dup.externalId,
              twinExternalId: twin.externalId,
              row: dup,
            })
            .onConflictDoNothing()
            .run();
          tx.delete(t).where(eq(t.id, dup.id)).run();
          if (dup.transferPairId)
            tx.update(t)
              .set({ transferPairId: null })
              .where(eq(t.transferPairId, dup.transferPairId))
              .run();
          hidden++;
        }
      }
    }
  });
  return { hidden, restored };
}

/**
 * Mark duplicate accounts, retire any connection that is nothing but
 * duplicates, then hide transactions a provider reported twice.
 */
export function dedupe(db: DB): {
  duplicates: number;
  retired: string[];
  hiddenTransactions: number;
} {
  const duplicates = markDuplicates(db);
  const retired = duplicates ? retireRedundantConnections(db) : [];
  const { hidden } = suppressProviderDuplicates(db);
  return { duplicates, retired, hiddenTransactions: hidden };
}
