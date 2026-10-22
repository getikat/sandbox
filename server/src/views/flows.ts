import { and, desc, eq, lte } from "drizzle-orm";
import type { ISODate } from "@ikat/core";
import { schema, type DB } from "../db";

type InvestmentTransaction = typeof schema.investmentTransactions.$inferSelect;

const CASH_FLOW_SUBTYPES = new Set([
  "contribution",
  "deposit",
  "withdrawal",
  "transfer",
  "distribution",
  "tax withheld",
]);

/**
 * Money moving into (+) or out of (−) an investment account — what
 * performance and "what moved net worth" must not count as market gain.
 * Institutions file the same movement differently: a deposit is `cash /
 * deposit` at one broker and `transfer / transfer` at Robinhood; shares
 * arriving from outside are a vest (`stock distribution` at the vest price, or
 * a $0 buy) or a broker-to-broker transfer (valued at that day's close).
 */
export function externalFlow(
  t: InvestmentTransaction,
  closeOn: (securityId: string, d: ISODate) => number | null,
): number {
  const atClose = () => {
    const price =
      t.priceCents ||
      (t.amountCents && t.quantity
        ? Math.abs(t.amountCents / t.quantity)
        : 0) ||
      closeOn(t.securityId!, t.date);
    return price ? Math.round(t.quantity * price) : 0;
  };
  // Units paid straight into a fund (a 401(k) contribution) carry their amount.
  if (t.type === "cash" && CASH_FLOW_SUBTYPES.has(t.subtype ?? ""))
    return t.amountCents;
  if (t.subtype === "stock distribution")
    return Math.round(t.quantity * (t.priceCents ?? 0));
  if (t.type === "transfer") {
    if (!t.securityId) return t.amountCents;
    // Shares in (+) or out (−), whatever sign the institution gave the amount.
    if (t.quantity) return atClose();
  }
  // Shares that arrive for nothing — an RSU vest landing in a brokerage
  // account ("YOU BOUGHT RSU####" at $0) — are new money in.
  if (
    t.type === "buy" &&
    t.securityId &&
    t.quantity > 0 &&
    !t.priceCents &&
    !t.amountCents
  )
    return atClose();
  return 0;
}

/** A security's last stored close on or before a day. */
export function closeLookup(
  db: DB,
): (securityId: string, d: ISODate) => number | null {
  return (securityId, d) =>
    db
      .select({ c: schema.prices.closeCents })
      .from(schema.prices)
      .where(
        and(
          eq(schema.prices.securityId, securityId),
          lte(schema.prices.date, d),
        ),
      )
      .orderBy(desc(schema.prices.date))
      .limit(1)
      .get()?.c ?? null;
}
