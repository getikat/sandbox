import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Sparkles, Target, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import {
  formatMoney,
  monthKey,
  todayISO,
  type BudgetRowDTO,
  type BudgetSuggestion,
} from "@ikat/core";
import { CategoryIcon, categoryColor } from "../components/CategoryIcon";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/layout/PageHeader";
import { Money } from "../components/Money";
import { monthName, MonthSwitcher } from "../components/MonthSwitcher";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardHeader } from "../components/ui/card";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  DropdownTrigger,
} from "../components/ui/dropdown";
import { Skeleton } from "../components/ui/skeleton";
import { Switch } from "../components/ui/switch";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { categoryName, useBudgets, useStatus } from "../lib/queries";

const STATE_LABEL = {
  under: "Under pace",
  on_track: "On track",
  ahead: "Ahead of pace",
  over: "Over budget",
} as const;
const STATE_TONE = {
  under: "positive",
  on_track: "neutral",
  ahead: "warning",
  over: "negative",
} as const;

export function BudgetsPage() {
  const { data: status } = useStatus();
  const current = monthKey(status?.today ?? todayISO());
  const [month, setMonth] = useState<string | null>(null);
  const shown = month ?? current;
  const { data } = useBudgets(shown);
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({
      predicate: (q) => ["budgets", "spending"].includes(String(q.queryKey[0])),
    });

  const acceptAll = async (ids?: string[]) => {
    await api.acceptBudgets(ids);
    await refresh();
    toast.success(
      ids?.length === 1
        ? "Budget added"
        : "Budgets set — you can adjust any of them",
    );
  };

  const pct =
    data && data.totalBudgetCents > 0
      ? data.totalSpentCents / data.totalBudgetCents
      : 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Budgets"
        subtitle={
          shown === current ? "This month, judged by pace" : monthName(shown)
        }
        actions={
          <MonthSwitcher month={shown} current={current} onChange={setMonth} />
        }
      />

      {!data ? (
        <Skeleton className="h-64 rounded-[16px]" />
      ) : data.rows.length === 0 ? (
        <Card className="overflow-hidden">
          <div className="glow px-6 pt-7 pb-2">
            <div className="flex size-11 items-center justify-center rounded-[14px] bg-accent-soft text-accent">
              <Sparkles className="size-5" />
            </div>
            <h2 className="mt-4 text-[19px] font-semibold tracking-[-0.02em]">
              Your budgets are already drafted
            </h2>
            <p className="mt-1.5 max-w-lg text-[13.5px] text-fg-2">
              Each one is the middle of your last three months in that category,
              rounded to a clean number — so they reflect how you actually
              spend. Fixed costs like rent aren't budgeted.
            </p>
          </div>
          {data.suggestions.length ? (
            <>
              <div className="mt-4 divide-y divide-line border-y border-line">
                {data.suggestions.map((s) => (
                  <SuggestionRow key={s.categoryId} s={s} />
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                <span className="text-[13px] text-fg-3">
                  {data.suggestions.length} budgets ·{" "}
                  <Money
                    cents={data.suggestions.reduce(
                      (t, s) => t + s.amountCents,
                      0,
                    )}
                    whole
                  />{" "}
                  a month
                </span>
                <Button variant="primary" onClick={() => acceptAll()}>
                  Use these budgets
                </Button>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Target />}
              title="Not enough history yet"
              body="Budgets are drafted from three months of spending. Check back once Ikat has seen a little more."
            />
          )}
        </Card>
      ) : (
        <>
          <Card className="p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-[12.5px] font-medium text-fg-3">
                  Spent against budgets
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <Money
                    cents={data.totalSpentCents}
                    whole
                    className="text-[26px] font-semibold tracking-[-0.03em]"
                  />
                  <span className="text-[14px] text-fg-3">
                    of <Money cents={data.totalBudgetCents} whole />
                  </span>
                </div>
              </div>
              {data.unbudgetedCents > 0 && (
                <div className="text-right text-[12.5px] text-fg-3">
                  Plus{" "}
                  <Money
                    cents={data.unbudgetedCents}
                    whole
                    className="font-medium text-fg-2"
                  />{" "}
                  in categories without a budget
                </div>
              )}
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2">
              <motion.div
                className={cn(
                  "h-full rounded-full",
                  pct > 1 ? "bg-negative" : "bg-accent",
                )}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(pct, 1) * 100}%` }}
                transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
              />
            </div>
          </Card>

          <Card className="divide-y divide-line overflow-hidden">
            {data.rows.map((r, i) => (
              <BudgetRow
                key={r.categoryId}
                r={r}
                index={i}
                onChange={refresh}
              />
            ))}
          </Card>

          {data.suggestions.length > 0 && (
            <Card>
              <CardHeader
                title="More you could budget"
                subtitle="Drafted from your recent spending"
              />
              <div className="divide-y divide-line border-t border-line">
                {data.suggestions.map((s) => (
                  <SuggestionRow
                    key={s.categoryId}
                    s={s}
                    onAdd={() => acceptAll([s.categoryId])}
                  />
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function SuggestionRow({
  s,
  onAdd,
}: {
  s: BudgetSuggestion;
  onAdd?: () => void;
}) {
  return (
    <div className="flex items-center gap-3.5 px-6 py-3">
      <CategoryIcon id={s.categoryId} size={32} className="[&_svg]:size-4" />
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium">
          {categoryName(s.categoryId)}
        </div>
        <div className="text-[12px] text-fg-3">
          Last three months:{" "}
          {s.basisCents.map((c) => formatMoney(c, { whole: true })).join(" · ")}
        </div>
      </div>
      <Money
        cents={s.amountCents}
        whole
        className="text-[14px] font-semibold num"
      />
      {onAdd && (
        <Button size="sm" onClick={onAdd}>
          Add
        </Button>
      )}
    </div>
  );
}

function BudgetRow({
  r,
  index,
  onChange,
}: {
  r: BudgetRowDTO;
  index: number;
  onChange: () => void;
}) {
  const p = r.progress;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(p.budgetCents / 100));
  const fill = Math.min(p.spentCents / Math.max(p.availableCents, 1), 1);
  const paceAt = Math.min(p.paceCents / Math.max(p.availableCents, 1), 1);
  const barColor =
    p.state === "over"
      ? "var(--negative)"
      : p.state === "ahead"
        ? "var(--warning)"
        : categoryColor(r.categoryId);

  const save = async () => {
    setEditing(false);
    const cents = Math.round(Number(value) * 100);
    if (!Number.isFinite(cents) || cents <= 0 || cents === p.budgetCents)
      return;
    await api.setBudget(r.categoryId, cents);
    onChange();
  };

  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <CategoryIcon
        id={r.categoryId}
        size={36}
        className="[&_svg]:size-[17px]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-medium">
              {categoryName(r.categoryId)}
            </span>
            <Badge tone={STATE_TONE[p.state]}>{STATE_LABEL[p.state]}</Badge>
            {r.rollover && (
              <span className="text-[11px] text-fg-3">rolls over</span>
            )}
          </div>
          <div className="text-[13px] num">
            <Money cents={p.spentCents} className="font-semibold" />
            <span className="text-fg-3"> of </span>
            {editing ? (
              <input
                autoFocus
                value={value}
                onChange={(e) =>
                  setValue(e.target.value.replace(/[^\d.]/g, ""))
                }
                onBlur={save}
                onKeyDown={(e) =>
                  e.key === "Enter" && (e.target as HTMLInputElement).blur()
                }
                className="w-20 rounded-[6px] bg-surface-2 px-1.5 py-0.5 text-right font-medium outline-none shadow-[0_0_0_1px_var(--accent)]"
              />
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="rounded-[6px] px-1 font-medium underline decoration-line-strong decoration-dotted underline-offset-4 hover:bg-surface-2"
              >
                <Money cents={p.availableCents} whole />
              </button>
            )}
          </div>
        </div>
        <div className="relative mt-2.5 h-2 rounded-full bg-surface-2">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ background: barColor }}
            initial={{ width: 0 }}
            animate={{ width: `${fill * 100}%` }}
            transition={{
              delay: Math.min(index * 0.03, 0.3),
              duration: 0.55,
              ease: [0.2, 0.8, 0.2, 1],
            }}
          />
          {/* Where spending would be today if it tracked the budget evenly. */}
          <div
            className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-fg-2"
            style={{ left: `calc(${paceAt * 100}% - 1px)` }}
            title="Today's pace"
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[11.5px] text-fg-3">
          <span>
            {p.remainingCents >= 0 ? (
              <>
                <Money cents={p.remainingCents} whole /> left
              </>
            ) : (
              <>
                <Money
                  cents={-p.remainingCents}
                  whole
                  className="text-negative"
                />{" "}
                over
              </>
            )}
          </span>
          <span>
            On pace for <Money cents={p.projectedCents} whole />
          </span>
        </div>
      </div>
      <Dropdown>
        <DropdownTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Budget options">
            <MoreHorizontal />
          </Button>
        </DropdownTrigger>
        <DropdownContent>
          <div
            className="flex items-center justify-between gap-4 px-2.5 py-2 text-[13px]"
            onClick={(e) => e.stopPropagation()}
          >
            <span>Roll over leftovers</span>
            <Switch
              checked={r.rollover}
              onCheckedChange={async (v) => {
                await api.setBudget(r.categoryId, p.budgetCents, v);
                onChange();
              }}
              aria-label="Roll over"
            />
          </div>
          <DropdownSeparator />
          <DropdownItem
            danger
            onSelect={async () => {
              await api.deleteBudget(r.categoryId);
              onChange();
            }}
          >
            <Trash2 /> Remove budget
          </DropdownItem>
        </DropdownContent>
      </Dropdown>
    </div>
  );
}
