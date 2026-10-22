import { and, eq, isNotNull, max, ne, or } from "drizzle-orm";
import { addDays, baseTicker, OPTION_SYMBOL, type ISODate } from "@ikat/core";
import { schema, type DB } from "./db";

// Daily closing prices for held securities, so investment history can be
// rebuilt and performance measured. Only ticker symbols leave the machine —
// never quantities, values or anything about the account. Yahoo's public
// chart endpoint needs no key; any other source can slot in behind
// `fetchHistory`.

const HISTORY_DAYS = 740;

export type PriceFetcher = (
  symbol: string,
  from: ISODate,
  to: ISODate,
) => Promise<Array<{ date: ISODate; close: number }>>;

/** "ABCD271217C00022000" → "2027-12-17"; null for anything that isn't an option symbol. */
function optionExpiry(ticker: string): ISODate | null {
  if (!OPTION_SYMBOL.test(ticker)) return null;
  const m = ticker.match(/(\d{2})(\d{2})(\d{2})[CP]\d{8}$/)!;
  return `20${m[1]}-${m[2]}-${m[3]}`;
}

function yahooSymbol(ticker: string, type: string | null): string {
  if (OPTION_SYMBOL.test(ticker)) return ticker;
  const t = baseTicker(ticker)!;
  if (type === "cryptocurrency" || ticker.startsWith("CUR:")) return `${t}-USD`;
  return t.replace(".", "-");
}

export const yahooFetcher: PriceFetcher = async (symbol, from, to) => {
  const p1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
  const p2 = Math.floor(Date.parse(`${to}T23:59:59Z`) / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Ikat personal finance)" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${symbol}: HTTP ${res.status}`);
  const body = (await res.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        meta?: { gmtoffset?: number };
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  };
  const r = body.chart?.result?.[0];
  const ts = r?.timestamp ?? [];
  const closes = r?.indicators?.quote?.[0]?.close ?? [];
  const offset = r?.meta?.gmtoffset ?? 0;
  const out: Array<{ date: ISODate; close: number }> = [];
  ts.forEach((t, i) => {
    const c = closes[i];
    if (c == null || !Number.isFinite(c)) return;
    out.push({
      date: new Date((t + offset) * 1000).toISOString().slice(0, 10),
      close: c,
    });
  });
  return out;
};

/** Fill in missing daily closes for every held security (and the benchmark). */
export async function refreshPrices(
  db: DB,
  today: ISODate,
  fetcher: PriceFetcher = yahooFetcher,
  benchmark = "VTI",
) {
  ensureBenchmark(db, benchmark);
  const securities = db
    .select()
    .from(schema.securities)
    .where(
      and(
        isNotNull(schema.securities.ticker),
        eq(schema.securities.isCashEquivalent, false),
      ),
    )
    .all();
  let updated = 0;
  const failed: string[] = [];
  // Institutions sometimes put internal labels in the ticker field
  // ("ACME.RSU", "VANG.INST.500.IDX.TR"); only real symbols are looked up.
  const MARKET_SYMBOL = /^(CUR:[A-Z0-9]{2,10}|[A-Z0-9]{1,6}([.-][A-Z]{1,2})?)$/;
  for (const sec of securities) {
    if (
      !MARKET_SYMBOL.test(sec.ticker!.toUpperCase()) &&
      !OPTION_SYMBOL.test(sec.ticker!)
    )
      continue;
    // An option a week past expiry has no more closes to fetch (and sources drop it).
    const expiry = optionExpiry(sec.ticker!);
    if (expiry && expiry < addDays(today, -7)) continue;
    const last = db
      .select({ d: max(schema.prices.date) })
      .from(schema.prices)
      .where(
        and(
          eq(schema.prices.securityId, sec.id),
          ne(schema.prices.source, "demo"),
        ),
      )
      .get()?.d;
    const from = last ? addDays(last, 1) : addDays(today, -HISTORY_DAYS);
    if (from >= today) continue;
    try {
      const rows = await fetcher(
        yahooSymbol(sec.ticker!, sec.type),
        from,
        today,
      );
      db.transaction((tx) => {
        for (const r of rows) {
          tx.insert(schema.prices)
            .values({
              securityId: sec.id,
              date: r.date,
              closeCents: r.close * 100,
              source: "yahoo",
            })
            .onConflictDoUpdate({
              target: [schema.prices.securityId, schema.prices.date],
              set: { closeCents: r.close * 100, source: "yahoo" },
            })
            .run();
          updated++;
        }
      });
    } catch (err) {
      failed.push(
        `${sec.ticker}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { updated, failed };
}

/** A security row for the benchmark fund, so its prices live alongside the rest. */
export function ensureBenchmark(db: DB, ticker: string): string {
  const existing = db
    .select()
    .from(schema.securities)
    .where(
      or(
        eq(schema.securities.ticker, ticker),
        eq(schema.securities.externalId, `benchmark:${ticker}`),
      ),
    )
    .get();
  if (existing) return existing.id;
  const id = `benchmark-${ticker}`;
  db.insert(schema.securities)
    .values({
      id,
      externalId: `benchmark:${ticker}`,
      ticker,
      name: `${ticker} (benchmark)`,
      type: "etf",
    })
    .onConflictDoNothing()
    .run();
  return id;
}
