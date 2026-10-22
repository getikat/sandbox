import { motion } from "motion/react";
import { useState } from "react";
import { Link } from "react-router";
import {
  formatMoney,
  formatPercent,
  monthKey,
  todayISO,
  type SpendingCategoryDTO,
} from "@ikat/core";
import { MerchantAvatar } from "../components/Avatars";
import {
  CashflowChart,
  CashflowLegend,
} from "../components/charts/CashflowChart";
import { PaceChart, PaceLegend } from "../components/charts/PaceChart";
import { CategoryIcon, categoryColor } from "../components/CategoryIcon";
import { Delta } from "../components/Delta";
import { PageHeader } from "../components/layout/PageHeader";
import { Money } from "../components/Money";
import { monthName, MonthSwitcher } from "../components/MonthSwitcher";
import { Card, CardHeader } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { Tooltip } from "../components/ui/tooltip";
import { cn } from "../lib/cn";
import {
  categoryName,
  useCashflow,
  useSpending,
  useStatus,
} from "../lib/queries";

export function SpendingPage() {
  const { data: status } = useStatus();
  const current = monthKey(status?.today ?? todayISO());
  const [month, setMonth] = useState<string | null>(null);
  const shown = month ?? current;
  const { data: s } = useSpending(shown);
  const { data: flow } = useCashflow(12);

  const vsPace = s ? s.spentCents - s.prevSpentToDateCents : 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Spending"
        subtitle={
          s ? (s.isCurrent ? "So far this month" : monthName(s.month)) : " "
        }
        actions={
          <MonthSwitcher month={shown} current={current} onChange={setMonth} />
        }
      />

      <div className="grid gap-3 md:grid-cols-3 md:gap-4">
        <Kpi
          label="Spent"
          value={s ? <Money cents={s.spentCents} whole /> : null}
          foot={
            s && (
              <>
                <Delta cents={vsPace} goodWhenUp={false} size="sm" />
                <span>
                  {s.isCurrent
                    ? "vs. last month by this date"
                    : "vs. the month before"}
                </span>
              </>
            )
          }
        />
        <Kpi
          label="Income"
          value={s ? <Money cents={s.incomeCents} whole /> : null}
          foot={s && <span>Paychecks, interest and other income</span>}
        />
        <Kpi
          label="Saved"
          value={
            s ? (
              <Money
                cents={s.savedCents}
                whole
                className={s.savedCents < 0 ? "text-negative" : ""}
              />
            ) : null
          }
          foot={
            s?.savingsRate != null && (
              <Tooltip content="What's left of income after spending, including what went to savings and investments.">
                <span className="cursor-default">
                  {formatPercent(Math.max(s.savingsRate, -9.99))} savings rate
                </span>
              </Tooltip>
            )
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader
            title="Pace"
            subtitle="Running total through the month"
            action={<PaceLegend />}
          />
          <div className="pr-3 pb-4">
            {s ? (
              <PaceChart daily={s.daily} />
            ) : (
              <Skeleton className="mx-5 h-[200px]" />
            )}
          </div>
        </Card>
        <Card className="lg:col-span-5">
          <CardHeader
            title="Top merchants"
            subtitle={s ? monthName(s.month) : " "}
          />
          <div className="pb-2">
            {s ? (
              s.merchants.length ? (
                s.merchants.slice(0, 6).map((m) => (
                  <div
                    key={m.merchant}
                    className="flex items-center gap-3 px-5 py-2"
                  >
                    <MerchantAvatar
                      logoUrl={m.logoUrl}
                      categoryId={m.categoryId}
                      size={30}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium">
                        {m.merchant}
                      </div>
                      <div className="text-[12px] text-fg-3">
                        {m.count} {m.count === 1 ? "charge" : "charges"}
                      </div>
                    </div>
                    <Money
                      cents={m.spentCents}
                      className="text-[13.5px] font-medium num"
                    />
                  </div>
                ))
              ) : (
                <p className="px-5 py-6 text-[13px] text-fg-3">
                  Nothing spent yet this month.
                </p>
              )
            ) : (
              <Skeleton className="mx-5 mb-4 h-[200px]" />
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="By category"
          subtitle="Tap a category to see its transactions"
          action={
            <Link
              to="/budgets"
              className="text-[12.5px] font-medium text-accent hover:underline"
            >
              Budgets
            </Link>
          }
        />
        <div className="pb-2">
          {s ? (
            <CategoryList
              cats={s.categories}
              total={s.spentCents}
              month={s.month}
            />
          ) : (
            <Skeleton className="mx-5 mb-4 h-[300px]" />
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Cash flow"
          subtitle="Income and spending, last 12 months — tap a month to open it"
          action={<CashflowLegend />}
        />
        <div className="pr-3 pb-4">
          {flow ? (
            <CashflowChart months={flow} onSelect={setMonth} />
          ) : (
            <Skeleton className="mx-5 h-[220px]" />
          )}
        </div>
      </Card>
    </div>
  );
}

function Kpi({
  label,
  value,
  foot,
}: {
  label: string;
  value: React.ReactNode;
  foot?: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="text-[12.5px] font-medium text-fg-3">{label}</div>
      <div className="mt-1.5 text-[26px] font-semibold tracking-[-0.03em]">
        {value ?? <Skeleton className="h-8 w-36" />}
      </div>
      <div className="mt-2 flex min-h-5 flex-wrap items-center gap-2 text-[12px] text-fg-3">
        {foot}
      </div>
    </Card>
  );
}

function CategoryList({
  cats,
  total,
  month,
}: {
  cats: SpendingCategoryDTO[];
  total: number;
  month: string;
}) {
  const max = Math.max(1, ...cats.map((c) => c.spentCents));
  return (
    <div className="flex flex-col">
      {cats
        .filter((c) => c.spentCents > 0)
        .map((c, i) => {
          const share = total > 0 ? c.spentCents / total : 0;
          const b = c.budget;
          return (
            <Link
              key={c.categoryId}
              to={`/transactions?category=${c.categoryId}&month=${month}`}
              className="group grid grid-cols-[auto_1fr_auto] items-center gap-x-3.5 px-5 py-2.5 transition-colors hover:bg-surface-2/60"
            >
              <CategoryIcon
                id={c.categoryId}
                size={32}
                className="[&_svg]:size-4"
              />
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[13.5px] font-medium">
                    {categoryName(c.categoryId)}
                  </span>
                  <span className="text-[12px] text-fg-3 num">
                    {formatPercent(share)}
                  </span>
                </div>
                <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ background: categoryColor(c.categoryId) }}
                    initial={{ width: 0 }}
                    animate={{ width: `${(c.spentCents / max) * 100}%` }}
                    transition={{
                      delay: Math.min(i * 0.025, 0.3),
                      duration: 0.5,
                      ease: [0.2, 0.8, 0.2, 1],
                    }}
                  />
                </div>
                {b && (
                  <div
                    className={cn(
                      "mt-1 text-[11.5px]",
                      b.state === "over"
                        ? "text-negative"
                        : b.state === "ahead"
                          ? "text-warning"
                          : "text-fg-3",
                    )}
                  >
                    {b.state === "over"
                      ? "Over budget"
                      : `${Math.round((b.spentCents / b.availableCents) * 100)}% of `}
                    {b.state !== "over" && (
                      <Money cents={b.availableCents} whole />
                    )}{" "}
                    budget
                  </div>
                )}
              </div>
              <div className="w-[104px] text-right">
                <Money
                  cents={c.spentCents}
                  className="text-[13.5px] font-semibold num"
                />
                <div className="text-[11.5px] text-fg-3">
                  {c.prevSpentCents > 0 ? (
                    <>
                      <Money cents={c.prevSpentCents} whole /> last mo.
                    </>
                  ) : (
                    "new"
                  )}
                </div>
              </div>
            </Link>
          );
        })}
    </div>
  );
}
