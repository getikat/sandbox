// Investment math and reference data, shared by server and browser.

import { diffDays, type ISODate } from "./dates";

export type AssetClass =
  | "us_stock"
  | "intl_stock"
  | "bonds"
  | "cash"
  | "real_estate"
  | "crypto"
  | "other"
  | "unclassified";

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  us_stock: "US stocks",
  intl_stock: "International stocks",
  bonds: "Bonds",
  cash: "Cash",
  real_estate: "Real estate",
  crypto: "Crypto",
  other: "Other",
  unclassified: "Unclassified",
};

export const ASSET_CLASS_ORDER: AssetClass[] = [
  "us_stock",
  "intl_stock",
  "bonds",
  "real_estate",
  "cash",
  "crypto",
  "other",
  "unclassified",
];

export type AssetMix = Partial<Record<AssetClass, number>>;

interface FundInfo {
  mix: AssetMix;
  /** Annual expense ratio, as a fraction (0.0003 = 0.03%). */
  expense?: number;
}

// A curated look-through for widely held funds: what each one actually holds,
// and what it costs. Deliberately limited to funds whose makeup is stable and
// public; anything else stays "unclassified" rather than guessed.
const US = { us_stock: 1 };
const INTL = { intl_stock: 1 };
const BONDS = { bonds: 1 };
const FUNDS: Record<string, FundInfo> = {
  // US total market / large cap
  VTI: { mix: US, expense: 0.0003 },
  VTSAX: { mix: US, expense: 0.0004 },
  VOO: { mix: US, expense: 0.0003 },
  VFIAX: { mix: US, expense: 0.0004 },
  SPY: { mix: US, expense: 0.000945 },
  IVV: { mix: US, expense: 0.0003 },
  SPLG: { mix: US, expense: 0.0002 },
  ITOT: { mix: US, expense: 0.0003 },
  SCHB: { mix: US, expense: 0.0003 },
  SCHX: { mix: US, expense: 0.0003 },
  FXAIX: { mix: US, expense: 0.00015 },
  FSKAX: { mix: US, expense: 0.00015 },
  FZROX: { mix: US, expense: 0 },
  FNILX: { mix: US, expense: 0 },
  SWTSX: { mix: US, expense: 0.0003 },
  SWPPX: { mix: US, expense: 0.0002 },
  QQQ: { mix: US, expense: 0.002 },
  QQQM: { mix: US, expense: 0.0015 },
  VUG: { mix: US, expense: 0.0004 },
  VTV: { mix: US, expense: 0.0004 },
  SCHD: { mix: US, expense: 0.0006 },
  VIG: { mix: US, expense: 0.0005 },
  VB: { mix: US, expense: 0.0005 },
  VO: { mix: US, expense: 0.0004 },
  IJH: { mix: US, expense: 0.0005 },
  IJR: { mix: US, expense: 0.0006 },
  IWM: { mix: US, expense: 0.0019 },
  RSP: { mix: US, expense: 0.002 },
  ARKK: { mix: US, expense: 0.0075 },
  VGT: { mix: US, expense: 0.001 },
  XLK: { mix: US, expense: 0.0009 },
  SMH: { mix: US, expense: 0.0035 },
  FSMAX: { mix: US, expense: 0.00035 },
  VIMAX: { mix: US, expense: 0.0005 },
  VSMAX: { mix: US, expense: 0.0005 },
  VONG: { mix: US, expense: 0.0007 },
  VYM: { mix: US, expense: 0.0006 },
  QUAL: { mix: US, expense: 0.0015 },
  SPMO: { mix: US, expense: 0.0013 },
  VITPX: { mix: US, expense: 0.0002 },
  // International
  VXUS: { mix: INTL, expense: 0.0005 },
  VTIAX: { mix: INTL, expense: 0.0009 },
  IXUS: { mix: INTL, expense: 0.0007 },
  VEA: { mix: INTL, expense: 0.0003 },
  VWO: { mix: INTL, expense: 0.0007 },
  IEFA: { mix: INTL, expense: 0.0007 },
  IEMG: { mix: INTL, expense: 0.0009 },
  EFA: { mix: INTL, expense: 0.0033 },
  FTIHX: { mix: INTL, expense: 0.0006 },
  FZILX: { mix: INTL, expense: 0 },
  FSPSX: { mix: INTL, expense: 0.00035 },
  SWISX: { mix: INTL, expense: 0.0006 },
  VTMGX: { mix: INTL, expense: 0.0005 },
  SCHF: { mix: INTL, expense: 0.0003 },
  FSGGX: { mix: INTL, expense: 0.00055 },
  AAXJ: { mix: INTL, expense: 0.007 },
  // Global
  VT: { mix: { us_stock: 0.63, intl_stock: 0.37 }, expense: 0.0006 },
  VTWAX: { mix: { us_stock: 0.63, intl_stock: 0.37 }, expense: 0.001 },
  // Bonds
  BND: { mix: BONDS, expense: 0.0003 },
  VBTLX: { mix: BONDS, expense: 0.0004 },
  AGG: { mix: BONDS, expense: 0.0003 },
  BNDX: { mix: BONDS, expense: 0.0007 },
  FXNAX: { mix: BONDS, expense: 0.00025 },
  SCHZ: { mix: BONDS, expense: 0.0003 },
  TLT: { mix: BONDS, expense: 0.0015 },
  SHY: { mix: BONDS, expense: 0.0015 },
  VGIT: { mix: BONDS, expense: 0.0004 },
  VTEB: { mix: BONDS, expense: 0.0005 },
  SGOV: { mix: { cash: 1 }, expense: 0.0009 },
  BIL: { mix: { cash: 1 }, expense: 0.00135 },
  TIP: { mix: BONDS, expense: 0.0018 },
  VTIP: { mix: BONDS, expense: 0.0004 },
  MUB: { mix: BONDS, expense: 0.0005 },
  // Real estate
  VNQ: { mix: { real_estate: 1 }, expense: 0.0013 },
  VGSLX: { mix: { real_estate: 1 }, expense: 0.0013 },
  SCHH: { mix: { real_estate: 1 }, expense: 0.0007 },
  // Money market / cash
  SPAXX: { mix: { cash: 1 }, expense: 0.0042 },
  FDRXX: { mix: { cash: 1 }, expense: 0.0033 },
  FZFXX: { mix: { cash: 1 }, expense: 0.0033 },
  VMFXX: { mix: { cash: 1 }, expense: 0.0011 },
  SWVXX: { mix: { cash: 1 }, expense: 0.0034 },
  VUSXX: { mix: { cash: 1 }, expense: 0.0009 },
  // Balanced / target date (approximate glide-path mixes)
  VBIAX: { mix: { us_stock: 0.6, bonds: 0.4 }, expense: 0.0007 },
  AOR: {
    mix: { us_stock: 0.35, intl_stock: 0.25, bonds: 0.4 },
    expense: 0.0015,
  },
  VFIFX: {
    mix: { us_stock: 0.54, intl_stock: 0.36, bonds: 0.1 },
    expense: 0.0008,
  },
  VFFVX: {
    mix: { us_stock: 0.54, intl_stock: 0.36, bonds: 0.1 },
    expense: 0.0008,
  },
  VTTSX: {
    mix: { us_stock: 0.54, intl_stock: 0.36, bonds: 0.1 },
    expense: 0.0008,
  },
  VTHRX: {
    mix: { us_stock: 0.4, intl_stock: 0.27, bonds: 0.33 },
    expense: 0.0008,
  },
  FDEWX: {
    mix: { us_stock: 0.54, intl_stock: 0.36, bonds: 0.1 },
    expense: 0.0012,
  },
  FDKLX: {
    mix: { us_stock: 0.54, intl_stock: 0.36, bonds: 0.1 },
    expense: 0.0012,
  },
};

/** Normalise provider tickers ("CUR:BTC" → "BTC"). */
export function baseTicker(ticker: string | null | undefined): string | null {
  if (!ticker) return null;
  return ticker.replace(/^CUR:/, "").toUpperCase();
}

/** An OCC option symbol: root, expiry (YYMMDD), call/put, strike × 1000 ("ABCD271217C00022000"). */
export const OPTION_SYMBOL =
  /^([A-Z.]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
const OCC = OPTION_SYMBOL;

/** A broker's core cash position, which some institutions report as a stock (Fidelity's FCASH). */
export function isCorePosition(ticker: string | null | undefined): boolean {
  return /^FCASH$/i.test(ticker ?? "");
}

/**
 * Some institutions type a company's own units as a fund ("Energy Transfer LP
 * - Unit" arrives as a mutual fund). A "fund" whose name reads like a company
 * and has no fund words in it is a stock.
 */
export function looksLikeCompany(name: string | null | undefined): boolean {
  if (!name) return false;
  if (
    /\b(fund|funds|etf|trust|index|idx|portfolio|shares? class|target|income|bond|treasury|municipal)\b/i.test(
      name,
    )
  )
    return false;
  return /\b(inc|corp|corporation|co|ltd|plc|lp|l\.p\.|llc|holdings?|group|partners)\b\.?/i.test(
    name,
  );
}

/** Options arrive as OCC symbols; "ABCD271217C00020000" reads as "ABCD 20C 12/17/27". */
export function displayTicker(
  ticker: string | null | undefined,
): string | null {
  const t = baseTicker(ticker);
  const m = t?.match(OCC);
  if (!m) return t;
  const strike = Number(m[6]) / 1000;
  return `${m[1]} ${strike}${m[5]} ${m[3]}/${m[4]}/${m[2]}`;
}

/**
 * What a security holds, by asset class. Order of evidence: the curated fund
 * list, then the provider's security type (a single stock is a stock, crypto is
 * crypto, a cash equivalent is cash). A fund we don't know stays unclassified.
 */

/**
 * How many shares one unit of a holding's quantity is. Market prices and
 * trades count option shares, but some institutions report option holdings
 * per contract (3 at $500 rather than 300 at $5.00); a standard contract is
 * 100 shares. Told apart by the holding's own price against the per-share close.
 */
export function sharesPerUnit(
  sec: { type: string | null; closePrice?: number | null },
  unitPriceCents: number | null | undefined,
): number {
  if (sec.type !== "derivative" || !sec.closePrice || !unitPriceCents) return 1;
  return unitPriceCents / 100 / sec.closePrice > 20 ? 100 : 1;
}

export function classifySecurity(sec: {
  ticker: string | null;
  type: string | null;
  isCashEquivalent?: boolean;
}): { mix: AssetMix; source: "curated" | "type" | "unknown" } {
  const t = baseTicker(sec.ticker);
  if (t && FUNDS[t]) return { mix: FUNDS[t]!.mix, source: "curated" };
  // Crypto first: some institutions flag coins as cash equivalents.
  if (sec.type === "cryptocurrency")
    return { mix: { crypto: 1 }, source: "type" };
  if (sec.isCashEquivalent || sec.type === "cash")
    return { mix: { cash: 1 }, source: "type" };
  if (sec.type === "equity") return { mix: { us_stock: 1 }, source: "type" };
  // An option's value is its premium, not a share of any asset class.
  if (sec.type === "derivative") return { mix: { other: 1 }, source: "type" };
  if (sec.type === "fixed income") return { mix: { bonds: 1 }, source: "type" };
  return { mix: { unclassified: 1 }, source: "unknown" };
}

export function expenseRatio(ticker: string | null | undefined): number | null {
  const t = baseTicker(ticker);
  return t && FUNDS[t]?.expense != null ? FUNDS[t]!.expense! : null;
}

// --- Returns ------------------------------------------------------------------

export interface CashFlow {
  date: ISODate;
  /** Money into the portfolio is positive (a contribution), out is negative. */
  cents: number;
}

/**
 * Time-weighted return: the investments' own performance, with the timing and
 * size of your deposits removed — the number comparable to a fund's return.
 * Daily sub-periods; a day's flow is treated as arriving at the end of it.
 */
export function timeWeightedReturn(
  values: Array<{ date: ISODate; cents: number }>,
  flows: CashFlow[],
): number | null {
  if (values.length < 2) return null;
  const flowOn = new Map<ISODate, number>();
  for (const f of flows)
    flowOn.set(f.date, (flowOn.get(f.date) ?? 0) + f.cents);
  let growth = 1;
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!.cents;
    if (prev <= 0) continue;
    const cur = values[i]!.cents - (flowOn.get(values[i]!.date) ?? 0);
    growth *= cur / prev;
  }
  return growth - 1;
}

/**
 * Money-weighted return (XIRR, annualised): *your* result, including when you
 * added money. Solved by Newton's method with a bisection fallback.
 */
export function xirr(flows: CashFlow[]): number | null {
  if (
    flows.length < 2 ||
    !flows.some((f) => f.cents > 0) ||
    !flows.some((f) => f.cents < 0)
  )
    return null;
  const t0 = flows[0]!.date;
  const years = flows.map((f) => diffDays(t0, f.date) / 365.25);
  const npv = (r: number) =>
    flows.reduce((s, f, i) => s + f.cents / (1 + r) ** years[i]!, 0);
  const d = (r: number) =>
    flows.reduce(
      (s, f, i) => s - (years[i]! * f.cents) / (1 + r) ** (years[i]! + 1),
      0,
    );
  let r = 0.08;
  for (let i = 0; i < 60; i++) {
    const v = npv(r);
    const dv = d(r);
    if (Math.abs(v) < 1e-6) return r;
    if (!dv) break;
    const next = r - v / dv;
    if (!Number.isFinite(next) || next <= -0.999) break;
    if (Math.abs(next - r) < 1e-10) return next;
    r = next;
  }
  // Bisection between -99% and +1000%.
  let lo = -0.99;
  let hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

// Award placeholders: unvested units a plan reports as a pseudo-security ("ACME.RSU", "Acme Rsu"). They aren't shares yet.
const AWARD_TICKER = /[.\-\s](RSUS?|PSUS?|UNVESTED|AWARDS?)$/i;
const AWARD_NAME =
  /\b(rsus?|psus?|unvested|restricted stock( units?)?|stock awards?)\b/i;

export function isAwardPlaceholder(sec: {
  ticker: string | null;
  name: string | null;
}): boolean {
  return AWARD_TICKER.test(sec.ticker ?? "") || AWARD_NAME.test(sec.name ?? "");
}
