import type {
  AccountDTO,
  AccountsDTO,
  BudgetsDTO,
  CashflowMonthDTO,
  CatalogCardDTO,
  SetupDTO,
  CategoryDTO,
  ForecastDTO,
  RecurringDTO,
  RuleDTO,
  SpendingSummaryDTO,
  NetWorthChange,
  NetWorthSeriesDTO,
  Page,
  StatusDTO,
  TransactionDTO,
} from "@ikat/core";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (!res.ok) {
    let code = "ERROR";
    let message = res.statusText;
    try {
      const j = await res.json();
      code = j.error ?? code;
      message = j.message ?? message;
    } catch {
      /* not JSON */
    }
    if (
      res.status === 401 ||
      (res.status === 403 && code === "REMOTE_DISABLED")
    ) {
      window.dispatchEvent(new CustomEvent("ikat:auth", { detail: code }));
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const qs = (
  params: Record<string, string | number | boolean | null | undefined>,
) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
};

export interface AuthState {
  remote: boolean;
  passwordSet: boolean;
  authenticated: boolean;
}

export const api = {
  status: () => request<StatusDTO>("GET", "/api/status"),
  authState: () => request<AuthState>("GET", "/api/auth/state"),
  login: (password: string) =>
    request<{ ok: true }>("POST", "/api/auth/login", { password }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout", {}),
  setPassword: (next: string, current?: string) =>
    request<{ ok: true }>("POST", "/api/auth/password", { next, current }),
  accounts: () => request<AccountsDTO>("GET", "/api/accounts"),
  addManualAccount: (body: {
    name: string;
    kind: "home" | "vehicle" | "cash" | "asset" | "debt";
    valueCents: number;
  }) => request<AccountDTO>("POST", "/api/accounts/manual", body),
  setAccountValue: (id: string, valueCents: number) =>
    request<AccountDTO>("PUT", `/api/accounts/${id}/value`, { valueCents }),
  deleteAccount: (id: string) =>
    request<{ ok: true }>("DELETE", `/api/accounts/${id}`),
  previewImport: (body: ImportBody) =>
    request<ImportPreview>("POST", "/api/import/statement/preview", body),
  importStatement: (body: ImportBody) =>
    request<{ accountId: string; added: number; total: number }>(
      "POST",
      "/api/import/statement",
      body,
    ),
  backups: () =>
    request<
      Array<{ name: string; bytes: number; createdAt: string; manual: boolean }>
    >("GET", "/api/backups"),
  backupNow: () =>
    request<
      Array<{ name: string; bytes: number; createdAt: string; manual: boolean }>
    >("POST", "/api/backups", {}),
  updateAccount: (
    id: string,
    patch: Partial<
      Pick<AccountDTO, "nickname" | "includeInNetWorth" | "hidden" | "owner">
    >,
  ) => request<AccountDTO>("PATCH", `/api/accounts/${id}`, patch),
  sparklines: () =>
    request<Record<string, number[]>>("GET", "/api/accounts/sparklines"),
  accountHistory: (id: string) =>
    request<{
      points: Array<{ date: string; cents: number; observed: boolean }>;
      observedFrom: string | null;
      estimated: boolean;
    }>("GET", `/api/accounts/${id}/history`),
  netWorth: () => request<NetWorthSeriesDTO>("GET", "/api/net-worth"),
  netWorthChange: (start: string, end?: string) =>
    request<NetWorthChange | null>(
      "GET",
      `/api/net-worth/change${qs({ start, end })}`,
    ),
  categories: () => request<CategoryDTO[]>("GET", "/api/categories"),
  transactions: (p: {
    q?: string;
    account?: string;
    category?: string;
    start?: string;
    end?: string;
    limit?: number;
    offset?: number;
  }) => request<Page<TransactionDTO>>("GET", `/api/transactions${qs(p)}`),
  updateTransaction: (
    id: string,
    patch: {
      categoryId?: string;
      applyToMerchant?: boolean;
      notes?: string | null;
      excluded?: boolean;
    },
  ) =>
    request<{ ok: true; applied: number }>(
      "PATCH",
      `/api/transactions/${id}`,
      patch,
    ),
  rules: () => request<RuleDTO[]>("GET", "/api/rules"),
  deleteRule: (id: string) =>
    request<{ ok: true; changed: number }>("DELETE", `/api/rules/${id}`),
  spending: (month?: string) =>
    request<SpendingSummaryDTO>("GET", `/api/spending${qs({ month })}`),
  cashflow: (months = 12) =>
    request<CashflowMonthDTO[]>("GET", `/api/cashflow${qs({ months })}`),
  recurring: () => request<RecurringDTO>("GET", "/api/recurring"),
  recurringOverride: (merchantKey: string, state: "hidden" | "pinned" | null) =>
    request<RecurringDTO>("POST", "/api/recurring/override", {
      merchantKey,
      state,
    }),
  forecast: (days = 45) =>
    request<ForecastDTO>("GET", `/api/forecast${qs({ days })}`),
  budgets: (month?: string) =>
    request<BudgetsDTO>("GET", `/api/budgets${qs({ month })}`),
  setBudget: (categoryId: string, amountCents: number, rollover?: boolean) =>
    request<BudgetsDTO>("PUT", `/api/budgets/${categoryId}`, {
      amountCents,
      ...(rollover !== undefined ? { rollover } : {}),
    }),
  deleteBudget: (categoryId: string) =>
    request<BudgetsDTO>("DELETE", `/api/budgets/${categoryId}`),
  acceptBudgets: (categoryIds?: string[]) =>
    request<BudgetsDTO>(
      "POST",
      "/api/budgets/accept",
      categoryIds ? { categoryIds } : {},
    ),
  setup: () => request<SetupDTO>("GET", "/api/setup"),
  setSetting: (key: string, value: unknown) =>
    request<{ ok: true }>("PUT", `/api/settings/${key}`, { value }),
  sync: () =>
    request<{ started: boolean }>("POST", "/api/sync", { force: true }),
  setProfile: (profile: "demo" | "real") =>
    request<{ profile: string }>("POST", "/api/profile", { profile }),
  resetDemo: () => request<{ ok: true }>("POST", "/api/demo/reset", {}),
  linkToken: (opts: { connectionId?: string; consent?: string[] } = {}) =>
    request<{ linkToken: string }>("POST", "/api/plaid/link-token", opts),
  exchange: (
    publicToken: string,
    institution?: { id?: string | null; name?: string | null } | null,
  ) =>
    request<{ connectionId: string }>("POST", "/api/plaid/exchange", {
      publicToken,
      institution,
    }),
  refreshConnection: (id: string) =>
    request<unknown>("POST", `/api/connections/${id}/refresh`, {}),
  removeConnection: (id: string, revoke = false) =>
    request<{ ok: true }>("DELETE", `/api/connections/${id}${qs({ revoke })}`),
  savePlaid: (
    clientId: string,
    secret: string,
    env: "sandbox" | "production",
  ) =>
    request<{ ok: true }>("POST", "/api/settings/plaid", {
      clientId,
      secret,
      env,
    }),
};

export interface ImportBody {
  filename: string;
  content: string;
  flipSign?: boolean;
  accountId?: string;
  newAccount?: { name: string; type: "checking" | "savings" | "credit" };
  balanceCents?: number | null;
}

export interface ImportPreview {
  format: "csv" | "ofx";
  count: number;
  alreadyImported: number;
  skipped: number;
  from: string;
  to: string;
  balanceCents: number | null;
  suggestedType: "checking" | "savings" | "credit" | null;
  looksFlipped: boolean;
  sample: Array<{ date: string; description: string; amountCents: number }>;
}
