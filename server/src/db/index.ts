import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Profile } from "@ikat/core";
import { ROOT } from "../config";
import { runFixups } from "./fixups";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

const MIGRATIONS = path.join(ROOT, "server", "drizzle");

export function openDb(file: string): DB {
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema }) as DB;
  migrate(db, { migrationsFolder: MIGRATIONS });
  runFixups(db);
  return db;
}

/**
 * Demo and real data live in separate files, so trying the demo can never mix
 * fake rows into real history (and wiping the demo can't touch real data).
 */
export class Store {
  private handles = new Map<Profile, DB>();
  private _profile: Profile;

  constructor(
    private dataDir: string,
    initial?: Profile,
  ) {
    this._profile = initial ?? this.readProfile() ?? "demo";
  }

  get profile(): Profile {
    return this._profile;
  }

  fileFor(profile: Profile): string {
    return path.join(this.dataDir, profile === "real" ? "ikat.db" : "demo.db");
  }

  db(profile: Profile = this._profile): DB {
    let handle = this.handles.get(profile);
    if (!handle) {
      handle = openDb(this.fileFor(profile));
      this.handles.set(profile, handle);
    }
    return handle;
  }

  switchTo(profile: Profile) {
    this._profile = profile;
    fs.writeFileSync(
      path.join(this.dataDir, "profile.json"),
      JSON.stringify({ profile }),
    );
  }

  /** Close and delete a profile's database (used to reset the demo). */
  reset(profile: Profile) {
    this.handles.get(profile)?.$client.close();
    this.handles.delete(profile);
    for (const suffix of ["", "-wal", "-shm"])
      fs.rmSync(this.fileFor(profile) + suffix, { force: true });
  }

  close() {
    for (const h of this.handles.values()) h.$client.close();
    this.handles.clear();
  }

  private readProfile(): Profile | null {
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(this.dataDir, "profile.json"), "utf8"),
      );
      return raw.profile === "real"
        ? "real"
        : raw.profile === "demo"
          ? "demo"
          : null;
    } catch {
      return null;
    }
  }
}

export { schema };
