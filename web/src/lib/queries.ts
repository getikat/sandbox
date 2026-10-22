import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { CATEGORY_BY_ID } from "@ikat/core";
import { api } from "./api";

export const keys = {
  status: ["status"] as const,
  accounts: ["accounts"] as const,
  netWorth: ["net-worth"] as const,
  change: (start: string) => ["net-worth-change", start] as const,
  transactions: (p: object) => ["transactions", p] as const,
  categories: ["categories"] as const,
};

export function useStatus() {
  return useQuery({
    queryKey: keys.status,
    queryFn: api.status,
    // Poll quickly while a sync runs, gently otherwise.
    refetchInterval: (q) => (q.state.data?.syncing ? 2_000 : 60_000),
  });
}

export const useAccounts = () =>
  useQuery({ queryKey: keys.accounts, queryFn: api.accounts });
export const useSparklines = () =>
  useQuery({ queryKey: ["sparklines"], queryFn: api.sparklines });
export const useAccountHistory = (id: string | null) =>
  useQuery({
    queryKey: ["account-history", id],
    queryFn: () => api.accountHistory(id!),
    enabled: !!id,
  });
export const useNetWorth = () =>
  useQuery({ queryKey: keys.netWorth, queryFn: api.netWorth });
export const useNetWorthChange = (start: string | null) =>
  useQuery({
    queryKey: keys.change(start ?? ""),
    queryFn: () => api.netWorthChange(start!),
    enabled: !!start,
    placeholderData: keepPreviousData,
  });

export function useTransactions(p: Parameters<typeof api.transactions>[0]) {
  return useQuery({
    queryKey: keys.transactions(p),
    queryFn: () => api.transactions(p),
    placeholderData: keepPreviousData,
  });
}

export function categoryName(id: string) {
  return CATEGORY_BY_ID[id]?.name ?? id;
}

/** Everything derived from synced data; invalidate after a sync or profile switch. */
export function useInvalidateData() {
  const qc = useQueryClient();
  return () =>
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "status" });
}

export const useSpending = (month?: string) =>
  useQuery({
    queryKey: ["spending", month ?? "current"],
    queryFn: () => api.spending(month),
    placeholderData: keepPreviousData,
  });
export const useCashflow = (months = 12) =>
  useQuery({
    queryKey: ["cashflow", months],
    queryFn: () => api.cashflow(months),
  });
export const useRecurring = () =>
  useQuery({ queryKey: ["recurring"], queryFn: api.recurring });
export const useForecast = (days = 45) =>
  useQuery({ queryKey: ["forecast", days], queryFn: () => api.forecast(days) });
export const useBudgets = (month?: string) =>
  useQuery({
    queryKey: ["budgets", month ?? "current"],
    queryFn: () => api.budgets(month),
    placeholderData: keepPreviousData,
  });
export const useRules = () =>
  useQuery({ queryKey: ["rules"], queryFn: api.rules });
