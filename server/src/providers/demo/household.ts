import {
  addDays,
  dayOfMonth,
  dayOfWeek,
  diffDays,
  eachDay,
  endOfMonth,
  type Cents,
  type ISODate,
} from "@ikat/core";
import type {
  ProviderAccount,
  ProviderHolding,
  ProviderInvestmentTransaction,
  ProviderLiability,
  ProviderPrice,
  ProviderSecurity,
  ProviderSnapshot,
  ProviderTransaction,
} from "../types";
import { Rand, day } from "./random";

// The demo household: one person, a salaried job with RSUs, rent in the city,
// a car loan, four cards and seven investment accounts. It exists to exercise
// every feature with realistic texture — including the mistakes and edge cases
// the features are for: dining sometimes on the wrong card, a Netflix price
// increase, a rent renewal, a fund sitting on a loss (harvestable), RSU vests
// with sell-to-cover, a car loan whose terms must be inferred (auto loans come
// with a balance only, exactly like Plaid), and transfers to be paired.
//
// Everything is a pure function of (anchor, today). The anchor is fixed when
// the demo is created, so the same event always gets the same id and a sync
// tomorrow extends history rather than rewriting it.

export interface DemoInstitution {
  key: string;
  name: string;
  color: string;
  accounts: ProviderAccount[];
  transactions: ProviderTransaction[];
  removed: string[];
  snapshots: ProviderSnapshot[];
  holdings: ProviderHolding[];
  investmentTransactions: ProviderInvestmentTransaction[];
  liabilities: ProviderLiability[] | null;
  hasInvestments: boolean;
}

export interface DemoData {
  institutions: DemoInstitution[];
  securities: ProviderSecurity[];
  prices: ProviderPrice[];
}

// --- Market -------------------------------------------------------------------

interface SecDef {
  ticker: string;
  name: string;
  type: "etf" | "mutual fund" | "equity" | "cryptocurrency" | "cash";
  p0: number;
  mu: number;
  sigma: number;
  crypto?: boolean;
  /** An award placeholder: priced like this ticker, with no market data of its own. */
  aliasOf?: string;
}

const SECURITIES: SecDef[] = [
  {
    ticker: "FXAIX",
    name: "Fidelity 500 Index Fund",
    type: "mutual fund",
    p0: 172,
    mu: 0.12,
    sigma: 0.16,
  },
  {
    ticker: "FTIHX",
    name: "Fidelity Total International Index Fund",
    type: "mutual fund",
    p0: 13.1,
    mu: 0.07,
    sigma: 0.15,
  },
  {
    ticker: "FXNAX",
    name: "Fidelity U.S. Bond Index Fund",
    type: "mutual fund",
    p0: 10.2,
    mu: 0.02,
    sigma: 0.05,
  },
  {
    ticker: "FZROX",
    name: "Fidelity ZERO Total Market Index Fund",
    type: "mutual fund",
    p0: 16.4,
    mu: 0.11,
    sigma: 0.17,
  },
  {
    ticker: "VTI",
    name: "Vanguard Total Stock Market ETF",
    type: "etf",
    p0: 236,
    mu: 0.11,
    sigma: 0.17,
  },
  {
    ticker: "VXUS",
    name: "Vanguard Total International Stock ETF",
    type: "etf",
    p0: 57,
    mu: 0.06,
    sigma: 0.15,
  },
  {
    ticker: "BND",
    name: "Vanguard Total Bond Market ETF",
    type: "etf",
    p0: 72,
    mu: 0.015,
    sigma: 0.05,
  },
  {
    ticker: "ARKK",
    name: "ARK Innovation ETF",
    type: "etf",
    p0: 58,
    mu: -0.12,
    sigma: 0.42,
  },
  {
    ticker: "VTSAX",
    name: "Vanguard Total Stock Market Index Admiral",
    type: "mutual fund",
    p0: 112,
    mu: 0.11,
    sigma: 0.17,
  },
  {
    ticker: "NWND",
    name: "Northwind Labs, Inc.",
    type: "equity",
    p0: 64,
    mu: 0.28,
    sigma: 0.36,
  },
  {
    ticker: "NWND.RSU",
    name: "Northwind Labs RSU",
    type: "equity",
    p0: 64,
    mu: 0,
    sigma: 0,
    aliasOf: "NWND",
  },
  {
    ticker: "BTC",
    name: "Bitcoin",
    type: "cryptocurrency",
    p0: 43_000,
    mu: 0.4,
    sigma: 0.55,
    crypto: true,
  },
  {
    ticker: "ETH",
    name: "Ethereum",
    type: "cryptocurrency",
    p0: 2_300,
    mu: 0.18,
    sigma: 0.68,
    crypto: true,
  },
];

const SEC = Object.fromEntries(SECURITIES.map((s) => [s.ticker, s])) as Record<
  string,
  SecDef
>;
const secId = (ticker: string) => `demo-sec-${ticker}`;

/** Daily closes from `start`: geometric Brownian motion; flat on weekends for markets. */
function priceSeries(
  def: SecDef,
  start: ISODate,
  end: ISODate,
): Map<ISODate, number> {
  const out = new Map<ISODate, number>();
  const r = new Rand(`price:${def.ticker}`);
  let p = def.p0;
  const dt = 1 / 252;
  for (const d of eachDay(start, end)) {
    const dow = dayOfWeek(d);
    const trading = def.crypto || (dow !== 0 && dow !== 6);
    if (trading) {
      const step = def.crypto ? 1 / 365 : dt;
      p *= Math.exp(
        (def.mu - (def.sigma * def.sigma) / 2) * step +
          def.sigma * Math.sqrt(step) * r.normal(),
      );
    }
    out.set(d, Math.round(p * 100) / 100);
  }
  return out;
}

// --- Merchants ------------------------------------------------------------------

interface Merchant {
  name: string;
  desc: string;
  mcc: string | null;
  pfc: [string, string];
  channel?: "online" | "in store" | "other";
}

const m = (
  name: string,
  desc: string,
  mcc: string | null,
  primary: string,
  detailed: string,
  channel: Merchant["channel"] = "in store",
): Merchant => ({
  name,
  desc,
  mcc,
  pfc: [primary, detailed],
  channel,
});

const FD = "FOOD_AND_DRINK";
const MERCHANTS = {
  blueBottle: m(
    "Blue Bottle Coffee",
    "SQ *BLUE BOTTLE COFFEE",
    "5814",
    FD,
    "FOOD_AND_DRINK_COFFEE",
  ),
  starbucks: m(
    "Starbucks",
    "STARBUCKS STORE 08812",
    "5814",
    FD,
    "FOOD_AND_DRINK_COFFEE",
  ),
  philz: m(
    "Philz Coffee",
    "TST* PHILZ COFFEE - MISSION",
    "5814",
    FD,
    "FOOD_AND_DRINK_COFFEE",
  ),
  sweetgreen: m(
    "Sweetgreen",
    "SWEETGREEN HAYES VALLEY",
    "5814",
    FD,
    "FOOD_AND_DRINK_FAST_FOOD",
  ),
  chipotle: m(
    "Chipotle",
    "CHIPOTLE 1932",
    "5814",
    FD,
    "FOOD_AND_DRINK_FAST_FOOD",
  ),
  tartine: m(
    "Tartine Bakery",
    "TARTINE BAKERY SF",
    "5812",
    FD,
    "FOOD_AND_DRINK_RESTAURANT",
  ),
  nopa: m("Nopa", "NOPA RESTAURANT", "5812", FD, "FOOD_AND_DRINK_RESTAURANT"),
  stateBird: m(
    "State Bird Provisions",
    "STATE BIRD PROVISIONS",
    "5812",
    FD,
    "FOOD_AND_DRINK_RESTAURANT",
  ),
  delfina: m(
    "Pizzeria Delfina",
    "TST* PIZZERIA DELFINA",
    "5812",
    FD,
    "FOOD_AND_DRINK_RESTAURANT",
  ),
  burma: m(
    "Burma Superstar",
    "BURMA SUPERSTAR",
    "5812",
    FD,
    "FOOD_AND_DRINK_RESTAURANT",
  ),
  trickDog: m(
    "Trick Dog",
    "SQ *TRICK DOG",
    "5813",
    FD,
    "FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR",
  ),
  grubhub: m(
    "Grubhub",
    "GRUBHUB*SWEETMAPLE",
    "5814",
    FD,
    "FOOD_AND_DRINK_RESTAURANT",
    "online",
  ),
  traderJoes: m(
    "Trader Joe's",
    "TRADER JOE S #236",
    "5411",
    FD,
    "FOOD_AND_DRINK_GROCERIES",
  ),
  wholeFoods: m(
    "Whole Foods Market",
    "WHOLEFDS MKT 10235",
    "5411",
    FD,
    "FOOD_AND_DRINK_GROCERIES",
  ),
  safeway: m(
    "Safeway",
    "SAFEWAY #0985",
    "5411",
    FD,
    "FOOD_AND_DRINK_GROCERIES",
  ),
  biRite: m(
    "Bi-Rite Market",
    "BI-RITE MARKET",
    "5411",
    FD,
    "FOOD_AND_DRINK_GROCERIES",
  ),
  shell: m(
    "Shell",
    "SHELL OIL 57444428",
    "5541",
    "TRANSPORTATION",
    "TRANSPORTATION_GAS",
  ),
  chevron: m(
    "Chevron",
    "CHEVRON 0206712",
    "5542",
    "TRANSPORTATION",
    "TRANSPORTATION_GAS",
  ),
  uber: m(
    "Uber",
    "UBER *TRIP HELP.UBER.COM",
    "4121",
    "TRANSPORTATION",
    "TRANSPORTATION_TAXIS_AND_RIDE_SHARES",
    "online",
  ),
  lyft: m(
    "Lyft",
    "LYFT *RIDE SUN 8PM",
    "4121",
    "TRANSPORTATION",
    "TRANSPORTATION_TAXIS_AND_RIDE_SHARES",
    "online",
  ),
  clipper: m(
    "Clipper",
    "CLIPPER SERVICE",
    "4111",
    "TRANSPORTATION",
    "TRANSPORTATION_PUBLIC_TRANSIT",
  ),
  parking: m(
    "LAZ Parking",
    "LAZ PARKING 740",
    "7523",
    "TRANSPORTATION",
    "TRANSPORTATION_PARKING",
  ),
  target: m(
    "Target",
    "TARGET 00027847",
    "5310",
    "GENERAL_MERCHANDISE",
    "GENERAL_MERCHANDISE_SUPERSTORES",
  ),
  amazon: m(
    "Amazon",
    "AMAZON MKTPL*2K8Y41JQ3",
    null,
    "GENERAL_MERCHANDISE",
    "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
    "online",
  ),
  apple: m(
    "Apple",
    "APPLE STORE #R075",
    "5732",
    "GENERAL_MERCHANDISE",
    "GENERAL_MERCHANDISE_ELECTRONICS",
  ),
  uniqlo: m(
    "Uniqlo",
    "UNIQLO USA LLC",
    "5651",
    "GENERAL_MERCHANDISE",
    "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES",
  ),
  ikea: m(
    "IKEA",
    "IKEA EAST PALO ALTO",
    "5712",
    "HOME_IMPROVEMENT",
    "HOME_IMPROVEMENT_FURNITURE",
  ),
  homeDepot: m(
    "The Home Depot",
    "THE HOME DEPOT #0649",
    "5200",
    "HOME_IMPROVEMENT",
    "HOME_IMPROVEMENT_HARDWARE",
  ),
  cvs: m(
    "CVS Pharmacy",
    "CVS/PHARMACY #09412",
    "5912",
    "MEDICAL",
    "MEDICAL_PHARMACIES_AND_SUPPLEMENTS",
  ),
  walgreens: m(
    "Walgreens",
    "WALGREENS #3176",
    "5912",
    "MEDICAL",
    "MEDICAL_PHARMACIES_AND_SUPPLEMENTS",
  ),
  amc: m(
    "AMC Theatres",
    "AMC METREON 16",
    "7832",
    "ENTERTAINMENT",
    "ENTERTAINMENT_TV_AND_MOVIES",
  ),
  ticketmaster: m(
    "Ticketmaster",
    "TICKETMASTER *CHASE CTR",
    "7922",
    "ENTERTAINMENT",
    "ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS",
    "online",
  ),
  steam: m(
    "Steam",
    "STEAMGAMES.COM 4259522985",
    "5816",
    "ENTERTAINMENT",
    "ENTERTAINMENT_VIDEO_GAMES",
    "online",
  ),
  barber: m(
    "Fellow Barber",
    "FELLOW BARBER VALENCIA",
    "7230",
    "PERSONAL_CARE",
    "PERSONAL_CARE_HAIR_AND_BEAUTY",
  ),
  united: m(
    "United Airlines",
    "UNITED 0162345678901",
    "3000",
    "TRAVEL",
    "TRAVEL_FLIGHTS",
    "online",
  ),
  delta: m(
    "Delta Air Lines",
    "DELTA AIR 0062318842",
    "3058",
    "TRAVEL",
    "TRAVEL_FLIGHTS",
    "online",
  ),
  marriott: m(
    "Marriott",
    "MARRIOTT DOWNTOWN",
    "3509",
    "TRAVEL",
    "TRAVEL_LODGING",
  ),
  hyatt: m("Hyatt", "HYATT REGENCY", "3640", "TRAVEL", "TRAVEL_LODGING"),
  airbnb: m(
    "Airbnb",
    "AIRBNB * HMQ4X2KZ",
    "7011",
    "TRAVEL",
    "TRAVEL_LODGING",
    "online",
  ),
  hertz: m("Hertz", "HERTZ RENT-A-CAR", "3357", "TRAVEL", "TRAVEL_RENTAL_CARS"),
  // Subscriptions
  netflix: m(
    "Netflix",
    "NETFLIX.COM",
    "4899",
    "ENTERTAINMENT",
    "ENTERTAINMENT_TV_AND_MOVIES",
    "online",
  ),
  spotify: m(
    "Spotify",
    "Spotify USA",
    "5815",
    "ENTERTAINMENT",
    "ENTERTAINMENT_MUSIC_AND_AUDIO",
    "online",
  ),
  max: m(
    "Max",
    "MAX.COM",
    "4899",
    "ENTERTAINMENT",
    "ENTERTAINMENT_TV_AND_MOVIES",
    "online",
  ),
  youtube: m(
    "YouTube Premium",
    "GOOGLE *YouTubePremium",
    "5815",
    "ENTERTAINMENT",
    "ENTERTAINMENT_TV_AND_MOVIES",
    "online",
  ),
  icloud: m(
    "iCloud+",
    "APPLE.COM/BILL",
    "5818",
    "GENERAL_SERVICES",
    "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    "online",
  ),
  claude: m(
    "Claude",
    "CLAUDE.AI SUBSCRIPTION",
    "5818",
    "GENERAL_SERVICES",
    "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    "online",
  ),
  crunch: m(
    "Crunch Fitness",
    "CRUNCH FITNESS #221",
    "7997",
    "PERSONAL_CARE",
    "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS",
  ),
  xfinity: m(
    "Xfinity",
    "COMCAST CALIFORNIA",
    "4899",
    "RENT_AND_UTILITIES",
    "RENT_AND_UTILITIES_INTERNET_AND_CABLE",
    "online",
  ),
  verizon: m(
    "Verizon",
    "VERIZON WIRELESS PAYMENTS",
    "4814",
    "RENT_AND_UTILITIES",
    "RENT_AND_UTILITIES_TELEPHONE",
    "online",
  ),
  prime: m(
    "Amazon Prime",
    "AMAZON PRIME*2K3W1",
    null,
    "GENERAL_MERCHANDISE",
    "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
    "online",
  ),
};

type MerchantKeyName = keyof typeof MERCHANTS;

// --- Accounts ---------------------------------------------------------------------

type Kind = "asset" | "card" | "loan" | "invest";

interface AcctDef {
  inst: string;
  key: string;
  name: string;
  official: string | null;
  mask: string;
  type: string;
  subtype: string;
  kind: Kind;
  limitCents?: number;
}

const INSTITUTIONS = [
  { key: "chase", name: "Chase", color: "#117ACA" },
  { key: "amex", name: "American Express", color: "#016FD0" },
  { key: "ally", name: "Ally Bank", color: "#8A2BE2" },
  { key: "fidelity", name: "Fidelity", color: "#368727" },
  { key: "vanguard", name: "Vanguard", color: "#96151D" },
  { key: "coinbase", name: "Coinbase", color: "#0052FF" },
  { key: "toyota", name: "Toyota Financial Services", color: "#EB0A1E" },
  { key: "msw", name: "Morgan Stanley at Work", color: "#1B365D" },
];

const ACCOUNTS: AcctDef[] = [
  {
    inst: "chase",
    key: "chase-checking",
    name: "Total Checking",
    official: "Chase Total Checking",
    mask: "4821",
    type: "depository",
    subtype: "checking",
    kind: "asset",
  },
  {
    inst: "chase",
    key: "chase-csp",
    name: "Sapphire Preferred",
    official: "Chase Sapphire Preferred",
    mask: "7719",
    type: "credit",
    subtype: "credit card",
    kind: "card",
    limitCents: 1_800_000,
  },
  {
    inst: "chase",
    key: "chase-cff",
    name: "Freedom Flex",
    official: "Chase Freedom Flex",
    mask: "3306",
    type: "credit",
    subtype: "credit card",
    kind: "card",
    limitCents: 950_000,
  },
  {
    inst: "amex",
    key: "amex-gold",
    name: "Gold Card",
    official: "American Express Gold Card",
    mask: "31004",
    type: "credit",
    subtype: "credit card",
    kind: "card",
  },
  {
    inst: "ally",
    key: "ally-savings",
    name: "Online Savings",
    official: "Ally Online Savings Account",
    mask: "9914",
    type: "depository",
    subtype: "savings",
    kind: "asset",
  },
  {
    inst: "fidelity",
    key: "fid-401k",
    name: "Northwind Labs 401(k)",
    official: "NORTHWIND LABS 401(K) PLAN",
    mask: "0042",
    type: "investment",
    subtype: "401k",
    kind: "invest",
  },
  {
    inst: "fidelity",
    key: "fid-brokerage",
    name: "Individual - TOD",
    official: "Individual Brokerage",
    mask: "5518",
    type: "investment",
    subtype: "brokerage",
    kind: "invest",
  },
  {
    inst: "fidelity",
    key: "fid-hsa",
    name: "Health Savings Account",
    official: "HSA",
    mask: "2207",
    type: "investment",
    subtype: "hsa",
    kind: "invest",
  },
  {
    inst: "vanguard",
    key: "vg-roth",
    name: "Roth IRA",
    official: "Roth IRA Brokerage Account",
    mask: "8830",
    type: "investment",
    subtype: "roth",
    kind: "invest",
  },
  {
    inst: "coinbase",
    key: "cb-crypto",
    name: "Coinbase",
    official: null,
    mask: "0000",
    type: "investment",
    subtype: "crypto exchange",
    kind: "invest",
  },
  {
    inst: "toyota",
    key: "tfs-auto",
    name: "Auto Loan",
    official: "Retail Installment Contract",
    mask: "6152",
    type: "loan",
    subtype: "auto",
    kind: "loan",
  },
  {
    inst: "msw",
    key: "msw-rsu",
    name: "Northwind Labs Stock Plan",
    official: "Stock Plan Account",
    mask: "7730",
    type: "investment",
    subtype: "stock plan",
    kind: "invest",
  },
  // Unvested units, reported the way plans do: one placeholder security.
  {
    inst: "msw",
    key: "msw-awards",
    name: "Northwind Labs RSU",
    official: "Unvested Awards",
    mask: "7731",
    type: "investment",
    subtype: "stock plan",
    kind: "invest",
  },
];

// --- Simulation state -------------------------------------------------------------

interface Lot {
  date: ISODate;
  qty: number;
  costCents: number;
}

interface InvestState {
  cash: number;
  positions: Map<string, Lot[]>;
}

interface CardState {
  owed: number;
  closeDay: number;
  dueOffset: number;
  lastStatementBalance: number;
  lastStatementDate: ISODate | null;
  scheduled: Array<{ date: ISODate; amount: number }>;
  apr: number;
  lastPayment: { date: ISODate; amount: number } | null;
}

/** Card charges post the day after they're authorized (never in the future). */
function postedDate(authorized: ISODate, today: ISODate): ISODate {
  const next = addDays(authorized, 1);
  return next > today ? authorized : next;
}

export function generateHousehold(anchor: ISODate, today: ISODate): DemoData {
  const EPOCH = addDays(anchor, -760);
  const OBSERVED_FROM = addDays(anchor, -400);
  const prices = new Map<string, Map<ISODate, number>>();
  for (const s of SECURITIES)
    prices.set(
      s.ticker,
      s.aliasOf ? prices.get(s.aliasOf)! : priceSeries(s, EPOCH, today),
    );
  const px = (ticker: string, d: ISODate) =>
    prices.get(ticker)!.get(d) ?? SEC[ticker]!.p0;

  const txns = new Map<string, ProviderTransaction[]>(
    ACCOUNTS.map((a) => [a.key, []]),
  );
  const removed = new Map<string, string[]>(ACCOUNTS.map((a) => [a.key, []]));
  const invTx = new Map<string, ProviderInvestmentTransaction[]>(
    ACCOUNTS.map((a) => [a.key, []]),
  );
  const snaps = new Map<string, ProviderSnapshot[]>(
    ACCOUNTS.map((a) => [a.key, []]),
  );
  const counters = new Map<string, number>();

  const bal: Record<string, number> = {
    "chase-checking": 900_000,
    "ally-savings": 1_500_000,
  };
  const cards: Record<string, CardState> = {
    "chase-csp": {
      owed: 0,
      closeDay: 25,
      dueOffset: 25,
      lastStatementBalance: 0,
      lastStatementDate: null,
      scheduled: [],
      apr: 24.49,
      lastPayment: null,
    },
    "chase-cff": {
      owed: 0,
      closeDay: 3,
      dueOffset: 25,
      lastStatementBalance: 0,
      lastStatementDate: null,
      scheduled: [],
      apr: 20.49,
      lastPayment: null,
    },
    "amex-gold": {
      owed: 0,
      closeDay: 18,
      dueOffset: 25,
      lastStatementBalance: 0,
      lastStatementDate: null,
      scheduled: [],
      apr: 29.24,
      lastPayment: null,
    },
  };

  const initialLot = (
    ticker: string,
    qty: number,
    costPerShare: number,
  ): Lot[] => [
    {
      date: addDays(EPOCH, -420),
      qty,
      costCents: Math.round(qty * costPerShare * 100),
    },
  ];
  // The RSU grant vests 60 shares each Feb/May/Aug/Nov 15 until GRANT_END.
  const vestDates = (from: ISODate, to: ISODate) =>
    eachDay(from, to).filter(
      (d) =>
        d > from &&
        ["02", "05", "08", "11"].includes(d.slice(5, 7)) &&
        dayOfMonth(d) === 15,
    );
  let GRANT_END = addDays(anchor, 700);
  while (GRANT_END.slice(5) !== "08-15") GRANT_END = addDays(GRANT_END, 1);

  const invest: Record<string, InvestState> = {
    "fid-401k": {
      cash: 0,
      positions: new Map([
        ["FXAIX", initialLot("FXAIX", 390, 131)],
        ["FTIHX", initialLot("FTIHX", 1_850, 12.2)],
        ["FXNAX", initialLot("FXNAX", 1_500, 10.9)],
      ]),
    },
    "fid-brokerage": {
      cash: 12_000,
      positions: new Map([
        ["VTI", initialLot("VTI", 92, 188)],
        ["VXUS", initialLot("VXUS", 150, 55)],
        ["BND", initialLot("BND", 60, 79)],
      ]),
    },
    "fid-hsa": {
      cash: 0,
      positions: new Map([["FZROX", initialLot("FZROX", 390, 13.4)]]),
    },
    "vg-roth": {
      cash: 0,
      positions: new Map([["VTSAX", initialLot("VTSAX", 205, 96)]]),
    },
    "cb-crypto": {
      cash: 0,
      positions: new Map([
        ["BTC", initialLot("BTC", 0.052, 29_500)],
        ["ETH", initialLot("ETH", 0.8, 1_750)],
      ]),
    },
    "msw-rsu": { cash: 0, positions: new Map() },
    "msw-awards": {
      cash: 0,
      positions: new Map([
        [
          "NWND.RSU",
          [
            {
              date: EPOCH,
              qty: 60 * vestDates(EPOCH, GRANT_END).length,
              costCents: 0,
            },
          ],
        ],
      ]),
    },
  };

  // Car loan: originated partway through history; terms known only to the
  // lender. Ikat must infer them from balances and payments.
  const LOAN_START = addDays(anchor, -540);
  const LOAN_PRINCIPAL = 3_150_000;
  const LOAN_APR = 6.49;
  const LOAN_PAYMENT = monthlyPayment(LOAN_PRINCIPAL, LOAN_APR, 60);
  let loanBalance = 0;

  // Life events, fixed relative to the anchor.
  const RAISE = addDays(anchor, -280);
  const NETFLIX_HIKE = addDays(anchor, -200);
  const XFINITY_HIKE = addDays(anchor, -120);
  const RENT_RENEWAL = addDays(anchor, -180);
  const ARKK_BUY = addDays(anchor, -600);
  const VTI_SALE = addDays(anchor, -250);
  const RSU_SALE = addDays(anchor, -150);
  const TRIPS = [
    {
      start: addDays(anchor, -610),
      nights: 4,
      air: "united" as const,
      stay: "marriott" as const,
    },
    {
      start: addDays(anchor, -330),
      nights: 7,
      air: "delta" as const,
      stay: "airbnb" as const,
    },
    {
      start: addDays(anchor, -48),
      nights: 5,
      air: "united" as const,
      stay: "hyatt" as const,
    },
  ];
  const cspAnniversary = dayOfMonth(addDays(anchor, -400));
  const cspAnnivMonth = addDays(anchor, -400).slice(5, 7);
  const amexAnnivMonth = addDays(anchor, -200).slice(5, 7);
  const primeMonth = addDays(anchor, -100).slice(5, 7);

  function nextId(acct: string, d: ISODate, stream: string): string {
    const k = `${acct}|${d}|${stream}`;
    const n = (counters.get(k) ?? 0) + 1;
    counters.set(k, n);
    return `demo-${acct}-${d}-${stream}-${n}`;
  }

  function push(
    acct: string,
    d: ISODate,
    amountCents: Cents,
    desc: string,
    opts: {
      merchant?: Merchant;
      primary?: string;
      detailed?: string;
      stream?: string;
      channel?: string;
      name?: string;
    } = {},
  ) {
    const id = nextId(acct, d, opts.stream ?? "tx");
    const def = ACCOUNTS.find((a) => a.key === acct)!;
    const age = diffDays(d, today);
    // Card purchases sit pending for a couple of days, then post a day later
    // under a new id — the same dance Plaid does.
    const pendable =
      def.kind === "card" && amountCents < 0 && !opts.stream?.startsWith("fee");
    const pending = pendable && age < 2;
    const posted = pendable && !pending;
    txns.get(acct)!.push({
      externalId: pending ? `p-${id}` : id,
      pendingExternalId: posted ? `p-${id}` : null,
      accountExternalId: acct,
      date: posted ? postedDate(d, today) : d,
      authorizedDate: d,
      amountCents,
      currency: "USD",
      description: desc,
      merchantName: opts.merchant?.name ?? opts.name ?? null,
      logoUrl: null,
      website: null,
      mcc: opts.merchant?.mcc ?? null,
      providerCategory: opts.merchant?.pfc[0] ?? opts.primary ?? null,
      providerCategoryDetailed: opts.merchant?.pfc[1] ?? opts.detailed ?? null,
      paymentChannel: opts.merchant?.channel ?? opts.channel ?? "other",
      pending,
      runningBalanceCents: null,
      location: null,
    });
    if (posted && age < 10) removed.get(acct)!.push(`p-${id}`);
  }

  function spend(
    card: string,
    d: ISODate,
    key: MerchantKeyName,
    dollars: number,
    stream = "spend",
  ) {
    const merchant = MERCHANTS[key];
    const amount = Math.round(dollars * 100);
    if (card === "chase-checking") bal[card]! -= amount;
    else cards[card]!.owed += amount;
    push(card, d, -amount, merchant.desc, { merchant, stream });
  }

  function credit(
    card: string,
    d: ISODate,
    merchant: Merchant,
    dollars: number,
    desc: string,
  ) {
    const amount = Math.round(dollars * 100);
    cards[card]!.owed -= amount;
    push(card, d, amount, desc, { merchant, stream: "credit" });
  }

  function bank(
    acct: string,
    d: ISODate,
    cents: Cents,
    desc: string,
    primary: string,
    detailed: string,
    name?: string,
  ) {
    bal[acct] = (bal[acct] ?? 0) + cents;
    push(acct, d, cents, desc, {
      primary,
      detailed,
      stream: "bank",
      ...(name ? { name } : {}),
    });
  }

  // --- investment helpers ---
  function itx(
    acct: string,
    d: ISODate,
    t: Omit<
      ProviderInvestmentTransaction,
      "externalId" | "accountExternalId" | "date"
    >,
  ) {
    invTx.get(acct)!.push({
      ...t,
      externalId: nextId(acct, d, `inv-${t.subtype ?? t.type}`),
      accountExternalId: acct,
      date: d,
    });
  }
  function contribute(acct: string, d: ISODate, cents: number, name: string) {
    invest[acct]!.cash += cents;
    itx(acct, d, {
      securityExternalId: null,
      name,
      type: "cash",
      subtype: "contribution",
      quantity: 0,
      price: null,
      amountCents: cents,
      feesCents: 0,
    });
  }
  function buy(
    acct: string,
    d: ISODate,
    ticker: string,
    cents: number,
    subtype = "buy",
  ) {
    const price = px(ticker, d);
    const qty = Math.round((cents / 100 / price) * 1e6) / 1e6;
    const st = invest[acct]!;
    st.cash -= cents;
    const lots = st.positions.get(ticker) ?? [];
    lots.push({ date: d, qty, costCents: cents });
    st.positions.set(ticker, lots);
    itx(acct, d, {
      securityExternalId: secId(ticker),
      name: `${subtype === "dividend reinvestment" ? "REINVESTMENT" : "YOU BOUGHT"} ${SEC[ticker]!.name.toUpperCase()}`,
      type: "buy",
      subtype,
      quantity: qty,
      price,
      amountCents: -cents,
      feesCents: 0,
    });
  }
  function sell(
    acct: string,
    d: ISODate,
    ticker: string,
    qty: number,
    subtype = "sell",
  ): number {
    const price = px(ticker, d);
    const st = invest[acct]!;
    const lots = st.positions.get(ticker) ?? [];
    let left = qty;
    while (left > 1e-9 && lots.length) {
      const lot = lots[0]!;
      if (lot.qty <= left + 1e-9) {
        left -= lot.qty;
        lots.shift();
      } else {
        const frac = left / lot.qty;
        lot.costCents -= Math.round(lot.costCents * frac);
        lot.qty -= left;
        left = 0;
      }
    }
    const proceeds = Math.round(qty * price * 100);
    st.cash += proceeds;
    itx(acct, d, {
      securityExternalId: secId(ticker),
      name: `YOU SOLD ${SEC[ticker]!.name.toUpperCase()}`,
      type: "sell",
      subtype,
      quantity: -qty,
      price,
      amountCents: proceeds,
      feesCents: 0,
    });
    return proceeds;
  }
  function dividend(
    acct: string,
    d: ISODate,
    ticker: string,
    yieldAnnual: number,
  ) {
    const st = invest[acct]!;
    const qty = (st.positions.get(ticker) ?? []).reduce((s, l) => s + l.qty, 0);
    if (qty <= 0) return;
    const cents = Math.round(qty * px(ticker, d) * (yieldAnnual / 4) * 100);
    if (cents <= 0) return;
    st.cash += cents;
    itx(acct, d, {
      securityExternalId: secId(ticker),
      name: `DIVIDEND RECEIVED ${ticker}`,
      type: "cash",
      subtype: "qualified dividend",
      quantity: 0,
      price: null,
      amountCents: cents,
      feesCents: 0,
    });
    buy(acct, d, ticker, cents, "dividend reinvestment");
  }
  const investValue = (acct: string, d: ISODate) => {
    const st = invest[acct]!;
    let v = st.cash;
    for (const [t, lots] of st.positions)
      v += Math.round(lots.reduce((s, l) => s + l.qty, 0) * px(t, d) * 100);
    return v;
  };

  // --- the day loop ---
  let firstFriday = EPOCH;
  while (dayOfWeek(firstFriday) !== 5) firstFriday = addDays(firstFriday, 1);

  for (const d of eachDay(EPOCH, today)) {
    const dom = dayOfMonth(d);
    const dow = dayOfWeek(d);
    const month = d.slice(5, 7);
    const r = day("life", d);

    // Payday: every other Friday.
    const isPayday = dow === 5 && diffDays(firstFriday, d) % 14 === 0;
    if (isPayday) {
      const net = d >= RAISE ? 452_500 : 431_000;
      bank(
        "chase-checking",
        d,
        net,
        "NORTHWIND LABS PAYROLL PPD ID: 9111111101",
        "INCOME",
        "INCOME_SALARY",
        "Northwind Labs",
      );
      const employee = d >= RAISE ? 56_000 : 54_000;
      contribute("fid-401k", d, employee, "EMPLOYEE CONTRIBUTION");
      contribute("fid-401k", d, Math.round(employee / 2), "EMPLOYER MATCH");
      const total = employee + Math.round(employee / 2);
      buy("fid-401k", d, "FXAIX", Math.round(total * 0.7));
      buy("fid-401k", d, "FTIHX", Math.round(total * 0.2));
      buy(
        "fid-401k",
        d,
        "FXNAX",
        total - Math.round(total * 0.7) - Math.round(total * 0.2),
      );
      contribute("fid-hsa", d, 16_500, "PAYROLL CONTRIBUTION");
      buy("fid-hsa", d, "FZROX", 16_500);
      // Annual bonus on the March payday nearest the 15th.
      if (month === "03" && dom >= 8 && dom <= 21) {
        bank(
          "chase-checking",
          d,
          980_000,
          "NORTHWIND LABS PAYROLL BONUS PPD",
          "INCOME",
          "INCOME_SALARY",
          "Northwind Labs",
        );
      }
    }

    // Fixed monthly bills from checking.
    if (dom === 1) {
      const rent = d >= RENT_RENEWAL ? 297_500 : 285_000;
      bank(
        "chase-checking",
        d,
        -rent,
        "AVALONBAY COMMUN RENT PMT",
        "RENT_AND_UTILITIES",
        "RENT_AND_UTILITIES_RENT",
        "AvalonBay Communities",
      );
    }
    if (dom === 3)
      bank(
        "chase-checking",
        d,
        -14_800,
        "GEICO *AUTO 800-841-3000",
        "GENERAL_SERVICES",
        "GENERAL_SERVICES_INSURANCE",
        "GEICO",
      );
    if (dom === 8) {
      const season = ["12", "01", "02"].includes(month)
        ? 6_500
        : ["07", "08", "09"].includes(month)
          ? 4_200
          : 0;
      const pge = 7_200 + season + Math.round(day("pge", d).normal(0, 1_200));
      bank(
        "chase-checking",
        d,
        -pge,
        "PGANDE WEB ONLINE",
        "RENT_AND_UTILITIES",
        "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
        "PG&E",
      );
    }
    if (dom === 5) {
      bank(
        "chase-checking",
        d,
        -60_000,
        "VANGUARD BUY INVESTMENT",
        "TRANSFER_OUT",
        "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
        "Vanguard",
      );
      contribute("vg-roth", d, 60_000, "CONTRIBUTION 2026");
      buy("vg-roth", d, "VTSAX", 60_000);
    }
    if (dom === 20) {
      bank(
        "chase-checking",
        d,
        -75_000,
        "FID BKG SVC LLC MONEYLINE",
        "TRANSFER_OUT",
        "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
        "Fidelity",
      );
      contribute(
        "fid-brokerage",
        d,
        75_000,
        "ELECTRONIC FUNDS TRANSFER RECEIVED",
      );
      buy("fid-brokerage", d, "VTI", 45_000);
      buy("fid-brokerage", d, "VXUS", 22_500);
      buy("fid-brokerage", d, "BND", 7_500);
    }
    if (["03", "06", "09", "12"].includes(month) && dom === 26) {
      dividend("fid-brokerage", d, "VTI", 0.013);
      dividend("fid-brokerage", d, "VXUS", 0.03);
      dividend("fid-brokerage", d, "BND", 0.036);
    }
    if (dow === 1) {
      bank(
        "chase-checking",
        d,
        -5_000,
        "COINBASE.COM 8889087930",
        "TRANSFER_OUT",
        "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
        "Coinbase",
      );
      contribute("cb-crypto", d, 5_000, "RECURRING BUY");
      buy("cb-crypto", d, "BTC", 3_500);
      buy("cb-crypto", d, "ETH", 1_500);
    }

    // Car loan.
    if (d === LOAN_START) loanBalance = LOAN_PRINCIPAL;
    if (loanBalance > 0 && dom === 15 && d > LOAN_START) {
      const interest = Math.round(loanBalance * (LOAN_APR / 100 / 12));
      const pay = Math.min(LOAN_PAYMENT, loanBalance + interest);
      loanBalance = loanBalance + interest - pay;
      bank(
        "chase-checking",
        d,
        -pay,
        "TOYOTA FINANCIAL SVCS PMT",
        "LOAN_PAYMENTS",
        "LOAN_PAYMENTS_CAR_PAYMENT",
        "Toyota Financial Services",
      );
      push("tfs-auto", d, pay, "PAYMENT RECEIVED - THANK YOU", {
        primary: "LOAN_PAYMENTS",
        detailed: "LOAN_PAYMENTS_CAR_PAYMENT",
        stream: "loan",
      });
    }

    // Savings: pay yourself on the 17th, scaled to what checking can spare.
    if (dom === 17) {
      const spare =
        bal["chase-checking"]! > 1_700_000
          ? 300_000
          : bal["chase-checking"]! > 650_000
            ? 80_000
            : 0;
      if (spare) {
        bank(
          "chase-checking",
          d,
          -spare,
          "ONLINE TRANSFER TO ALLY BANK",
          "TRANSFER_OUT",
          "TRANSFER_OUT_SAVINGS",
          "Ally Bank",
        );
        bank(
          "ally-savings",
          d,
          spare,
          "Transfer from Chase Total Checking",
          "TRANSFER_IN",
          "TRANSFER_IN_SAVINGS",
        );
      }
      // A thin month: pull back from savings rather than overdraw.
      if (bal["chase-checking"]! < 250_000) {
        bank(
          "ally-savings",
          d,
          -200_000,
          "Transfer to Chase Total Checking",
          "TRANSFER_OUT",
          "TRANSFER_OUT_SAVINGS",
        );
        bank(
          "chase-checking",
          d,
          200_000,
          "ONLINE TRANSFER FROM ALLY BANK",
          "TRANSFER_IN",
          "TRANSFER_IN_SAVINGS",
          "Ally Bank",
        );
      }
    }
    if (d === endOfMonth(d)) {
      const interest = Math.round(bal["ally-savings"]! * (0.04 / 12));
      bank(
        "ally-savings",
        d,
        interest,
        "Interest Paid",
        "INCOME",
        "INCOME_INTEREST_EARNED",
      );
    }

    // Subscriptions on cards.
    if (dom === 9)
      spend(
        "chase-csp",
        d,
        "netflix",
        d >= NETFLIX_HIKE ? 17.99 : 15.49,
        "sub",
      );
    if (dom === 12)
      spend("chase-csp", d, "xfinity", d >= XFINITY_HIKE ? 85 : 80, "sub");
    if (dom === 14) spend("chase-cff", d, "spotify", 11.99, "sub");
    if (dom === 19) spend("chase-csp", d, "max", 16.99, "sub");
    if (dom === 2) spend("chase-cff", d, "icloud", 2.99, "sub");
    if (dom === 27) spend("chase-csp", d, "claude", 20, "sub");
    if (dom === 1) spend("chase-cff", d, "crunch", 34.99, "sub");
    if (dom === 22) spend("chase-cff", d, "verizon", 68.42, "sub");
    if (dom === 6) spend("amex-gold", d, "youtube", 13.99, "sub");
    if (month === primeMonth && dom === 11)
      spend("chase-cff", d, "prime", 139, "sub");

    // Annual fees.
    if (
      month === cspAnnivMonth &&
      dom === Math.min(cspAnniversary, 28) &&
      d > addDays(EPOCH, 30)
    ) {
      cards["chase-csp"]!.owed += 9_500;
      push("chase-csp", d, -9_500, "ANNUAL MEMBERSHIP FEE", {
        primary: "BANK_FEES",
        detailed: "BANK_FEES_OTHER_BANK_FEES",
        stream: "fee",
      });
    }
    if (month === amexAnnivMonth && dom === 3 && d > addDays(EPOCH, 30)) {
      cards["amex-gold"]!.owed += 32_500;
      push("amex-gold", d, -32_500, "ANNUAL MEMBERSHIP FEE", {
        primary: "BANK_FEES",
        detailed: "BANK_FEES_OTHER_BANK_FEES",
        stream: "fee",
      });
    }

    // Everyday spending.
    const onTrip = TRIPS.find(
      (t) => d >= t.start && d < addDays(t.start, t.nights),
    );
    if (!onTrip) {
      if (r.chance(dow === 0 || dow === 6 ? 0.45 : 0.62)) {
        const k = r.weighted<MerchantKeyName>([
          ["blueBottle", 4],
          ["starbucks", 2],
          ["philz", 3],
        ]);
        spend(
          r.chance(0.8) ? "amex-gold" : "chase-csp",
          d,
          k,
          r.between(4.5, 7.75),
          "coffee",
        );
      }
      if (dow >= 1 && dow <= 5 && r.chance(0.5)) {
        const k = r.weighted<MerchantKeyName>([
          ["sweetgreen", 4],
          ["chipotle", 3],
          ["tartine", 1],
        ]);
        // Lunch goes on whatever is in the wallet — sometimes the wrong card.
        const card = r.weighted([
          ["amex-gold", 5],
          ["chase-cff", 3],
          ["chase-csp", 2],
        ] as const);
        spend(card, d, k, r.between(12, 21), "lunch");
      }
      if (r.chance(dow >= 4 ? 0.3 : 0.12)) {
        const k = r.weighted<MerchantKeyName>([
          ["nopa", 2],
          ["stateBird", 1],
          ["delfina", 3],
          ["burma", 2],
          ["trickDog", 2],
        ]);
        const card = r.weighted([
          ["amex-gold", 6],
          ["chase-csp", 3],
          ["chase-cff", 1],
        ] as const);
        spend(card, d, k, r.between(38, 135), "dinner");
      }
      if (r.chance(0.2)) {
        const k = r.weighted<MerchantKeyName>([
          ["traderJoes", 5],
          ["wholeFoods", 3],
          ["safeway", 2],
          ["biRite", 1],
        ]);
        const card = r.weighted([
          ["amex-gold", 7],
          ["chase-csp", 2],
          ["chase-checking", 1],
        ] as const);
        spend(card, d, k, r.between(34, 165), "grocery");
      }
      if (r.chance(1 / 9))
        spend(
          "chase-cff",
          d,
          r.pick(["shell", "chevron"] as const),
          r.between(38, 64),
          "gas",
        );
      if (r.chance(0.28))
        spend(
          "chase-csp",
          d,
          r.pick(["uber", "lyft"] as const),
          r.between(11, 36),
          "ride",
        );
      if (dom === 10 || dom === 24)
        spend("chase-csp", d, "clipper", 20, "transit");
      if (r.chance(0.05))
        spend("chase-csp", d, "parking", r.between(8, 28), "park");
      if (r.chance(0.13))
        spend("chase-cff", d, "amazon", r.between(14, 96), "amazon");
      if (r.chance(month === "11" || month === "12" ? 0.16 : 0.07)) {
        const k = r.weighted<MerchantKeyName>([
          ["target", 5],
          ["uniqlo", 2],
          ["apple", 1],
          ["ikea", 1],
          ["homeDepot", 1],
        ]);
        spend(
          r.chance(0.7) ? "chase-cff" : "chase-csp",
          d,
          k,
          k === "apple" ? r.between(49, 399) : r.between(22, 140),
          "shop",
        );
      }
      if (r.chance(0.06))
        spend(
          "chase-cff",
          d,
          r.pick(["cvs", "walgreens"] as const),
          r.between(9, 42),
          "pharmacy",
        );
      if (r.chance(0.035))
        spend("chase-csp", d, "amc", r.between(18, 36), "movie");
      if (r.chance(0.012))
        spend("chase-csp", d, "ticketmaster", r.between(85, 240), "tickets");
      if (r.chance(0.02))
        spend("chase-cff", d, "steam", r.between(9.99, 59.99), "games");
      if (dom === 16 && r.chance(0.9))
        spend("amex-gold", d, "barber", 48, "barber");
      // Grubhub monthly, with the Gold card's $10 dining credit.
      if (dom === 23) {
        spend("amex-gold", d, "grubhub", r.between(24, 41), "grubhub");
        credit(
          "amex-gold",
          addDays(d, 0),
          MERCHANTS.grubhub,
          10,
          "GRUBHUB CREDIT",
        );
      }
      // Refunds now and then.
      if (r.chance(0.02)) {
        const amt = r.between(15, 70);
        cards["chase-cff"]!.owed -= Math.round(amt * 100);
        push("chase-cff", d, Math.round(amt * 100), MERCHANTS.amazon.desc, {
          merchant: MERCHANTS.amazon,
          stream: "refund",
        });
      }
      // Peer-to-peer.
      if (r.chance(0.06))
        bank(
          "chase-checking",
          d,
          -Math.round(r.between(20, 85) * 100),
          "VENMO PAYMENT 1034567812",
          "TRANSFER_OUT",
          "TRANSFER_OUT_ACCOUNT_TRANSFER",
          "Venmo",
        );
    } else {
      // Travel days: booked flights appear ~40 days before; hotel at checkout.
      const tr = day("trip", d);
      spend(
        "chase-csp",
        d,
        r.pick(["tartine", "nopa", "burma"] as const),
        tr.between(28, 120),
        "tripfood",
      );
      if (tr.chance(0.6))
        spend("chase-csp", d, "uber", tr.between(14, 48), "tripride");
      if (tr.chance(0.5))
        spend("chase-csp", d, "blueBottle", tr.between(5, 8), "tripcoffee");
    }
    for (const t of TRIPS) {
      if (d === addDays(t.start, -40)) {
        spend("chase-csp", d, t.air, 412.3, "air");
        spend("chase-csp", d, t.air, 389.7, "air");
      }
      if (d === addDays(t.start, t.nights)) {
        spend(
          "chase-csp",
          d,
          t.stay,
          t.nights * (t.stay === "airbnb" ? 185 : 265),
          "stay",
        );
        if (t.stay !== "airbnb")
          credit(
            "chase-csp",
            d,
            MERCHANTS[t.stay],
            50,
            "CHASE TRAVEL HOTEL CREDIT",
          );
      }
    }

    // Brokerage events.
    if (d === ARKK_BUY) {
      contribute(
        "fid-brokerage",
        d,
        500_000,
        "ELECTRONIC FUNDS TRANSFER RECEIVED",
      );
      bank(
        "ally-savings",
        d,
        -500_000,
        "Transfer to Fidelity",
        "TRANSFER_OUT",
        "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
      );
      buy("fid-brokerage", d, "ARKK", 500_000);
    }
    if (d === VTI_SALE) sell("fid-brokerage", d, "VTI", 12);

    // RSUs vest quarterly: shares arrive, a third are sold to cover taxes.
    if (["02", "05", "08", "11"].includes(month) && dom === 15) {
      const shares = 60;
      const price = px("NWND", d);
      const st = invest["msw-rsu"]!;
      const lots = st.positions.get("NWND") ?? [];
      lots.push({
        date: d,
        qty: shares,
        costCents: Math.round(shares * price * 100),
      });
      st.positions.set("NWND", lots);
      itx("msw-rsu", d, {
        securityExternalId: secId("NWND"),
        name: "RSU RELEASE",
        type: "transfer",
        subtype: "stock distribution",
        quantity: shares,
        price,
        amountCents: 0,
        feesCents: 0,
      });
      const withheld = sell("msw-rsu", d, "NWND", 20, "sell");
      st.cash -= withheld;
      itx("msw-rsu", d, {
        securityExternalId: null,
        name: "TAX WITHHOLDING - SELL TO COVER",
        type: "cash",
        subtype: "tax withheld",
        quantity: 0,
        price: null,
        amountCents: -withheld,
        feesCents: 0,
      });
      invest["msw-awards"]!.positions.get("NWND.RSU")![0]!.qty -= shares;
    }
    if (d === RSU_SALE) {
      const proceeds = sell("msw-rsu", d, "NWND", 40);
      invest["msw-rsu"]!.cash -= proceeds;
      itx("msw-rsu", d, {
        securityExternalId: null,
        name: "WIRE TRANSFER OUT",
        type: "cash",
        subtype: "withdrawal",
        quantity: 0,
        price: null,
        amountCents: -proceeds,
        feesCents: 0,
      });
      bank(
        "chase-checking",
        addDays(d, 0),
        proceeds,
        "MORGAN STANLEY WIRE TRANSFER",
        "TRANSFER_IN",
        "TRANSFER_IN_ACCOUNT_TRANSFER",
        "Morgan Stanley at Work",
      );
    }

    // Statements close; autopay settles the statement balance on the due date.
    for (const [key, c] of Object.entries(cards)) {
      if (dom === c.closeDay) {
        c.lastStatementBalance = c.owed;
        c.lastStatementDate = d;
        if (c.owed > 0)
          c.scheduled.push({ date: addDays(d, c.dueOffset), amount: c.owed });
      }
      const due = c.scheduled.filter((p) => p.date === d);
      for (const p of due) {
        c.owed -= p.amount;
        c.lastPayment = { date: d, amount: p.amount };
        const isAmex = key === "amex-gold";
        bank(
          "chase-checking",
          d,
          -p.amount,
          isAmex
            ? "AMERICAN EXPRESS ACH PMT M4382"
            : "CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224",
          "LOAN_PAYMENTS",
          "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
          isAmex ? "American Express" : "Chase",
        );
        push(
          key,
          d,
          p.amount,
          isAmex ? "AUTOPAY PAYMENT - THANK YOU" : "Payment Thank You - Web",
          {
            primary: "LOAN_PAYMENTS",
            detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
            stream: "payment",
          },
        );
      }
      c.scheduled = c.scheduled.filter((p) => p.date > d);
    }

    // Record what a daily sync would have seen.
    if (d >= OBSERVED_FROM) {
      for (const a of ACCOUNTS) {
        let current: number | null;
        if (a.kind === "asset") current = bal[a.key]!;
        else if (a.kind === "card") current = cards[a.key]!.owed;
        else if (a.kind === "loan")
          current = d >= LOAN_START ? loanBalance : null;
        else current = investValue(a.key, d);
        if (current == null) continue;
        snaps.get(a.key)!.push({
          accountExternalId: a.key,
          date: d,
          currentCents: current,
          availableCents: null,
        });
      }
    }
  }

  // --- Assemble -------------------------------------------------------------
  const securities: ProviderSecurity[] = SECURITIES.map((s) => ({
    externalId: secId(s.ticker),
    ticker:
      s.ticker === "BTC" || s.ticker === "ETH" ? `CUR:${s.ticker}` : s.ticker,
    name: s.name,
    type: s.type,
    cusip: null,
    isin: null,
    isCashEquivalent: false,
    closePrice: px(s.ticker, today),
    closePriceAsOf: today,
    sector: null,
    industry: null,
  }));

  const priceRows: ProviderPrice[] = [];
  for (const s of SECURITIES.filter((x) => !x.aliasOf)) {
    for (const [d, close] of prices.get(s.ticker)!)
      priceRows.push({ securityExternalId: secId(s.ticker), date: d, close });
  }

  const institutions: DemoInstitution[] = INSTITUTIONS.map((inst) => {
    const defs = ACCOUNTS.filter((a) => a.inst === inst.key);
    const accounts: ProviderAccount[] = defs
      .filter((a) => a.kind !== "loan" || today >= LOAN_START)
      .map((a) => {
        let current: number;
        let available: number | null = null;
        if (a.kind === "asset") {
          current = bal[a.key]!;
          available = current;
        } else if (a.kind === "card") {
          current = cards[a.key]!.owed;
          available = a.limitCents ? a.limitCents - current : null;
        } else if (a.kind === "loan") current = loanBalance;
        else current = investValue(a.key, today);
        return {
          externalId: a.key,
          name: a.name,
          officialName: a.official,
          mask: a.mask,
          type: a.type,
          subtype: a.subtype,
          currentCents: current,
          availableCents: available,
          limitCents: a.limitCents ?? null,
          currency: "USD",
        };
      });

    const holdings: ProviderHolding[] = [];
    for (const a of defs.filter((x) => x.kind === "invest")) {
      for (const [ticker, lots] of invest[a.key]!.positions) {
        const qty = lots.reduce((s, l) => s + l.qty, 0);
        if (qty <= 1e-9) continue;
        const price = px(ticker, today);
        holdings.push({
          accountExternalId: a.key,
          securityExternalId: secId(ticker),
          quantity: Math.round(qty * 1e6) / 1e6,
          price,
          valueCents: Math.round(qty * price * 100),
          costBasisCents: SEC[ticker]!.aliasOf
            ? null
            : lots.reduce((s, l) => s + l.costCents, 0),
        });
      }
    }

    const liabilities: ProviderLiability[] = defs
      .filter((a) => a.kind === "card")
      .map((a) => {
        const c = cards[a.key]!;
        const nextDue =
          c.scheduled[0]?.date ??
          (c.lastStatementDate
            ? addDays(c.lastStatementDate, c.dueOffset)
            : null);
        return {
          accountExternalId: a.key,
          kind: "credit" as const,
          aprPercent: c.apr,
          aprs: [
            { type: "purchase_apr", percent: c.apr, balanceCents: c.owed },
          ],
          lastStatementBalanceCents: c.lastStatementBalance,
          lastStatementDate: c.lastStatementDate,
          minimumPaymentCents:
            c.lastStatementBalance > 0
              ? Math.max(3_500, Math.round(c.lastStatementBalance * 0.01))
              : 0,
          nextPaymentDueDate: nextDue,
          lastPaymentCents: c.lastPayment?.amount ?? null,
          lastPaymentDate: c.lastPayment?.date ?? null,
          isOverdue: false,
          originationDate: null,
          originationPrincipalCents: null,
          termMonths: null,
          maturityDate: null,
          paymentCents: null,
        };
      });

    return {
      key: inst.key,
      name: inst.name,
      color: inst.color,
      accounts,
      transactions: defs.flatMap((a) => txns.get(a.key)!),
      removed: defs.flatMap((a) => removed.get(a.key)!),
      snapshots: defs.flatMap((a) => snaps.get(a.key)!),
      holdings,
      investmentTransactions: defs.flatMap((a) => invTx.get(a.key)!),
      // Like Plaid: card liabilities yes, auto loan terms no.
      liabilities: liabilities.length ? liabilities : null,
      hasInvestments: defs.some((a) => a.kind === "invest"),
    };
  });

  return { institutions, securities, prices: priceRows };
}

/** Level monthly payment for a fully amortizing loan. */
function monthlyPayment(
  principalCents: number,
  aprPercent: number,
  months: number,
): number {
  const r = aprPercent / 100 / 12;
  if (months <= 0) return principalCents;
  if (r === 0) return Math.round(principalCents / months);
  return Math.round((principalCents * r) / (1 - (1 + r) ** -months));
}
