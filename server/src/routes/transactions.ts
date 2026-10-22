import crypto from "node:crypto";
import { and, desc, eq, gte, like, lte, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CATEGORY_BY_ID,
  type Page,
  type RuleDTO,
  type TransactionDTO,
} from "@ikat/core";
import type { AppContext } from "../context";
import { schema } from "../db";
import { recategorize } from "../recategorize";
import { displayNames, loadAccountRows } from "../views/accounts";

const Query = z.object({
  q: z.string().optional(),
  account: z.string().optional(),
  category: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function registerTransactionRoutes(
  server: FastifyInstance,
  ctx: AppContext,
) {
  server.get(
    "/api/transactions",
    async (req): Promise<Page<TransactionDTO>> => {
      const q = Query.parse(req.query);
      const db = ctx.store.db();
      const t = schema.transactions;
      // Rows from duplicate accounts are the same money seen twice.
      const where: SQL[] = [
        sql`${t.accountId} not in (select id from accounts where duplicate_of is not null)`,
      ];
      if (q.account) where.push(eq(t.accountId, q.account));
      if (q.category) where.push(eq(t.categoryId, q.category));
      if (q.start) where.push(gte(t.date, q.start));
      if (q.end) where.push(lte(t.date, q.end));
      if (q.q) {
        // "42.50", "$42" or ">100": search by amount; anything else by text.
        const amount = q.q.trim().match(/^([<>]=?)?\s*\$?(\d+(?:\.\d{1,2})?)$/);
        if (amount) {
          const cents = Math.round(Number(amount[2]) * 100);
          const op = amount[1];
          const abs = sql`abs(${t.amountCents})`;
          where.push(
            op === ">"
              ? sql`${abs} > ${cents}`
              : op === ">="
                ? sql`${abs} >= ${cents}`
                : op === "<"
                  ? sql`${abs} < ${cents}`
                  : op === "<="
                    ? sql`${abs} <= ${cents}`
                    : sql`${abs} = ${cents}`,
          );
        } else {
          const needle = `%${q.q.toLowerCase()}%`;
          where.push(
            or(
              like(sql`lower(${t.merchantName})`, needle),
              like(sql`lower(${t.description})`, needle),
              like(sql`lower(coalesce(${t.notes}, ''))`, needle),
            )!,
          );
        }
      }
      const cond = where.length ? and(...where) : undefined;
      const totals = db
        .select({
          n: sql<number>`count(*)`,
          sum: sql<number>`coalesce(sum(${t.amountCents}),0)`,
        })
        .from(t)
        .where(cond)
        .get()!;
      const rows = db
        .select()
        .from(t)
        .where(cond)
        .orderBy(desc(t.date), desc(t.id))
        .limit(q.limit)
        .offset(q.offset)
        .all();
      const names = displayNames(loadAccountRows(db));
      return {
        items: rows.map((r) => ({
          id: r.id,
          accountId: r.accountId,
          accountName: names.get(r.accountId) ?? "",
          date: r.date,
          amountCents: r.amountCents,
          merchant: r.merchantName ?? r.description,
          description: r.description,
          logoUrl: r.logoUrl,
          categoryId: r.categoryId,
          categorySource: r.categorySource,
          pending: r.pending,
          notes: r.notes,
          transferPairId: r.transferPairId,
          excluded: r.excluded,
        })),
        total: totals.n,
        totalAmountCents: totals.sum,
        nextCursor:
          q.offset + rows.length < totals.n
            ? String(q.offset + rows.length)
            : null,
      };
    },
  );

  /**
   * Edit a transaction. A category change is the user's and survives every
   * sync; with `applyToMerchant` it also becomes a rule — applied now to that
   * merchant's other transactions and to every future one.
   */
  server.patch("/api/transactions/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({
        categoryId: z.string().optional(),
        applyToMerchant: z.boolean().optional(),
        notes: z.string().max(2000).nullable().optional(),
        excluded: z.boolean().optional(),
      })
      .parse(req.body);
    const db = ctx.store.db();
    const t = schema.transactions;
    const row = db.select().from(t).where(eq(t.id, id)).get();
    if (!row)
      throw Object.assign(new Error("Unknown transaction"), {
        statusCode: 404,
      });
    if (body.categoryId && !CATEGORY_BY_ID[body.categoryId])
      throw Object.assign(new Error("Unknown category"), { statusCode: 400 });
    let applied = 0;
    db.transaction((tx) => {
      tx.update(t)
        .set({
          ...(body.categoryId
            ? { categoryId: body.categoryId, categorySource: "user" as const }
            : {}),
          ...(body.notes !== undefined
            ? { notes: body.notes?.trim() || null }
            : {}),
          ...(body.excluded !== undefined ? { excluded: body.excluded } : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(t.id, id))
        .run();
      if (body.categoryId && body.applyToMerchant) {
        tx.delete(schema.categoryRules)
          .where(eq(schema.categoryRules.merchantKey, row.merchantKey))
          .run();
        tx.insert(schema.categoryRules)
          .values({
            id: crypto.randomUUID(),
            merchantKey: row.merchantKey,
            categoryId: body.categoryId,
          })
          .run();
      }
    });
    if (body.categoryId && body.applyToMerchant)
      applied = recategorize(db, eq(t.merchantKey, row.merchantKey));
    return { ok: true, applied };
  });

  server.get("/api/rules", async (): Promise<RuleDTO[]> => {
    const db = ctx.store.db();
    const rules = db
      .select()
      .from(schema.categoryRules)
      .orderBy(desc(schema.categoryRules.createdAt))
      .all();
    return rules.map((r) => {
      const sample = r.merchantKey
        ? db
            .select({
              name: schema.transactions.merchantName,
              n: sql<number>`count(*)`,
            })
            .from(schema.transactions)
            .where(eq(schema.transactions.merchantKey, r.merchantKey))
            .get()
        : null;
      return {
        id: r.id,
        merchantKey: r.merchantKey,
        merchant: sample?.name ?? r.merchantKey,
        categoryId: r.categoryId,
        matches: sample?.n ?? 0,
        createdAt: r.createdAt,
      };
    });
  });

  server.delete("/api/rules/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const db = ctx.store.db();
    const rule = db
      .select()
      .from(schema.categoryRules)
      .where(eq(schema.categoryRules.id, id))
      .get();
    if (!rule) return { ok: true, changed: 0 };
    db.delete(schema.categoryRules)
      .where(eq(schema.categoryRules.id, id))
      .run();
    const changed = rule.merchantKey
      ? recategorize(db, eq(schema.transactions.merchantKey, rule.merchantKey))
      : recategorize(db);
    return { ok: true, changed };
  });
}
