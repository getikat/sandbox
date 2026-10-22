import { todayISO, type ISODate } from "@ikat/core";
import type { PlaidApi } from "plaid";
import type { Config } from "./config";
import type { Store } from "./db";
import type { Secrets } from "./secrets";

export interface AppContext {
  config: Config;
  store: Store;
  secrets: Secrets;
  plaid: PlaidApi | null;
  /** Injectable clock: tests pin it; production reads the machine's date. */
  today: () => ISODate;
  version: string;
}

export function systemClock(): ISODate {
  return todayISO();
}
