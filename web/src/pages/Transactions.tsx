import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  addDays,
  CATEGORIES,
  categoryKind,
  endOfMonth,
  startOfMonth,
  startOfYear,
  todayISO,
  type TransactionDTO,
} from "@ikat/core";
import { MerchantAvatar } from "../components/Avatars";
import { monthName } from "../components/MonthSwitcher";
import { CategoryIcon } from "../components/CategoryIcon";
import { CategoryPicker } from "../components/CategoryPicker";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/layout/PageHeader";
import { Money } from "../components/Money";
import { TransactionRow } from "../components/TransactionRow";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Sheet } from "../components/ui/sheet";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { Skeleton } from "../components/ui/skeleton";
import { toast } from "sonner";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { dayHeading, shortDate } from "../lib/format";
import { categoryName, useAccounts, useStatus } from "../lib/queries";

const PAGE = 60;

const PERIODS = (today: string) => [
  {
    value: "month",
    label: "This month",
    start: startOfMonth(today),
    end: undefined,
  },
  {
    value: "last-month",
    label: "Last month",
    start: startOfMonth(addDays(startOfMonth(today), -1)),
    end: endOfMonth(addDays(startOfMonth(today), -1)),
  },
  {
    value: "90d",
    label: "Last 90 days",
    start: addDays(today, -90),
    end: undefined,
  },
  {
    value: "ytd",
    label: "This year",
    start: startOfYear(today),
    end: undefined,
  },
];

const SOURCE_LABEL: Record<TransactionDTO["categorySource"], string> = {
  user: "Set by you",
  rule: "From one of your rules",
  mcc: "From the card network's merchant code",
  provider: "From your bank's data",
  inferred: "Inferred by Ikat",
};

export function TransactionsPage() {
  const [params, setParams] = useSearchParams();
  const { data: status } = useStatus();
  const { data: accts } = useAccounts();
  const today = status?.today ?? todayISO();
  const q = params.get("q") ?? "";
  const account = params.get("account") ?? "";
  const category = params.get("category") ?? "";
  const period = params.get("period") ?? "";
  // Deep links from Spending carry a whole month.
  const month = params.get("month") ?? "";
  const [search, setSearch] = useState(q);
  const [selected, setSelected] = useState<TransactionDTO | null>(null);

  // Filters live in the URL, so a view survives reload and can be linked to.
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    const t = setTimeout(
      () => search !== q && setParam("q", search.trim()),
      250,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const p = month
    ? {
        value: "month-link",
        label: monthName(month),
        start: `${month}-01`,
        end: endOfMonth(`${month}-01`),
      }
    : PERIODS(today).find((x) => x.value === period);
  const filters = { q, account, category, start: p?.start, end: p?.end };
  const query = useInfiniteQuery({
    queryKey: ["transactions-feed", filters],
    queryFn: ({ pageParam }) =>
      api.transactions({ ...filters, limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) =>
      last.nextCursor ? Number(last.nextCursor) : undefined,
  });

  const items = useMemo(
    () => query.data?.pages.flatMap((pg) => pg.items) ?? [],
    [query.data],
  );
  const first = query.data?.pages[0];
  const groups = useMemo(() => {
    const out: Array<{ date: string; items: TransactionDTO[]; net: number }> =
      [];
    for (const t of items) {
      let g = out.at(-1);
      if (!g || g.date !== t.date)
        out.push((g = { date: t.date, items: [], net: 0 }));
      g.items.push(t);
      if (categoryKind(t.categoryId) !== "transfer") g.net += t.amountCents;
    }
    return out;
  }, [items]);

  // Load the next page as the end of the list scrolls into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (e) => {
        if (
          e[0]?.isIntersecting &&
          query.hasNextPage &&
          !query.isFetchingNextPage
        )
          void query.fetchNextPage();
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [query]);

  const filtered = !!(q || account || category || period || month);

  return (
    <div>
      <PageHeader
        title="Transactions"
        subtitle={
          first ? (
            <>
              {first.total.toLocaleString()} {filtered ? "matching" : ""}{" "}
              transactions ·{" "}
              <Money
                cents={first.totalAmountCents}
                tone="signed"
                whole
                className="font-medium"
              />{" "}
              net
            </>
          ) : (
            " "
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 md:max-w-[340px]">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-3" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search merchants and descriptions"
            className="pl-9"
          />
        </div>
        {month ? (
          <button
            onClick={() => setParam("month", "")}
            className="flex h-9 items-center gap-1.5 rounded-[10px] bg-accent-soft px-3 text-[13px] font-medium text-accent"
          >
            {monthName(month)} <X className="size-3.5" />
          </button>
        ) : (
          <Select
            value={period}
            onChange={(v) => setParam("period", v)}
            placeholder="All time"
            options={PERIODS(today).map((x) => ({
              value: x.value,
              label: x.label,
            }))}
          />
        )}
        <Select
          value={account}
          onChange={(v) => setParam("account", v)}
          placeholder="All accounts"
          options={(accts?.accounts ?? []).map((a) => ({
            value: a.id,
            label: a.displayName,
          }))}
        />
        <Select
          value={category}
          onChange={(v) => setParam("category", v)}
          placeholder="All categories"
          options={CATEGORIES.map((c) => ({
            value: c.id,
            label: c.name,
            icon: (
              <CategoryIcon id={c.id} size={20} className="[&_svg]:size-3" />
            ),
          }))}
        />
        {filtered && (
          <button
            onClick={() => {
              setSearch("");
              setParams(new URLSearchParams(), { replace: true });
            }}
            className="flex h-9 items-center gap-1 rounded-[10px] px-2.5 text-[13px] text-fg-3 transition-colors hover:text-fg"
          >
            <X className="size-3.5" /> Clear
          </button>
        )}
      </div>

      <Card className="overflow-hidden">
        {query.isLoading ? (
          <div className="flex flex-col gap-3 p-5">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-[34px] rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<ArrowLeftRight />}
            title="No transactions match"
            body="Try a different search or clear the filters."
          />
        ) : (
          groups.map((g) => (
            <div key={g.date}>
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface/95 px-5 py-2 text-[12px] font-medium text-fg-3 backdrop-blur max-md:top-14">
                <span>{dayHeading(g.date, today)}</span>
                {g.net !== 0 && (
                  <Money cents={g.net} tone="income" className="num" />
                )}
              </div>
              {g.items.map((t) => (
                <TransactionRow
                  key={t.id}
                  tx={t}
                  onClick={() => setSelected(t)}
                  showAccount={!account}
                />
              ))}
            </div>
          ))
        )}
        <div ref={sentinel} />
        {query.isFetchingNextPage && (
          <div className="py-4 text-center text-[12px] text-fg-3">
            Loading more…
          </div>
        )}
      </Card>

      <TransactionSheet tx={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function TransactionSheet({
  tx,
  onClose,
}: {
  tx: TransactionDTO | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [local, setLocal] = useState<TransactionDTO | null>(tx);
  const [notes, setNotes] = useState(tx?.notes ?? "");
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);
  useEffect(() => {
    setLocal(tx);
    setNotes(tx?.notes ?? "");
    setPendingCategory(null);
  }, [tx]);
  const t = local;

  const refresh = () =>
    qc.invalidateQueries({
      predicate: (q) => q.queryKey[0] !== "status" && q.queryKey[0] !== "auth",
    });
  const save = async (patch: Parameters<typeof api.updateTransaction>[1]) => {
    if (!t) return;
    const res = await api.updateTransaction(t.id, patch);
    setLocal({
      ...t,
      ...(patch.categoryId
        ? { categoryId: patch.categoryId, categorySource: "user" as const }
        : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.excluded !== undefined ? { excluded: patch.excluded } : {}),
    });
    await refresh();
    return res;
  };

  return (
    <Sheet
      open={!!tx}
      onOpenChange={(o) => !o && onClose()}
      title={t?.merchant ?? ""}
      description={t ? shortDate(t.date, true) : ""}
    >
      {t && (
        <div className="flex flex-col gap-5 p-5">
          <div className="flex flex-col items-center gap-3 py-3 text-center">
            <MerchantAvatar
              logoUrl={t.logoUrl}
              categoryId={t.categoryId}
              size={56}
            />
            <Money
              cents={t.amountCents}
              tone="income"
              className={cn(
                "text-[32px] font-semibold tracking-[-0.03em]",
                t.excluded && "text-fg-3 line-through",
              )}
            />
            <div className="flex gap-1.5">
              {t.pending && <Badge>Pending</Badge>}
              {t.excluded && <Badge tone="warning">Left out of totals</Badge>}
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-[12px] bg-surface-2 p-4 shadow-[0_0_0_1px_var(--line)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[12px] text-fg-3">Category</div>
                <div className="text-[11.5px] text-fg-3">
                  {SOURCE_LABEL[t.categorySource]}
                </div>
              </div>
              <CategoryPicker
                value={pendingCategory ?? t.categoryId}
                onChange={(id) => id !== t.categoryId && setPendingCategory(id)}
              />
            </div>
            {pendingCategory && (
              <div className="flex flex-col gap-2 border-t border-line pt-3">
                <div className="text-[12.5px] text-fg-2">
                  Change to{" "}
                  <strong className="font-semibold text-fg">
                    {categoryName(pendingCategory)}
                  </strong>
                  …
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      const res = await save({
                        categoryId: pendingCategory,
                        applyToMerchant: true,
                      });
                      setPendingCategory(null);
                      toast.success(
                        `All ${t.merchant} transactions are now ${categoryName(pendingCategory)}`,
                        {
                          description: res?.applied
                            ? `${res.applied} others updated, and future ones will follow.`
                            : "Future ones will follow.",
                        },
                      );
                    }}
                  >
                    For all {t.merchant}
                  </Button>
                  <Button
                    size="sm"
                    onClick={async () => {
                      await save({ categoryId: pendingCategory });
                      setPendingCategory(null);
                    }}
                  >
                    Just this one
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPendingCategory(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          <dl className="flex flex-col divide-y divide-line rounded-[12px] bg-surface-2 text-[13px] shadow-[0_0_0_1px_var(--line)]">
            <Line label="Account">{t.accountName}</Line>
            <Line label="Date">{shortDate(t.date, true)}</Line>
            <Line label="Bank description">
              <span className="font-mono text-[12px] text-fg-2">
                {t.description}
              </span>
            </Line>
            {t.transferPairId && (
              <Line label="Transfer">
                Matched with the other side of this move between your accounts —
                not counted as spending.
              </Line>
            )}
          </dl>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-fg-2">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() =>
                notes !== (t.notes ?? "") && save({ notes: notes || null })
              }
              rows={2}
              placeholder="Add a note — it's searchable"
              className="resize-none rounded-[10px] bg-surface-2 px-3 py-2 text-[13.5px] shadow-[0_0_0_1px_var(--line)] outline-none placeholder:text-fg-3 focus:shadow-[0_0_0_1px_var(--accent),0_0_0_4px_var(--accent-soft)]"
            />
          </label>

          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[13px] font-medium">Leave out of totals</div>
              <div className="text-[11.5px] text-fg-3">
                For reimbursed expenses, or anything that isn't really yours.
              </div>
            </div>
            <Switch
              checked={t.excluded}
              onCheckedChange={(v) => save({ excluded: v })}
              aria-label="Leave out of totals"
            />
          </div>
        </div>
      )}
    </Sheet>
  );
}

function Line({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <dt className="shrink-0 text-fg-3">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words">{children}</dd>
    </div>
  );
}
