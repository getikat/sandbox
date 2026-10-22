import { useMemo } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatMoney,
  type NetWorthBreak,
  type NetWorthPoint,
} from "@ikat/core";
import { dayHeading, monthLabel, shortDate } from "../../lib/format";
import { niceTicks } from "../../lib/ticks";

interface Row {
  date: string;
  value: number;
  kind: "observed" | "rebuilt" | "carried";
  seg: number;
  [series: string]: number | string | boolean | null;
}

/**
 * One row per day, with the value placed under a key for its era and kind:
 * `o{k}` observed (solid), `e{k}` rebuilt from transactions (dashed), `c{k}`
 * carried forward across days nothing was recorded (faint dashed), where k
 * counts the breaks before the day. Each key is its own line, so a break is a
 * gap between segments — never a smooth climb that looks like growth — and
 * each kind of certainty looks different.
 */
function toRows(
  points: NetWorthPoint[],
  breaks: NetWorthBreak[],
): { rows: Row[]; segments: number } {
  const breakDates = breaks.map((b) => b.date).sort();
  const rows: Row[] = points.map((p) => {
    const seg = breakDates.filter((d) => d <= p.date).length;
    const kind = p.carried ? "carried" : p.observed ? "observed" : "rebuilt";
    const key = `${kind === "observed" ? "o" : kind === "rebuilt" ? "e" : "c"}${seg}`;
    return {
      date: p.date,
      value: p.netWorthCents,
      kind,
      seg,
      [key]: p.netWorthCents / 100,
    };
  });
  // Where the kind changes within a segment, the earlier day also starts the
  // next line, so the eras join without a hole.
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]!;
    const b = rows[i]!;
    if (a.seg !== b.seg || a.kind === b.kind) continue;
    const key = `${b.kind === "observed" ? "o" : b.kind === "rebuilt" ? "e" : "c"}${b.seg}`;
    a[key] = a.value / 100;
  }
  return { rows, segments: breakDates.length + 1 };
}

function mergeBreaks(breaks: NetWorthBreak[], points: NetWorthPoint[]) {
  if (!points.length) return [];
  const first = points[0]!.date;
  const last = points.at(-1)!.date;
  const spanDays = Math.max(
    1,
    (Date.parse(last) - Date.parse(first)) / 86_400_000,
  );
  const merged: Array<{ date: string; count: number; names: string[] }> = [];
  for (const b of [...breaks].sort((x, y) => (x.date < y.date ? -1 : 1))) {
    const prev = merged.at(-1);
    if (
      prev &&
      (Date.parse(b.date) - Date.parse(prev.date)) / 86_400_000 <=
        Math.max(7, spanDays * 0.06)
    ) {
      prev.count += b.accountsAdded;
      prev.names.push(...b.names);
    } else
      merged.push({
        date: b.date,
        count: b.accountsAdded,
        names: [...b.names],
      });
  }
  return merged.map((m) => ({
    date: m.date,
    label: m.count === 1 ? `${m.names[0]} added` : `${m.count} accounts added`,
    nearRight:
      (Date.parse(m.date) - Date.parse(first)) / 86_400_000 > spanDays * 0.7,
  }));
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: Row }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload;
  return (
    <div className="rounded-[10px] bg-surface px-3 py-2 shadow-pop dark:bg-surface-3">
      <div className="money text-[14px] font-semibold num">
        {formatMoney(row.value, { whole: true })}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-fg-3">
        {dayHeading(row.date)}
        {row.kind !== "observed" && (
          <span className="rounded-full bg-surface-2 px-1.5 text-[10.5px] font-medium text-fg-2 shadow-[0_0_0_1px_var(--line)]">
            {row.kind === "rebuilt" ? "Rebuilt" : "Not recorded"}
          </span>
        )}
      </div>
    </div>
  );
}

export function NetWorthChart({
  points,
  breaks,
  height = 260,
  onHover,
  color = "var(--accent)",
}: {
  points: NetWorthPoint[];
  breaks: NetWorthBreak[];
  height?: number;
  onHover?: (p: NetWorthPoint | null) => void;
  color?: string;
}) {
  const { rows, segments } = useMemo(
    () => toRows(points, breaks),
    [points, breaks],
  );
  // Breaks a few days apart (linking several institutions in one sitting) read
  // as one event; labels near the right edge anchor inward so they never clip.
  const markers = useMemo(() => mergeBreaks(breaks, points), [breaks, points]);
  const { ticks, domain } = useMemo(() => {
    const vals = rows.map((r) => r.value / 100);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = (max - min) * 0.08 || Math.abs(max) * 0.05 || 1;
    return niceTicks(min - pad, max + pad * 0.5, 4);
  }, [rows]);
  const span = rows.length;
  const tickFmt = (d: string) => (span > 200 ? monthLabel(d) : shortDate(d));
  const hasRebuilt = rows.some((r) => r.kind === "rebuilt");
  const hasCarried = rows.some((r) => r.kind === "carried");

  return (
    <div
      style={{ height }}
      className="w-full [&_.recharts-tooltip-cursor]:stroke-[var(--line-strong)]"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={rows}
          margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
          onMouseMove={(s: { activeTooltipIndex?: number | string | null }) => {
            const i =
              typeof s?.activeTooltipIndex === "number"
                ? s.activeTooltipIndex
                : Number(s?.activeTooltipIndex);
            onHover?.(Number.isFinite(i) ? (points[i] ?? null) : null);
          }}
          onMouseLeave={() => onHover?.(null)}
        >
          <defs>
            <linearGradient id="nw-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.24} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="nw-fill-est" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.09} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tickFormatter={tickFmt}
            axisLine={false}
            tickLine={false}
            minTickGap={48}
            tickMargin={10}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={domain}
            ticks={ticks}
            orientation="right"
            axisLine={false}
            tickLine={false}
            width={56}
            tickFormatter={(v: number) =>
              formatMoney(Math.round(v * 100), { compact: true, whole: true })
            }
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ strokeWidth: 1 }}
            isAnimationActive={false}
          />
          {markers.map((m) => (
            <ReferenceLine
              key={m.date}
              x={m.date}
              stroke="var(--fg-3)"
              strokeOpacity={0.6}
              strokeDasharray="2 4"
              label={{
                value: m.label,
                position: m.nearRight ? "insideTopRight" : "insideTopLeft",
                fill: "var(--fg-3)",
                fontSize: 11,
                offset: 8,
              }}
            />
          ))}
          {/* Invisible full series: the crosshair and tooltip work on every day, whatever its kind. */}
          <Line
            dataKey={(r: Row) => r.value / 100}
            stroke="transparent"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
          {Array.from({ length: segments }, (_, k) => [
            hasCarried && (
              <Line
                key={`c${k}`}
                type="linear"
                dataKey={`c${k}`}
                stroke={color}
                strokeOpacity={0.35}
                strokeWidth={1.5}
                strokeDasharray="2 5"
                connectNulls={false}
                dot={false}
                activeDot={{
                  r: 4,
                  fill: color,
                  stroke: "var(--surface)",
                  strokeWidth: 2,
                }}
                isAnimationActive={false}
              />
            ),
            hasRebuilt && (
              <Area
                key={`e${k}`}
                type="monotone"
                dataKey={`e${k}`}
                stroke={color}
                strokeOpacity={0.55}
                strokeWidth={1.75}
                strokeDasharray="4 4"
                fill="url(#nw-fill-est)"
                connectNulls={false}
                animationDuration={700}
                dot={false}
                activeDot={{
                  r: 4,
                  fill: color,
                  stroke: "var(--surface)",
                  strokeWidth: 2,
                }}
              />
            ),
            <Area
              key={`o${k}`}
              type="monotone"
              dataKey={`o${k}`}
              stroke={color}
              strokeWidth={2}
              fill="url(#nw-fill)"
              connectNulls={false}
              animationDuration={700}
              dot={false}
              activeDot={{
                r: 4.5,
                fill: color,
                stroke: "var(--surface)",
                strokeWidth: 2,
              }}
            />,
          ])}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
