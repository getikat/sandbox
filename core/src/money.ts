// Money is integer cents everywhere it is stored or summed. Floating-point
// dollars drift (0.1 + 0.2), and a net worth that disagrees with the sum of its
// accounts by a cent is a net worth nobody trusts. Convert at the edges only.

export type Cents = number;

export function toCents(dollars: number): Cents {
  return Math.round(dollars * 100);
}

export function toDollars(cents: Cents): number {
  return cents / 100;
}

export function sumCents(values: Iterable<Cents | null | undefined>): Cents {
  let total = 0;
  for (const v of values) if (v != null) total += v;
  return total;
}

export interface FormatMoneyOptions {
  /** "auto": minus only; "always": +/−; "never": absolute value. */
  sign?: "auto" | "always" | "never";
  /** Drop cents. Defaults to true at or above $10k. */
  whole?: boolean;
  /** 1.2K / 4.5M — for axes and tight tiles. */
  compact?: boolean;
  currency?: string;
}

const MINUS = "−";

export function formatMoney(
  cents: Cents,
  opts: FormatMoneyOptions = {},
): string {
  const { sign = "auto", compact = false, currency = "USD" } = opts;
  const abs = Math.abs(cents) / 100;
  const whole = opts.whole ?? abs >= 10_000;
  let body: string;
  if (compact && abs >= 1000) {
    body = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: abs >= 1_000_000 ? 2 : 1,
    }).format(abs);
  } else {
    body = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(abs);
  }
  if (sign === "never" || cents === 0) return body;
  if (cents < 0) return `${MINUS}${body}`;
  return sign === "always" ? `+${body}` : body;
}

export function formatPercent(
  ratio: number,
  opts: { sign?: boolean; digits?: number } = {},
): string {
  const { sign = false, digits = Math.abs(ratio) < 0.1 ? 1 : 0 } = opts;
  const body = `${(Math.abs(ratio) * 100).toFixed(digits)}%`;
  if (!sign || ratio === 0) return ratio < 0 ? `${MINUS}${body}` : body;
  return ratio < 0 ? `${MINUS}${body}` : `+${body}`;
}
