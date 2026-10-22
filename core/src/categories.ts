// The category taxonomy. Two design rules:
//
// 1. Split what card issuers reward separately. Groceries is not Dining, Gas is
//    not Transit, Streaming is not Entertainment — issuers pay different
//    multipliers on each, so merging them makes "which card should I use"
//    unanswerable. The line for food is where you eat it: restaurants and bars
//    are Dining; supermarkets are Groceries.
// 2. `kind` decides what counts. Only "expense" is spending. Transfers and
//    card payments move money between your own accounts; counting them would
//    double-count every purchase that a card payment later settles.

export type CategoryKind = "expense" | "income" | "transfer";

export interface CategoryDef {
  id: string;
  name: string;
  kind: CategoryKind;
  /** lucide icon name, rendered by the web app */
  icon: string;
  /** Essential spending feeds the emergency-fund and FI math. */
  essential?: boolean;
}

export const CATEGORIES: CategoryDef[] = [
  // Expense
  { id: "dining", name: "Dining", kind: "expense", icon: "utensils" },
  {
    id: "groceries",
    name: "Groceries",
    kind: "expense",
    icon: "shopping-basket",
    essential: true,
  },
  { id: "coffee", name: "Coffee", kind: "expense", icon: "coffee" },
  {
    id: "gas",
    name: "Gas & EV charging",
    kind: "expense",
    icon: "fuel",
    essential: true,
  },
  {
    id: "transit",
    name: "Transit & rideshare",
    kind: "expense",
    icon: "train-front",
    essential: true,
  },
  {
    id: "auto",
    name: "Auto & parking",
    kind: "expense",
    icon: "car",
    essential: true,
  },
  { id: "travel", name: "Travel", kind: "expense", icon: "plane" },
  {
    id: "lodging",
    name: "Hotels & lodging",
    kind: "expense",
    icon: "bed-double",
  },
  { id: "shopping", name: "Shopping", kind: "expense", icon: "shopping-bag" },
  { id: "online", name: "Online shopping", kind: "expense", icon: "package" },
  { id: "home", name: "Home & garden", kind: "expense", icon: "sofa" },
  {
    id: "rent",
    name: "Rent & mortgage",
    kind: "expense",
    icon: "house",
    essential: true,
  },
  {
    id: "utilities",
    name: "Utilities",
    kind: "expense",
    icon: "zap",
    essential: true,
  },
  {
    id: "phone_internet",
    name: "Phone & internet",
    kind: "expense",
    icon: "wifi",
    essential: true,
  },
  { id: "streaming", name: "Streaming", kind: "expense", icon: "tv" },
  {
    id: "software",
    name: "Software & apps",
    kind: "expense",
    icon: "app-window",
  },
  {
    id: "entertainment",
    name: "Entertainment",
    kind: "expense",
    icon: "ticket",
  },
  {
    id: "health",
    name: "Health & medical",
    kind: "expense",
    icon: "heart-pulse",
    essential: true,
  },
  { id: "fitness", name: "Fitness", kind: "expense", icon: "dumbbell" },
  {
    id: "personal_care",
    name: "Personal care",
    kind: "expense",
    icon: "sparkles",
  },
  {
    id: "insurance",
    name: "Insurance",
    kind: "expense",
    icon: "shield",
    essential: true,
  },
  {
    id: "education",
    name: "Education",
    kind: "expense",
    icon: "graduation-cap",
  },
  { id: "kids", name: "Kids & family", kind: "expense", icon: "baby" },
  { id: "pets", name: "Pets", kind: "expense", icon: "paw-print" },
  { id: "gifts", name: "Gifts & donations", kind: "expense", icon: "gift" },
  { id: "fees", name: "Fees & interest", kind: "expense", icon: "receipt" },
  {
    id: "taxes",
    name: "Taxes",
    kind: "expense",
    icon: "landmark",
    essential: true,
  },
  { id: "services", name: "Services", kind: "expense", icon: "wrench" },
  {
    id: "loan_payment",
    name: "Loan payments",
    kind: "expense",
    icon: "hand-coins",
    essential: true,
  },
  { id: "other", name: "Other", kind: "expense", icon: "circle-dashed" },
  // Income
  { id: "paycheck", name: "Paycheck", kind: "income", icon: "briefcase" },
  {
    id: "interest_income",
    name: "Interest & dividends",
    kind: "income",
    icon: "percent",
  },
  { id: "refund", name: "Refunds & returns", kind: "income", icon: "undo-2" },
  {
    id: "rewards_income",
    name: "Rewards & cashback",
    kind: "income",
    icon: "badge-percent",
  },
  {
    id: "other_income",
    name: "Other income",
    kind: "income",
    icon: "plus-circle",
  },
  // Transfers
  {
    id: "transfer",
    name: "Transfer",
    kind: "transfer",
    icon: "arrow-left-right",
  },
  {
    id: "card_payment",
    name: "Card payment",
    kind: "transfer",
    icon: "credit-card",
  },
  {
    id: "investment_transfer",
    name: "Investment contribution",
    kind: "transfer",
    icon: "trending-up",
  },
];

export const CATEGORY_BY_ID: Record<string, CategoryDef> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
);

export function categoryKind(id: string | null | undefined): CategoryKind {
  return (id && CATEGORY_BY_ID[id]?.kind) || "expense";
}

// ---------------------------------------------------------------------------
// Merchant category codes. The card network's own code is what issuers pay
// multipliers on, so when a transaction carries one it beats the aggregator's
// name-based guess. The map is deliberately partial: an unmapped code returns
// null and defers to the aggregator, because a wrong confident mapping is worse
// than falling through. Deliberately absent: 4899 (cable/satellite — mostly
// internet bills, not streaming) and 7997 (membership clubs — golf and social
// clubs as often as gyms). Both were tried in the predecessor app and made
// categorisation worse.

const MCC_RANGES: Array<[number, number, string]> = [
  [3000, 3350, "travel"], // airlines
  [3351, 3500, "auto"], // car rental
  [3501, 3999, "lodging"], // hotels
];

const MCC_EXACT: Record<number, string> = {
  4111: "transit",
  4112: "transit",
  4121: "transit",
  4131: "transit",
  4789: "transit",
  4511: "travel",
  4411: "travel",
  4722: "travel",
  7011: "lodging",
  7012: "lodging",
  4784: "auto",
  7523: "auto",
  7512: "auto",
  7538: "auto",
  7542: "auto",
  5511: "auto",
  5521: "auto",
  5532: "auto",
  5533: "auto",
  5541: "gas",
  5542: "gas",
  5552: "gas",
  5983: "gas",
  5411: "groceries",
  5422: "groceries",
  5441: "groceries",
  5451: "groceries",
  5499: "groceries",
  5921: "groceries",
  5812: "dining",
  5813: "dining",
  5814: "dining",
  5815: "streaming",
  5816: "entertainment",
  5817: "software",
  5818: "software",
  4812: "phone_internet",
  4814: "phone_internet",
  4816: "phone_internet",
  4900: "utilities",
  5912: "health",
  8011: "health",
  8021: "health",
  8031: "health",
  8041: "health",
  8042: "health",
  8043: "health",
  8049: "health",
  8050: "health",
  8062: "health",
  8071: "health",
  8099: "health",
  7941: "entertainment",
  7832: "entertainment",
  7922: "entertainment",
  7991: "entertainment",
  7996: "entertainment",
  7999: "entertainment",
  7230: "personal_care",
  7298: "personal_care",
  5200: "home",
  5211: "home",
  5251: "home",
  5261: "home",
  5712: "home",
  5719: "home",
  5722: "home",
  5300: "shopping",
  5310: "shopping",
  5311: "shopping",
  5331: "shopping",
  5399: "shopping",
  5611: "shopping",
  5621: "shopping",
  5651: "shopping",
  5661: "shopping",
  5691: "shopping",
  5699: "shopping",
  5732: "shopping",
  5734: "software",
  5942: "shopping",
  5945: "shopping",
  5947: "gifts",
  5992: "gifts",
  5964: "online",
  5965: "online",
  5966: "online",
  5967: "online",
  5968: "online",
  5969: "online",
  6300: "insurance",
  5960: "insurance",
  8211: "education",
  8220: "education",
  8241: "education",
  8244: "education",
  8249: "education",
  8299: "education",
  8351: "kids",
  5641: "kids",
  742: "pets",
  5995: "pets",
  8398: "gifts",
  8661: "gifts",
  9311: "taxes",
  9222: "fees",
  9211: "fees",
  9399: "fees",
  7349: "services",
  7299: "services",
  1520: "services",
  1711: "services",
};

export function categoryForMcc(
  mcc: string | number | null | undefined,
): string | null {
  if (mcc == null || mcc === "") return null;
  const code = typeof mcc === "number" ? mcc : Number.parseInt(mcc, 10);
  if (!Number.isFinite(code)) return null;
  const exact = MCC_EXACT[code];
  if (exact) return exact;
  for (const [lo, hi, cat] of MCC_RANGES)
    if (code >= lo && code <= hi) return cat;
  return null;
}

// ---------------------------------------------------------------------------
// Plaid personal_finance_category → Ikat. Detailed first (it is where Groceries
// and Gas are distinguishable), then the primary as a fallback.

const PFC_DETAILED: Record<string, string> = {
  FOOD_AND_DRINK_GROCERIES: "groceries",
  FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR: "groceries",
  FOOD_AND_DRINK_COFFEE: "coffee",
  FOOD_AND_DRINK_FAST_FOOD: "dining",
  FOOD_AND_DRINK_RESTAURANT: "dining",
  FOOD_AND_DRINK_VENDING_MACHINES: "dining",
  FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK: "dining",
  TRANSPORTATION_GAS: "gas",
  TRANSPORTATION_PUBLIC_TRANSIT: "transit",
  TRANSPORTATION_TAXIS_AND_RIDE_SHARES: "transit",
  TRANSPORTATION_BIKES_AND_SCOOTERS: "transit",
  TRANSPORTATION_PARKING: "auto",
  TRANSPORTATION_TOLLS: "auto",
  TRANSPORTATION_OTHER_TRANSPORTATION: "auto",
  TRAVEL_FLIGHTS: "travel",
  TRAVEL_LODGING: "lodging",
  TRAVEL_RENTAL_CARS: "auto",
  TRAVEL_OTHER_TRAVEL: "travel",
  ENTERTAINMENT_TV_AND_MOVIES: "streaming",
  ENTERTAINMENT_MUSIC_AND_AUDIO: "streaming",
  ENTERTAINMENT_VIDEO_GAMES: "entertainment",
  ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS: "entertainment",
  ENTERTAINMENT_CASINOS_AND_GAMBLING: "entertainment",
  ENTERTAINMENT_OTHER_ENTERTAINMENT: "entertainment",
  GENERAL_MERCHANDISE_ONLINE_MARKETPLACES: "online",
  GENERAL_MERCHANDISE_SUPERSTORES: "shopping",
  GENERAL_MERCHANDISE_PET_SUPPLIES: "pets",
  GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES: "gifts",
  GENERAL_MERCHANDISE_BOOKSTORES_AND_NEWSSTANDS: "shopping",
  GENERAL_MERCHANDISE_OFFICE_SUPPLIES: "shopping",
  GENERAL_SERVICES_INSURANCE: "insurance",
  GENERAL_SERVICES_EDUCATION: "education",
  GENERAL_SERVICES_CHILDCARE: "kids",
  GENERAL_SERVICES_AUTOMOTIVE: "auto",
  RENT_AND_UTILITIES_RENT: "rent",
  RENT_AND_UTILITIES_TELEPHONE: "phone_internet",
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: "phone_internet",
  RENT_AND_UTILITIES_GAS_AND_ELECTRICITY: "utilities",
  RENT_AND_UTILITIES_WATER: "utilities",
  RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT: "utilities",
  RENT_AND_UTILITIES_OTHER_UTILITIES: "utilities",
  PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS: "fitness",
  PERSONAL_CARE_HAIR_AND_BEAUTY: "personal_care",
  PERSONAL_CARE_LAUNDRY_AND_DRY_CLEANING: "personal_care",
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: "card_payment",
  LOAN_PAYMENTS_CAR_PAYMENT: "loan_payment",
  LOAN_PAYMENTS_MORTGAGE_PAYMENT: "rent",
  LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT: "loan_payment",
  LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT: "loan_payment",
  LOAN_PAYMENTS_OTHER_PAYMENT: "loan_payment",
  TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS: "investment_transfer",
  TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS: "investment_transfer",
  INCOME_WAGES: "paycheck",
  INCOME_SALARY: "paycheck", // PFC v2's name for wages
  INCOME_RENTAL: "other_income",
  INCOME_CONTRACTOR: "other_income",
  INCOME_DIVIDENDS: "interest_income",
  INCOME_INTEREST_EARNED: "interest_income",
  INCOME_RETIREMENT_PENSION: "other_income",
  INCOME_TAX_REFUND: "other_income",
  INCOME_UNEMPLOYMENT: "other_income",
  INCOME_OTHER_INCOME: "other_income",
  BANK_FEES_INTEREST_CHARGE: "fees",
  GOVERNMENT_AND_NON_PROFIT_DONATIONS: "gifts",
  GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT: "taxes",
};

const PFC_PRIMARY: Record<string, string> = {
  FOOD_AND_DRINK: "dining",
  TRANSPORTATION: "transit",
  TRAVEL: "travel",
  ENTERTAINMENT: "entertainment",
  GENERAL_MERCHANDISE: "shopping",
  GENERAL_SERVICES: "services",
  HOME_IMPROVEMENT: "home",
  MEDICAL: "health",
  PERSONAL_CARE: "personal_care",
  RENT_AND_UTILITIES: "utilities",
  LOAN_PAYMENTS: "loan_payment",
  BANK_FEES: "fees",
  GOVERNMENT_AND_NON_PROFIT: "taxes",
  INCOME: "other_income",
  LOAN_DISBURSEMENTS: "transfer", // borrowed money isn't income
  TRANSFER_IN: "transfer",
  TRANSFER_OUT: "transfer",
};

export function categoryForProvider(
  primary: string | null | undefined,
  detailed: string | null | undefined,
): string | null {
  if (detailed && PFC_DETAILED[detailed]) return PFC_DETAILED[detailed];
  if (primary && PFC_PRIMARY[primary]) return PFC_PRIMARY[primary];
  return null;
}
