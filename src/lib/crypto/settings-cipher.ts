import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { hostname, userInfo } from "node:os";
import path from "node:path";

/**
 * AES-256-GCM encryption at rest for the `settings` table.
 *
 * The key is derived from a stable machine identity (hostname + OS username)
 * plus an app-scoped salt, so secrets are bound to this machine and can't be
 * lifted from the SQLite file alone. This is intentionally NOT a security
 * boundary against a local attacker with full disk access (they could derive
 * the same key); it prevents casual exposure of API keys in a copied DB file
 * and keeps plaintext out of logs/dumps. Matches the plan's "machine-derived
 * key via os.hostname + username" decision.
 */

const APP_SALT = "shorts-studio::settings::v1";
const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM recommended nonce length
const TAG_LEN = 16;

function deriveKey(): Buffer {
  // PROJECT_ROOT is set by our config; fall back to cwd for dev parity.
  // Including the project root in the salt means a second app on the same
  // machine gets a different key.
  const projectRoot = process.env.PROJECT_ROOT ?? process.cwd();
  const material = [
    hostname() ?? "unknown-host",
    userInfo().username ?? "unknown-user",
    path.basename(projectRoot) || "shorts-app",
  ].join("|");
  return scryptSync(material, APP_SALT, KEY_LEN);
}

/** Encrypt a UTF-8 string. Returns hex-encoded (iv|tag|ciphertext). */
export function encryptString(plaintext: string): {
  valueEnc: string;
  iv: string;
  tag: string;
} {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: TAG_LEN,
  });
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    valueEnc: ciphertext.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
  };
}

/** Decrypt hex-encoded (ciphertext) with its iv + tag. Returns UTF-8 string. */
export function decryptString(
  valueEnc: string,
  iv: string,
  tag: string,
): string {
  const key = deriveKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "hex"),
    { authTagLength: TAG_LEN },
  );
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(valueEnc, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

/** Mask an API key for display: show only the last 4 chars, e.g. "••••Wxyz". */
export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 4) return "••••";
  return `••••${key.slice(-4)}`;
}
