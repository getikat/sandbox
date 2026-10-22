import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney, type CashflowMonthDTO } from "@ikat/core";
import { monthLabel } from "../../lib/format";
import { niceTicks } from "../../lib/ticks";

const INCOME = "var(--chart-3)";
const SPEND = "var(--chart-2)";

/** Income and spending side by side per month; the tooltip carries the net. */
export function CashflowChart({
  months,
  height = 220,
  onSelect,
  selected,
}: {
  months: CashflowMonthDTO[];
  height?: number;
  onSelect?: (m: string) => void;
  selected?: string;
}) {
  const rows = months.map((m) => ({
    month: m.month,
    income: m.incomeCents / 100,
    spending: m.spendingCents / 100,
    net: m.netCents,
  }));
  const max = Math.max(1, ...rows.map((r) => Math.max(r.income, r.spending)));
  const { ticks, domain } = niceTicks(0, max, 3);
  return (
    <div
      style={{ height }}
      className="w-full [&_.recharts-bar-rectangle]:cursor-pointer"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          margin={{ top: 6, right: 0, bottom: 0, left: 0 }}
          barGap={2}
          barCategoryGap="28%"
          onClick={(s: { activeLabel?: string | number }) =>
            s?.activeLabel && onSelect?.(String(s.activeLabel))
          }
        >
          <XAxis
            dataKey="month"
            axisLine={false}
            tickLine={false}
            tickMargin={8}
            tickFormatter={(m: string) => monthLabel(`${m}-01`, false)}
          />
          <YAxis
            orientation="right"
            axisLine={false}
            tickLine={false}
            width={52}
            domain={domain}
            ticks={ticks}
            tickFormatter={(v: number) =>
              formatMoney(Math.round(v * 100), { compact: true, whole: true })
            }
          />
          <Tooltip
            cursor={{ fill: "var(--surface-2)", radius: 6 }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0]!.payload as (typeof rows)[number];
              return (
                <div className="min-w-[170px] rounded-[10px] bg-surface px-3 py-2 text-[12px] shadow-pop dark:bg-surface-3">
                  <div className="mb-1.5 text-fg-3">
                    {monthLabel(`${r.month}-01`)}
                  </div>
                  <Line
                    color={INCOME}
                    label="Income"
                    cents={Math.round(r.income * 100)}
                  />
                  <Line
                    color={SPEND}
                    label="Spending"
                    cents={Math.round(r.spending * 100)}
                  />
                  <div className="mt-1.5 flex justify-between border-t border-line pt-1.5">
                    <span className="text-fg-3">Net</span>
                    <span
                      className={`money font-semibold num ${r.net >= 0 ? "text-positive" : "text-negative"}`}
                    >
                      {formatMoney(r.net, { sign: "always", whole: true })}
                    </span>
                  </div>
                </div>
              );
            }}
          />
          <Bar
            dataKey="income"
            fill={INCOME}
            radius={[4, 4, 0, 0]}
            maxBarSize={18}
            fillOpacity={1}
          />
          <Bar
            dataKey="spending"
            fill={SPEND}
            radius={[4, 4, 0, 0]}
            maxBarSize={18}
          />
          {selected && null}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Line({
  color,
  label,
  cents,
}: {
  color: string;
  label: string;
  cents: number;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-fg-3">
        <span className="size-2 rounded-[2px]" style={{ background: color }} />
        {label}
      </span>
      <span className="money font-semibold num">
        {formatMoney(cents, { whole: true })}
      </span>
    </div>
  );
}

export function CashflowLegend() {
  return (
    <div className="flex items-center gap-4 text-[12px] text-fg-3">
      <span className="flex items-center gap-1.5">
        <span
          className="size-2.5 rounded-[3px]"
          style={{ background: INCOME }}
        />{" "}
        Income
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="size-2.5 rounded-[3px]"
          style={{ background: SPEND }}
        />{" "}
        Spending
      </span>
    </div>
  );
}
