import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context";
import { schema } from "../db";
import { linkTokenRequest, plaidError } from "../providers/plaid";
import type { SyncEngine } from "../sync/engine";

export function registerPlaidRoutes(
  server: FastifyInstance,
  ctx: AppContext,
  engine: SyncEngine,
) {
  const requirePlaid = () => {
    if (!ctx.plaid)
      throw Object.assign(new Error("Plaid is not configured"), {
        statusCode: 409,
      });
    return ctx.plaid;
  };

  /**
   * New link, re-authentication (connectionId), or granting products the
   * connection lacks (connectionId + consent, e.g. ["investments"]).
   */
  server.post("/api/plaid/link-token", async (req) => {
    const plaid = requirePlaid();
    const body = z
      .object({
        connectionId: z.string().optional(),
        consent: z.array(z.string()).optional(),
      })
      .parse(req.body ?? {});
    let accessToken: string | undefined;
    if (body.connectionId) {
      const conn = ctx.store
        .db()
        .select()
        .from(schema.connections)
        .where(eq(schema.connections.id, body.connectionId))
        .get();
      if (!conn?.accessTokenEnc)
        throw Object.assign(new Error("Unknown connection"), {
          statusCode: 404,
        });
      accessToken = ctx.secrets.decrypt(conn.accessTokenEnc);
    }
    try {
      const res = await plaid.linkTokenCreate(
        linkTokenRequest({
          userId: "ikat-household",
          ...(accessToken ? { accessToken } : {}),
          ...(body.consent ? { consentProducts: body.consent } : {}),
        }),
      );
      return { linkToken: res.data.link_token };
    } catch (err) {
      const pe = plaidError(err);
      throw Object.assign(
        new Error(pe ? `${pe.code}: ${pe.message}` : String(err)),
        { statusCode: 502 },
      );
    }
  });

  server.post("/api/plaid/exchange", async (req) => {
    const plaid = requirePlaid();
    const body = z
      .object({
        publicToken: z.string(),
        institution: z
          .object({ id: z.string().nullish(), name: z.string().nullish() })
          .nullish(),
      })
      .parse(req.body);
    const res = await plaid.itemPublicTokenExchange({
      public_token: body.publicToken,
    });
    const db = ctx.store.db("real");
    ctx.store.switchTo("real");
    // Re-linking an institution that is already here updates it in place, so
    // its history and the user's edits carry over.
    const existing = db
      .select()
      .from(schema.connections)
      .where(eq(schema.connections.externalId, res.data.item_id))
      .get();
    const connId = existing?.id ?? crypto.randomUUID();
    if (existing) {
      db.update(schema.connections)
        .set({
          accessTokenEnc: ctx.secrets.encrypt(res.data.access_token),
          status: "ok",
          statusDetail: null,
        })
        .where(eq(schema.connections.id, connId))
        .run();
    } else {
      db.insert(schema.connections)
        .values({
          id: connId,
          provider: "plaid",
          externalId: res.data.item_id,
          institutionId: body.institution?.id ?? null,
          institutionName: body.institution?.name ?? "Bank",
          accessTokenEnc: ctx.secrets.encrypt(res.data.access_token),
          historyDaysRequested: 730,
        })
        .run();
    }
    const conn = db
      .select()
      .from(schema.connections)
      .where(eq(schema.connections.id, connId))
      .get()!;
    const summary = await engine.syncOne(db, conn, ctx.today());
    return { connectionId: connId, sync: summary };
  });

  /** After update mode (re-auth or consent) finishes in the browser. */
  server.post("/api/connections/:id/refresh", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const db = ctx.store.db();
    const conn = db
      .select()
      .from(schema.connections)
      .where(eq(schema.connections.id, id))
      .get();
    if (!conn)
      throw Object.assign(new Error("Unknown connection"), { statusCode: 404 });
    return engine.syncOne(db, conn, ctx.today());
  });

  server.delete("/api/connections/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { revoke } = z
      .object({ revoke: z.coerce.boolean().optional() })
      .parse(req.query);
    const db = ctx.store.db();
    const conn = db
      .select()
      .from(schema.connections)
      .where(eq(schema.connections.id, id))
      .get();
    if (!conn) return { ok: true };
    // Revoking at Plaid is opt-in: the same Item may still be used elsewhere
    if (
      revoke &&
      conn.provider === "plaid" &&
      conn.accessTokenEnc &&
      ctx.plaid
    ) {
      await ctx.plaid
        .itemRemove({ access_token: ctx.secrets.decrypt(conn.accessTokenEnc) })
        .catch(() => {});
    }
    // Accounts, their transactions, snapshots and holdings cascade.
    db.delete(schema.connections).where(eq(schema.connections.id, id)).run();
    return { ok: true };
  });
}
