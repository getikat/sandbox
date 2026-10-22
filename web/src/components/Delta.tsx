import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatMoney, formatPercent } from "@ikat/core";
import { cn } from "../lib/cn";

/**
 * A change, with direction and goodness as separate ideas: debt going down is
 * good even though the number fell. Colour is never the only signal — the
 * arrow and sign carry it too.
 */
export function Delta({
  cents,
  ratio,
  goodWhenUp = true,
  className,
  size = "md",
}: {
  cents?: number;
  ratio?: number | null;
  goodWhenUp?: boolean;
  className?: string;
  size?: "sm" | "md";
}) {
  const v = cents ?? ratio ?? 0;
  const up = v > 0;
  const flat = v === 0;
  const good = flat ? null : up === goodWhenUp;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full font-medium whitespace-nowrap",
        size === "sm" ? "h-5 px-1.5 text-[11.5px]" : "h-6 px-2 text-[12.5px]",
        good === null
          ? "bg-surface-2 text-fg-2"
          : good
            ? "bg-positive-soft text-positive"
            : "bg-negative-soft text-negative",
        className,
      )}
    >
      <Icon
        className={size === "sm" ? "size-3" : "size-3.5"}
        strokeWidth={2.5}
      />
      {cents != null && (
        <span className="money">
          {formatMoney(Math.abs(cents), { whole: Math.abs(cents) >= 100_000 })}
        </span>
      )}
      {cents != null && ratio != null && <span className="opacity-70">·</span>}
      {ratio != null && <span>{formatPercent(Math.abs(ratio))}</span>}
    </span>
  );
}
