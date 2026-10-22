// Statement files, for institutions no aggregator reaches: CSV exports in
// whatever columns the bank chose, and OFX/QFX (Quicken/Money) files.

import type { ISODate } from "./dates";
import type { Cents } from "./money";

export interface ImportedTransaction {
  date: ISODate;
  description: string;
  /** + money in, − money out (after any sign flip). */
  amountCents: Cents;
  /** Stable id: the file's own (OFX FITID) or one derived from the row. */
  externalId: string;
  category?: string | null;
}

export interface ParsedFile {
  format: "csv" | "ofx";
  transactions: ImportedTransaction[];
  /** Ending balance, when the file states one (OFX). */
  balanceCents: Cents | null;
  account: {
    id: string | null;
    type: "checking" | "savings" | "credit" | null;
  } | null;
  /** How CSV columns were read, to show the user. */
  columns?: CsvColumns;
  /** Rows that couldn't be read. */
  skipped: number;
}

/** RFC 4180 CSV, tolerant of a BOM, CRLF and quoted commas or line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export interface CsvColumns {
  date: number;
  description: number;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  category: number | null;
}

const find = (header: string[], ...patterns: RegExp[]) => {
  for (const p of patterns) {
    const i = header.findIndex((h) => p.test(h.trim()));
    if (i >= 0) return i;
  }
  return null;
};

/** Which column is which, from the header row. Null when there's no date, description or amount. */
export function detectColumns(header: string[]): CsvColumns | null {
  const date = find(
    header,
    /^(transaction |trans\.? |posted |post(ing)? )?date$/i,
    /date/i,
  );
  const description = find(
    header,
    /^description$/i,
    /^(payee|merchant|name)$/i,
    /description|payee|merchant|details|memo/i,
  );
  const amount = find(header, /^amount$/i, /amount/i);
  const debit = find(
    header,
    /^(debit|withdrawals?|money out|charges?)$/i,
    /debit|withdrawal/i,
  );
  const credit = find(
    header,
    /^(credit|deposits?|money in|payments?)$/i,
    /credit|deposit/i,
  );
  const category = find(header, /^category$/i);
  if (
    date == null ||
    description == null ||
    (amount == null && debit == null && credit == null)
  )
    return null;
  return {
    date,
    description,
    amount: amount ?? null,
    debit: amount == null ? debit : null,
    credit: amount == null ? credit : null,
    category,
  };
}

/** "$1,234.56", "(12.34)", "-12.34", "12.34-" → cents; null when it isn't a number. */
export function parseAmount(raw: string): Cents | null {
  let s = raw.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    neg = !neg;
    s = s.slice(0, -1);
  }
  s = s.replace(/[$€£,\s]/g, "");
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return neg ? -cents : cents;
}

/** ISO, US (M/D/YYYY, M/D/YY) or "Sep 15, 2026" dates. */
export function parseDate(raw: string): ISODate | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = Date.parse(`${s} UTC`);
  return Number.isNaN(d) ? null : new Date(d).toISOString().slice(0, 10);
}

/** A short stable hash, so the same row imported twice is the same transaction. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Transactions from a CSV. `flipSign` is for files that show spending as
 * positive (common for card exports). Identical rows on the same day stay
 * distinct by their order.
 */
export function readCsv(
  text: string,
  opts: { flipSign?: boolean } = {},
): ParsedFile | null {
  const rows = parseCsv(text);
  const headerAt = rows.findIndex((r) => detectColumns(r) != null);
  if (headerAt < 0) return null;
  const cols = detectColumns(rows[headerAt]!)!;
  const seen = new Map<string, number>();
  const out: ImportedTransaction[] = [];
  let skipped = 0;
  for (const r of rows.slice(headerAt + 1)) {
    const date = parseDate(r[cols.date] ?? "");
    const description = (r[cols.description] ?? "").trim();
    let amount: Cents | null;
    if (cols.amount != null) amount = parseAmount(r[cols.amount] ?? "");
    else {
      const out = cols.debit != null ? parseAmount(r[cols.debit] ?? "") : null;
      const inn =
        cols.credit != null ? parseAmount(r[cols.credit] ?? "") : null;
      amount =
        out != null && out !== 0
          ? -Math.abs(out)
          : inn != null
            ? Math.abs(inn)
            : null;
    }
    if (!date || !description || amount == null) {
      skipped++;
      continue;
    }
    if (opts.flipSign) amount = -amount;
    const base = `${date}|${amount}|${description.toLowerCase()}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({
      date,
      description,
      amountCents: amount,
      externalId: `csv-${hash(base)}-${n}`,
      category: cols.category != null ? r[cols.category]?.trim() || null : null,
    });
  }
  return {
    format: "csv",
    transactions: out,
    balanceCents: null,
    account: null,
    columns: cols,
    skipped,
  };
}

/** OFX 1.x (SGML) and 2.x (XML) statements, including QFX. */
export function readOfx(text: string): ParsedFile | null {
  if (!/<OFX>/i.test(text)) return null;
  const tag = (block: string, name: string) =>
    block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"))?.[1]?.trim() ?? null;
  const out: ImportedTransaction[] = [];
  let skipped = 0;
  for (const m of text.matchAll(
    /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi,
  )) {
    const b = m[1]!;
    const date = parseDate(tag(b, "DTPOSTED") ?? "");
    const amount = parseAmount(tag(b, "TRNAMT") ?? "");
    const name = tag(b, "NAME") ?? tag(b, "MEMO") ?? "";
    const memo = tag(b, "MEMO");
    const fitid = tag(b, "FITID");
    if (!date || amount == null || !name) {
      skipped++;
      continue;
    }
    out.push({
      date,
      description: memo && memo !== name ? `${name} ${memo}` : name,
      amountCents: amount,
      externalId: fitid
        ? `ofx-${fitid}`
        : `ofx-${hash(`${date}|${amount}|${name}`)}`,
    });
  }
  const ledger = text.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]+)/i)?.[1];
  const acctType = tag(text, "ACCTTYPE")?.toLowerCase();
  const isCard = /<CCACCTFROM>/i.test(text);
  return {
    format: "ofx",
    transactions: out,
    balanceCents: ledger ? parseAmount(ledger) : null,
    account: {
      id: tag(text, "ACCTID"),
      type: isCard ? "credit" : acctType === "savings" ? "savings" : "checking",
    },
    skipped,
  };
}

export function readStatement(
  filename: string,
  text: string,
  opts: { flipSign?: boolean } = {},
): ParsedFile | null {
  if (/\.(ofx|qfx|qbo)$/i.test(filename) || /<OFX>/i.test(text.slice(0, 2000)))
    return readOfx(text);
  return readCsv(text, opts);
}
