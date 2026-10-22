import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { ROOT } from "./config";
import type { AppContext } from "./context";
import { getPasswordHash, isRemote, validSession } from "./auth";
import { SyncEngine } from "./sync/engine";
import { registerSystemRoutes } from "./routes/system";
import { registerPlaidRoutes } from "./routes/plaid";
import { registerAccountRoutes } from "./routes/accounts";
import { registerDataRoutes, registerImportRoutes } from "./routes/data";
import { registerSpendingRoutes } from "./routes/spending";
import { registerTransactionRoutes } from "./routes/transactions";

export interface App {
  server: FastifyInstance;
  engine: SyncEngine;
}

// Routes reachable without a session even from a remote client.
const PUBLIC = new Set(["/api/health", "/api/auth/login", "/api/auth/state"]);

export async function buildApp(ctx: AppContext): Promise<App> {
  const server = Fastify({
    logger: false,
    trustProxy: false,
    bodyLimit: 5 * 1024 * 1024,
  });
  const engine = new SyncEngine(ctx);
  await server.register(cookie);

  server.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/") || PUBLIC.has(req.url.split("?")[0]!))
      return;
    if (!isRemote(req)) return;
    const auth = ctx.store.db("real");
    if (!getPasswordHash(auth)) {
      return reply.code(403).send({
        error: "REMOTE_DISABLED",
        message: "Set a password in Settings to use Ikat from other devices.",
      });
    }
    if (!validSession(auth, req))
      return reply.code(401).send({ error: "UNAUTHENTICATED" });
  });

  server.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError)
      return reply.code(400).send({ error: "BAD_REQUEST", issues: err.issues });
    const e = err instanceof Error ? err : new Error(String(err));
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500 && !ctx.config.isTest) console.error(err);
    return reply.code(status).send({ error: e.name, message: e.message });
  });

  registerSystemRoutes(server, ctx, engine);
  registerPlaidRoutes(server, ctx, engine);
  registerAccountRoutes(server, ctx);
  registerTransactionRoutes(server, ctx);
  registerSpendingRoutes(server, ctx);
  registerDataRoutes(server, ctx);
  registerImportRoutes(server, ctx);

  // The built web app, with SPA fallback for client-side routes.
  const webDist = path.join(ROOT, "web", "dist");
  if (fs.existsSync(webDist)) {
    await server.register(fastifyStatic, { root: webDist, wildcard: false });
    server.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/"))
        return reply.code(404).send({ error: "NOT_FOUND" });
      return reply.sendFile("index.html");
    });
  }

  return { server, engine };
}
