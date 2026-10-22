import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, monthKey } from "@ikat/core";

const NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function monthName(month: string, withYear = true) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return withYear ? `${NAMES[m - 1]} ${y}` : NAMES[m - 1]!;
}

/** ‹ September 2026 › — never past the current month. */
export function MonthSwitcher({
  month,
  current,
  onChange,
}: {
  month: string;
  current: string;
  onChange: (m: string) => void;
}) {
  const step = (n: number) => onChange(monthKey(addMonths(`${month}-01`, n)));
  const btn =
    "flex size-8 items-center justify-center rounded-[9px] text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-30";
  return (
    <div className="flex items-center gap-1 rounded-[11px] bg-surface p-[3px] shadow-card">
      <button
        className={btn}
        onClick={() => step(-1)}
        aria-label="Previous month"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-[132px] text-center text-[13.5px] font-medium">
        {monthName(month)}
      </span>
      <button
        className={btn}
        onClick={() => step(1)}
        disabled={month >= current}
        aria-label="Next month"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
