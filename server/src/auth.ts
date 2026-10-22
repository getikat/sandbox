import crypto from "node:crypto";
import { promisify } from "node:util";
import { eq, lt } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { schema, type DB } from "./db";

const scrypt = promisify(crypto.scrypt) as (
  pw: string,
  salt: Buffer,
  len: number,
) => Promise<Buffer>;

export const SESSION_COOKIE = "ikat_session";
const SESSION_DAYS = 30;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Ikat listens on loopback only; the way in from elsewhere is `tailscale
 * serve`, which proxies to localhost and adds forwarding headers. So "remote"
 * means: the socket isn't loopback, OR Tailscale identified a tailnet user, OR
 * the nearest proxy (the LAST X-Forwarded-For entry — earlier entries are
 * client-supplied and spoofable) saw a non-loopback client.
 */
export function isRemote(req: FastifyRequest): boolean {
  const socketIp = req.socket.remoteAddress ?? "";
  if (!LOOPBACK.has(socketIp)) return true;
  if (req.headers["tailscale-user-login"]) return true;
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    const last = String(Array.isArray(xff) ? xff.at(-1) : xff)
      .split(",")
      .map((s) => s.trim())
      .at(-1);
    if (last && !LOOPBACK.has(last)) return true;
  }
  return false;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString("base64")}:${key.toString("base64")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, salt, key] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await scrypt(
    password,
    Buffer.from(salt, "base64"),
    expected.length,
  );
  return crypto.timingSafeEqual(expected, actual);
}

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function getPasswordHash(db: DB): string | null {
  const row = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "auth.passwordHash"))
    .get();
  return (row?.value as string) ?? null;
}

export function setPasswordHash(db: DB, hash: string) {
  db.insert(schema.settings)
    .values({ key: "auth.passwordHash", value: hash })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: hash } })
    .run();
  // Changing the password signs out every other session.
  db.delete(schema.sessions).run();
}

export function createSession(
  db: DB,
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  db.delete(schema.sessions)
    .where(lt(schema.sessions.expiresAt, new Date().toISOString()))
    .run();
  db.insert(schema.sessions)
    .values({
      id: sha(token),
      expiresAt: expires.toISOString(),
      userAgent: req.headers["user-agent"] ?? null,
    })
    .run();
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: req.headers["x-forwarded-proto"] === "https",
    expires,
  });
}

export function validSession(db: DB, req: FastifyRequest): boolean {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return false;
  const row = db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sha(token)))
    .get();
  return !!row && row.expiresAt > new Date().toISOString();
}

export function endSession(db: DB, req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (token)
    db.delete(schema.sessions)
      .where(eq(schema.sessions.id, sha(token)))
      .run();
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}
