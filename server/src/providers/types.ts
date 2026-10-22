import type { Cents, ISODate } from "@ikat/core";
import type { schema } from "../db";

// Every data source normalises into these shapes, so the sync engine has one
// write path whether the rows came from Plaid, the demo household or a file.
// Signs are already Ikat's: transaction amounts + in / − out.

export type ConnectionRow = typeof schema.connections.$inferSelect;

export interface ProviderInstitution {
  id: string | null;
  name: string;
  logo: string | null; // data: URL
  color: string | null;
}

export interface ProviderAccount {
  externalId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  currentCents: Cents | null;
  availableCents: Cents | null;
  limitCents: Cents | null;
  currency: string;
}

export interface ProviderTransaction {
  externalId: string;
  pendingExternalId: string | null;
  accountExternalId: string;
  date: ISODate;
  authorizedDate: ISODate | null;
  amountCents: Cents;
  currency: string;
  description: string;
  merchantName: string | null;
  logoUrl: string | null;
  website: string | null;
  mcc: string | null;
  providerCategory: string | null;
  providerCategoryDetailed: string | null;
  paymentChannel: string | null;
  pending: boolean;
  runningBalanceCents: Cents | null;
  location: {
    city?: string;
    region?: string;
    lat?: number;
    lon?: number;
  } | null;
}

export interface ProviderSecurity {
  externalId: string;
  ticker: string | null;
  name: string;
  type: string | null;
  cusip: string | null;
  isin: string | null;
  isCashEquivalent: boolean;
  closePrice: number | null; // dollars per unit
  closePriceAsOf: ISODate | null;
  sector: string | null;
  industry: string | null;
}

export interface ProviderHolding {
  accountExternalId: string;
  securityExternalId: string;
  quantity: number;
  price: number | null; // dollars per unit
  valueCents: Cents;
  costBasisCents: Cents | null;
  /** Stock plans report what has vested; null when not reported. */
  vestedQuantity?: number | null;
  vestedValueCents?: Cents | null;
}

export interface ProviderInvestmentTransaction {
  externalId: string;
  accountExternalId: string;
  securityExternalId: string | null;
  date: ISODate;
  name: string;
  type: string;
  subtype: string | null;
  quantity: number;
  price: number | null;
  /** + cash into the account, − cash out */
  amountCents: Cents;
  feesCents: Cents | null;
}

export interface ProviderLiability {
  accountExternalId: string;
  kind: "credit" | "student" | "mortgage" | "auto" | "personal" | "other";
  aprPercent: number | null;
  aprs: Array<{
    type: string;
    percent: number;
    balanceCents?: number | null;
  }> | null;
  lastStatementBalanceCents: Cents | null;
  lastStatementDate: ISODate | null;
  minimumPaymentCents: Cents | null;
  nextPaymentDueDate: ISODate | null;
  lastPaymentCents: Cents | null;
  lastPaymentDate: ISODate | null;
  isOverdue: boolean | null;
  originationDate: ISODate | null;
  originationPrincipalCents: Cents | null;
  termMonths: number | null;
  maturityDate: ISODate | null;
  paymentCents: Cents | null;
}

export interface ProviderSnapshot {
  accountExternalId: string;
  date: ISODate;
  currentCents: Cents | null;
  availableCents: Cents | null;
}

export interface ProviderPrice {
  securityExternalId: string;
  date: ISODate;
  close: number;
}

export interface SyncResult {
  institution: ProviderInstitution | null;
  accounts: ProviderAccount[];
  transactions: {
    added: ProviderTransaction[];
    modified: ProviderTransaction[];
    removed: string[];
    cursor: string | null;
    /** e.g. "HISTORICAL_UPDATE_COMPLETE"; null when the provider doesn't say. */
    updateStatus?: string | null;
  };
  /** null = this connection has no investment data (or isn't allowed to share it) */
  investments: {
    securities: ProviderSecurity[];
    holdings: ProviderHolding[];
    transactions: ProviderInvestmentTransaction[];
  } | null;
  liabilities: ProviderLiability[] | null;
  /** Products the institution supports but the user hasn't consented to share. */
  missingConsent: string[];
  /** Products this connection now has. */
  products: string[];
  /** Historical snapshots and prices — only the demo provides these. */
  history?: { snapshots: ProviderSnapshot[]; prices: ProviderPrice[] };
}

/** Thrown when the user must act (sign in again) before this connection can sync. */
export class ReauthRequired extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReauthRequired";
  }
}

export interface Provider {
  sync(
    conn: ConnectionRow,
    accessToken: string | null,
    today: ISODate,
  ): Promise<SyncResult>;
}
