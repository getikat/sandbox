import { categoryForMcc, categoryForProvider, categoryKind } from "@ikat/core";

export interface CategorizeInput {
  description: string;
  merchantKey: string;
  amountCents: number;
  accountId: string;
  accountType: string;
  mcc: string | null;
  providerCategory: string | null;
  providerCategoryDetailed: string | null;
  /** "online" | "in store" | "other", when the provider says. */
  paymentChannel?: string | null;
  /**
   * The category this merchant's coded transactions agree on, for a row that
   * arrived without a code (the same subscription billed to a card that
   * doesn't pass MCCs through).
   */
  merchantCategory?: string | null;
}

export interface Rule {
  id: string;
  merchantKey: string | null;
  descriptionContains: string | null;
  accountId: string | null;
  minCents: number | null;
  maxCents: number | null;
  categoryId: string;
  createdAt: string;
}

export type CategorySource = "rule" | "mcc" | "provider" | "inferred";

const REFINES: Record<string, string[]> = {
  dining: ["coffee"],
  shopping: ["online", "gifts", "pets"],
};

export function ruleMatches(rule: Rule, tx: CategorizeInput): boolean {
  if (rule.merchantKey && rule.merchantKey !== tx.merchantKey) return false;
  if (
    rule.descriptionContains &&
    !tx.description
      .toLowerCase()
      .includes(rule.descriptionContains.toLowerCase())
  )
    return false;
  if (rule.accountId && rule.accountId !== tx.accountId) return false;
  const abs = Math.abs(tx.amountCents);
  if (rule.minCents != null && abs < rule.minCents) return false;
  if (rule.maxCents != null && abs > rule.maxCents) return false;
  return true;
}

/**
 * Precedence (a user's manual edit sits above all of this and is never
 * recomputed): newest matching rule → card payment / transfer signals →
 * merchant category code → the code this merchant's other transactions
 * carry → provider category → sign-based fallback.
 *
 * Rules are passed newest-first.
 */
export function categorize(
  tx: CategorizeInput,
  rules: Rule[],
): { categoryId: string; source: CategorySource } {
  for (const rule of rules)
    if (ruleMatches(rule, tx))
      return { categoryId: rule.categoryId, source: "rule" };

  const detailed = tx.providerCategoryDetailed ?? "";
  const primary = tx.providerCategory ?? "";
  const isCard = tx.accountType === "credit";

  // Money arriving on a card is a payment (or a refund/credit, which carries a
  // merchant category and falls through below).
  if (detailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT")
    return { categoryId: "card_payment", source: "provider" };
  if (
    isCard &&
    tx.amountCents > 0 &&
    /payment|thank you|autopay/i.test(tx.description)
  )
    return { categoryId: "card_payment", source: "inferred" };
  if (primary === "TRANSFER_IN" || primary === "TRANSFER_OUT") {
    return {
      categoryId: categoryForProvider(primary, detailed) ?? "transfer",
      source: "provider",
    };
  }
  if (tx.accountType === "loan" && tx.amountCents > 0)
    return { categoryId: "transfer", source: "inferred" };

  const fromMcc = categoryForMcc(tx.mcc);
  let fromProvider = categoryForProvider(primary, detailed);
  // "Music and audio" / "TV and movies" in person is a record shop, a cinema or
  // a concert — not a streaming service.
  if (fromProvider === "streaming" && tx.paymentChannel === "in store")
    fromProvider = "entertainment";
  if (fromMcc) {
    // A provider subcategory may *refine* the code's category (a café is MCC
    // 5814 "fast food", so dining; the provider can tell it's coffee). It may
    // never contradict it. Rewards read the raw MCC, so this is display-only.
    if (fromProvider && REFINES[fromMcc]?.includes(fromProvider))
      return { categoryId: fromProvider, source: "provider" };
    return { categoryId: fromMcc, source: "mcc" };
  }
  // What you buy from a merchant says nothing about money it pays you (a
  // paycheck from a store you also shop at), so only an expense guess gives way.
  if (
    tx.merchantCategory &&
    tx.merchantCategory !== fromProvider &&
    categoryKind(fromProvider) === "expense"
  ) {
    if (fromProvider && REFINES[tx.merchantCategory]?.includes(fromProvider))
      return { categoryId: fromProvider, source: "provider" };
    return { categoryId: tx.merchantCategory, source: "inferred" };
  }
  if (fromProvider) return { categoryId: fromProvider, source: "provider" };

  return {
    categoryId: tx.amountCents > 0 ? "other_income" : "other",
    source: "inferred",
  };
}

/** Coded transactions a merchant needs, and how many must agree, before its uncoded ones follow. */
const CONSENSUS_MIN = 2;
const CONSENSUS_SHARE = 0.8;

/**
 * Per merchant, the category its merchant-category-coded transactions agree
 * on. Some cards pass the code through and some don't, so one Apple
 * subscription was "Software" on one card and the provider's "Entertainment"
 * guess on another.
 */
export function merchantCategories(
  rows: Iterable<{ merchantKey: string; mcc: string | null }>,
): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const c = categoryForMcc(r.mcc);
    if (!c) continue;
    const m = counts.get(r.merchantKey) ?? new Map<string, number>();
    m.set(c, (m.get(c) ?? 0) + 1);
    counts.set(r.merchantKey, m);
  }
  const out = new Map<string, string>();
  for (const [key, m] of counts) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [top, n] = [...m].sort((a, b) => b[1] - a[1])[0]!;
    if (total >= CONSENSUS_MIN && n / total >= CONSENSUS_SHARE)
      out.set(key, top);
  }
  return out;
}
