// Wire types shared by the server and the web app. The server returns exactly
// these shapes; the UI imports them rather than re-declaring what it expects,
// so a renamed field breaks the typecheck instead of silently rendering blank.

import type { AccountGroup, InvestmentKind, TaxTreatment } from "./accounts";
import type { BudgetProgress, BudgetSuggestion } from "./budgets";
import type { CategoryKind } from "./categories";
import type { Forecast } from "./forecast";
import type { AssetClass, AssetMix } from "./investing";
import type { RecurringSeries } from "./recurring";
import type { Cents } from "./money";
import type { ISODate } from "./dates";

export type Profile = "demo" | "real";

export type ConnectionStatus =
  "ok" | "syncing" | "error" | "reauth" | "consent";

export interface ConnectionDTO {
  id: string;
  provider: "plaid" | "demo" | "manual" | "file";
  institutionName: string;
  institutionLogo: string | null;
  institutionColor: string | null;
  status: ConnectionStatus;
  statusDetail: string | null;
  lastSyncedAt: string | null;
  accountCount: number;
  /** Accounts also arriving through a newer connection, hidden from totals. */
  duplicateCount: number;
  /** Products this institution could share but hasn't been granted yet. */
  missingConsent: string[];
  /** Earliest transaction this connection has provided — its history depth. */
  historyFrom: string | null;
  /** The link was capped at the provider's short default; linking again gets more. */
  historyCapped: boolean;
  /** A fresh link whose full history is still arriving. */
  historyPending: boolean;
}

export interface StatusDTO {
  profile: Profile;
  version: string;
  plaid: { configured: boolean; env: string | null };
  auth: { passwordSet: boolean; remote: boolean };
  connections: ConnectionDTO[];
  lastSyncAt: string | null;
  syncing: boolean;
  today: ISODate;
}

export interface AccountDTO {
  id: string;
  connectionId: string;
  institutionName: string;
  institutionColor: string | null;
  institutionLogo: string | null;
  /** nickname › specific name › official name, disambiguated with ••mask */
  displayName: string;
  name: string;
  officialName: string | null;
  nickname: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  subtypeLabel: string;
  group: AccountGroup;
  investmentKind: InvestmentKind | null;
  taxTreatment: TaxTreatment;
  owner: "me" | "partner" | "joint";
  isLiability: boolean;
  /** Positive = what you have (assets) or what you owe (liabilities). */
  balanceCents: Cents;
  availableCents: Cents | null;
  limitCents: Cents | null;
  /** Signed contribution to net worth (liabilities negative, 0 when excluded). */
  netWorthCents: Cents;
  includeInNetWorth: boolean;
  hidden: boolean;
  balanceAsOf: string | null;
  /** Added by hand (a home, a car): its value is whatever you last said. */
  manual: boolean;
}

export interface AccountGroupDTO {
  group: AccountGroup;
  label: string;
  totalCents: Cents;
  count: number;
}

export interface AccountsDTO {
  accounts: AccountDTO[];
  groups: AccountGroupDTO[];
  netWorthCents: Cents;
  assetsCents: Cents;
  liabilitiesCents: Cents;
}

export interface CategoryDTO {
  id: string;
  name: string;
  kind: CategoryKind;
  icon: string;
  essential: boolean;
  custom: boolean;
}

export interface TransactionDTO {
  id: string;
  accountId: string;
  accountName: string;
  date: ISODate;
  /** + money in, − money out */
  amountCents: Cents;
  merchant: string;
  description: string;
  logoUrl: string | null;
  categoryId: string;
  categorySource: "user" | "rule" | "mcc" | "provider" | "inferred";
  pending: boolean;
  notes: string | null;
  transferPairId: string | null;
  excluded: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  /** Sum over the whole filtered set, not just this page. */
  totalAmountCents: Cents;
  nextCursor: string | null;
}

export interface NetWorthPoint {
  date: ISODate;
  netWorthCents: Cents;
  byGroup: Partial<Record<AccountGroup, Cents>>;
  /** false when any contributing account's value that day is rebuilt from transactions */
  observed: boolean;
  /** true when a meaningful share of the value is carried forward across days nothing was recorded */
  carried?: boolean;
}

export interface NetWorthBreak {
  date: ISODate;
  accountsAdded: number;
  names: string[];
  /** Combined size of the arriving accounts (absolute), for judging how much the picture changed. */
  addedCents: Cents;
}

export interface NetWorthSeriesDTO {
  points: NetWorthPoint[];
  breaks: NetWorthBreak[];
  /** The first date whose point is comparable to today (after the last break). */
  comparableFrom: ISODate | null;
}

export interface NetWorthChange {
  start: ISODate;
  end: ISODate;
  /** Like-for-like: only accounts present at both ends. */
  startCents: Cents;
  endCents: Cents;
  changeCents: Cents;
  marketCents: Cents;
  contributionsCents: Cents;
  cashCents: Cents;
  /** Positive when debt went down. */
  debtPaydownCents: Cents;
  otherCents: Cents;
  byGroup: Partial<
    Record<AccountGroup, { startCents: Cents; endCents: Cents }>
  >;
  /** Accounts that joined during the period and so aren't compared. */
  joined: Array<{ name: string; date: ISODate }>;
  /** Full net worth at the end date, all accounts. */
  netWorthCents: Cents;
}

export interface SpendingCategoryDTO {
  categoryId: string;
  spentCents: Cents;
  /** Same category, whole previous month. */
  prevSpentCents: Cents;
  count: number;
  budget: BudgetProgress | null;
}

export interface SpendingSummaryDTO {
  month: string;
  start: ISODate;
  end: ISODate;
  isCurrent: boolean;
  spentCents: Cents;
  incomeCents: Cents;
  /** Bank income less spending. */
  netCents: Cents;
  /** What is left of income after spending. */
  savedCents: Cents;
  savingsRate: number | null;
  prevSpentCents: Cents;
  /** Previous month, up to the same day of the month (for pace). */
  prevSpentToDateCents: Cents;
  categories: SpendingCategoryDTO[];
  merchants: Array<{
    merchant: string;
    spentCents: Cents;
    count: number;
    categoryId: string;
    logoUrl: string | null;
  }>;
  /** Cumulative spending by day of month, this month and last. */
  daily: Array<{ day: number; cents: Cents | null; prevCents: Cents | null }>;
}

export interface CashflowMonthDTO {
  month: string;
  incomeCents: Cents;
  spendingCents: Cents;
  netCents: Cents;
  byCategory: Record<string, Cents>;
}

export interface RecurringSeriesDTO extends RecurringSeries {
  accountName: string;
}

export interface RecurringDTO {
  series: RecurringSeriesDTO[];
  upcoming: Array<{
    date: ISODate;
    key: string;
    merchant: string;
    amountCents: Cents;
    kind: RecurringSeries["kind"];
    categoryId: string;
  }>;
  monthlyOutCents: Cents;
  monthlyInCents: Cents;
  subscriptionsMonthlyCents: Cents;
  hidden: string[];
}

export interface BudgetRowDTO {
  categoryId: string;
  rollover: boolean;
  progress: BudgetProgress;
  /** Spending in the previous six months, oldest first. */
  history: Cents[];
}

export interface BudgetsDTO {
  month: string;
  rows: BudgetRowDTO[];
  suggestions: BudgetSuggestion[];
  totalBudgetCents: Cents;
  totalSpentCents: Cents;
  /** Spending this month in categories without a budget. */
  unbudgetedCents: Cents;
}

export interface ForecastDTO extends Forecast {
  /** Balance below which the forecast warns. */
  thresholdCents: Cents;
  warning: string | null;
}

export interface RuleDTO {
  id: string;
  merchantKey: string | null;
  merchant: string | null;
  categoryId: string;
  matches: number;
  createdAt: string;
}

export interface HoldingDTO {
  securityId: string;
  ticker: string | null;
  name: string;
  type: string | null;
  assetMix: AssetMix;
  /** "confirmed": suggested by Claude and accepted by you. */
  classification: "curated" | "type" | "confirmed" | "unknown";
  quantity: number;
  priceCents: number | null;
  valueCents: Cents;
  costBasisCents: Cents | null;
  gainCents: Cents | null;
  gainPct: number | null;
  dayChangeCents: Cents | null;
  /** Share of the portfolio. */
  weight: number;
  expenseRatio: number | null;
  accounts: Array<{
    accountId: string;
    name: string;
    quantity: number;
    valueCents: Cents;
    costBasisCents: Cents | null;
  }>;
}

export interface PerformancePeriod {
  key: "1m" | "3m" | "ytd" | "1y" | "all";
  start: ISODate;
  startCents: Cents;
  endCents: Cents;
  contributionsCents: Cents;
  /** What came in and went out, gross — moves between these accounts left out. */
  addedInCents: Cents;
  takenOutCents: Cents;
  growthCents: Cents;
  /** The investments' own return (deposits removed). */
  twr: number | null;
  /** Your annualised return, including when you added money. */
  mwr: number | null;
  benchmark: number | null;
}

export interface InvestmentsDTO {
  valueCents: Cents;
  costBasisCents: Cents;
  gainCents: Cents | null;
  gainPct: number | null;
  dayChangeCents: Cents | null;
  holdings: HoldingDTO[];
  /** Investment accounts Ikat has balances for but no holdings (e.g. access not granted). */
  withoutHoldings: Array<{
    accountId: string;
    name: string;
    institutionName: string;
    valueCents: Cents;
    connectionId: string;
  }>;
  allocation: Array<{ assetClass: AssetClass; valueCents: Cents; pct: number }>;
  byKind: Array<{ kind: InvestmentKind; valueCents: Cents }>;
  byTax: Array<{ treatment: TaxTreatment; valueCents: Cents }>;
  accounts: Array<{
    accountId: string;
    name: string;
    institutionName: string;
    institutionColor: string | null;
    institutionLogo: string | null;
    kind: InvestmentKind;
    valueCents: Cents;
    gainCents: Cents | null;
    includeInNetWorth: boolean;
  }>;
  performance: PerformancePeriod[];
  benchmarkTicker: string | null;
  history: Array<{
    date: ISODate;
    valueCents: Cents;
    contributedCents: Cents;
    observed: boolean;
  }>;
  dividends: {
    last12Cents: Cents;
    byMonth: Array<{ month: string; cents: Cents }>;
  };
  fees: {
    weightedExpenseRatio: number | null;
    annualCostCents: Cents;
    coveredPct: number;
  };
  activity: Array<{
    id: string;
    date: ISODate;
    accountName: string;
    name: string;
    type: string;
    subtype: string | null;
    ticker: string | null;
    quantity: number;
    amountCents: Cents;
  }>;
}

export interface RewardCardDTO {
  accountId: string;
  name: string;
  institutionName: string;
  institutionColor: string | null;
  institutionLogo: string | null;
  mask: string | null;
  catalogId: string | null;
  catalogName: string | null;
  identifiedBy: "user" | "name" | "fee" | null;
  programName: string | null;
  floorCents: number;
  floorNote: string | null;
  transferCents: number | null;
  annualFeeCents: number;
  feeSource: "statement" | "catalog" | "none";
  feeNote: string | null;
  earned12: {
    points: number;
    valueCents: number;
    spendCents: number;
    lowConfidencePct: number;
  };
  credits: Array<{
    id: string;
    name: string;
    amountCents: number;
    usedCents: number;
    periodLabel: string;
    periodEnds: ISODate;
    used12Cents: number;
  }>;
  netValue12Cents: number;
  /** What the card adds beyond your other cards (routing each purchase to the best card), plus credits used. */
  incrementalCents: number;
  /** What it would earn if used for everything it's the best card for. */
  potentialCents: number;
  /** Judged against your other cards, not against having no card. */
  verdict: "keep" | "review" | "no_fee";
  signupBonus: {
    points: number;
    spendCents: number;
    spentCents: number;
    deadline: ISODate;
    status: "in_progress" | "earned" | "missed";
  } | null;
  notModeled: string[];
  balanceCents: number;
  limitCents: number | null;
  utilization: number | null;
  statementBalanceCents: number | null;
  dueDate: ISODate | null;
  minimumPaymentCents: number | null;
  aprPercent: number | null;
}

export interface BestCardDTO {
  accountId: string;
  cardName: string;
  multiplier: number;
  centsPerDollar: number;
  note: string | null;
}

export interface RewardsDTO {
  catalogAsOf: string;
  cards: RewardCardDTO[];
  byCategory: Array<{
    category: string;
    label: string;
    spend12Cents: number;
    best: BestCardDTO;
    runnerUp: BestCardDTO | null;
    usedMostly: string | null;
  }>;
  merchants: Array<{
    merchant: string;
    categoryId: string;
    spend12Cents: number;
    best: BestCardDTO;
    usedMostly: string | null;
    gainCents: number;
  }>;
  missed: {
    totalCents: number;
    days: number;
    items: Array<{
      txId: string;
      date: ISODate;
      merchant: string;
      amountCents: number;
      usedCard: string;
      usedValueCents: number;
      bestCard: string;
      bestValueCents: number;
    }>;
  };
  rotations: Array<{ cardName: string; quarter: string; label: string | null }>;
  optimizer: {
    walletValueCents: number;
    add: Array<{
      catalogId: string;
      name: string;
      issuer: string;
      annualFeeCents: number;
      ongoingCents: number;
      firstYearCents: number;
      why: string;
    }>;
    drop: Array<{
      accountId: string;
      name: string;
      annualFeeCents: number;
      valueLostCents: number;
      netCents: number;
    }>;
  };
  points: Array<{
    program: string;
    points: number;
    floorValueCents: number;
    transferValueCents: number | null;
  }>;
  utilization: { balanceCents: number; limitCents: number; pct: number | null };
}

export interface CatalogCardDTO {
  id: string;
  name: string;
  issuer: string;
  annualFeeCents: number;
}

export interface LoanDTO {
  accountId: string;
  name: string;
  institutionName: string;
  institutionColor: string | null;
  institutionLogo: string | null;
  kind: string;
  balanceCents: Cents;
  aprPercent: number | null;
  /** "itemised": solved from the interest the lender lists on each payment. */
  aprSource: "provider" | "itemised" | "inferred" | null;
  paymentCents: number | null;
  paymentSource: "provider" | "inferred" | null;
  /** Charges the lender adds each month (financed insurance, fees), which slow the payoff. */
  addOnsMonthlyCents: Cents | null;
  nextDueDate: ISODate | null;
  monthsLeft: number | null;
  payoffDate: ISODate | null;
  interestLeftCents: Cents | null;
  interestPaid12Cents: Cents | null;
  principalPaid12Cents: Cents | null;
  /** Where "the last 12 months" actually starts — later when the loan's record is shorter. */
  paid12From: ISODate | null;
  history: Array<{ date: ISODate; cents: Cents }>;
}

export interface LoansDTO {
  loans: LoanDTO[];
  /** Cards carrying a balance past the statement (paid-in-full cards aren't debt). */
  revolving: Array<{
    accountId: string;
    name: string;
    balanceCents: Cents;
    aprPercent: number;
    minimumPaymentCents: Cents;
  }>;
  /** Regular loan payments to lenders that aren't linked. */
  unlinked: Array<{
    merchant: string;
    amountCents: Cents;
    cadence: string;
    since: ISODate;
    accountName: string;
  }>;
  totalDebtCents: Cents;
  monthlyPaymentsCents: Cents;
}

export interface EquityVestDTO {
  date: ISODate;
  grossShares: number;
  /** Null when the sale-to-cover isn't visible. */
  soldToCover: number | null;
  priceCents: number;
  withholdingRate: number | null;
  valueCents: Cents;
  /** "activity": the plan's own records; "units": a drop in the award's unit count. */
  source: "activity" | "units";
}

export interface EquityDTO {
  accounts: Array<{
    accountId: string;
    name: string;
    institutionName: string;
    includeInNetWorth: boolean;
    valueCents: Cents;
  }>;
  /** The employer's real ticker (an award placeholder like "ACME.RSU" resolves to ACME). */
  ticker: string | null;
  companyName: string | null;
  priceCents: number | null;
  /** Granted but not yet vested — not yours until it vests. */
  unvested: { shares: number; valueCents: Cents; inNetWorth: boolean } | null;
  /** The employer's shares you own, wherever they're held. */
  held: {
    shares: number;
    valueCents: Cents;
    accounts: Array<{
      accountId: string;
      name: string;
      shares: number;
      valueCents: Cents;
      inNetWorth: boolean;
    }>;
  };
  vests: EquityVestDTO[];
  cadenceMonths: number | null;
  typicalShares: number | null;
  withholdingRate: number | null;
  projected: Array<{ date: ISODate; shares: number; valueCents: Cents }>;
  projectedValueCents: Cents;
  vestIncome12Cents: Cents;
  bracket: { marginal: number; basis: string } | null;
  gapNext12Cents: Cents | null;
  /** Owned employer stock in net worth; `withUnvestedPct` if the unvested units were yours too. */
  concentration: {
    valueCents: Cents;
    pctOfNetWorth: number;
    withUnvestedPct: number | null;
  } | null;
}

export interface TaxProfile {
  filingStatus: "single" | "joint";
  /** Only needed for catch-up limits (50+). */
  birthYear: number | null;
  /** HSA coverage; null = infer from contributions. */
  hsaCoverage: "self" | "family" | null;
}

export interface ContributionDTO {
  bucket: "deferral" | "ira" | "hsa";
  label: string;
  accounts: string[];
  /** Your own contributions this tax year (what counts toward the limit). */
  employeeCents: Cents;
  /** Employer money: counts toward the HSA limit, not the 401(k) deferral limit. */
  employerCents: Cents;
  rolloverCents: Cents;
  limitCents: Cents;
  catchUpCents: Cents;
  /** Where the year ends at the current pace; null when it's too early to tell. */
  projectedCents: Cents | null;
  /** Null when the whole year is visible; otherwise the first day Ikat can see. */
  coverageFrom: ISODate | null;
  roomCents: Cents;
  /** Extra per remaining paycheck (or month, for IRAs) to reach the limit. */
  toMaxPerPeriodCents: Cents | null;
  period: "paycheck" | "month";
  note: string | null;
}

export interface RealizedSaleDTO {
  date: ISODate;
  accountName: string;
  ticker: string | null;
  name: string;
  quantity: number;
  proceedsCents: Cents;
  costCents: Cents | null;
  gainCents: Cents | null;
  term: "short" | "long" | "unknown" | "mixed";
  estimatedBasis: boolean;
  /** Part of a loss disallowed by a wash sale. */
  washDisallowedCents: Cents;
}

export interface HarvestDTO {
  securityId: string;
  ticker: string | null;
  name: string;
  accountId: string;
  accountName: string;
  valueCents: Cents;
  costCents: Cents;
  lossCents: Cents;
  shortTermLossCents: Cents;
  longTermLossCents: Cents;
  /** Up to this much tax saved, at your estimated rates. */
  savingCents: Cents;
  swaps: string[];
  /** Crypto isn't subject to the wash-sale rule (as of 2026). */
  washExempt: boolean;
  blockers: Array<{
    kind: "recent_buy" | "recurring_buy" | "reinvesting" | "upcoming_vest";
    date: ISODate;
    accountName: string;
    until: ISODate;
    taxAdvantaged: boolean;
  }>;
}

export interface WashWatchDTO {
  date: ISODate;
  ticker: string | null;
  accountName: string;
  lossCents: Cents;
  windowEnd: ISODate;
  conflicts: Array<{
    date: ISODate;
    accountName: string;
    quantity: number;
    reinvested: boolean;
    taxAdvantaged: boolean;
    relation: "identical" | "same_index";
  }>;
  disallowedCents: Cents;
}

export interface TaxDTO {
  year: number;
  /** False when this year's IRS figures aren't in Ikat yet (last year's are used). */
  exactYear: boolean;
  profile: TaxProfile & { hsaCoverageInferred: "self" | "family" | null };
  income: {
    grossCents: Cents | null;
    taxableCents: Cents | null;
    marginal: number | null;
    longTermRate: number | null;
    basis: string;
  };
  contributions: ContributionDTO[];
  roth: {
    status: "eligible" | "reduced" | "ineligible";
    range: [number, number];
  } | null;
  treatment: Array<{ treatment: TaxTreatment; valueCents: Cents }>;
  realized: {
    shortTermCents: Cents;
    longTermCents: Cents;
    unknownTermCents: Cents;
    unknownBasisProceedsCents: Cents;
    disallowedCents: Cents;
    estimatedTaxCents: Cents | null;
    sales: RealizedSaleDTO[];
  };
  harvest: HarvestDTO[];
  washWatch: WashWatchDTO[];
}

export interface GoalDTO {
  id: string;
  name: string;
  targetCents: Cents;
  targetDate: ISODate | null;
  accountIds: string[];
  accountNames: string[];
  currentCents: Cents;
  /** Change in the funding accounts per month, over the last 90 days. */
  monthlyPaceCents: Cents;
  neededMonthlyCents: Cents;
  projectedCents: Cents;
  onTrack: boolean;
  progress: number;
  /** When the current pace reaches the target; null if it doesn't. */
  reachDate: ISODate | null;
}

export interface PlanDTO {
  age: number | null;
  /** Months of history behind the yearly figures (up to 12). */
  monthsObserved: number;
  annualSpendingCents: Cents;
  essentialMonthlyCents: Cents;
  annualIncomeCents: Cents;
  /** Stock that vested in the last year, less the tax withheld. */
  annualVestsCents: Cents;
  /** Cash kept (income − spending), plus payroll retirement and HSA contributions and vested stock after tax. */
  annualSavingCents: Cents;
  savingsRate: number | null;
  cashCents: Cents;
  investedCents: Cents;
  stockShare: number;
  emergency: {
    targetMonths: number;
    targetCents: Cents;
    monthsCovered: number;
  };
  fi: {
    withdrawalRate: number;
    numberCents: Cents;
    progress: number;
    years: number | null;
    realReturn: number;
  };
  goals: GoalDTO[];
  accounts: Array<{
    id: string;
    name: string;
    group: string;
    balanceCents: Cents;
  }>;
}

export interface ReviewDTO {
  month: string;
  /** False while the month is still under way. */
  complete: boolean;
  /** When this review was saved; null for one computed live. */
  generatedAt: string | null;
  netWorth: NetWorthChange | null;
  cash: {
    incomeCents: Cents;
    spentCents: Cents;
    netCents: Cents;
    payrollSavingCents: Cents;
    vestsCents: Cents;
    savedCents: Cents;
    savingsRate: number | null;
    prevSpentCents: Cents;
  };
  categories: Array<{
    categoryId: string;
    spentCents: Cents;
    prevSpentCents: Cents;
    budgetCents: Cents | null;
  }>;
  overBudget: Array<{
    categoryId: string;
    spentCents: Cents;
    budgetCents: Cents;
  }>;
  merchants: Array<{
    merchant: string;
    spentCents: Cents;
    count: number;
    categoryId: string;
    logoUrl: string | null;
  }>;
  subscriptions: {
    monthlyCents: Cents;
    added: Array<{ merchant: string; amountCents: Cents; cadence: string }>;
    raised: Array<{ merchant: string; fromCents: Cents; toCents: Cents }>;
  };
  investing: {
    marketCents: Cents;
    contributionsCents: Cents;
    dividendsCents: Cents;
  };
  rewards: {
    missedCents: Cents;
    missed: Array<{
      merchant: string;
      amountCents: Cents;
      usedCard: string;
      bestCard: string;
      lostCents: Cents;
    }>;
  };
  goals: Array<{ name: string; progress: number; onTrack: boolean }>;
  notable: Array<{
    date: ISODate;
    merchant: string;
    amountCents: Cents;
    categoryId: string;
    why: "largest" | "first_time" | "income";
  }>;
  /** Claude's written summary, when AI is on. */
  summary: string | null;
}

export interface ReviewListDTO {
  months: Array<{ month: string; saved: boolean; complete: boolean }>;
}

export interface SetupItemDTO {
  id: "link";
  label: string;
  detail: string;
  done: boolean;
  /** Worth doing, but Ikat works fully without it. */
  optional: boolean;
  link: string;
}

export interface SetupDTO {
  items: SetupItemDTO[];
  dismissed: boolean;
}

export interface AiSuggestionDTO {
  id: string;
  kind: "fund_class" | "merchant_name";
  subject: string;
  /** What it's about, as shown today ("VANG INST 500 IDX TR", "Harbor Cu"). */
  label: string;
  /** fund_class: the mix and expense ratio; merchant_name: the clean name. */
  suggestion: {
    mix?: Record<string, number>;
    expenseRatio?: number | null;
    name?: string;
    note?: string;
  };
}
