import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppContext } from "./context";
import { schema } from "./db";
import { DEMO_INSTITUTIONS } from "./providers/demo";
import type { SyncEngine } from "./sync/engine";

/**
 * Create the demo household if the demo profile is empty. The anchor date is
 * written once, so every later sync regenerates the same history with the same
 * ids and only appends the days since.
 */
export async function ensureDemo(ctx: AppContext, engine: SyncEngine) {
  const db = ctx.store.db("demo");
  const any = db.select().from(schema.connections).limit(1).get();
  if (any) return false;
  db.insert(schema.settings)
    .values({ key: "demo.anchor", value: ctx.today() })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: ctx.today() },
    })
    .run();
  for (const inst of DEMO_INSTITUTIONS) {
    db.insert(schema.connections)
      .values({
        id: crypto.randomUUID(),
        provider: "demo",
        externalId: inst.key,
        institutionName: inst.name,
        institutionColor: inst.color,
        institutionLogo: null,
      })
      .run();
  }
  const conns = db
    .select()
    .from(schema.connections)
    .where(eq(schema.connections.provider, "demo"))
    .all();
  for (const c of conns) await engine.syncOne(db, c, ctx.today());
  const { pairTransfers } = await import("./sync/transfers");
  pairTransfers(db);
  return true;
}
