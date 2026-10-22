import { motion } from "motion/react";
import { useId } from "react";
import { cn } from "../../lib/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/** A pill-group toggle whose selection glides between options. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  const id = useId();
  return (
    <div
      role="radiogroup"
      className={cn(
        "inline-flex items-center rounded-[10px] bg-surface-2 p-[3px] shadow-[0_0_0_1px_var(--line)]",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative rounded-[7px] font-medium transition-colors",
              size === "sm"
                ? "h-6 px-2 text-[11.5px]"
                : "h-7 px-2.5 text-[12.5px]",
              active ? "text-fg" : "text-fg-3 hover:text-fg-2",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-[7px] bg-surface shadow-[0_0_0_1px_var(--line),0_1px_2px_rgba(0,0,0,0.12)] dark:bg-surface-3"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
