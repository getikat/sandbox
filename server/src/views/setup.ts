import { eq } from "drizzle-orm";
import type { SetupDTO } from "@ikat/core";
import type { AppContext } from "../context";
import { schema } from "../db";

export const SETUP_DISMISSED = "ui.setup.dismissed";

/** First run, as a checklist that ticks itself off from the data rather than asking. */
export function setupView(ctx: AppContext): SetupDTO {
  const db = ctx.store.db();
  const connections = db
    .select()
    .from(schema.connections)
    .all()
    .filter((c) => c.provider !== "manual" && c.provider !== "file");
  const dismissed =
    db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, SETUP_DISMISSED))
      .get()?.value === true;

  return {
    dismissed,
    items: [
      {
        id: "link",
        label: "Link your accounts",
        detail: connections.length
          ? `${connections.length} institution${connections.length === 1 ? "" : "s"} syncing daily`
          : "Banks, cards, brokerages and loans, through your own Plaid account",
        done: connections.length > 0,
        optional: false,
        link: "/settings",
      },
    ],
  };
}
