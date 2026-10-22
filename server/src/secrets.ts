import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Plaid access tokens are bearer credentials for someone's bank data, so they
// are encrypted at rest. The key never sits in the database it protects:
//   1. IKAT_SECRET_KEY env var (Docker, CI)
//   2. macOS Keychain, created on first run
//   3. a 0600 key file in the data dir (other platforms)

const SERVICE = "ikat";
const ACCOUNT = "data-encryption-key";

function fromKeychain(): Buffer | null {
  if (process.platform !== "darwin") return null;
  try {
    const hex = execFileSync(
      "security",
      ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"],
      {
        stdio: ["ignore", "pipe", "ignore"],
      },
    )
      .toString()
      .trim();
    if (/^[0-9a-f]{64}$/.test(hex)) return Buffer.from(hex, "hex");
  } catch {
    /* not found — created below */
  }
  const key = crypto.randomBytes(32);
  try {
    execFileSync(
      "security",
      [
        "add-generic-password",
        "-s",
        SERVICE,
        "-a",
        ACCOUNT,
        "-w",
        key.toString("hex"),
        "-U",
      ],
      {
        stdio: "ignore",
      },
    );
    return key;
  } catch {
    return null;
  }
}

function fromFile(dataDir: string): Buffer {
  const file = path.join(dataDir, ".secret-key");
  if (fs.existsSync(file))
    return Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key.toString("hex"), { mode: 0o600 });
  return key;
}

export class Secrets {
  private key: Buffer;

  constructor(dataDir: string, opts: { useKeychain?: boolean } = {}) {
    const env = process.env.IKAT_SECRET_KEY;
    if (env && /^[0-9a-f]{64}$/i.test(env)) this.key = Buffer.from(env, "hex");
    else
      this.key =
        (opts.useKeychain !== false && fromKeychain()) || fromFile(dataDir);
  }

  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${body.toString("base64")}`;
  }

  decrypt(sealed: string): string {
    const [version, iv, tag, body] = sealed.split(":");
    if (version !== "v1" || !iv || !tag || !body)
      throw new Error("Unrecognised secret format");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }
}
