import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  EyeOff,
  MoreHorizontal,
  Repeat,
} from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";
import {
  CADENCE_LABELS,
  diffDays,
  formatMoney,
  todayISO,
  type RecurringDTO,
  type RecurringKind,
  type RecurringSeriesDTO,
} from "@ikat/core";
import { MerchantAvatar } from "../components/Avatars";
import { ForecastChart } from "../components/charts/ForecastChart";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/layout/PageHeader";
import { Money } from "../components/Money";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardHeader } from "../components/ui/card";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
} from "../components/ui/dropdown";
import { Skeleton } from "../components/ui/skeleton";
import { api } from "../lib/api";
import { dayHeading, shortDate } from "../lib/format";
import { useForecast, useRecurring, useStatus } from "../lib/queries";

const SECTIONS: Array<{ kind: RecurringKind; title: string; note: string }> = [
  {
    kind: "income",
    title: "Income",
    note: "Paychecks and other regular money in",
  },
  {
    kind: "bill",
    title: "Bills",
    note: "Housing, utilities, phone and insurance",
  },
  {
    kind: "subscription",
    title: "Subscriptions & memberships",
    note: "Services that renew on their own",
  },
  { kind: "loan", title: "Loans", note: "Regular loan payments" },
  {
    kind: "transfer",
    title: "Saving & investing",
    note: "Automatic moves to savings and investment accounts",
  },
];

export function RecurringPage() {
  const { data } = useRecurring();
  const { data: forecast } = useForecast(45);
  const { data: status } = useStatus();
  const today = status?.today ?? todayISO();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Recurring"
        subtitle={
          data ? (
            <>
              <Money cents={data.monthlyOutCents} whole /> a month goes out on a
              schedule, <Money cents={data.monthlyInCents} whole /> comes in
            </>
          ) : (
            " "
          )
        }
      />

      <Card className="overflow-hidden">
        <CardHeader
          title="Cash over the next 45 days"
          subtitle="Checking and savings, from what's scheduled plus your usual everyday spending"
          action={
            forecast && (
              <Money
                cents={forecast.end.balanceCents}
                whole
                className="text-[15px] font-semibold"
              />
            )
          }
        />
        {forecast?.warning && (
          <div className="mx-5 mb-2 flex items-center gap-2 rounded-[10px] bg-warning-soft px-3 py-2 text-[12.5px] text-warning">
            <AlertTriangle className="size-4 shrink-0" /> {forecast.warning}
          </div>
        )}
        <div className="pr-3 pb-4">
          {forecast ? (
            <ForecastChart f={forecast} />
          ) : (
            <Skeleton className="mx-5 h-[220px]" />
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-8">
          {!data ? (
            <Skeleton className="h-96 rounded-[16px]" />
          ) : data.series.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Repeat />}
                title="Nothing recurring yet"
                body="Ikat needs a few months of history to recognise what repeats."
              />
            </Card>
          ) : (
            SECTIONS.map((sec) => {
              const items = data.series.filter((s) => s.kind === sec.kind);
              if (!items.length) return null;
              const monthly = items.reduce((t, s) => t + s.monthlyCents, 0);
              return (
                <Card key={sec.kind}>
                  <CardHeader
                    title={sec.title}
                    subtitle={sec.note}
                    action={
                      <span className="text-[13px] text-fg-2">
                        <Money
                          cents={Math.abs(monthly)}
                          whole
                          className="font-semibold text-fg"
                        />{" "}
                        / mo
                      </span>
                    }
                  />
                  <div className="divide-y divide-line border-t border-line">
                    {items.map((s) => (
                      <SeriesRow key={s.key} s={s} today={today} />
                    ))}
                  </div>
                </Card>
              );
            })
          )}
        </div>
        <Upcoming data={data} today={today} className="lg:col-span-4" />
      </div>
    </div>
  );
}

function SeriesRow({ s, today }: { s: RecurringSeriesDTO; today: string }) {
  const qc = useQueryClient();
  const days = diffDays(today, s.nextDate);
  const pc = s.priceChange;
  const up = pc ? Math.abs(pc.toCents) > Math.abs(pc.fromCents) : false;
  const income = s.amountCents > 0;
  return (
    <div className="flex items-center gap-3.5 px-5 py-3">
      <MerchantAvatar categoryId={s.categoryId} size={34} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[14px] font-medium">{s.merchant}</span>
          {pc && (
            <Badge
              tone={
                income
                  ? up
                    ? "positive"
                    : "warning"
                  : up
                    ? "warning"
                    : "positive"
              }
            >
              <ArrowUpRight className={up ? "" : "rotate-90"} />
              {income
                ? up
                  ? "Raise"
                  : "Down"
                : up
                  ? "Price up"
                  : "Price down"}{" "}
              {formatMoney(Math.abs(pc.toCents - pc.fromCents))} ·{" "}
              {shortDate(pc.date)}
            </Badge>
          )}
        </div>
        <div className="truncate text-[12px] text-fg-3">
          {CADENCE_LABELS[s.cadence]}
          {s.variable && " · varies"} · {s.accountName} · next{" "}
          {days <= 0
            ? "today"
            : days === 1
              ? "tomorrow"
              : dayHeading(s.nextDate, today)}
        </div>
      </div>
      <div className="text-right">
        <Money
          cents={s.amountCents}
          tone="income"
          className="text-[14px] font-semibold num"
        />
        {s.cadence !== "monthly" && (
          <div className="text-[11.5px] text-fg-3">
            <Money cents={Math.abs(s.monthlyCents)} whole /> / mo
          </div>
        )}
      </div>
      <Dropdown>
        <DropdownTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Options">
            <MoreHorizontal />
          </Button>
        </DropdownTrigger>
        <DropdownContent>
          <DropdownItem
            onSelect={async () => {
              await api.recurringOverride(s.merchantKey, "hidden");
              await qc.invalidateQueries({
                predicate: (q) =>
                  ["recurring", "forecast"].includes(String(q.queryKey[0])),
              });
              toast.success(`${s.merchant} won't be treated as recurring`, {
                action: {
                  label: "Undo",
                  onClick: async () => {
                    await api.recurringOverride(s.merchantKey, null);
                    await qc.invalidateQueries({
                      predicate: (q) =>
                        ["recurring", "forecast"].includes(
                          String(q.queryKey[0]),
                        ),
                    });
                  },
                },
              });
            }}
          >
            <EyeOff /> Not recurring
          </DropdownItem>
        </DropdownContent>
      </Dropdown>
    </div>
  );
}

function Upcoming({
  data,
  today,
  className,
}: {
  data: RecurringDTO | undefined;
  today: string;
  className?: string;
}) {
  const groups = useMemo(() => {
    const out: Array<{ date: string; items: RecurringDTO["upcoming"] }> = [];
    for (const u of data?.upcoming ?? []) {
      const g = out.at(-1);
      if (g?.date === u.date) g.items.push(u);
      else out.push({ date: u.date, items: [u] });
    }
    return out;
  }, [data]);
  return (
    <Card className={className}>
      <CardHeader title="Coming up" subtitle="Next 30 days" />
      <div className="pb-3">
        {!data ? (
          <Skeleton className="mx-5 h-64" />
        ) : groups.length === 0 ? (
          <p className="px-5 pb-3 text-[13px] text-fg-3">Nothing scheduled.</p>
        ) : (
          groups.map((g) => (
            <div key={g.date}>
              <div className="px-5 pt-3 pb-1 text-[11.5px] font-medium text-fg-3">
                {dayHeading(g.date, today)}
              </div>
              {g.items.map((u, i) => (
                <div
                  key={`${u.key}-${i}`}
                  className="flex items-center gap-2.5 px-5 py-1.5"
                >
                  <MerchantAvatar categoryId={u.categoryId} size={24} />
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {u.merchant}
                  </span>
                  <Money
                    cents={u.amountCents}
                    tone="income"
                    className="text-[13px] font-medium num"
                  />
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
