import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { backup, backupPath, listBackups } from "../backup";
import type { AppContext } from "../context";
import { EXPORTS } from "../export";
import { commitImport, previewImport } from "../import";

export function registerDataRoutes(server: FastifyInstance, ctx: AppContext) {
  server.get("/api/export/:file", async (req, reply) => {
    const { file } = z
      .object({ file: z.enum(Object.keys(EXPORTS) as [keyof typeof EXPORTS]) })
      .parse(req.params);
    const e = EXPORTS[file];
    const stamp = ctx.today();
    return reply
      .header("content-type", e.type)
      .header(
        "content-disposition",
        `attachment; filename="ikat-${ctx.store.profile === "demo" ? "demo-" : ""}${file.replace(".", `-${stamp}.`)}"`,
      )
      .send(e.build(ctx.store.db()));
  });

  server.get("/api/backups", async () => listBackups(ctx));
  server.post("/api/backups", async () => {
    await backup(ctx, "manual");
    return listBackups(ctx);
  });
  server.get("/api/backups/:name", async (req, reply) => {
    const { name } = z.object({ name: z.string() }).parse(req.params);
    const p = backupPath(ctx, name);
    if (!p)
      return reply
        .code(404)
        .send({ error: "not_found", message: "No such backup" });
    return reply
      .header("content-type", "application/vnd.sqlite3")
      .header("content-disposition", `attachment; filename="${name}"`)
      .send(fs.createReadStream(p));
  });
}

const ImportBody = z.object({
  filename: z.string().max(200),
  content: z.string().max(20_000_000),
  flipSign: z.boolean().optional(),
  accountId: z.string().optional(),
  newAccount: z
    .object({
      name: z.string().trim().min(1).max(80),
      type: z.enum(["checking", "savings", "credit"]),
    })
    .optional(),
  balanceCents: z.number().int().nullable().optional(),
});

export function registerImportRoutes(server: FastifyInstance, ctx: AppContext) {
  server.post(
    "/api/import/statement/preview",
    { bodyLimit: 25_000_000 },
    async (req, reply) => {
      const p = previewImport(ctx, ImportBody.parse(req.body));
      return (
        p ??
        reply.code(400).send({
          error: "unreadable",
          message:
            "Ikat couldn't find transactions in this file. CSV needs date, description and amount columns; OFX and QFX files work as exported.",
        })
      );
    },
  );
  server.post(
    "/api/import/statement",
    { bodyLimit: 25_000_000 },
    async (req, reply) => {
      try {
        const r = commitImport(ctx, ImportBody.parse(req.body));
        return (
          r ??
          reply.code(400).send({
            error: "unreadable",
            message: "No transactions found in this file.",
          })
        );
      } catch (err) {
        return reply
          .code(400)
          .send({ error: "import_failed", message: (err as Error).message });
      }
    },
  );
}
