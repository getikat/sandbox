import { asc, lte } from "drizzle-orm";
import {
  addDays,
  diffDays,
  eachDay,
  groupFor,
  isLiability,
  minDate,
  sharesPerUnit,
  type AccountGroup,
  type ISODate,
  type NetWorthBreak,
  type NetWorthChange,
  type NetWorthPoint,
  type NetWorthSeriesDTO,
} from "@ikat/core";
import { schema, type DB } from "../db";
import { displayNames, loadAccountRows } from "./accounts";
import { closeLookup, externalFlow } from "./flows";

// Net worth history, per account, per day.
//
// Observed points are daily snapshots — the only record Plaid allows, because
// it has no balance-history API. Before an account's first snapshot we try to
// *estimate*: walk the balance back through its transactions (cash, cards,
// loans), or rebuild holdings from investment transactions and price them.
// An estimate is only shown if the same walk reproduces the account's own
// observed snapshots; an account that fails that check contributes nothing
// before its first observation, and its arrival is marked as a break.

const HISTORY_DAYS = 730;
const VALIDATE_DAYS = 60;
/** Fewer observed days than this can't tell a real method from a flat line. */
const MIN_VALIDATION_DAYS = 14;
const MAX_ERROR_RATIO = 0.03;
/** Arrivals smaller than this (and than 1% of net worth) are not breaks. */
const MIN_BREAK_CENTS = 50_000;
/**
 * A rebuilt gap between two snapshots must land this close to the earlier
 * one (share of the account's value, plus a small fixed slack for the hour
 * of the day each snapshot was taken).
 */
const GAP_TOLERANCE = 0.01;
const GAP_SLACK_CENTS = 2_500;

export interface AccountSeries {
  id: string;
  name: string;
  group: AccountGroup;
  liability: boolean;
  /** date → signed contribution to net worth (cents) */
  values: Map<ISODate, number>;
  /** Days whose value is carried across a stretch with no snapshot. */
  carried: Set<ISODate>;
  /** Days between two snapshots whose value was rebuilt (and checked against both). */
  rebuilt: Set<ISODate>;
  observedFrom: ISODate | null;
  estimated: boolean;
}

type Snapshot = { date: ISODate; cents: number };

const minOf = (a: ISODate | undefined, b: ISODate | undefined) =>
  a && b ? minDate(a, b) : (a ?? b);

/** Days a value may be carried forward before it stops counting as observed. */
const CARRY_DAYS = 2;

/**
 * Forward-fill observed snapshots across [from, to]; missing leading days stay
 * unset. Days more than CARRY_DAYS past the last real snapshot are reported
 * in `carried`: the value is a placeholder, not an observation.
 */
function forwardFill(
  snaps: Snapshot[],
  from: ISODate,
  to: ISODate,
): { values: Map<ISODate, number>; carried: Set<ISODate> } {
  const values = new Map<ISODate, number>();
  const carried = new Set<ISODate>();
  const byDate = new Map(snaps.map((s) => [s.date, s.cents]));
  let last: number | null = null;
  let lastDate: ISODate | null = null;
  for (const d of eachDay(from, to)) {
    const v = byDate.get(d);
    if (v != null) {
      last = v;
      lastDate = d;
    }
    if (last == null) continue;
    values.set(d, last);
    if (lastDate && d > addDays(lastDate, CARRY_DAYS)) carried.add(d);
  }
  return { values, carried };
}

/**
 * Walk a balance backward from an anchor: for assets bal(d−1) = bal(d) − Σd,
 * for liabilities owed(d−1) = owed(d) + Σd (Ikat sign: + in, − out).
 */
function walkBack(
  anchorDate: ISODate,
  anchorCents: number,
  until: ISODate,
  flows: Map<ISODate, number>,
  liability: boolean,
) {
  const out = new Map<ISODate, number>();
  let bal = anchorCents;
  out.set(anchorDate, bal);
  for (let d = anchorDate; d > until;) {
    const f = flows.get(d) ?? 0;
    bal = liability ? bal + f : bal - f;
    d = addDays(d, -1);
    out.set(d, bal);
  }
  return out;
}

/** Balance lags tried (days): 0 = the snapshot is that evening's balance. */
const LAGS = [0, 1, 2];

/** How far a snapshot's balance is from what the transactions between p and q say (for a lag at each end). */
function lagError(
  p: Snapshot,
  q: Snapshot,
  lagP: number,
  lagQ: number,
  flows: Map<ISODate, number>,
  liability: boolean,
): number {
  let moved = 0;
  for (
    let d = addDays(p.date, 1 - lagP);
    d <= addDays(q.date, -lagQ);
    d = addDays(d, 1)
  )
    moved += flows.get(d) ?? 0;
  return Math.abs(q.cents - p.cents - (liability ? -moved : moved));
}

/**
 * Institutions differ in when a balance is "as of": Chase's current balance
 * on a given day is the previous evening's, and a snapshot taken before the
 * overnight posting can be two days behind. An account's lag is the one that
 * best explains most of its consecutive snapshots (ties go to the smaller).
 */
function balanceLag(
  snaps: Snapshot[],
  flows: Map<ISODate, number>,
  liability: boolean,
): number {
  const votes = new Map<number, number>();
  for (let i = 1; i < snaps.length; i++) {
    const errs = LAGS.map((lag) =>
      lagError(snaps[i - 1]!, snaps[i]!, lag, lag, flows, liability),
    );
    const best = LAGS[errs.indexOf(Math.min(...errs))]!;
    votes.set(best, (votes.get(best) ?? 0) + 1);
  }
  let lag = 0;
  for (const l of LAGS)
    if ((votes.get(l) ?? 0) > (votes.get(lag) ?? 0)) lag = l;
  return lag;
}

/** Re-key a series of end-of-day balances to the days their snapshots would carry them. */
function shift(m: Map<ISODate, number>, days: number): Map<ISODate, number> {
  return days ? new Map([...m].map(([d, v]) => [addDays(d, days), v])) : m;
}

function errorRatio(est: Map<ISODate, number>, observed: Snapshot[]): number {
  let err = 0;
  let mag = 0;
  let n = 0;
  for (const s of observed) {
    const e = est.get(s.date);
    if (e == null) continue;
    err += Math.abs(e - s.cents);
    mag += Math.abs(s.cents);
    n++;
  }
  if (!n) return Infinity;
  return err / n / Math.max(mag / n, 10_000);
}

/**
 * Every account's daily value (signed: liabilities negative), observed where
 * snapshots exist and estimated before that where the estimate validates.
 * `includeExcluded` also returns accounts left out of net worth (for their own
 * detail pages).
 */
export function accountSeries(
  db: DB,
  today: ISODate,
  opts: { includeExcluded?: boolean } = {},
): AccountSeries[] {
  const rows = loadAccountRows(db).filter(
    (r) => (opts.includeExcluded || r.includeInNetWorth) && !r.closedAt,
  );
  const names = displayNames(rows);
  const start = addDays(today, -HISTORY_DAYS);

  const allSnaps = db
    .select()
    .from(schema.balanceSnapshots)
    .orderBy(asc(schema.balanceSnapshots.date))
    .all();
  const snapsByAcct = new Map<string, Snapshot[]>();
  for (const s of allSnaps) {
    if (s.currentCents == null) continue;
    const list = snapsByAcct.get(s.accountId) ?? [];
    list.push({ date: s.date, cents: s.currentCents });
    snapsByAcct.set(s.accountId, list);
  }

  // Daily net flows per account, keyed on the day the balance moved
  // (authorization date where known — card balances move at authorization).
  const txs = db
    .select({
      accountId: schema.transactions.accountId,
      date: schema.transactions.date,
      authorizedDate: schema.transactions.authorizedDate,
      amount: schema.transactions.amountCents,
      pending: schema.transactions.pending,
    })
    .from(schema.transactions)
    .all();
  const flows = new Map<string, Map<ISODate, number>>();
  const firstTxn = new Map<string, ISODate>();
  const connOf = new Map(rows.map((r) => [r.id, r.connectionId]));
  const connFirstTxn = new Map<string, ISODate>();
  for (const t of txs) {
    const d = t.authorizedDate ?? t.date;
    const m = flows.get(t.accountId) ?? new Map<ISODate, number>();
    m.set(d, (m.get(d) ?? 0) + t.amount);
    flows.set(t.accountId, m);
    if (!firstTxn.has(t.accountId) || d < firstTxn.get(t.accountId)!)
      firstTxn.set(t.accountId, d);
    const conn = connOf.get(t.accountId);
    if (conn && (!connFirstTxn.has(conn) || d < connFirstTxn.get(conn)!))
      connFirstTxn.set(conn, d);
  }

  // How far back each connection's investment activity reaches: before that,
  // a rebuild can't know what was bought or contributed.
  const connFirstItx = new Map<string, ISODate>();
  for (const t of db
    .select({
      accountId: schema.investmentTransactions.accountId,
      date: schema.investmentTransactions.date,
    })
    .from(schema.investmentTransactions)
    .all()) {
    const conn = connOf.get(t.accountId);
    if (conn && (!connFirstItx.has(conn) || t.date < connFirstItx.get(conn)!))
      connFirstItx.set(conn, t.date);
  }

  const invest = investmentEstimator(db, today, start);
  /** Values from `until` to the anchor snapshot, keyed by the day a snapshot would show them. */
  const rebuildBack = (
    r: (typeof rows)[number],
    lag: number,
    anchorDate: ISODate,
    anchorCents: number,
    until: ISODate,
  ) =>
    r.type === "investment"
      ? invest.hasHoldings(r.id)
        ? invest.estimate(r.id, anchorDate, anchorCents, until)
        : null
      : shift(
          walkBack(
            addDays(anchorDate, -lag),
            anchorCents,
            addDays(until, -lag),
            flows.get(r.id) ?? new Map(),
            isLiability(r.type),
          ),
          lag,
        );

  return rows.map((r): AccountSeries => {
    const liability = isLiability(r.type);
    const sign = liability ? -1 : 1;
    const group = groupFor(r.type, r.groupOverride as AccountGroup | null);
    const snaps = snapsByAcct.get(r.id) ?? [];
    const observedFrom = snaps[0]?.date ?? null;
    const values = new Map<ISODate, number>();
    let carried = new Set<ISODate>();
    const rebuilt = new Set<ISODate>();
    const lag =
      r.type === "investment"
        ? 0
        : balanceLag(snaps, flows.get(r.id) ?? new Map(), liability);

    // Observed era.
    if (observedFrom) {
      const filled = forwardFill(snaps, observedFrom, today);
      for (const [d, v] of filled.values) values.set(d, sign * v);
      carried = filled.carried;
    } else if (r.currentCents != null) {
      values.set(today, sign * r.currentCents);
    }

    // Gaps between snapshots (days Ikat wasn't running): rebuild back from the
    // later snapshot, and keep it only if it lands on the earlier one.
    for (let i = 1; i < snaps.length; i++) {
      const p = snaps[i - 1]!;
      const q = snaps[i]!;
      if (diffDays(p.date, q.date) <= CARRY_DAYS + 1) continue;
      // Each end may lag on its own (a snapshot taken before overnight posting).
      let best: { est: Map<ISODate, number>; err: number } | null = null;
      for (const lagQ of r.type === "investment" ? [0] : LAGS) {
        const est = rebuildBack(r, lagQ, q.date, q.cents, addDays(p.date, -2));
        for (const lagP of r.type === "investment" ? [0] : LAGS) {
          const atP = est?.get(addDays(p.date, lagQ - lagP));
          if (atP == null) continue;
          const err =
            Math.abs(atP - p.cents) + (lagP === lag && lagQ === lag ? 0 : 1);
          if (!best || err < best.err) best = { est: est!, err };
        }
      }
      if (
        !best ||
        best.err >
          Math.max(Math.abs(p.cents), Math.abs(q.cents)) * GAP_TOLERANCE +
            GAP_SLACK_CENTS
      )
        continue;
      for (let d = addDays(p.date, 1); d < q.date; d = addDays(d, 1)) {
        values.set(d, sign * best.est.get(d)!);
        carried.delete(d);
        rebuilt.add(d);
      }
    }

    // Estimated era, only if the method reproduces what we observed.
    let estimated = false;
    const anchorDate = observedFrom ?? today;
    const anchorCents = snaps[0]?.cents ?? r.currentCents;
    if (anchorCents != null && anchorDate > start) {
      let est: Map<ISODate, number> | null = null;
      let check: Map<ISODate, number> | null = null;
      const recent = snaps.slice(-VALIDATE_DAYS);
      if (r.type === "investment") {
        // No holdings means no idea what the account held — never a flat line —
        // and the rebuild stops where the connection's activity record does.
        const floor = connFirstItx.get(r.connectionId);
        est =
          floor && floor < anchorDate && invest.hasHoldings(r.id)
            ? invest.estimate(
                r.id,
                anchorDate,
                anchorCents,
                floor > start ? floor : start,
              )
            : null;
        check =
          est && recent.length > 1
            ? invest.estimate(
                r.id,
                recent.at(-1)!.date,
                recent.at(-1)!.cents,
                recent[0]!.date,
              )
            : null;
      } else {
        // How far back the walk may go. A quiet checking account still existed
        // before its first transaction — its balance was just steady — so it
        // can reach back as far as its connection's history does (bank or
        // brokerage: a new cash account at a broker walks back to $0 rather than
        // "joining" mid-period). A loan's first payment is the first evidence
        // it existed; walking further back would invent a loan before it was
        // taken out.
        const connFloor = minOf(
          connFirstTxn.get(r.connectionId),
          connFirstItx.get(r.connectionId),
        );
        const floor = r.type === "loan" ? firstTxn.get(r.id) : connFloor;
        est = floor
          ? rebuildBack(
              r,
              lag,
              anchorDate,
              anchorCents,
              floor > start ? floor : start,
            )
          : null;
        check =
          recent.length > 1
            ? rebuildBack(
                r,
                lag,
                recent.at(-1)!.date,
                recent.at(-1)!.cents,
                recent[0]!.date,
              )
            : null;
      }
      // Validate against the account's own observations when there are enough
      // of them to mean something. With too few, a transaction walk is still
      // trusted (every step is a real transaction); an investment rebuild is
      // trusted only because it is grounded in real holdings and prices.
      const enough = recent.length >= MIN_VALIDATION_DAYS;
      const trusted =
        enough && check
          ? errorRatio(check, recent) <= MAX_ERROR_RATIO
          : !!est && est.size > 1;
      if (est && trusted) {
        for (const [d, v] of est)
          if (d < anchorDate && d >= start) values.set(d, sign * v);
        estimated = true;
      }
    }
    // So far everything is keyed by the day the bank reported it. With a lag,
    // that's the previous evening's balance: re-key history to true dates (so a
    // month's end is its own last evening, matching its transactions) and let
    // today show the latest report.
    if (lag > 0 && values.size) {
      const trueValues = shift(values, -lag);
      const latest = trueValues.get(addDays(today, -lag));
      if (latest != null)
        for (let d = addDays(today, 1 - lag); d <= today; d = addDays(d, 1))
          trueValues.set(d, latest);
      const back = (set: Set<ISODate>) =>
        new Set([...set].map((d) => addDays(d, -lag)));
      return {
        id: r.id,
        name: names.get(r.id)!,
        group,
        liability,
        values: trueValues,
        carried: back(carried),
        rebuilt: back(rebuilt),
        observedFrom: observedFrom && addDays(observedFrom, -lag),
        estimated,
      };
    }
    return {
      id: r.id,
      name: names.get(r.id)!,
      group,
      liability,
      values,
      carried,
      rebuilt,
      observedFrom,
      estimated,
    };
  });
}

export function netWorthSeries(db: DB, today: ISODate): NetWorthSeriesDTO {
  const series = accountSeries(db, today);

  // Assemble daily points; a day's contributing set is every account with a value.
  const points: NetWorthPoint[] = [];
  const breaks: NetWorthBreak[] = [];
  let prevSet = new Set<string>();
  const firstDay = series.reduce<ISODate>((m, s) => {
    const first = [...s.values.keys()].sort()[0];
    return first ? minDate(m, first) : m;
  }, today);

  for (const d of eachDay(firstDay, today)) {
    const byGroup: Partial<Record<AccountGroup, number>> = {};
    let total = 0;
    let observed = true;
    let carriedAbs = 0;
    let allAbs = 0;
    const set = new Set<string>();
    for (const s of series) {
      const v = s.values.get(d);
      if (v == null) continue;
      set.add(s.id);
      total += v;
      allAbs += Math.abs(v);
      if (s.carried.has(d)) carriedAbs += Math.abs(v);
      byGroup[s.group] = (byGroup[s.group] ?? 0) + v;
      if (!s.observedFrom || d < s.observedFrom || s.rebuilt.has(d))
        observed = false;
    }
    // A day is "carried" when a tenth or more of the value wasn't actually seen.
    const carried = allAbs > 0 && carriedAbs / allAbs >= 0.1;
    if (!set.size) continue;
    if (points.length) {
      // A break is an arrival big enough to distort the line. Small ones
      // (a new savings account with $40) aren't marked; period changes are
      // like-for-like anyway, so they never count as growth either way.
      // An account arriving empty (a $0 brokerage) moves nothing and isn't named.
      const arrived = [...set].filter(
        (x) =>
          !prevSet.has(x) &&
          Math.abs(series.find((s) => s.id === x)!.values.get(d) ?? 0) >= 100,
      );
      const arrivedValue = arrived.reduce(
        (sum, x) =>
          sum + Math.abs(series.find((s) => s.id === x)!.values.get(d) ?? 0),
        0,
      );
      if (
        arrived.length &&
        arrivedValue >= Math.max(Math.abs(total) * 0.01, MIN_BREAK_CENTS)
      ) {
        breaks.push({
          date: d,
          accountsAdded: arrived.length,
          names: arrived.map((x) => series.find((s) => s.id === x)!.name),
          addedCents: arrivedValue,
        });
      }
    }
    prevSet = set;
    points.push({
      date: d,
      netWorthCents: total,
      byGroup,
      observed: observed && !carried,
      ...(carried ? { carried: true } : {}),
    });
  }

  return {
    points,
    breaks,
    comparableFrom: breaks.at(-1)?.date ?? points[0]?.date ?? null,
  };
}

/**
 * Rebuild an investment account's value on past days: undo each investment
 * transaction's quantity and cash effect walking backward from the anchor,
 * then price the holdings with the stored price history (a position no market
 * source prices — an expired option — at your own trade prices, moving from
 * one trade to the next). Stops at the first day a held security has neither.
 */
function investmentEstimator(db: DB, today: ISODate, start: ISODate) {
  const secs = new Map(
    db
      .select()
      .from(schema.securities)
      .all()
      .map((s) => [s.id, s]),
  );
  // Quantities in shares, as trades and prices count them.
  const holdingsBySecurity = new Map<string, Map<string, number>>();
  const heldRows = db.select().from(schema.holdings).all();
  for (const h of heldRows) {
    const m = holdingsBySecurity.get(h.accountId) ?? new Map<string, number>();
    const sec = secs.get(h.securityId);
    m.set(
      h.securityId,
      h.quantity * (sec ? sharesPerUnit(sec, h.priceCents) : 1),
    );
    holdingsBySecurity.set(h.accountId, m);
  }
  const itxs = db.select().from(schema.investmentTransactions).all();
  const priceRows = db
    .select()
    .from(schema.prices)
    .where(lte(schema.prices.date, today))
    .orderBy(asc(schema.prices.date))
    .all();
  const prices = new Map<string, Array<[ISODate, number]>>();
  for (const p of priceRows) {
    const list = prices.get(p.securityId) ?? [];
    list.push([p.date, p.closeCents]);
    prices.set(p.securityId, list);
  }
  // What each security traded at in your own accounts, for positions no
  // market source prices (an option that has since expired).
  // A 401(k) trust has no public price, but every contribution into it says
  // how many units the money bought — its price that day — and the holding
  // says today's.
  const tradePrices = new Map<string, Array<[ISODate, number]>>();
  const observe = (securityId: string, date: ISODate, priceCents: number) => {
    if (!(priceCents > 0)) return;
    const list = tradePrices.get(securityId) ?? [];
    list.push([date, priceCents]);
    tradePrices.set(securityId, list);
  };
  for (const t of itxs) {
    if (!t.securityId || !t.quantity) continue;
    observe(
      t.securityId,
      t.date,
      t.priceCents || Math.abs(t.amountCents / t.quantity),
    );
  }
  for (const h of heldRows) {
    const sec = secs.get(h.securityId);
    if (h.priceCents && sec)
      observe(
        h.securityId,
        h.asOf.slice(0, 10),
        h.priceCents / sharesPerUnit(sec, h.priceCents),
      );
  }
  for (const list of tradePrices.values())
    list.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  /** Index of the last entry dated ≤ d, or −1. */
  const lastAtOrBefore = (list: Array<[ISODate, number]>, d: ISODate) => {
    let lo = 0;
    let hi = list.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]![0] <= d) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  };
  const priceOn = (securityId: string, d: ISODate): number | null => {
    const sec = secs.get(securityId);
    if (sec?.isCashEquivalent) return 100;
    const list = prices.get(securityId);
    if (list?.length) {
      const i = lastAtOrBefore(list, d);
      return i >= 0 ? list[i]![1] : null;
    }
    // Unpriced: between your own trades, the price moves from one trade's to the next's.
    const trades = tradePrices.get(securityId);
    if (!trades?.length) return null;
    const i = lastAtOrBefore(trades, d);
    if (i < 0) return trades[0]![1];
    if (i === trades.length - 1) return trades[i]![1];
    const [d0, p0] = trades[i]!;
    const [d1, p1] = trades[i + 1]!;
    const span = diffDays(d0, d1);
    return span > 0 ? p0 + ((p1 - p0) * diffDays(d0, d)) / span : p0;
  };

  const estimate = (
    accountId: string,
    anchorDate: ISODate,
    anchorCents: number,
    until: ISODate = start,
  ): Map<ISODate, number> | null => {
    // Quantities as of the anchor: current holdings, rolled back to the anchor.
    const qty = new Map(holdingsBySecurity.get(accountId) ?? []);
    const byDate = new Map<ISODate, typeof itxs>();
    for (const t of itxs) {
      if (t.accountId !== accountId) continue;
      const list = byDate.get(t.date) ?? [];
      list.push(t);
      byDate.set(t.date, list);
    }
    const undo = (d: ISODate) => {
      let cash = 0;
      for (const t of byDate.get(d) ?? []) {
        // A contribution paid straight into a fund (Fidelity files it as cash /
        // contribution with the units bought) moves units, not cash.
        // Shares moved in or out (Fidelity puts their market value in the
        // amount) are likewise units, not cash.
        const inKind =
          (t.type === "cash" || t.type === "transfer") &&
          !!t.securityId &&
          !!t.quantity;
        if (t.securityId && (t.type !== "cash" || inKind))
          qty.set(t.securityId, (qty.get(t.securityId) ?? 0) - t.quantity);
        if (!inKind) cash += t.amountCents;
      }
      return cash;
    };
    for (let d = today; d > anchorDate; d = addDays(d, -1)) undo(d);

    const value = (d: ISODate): number | null => {
      let v = 0;
      for (const [sec, q] of qty) {
        if (Math.abs(q) < 1e-9) continue;
        const p = priceOn(sec, d);
        if (p == null) return null;
        v += q * p;
      }
      return Math.round(v);
    };
    const securitiesValue = value(anchorDate);
    if (securitiesValue == null) return null;
    let cash = anchorCents - securitiesValue;

    const out = new Map<ISODate, number>([[anchorDate, anchorCents]]);
    for (let d = anchorDate; d > until;) {
      cash -= undo(d);
      d = addDays(d, -1);
      const v = value(d);
      if (v == null) break;
      out.set(d, v + cash);
    }
    return out;
  };
  return {
    estimate,
    hasHoldings: (accountId: string) =>
      [...(holdingsBySecurity.get(accountId)?.keys() ?? [])].some(
        (sec) =>
          prices.has(sec) ||
          tradePrices.has(sec) ||
          secs.get(sec)?.isCashEquivalent,
      ),
  };
}

/**
 * What moved net worth between two dates, like-for-like: only accounts that
 * existed at both ends are compared, so linking an account is never growth.
 * Accounts that joined inside the period are listed, not silently dropped.
 * The drivers (market, contributions, cash, debt, other) sum exactly to the
 * change.
 */
export function netWorthChange(
  db: DB,
  today: ISODate,
  start: ISODate,
  end: ISODate = today,
): NetWorthChange | null {
  const series = accountSeries(db, today);
  const days = series.flatMap((s) => [...s.values.keys()]);
  if (!days.length) return null;
  const first = days.reduce((m, d) => (d < m ? d : m));
  const a = start < first ? first : start;
  const b = end > today ? today : end;

  const included = series.filter((s) => s.values.has(a) && s.values.has(b));
  const joined = series
    .filter(
      (s) =>
        !s.values.has(a) &&
        s.values.has(b) &&
        Math.abs(s.values.get(b)!) >= 100,
    )
    .map((s) => ({ name: s.name, date: [...s.values.keys()].sort()[0]! }));

  const byGroup: Partial<
    Record<AccountGroup, { startCents: number; endCents: number }>
  > = {};
  let startTotal = 0;
  let endTotal = 0;
  for (const s of included) {
    const va = s.values.get(a)!;
    const vb = s.values.get(b)!;
    startTotal += va;
    endTotal += vb;
    const g = (byGroup[s.group] ??= { startCents: 0, endCents: 0 });
    g.startCents += va;
    g.endCents += vb;
  }

  const investAccts = new Set(
    included.filter((s) => s.group === "investments").map((s) => s.id),
  );
  const closeOn = closeLookup(db);
  let contributions = 0;
  for (const t of db.select().from(schema.investmentTransactions).all()) {
    if (!investAccts.has(t.accountId) || t.date <= a || t.date > b) continue;
    contributions += externalFlow(t, closeOn);
  }

  const delta = (k: AccountGroup) =>
    (byGroup[k]?.endCents ?? 0) - (byGroup[k]?.startCents ?? 0);
  const change = endTotal - startTotal;
  const market = delta("investments") - contributions;
  const cash = delta("cash");
  const debt = delta("cards") + delta("loans");
  const fullEnd = series.reduce((sum, s) => sum + (s.values.get(b) ?? 0), 0);
  return {
    start: a,
    end: b,
    startCents: startTotal,
    endCents: endTotal,
    changeCents: change,
    marketCents: market,
    contributionsCents: contributions,
    cashCents: cash,
    debtPaydownCents: debt,
    otherCents: change - market - contributions - cash - debt,
    byGroup,
    joined,
    netWorthCents: fullEnd,
  };
}
