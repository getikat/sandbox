import { desc, eq, max, min } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  addDays,
  diffDays,
  type ConnectionDTO,
  type StatusDTO,
} from "@ikat/core";
import type { AppContext } from "../context";
import {
  createSession,
  endSession,
  getPasswordHash,
  hashPassword,
  isRemote,
  setPasswordHash,
  validSession,
  verifyPassword,
} from "../auth";
import { schema } from "../db";
import { ensureDemo } from "../demo";
import type { SyncEngine } from "../sync/engine";
import { plaidClient } from "../providers/plaid";
import { setupView } from "../views/setup";

/**
 * A link capped at Plaid's 90-day default shows it in its history: the
 * earliest transaction sits ~90 days before the link date. A young account's
 * history starts later than that, and a Ikat link asked for two years — in
 * neither case would linking again add anything.
 */
function historyCapped(
  c: typeof schema.connections.$inferSelect,
  historyFrom: string | null,
  investingFrom: string | null,
): boolean {
  if (c.provider !== "plaid" || (c.historyDaysRequested ?? 0) >= 730)
    return false;
  const linked = c.createdAt.slice(0, 10);
  if (
    historyFrom &&
    Math.abs(diffDays(addDays(linked, -90), historyFrom)) <= 10
  )
    return true;
  // Investment activity that only starts around the link itself (a brokerage
  // linked, then sending trades only from two weeks later) was never fetched further back.
  return (
    !historyFrom && !!investingFrom && investingFrom >= addDays(linked, -30)
  );
}

export function connectionDTOs(ctx: AppContext): ConnectionDTO[] {
  const db = ctx.store.db();
  const conns = db
    .select()
    .from(schema.connections)
    .orderBy(schema.connections.institutionName)
    .all();
  const accts = db
    .select({
      connectionId: schema.accounts.connectionId,
      duplicateOf: schema.accounts.duplicateOf,
    })
    .from(schema.accounts)
    .all();
  const depth = new Map(
    db
      .select({
        connectionId: schema.accounts.connectionId,
        first: min(schema.transactions.date),
      })
      .from(schema.transactions)
      .innerJoin(
        schema.accounts,
        eq(schema.accounts.id, schema.transactions.accountId),
      )
      .groupBy(schema.accounts.connectionId)
      .all()
      .map((r) => [r.connectionId, r.first]),
  );
  const investingDepth = new Map(
    db
      .select({
        connectionId: schema.accounts.connectionId,
        first: min(schema.investmentTransactions.date),
      })
      .from(schema.investmentTransactions)
      .innerJoin(
        schema.accounts,
        eq(schema.accounts.id, schema.investmentTransactions.accountId),
      )
      .groupBy(schema.accounts.connectionId)
      .all()
      .map((r) => [r.connectionId, r.first]),
  );
  return conns.map((c) => ({
    id: c.id,
    provider: c.provider,
    institutionName: c.institutionName,
    institutionLogo: c.institutionLogo || null,
    institutionColor: c.institutionColor || null,
    status: c.status,
    statusDetail: c.statusDetail,
    lastSyncedAt: c.lastSyncedAt,
    accountCount: accts.filter((a) => a.connectionId === c.id && !a.duplicateOf)
      .length,
    duplicateCount: accts.filter(
      (a) => a.connectionId === c.id && a.duplicateOf,
    ).length,
    missingConsent: c.missingConsent,
    historyFrom:
      [depth.get(c.id), investingDepth.get(c.id)]
        .filter((d): d is string => !!d)
        .sort()[0] ?? null,
    historyCapped: historyCapped(
      c,
      depth.get(c.id) ?? null,
      investingDepth.get(c.id) ?? null,
    ),
    historyPending:
      c.provider === "plaid" &&
      c.historyStatus !== "HISTORICAL_UPDATE_COMPLETE" &&
      Date.now() - Date.parse(c.createdAt) < 3 * 86_400_000,
  }));
}

export function registerSystemRoutes(
  server: FastifyInstance,
  ctx: AppContext,
  engine: SyncEngine,
) {
  server.get("/api/health", async () => ({ ok: true, version: ctx.version }));

  server.get("/api/status", async (req): Promise<StatusDTO> => {
    const db = ctx.store.db();
    const last = db
      .select({ at: max(schema.connections.lastSyncedAt) })
      .from(schema.connections)
      .get();
    return {
      profile: ctx.store.profile,
      version: ctx.version,
      plaid: {
        configured: !!ctx.plaid,
        env: ctx.plaid ? ctx.config.plaid.env : null,
      },
      auth: {
        passwordSet: !!getPasswordHash(ctx.store.db("real")),
        remote: isRemote(req),
      },
      connections: connectionDTOs(ctx),
      lastSyncAt: last?.at ?? null,
      syncing: engine.syncing,
      today: ctx.today(),
    };
  });

  // --- auth ---
  server.get("/api/auth/state", async (req) => {
    const db = ctx.store.db("real");
    const remote = isRemote(req);
    return {
      remote,
      passwordSet: !!getPasswordHash(db),
      authenticated: !remote || validSession(db, req),
    };
  });

  server.post("/api/auth/login", async (req, reply) => {
    const { password } = z
      .object({ password: z.string().min(1) })
      .parse(req.body);
    const db = ctx.store.db("real");
    const hash = getPasswordHash(db);
    if (!hash || !(await verifyPassword(password, hash))) {
      await new Promise((r) => setTimeout(r, 400)); // blunt brute force
      return reply.code(401).send({ error: "INVALID_PASSWORD" });
    }
    createSession(db, req, reply);
    return { ok: true };
  });

  server.post("/api/auth/logout", async (req, reply) => {
    endSession(ctx.store.db("real"), req, reply);
    return { ok: true };
  });

  server.post("/api/auth/password", async (req, reply) => {
    const body = z
      .object({ current: z.string().optional(), next: z.string().min(8) })
      .parse(req.body);
    const db = ctx.store.db("real");
    const existing = getPasswordHash(db);
    // Changing a password needs the old one; setting the first one is only
    // allowed from the machine itself.
    if (
      existing
        ? !(body.current && (await verifyPassword(body.current, existing)))
        : isRemote(req)
    ) {
      return reply.code(403).send({ error: "FORBIDDEN" });
    }
    setPasswordHash(db, await hashPassword(body.next));
    if (isRemote(req)) createSession(db, req, reply);
    return { ok: true };
  });

  // --- profile & demo ---
  server.post("/api/profile", async (req) => {
    const { profile } = z
      .object({ profile: z.enum(["demo", "real"]) })
      .parse(req.body);
    ctx.store.switchTo(profile);
    if (profile === "demo") await ensureDemo(ctx, engine);
    return { profile };
  });

  server.post("/api/demo/reset", async () => {
    ctx.store.reset("demo");
    await ensureDemo(ctx, engine);
    return { ok: true };
  });

  // --- sync ---
  server.post("/api/sync", async (req, reply) => {
    const { force } = z
      .object({ force: z.boolean().optional() })
      .parse(req.body ?? {});
    void engine.syncAll({ force: force ?? true });
    return reply.code(202).send({ started: true });
  });

  server.get("/api/sync/runs", async () => {
    return ctx.store
      .db()
      .select()
      .from(schema.syncRuns)
      .orderBy(desc(schema.syncRuns.startedAt))
      .limit(50)
      .all();
  });

  // --- Plaid credentials (entered once in Settings; env vars win if present) ---
  server.post("/api/settings/plaid", async (req, reply) => {
    if (isRemote(req)) return reply.code(403).send({ error: "LOCAL_ONLY" });
    const body = z
      .object({
        clientId: z.string().min(10),
        secret: z.string().min(10),
        env: z.enum(["sandbox", "production"]),
      })
      .parse(req.body);
    const db = ctx.store.db("real");
    db.insert(schema.settings)
      .values({
        key: "plaid.credentials",
        value: {
          clientId: body.clientId,
          secret: ctx.secrets.encrypt(body.secret),
          env: body.env,
        },
      })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: {
          value: {
            clientId: body.clientId,
            secret: ctx.secrets.encrypt(body.secret),
            env: body.env,
          },
        },
      })
      .run();
    ctx.config.plaid = {
      clientId: body.clientId,
      secret: body.secret,
      env: body.env,
    };
    ctx.plaid = plaidClient(ctx.config);
    return { ok: true };
  });

  server.get("/api/setup", async () => setupView(ctx));

  // --- settings (generic key/value for UI preferences) ---
  server.get("/api/settings/:key", async (req) => {
    const { key } = z
      .object({ key: z.string().regex(/^ui\.[a-z0-9_.-]+$/i) })
      .parse(req.params);
    const row = ctx.store
      .db()
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, key))
      .get();
    return { value: row?.value ?? null };
  });
  server.put("/api/settings/:key", async (req) => {
    const { key } = z
      .object({ key: z.string().regex(/^ui\.[a-z0-9_.-]+$/i) })
      .parse(req.params);
    const { value } = z.object({ value: z.unknown() }).parse(req.body);
    ctx.store
      .db()
      .insert(schema.settings)
      .values({ key, value: value as object })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: value as object },
      })
      .run();
    return { ok: true };
  });
}
