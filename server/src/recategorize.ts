import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  type SQL,
} from "drizzle-orm";
import { categorize, merchantCategories, type Rule } from "./categorize";
import { schema, type DB } from "./db";

/** Every merchant's agreed code category, from what's stored. */
export function loadMerchantCategories(
  db: Pick<DB, "select">,
): Map<string, string> {
  return merchantCategories(
    db
      .select({
        merchantKey: schema.transactions.merchantKey,
        mcc: schema.transactions.mcc,
      })
      .from(schema.transactions)
      .where(isNotNull(schema.transactions.mcc))
      .all(),
  );
}

/** Uncoded rows of merchants whose coded rows agree: recategorised after each sync. */
export function followMerchantCodes(db: DB): number {
  const keys = [...loadMerchantCategories(db).keys()];
  if (!keys.length) return 0;
  return recategorize(
    db,
    and(
      isNull(schema.transactions.mcc),
      inArray(schema.transactions.merchantKey, keys),
    ),
  );
}

/**
 * Re-run automatic categorisation over matching rows — after a rule is added
 * or removed. Rows a user categorised by hand, and paired transfers, keep
 * their category.
 */
export function recategorize(db: DB, where?: SQL): number {
  const rules = db
    .select()
    .from(schema.categoryRules)
    .orderBy(desc(schema.categoryRules.createdAt))
    .all() as Rule[];
  const byMerchant = loadMerchantCategories(db);
  const rows = db
    .select({ tx: schema.transactions, accountType: schema.accounts.type })
    .from(schema.transactions)
    .innerJoin(
      schema.accounts,
      eq(schema.accounts.id, schema.transactions.accountId),
    )
    .where(
      and(
        ne(schema.transactions.categorySource, "user"),
        isNull(schema.transactions.transferPairId),
        where,
      ),
    )
    .all();
  let changed = 0;
  db.transaction((tx) => {
    for (const { tx: t, accountType } of rows) {
      const c = categorize(
        {
          description: t.description,
          merchantKey: t.merchantKey,
          amountCents: t.amountCents,
          accountId: t.accountId,
          accountType,
          mcc: t.mcc,
          providerCategory: t.providerCategory,
          providerCategoryDetailed: t.providerCategoryDetailed,
          paymentChannel: t.paymentChannel,
          merchantCategory: t.mcc ? null : byMerchant.get(t.merchantKey),
        },
        rules,
      );
      if (c.categoryId === t.categoryId && c.source === t.categorySource)
        continue;
      tx.update(schema.transactions)
        .set({ categoryId: c.categoryId, categorySource: c.source })
        .where(eq(schema.transactions.id, t.id))
        .run();
      changed++;
    }
  });
  return changed;
}
