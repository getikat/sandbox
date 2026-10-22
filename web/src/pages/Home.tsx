import {
  CreditCard,
  HandCoins,
  House,
  Info,
  Landmark,
  LineChart,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  addDays,
  formatMoney,
  GROUP_LABELS,
  todayISO,
  type AccountGroup,
  type NetWorthPoint,
} from "@ikat/core";
import { MerchantAvatar } from "../components/Avatars";
import { NetWorthChart } from "../components/charts/NetWorthChart";
import { PaceChart } from "../components/charts/PaceChart";
import { Delta } from "../components/Delta";
import { AnimatedMoney, Money } from "../components/Money";
import { SetupCard } from "../components/SetupCard";
import { Sparkline } from "../components/Sparkline";
import { TransactionRow } from "../components/TransactionRow";
import { Card, CardHeader } from "../components/ui/card";
import { Segmented } from "../components/ui/segmented";
import { Skeleton } from "../components/ui/skeleton";
import { Tooltip } from "../components/ui/tooltip";
import type { NetWorthChange } from "@ikat/core";
import { cn } from "../lib/cn";
import { dayHeading, longDate, shortDate } from "../lib/format";
import { RANGES, rangeStart, type RangeKey } from "../lib/ranges";
import {
  categoryName,
  useAccounts,
  useBudgets,
  useNetWorth,
  useNetWorthChange,
  useRecurring,
  useSpending,
  useStatus,
  useTransactions,
} from "../lib/queries";

const GROUP_ICON: Record<AccountGroup, LucideIcon> = {
  cash: Wallet,
  investments: LineChart,
  cards: CreditCard,
  loans: HandCoins,
  property: House,
  other: Landmark,
};

function Footnote({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-6 py-2.5 text-[12px] text-fg-3">
      <span>{children}</span>
      {action && (
        <button
          onClick={action.onClick}
          className="font-medium text-accent hover:underline"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function joinedList(names: string[]) {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 5
    ? "Good evening"
    : h < 12
      ? "Good morning"
      : h < 18
        ? "Good afternoon"
        : "Good evening";
}

export function HomePage() {
  const { data: status } = useStatus();
  const { data: nw } = useNetWorth();
  const { data: accts } = useAccounts();
  const [range, setRange] = useState<RangeKey>("1y");
  const [hover, setHover] = useState<NetWorthPoint | null>(null);
  const today = status?.today ?? todayISO();

  const [showPartial, setShowPartial] = useState(false);
  const view = useMemo(() => {
    if (!nw?.points.length) return null;
    const start = rangeStart(range, today);
    let points = start ? nw.points.filter((p) => p.date >= start) : nw.points;
    // Before the last big arrival of accounts, Ikat only knew part of the
    // picture, and that stretch can't share an axis with the rest. Start the
    // chart there unless asked otherwise (and unless it would leave no chart).
    // Only an arrival that changed most of the picture (≥10% of net worth)
    // warrants hiding what came before; smaller ones are marked on the line.
    const worthOn = new Map(
      nw.points.map((p) => [p.date, Math.abs(p.netWorthCents)]),
    );
    const lastBreak = nw.breaks
      .filter(
        (b) =>
          b.date > (points[0]?.date ?? "") &&
          b.addedCents >= (worthOn.get(b.date) ?? 0) * 0.1,
      )
      .at(-1);
    const clippable =
      !!lastBreak && points.filter((p) => p.date >= lastBreak.date).length >= 7;
    const clipped = clippable && !showPartial;
    if (clipped) points = points.filter((p) => p.date >= lastBreak!.date);
    const breaks = nw.breaks.filter((b) => b.date > (points[0]?.date ?? ""));
    return {
      points,
      breaks,
      first: points[0]!,
      last: points.at(-1)!,
      clipped,
      clippable,
      lastBreak,
    };
  }, [nw, range, today, showPartial]);

  // Like-for-like: only accounts present at both ends are compared, so a new
  // link never reads as growth. The server does the arithmetic.
  const change = useNetWorthChange(view?.first.date ?? null);
  const month = useNetWorthChange(addDays(today, -30));
  const shown = hover ?? view?.last;
  const c = change.data;
  let delta: number | null = c?.changeCents ?? null;
  // A percentage needs a base that stands for most of what you have; against a
  // sliver (or a debt) it's noise — "−408%" of a $54 card balance.
  const meaningfulBase = (base: number, end: number) =>
    base > 0 && base >= Math.abs(end) * 0.5;
  let ratio =
    c && meaningfulBase(c.startCents, c.netWorthCents)
      ? c.changeCents / c.startCents
      : null;
  if (hover && view) {
    // While scrubbing, compare with the range start only if nothing joined in between.
    const crossesBreak = view.breaks.some((b) => b.date <= hover.date);
    delta = crossesBreak
      ? null
      : hover.netWorthCents - view.first.netWorthCents;
    ratio =
      crossesBreak ||
      !meaningfulBase(view.first.netWorthCents, hover.netWorthCents)
        ? null
        : delta! / view.first.netWorthCents;
  }
  const rangeLong = RANGES.find((r) => r.value === range)!.long;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between">
        <h1 className="text-[22px] font-semibold tracking-[-0.025em] md:text-[24px]">
          {greeting()}
        </h1>
        <span className="text-[13px] text-fg-3 max-sm:hidden">
          {longDate(today)}
        </span>
      </div>

      <SetupCard />

      {/* Hero: net worth */}
      <Card className="glow overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5 md:px-6 md:pt-6">
          <div>
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-fg-2">
              Net worth
              <Tooltip content="Everything you own minus everything you owe. Dashed stretches are rebuilt from your banks' transaction and trade history, for the days before Ikat started recording balances daily.">
                <Info className="size-3.5 text-fg-3" />
              </Tooltip>
            </div>
            <div className="mt-1.5 h-[52px] text-[42px] leading-[52px] font-semibold tracking-display md:text-[48px]">
              {!shown ? (
                <Skeleton className="h-11 w-64" />
              ) : hover ? (
                <span className="money">
                  {formatMoney(shown.netWorthCents, { whole: true })}
                </span>
              ) : (
                <AnimatedMoney cents={shown.netWorthCents} whole />
              )}
            </div>
            <div className="mt-2 flex h-6 flex-wrap items-center gap-2 text-[12.5px] text-fg-3">
              {delta != null && <Delta cents={delta} ratio={ratio} />}
              <span>
                {hover
                  ? dayHeading(hover.date)
                  : view?.clipped
                    ? `since ${shortDate(view.first.date, true)}`
                    : rangeLong}
              </span>
              {hover && !hover.observed && (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-fg-2 shadow-[0_0_0_1px_var(--line)]">
                  {hover.carried
                    ? "Not recorded — last known balance"
                    : "Rebuilt from transactions"}
                </span>
              )}
            </div>
          </div>
          <Segmented
            options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
            value={range}
            onChange={setRange}
            size="sm"
          />
        </div>
        <div className="mt-4 pr-2 pl-0 md:pr-4">
          {view ? (
            <NetWorthChart
              points={view.points}
              breaks={view.breaks}
              onHover={setHover}
              height={250}
            />
          ) : (
            <Skeleton className="mx-5 mb-5 h-[230px]" />
          )}
        </div>
        {view?.clipped ? (
          <Footnote
            action={{
              label: "Show earlier",
              onClick: () => setShowPartial(true),
            }}
          >
            Showing since {shortDate(view.first.date, true)}, when{" "}
            {joinedList(view.lastBreak!.names)}{" "}
            {view.lastBreak!.names.length === 1 ? "was" : "were"} connected.
            Before that, Ikat only knew about some of your accounts.
          </Footnote>
        ) : c && c.joined.length > 0 ? (
          <Footnote
            action={
              view?.clippable
                ? {
                    label: "Hide partial history",
                    onClick: () => setShowPartial(false),
                  }
                : undefined
            }
          >
            Compared like-for-like: {joinedList(c.joined.map((j) => j.name))}{" "}
            joined during this period, so{" "}
            {c.joined.length === 1 ? "it isn't" : "they aren't"} counted as
            growth.
          </Footnote>
        ) : null}
      </Card>

      {/* Groups */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        {accts
          ? accts.groups.slice(0, 4).map((g, i) => {
              const Icon = GROUP_ICON[g.group];
              const trend = (nw?.points ?? [])
                .slice(-90)
                .map((p) => Math.abs(p.byGroup[g.group] ?? 0));
              const liability = g.group === "cards" || g.group === "loans";
              const m = month.data?.byGroup[g.group];
              const d = m
                ? Math.abs(m.endCents) - Math.abs(m.startCents)
                : null;
              return (
                <motion.div
                  key={g.group}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.04 * i, duration: 0.3 }}
                >
                  <Link to={`/accounts#${g.group}`}>
                    <Card className="group p-4 transition-shadow hover:shadow-pop">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-[12.5px] font-medium text-fg-2">
                          <Icon className="size-4 text-fg-3" />
                          {GROUP_LABELS[g.group]}
                        </div>
                        <span className="text-[11.5px] text-fg-3">
                          {g.count}
                        </span>
                      </div>
                      <div className="mt-2.5 text-[21px] font-semibold tracking-[-0.025em]">
                        <Money cents={Math.abs(g.totalCents)} whole />
                      </div>
                      <div className="mt-2 flex items-end justify-between gap-2">
                        {d != null ? (
                          <Delta cents={d} goodWhenUp={!liability} size="sm" />
                        ) : (
                          <span />
                        )}
                        <Sparkline
                          values={trend}
                          width={80}
                          height={26}
                          color={liability ? "var(--fg-3)" : "var(--accent)"}
                          className="opacity-90"
                        />
                      </div>
                    </Card>
                  </Link>
                </motion.div>
              );
            })
          : Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-[118px] rounded-[16px]" />
            ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <ThisMonth className="lg:col-span-7" />
        <ComingUp className="lg:col-span-5" today={today} />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader
            title="What moved your net worth"
            subtitle={
              c
                ? `${shortDate(c.start, true)} → ${shortDate(c.end, true)}`
                : " "
            }
          />
          <div className="px-5 pb-5">
            {c ? <Waterfall c={c} /> : <Skeleton className="h-[220px]" />}
          </div>
        </Card>
        <RecentActivity className="lg:col-span-5" />
      </div>
    </div>
  );
}

/**
 * Start → each driver → end, as floating bars on a shared scale. The parts
 * sum exactly to the change (the server guarantees it), so the bars close.
 */
function Waterfall({ c }: { c: NetWorthChange }) {
  const steps = [
    {
      label: "Market",
      hint: "Investment growth beyond what you put in",
      v: c.marketCents,
      color: "var(--chart-1)",
    },
    {
      label: "Contributions",
      hint: "New money into investments, incl. employer match and vested stock",
      v: c.contributionsCents,
      color: "var(--chart-3)",
    },
    {
      label: "Cash",
      hint: "Change in checking and savings",
      v: c.cashCents,
      color: "var(--chart-4)",
    },
    {
      label: "Debt paid down",
      hint: "Loans and card balances going down",
      v: c.debtPaydownCents,
      color: "var(--chart-7)",
    },
    ...(c.otherCents
      ? [
          {
            label: "Other",
            hint: "Property and other accounts",
            v: c.otherCents,
            color: "var(--fg-3)",
          },
        ]
      : []),
  ];
  let cum = c.startCents;
  const bars = steps.map((s) => {
    const from = cum;
    cum += s.v;
    return { ...s, from, to: cum };
  });
  const lo = Math.min(c.startCents, ...bars.map((b) => Math.min(b.from, b.to)));
  const hi = Math.max(c.endCents, ...bars.map((b) => Math.max(b.from, b.to)));
  const x = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between py-2 text-[12.5px]">
        <span className="text-fg-3">Started at</span>
        <Money cents={c.startCents} whole className="font-medium num" />
      </div>
      {bars.map((b, i) => (
        <div
          key={b.label}
          className="grid grid-cols-[112px_1fr_92px] items-center gap-3 py-2 max-sm:grid-cols-[92px_1fr_80px]"
        >
          <Tooltip content={b.hint}>
            <span className="cursor-default truncate text-[13px] text-fg-2">
              {b.label}
            </span>
          </Tooltip>
          <div className="relative h-6">
            <div className="absolute inset-y-[11px] right-0 left-0 bg-line" />
            <motion.div
              className="absolute top-0 h-6 rounded-[5px]"
              style={{
                background: b.color,
                left: `${x(Math.min(b.from, b.to))}%`,
              }}
              initial={{ width: 0, opacity: 0 }}
              animate={{
                width: `${Math.max(Math.abs(x(b.to) - x(b.from)), 0.6)}%`,
                opacity: 1,
              }}
              transition={{
                delay: 0.08 * i,
                duration: 0.5,
                ease: [0.2, 0.8, 0.2, 1],
              }}
            />
          </div>
          <Money
            cents={b.v}
            sign="always"
            whole
            className={cn(
              "text-right text-[13px] font-medium num",
              b.v < 0 && "text-negative",
            )}
          />
        </div>
      ))}
      <div className="mt-1 flex items-baseline justify-between border-t border-line pt-3 text-[13px]">
        <span className="font-medium">Net change</span>
        <span className="flex items-center gap-2">
          <Money
            cents={c.changeCents}
            sign="always"
            whole
            className={cn(
              "font-semibold num",
              c.changeCents >= 0 ? "text-positive" : "text-negative",
            )}
          />
        </span>
      </div>
    </div>
  );
}

function ThisMonth({ className }: { className?: string }) {
  const { data: s } = useSpending();
  const { data: b } = useBudgets();
  const vs = s ? s.spentCents - s.prevSpentToDateCents : 0;
  const watch = (b?.rows ?? [])
    .filter((r) => r.progress.state === "over" || r.progress.state === "ahead")
    .slice(0, 3);
  return (
    <Card className={className}>
      <CardHeader
        title="This month"
        action={
          <Link
            to="/spending"
            className="text-[12.5px] font-medium text-accent hover:underline"
          >
            Spending
          </Link>
        }
      />
      <div className="px-5 pb-5">
        {!s ? (
          <Skeleton className="h-[150px]" />
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Money
                cents={s.spentCents}
                whole
                className="text-[26px] font-semibold tracking-[-0.03em]"
              />
              <span className="text-[13px] text-fg-3">spent so far</span>
              <Delta cents={vs} goodWhenUp={false} size="sm" />
              <span className="text-[12px] text-fg-3">
                vs. last month by now
              </span>
            </div>
            <div className="-mx-2 mt-2">
              <PaceChart daily={s.daily} height={120} />
            </div>
            {watch.length > 0 ? (
              <div className="mt-3 flex flex-col gap-1.5">
                {watch.map((r) => (
                  <Link
                    key={r.categoryId}
                    to="/budgets"
                    className="flex items-center gap-2 text-[12.5px]"
                  >
                    <span
                      className={
                        r.progress.state === "over"
                          ? "text-negative"
                          : "text-warning"
                      }
                    >
                      ●
                    </span>
                    <span className="font-medium">
                      {categoryName(r.categoryId)}
                    </span>
                    <span className="text-fg-3">
                      {r.progress.state === "over"
                        ? "is over budget"
                        : "is ahead of pace"}{" "}
                      — <Money cents={r.progress.spentCents} whole /> of{" "}
                      <Money cents={r.progress.availableCents} whole />
                    </span>
                  </Link>
                ))}
              </div>
            ) : b && b.rows.length === 0 && b.suggestions.length > 0 ? (
              <Link
                to="/budgets"
                className="mt-3 inline-flex text-[12.5px] font-medium text-accent hover:underline"
              >
                Your budgets are drafted from your history — review them
              </Link>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}

function ComingUp({ className, today }: { className?: string; today: string }) {
  const { data } = useRecurring();
  const items = (data?.upcoming ?? []).slice(0, 6);
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader
        title="Coming up"
        action={
          <Link
            to="/recurring"
            className="text-[12.5px] font-medium text-accent hover:underline"
          >
            Recurring
          </Link>
        }
      />
      <div className="flex-1 pb-3">
        {!data ? (
          <Skeleton className="mx-5 h-[150px]" />
        ) : items.length === 0 ? (
          <p className="px-5 text-[13px] text-fg-3">
            Nothing scheduled in the next month.
          </p>
        ) : (
          items.map((u, i) => (
            <div
              key={`${u.key}-${i}`}
              className="flex items-center gap-3 px-5 py-2"
            >
              <MerchantAvatar categoryId={u.categoryId} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">
                  {u.merchant}
                </div>
                <div className="text-[12px] text-fg-3">
                  {dayHeading(u.date, today)}
                </div>
              </div>
              <Money
                cents={u.amountCents}
                tone="income"
                className="text-[13.5px] font-medium num"
              />
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function RecentActivity({ className }: { className?: string }) {
  const { data } = useTransactions({ limit: 7 });
  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader
        title="Recent activity"
        action={
          <Link
            to="/transactions"
            className="text-[12.5px] font-medium text-accent hover:underline"
          >
            View all
          </Link>
        }
      />
      <div className="flex-1 pb-2">
        {data
          ? data.items.map((t) => <TransactionRow key={t.id} tx={t} dense />)
          : Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                <Skeleton className="size-[30px] rounded-full" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
      </div>
    </Card>
  );
}
