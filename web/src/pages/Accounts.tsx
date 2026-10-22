import {
  Car,
  ChevronRight,
  CreditCard,
  HandCoins,
  House,
  Landmark,
  LineChart,
  Plus,
  Trash2,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  formatPercent,
  GROUP_LABELS,
  INVESTMENT_KIND_LABELS,
  type AccountDTO,
  type AccountGroup,
} from "@ikat/core";
import { InstitutionAvatar } from "../components/Avatars";
import { NetWorthChart } from "../components/charts/NetWorthChart";
import { PageHeader } from "../components/layout/PageHeader";
import { AnimatedMoney, Money } from "../components/Money";
import { Sparkline } from "../components/Sparkline";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Segmented } from "../components/ui/segmented";
import { Sheet } from "../components/ui/sheet";
import { Skeleton } from "../components/ui/skeleton";
import { Switch } from "../components/ui/switch";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { relativeTime, shortDate } from "../lib/format";
import { useAccountHistory, useAccounts, useSparklines } from "../lib/queries";

const GROUP_ICON: Record<AccountGroup, LucideIcon> = {
  cash: Wallet,
  investments: LineChart,
  cards: CreditCard,
  loans: HandCoins,
  property: House,
  other: Landmark,
};

const ASSET_COLOR: Partial<Record<AccountGroup, string>> = {
  cash: "var(--chart-4)",
  investments: "var(--chart-1)",
  property: "var(--chart-3)",
  other: "var(--fg-3)",
};

function meta(a: AccountDTO) {
  const kind =
    a.investmentKind && a.investmentKind !== "taxable"
      ? INVESTMENT_KIND_LABELS[a.investmentKind]
      : a.subtypeLabel;
  return [a.institutionName, kind, a.mask ? `••${a.mask}` : null]
    .filter(Boolean)
    .join(" · ");
}

export function AccountsPage() {
  const { data } = useAccounts();
  const { data: sparks } = useSparklines();
  const [selected, setSelected] = useState<AccountDTO | null>(null);
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash || !data) return;
    document
      .getElementById(hash.slice(1))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash, data]);

  const institutions = useMemo(
    () =>
      new Set(
        data?.accounts.filter((a) => !a.manual).map((a) => a.connectionId),
      ).size,
    [data],
  );
  const [adding, setAdding] = useState<{
    kind: ManualKind;
    name: string;
  } | null>(null);
  const assetGroups = data?.groups.filter((g) => g.totalCents > 0) ?? [];

  return (
    <div>
      <PageHeader
        title="Accounts"
        subtitle={
          data
            ? `${data.accounts.length} accounts across ${institutions} institutions`
            : " "
        }
        actions={
          <Button
            size="sm"
            onClick={() => setAdding({ kind: "home", name: "" })}
          >
            <Plus /> Add an account
          </Button>
        }
      />

      <Card className="mb-6 p-5">
        <div className="grid grid-cols-3 gap-4 max-sm:grid-cols-1">
          <Stat
            label="Net worth"
            value={
              data ? <AnimatedMoney cents={data.netWorthCents} whole /> : null
            }
            strong
          />
          <Stat
            label="Assets"
            value={data ? <Money cents={data.assetsCents} whole /> : null}
          />
          <Stat
            label="Liabilities"
            value={data ? <Money cents={data.liabilitiesCents} whole /> : null}
          />
        </div>
        {data && data.assetsCents > 0 && (
          <div className="mt-5">
            <div className="flex h-2 gap-[2px] overflow-hidden rounded-full">
              {assetGroups.map((g) => (
                <motion.div
                  key={g.group}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                  style={{ background: ASSET_COLOR[g.group] }}
                  initial={{ width: 0 }}
                  animate={{
                    width: `${(g.totalCents / data.assetsCents) * 100}%`,
                  }}
                  transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
                />
              ))}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
              {assetGroups.map((g) => (
                <span
                  key={g.group}
                  className="flex items-center gap-1.5 text-[12px] text-fg-2"
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ background: ASSET_COLOR[g.group] }}
                  />
                  {GROUP_LABELS[g.group]}
                  <span className="text-fg-3">
                    {formatPercent(g.totalCents / data.assetsCents)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      <div className="flex flex-col gap-7">
        {data
          ? data.groups.map((g) => {
              const Icon = GROUP_ICON[g.group];
              const members = data.accounts.filter((a) => a.group === g.group);
              return (
                <section key={g.group} id={g.group} className="scroll-mt-6">
                  <div className="mb-2.5 flex items-center justify-between px-1">
                    <div className="flex items-center gap-2 text-[13.5px] font-semibold">
                      <Icon className="size-4 text-fg-3" />
                      {GROUP_LABELS[g.group]}
                      <span className="font-normal text-fg-3">{g.count}</span>
                    </div>
                    <Money
                      cents={g.totalCents}
                      whole
                      className="text-[13.5px] font-semibold num"
                    />
                  </div>
                  <Card className="divide-y divide-line overflow-hidden">
                    {members.map((a) => (
                      <AccountRow
                        key={a.id}
                        a={a}
                        spark={sparks?.[a.id]}
                        onClick={() => setSelected(a)}
                      />
                    ))}
                  </Card>
                </section>
              );
            })
          : Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-40 rounded-[16px]" />
            ))}
      </div>

      <AccountSheet
        account={
          selected
            ? (data?.accounts.find((a) => a.id === selected.id) ?? selected)
            : null
        }
        onClose={() => setSelected(null)}
      />
      <AddAccountSheet start={adding} onClose={() => setAdding(null)} />
    </div>
  );
}

function Stat({
  label,
  value,
  strong,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div>
      <div className="text-[12.5px] font-medium text-fg-3">{label}</div>
      <div
        className={cn(
          "mt-1 font-semibold tracking-[-0.025em]",
          strong ? "text-[26px]" : "text-[20px] text-fg-2",
        )}
      >
        {value ?? <Skeleton className="h-7 w-32" />}
      </div>
    </div>
  );
}

function AccountRow({
  a,
  spark,
  onClick,
}: {
  a: AccountDTO;
  spark?: number[];
  onClick: () => void;
}) {
  const utilization =
    a.group === "cards" && a.limitCents ? a.balanceCents / a.limitCents : null;
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-3.5 px-5 py-3.5 text-left transition-colors hover:bg-surface-2/60"
    >
      <InstitutionAvatar
        name={a.institutionName}
        logo={a.institutionLogo}
        color={a.institutionColor}
        size={34}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-medium">
            {a.displayName}
          </span>
          {!a.includeInNetWorth && (
            <span className="rounded-full bg-surface-2 px-1.5 text-[10.5px] text-fg-3 shadow-[0_0_0_1px_var(--line)]">
              Excluded
            </span>
          )}
        </div>
        <div className="truncate text-[12px] text-fg-3">{meta(a)}</div>
      </div>
      {spark && spark.length > 1 && (
        <Sparkline
          values={spark}
          width={88}
          height={26}
          color={a.isLiability ? "var(--fg-3)" : "var(--accent)"}
          className="max-md:hidden"
        />
      )}
      <div className="w-[128px] text-right max-sm:w-auto">
        <Money
          cents={a.balanceCents}
          className="text-[14px] font-semibold num"
        />
        {utilization != null ? (
          <div className="mt-1 flex items-center justify-end gap-1.5">
            <div className="h-1 w-14 overflow-hidden rounded-full bg-surface-3">
              <div
                className={cn(
                  "h-full rounded-full",
                  utilization > 0.3 ? "bg-warning" : "bg-positive",
                )}
                style={{ width: `${Math.min(utilization, 1) * 100}%` }}
              />
            </div>
            <span className="text-[11px] text-fg-3">
              {formatPercent(utilization)}
            </span>
          </div>
        ) : (
          <div className="mt-0.5 text-[11px] text-fg-3">
            {a.isLiability ? "owed" : relativeTime(a.balanceAsOf)}
          </div>
        )}
      </div>
      <ChevronRight className="size-4 text-fg-3 opacity-0 transition-opacity group-hover:opacity-100 max-md:hidden" />
    </button>
  );
}

function AccountSheet({
  account,
  onClose,
}: {
  account: AccountDTO | null;
  onClose: () => void;
}) {
  const { data: history } = useAccountHistory(account?.id ?? null);
  const qc = useQueryClient();
  const [nickname, setNickname] = useState("");
  useEffect(
    () => setNickname(account?.nickname ?? ""),
    [account?.id, account?.nickname],
  );

  const save = async (patch: Parameters<typeof api.updateAccount>[1]) => {
    if (!account) return;
    await api.updateAccount(account.id, patch);
    await qc.invalidateQueries();
    toast.success("Saved");
  };

  const points = useMemo(
    () =>
      (history?.points ?? []).slice(-365).map((p) => ({
        date: p.date,
        netWorthCents: p.cents,
        byGroup: {},
        observed: p.observed,
      })),
    [history],
  );

  return (
    <Sheet
      open={!!account}
      onOpenChange={(o) => !o && onClose()}
      title={account?.displayName ?? ""}
      description={account ? meta(account) : ""}
    >
      {account && (
        <div className="flex flex-col gap-6 p-5">
          <div className="flex items-center gap-3">
            <InstitutionAvatar
              name={account.institutionName}
              logo={account.institutionLogo}
              color={account.institutionColor}
              size={44}
            />
            <div>
              <div className="text-[12.5px] text-fg-3">
                {account.isLiability ? "Balance owed" : "Balance"}
              </div>
              <Money
                cents={account.balanceCents}
                className="text-[28px] font-semibold tracking-[-0.03em]"
              />
            </div>
          </div>

          {points.length > 1 ? (
            <div className="-mx-2">
              <NetWorthChart
                points={points}
                breaks={[]}
                height={180}
                color={account.isLiability ? "var(--fg-2)" : "var(--accent)"}
              />
              {history?.observedFrom &&
                history.estimated &&
                points.some((p) => !p.observed) && (
                  <p className="mt-2 px-2 text-[11.5px] text-fg-3">
                    Dashed: rebuilt from this account's transactions, before
                    daily recording began on{" "}
                    {shortDate(history.observedFrom, true)}.
                  </p>
                )}
            </div>
          ) : (
            <Skeleton className="h-[180px]" />
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-[12px] bg-surface-2 p-4 text-[13px] shadow-[0_0_0_1px_var(--line)]">
            <Detail label="Institution" value={account.institutionName} />
            <Detail label="Type" value={account.subtypeLabel} />
            {account.availableCents != null &&
              account.availableCents !== account.balanceCents && (
                <Detail
                  label="Available"
                  value={<Money cents={account.availableCents} />}
                />
              )}
            {account.limitCents != null && (
              <Detail
                label="Credit limit"
                value={<Money cents={account.limitCents} whole />}
              />
            )}
            <Detail
              label="Tax treatment"
              value={
                {
                  taxable: "Taxable",
                  tax_deferred: "Tax-deferred",
                  tax_free: "Tax-free",
                }[account.taxTreatment]
              }
            />
            <Detail label="Updated" value={relativeTime(account.balanceAsOf)} />
          </dl>

          {account.manual && (
            <ManualValue account={account} onRemoved={onClose} />
          )}

          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-fg-2">
                Nickname
              </span>
              <Input
                value={nickname}
                placeholder={account.officialName ?? account.name}
                onChange={(e) => setNickname(e.target.value)}
                onBlur={() =>
                  nickname !== (account.nickname ?? "") &&
                  save({ nickname: nickname || null })
                }
                onKeyDown={(e) =>
                  e.key === "Enter" && (e.target as HTMLInputElement).blur()
                }
              />
            </label>
            <Row
              label="Count in net worth"
              hint="Turn off for money that isn't really yours yet, like unvested equity."
            >
              <Switch
                checked={account.includeInNetWorth}
                onCheckedChange={(v) => save({ includeInNetWorth: v })}
                aria-label="Count in net worth"
              />
            </Row>
            <Row label="Belongs to">
              <Segmented
                size="sm"
                options={[
                  { value: "me", label: "Me" },
                  { value: "partner", label: "Partner" },
                  { value: "joint", label: "Joint" },
                ]}
                value={account.owner}
                onChange={(v) => save({ owner: v })}
              />
            </Row>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-fg-3">{label}</dt>
      <dd className="mt-0.5 truncate font-medium">{value}</dd>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-[13px] font-medium">{label}</div>
        {hint && <div className="text-[11.5px] text-fg-3">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

type ManualKind = "home" | "vehicle" | "cash" | "asset" | "debt";

const MANUAL: Array<{
  kind: ManualKind;
  label: string;
  icon: LucideIcon;
  placeholder: string;
  hint: string;
}> = [
  {
    kind: "home",
    label: "Home",
    icon: House,
    placeholder: "Home",
    hint: "What it would sell for today — Zillow or Redfin give a fair estimate.",
  },
  {
    kind: "vehicle",
    label: "Vehicle",
    icon: Car,
    placeholder: "2021 Toyota RAV4",
    hint: "Its private-party value — Kelley Blue Book or Edmunds give a fair estimate.",
  },
  {
    kind: "cash",
    label: "Cash",
    icon: Wallet,
    placeholder: "Cash at home",
    hint: "Money no bank reports.",
  },
  {
    kind: "asset",
    label: "Other asset",
    icon: Landmark,
    placeholder: "Art, a business stake…",
    hint: "Anything else you own that's worth money.",
  },
  {
    kind: "debt",
    label: "Money owed",
    icon: HandCoins,
    placeholder: "Family loan",
    hint: "Debt no lender reports.",
  },
];

const dollarsToCents = (s: string) =>
  Math.round(Number(s.replace(/[^\d.]/g, "")) * 100);

function AddAccountSheet({
  start,
  onClose,
}: {
  start: { kind: ManualKind; name: string } | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<ManualKind>("home");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  useEffect(() => {
    if (!start) return;
    setKind(start.kind);
    setName(start.name);
    setValue("");
  }, [start]);
  const def = MANUAL.find((m) => m.kind === kind)!;
  const cents = dollarsToCents(value);
  const add = async () => {
    await api.addManualAccount({
      name: name.trim() || def.placeholder,
      kind,
      valueCents: cents,
    });
    await qc.invalidateQueries();
    toast.success(`${name.trim() || def.label} added`);
    onClose();
  };
  return (
    <Sheet
      open={!!start}
      onOpenChange={(o) => !o && onClose()}
      title="Add an account"
      description="For what no bank can report. Its value is whatever you say, until you change it."
    >
      <div className="flex flex-col gap-5 p-5">
        <div className="grid grid-cols-3 gap-2">
          {MANUAL.map((m) => (
            <button
              key={m.kind}
              onClick={() => setKind(m.kind)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-[12px] px-2 py-3 text-[12px] font-medium shadow-[0_0_0_1px_var(--line)] transition-colors",
                kind === m.kind
                  ? "bg-accent-soft text-fg shadow-[0_0_0_1px_var(--accent)]"
                  : "bg-surface-2 text-fg-2 hover:text-fg",
              )}
            >
              <m.icon className="size-5 text-accent" />
              {m.label}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1.5 text-[12.5px] font-medium text-fg-2">
          Name
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={def.placeholder}
            maxLength={80}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[12.5px] font-medium text-fg-2">
          {kind === "debt" ? "Amount owed" : "Value"}
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="decimal"
            placeholder="$0"
          />
          <span className="font-normal text-fg-3">{def.hint}</span>
        </label>
        <Button variant="primary" disabled={!(cents > 0)} onClick={add}>
          Add {def.label.toLowerCase()}
        </Button>
      </div>
    </Sheet>
  );
}

function ManualValue({
  account,
  onRemoved,
}: {
  account: AccountDTO;
  onRemoved: () => void;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const cents = dollarsToCents(value);
  return (
    <div className="flex flex-col gap-2 rounded-[12px] bg-surface-2 p-4 shadow-[0_0_0_1px_var(--line)]">
      <div className="text-[12.5px] font-medium text-fg-2">
        {account.isLiability ? "Amount owed now" : "Value now"}
      </div>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="decimal"
          placeholder={(account.balanceCents / 100).toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 0,
          })}
        />
        <Button
          disabled={!(cents > 0) || cents === account.balanceCents}
          onClick={async () => {
            await api.setAccountValue(account.id, cents);
            await qc.invalidateQueries();
            setValue("");
            toast.success("Value updated");
          }}
        >
          Update
        </Button>
      </div>
      <div className="flex items-center justify-between text-[11.5px] text-fg-3">
        <span>Last set {relativeTime(account.balanceAsOf)}</span>
        <button
          className="inline-flex items-center gap-1 hover:text-negative"
          onClick={async () => {
            await api.deleteAccount(account.id);
            await qc.invalidateQueries();
            toast.success(`${account.displayName} removed`);
            onRemoved();
          }}
        >
          <Trash2 className="size-3.5" /> Remove
        </button>
      </div>
    </div>
  );
}
