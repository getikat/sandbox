import { animate, useMotionValue, useMotionValueEvent } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { formatMoney, type FormatMoneyOptions } from "@ikat/core";
import { cn } from "../lib/cn";

interface MoneyProps extends FormatMoneyOptions {
  cents: number;
  /** "income": inflows green with a +, outflows plain — the ledger convention. */
  tone?: "none" | "income" | "signed";
  className?: string;
}

export function Money({ cents, tone = "none", className, ...fmt }: MoneyProps) {
  const sign =
    fmt.sign ??
    (tone === "income" && cents > 0
      ? "always"
      : tone === "income"
        ? "never"
        : "auto");
  return (
    <span
      className={cn(
        "money whitespace-nowrap",
        tone === "income" && cents > 0 && "text-positive",
        tone === "signed" &&
          (cents > 0 ? "text-positive" : cents < 0 ? "text-negative" : ""),
        className,
      )}
    >
      {formatMoney(cents, { ...fmt, sign })}
    </span>
  );
}

/** A figure that glides to its new value instead of snapping. */
export function AnimatedMoney({
  cents,
  className,
  ...fmt
}: { cents: number; className?: string } & FormatMoneyOptions) {
  const mv = useMotionValue(cents);
  const [shown, setShown] = useState(cents);
  const first = useRef(true);
  useMotionValueEvent(mv, "change", (v) => setShown(Math.round(v)));
  useEffect(() => {
    // Animation frames don't run in a hidden tab: a figure that started its
    // glide there would sit 1.5% short until the tab is looked at. Skip the
    // glide then (and for reduced motion), and always land on the value.
    const still =
      document.visibilityState !== "visible" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (first.current) {
      first.current = false;
      if (!still) mv.set(cents * 0.985);
    }
    if (still) {
      mv.set(cents);
      return;
    }
    const controls = animate(mv, cents, {
      duration: 0.7,
      ease: [0.2, 0.8, 0.2, 1],
    });
    const land = setTimeout(() => mv.set(cents), 1_000);
    return () => {
      controls.stop();
      clearTimeout(land);
    };
  }, [cents, mv]);
  return (
    <span className={cn("money whitespace-nowrap", className)}>
      {formatMoney(shown, fmt)}
    </span>
  );
}
