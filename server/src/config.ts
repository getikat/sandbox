import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The repo root, whether running from src/ under tsx or from dist/ after build.
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..", "..");

/** Minimal .env loader: KEY=value lines, no interpolation, never overrides the real env. */
function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, raw] = m as unknown as [string, string, string];
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^(['"])(.*)\1$/, "$2");
  }
}

loadDotEnv(path.join(ROOT, ".env"));

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  plaid: {
    clientId: string | null;
    secret: string | null;
    env: "sandbox" | "production";
  };
  isTest: boolean;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = process.env;
  const plaidEnv = env.PLAID_ENV === "sandbox" ? "sandbox" : "production";
  const base: Config = {
    port: Number(env.PORT ?? 4545),
    // Loopback only by default: remote access goes through `tailscale serve`,
    // which proxies to localhost, so nothing needs to listen on the LAN.
    host: env.HOST ?? "127.0.0.1",
    dataDir: path.resolve(ROOT, env.IKAT_DATA_DIR ?? "data"),
    plaid: {
      clientId: env.PLAID_CLIENT_ID || null,
      secret: env.PLAID_SECRET || null,
      env: plaidEnv,
    },
    isTest: env.VITEST === "true" || env.NODE_ENV === "test",
  };
  const cfg = { ...base, ...overrides };
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  return cfg;
}
