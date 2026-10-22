import { and, eq, isNull, sql } from "drizzle-orm";
import { categoryKind, diffDays } from "@ikat/core";
import type { DB } from "../db";
import { schema } from "../db";

const WINDOW_DAYS = 4;

/**
 * Money moving between your own accounts is not spending or income. It is
 * recognised by pairing — an outflow on one account and an inflow of exactly
 * the same amount on another within a few days — not by category alone,
 * because excluding a category wholesale throws away real payments (a car loan
 * is the most recurring thing most people have).
 *
 * Pairing requires a signal that the rows are transfer-shaped, so a $20 refund
 * never pairs with an unrelated $20 purchase: one side must already look like
 * a transfer/payment, or the inflow must land on a card or loan.
 */
export function pairTransfers(db: DB): number {
  const rows = db
    .select({
      id: schema.transactions.id,
      accountId: schema.transactions.accountId,
      date: schema.transactions.date,
      amount: schema.transactions.amountCents,
      categoryId: schema.transactions.categoryId,
      categorySource: schema.transactions.categorySource,
      providerCategory: schema.transactions.providerCategory,
      accountType: schema.accounts.type,
    })
    .from(schema.transactions)
    .innerJoin(
      schema.accounts,
      eq(schema.accounts.id, schema.transactions.accountId),
    )
    .where(
      and(
        isNull(schema.transactions.transferPairId),
        eq(schema.transactions.pending, false),
        eq(schema.transactions.excluded, false),
        isNull(schema.accounts.duplicateOf),
      ),
    )
    .all();

  const transferish = (r: (typeof rows)[number]) =>
    categoryKind(r.categoryId) === "transfer" ||
    r.categoryId === "loan_payment" ||
    /^(TRANSFER_|LOAN_PAYMENTS)/.test(r.providerCategory ?? "");

  const inflowsByAmount = new Map<number, typeof rows>();
  for (const r of rows) {
    if (r.amount <= 0) continue;
    const list = inflowsByAmount.get(r.amount) ?? [];
    list.push(r);
    inflowsByAmount.set(r.amount, list);
  }

  const used = new Set<string>();
  let paired = 0;
  const outflows = rows
    .filter((r) => r.amount < 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  db.transaction((tx) => {
    for (const out of outflows) {
      const candidates = inflowsByAmount.get(-out.amount);
      if (!candidates) continue;
      let best: (typeof rows)[number] | null = null;
      let bestGap = Infinity;
      for (const inf of candidates) {
        if (used.has(inf.id) || inf.accountId === out.accountId) continue;
        const gap = Math.abs(diffDays(out.date, inf.date));
        if (gap > WINDOW_DAYS) continue;
        const signal =
          transferish(out) ||
          transferish(inf) ||
          inf.accountType === "credit" ||
          inf.accountType === "loan";
        if (!signal) continue;
        if (gap < bestGap) {
          best = inf;
          bestGap = gap;
        }
      }
      if (!best) continue;
      used.add(best.id);
      paired++;
      const pairId = out.id;
      const toCard = best.accountType === "credit";
      const toLoan = best.accountType === "loan";
      // The outflow side of a loan payment stays an expense ("Loan payments"),
      // since it is real money leaving; only the loan-side inflow is internal.
      const outCategory = toCard
        ? "card_payment"
        : toLoan
          ? "loan_payment"
          : "transfer";
      const inCategory = toCard ? "card_payment" : "transfer";
      tx.update(schema.transactions)
        .set({
          transferPairId: pairId,
          ...(out.categorySource !== "user" &&
          categoryKind(out.categoryId) !== "transfer" &&
          !toLoan
            ? { categoryId: outCategory, categorySource: "inferred" as const }
            : {}),
        })
        .where(eq(schema.transactions.id, out.id))
        .run();
      tx.update(schema.transactions)
        .set({
          transferPairId: pairId,
          ...(best.categorySource !== "user" &&
          categoryKind(best.categoryId) !== "transfer"
            ? { categoryId: inCategory, categorySource: "inferred" as const }
            : {}),
        })
        .where(eq(schema.transactions.id, best.id))
        .run();
    }
  });
  return paired;
}

/**
 * Linking a bank by micro-deposits leaves two deposits under $1 and, days
 * later, a withdrawal of exactly their sum. They're a handshake, not income
 * or a bank fee. Rows the user categorised keep their category.
 */
export function markMicroDeposits(db: DB): number {
  const t = schema.transactions;
  const small = db
    .select()
    .from(t)
    .where(
      and(
        eq(t.pending, false),
        sql`abs(${t.amountCents}) < 200`,
        sql`${t.categorySource} != 'user'`,
      ),
    )
    .all();
  const byAccount = new Map<string, typeof small>();
  for (const r of small)
    byAccount.set(r.accountId, [...(byAccount.get(r.accountId) ?? []), r]);
  let marked = 0;
  db.transaction((tx) => {
    for (const rows of byAccount.values()) {
      const credits = rows.filter(
        (r) => r.amountCents > 0 && r.amountCents < 100,
      );
      for (const debit of rows.filter((r) => r.amountCents < 0)) {
        let pair: [typeof debit, typeof debit] | null = null;
        for (let i = 0; i < credits.length && !pair; i++)
          for (let j = i + 1; j < credits.length && !pair; j++) {
            const [a, b] = [credits[i]!, credits[j]!];
            const near = [a, b].every(
              (c) => Math.abs(diffDays(c.date, debit.date)) <= 7,
            );
            if (near && a.amountCents + b.amountCents === -debit.amountCents)
              pair = [a, b];
          }
        if (!pair) continue;
        for (const r of [...pair, debit]) {
          if (r.categoryId === "transfer") continue;
          tx.update(t)
            .set({ categoryId: "transfer", categorySource: "inferred" })
            .where(eq(t.id, r.id))
            .run();
          marked++;
        }
      }
    }
  });
  return marked;
}

const BROKERAGE_CASH_MOVES = new Set([
  "withdrawal",
  "deposit",
  "transfer",
  "contribution",
  "distribution",
]);

/**
 * Money between a bank and a brokerage shows up twice: as a bank transaction
 * and as the brokerage's own cash row, which lives with investment activity.
 * Pairing only bank rows missed it, so vest proceeds moved from a brokerage to
 * the bank read as income. A bank row matches a brokerage cash move of
 * the opposite amount within the window; the bank side becomes a transfer.
 */
export function pairWithBrokerage(db: DB): number {
  const t = schema.transactions;
  const accounts = new Map(
    db
      .select()
      .from(schema.accounts)
      .where(isNull(schema.accounts.duplicateOf))
      .all()
      .map((a) => [a.id, a]),
  );
  const bank = db
    .select()
    .from(t)
    .where(
      and(
        isNull(t.transferPairId),
        eq(t.pending, false),
        eq(t.excluded, false),
        sql`${t.categorySource} != 'user'`,
        sql`abs(${t.amountCents}) >= 100`,
      ),
    )
    .all()
    .filter(
      (r) =>
        accounts.has(r.accountId) &&
        accounts.get(r.accountId)!.type !== "investment",
    );
  const moves = db
    .select()
    .from(schema.investmentTransactions)
    .all()
    .filter(
      (m) =>
        accounts.has(m.accountId) &&
        m.amountCents &&
        ((m.type === "cash" && BROKERAGE_CASH_MOVES.has(m.subtype ?? "")) ||
          (m.type === "transfer" && !m.securityId)),
    );
  const byAmount = new Map<number, typeof moves>();
  for (const m of moves)
    byAmount.set(m.amountCents, [...(byAmount.get(m.amountCents) ?? []), m]);
  const paired = new Set(
    db
      .select({ p: t.transferPairId })
      .from(t)
      .where(sql`${t.transferPairId} like 'itx:%'`)
      .all()
      .map((r) => r.p!.slice(4)),
  );
  let n = 0;
  db.transaction((tx) => {
    for (const r of bank) {
      const match = (byAmount.get(-r.amountCents) ?? [])
        .filter(
          (m) =>
            !paired.has(m.id) &&
            Math.abs(diffDays(m.date, r.date)) <= WINDOW_DAYS,
        )
        .sort(
          (a, b) =>
            Math.abs(diffDays(a.date, r.date)) -
            Math.abs(diffDays(b.date, r.date)),
        )[0];
      if (!match) continue;
      paired.add(match.id);
      const keep = categoryKind(r.categoryId) === "transfer";
      tx.update(t)
        .set({
          transferPairId: `itx:${match.id}`,
          ...(keep
            ? {}
            : {
                categoryId:
                  r.amountCents < 0 ? "investment_transfer" : "transfer",
                categorySource: "inferred" as const,
              }),
        })
        .where(eq(t.id, r.id))
        .run();
      n++;
    }
  });
  return n;
}
