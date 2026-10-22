import type { Profile } from "@ikat/core";
import type { AppContext } from "./context";
import { backup } from "./backup";
import { refreshPrices } from "./prices";
import type { SyncEngine } from "./sync/engine";

const TICK_MS = 15 * 60_000;

/**
 * Ikat runs as an always-on local service, so its own clock drives the daily
 * work. A Mac that sleeps simply resumes the ticker on wake and catches up —
 * the sync is throttled per connection per day, so ticking often is free.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private lastBackupDay: string | null = null;
  private lastPriceDay: string | null = null;

  constructor(
    private ctx: AppContext,
    private engine: SyncEngine,
  ) {}

  start() {
    // Let the server finish booting before the first network-bound pass.
    setTimeout(() => void this.tick(), 3_000);
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    // Real accounts sync every day whatever is on screen: a skipped day is a
    // permanent gap in balance history. The demo only needs to keep up when
    // someone is looking at it.
    const profiles: Profile[] =
      this.ctx.store.profile === "demo" ? ["real", "demo"] : ["real"];
    for (const profile of profiles) {
      try {
        await this.engine.syncAll({ profile });
      } catch (err) {
        console.error(`[scheduler] ${profile} sync failed`, err);
      }
    }
    await this.prices();
    this.backup();
  }

  /** Once a day, fetch closing prices for the real portfolio (tickers only leave the machine). */
  private async prices() {
    const today = this.ctx.today();
    if (this.lastPriceDay === today || this.ctx.config.isTest) return;
    try {
      const { updated, failed } = await refreshPrices(
        this.ctx.store.db("real"),
        today,
      );
      this.lastPriceDay = today;
      if (updated || failed.length)
        console.log(
          `[prices] ${updated} closes stored${failed.length ? `; failed: ${failed.join(", ")}` : ""}`,
        );
    } catch (err) {
      console.error("[prices] refresh failed", err);
    }
  }

  /** Daily rotating backup of the real database, via SQLite's online backup. */
  private backup() {
    const today = this.ctx.today();
    if (this.lastBackupDay === today) return;
    backup(this.ctx, "daily")
      .then(() => {
        this.lastBackupDay = today;
      })
      .catch((err) => console.error("[scheduler] backup failed", err));
  }
}
