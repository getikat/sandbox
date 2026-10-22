import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  type AccountBase,
  type LinkTokenCreateRequest,
  type Transaction,
} from "plaid";
import {
  addDays,
  isCorePosition,
  looksLikeCompany,
  toCents,
  type ISODate,
} from "@ikat/core";
import type { Config } from "../config";
import {
  ReauthRequired,
  type ConnectionRow,
  type Provider,
  type ProviderAccount,
  type ProviderInstitution,
  type ProviderInvestmentTransaction,
  type ProviderLiability,
  type ProviderTransaction,
  type SyncResult,
} from "./types";

const DAYS_REQUESTED = 730;

export function plaidClient(cfg: Config): PlaidApi | null {
  const { clientId, secret, env } = cfg.plaid;
  if (!clientId || !secret) return null;
  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[env],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": clientId,
          "PLAID-SECRET": secret,
          "Plaid-Version": "2020-09-14",
        },
      },
    }),
  );
}

/** Plaid errors arrive as axios errors with a structured body. */
export function plaidError(
  err: unknown,
): { code: string; type: string; message: string } | null {
  const data = (err as { response?: { data?: Record<string, string> } })
    ?.response?.data;
  if (!data?.error_code) return null;
  return {
    code: data.error_code,
    type: data.error_type ?? "",
    message: data.display_message || data.error_message || "",
  };
}

const REAUTH_CODES = new Set([
  "ITEM_LOGIN_REQUIRED",
  "PENDING_EXPIRATION",
  "PENDING_DISCONNECT",
  "ACCESS_NOT_GRANTED",
]);
/** Codes meaning "this product doesn't apply here" — silent, not a failure. */
const NOT_APPLICABLE = new Set([
  "PRODUCTS_NOT_SUPPORTED",
  "NO_INVESTMENT_ACCOUNTS",
  "NO_INVESTMENT_AUTH_ACCOUNTS",
  "NO_LIABILITY_ACCOUNTS",
  "NO_ACCOUNTS",
  "INVALID_PRODUCT",
  "PRODUCT_NOT_ENABLED",
]);

export function linkTokenRequest(opts: {
  userId: string;
  accessToken?: string;
  consentProducts?: string[];
}): LinkTokenCreateRequest {
  const base: LinkTokenCreateRequest = {
    client_name: "Ikat",
    language: "en",
    country_codes: [CountryCode.Us],
    user: { client_user_id: opts.userId },
  };
  if (opts.accessToken) {
    // Update mode: re-authenticate, or grant products the Item lacks.
    return {
      ...base,
      access_token: opts.accessToken,
      ...(opts.consentProducts?.length
        ? { additional_consented_products: opts.consentProducts as Products[] }
        : {}),
    };
  }
  return {
    ...base,
    products: [Products.Transactions],
    // Added when the institution supports them, so one link captures holdings
    // and loan details without the user choosing products they don't know.
    optional_products: [Products.Investments, Products.Liabilities],
    transactions: { days_requested: DAYS_REQUESTED },
  };
}

function cents(v: number | null | undefined): number | null {
  return v == null ? null : toCents(v);
}

function mapAccount(a: AccountBase): ProviderAccount {
  return {
    externalId: a.account_id,
    name: a.name,
    officialName: a.official_name ?? null,
    mask: a.mask ?? null,
    type: String(a.type),
    subtype: a.subtype ? String(a.subtype) : null,
    currentCents: cents(a.balances.current),
    availableCents: cents(a.balances.available),
    limitCents: cents(a.balances.limit),
    currency: a.balances.iso_currency_code ?? "USD",
  };
}

function mapTransaction(t: Transaction): ProviderTransaction {
  const pfc = t.personal_finance_category;
  return {
    externalId: t.transaction_id,
    pendingExternalId: t.pending_transaction_id ?? null,
    accountExternalId: t.account_id,
    date: t.date,
    authorizedDate: t.authorized_date ?? null,
    // Plaid: positive = money out. Ikat: positive = money in.
    amountCents: -toCents(t.amount),
    currency: t.iso_currency_code ?? "USD",
    description: t.original_description || t.name,
    merchantName: t.merchant_name ?? null,
    logoUrl: t.logo_url ?? null,
    website: t.website ?? null,
    mcc: t.merchant_category_code ?? null,
    providerCategory: pfc?.primary ?? null,
    providerCategoryDetailed: pfc?.detailed ?? null,
    paymentChannel: t.payment_channel ?? null,
    pending: t.pending,
    runningBalanceCents: cents(t.running_balance),
    location: t.location
      ? {
          ...(t.location.city ? { city: t.location.city } : {}),
          ...(t.location.region ? { region: t.location.region } : {}),
          ...(t.location.lat != null ? { lat: t.location.lat } : {}),
          ...(t.location.lon != null ? { lon: t.location.lon } : {}),
        }
      : null,
  };
}

export class PlaidProvider implements Provider {
  constructor(private client: PlaidApi) {}

  async sync(
    conn: ConnectionRow,
    accessToken: string | null,
    today: ISODate,
  ): Promise<SyncResult> {
    if (!accessToken) throw new Error("Connection has no access token");
    const c = this.client;
    try {
      // Live balances. accounts/get would serve Plaid's cached balances, which
      // can be a day or more stale — silently freezing net worth while the
      // transaction feed keeps moving.
      const bal = await c.accountsBalanceGet({ access_token: accessToken });
      const accounts = bal.data.accounts.map(mapAccount);
      const item = bal.data.item;
      const products = [
        ...(item.products ?? []),
        ...(item.billed_products ?? []),
      ].map(String);

      const institution = await this.institution(
        item.institution_id ?? conn.institutionId,
        conn,
      );
      const transactions = await this.transactions(accessToken, conn.cursor);

      const missingConsent: string[] = [];
      const hasInvestments = accounts.some(
        (a) => a.type === "investment" || a.type === "brokerage",
      );
      const hasLiabilities = accounts.some(
        (a) => a.type === "credit" || a.type === "loan",
      );
      const investments = hasInvestments
        ? await this.investments(accessToken, today, missingConsent)
        : null;
      const liabilities = hasLiabilities
        ? await this.liabilities(accessToken, missingConsent)
        : null;

      return {
        institution,
        accounts,
        transactions,
        investments,
        liabilities,
        missingConsent,
        products: [...new Set(products)],
      };
    } catch (err) {
      const pe = plaidError(err);
      if (pe && REAUTH_CODES.has(pe.code))
        throw new ReauthRequired(pe.message || pe.code);
      if (pe) throw new Error(`${pe.code}: ${pe.message}`);
      throw err;
    }
  }

  private async institution(
    id: string | null,
    conn: ConnectionRow,
  ): Promise<ProviderInstitution | null> {
    if (!id) return null;
    // Logos rarely change; fetch once per connection.
    if (conn.institutionLogo !== null && conn.institutionColor !== null) {
      return {
        id,
        name: conn.institutionName,
        logo: conn.institutionLogo,
        color: conn.institutionColor,
      };
    }
    try {
      const res = await this.client.institutionsGetById({
        institution_id: id,
        country_codes: [CountryCode.Us],
        options: { include_optional_metadata: true },
      });
      const inst = res.data.institution;
      return {
        id,
        name: inst.name,
        logo: inst.logo ? `data:image/png;base64,${inst.logo}` : "",
        color: inst.primary_color ?? "",
      };
    } catch {
      return null;
    }
  }

  private async transactions(accessToken: string, startCursor: string | null) {
    // Restart the whole pagination if the data changes underneath it, per
    // Plaid's contract; mixing pages from two versions loses rows.
    for (let attempt = 0; attempt < 3; attempt++) {
      const added: ProviderTransaction[] = [];
      const modified: ProviderTransaction[] = [];
      const removed: string[] = [];
      let cursor = startCursor ?? undefined;
      let updateStatus: string | null = null;
      try {
        for (;;) {
          const res = await this.client.transactionsSync({
            access_token: accessToken,
            cursor,
            count: 500,
            options: { include_original_description: true },
          });
          const d = res.data;
          added.push(...d.added.map(mapTransaction));
          modified.push(...d.modified.map(mapTransaction));
          removed.push(
            ...d.removed
              .map((r) => r.transaction_id)
              .filter((x): x is string => !!x),
          );
          cursor = d.next_cursor;
          updateStatus = d.transactions_update_status
            ? String(d.transactions_update_status)
            : updateStatus;
          if (!d.has_more) break;
        }
        return {
          added,
          modified,
          removed,
          cursor: cursor ?? null,
          updateStatus,
        };
      } catch (err) {
        if (
          plaidError(err)?.code ===
          "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"
        )
          continue;
        throw err;
      }
    }
    throw new Error(
      "Transactions kept changing during sync; will retry next run",
    );
  }

  private async investments(
    accessToken: string,
    today: ISODate,
    missing: string[],
  ) {
    try {
      const h = await this.client.investmentsHoldingsGet({
        access_token: accessToken,
      });
      const txs: ProviderInvestmentTransaction[] = [];
      // Holdings only describe what's held now; sold-out positions are
      // described by the transactions response.
      const securities = new Map(
        h.data.securities.map((s) => [s.security_id, s]),
      );
      const start = addDays(today, -DAYS_REQUESTED);
      for (let offset = 0; ;) {
        const r = await this.client.investmentsTransactionsGet({
          access_token: accessToken,
          start_date: start,
          end_date: today,
          options: { count: 500, offset },
        });
        for (const s of r.data.securities)
          if (!securities.has(s.security_id)) securities.set(s.security_id, s);
        for (const t of r.data.investment_transactions) {
          txs.push({
            externalId: t.investment_transaction_id,
            accountExternalId: t.account_id,
            securityExternalId: t.security_id ?? null,
            date: t.date,
            name: t.name,
            type: String(t.type),
            subtype: t.subtype ? String(t.subtype) : null,
            quantity: t.quantity,
            price: t.price,
            // Plaid: positive when cash leaves the account (a buy).
            amountCents: -toCents(t.amount),
            feesCents: cents(t.fees),
          });
        }
        offset += r.data.investment_transactions.length;
        if (
          offset >= r.data.total_investment_transactions ||
          r.data.investment_transactions.length === 0
        )
          break;
      }
      return {
        securities: [...securities.values()].map((s) => ({
          externalId: s.security_id,
          ticker: s.ticker_symbol ?? null,
          name: s.name ?? s.ticker_symbol ?? "Unknown security",
          // A company's units typed as a fund ("Energy Transfer LP - Unit") are a stock;
          // Fidelity's core cash position (FCASH) arrives typed as a stock.
          type: isCorePosition(s.ticker_symbol)
            ? "cash"
            : s.type === "mutual fund" && looksLikeCompany(s.name)
              ? "equity"
              : (s.type ?? null),
          cusip: s.cusip ?? null,
          isin: s.isin ?? null,
          // Some institutions (Robinhood) flag every coin as a cash equivalent;
          // a coin is a priced asset, never $1 a unit.
          isCashEquivalent:
            isCorePosition(s.ticker_symbol) ||
            (!!s.is_cash_equivalent && s.type !== "cryptocurrency"),
          closePrice: s.close_price ?? null,
          closePriceAsOf: s.close_price_as_of ?? null,
          sector: (s as { sector?: string | null }).sector ?? null,
          industry: (s as { industry?: string | null }).industry ?? null,
        })),
        holdings: h.data.holdings.map((x) => ({
          accountExternalId: x.account_id,
          securityExternalId: x.security_id,
          quantity: x.quantity,
          price: x.institution_price,
          valueCents: toCents(x.institution_value),
          costBasisCents: cents(x.cost_basis),
          vestedQuantity: x.vested_quantity ?? null,
          vestedValueCents: cents(x.vested_value),
        })),
        transactions: txs,
      };
    } catch (err) {
      return this.optionalProductError(err, "investments", missing);
    }
  }

  private async liabilities(
    accessToken: string,
    missing: string[],
  ): Promise<ProviderLiability[] | null> {
    try {
      const r = await this.client.liabilitiesGet({ access_token: accessToken });
      const out: ProviderLiability[] = [];
      for (const cc of r.data.liabilities.credit ?? []) {
        if (!cc.account_id) continue;
        const purchase =
          cc.aprs.find((a) => String(a.apr_type) === "purchase_apr") ??
          cc.aprs[0];
        out.push({
          accountExternalId: cc.account_id,
          kind: "credit",
          aprPercent: purchase?.apr_percentage ?? null,
          aprs: cc.aprs.map((a) => ({
            type: String(a.apr_type),
            percent: a.apr_percentage,
            balanceCents: cents(a.balance_subject_to_apr),
          })),
          lastStatementBalanceCents: cents(cc.last_statement_balance),
          lastStatementDate: cc.last_statement_issue_date ?? null,
          minimumPaymentCents: cents(cc.minimum_payment_amount),
          nextPaymentDueDate: cc.next_payment_due_date ?? null,
          lastPaymentCents: cents(cc.last_payment_amount),
          lastPaymentDate: cc.last_payment_date ?? null,
          isOverdue: cc.is_overdue ?? null,
          originationDate: null,
          originationPrincipalCents: null,
          termMonths: null,
          maturityDate: null,
          paymentCents: null,
        });
      }
      for (const s of r.data.liabilities.student ?? []) {
        if (!s.account_id) continue;
        out.push({
          accountExternalId: s.account_id,
          kind: "student",
          aprPercent: s.interest_rate_percentage ?? null,
          aprs: null,
          lastStatementBalanceCents: cents(s.last_statement_balance),
          lastStatementDate: s.last_statement_issue_date ?? null,
          minimumPaymentCents: cents(s.minimum_payment_amount),
          nextPaymentDueDate: s.next_payment_due_date ?? null,
          lastPaymentCents: cents(s.last_payment_amount),
          lastPaymentDate: s.last_payment_date ?? null,
          isOverdue: s.is_overdue ?? null,
          originationDate: s.origination_date ?? null,
          originationPrincipalCents: cents(s.origination_principal_amount),
          termMonths: null,
          maturityDate: s.expected_payoff_date ?? null,
          paymentCents: cents(s.minimum_payment_amount),
        });
      }
      for (const m of r.data.liabilities.mortgage ?? []) {
        out.push({
          accountExternalId: m.account_id,
          kind: "mortgage",
          aprPercent: m.interest_rate?.percentage ?? null,
          aprs: null,
          lastStatementBalanceCents: null,
          lastStatementDate: null,
          minimumPaymentCents: cents(m.next_monthly_payment),
          nextPaymentDueDate: m.next_payment_due_date ?? null,
          lastPaymentCents: cents(m.last_payment_amount),
          lastPaymentDate: m.last_payment_date ?? null,
          isOverdue: m.past_due_amount ? m.past_due_amount > 0 : null,
          originationDate: m.origination_date ?? null,
          originationPrincipalCents: cents(m.origination_principal_amount),
          termMonths: parseTerm(m.loan_term),
          maturityDate: m.maturity_date ?? null,
          paymentCents: cents(m.next_monthly_payment),
        });
      }
      return out;
    } catch (err) {
      return this.optionalProductError(err, "liabilities", missing);
    }
  }

  private optionalProductError(
    err: unknown,
    product: string,
    missing: string[],
  ): null {
    const pe = plaidError(err);
    if (pe?.code === "ADDITIONAL_CONSENT_REQUIRED") {
      missing.push(product);
      return null;
    }
    if (pe && (NOT_APPLICABLE.has(pe.code) || pe.code === "PRODUCT_NOT_READY"))
      return null;
    if (pe && REAUTH_CODES.has(pe.code)) throw err;
    // Anything else: don't fail the whole sync over an optional product.
    console.warn(
      `[plaid] ${product} unavailable: ${pe ? `${pe.code} ${pe.message}` : String(err)}`,
    );
    return null;
  }
}

function parseTerm(term: string | null | undefined): number | null {
  if (!term) return null;
  const m = term.match(/(\d+)\s*(year|yr|month|mo)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return /^y/i.test(m[2] ?? "") ? n * 12 : n;
}
