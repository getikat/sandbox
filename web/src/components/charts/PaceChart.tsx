import {
  Area,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney, type SpendingSummaryDTO } from "@ikat/core";
import { niceTicks } from "../../lib/ticks";

/**
 * This month's running total against last month's, by day of the month —
 * the honest way to ask "am I spending more?" on the 12th.
 */
export function PaceChart({
  daily,
  height = 200,
}: {
  daily: SpendingSummaryDTO["daily"];
  height?: number;
}) {
  const rows = daily.map((d) => ({
    day: d.day,
    now: d.cents != null ? d.cents / 100 : null,
    prev: d.prevCents != null ? d.prevCents / 100 : null,
  }));
  const max = Math.max(
    1,
    ...rows.map((r) => Math.max(r.now ?? 0, r.prev ?? 0)),
  );
  const { ticks, domain } = niceTicks(0, max, 3);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={rows}
          margin={{ top: 6, right: 0, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id="pace-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.2} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            tickMargin={8}
            ticks={[1, 8, 15, 22, 29]}
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
            cursor={{ stroke: "var(--line-strong)" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0]!.payload as (typeof rows)[number];
              return (
                <div className="rounded-[10px] bg-surface px-3 py-2 text-[12px] shadow-pop dark:bg-surface-3">
                  <div className="mb-1 text-fg-3">Day {r.day}</div>
                  {r.now != null && (
                    <Row
                      color="var(--accent)"
                      label="This month"
                      value={r.now}
                    />
                  )}
                  {r.prev != null && (
                    <Row
                      color="var(--fg-3)"
                      label="Last month"
                      value={r.prev}
                      dashed
                    />
                  )}
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="prev"
            stroke="var(--fg-3)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
            activeDot={false}
            connectNulls
          />
          <Area
            type="monotone"
            dataKey="now"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#pace-fill)"
            dot={false}
            activeDot={{
              r: 4,
              fill: "var(--accent)",
              stroke: "var(--surface)",
              strokeWidth: 2,
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function Row({
  color,
  label,
  value,
  dashed,
}: {
  color: string;
  label: string;
  value: number;
  dashed?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <svg width="14" height="4" aria-hidden>
        <line
          x1="0"
          y1="2"
          x2="14"
          y2="2"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dashed ? "3 3" : undefined}
        />
      </svg>
      <span className="money font-semibold num">
        {formatMoney(Math.round(value * 100), { whole: true })}
      </span>
      <span className="text-fg-3">{label}</span>
    </div>
  );
}

export function PaceLegend() {
  return (
    <div className="flex items-center gap-4 text-[12px] text-fg-3">
      <span className="flex items-center gap-1.5">
        <svg width="14" height="4" aria-hidden>
          <line
            x1="0"
            y1="2"
            x2="14"
            y2="2"
            stroke="var(--accent)"
            strokeWidth="2"
          />
        </svg>
        This month
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="14" height="4" aria-hidden>
          <line
            x1="0"
            y1="2"
            x2="14"
            y2="2"
            stroke="var(--fg-3)"
            strokeWidth="2"
            strokeDasharray="3 3"
          />
        </svg>
        Last month
      </span>
    </div>
  );
}
