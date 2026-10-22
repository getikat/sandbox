import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  DownloadCloud,
  History,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { ConnectionDTO } from "@ikat/core";
import { InstitutionAvatar } from "../components/Avatars";
import { CategoryIcon } from "../components/CategoryIcon";
import { PageHeader } from "../components/layout/PageHeader";
import { Money } from "../components/Money";
import { usePlaidFlow } from "../components/PlaidLink";
import { PlaidSetup } from "../components/PlaidSetup";
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
import { Input } from "../components/ui/input";
import { Segmented } from "../components/ui/segmented";
import { Switch } from "../components/ui/switch";
import { Tooltip } from "../components/ui/tooltip";
import { api, type ImportBody, type ImportPreview } from "../lib/api";
import { relativeTime, shortDate } from "../lib/format";
import { usePrivacy, useTheme } from "../lib/prefs";
import {
  categoryName,
  useInvalidateData,
  useRules,
  useStatus,
} from "../lib/queries";

const PRODUCT_LABEL: Record<string, string> = {
  investments: "holdings and trades",
  liabilities: "card and loan details",
};

export function SettingsPage() {
  const { data: status } = useStatus();
  const invalidate = useInvalidateData();
  const qc = useQueryClient();
  const plaid = usePlaidFlow();
  const demo = status?.profile === "demo";

  const switchProfile = async (profile: "demo" | "real") => {
    await api.setProfile(profile);
    await qc.invalidateQueries();
    invalidate();
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Settings" />
      {plaid.element}

      <Card>
        <CardHeader
          title="Connections"
          subtitle="Each institution syncs once a day in the background, even when Ikat isn't open."
          action={
            !demo && status?.plaid.configured ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => plaid.start()}
                disabled={plaid.busy}
              >
                {plaid.busy ? <Loader2 className="animate-spin" /> : <Plus />}{" "}
                Link institution
              </Button>
            ) : null
          }
        />
        {demo && (
          <div className="mx-5 mb-3 rounded-[12px] bg-accent-soft px-4 py-3 text-[13px] text-fg-2">
            You're exploring a demo household. Switch to your data below to
            connect real accounts.
          </div>
        )}
        <div className="divide-y divide-line border-t border-line">
          {status?.connections.map((c) => (
            <ConnectionRow
              key={c.id}
              c={c}
              demo={demo}
              onReconnect={(consent) =>
                plaid.start({
                  kind: "update",
                  connectionId: c.id,
                  ...(consent ? { consent } : {}),
                })
              }
              onRelink={() => plaid.start()}
            />
          ))}
        </div>
      </Card>

      {!demo && !status?.plaid.configured && (
        <Card>
          <CardHeader
            title="Connect Plaid"
            subtitle="Needed once, to link banks, cards and brokerages."
          />
          <div className="px-5 pb-5">
            <PlaidSetup />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Data"
          subtitle="The demo and your real data live in separate files and never mix."
        />
        <div className="flex flex-col gap-4 px-5 pb-5">
          <SettingRow
            label="Showing"
            hint={demo ? "A realistic demo household" : "Your accounts"}
          >
            <Segmented
              size="sm"
              value={status?.profile ?? "demo"}
              onChange={switchProfile}
              options={[
                { value: "real", label: "My data" },
                { value: "demo", label: "Demo" },
              ]}
            />
          </SettingRow>
          {demo && (
            <SettingRow
              label="Reset the demo"
              hint="Start the demo household over from today."
            >
              <Button
                size="sm"
                onClick={async () => {
                  const t = toast.loading("Rebuilding the demo…");
                  await api.resetDemo();
                  await qc.invalidateQueries();
                  toast.success("Demo reset", { id: t });
                }}
              >
                Reset
              </Button>
            </SettingRow>
          )}
        </div>
      </Card>

      <YourDataCard demo={demo} />

      <RulesCard />

      <SecurityCard
        remoteNow={!!status?.auth.remote}
        passwordSet={!!status?.auth.passwordSet}
      />

      <AppearanceCard />

      <Card>
        <CardHeader title="About" />
        <div className="grid gap-3 px-5 pb-5 text-[13px] sm:grid-cols-3">
          <Fact label="Version" value={status?.version ?? "—"} />
          <Fact label="Your data" value="Stays on this Mac" />
          <Fact label="Backups" value="Daily, the last 14 kept" />
        </div>
      </Card>
    </div>
  );
}

function ConnectionRow({
  c,
  demo,
  onReconnect,
  onRelink,
}: {
  c: ConnectionDTO;
  demo: boolean;
  onReconnect: (consent?: string[]) => void;
  onRelink: () => void;
}) {
  // Transaction history depth is fixed when a bank is linked; a link capped at
  // Plaid's 90-day default can only get deeper by linking again (Ikat asks for
  // 24 months, and the old link retires itself without losing anything). A
  // young account's short history is complete, so it's never flagged.
  const shallow = !demo && c.historyCapped;
  const qc = useQueryClient();
  const [removing, setRemoving] = useState(false);
  const needsAttention = c.status === "reauth" || c.status === "error";
  let state: ReactNode = (
    <span className="text-fg-3">
      {c.accountCount} account{c.accountCount === 1 ? "" : "s"} · synced{" "}
      {relativeTime(c.lastSyncedAt)}
      {c.historyPending ? (
        <> · fetching up to 2 years of history…</>
      ) : (
        c.historyFrom && <> · history from {shortDate(c.historyFrom, true)}</>
      )}
    </span>
  );
  if (c.status === "reauth")
    state = <span className="text-warning">Needs you to sign in again</span>;
  else if (c.status === "error")
    state = (
      <span className="text-negative">
        {c.statusDetail ?? "Sync failed"} — will retry
      </span>
    );
  else if (c.missingConsent.length)
    state = (
      <span className="text-accent">
        Can also share{" "}
        {c.missingConsent.map((p) => PRODUCT_LABEL[p] ?? p).join(" and ")}
      </span>
    );

  return (
    <div className="flex items-center gap-3.5 px-5 py-3.5">
      <InstitutionAvatar
        name={c.institutionName}
        logo={c.institutionLogo}
        color={c.institutionColor}
        size={36}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-medium">
            {c.institutionName}
          </span>
          {needsAttention ? (
            <Badge tone="warning">
              <AlertTriangle /> Attention
            </Badge>
          ) : (
            <CheckCircle2 className="size-3.5 text-positive" />
          )}
        </div>
        <div className="truncate text-[12.5px]">{state}</div>
      </div>
      {!demo && c.status === "reauth" && (
        <Button size="sm" variant="primary" onClick={() => onReconnect()}>
          Reconnect
        </Button>
      )}
      {/* A fresh link fixes shallow history and missing consent in one go
          (new links ask for holdings and card details too), so it wins. */}
      {shallow && c.status !== "reauth" ? (
        <Tooltip
          content={`This link only shares history back to ${shortDate(c.historyFrom!, true)}${c.missingConsent.length ? ` and no ${c.missingConsent.map((p) => PRODUCT_LABEL[p] ?? p).join(" or ")}` : ""}. Linking again asks for 2 years and everything available; nothing already recorded is lost.`}
        >
          <Button size="sm" variant="accent" onClick={onRelink}>
            Link again for 2 years
          </Button>
        </Tooltip>
      ) : (
        !demo &&
        c.status !== "reauth" &&
        c.missingConsent.length > 0 && (
          <Button
            size="sm"
            variant="accent"
            onClick={() => onReconnect(c.missingConsent)}
          >
            Grant access
          </Button>
        )
      )}
      <Dropdown>
        <DropdownTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="More">
            <MoreHorizontal />
          </Button>
        </DropdownTrigger>
        <DropdownContent>
          <DropdownItem
            onSelect={async () => {
              const t = toast.loading(`Syncing ${c.institutionName}…`);
              try {
                await api.refreshConnection(c.id);
                await qc.invalidateQueries();
                toast.success("Up to date", { id: t });
              } catch (err) {
                toast.error(
                  err instanceof Error ? err.message : "Sync failed",
                  { id: t },
                );
              }
            }}
          >
            <RefreshCw /> Sync now
          </DropdownItem>
          {!demo && (
            <DropdownItem onSelect={() => onReconnect()}>
              <KeyRound /> Update sign-in
            </DropdownItem>
          )}
          {shallow && (
            <DropdownItem onSelect={onRelink}>
              <History /> Link again for 2 years of history
            </DropdownItem>
          )}
          {!demo && (
            <>
              <DropdownSeparator />
              <DropdownItem
                danger
                onSelect={async () => {
                  if (removing) return;
                  if (
                    !window.confirm(
                      `Remove ${c.institutionName} and all of its history from Ikat?`,
                    )
                  )
                    return;
                  setRemoving(true);
                  await api.removeConnection(c.id);
                  await qc.invalidateQueries();
                  toast.success(`${c.institutionName} removed`);
                }}
              >
                <Trash2 /> Remove from Ikat
              </DropdownItem>
            </>
          )}
        </DropdownContent>
      </Dropdown>
    </div>
  );
}

function RulesCard() {
  const { data: rules } = useRules();
  const qc = useQueryClient();
  return (
    <Card>
      <CardHeader
        title="Category rules"
        subtitle="Made when you recategorise a merchant for good. Rules apply to past and future transactions."
      />
      {rules && rules.length > 0 ? (
        <div className="divide-y divide-line border-t border-line">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-5 py-3">
              <CategoryIcon
                id={r.categoryId}
                size={28}
                className="[&_svg]:size-3.5"
              />
              <div className="min-w-0 flex-1 text-[13.5px]">
                <span className="font-medium">{r.merchant}</span>
                <span className="text-fg-3"> → </span>
                {categoryName(r.categoryId)}
                <div className="text-[12px] text-fg-3">
                  {r.matches} transactions
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const res = await api.deleteRule(r.id);
                  await qc.invalidateQueries();
                  toast.success(
                    `Rule removed — ${res.changed} transactions went back to automatic`,
                  );
                }}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="px-5 pb-5 text-[13px] text-fg-3">
          No rules yet. Change a transaction's category and choose "For all" to
          make one.
        </p>
      )}
    </Card>
  );
}

function SecurityCard({
  remoteNow,
  passwordSet,
}: {
  remoteNow: boolean;
  passwordSet: boolean;
}) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const save = async () => {
    try {
      await api.setPassword(next, current || undefined);
      setCurrent("");
      setNext("");
      await qc.invalidateQueries({ queryKey: ["status"] });
      toast.success(
        passwordSet ? "Password changed" : "Password set — phone access is on",
      );
    } catch {
      toast.error(
        passwordSet ? "Current password is wrong" : "Couldn't set the password",
      );
    }
  };
  return (
    <Card>
      <CardHeader
        title="Access from your phone"
        subtitle="Ikat only listens on this Mac. Your phone reaches it privately through Tailscale."
        action={
          passwordSet ? (
            <Badge tone="positive">
              <ShieldCheck /> Password set
            </Badge>
          ) : (
            <Badge>Mac only</Badge>
          )
        }
      />
      <div className="grid gap-5 px-5 pb-5 md:grid-cols-2">
        <ol className="flex flex-col gap-2.5 text-[13px] text-fg-2">
          <Step n={1}>
            Install Tailscale on this Mac and your phone, signed in to the same
            account.
          </Step>
          <Step n={2}>
            On the Mac, run{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">
              tailscale serve --bg 4545
            </code>
          </Step>
          <Step n={3}>
            Open the address it prints on your phone, then Share → Add to Home
            Screen.
          </Step>
        </ol>
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <Smartphone className="size-4 text-fg-3" />{" "}
            {passwordSet
              ? "Change password"
              : "Set a password to allow phone access"}
          </div>
          {passwordSet && (
            <Input
              type="password"
              placeholder="Current password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          )}
          <Input
            type="password"
            placeholder="New password (8+ characters)"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="sm"
              disabled={
                next.length < 8 ||
                (passwordSet && !current) ||
                (!passwordSet && remoteNow)
              }
              onClick={save}
            >
              {passwordSet ? "Change" : "Set password"}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function AppearanceCard() {
  const [theme, setTheme] = useTheme();
  const [privacy, setPrivacy] = usePrivacy();
  return (
    <Card>
      <CardHeader title="Appearance" />
      <div className="flex flex-col gap-4 px-5 pb-5">
        <SettingRow label="Theme">
          <Segmented
            size="sm"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </SettingRow>
        <SettingRow
          label="Hide amounts"
          hint="Blur every figure until you hover it — for working in public."
        >
          <Switch
            checked={privacy}
            onCheckedChange={setPrivacy}
            aria-label="Hide amounts"
          />
        </SettingRow>
      </div>
    </Card>
  );
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium">{label}</div>
        {hint && <div className="text-[12px] text-fg-3">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold text-fg-2 shadow-[0_0_0_1px_var(--line)]">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11.5px] text-fg-3">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}

const EXPORTS = [
  {
    file: "transactions.csv",
    label: "Transactions",
    hint: "Every transaction, with categories and notes",
  },
  {
    file: "accounts.csv",
    label: "Accounts",
    hint: "Balances as of the last sync",
  },
  {
    file: "holdings.csv",
    label: "Holdings",
    hint: "Positions, value and cost basis",
  },
  {
    file: "ikat.json",
    label: "Everything (JSON)",
    hint: "All of it, for another app — no passwords or keys",
  },
];

function YourDataCard({ demo }: { demo: boolean }) {
  const qc = useQueryClient();
  const { data: backups } = useQuery({
    queryKey: ["backups"],
    queryFn: api.backups,
  });
  const [busy, setBusy] = useState(false);
  const size = (b: number) =>
    b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`;
  return (
    <Card>
      <CardHeader
        title="Your data"
        subtitle={
          demo
            ? "Exports cover the demo while it's showing; backups are always of your real data."
            : "It's yours: take it anywhere, any time."
        }
      />
      <div className="grid gap-2 px-5 pb-4 sm:grid-cols-2">
        {EXPORTS.map((e) => (
          <a
            key={e.file}
            href={`/api/export/${e.file}`}
            download
            className="flex items-center gap-3 rounded-[12px] bg-surface-2 px-3.5 py-3 shadow-[0_0_0_1px_var(--line)] transition-colors hover:bg-surface-3"
          >
            <DownloadCloud className="size-4 shrink-0 text-accent" />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{e.label}</span>
              <span className="block truncate text-[11.5px] text-fg-3">
                {e.hint}
              </span>
            </span>
          </a>
        ))}
      </div>
      <div className="border-t border-line px-5 py-3">
        <ImportRow />
      </div>
      <div className="border-t border-line px-5 py-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[13.5px] font-medium">Backups</div>
            <div className="text-[12px] text-fg-3">
              A full copy of the database every day; the last 14 are kept.
            </div>
          </div>
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                qc.setQueryData(["backups"], await api.backupNow());
                toast.success("Backed up");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="animate-spin" /> : "Back up now"}
          </Button>
        </div>
        {backups && backups.length > 0 && (
          <div className="mt-2 max-h-[180px] divide-y divide-line overflow-y-auto">
            {backups.map((b) => (
              <a
                key={b.name}
                href={`/api/backups/${b.name}`}
                download
                className="flex items-center justify-between gap-3 py-2 text-[12.5px] text-fg-2 hover:text-fg"
              >
                <span className="truncate">
                  {b.name}
                  {b.manual && (
                    <span className="ml-1.5 text-fg-3">· by hand</span>
                  )}
                </span>
                <span className="shrink-0 text-fg-3">
                  {size(b.bytes)} · {relativeTime(b.createdAt)}
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

/** Statements from a bank Plaid can't reach: pick a file, check the preview, import. */
function ImportRow() {
  const qc = useQueryClient();
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: api.accounts,
  });
  const [file, setFile] = useState<{ name: string; content: string } | null>(
    null,
  );
  const [flip, setFlip] = useState(false);
  const [target, setTarget] = useState<string>("new");
  const [name, setName] = useState("");
  const [type, setType] = useState<"checking" | "savings" | "credit">(
    "checking",
  );
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [guessed, setGuessed] = useState(false);
  const imported = (accounts?.accounts ?? []).filter(
    (a) => a.institutionName === "Imported files",
  );
  const body = (): ImportBody => ({
    filename: file!.name,
    content: file!.content,
    flipSign: flip,
    ...(target === "new"
      ? {
          newAccount: {
            name: name.trim() || file!.name.replace(/\.[^.]+$/, ""),
            type,
          },
        }
      : { accountId: target }),
  });

  useEffect(() => {
    if (!file) return;
    api
      .previewImport(body())
      .then((p) => {
        setPreview(p);
        if (p.suggestedType) setType(p.suggestedType);
        // First look at a new file: if purchases read positive, flip them.
        if (!guessed) {
          setGuessed(true);
          if (p.looksFlipped) setFlip(true);
        }
      })
      .catch((err: Error) => {
        setPreview(null);
        toast.error(err.message);
      });
  }, [file, flip, target]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (f: File | undefined) => {
    if (!f) return;
    const content = await f.text();
    setFlip(false);
    setGuessed(false);
    setFile({ name: f.name, content });
    setName(f.name.replace(/\.[^.]+$/, ""));
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[13.5px] font-medium">Import a statement</div>
          <div className="text-[12px] text-fg-3">
            CSV, OFX or QFX from a bank Ikat can't link. Importing the same file
            twice adds nothing.
          </div>
        </div>
        <label className="inline-flex h-7 shrink-0 cursor-pointer items-center rounded-[8px] bg-surface-2 px-2.5 text-[12.5px] font-medium shadow-[0_0_0_1px_var(--line)] hover:bg-surface-3">
          Choose file
          <input
            type="file"
            accept=".csv,.ofx,.qfx,.qbo,text/csv"
            className="hidden"
            onChange={(e) => void pick(e.target.files?.[0])}
          />
        </label>
      </div>
      {file && preview && (
        <div className="mt-3 flex flex-col gap-3 rounded-[12px] bg-surface-2 p-4 shadow-[0_0_0_1px_var(--line)]">
          <div className="text-[12.5px] text-fg-2">
            <span className="font-medium text-fg">{file.name}</span> ·{" "}
            {preview.count} transactions, {shortDate(preview.from, true)} –{" "}
            {shortDate(preview.to, true)}
            {preview.alreadyImported > 0 &&
              ` · ${preview.alreadyImported} already here`}
            {preview.skipped > 0 && ` · ${preview.skipped} rows unreadable`}
          </div>
          <div className="divide-y divide-line rounded-[10px] bg-surface text-[12px] shadow-[0_0_0_1px_var(--line)]">
            {preview.sample.slice(0, 5).map((t, i) => (
              <div key={i} className="flex gap-3 px-3 py-1.5">
                <span className="w-[74px] shrink-0 text-fg-3">
                  {shortDate(t.date, true)}
                </span>
                <span className="min-w-0 flex-1 truncate">{t.description}</span>
                <Money
                  cents={t.amountCents}
                  tone="income"
                  className="font-medium"
                />
              </div>
            ))}
          </div>
          {preview.format === "csv" && (
            <SettingRow
              label="Spending shows as positive"
              hint={
                preview.looksFlipped
                  ? "Most amounts are positive — card exports often write purchases that way."
                  : "Purchases should read negative in the preview above."
              }
            >
              <Switch
                checked={flip}
                onCheckedChange={setFlip}
                aria-label="Flip signs"
              />
            </SettingRow>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="h-8 rounded-[8px] bg-surface px-2 text-[12.5px] shadow-[0_0_0_1px_var(--line)]"
            >
              <option value="new">Into a new account</option>
              {imported.map((a) => (
                <option key={a.id} value={a.id}>
                  Into {a.displayName}
                </option>
              ))}
            </select>
            {target === "new" && (
              <>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-8 w-[180px] text-[12.5px]"
                  placeholder="Account name"
                />
                <Segmented
                  size="sm"
                  value={type}
                  onChange={setType}
                  options={[
                    { value: "checking", label: "Checking" },
                    { value: "savings", label: "Savings" },
                    { value: "credit", label: "Card" },
                  ]}
                />
              </>
            )}
            <Button
              size="sm"
              variant="primary"
              className="ml-auto"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await api.importStatement(body());
                  await qc.invalidateQueries();
                  toast.success(
                    r.added
                      ? `Imported ${r.added} transactions`
                      : "Nothing new — these were already imported",
                  );
                  setFile(null);
                  setPreview(null);
                } catch (err) {
                  toast.error((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? (
                <Loader2 className="animate-spin" />
              ) : (
                `Import ${preview.count - preview.alreadyImported}`
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
