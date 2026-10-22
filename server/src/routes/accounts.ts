import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CATEGORIES, type CategoryDTO } from "@ikat/core";
import type { AppContext } from "../context";
import { schema } from "../db";
import { accountsView } from "../views/accounts";
import {
  accountSeries,
  netWorthChange,
  netWorthSeries,
} from "../views/networth";
import { addDays, eachDay } from "@ikat/core";

export function registerAccountRoutes(
  server: FastifyInstance,
  ctx: AppContext,
) {
  server.get("/api/accounts", async () => accountsView(ctx.store.db()));

  server.patch("/api/accounts/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        nickname: z.string().max(80).nullable().optional(),
        includeInNetWorth: z.boolean().optional(),
        hidden: z.boolean().optional(),
        owner: z.enum(["me", "partner", "joint"]).optional(),
        groupOverride: z
          .enum(["cash", "cards", "investments", "loans", "property", "other"])
          .nullable()
          .optional(),
      })
      .parse(req.body);
    const patch = {
      ...body,
      ...(body.nickname !== undefined
        ? { nickname: body.nickname?.trim() || null }
        : {}),
    };
    ctx.store
      .db()
      .update(schema.accounts)
      .set(patch)
      .where(eq(schema.accounts.id, id))
      .run();
    return (
      accountsView(ctx.store.db()).accounts.find((a) => a.id === id) ?? null
    );
  });

  // --- Accounts added by hand: things no bank can report, like a home or a car ---
  const MANUAL_KINDS = {
    home: { type: "property", subtype: "real estate" },
    vehicle: { type: "property", subtype: "vehicle" },
    cash: { type: "depository", subtype: "cash" },
    asset: { type: "other", subtype: "other asset" },
    debt: { type: "loan", subtype: "money owed" },
  } as const;

  server.post("/api/accounts/manual", async (req) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        kind: z.enum(["home", "vehicle", "cash", "asset", "debt"]),
        valueCents: z.number().int().min(0).max(1e13),
      })
      .parse(req.body);
    const db = ctx.store.db();
    let conn = db
      .select()
      .from(schema.connections)
      .where(eq(schema.connections.provider, "manual"))
      .get();
    if (!conn) {
      db.insert(schema.connections)
        .values({
          id: randomUUID(),
          provider: "manual",
          institutionName: "Added by you",
          institutionColor: "#6c717b",
        })
        .run();
      conn = db
        .select()
        .from(schema.connections)
        .where(eq(schema.connections.provider, "manual"))
        .get()!;
    }
    const id = randomUUID();
    const today = ctx.today();
    db.insert(schema.accounts)
      .values({
        id,
        connectionId: conn.id,
        externalId: id,
        name: body.name,
        ...MANUAL_KINDS[body.kind],
        currency: "USD",
        currentCents: body.valueCents,
        balanceAsOf: new Date().toISOString(),
      })
      .run();
    db.insert(schema.balanceSnapshots)
      .values({ accountId: id, date: today, currentCents: body.valueCents })
      .onConflictDoNothing()
      .run();
    return accountsView(db).accounts.find((a) => a.id === id);
  });

  const manualAccount = (id: string) => {
    const a = ctx.store
      .db()
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.id, id))
      .get();
    const c =
      a &&
      ctx.store
        .db()
        .select()
        .from(schema.connections)
        .where(eq(schema.connections.id, a.connectionId))
        .get();
    return c?.provider === "manual" ? a : null;
  };

  server.put("/api/accounts/:id/value", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { valueCents } = z
      .object({ valueCents: z.number().int().min(0).max(1e13) })
      .parse(req.body);
    if (!manualAccount(id))
      return reply.code(400).send({
        error: "not_manual",
        message: "Only accounts you added can be valued by hand.",
      });
    const db = ctx.store.db();
    db.update(schema.accounts)
      .set({ currentCents: valueCents, balanceAsOf: new Date().toISOString() })
      .where(eq(schema.accounts.id, id))
      .run();
    db.insert(schema.balanceSnapshots)
      .values({ accountId: id, date: ctx.today(), currentCents: valueCents })
      .onConflictDoUpdate({
        target: [
          schema.balanceSnapshots.accountId,
          schema.balanceSnapshots.date,
        ],
        set: { currentCents: valueCents },
      })
      .run();
    return accountsView(db).accounts.find((a) => a.id === id);
  });

  server.delete("/api/accounts/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    if (!manualAccount(id))
      return reply.code(400).send({
        error: "not_manual",
        message: "Linked accounts are removed with their connection.",
      });
    ctx.store
      .db()
      .delete(schema.accounts)
      .where(eq(schema.accounts.id, id))
      .run();
    return { ok: true };
  });

  server.get("/api/net-worth", async () =>
    netWorthSeries(ctx.store.db(), ctx.today()),
  );

  server.get("/api/net-worth/change", async (req) => {
    const { start, end } = z
      .object({ start: z.string(), end: z.string().optional() })
      .parse(req.query);
    return netWorthChange(
      ctx.store.db(),
      ctx.today(),
      start,
      end ?? ctx.today(),
    );
  });

  /** Compact recent trend per account, for list sparklines (every 3rd day, 90 days). */
  server.get("/api/accounts/sparklines", async () => {
    const today = ctx.today();
    const days = eachDay(addDays(today, -90), today).filter(
      (_, i, all) => (all.length - 1 - i) % 3 === 0,
    );
    const out: Record<string, number[]> = {};
    for (const s of accountSeries(ctx.store.db(), today, {
      includeExcluded: true,
    })) {
      const vals = days
        .map((d) => s.values.get(d))
        .filter((v): v is number => v != null);
      out[s.id] = vals.map((v) => Math.abs(v));
    }
    return out;
  });

  server.get("/api/accounts/:id/history", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const s = accountSeries(ctx.store.db(), ctx.today(), {
      includeExcluded: true,
    }).find((x) => x.id === id);
    if (!s) return { points: [], observedFrom: null, estimated: false };
    const points = [...s.values.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, v]) => ({
        date,
        cents: Math.abs(v),
        observed: !!s.observedFrom && date >= s.observedFrom,
      }));
    return { points, observedFrom: s.observedFrom, estimated: s.estimated };
  });

  server.get("/api/categories", async (): Promise<CategoryDTO[]> =>
    CATEGORIES.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      icon: c.icon,
      essential: !!c.essential,
      custom: false,
    })),
  );
}
