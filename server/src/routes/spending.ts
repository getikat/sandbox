import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CATEGORY_BY_ID, isBudgetable, monthKey } from "@ikat/core";
import type { AppContext } from "../context";
import { schema } from "../db";
import {
  budgetsView,
  cashflow,
  forecastView,
  recurringView,
  spendingSummary,
} from "../views/spending";

const Month = z.string().regex(/^\d{4}-\d{2}$/);

export function registerSpendingRoutes(
  server: FastifyInstance,
  ctx: AppContext,
) {
  server.get("/api/spending", async (req) => {
    const { month } = z.object({ month: Month.optional() }).parse(req.query);
    return spendingSummary(
      ctx.store.db(),
      ctx.today(),
      month ?? monthKey(ctx.today()),
    );
  });

  server.get("/api/cashflow", async (req) => {
    const { months } = z
      .object({ months: z.coerce.number().int().min(1).max(36).default(12) })
      .parse(req.query);
    return cashflow(ctx.store.db(), ctx.today(), months);
  });

  server.get("/api/recurring", async () =>
    recurringView(ctx.store.db(), ctx.today()),
  );

  server.post("/api/recurring/override", async (req) => {
    const { merchantKey, state } = z
      .object({
        merchantKey: z.string().min(1),
        state: z.enum(["hidden", "pinned"]).nullable(),
      })
      .parse(req.body);
    const db = ctx.store.db();
    if (state === null)
      db.delete(schema.recurringOverrides)
        .where(eq(schema.recurringOverrides.merchantKey, merchantKey))
        .run();
    else
      db.insert(schema.recurringOverrides)
        .values({ merchantKey, state })
        .onConflictDoUpdate({
          target: schema.recurringOverrides.merchantKey,
          set: { state },
        })
        .run();
    return recurringView(db, ctx.today());
  });

  server.get("/api/forecast", async (req) => {
    const { days } = z
      .object({ days: z.coerce.number().int().min(7).max(120).default(45) })
      .parse(req.query);
    return forecastView(ctx.store.db(), ctx.today(), days);
  });

  // --- budgets ---
  server.get("/api/budgets", async (req) => {
    const { month } = z.object({ month: Month.optional() }).parse(req.query);
    return budgetsView(
      ctx.store.db(),
      ctx.today(),
      month ?? monthKey(ctx.today()),
    );
  });

  server.put("/api/budgets/:categoryId", async (req) => {
    const { categoryId } = z
      .object({ categoryId: z.string() })
      .parse(req.params);
    const body = z
      .object({
        amountCents: z.number().int().positive(),
        rollover: z.boolean().optional(),
      })
      .parse(req.body);
    if (!CATEGORY_BY_ID[categoryId] || !isBudgetable(categoryId))
      throw Object.assign(new Error("Not a budgetable category"), {
        statusCode: 400,
      });
    ctx.store
      .db()
      .insert(schema.budgets)
      .values({
        categoryId,
        amountCents: body.amountCents,
        rollover: body.rollover ?? false,
      })
      .onConflictDoUpdate({
        target: schema.budgets.categoryId,
        set: {
          amountCents: body.amountCents,
          ...(body.rollover !== undefined ? { rollover: body.rollover } : {}),
        },
      })
      .run();
    return budgetsView(ctx.store.db(), ctx.today());
  });

  server.delete("/api/budgets/:categoryId", async (req) => {
    const { categoryId } = z
      .object({ categoryId: z.string() })
      .parse(req.params);
    ctx.store
      .db()
      .delete(schema.budgets)
      .where(eq(schema.budgets.categoryId, categoryId))
      .run();
    return budgetsView(ctx.store.db(), ctx.today());
  });

  /** One tap: adopt every suggested budget (or just the ones listed). */
  server.post("/api/budgets/accept", async (req) => {
    const { categoryIds } = z
      .object({ categoryIds: z.array(z.string()).optional() })
      .parse(req.body ?? {});
    const db = ctx.store.db();
    const view = budgetsView(db, ctx.today());
    for (const s of view.suggestions) {
      if (categoryIds && !categoryIds.includes(s.categoryId)) continue;
      db.insert(schema.budgets)
        .values({ categoryId: s.categoryId, amountCents: s.amountCents })
        .onConflictDoNothing()
        .run();
    }
    return budgetsView(db, ctx.today());
  });
}
