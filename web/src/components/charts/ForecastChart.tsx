import { useMemo } from "react";
import {
  Area,
  ComposedChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney, type ForecastDTO } from "@ikat/core";
import { dayHeading, shortDate } from "../../lib/format";
import { niceTicks } from "../../lib/ticks";

/** Projected cash, day by day, with the events that move it listed in the tooltip. */
export function ForecastChart({
  f,
  height = 220,
}: {
  f: ForecastDTO;
  height?: number;
}) {
  const rows = useMemo(() => {
    const byDate = new Map<string, typeof f.events>();
    for (const e of f.events)
      byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
    return f.points.map((p) => ({
      date: p.date,
      v: p.balanceCents / 100,
      events: byDate.get(p.date) ?? [],
    }));
  }, [f]);
  const vals = rows.map((r) => r.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = (max - min) * 0.25 || Math.abs(max) * 0.05 || 100;
  // Zero anchors the axis only when the balance gets anywhere near it;
  // otherwise it would flatten an $80k line into a ruler.
  const nearZero = min < Math.max(max * 0.3, (f.thresholdCents / 100) * 2);
  const { ticks, domain } = niceTicks(
    nearZero ? Math.min(0, min - pad) : min - pad,
    max + pad,
    3,
  );
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={rows}
          margin={{ top: 10, right: 0, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id="fc-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tickMargin={8}
            minTickGap={40}
            tickFormatter={(d: string) => shortDate(d)}
          />
          <YAxis
            orientation="right"
            axisLine={false}
            tickLine={false}
            width={56}
            domain={domain}
            ticks={ticks}
            tickFormatter={(v: number) =>
              formatMoney(Math.round(v * 100), { compact: true, whole: true })
            }
          />
          {domain[0] < 0 && (
            <ReferenceLine y={0} stroke="var(--negative)" strokeOpacity={0.5} />
          )}
          <Tooltip
            cursor={{ stroke: "var(--line-strong)" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const r = payload[0]!.payload as (typeof rows)[number];
              return (
                <div className="min-w-[200px] rounded-[10px] bg-surface px-3 py-2 text-[12px] shadow-pop dark:bg-surface-3">
                  <div className="money text-[14px] font-semibold num">
                    {formatMoney(Math.round(r.v * 100), { whole: true })}
                  </div>
                  <div className="text-fg-3">
                    {dayHeading(r.date)} · projected
                  </div>
                  {r.events.length > 0 && (
                    <div className="mt-1.5 flex flex-col gap-0.5 border-t border-line pt-1.5">
                      {r.events.map((e, i) => (
                        <div key={i} className="flex justify-between gap-4">
                          <span className="truncate text-fg-2">{e.label}</span>
                          <span
                            className={`money num ${e.amountCents > 0 ? "text-positive" : ""}`}
                          >
                            {formatMoney(e.amountCents, { sign: "always" })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            }}
          />
          <Area
            type="stepAfter"
            dataKey="v"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#fc-fill)"
            dot={false}
            activeDot={{
              r: 4,
              fill: "var(--accent)",
              stroke: "var(--surface)",
              strokeWidth: 2,
            }}
          />
          <ReferenceDot
            x={f.low.date}
            y={f.low.balanceCents / 100}
            r={4}
            fill="var(--surface)"
            stroke="var(--accent)"
            strokeWidth={2}
            label={{
              value: `Low ${formatMoney(f.low.balanceCents, { compact: true, whole: true })}`,
              position: "bottom",
              fill: "var(--fg-3)",
              fontSize: 11,
              offset: 8,
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
