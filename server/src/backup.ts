import fs from "node:fs";
import path from "node:path";
import type { AppContext } from "./context";

const KEEP_DAILY = 14;
const KEEP_MANUAL = 5;
export const BACKUP_NAME = /^ikat-\d{4}-\d{2}-\d{2}(-\d{4}-manual)?\.db$/;

const dir = (ctx: AppContext) => path.join(ctx.config.dataDir, "backups");

/**
 * A consistent copy of the real database via SQLite's online backup. Daily
 * copies keep the last 14; ones made by hand keep the last 5.
 */
export async function backup(
  ctx: AppContext,
  kind: "daily" | "manual",
): Promise<string | null> {
  fs.mkdirSync(dir(ctx), { recursive: true });
  const today = ctx.today();
  // Local time, like the date beside it ("ikat-2026-09-24-2024-manual" at 8:24 pm).
  const now = new Date();
  const stamp = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const name =
    kind === "daily" ? `ikat-${today}.db` : `ikat-${today}-${stamp}-manual.db`;
  const target = path.join(dir(ctx), name);
  if (kind === "daily" && fs.existsSync(target)) return null;
  await ctx.store.db("real").$client.backup(target);
  const files = fs
    .readdirSync(dir(ctx))
    .filter((f) => BACKUP_NAME.test(f))
    .sort();
  const daily = files.filter((f) => !f.includes("manual"));
  const manual = files.filter((f) => f.includes("manual"));
  for (const f of [
    ...daily.slice(0, Math.max(0, daily.length - KEEP_DAILY)),
    ...manual.slice(0, Math.max(0, manual.length - KEEP_MANUAL)),
  ])
    fs.rmSync(path.join(dir(ctx), f));
  return name;
}

export function listBackups(ctx: AppContext) {
  if (!fs.existsSync(dir(ctx))) return [];
  return fs
    .readdirSync(dir(ctx))
    .filter((f) => BACKUP_NAME.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(dir(ctx), f));
      return {
        name: f,
        bytes: st.size,
        createdAt: st.mtime.toISOString(),
        manual: f.includes("manual"),
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function backupPath(ctx: AppContext, name: string): string | null {
  if (!BACKUP_NAME.test(name)) return null;
  const p = path.join(dir(ctx), name);
  return fs.existsSync(p) ? p : null;
}
