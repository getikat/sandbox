import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ISODate } from "@ikat/core";
import { buildApp, type App } from "../src/app";
import { loadConfig } from "../src/config";
import type { AppContext } from "../src/context";
import { Store } from "../src/db";
import { ensureDemo } from "../src/demo";
import { Secrets } from "../src/secrets";

export const TODAY: ISODate = "2026-09-23";

export interface TestApp extends App {
  ctx: AppContext;
  dir: string;
  clock: { today: ISODate };
  get<T = unknown>(url: string, headers?: Record<string, string>): Promise<T>;
  close(): Promise<void>;
}

/** A fresh app on a temp data dir, demo household seeded, clock pinned. */
export async function makeApp(
  opts: { seed?: boolean; today?: ISODate } = {},
): Promise<TestApp> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ikat-test-"));
  process.env.IKAT_SECRET_KEY = "0".repeat(64);
  const config = loadConfig({
    dataDir: dir,
    isTest: true,
    plaid: { clientId: null, secret: null, env: "sandbox" },
  });
  const clock = { today: opts.today ?? TODAY };
  const ctx: AppContext = {
    config,
    store: new Store(dir, "demo"),
    secrets: new Secrets(dir, { useKeychain: false }),
    plaid: null,
    today: () => clock.today,
    version: "test",
  };
  const app = await buildApp(ctx);
  if (opts.seed !== false) await ensureDemo(ctx, app.engine);
  return {
    ...app,
    ctx,
    dir,
    clock,
    async get<T>(url: string, headers: Record<string, string> = {}) {
      const res = await app.server.inject({ method: "GET", url, headers });
      if (res.statusCode >= 400)
        throw new Error(`${url} → ${res.statusCode} ${res.body}`);
      return res.json() as T;
    },
    async close() {
      await app.server.close();
      ctx.store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
