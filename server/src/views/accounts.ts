import { eq } from "drizzle-orm";
import {
  GROUP_LABELS,
  GROUP_ORDER,
  groupFor,
  investmentKind,
  isLiability,
  normalizeType,
  subtypeLabel,
  taxTreatmentFor,
  type AccountDTO,
  type AccountGroup,
  type AccountsDTO,
} from "@ikat/core";
import { schema, type DB } from "../db";

// Names institutions give accounts that say nothing ("CREDIT CARD" for every
// Chase card). When the name is one of these, a more specific name wins.
const GENERIC =
  /^(credit card|checking|savings|brokerage|individual|investment|account|loan)$/i;

type Row = typeof schema.accounts.$inferSelect & {
  provider: string;
  institutionName: string;
  institutionColor: string | null;
  institutionLogo: string | null;
};

/** Every account row with its institution; duplicates (see sync/duplicates.ts) are left out unless asked for. */
export function loadAccountRows(
  db: DB,
  opts: { includeDuplicates?: boolean } = {},
): Row[] {
  const rows = db
    .select({
      account: schema.accounts,
      provider: schema.connections.provider,
      institutionName: schema.connections.institutionName,
      institutionColor: schema.connections.institutionColor,
      institutionLogo: schema.connections.institutionLogo,
    })
    .from(schema.accounts)
    .innerJoin(
      schema.connections,
      eq(schema.connections.id, schema.accounts.connectionId),
    )
    .all()
    .map((r) => ({
      ...r.account,
      provider: r.provider,
      institutionName: r.institutionName,
      institutionColor: r.institutionColor,
      institutionLogo: r.institutionLogo || null,
    }));
  return opts.includeDuplicates ? rows : rows.filter((r) => !r.duplicateOf);
}

/** nickname › specific name › official name, with ••mask added where two collide. */
export function displayNames(rows: Row[]): Map<string, string> {
  const base = new Map<string, string>();
  for (const r of rows) {
    const specific = r.name && !GENERIC.test(r.name.trim()) ? r.name : null;
    // Lenders put the next due date in a loan's name ("… (Due: 10/15/2026 L0020)"), and
    // some institutions the last four digits ("Robinhood Credit Card **4242"); neither is
    // part of the name, and the digits are shown on their own.
    let name = (
      r.nickname?.trim() ||
      specific ||
      r.officialName ||
      r.name ||
      "Account"
    ).replace(/\s*\(Due:[^)]*\)/i, "");
    if (r.mask)
      name = name.replace(
        new RegExp(`\\s*(\\*+|\\.{2,}|\\bx+|#|•+)\\s*${r.mask}\\s*$`, "i"),
        "",
      );
    // Institutions shout ("2021 TOYOTA RAV4", "ACME 401(K) PLAN"): a name
    // you didn't give it reads in title case, acronyms and codes left alone.
    if (
      !r.nickname?.trim() &&
      name === name.toUpperCase() &&
      /[A-Z]{4}/.test(name)
    ) {
      name = name.replace(
        /\b[A-Z]{4,}\b/g,
        (w) => w.charAt(0) + w.slice(1).toLowerCase(),
      );
    }
    base.set(r.id, name.trim() || r.name);
  }
  const counts = new Map<string, number>();
  for (const name of base.values())
    counts.set(name, (counts.get(name) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const r of rows) {
    const name = base.get(r.id)!;
    out.set(
      r.id,
      counts.get(name)! > 1 && r.mask ? `${name} ••${r.mask}` : name,
    );
  }
  return out;
}

export function toAccountDTO(r: Row, displayName: string): AccountDTO {
  const liability = isLiability(r.type);
  const group = groupFor(r.type, r.groupOverride as AccountGroup | null);
  const balance = r.currentCents ?? 0;
  const signed = liability ? -balance : balance;
  return {
    id: r.id,
    connectionId: r.connectionId,
    institutionName: r.institutionName,
    institutionColor: r.institutionColor,
    institutionLogo: r.institutionLogo,
    displayName,
    name: r.name,
    officialName: r.officialName,
    nickname: r.nickname,
    mask: r.mask,
    type: normalizeType(r.type),
    subtype: r.subtype,
    subtypeLabel: subtypeLabel(r.subtype),
    group,
    investmentKind:
      normalizeType(r.type) === "investment" ? investmentKind(r.subtype) : null,
    taxTreatment: taxTreatmentFor(r.type, r.subtype),
    owner: r.owner,
    isLiability: liability,
    balanceCents: balance,
    availableCents: r.availableCents,
    limitCents: r.limitCents,
    netWorthCents: r.includeInNetWorth && !r.closedAt ? signed : 0,
    includeInNetWorth: r.includeInNetWorth,
    hidden: r.hidden,
    balanceAsOf: r.balanceAsOf,
    manual: r.provider === "manual",
  };
}

export function accountsView(db: DB): AccountsDTO {
  const rows = loadAccountRows(db).filter((r) => !r.closedAt);
  const names = displayNames(rows);
  const accounts = rows
    .map((r) => toAccountDTO(r, names.get(r.id)!))
    .sort(
      (a, b) =>
        GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
        Math.abs(b.balanceCents) - Math.abs(a.balanceCents),
    );

  // Every account lands in exactly one group, and the groups sum to net worth —
  // the page never adds rows up itself and disagrees with the server.
  const groups = GROUP_ORDER.map((group) => {
    const members = accounts.filter((a) => a.group === group);
    return {
      group,
      label: GROUP_LABELS[group],
      totalCents: members.reduce((s, a) => s + a.netWorthCents, 0),
      count: members.length,
    };
  }).filter((g) => g.count > 0);

  const assetsCents = accounts
    .filter((a) => a.netWorthCents > 0)
    .reduce((s, a) => s + a.netWorthCents, 0);
  const liabilitiesCents = -accounts
    .filter((a) => a.netWorthCents < 0)
    .reduce((s, a) => s + a.netWorthCents, 0);
  return {
    accounts,
    groups,
    netWorthCents: assetsCents - liabilitiesCents,
    assetsCents,
    liabilitiesCents,
  };
}
