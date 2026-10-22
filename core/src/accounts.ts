// How an account is classified drives net worth, grouping and tax treatment.
// Classification runs on the provider's *type*, and only refines by subtype:
// subtype is a long open list (Plaid alone has ~50 investment subtypes), and an
// unrecognised one must land somewhere sensible, never vanish from a total.

export type AccountType =
  "depository" | "credit" | "loan" | "investment" | "property" | "other";

export type AccountGroup =
  "cash" | "cards" | "investments" | "loans" | "property" | "other";

export const GROUP_ORDER: AccountGroup[] = [
  "cash",
  "cards",
  "investments",
  "loans",
  "property",
  "other",
];

export const GROUP_LABELS: Record<AccountGroup, string> = {
  cash: "Cash",
  cards: "Credit cards",
  investments: "Investments",
  loans: "Loans",
  property: "Property",
  other: "Other",
};

/** Sub-buckets inside investments; the retirement/tax views key off these. */
export type InvestmentKind =
  "retirement" | "hsa" | "education" | "crypto" | "stock_plan" | "taxable";

export type TaxTreatment = "taxable" | "tax_deferred" | "tax_free";

export function normalizeType(type: string | null | undefined): AccountType {
  switch ((type ?? "").toLowerCase()) {
    case "depository":
      return "depository";
    case "credit":
      return "credit";
    case "loan":
      return "loan";
    case "investment":
    case "brokerage":
      return "investment";
    case "property":
      return "property";
    default:
      return "other";
  }
}

export function groupFor(
  type: string,
  override?: AccountGroup | null,
): AccountGroup {
  if (override) return override;
  switch (normalizeType(type)) {
    case "depository":
      return "cash";
    case "credit":
      return "cards";
    case "investment":
      return "investments";
    case "loan":
      return "loans";
    case "property":
      return "property";
    default:
      return "other";
  }
}

/** Liabilities are stored as positive balances owed and subtracted in net worth. */
export function isLiability(type: string): boolean {
  const t = normalizeType(type);
  return t === "credit" || t === "loan";
}

const RETIREMENT = new Set([
  "401a",
  "401k",
  "403b",
  "457b",
  "ira",
  "roth",
  "roth 401k",
  "sep ira",
  "simple ira",
  "sarsep",
  "keogh",
  "pension",
  "profit sharing plan",
  "retirement",
  "thrift savings plan",
  "rrsp",
  "rrif",
  "lira",
  "lif",
  "tfsa",
  "sipp",
]);

export function investmentKind(
  subtype: string | null | undefined,
): InvestmentKind {
  const s = (subtype ?? "").toLowerCase();
  if (s === "hsa" || s === "health savings account") return "hsa";
  if (s === "529" || s === "education savings account" || s === "coverdell")
    return "education";
  if (s === "crypto exchange" || s === "non-custodial wallet") return "crypto";
  if (s === "stock plan") return "stock_plan";
  if (RETIREMENT.has(s)) return "retirement";
  return "taxable";
}

export const INVESTMENT_KIND_LABELS: Record<InvestmentKind, string> = {
  retirement: "Retirement",
  hsa: "HSA",
  education: "Education",
  crypto: "Crypto",
  stock_plan: "Stock plan",
  taxable: "Brokerage",
};

const TAX_FREE = new Set([
  "roth",
  "roth 401k",
  "hsa",
  "health savings account",
  "529",
  "tfsa",
]);

export function taxTreatmentFor(
  type: string,
  subtype: string | null | undefined,
): TaxTreatment {
  if (normalizeType(type) !== "investment") return "taxable";
  const s = (subtype ?? "").toLowerCase();
  if (TAX_FREE.has(s)) return "tax_free";
  if (RETIREMENT.has(s)) return "tax_deferred";
  return "taxable";
}

/** A human label for a subtype: "401k" → "401(k)", "roth" → "Roth IRA". */
export function subtypeLabel(subtype: string | null | undefined): string {
  const s = (subtype ?? "").toLowerCase();
  const known: Record<string, string> = {
    "401k": "401(k)",
    "403b": "403(b)",
    "457b": "457(b)",
    "401a": "401(a)",
    roth: "Roth IRA",
    "roth 401k": "Roth 401(k)",
    ira: "IRA",
    "sep ira": "SEP IRA",
    "real estate": "Home",
    vehicle: "Vehicle",
    cash: "Cash",
    "other asset": "Asset",
    "money owed": "Money owed",
    "simple ira": "SIMPLE IRA",
    hsa: "HSA",
    "529": "529 plan",
    "crypto exchange": "Crypto",
    brokerage: "Brokerage",
    "stock plan": "Stock plan",
    checking: "Checking",
    savings: "Savings",
    "money market": "Money market",
    cd: "CD",
    "credit card": "Credit card",
    auto: "Auto loan",
    student: "Student loan",
    mortgage: "Mortgage",
    "home equity": "Home equity",
    "line of credit": "Line of credit",
  };
  if (known[s]) return known[s];
  return s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : "Account";
}
