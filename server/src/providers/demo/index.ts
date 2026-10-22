import type { ISODate } from "@ikat/core";
import type { ConnectionRow, Provider, SyncResult } from "../types";
import { generateHousehold, type DemoData } from "./household";

export { generateHousehold } from "./household";

/**
 * The demo household behind the same interface as Plaid. Each demo
 * institution is a connection; a sync returns that institution's full history,
 * which the engine upserts idempotently (ids are stable for a given anchor).
 */
export class DemoProvider implements Provider {
  private cache: { key: string; data: DemoData } | null = null;

  constructor(private anchor: () => ISODate) {}

  data(today: ISODate): DemoData {
    const key = `${this.anchor()}|${today}`;
    if (this.cache?.key !== key)
      this.cache = { key, data: generateHousehold(this.anchor(), today) };
    return this.cache.data;
  }

  async sync(
    conn: ConnectionRow,
    _token: string | null,
    today: ISODate,
  ): Promise<SyncResult> {
    const data = this.data(today);
    const inst = data.institutions.find((i) => i.key === conn.externalId);
    if (!inst) throw new Error(`Unknown demo institution ${conn.externalId}`);
    const heldIds = new Set([
      ...inst.holdings.map((h) => h.securityExternalId),
      ...inst.investmentTransactions
        .map((t) => t.securityExternalId)
        .filter((x): x is string => !!x),
    ]);
    return {
      institution: {
        id: `demo-${inst.key}`,
        name: inst.name,
        logo: null,
        color: inst.color,
      },
      accounts: inst.accounts,
      transactions: {
        added: inst.transactions,
        modified: [],
        removed: inst.removed,
        cursor: today,
      },
      investments: inst.hasInvestments
        ? {
            securities: data.securities.filter((s) =>
              heldIds.has(s.externalId),
            ),
            holdings: inst.holdings,
            transactions: inst.investmentTransactions,
          }
        : null,
      liabilities: inst.liabilities,
      missingConsent: [],
      products: inst.hasInvestments
        ? ["transactions", "investments"]
        : ["transactions", "liabilities"],
      history: {
        snapshots: inst.snapshots,
        prices: data.prices.filter((p) => heldIds.has(p.securityExternalId)),
      },
    };
  }
}

export const DEMO_INSTITUTIONS = [
  { key: "chase", name: "Chase", color: "#117ACA" },
  { key: "amex", name: "American Express", color: "#016FD0" },
  { key: "ally", name: "Ally Bank", color: "#8A2BE2" },
  { key: "fidelity", name: "Fidelity", color: "#368727" },
  { key: "vanguard", name: "Vanguard", color: "#96151D" },
  { key: "coinbase", name: "Coinbase", color: "#0052FF" },
  { key: "toyota", name: "Toyota Financial Services", color: "#EB0A1E" },
  { key: "msw", name: "Morgan Stanley at Work", color: "#1B365D" },
];
