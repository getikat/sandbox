import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { buildApp } from "./app";
import { getPasswordHash, hashPassword, setPasswordHash } from "./auth";
import { ROOT, loadConfig } from "./config";
import { systemClock, type AppContext } from "./context";
import { Store, schema } from "./db";
import { ensureDemo } from "./demo";
import { plaidClient } from "./providers/plaid";
import { Scheduler } from "./scheduler";
import { Secrets } from "./secrets";

const version = JSON.parse(
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
).version as string;

async function main() {
  const config = loadConfig();
  const secrets = new Secrets(config.dataDir);
  const store = new Store(config.dataDir);

  // Plaid credentials: env vars win; otherwise those saved in Settings.
  if (!config.plaid.clientId) {
    const row = store
      .db("real")
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, "plaid.credentials"))
      .get();
    const saved = row?.value as
      | { clientId: string; secret: string; env: "sandbox" | "production" }
      | undefined;
    if (saved)
      config.plaid = {
        clientId: saved.clientId,
        secret: secrets.decrypt(saved.secret),
        env: saved.env,
      };
  }

  // Headless installs (Docker) can't set the first password from the machine
  // itself, so IKAT_PASSWORD sets it once at startup.
  if (process.env.IKAT_PASSWORD && !getPasswordHash(store.db("real"))) {
    setPasswordHash(
      store.db("real"),
      await hashPassword(process.env.IKAT_PASSWORD),
    );
    console.log("Password set from IKAT_PASSWORD");
  }

  const ctx: AppContext = {
    config,
    store,
    secrets,
    plaid: plaidClient(config),
    today: systemClock,
    version,
  };
  const { server, engine } = await buildApp(ctx);
  if (store.profile === "demo") await ensureDemo(ctx, engine);

  const scheduler = new Scheduler(ctx, engine);
  await server.listen({ port: config.port, host: config.host });
  console.log(
    `Ikat ${version} → http://localhost:${config.port}  (profile: ${store.profile})`,
  );
  scheduler.start();

  const shutdown = async () => {
    scheduler.stop();
    await server.close();
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
