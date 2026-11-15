import { safeStorage } from "electron";
import log from "electron-log";
import { decryptSafeStorageBuffer } from "@/main/safe_storage";

const logger = log.scope("secret_storage");

// Tags plaintext-fallback blobs so they stay readable if the OS
// keyring becomes available later.
export const PLAINTEXT_PREFIX = "plain:";

export function isSecretEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function encryptToString(plaintext: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    // No keyring (e.g. Linux without libsecret): store plaintext
    // rather than blocking the caller on those hosts.
    logger.warn(
      "safeStorage encryption unavailable; secret written as plaintext",
    );
    return PLAINTEXT_PREFIX + Buffer.from(plaintext, "utf8").toString("base64");
  }
  return safeStorage.encryptString(plaintext).toString("base64");
}

export function decryptFromString(stored: string): string {
  if (stored.startsWith(PLAINTEXT_PREFIX)) {
    return Buffer.from(
      stored.slice(PLAINTEXT_PREFIX.length),
      "base64",
    ).toString("utf8");
  }
  const buf = Buffer.from(stored, "base64");
  try {
    return decryptSafeStorageBuffer(buf);
  } catch (error) {
    // Retain the old reader's compatibility for untagged base64 JSON only.
    // Actual no-keyring writers use plain:, including OAuth client secrets.
    // Known encrypted envelopes must NEVER take this compatibility path.
    if (!/^v\d\d$/.test(buf.subarray(0, 3).toString("ascii"))) {
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
        const parsed: unknown = JSON.parse(text);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          !Array.isArray(parsed)
        )
          return text;
      } catch {
        // Neither supported ciphertext nor a historical plaintext object.
      }
    }
    throw error;
  }
}

/**
 * Encrypts a string map (MCP headers or env vars) for storage. Empty
 * and null maps store as NULL so the column clearly means "nothing
 * set" rather than holding an encrypted empty object.
 */
export function encryptSecretMap(
  value: Record<string, string> | null | undefined,
): string | null {
  if (!value || Object.keys(value).length === 0) {
    return null;
  }
  return encryptToString(JSON.stringify(value));
}

/**
 * Reads a map written by `encryptSecretMap`. Returns null when the
 * blob is absent or does not decrypt to a JSON object of strings, so
 * an unreadable secret never surfaces as an empty-but-valid map.
 */
export function decryptSecretMap(
  stored: string | null | undefined,
): Record<string, string> | null {
  if (!stored) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decryptFromString(stored));
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every((v) => typeof v === "string")
  ) {
    return null;
  }
  return parsed as Record<string, string>;
}

/**
 * Outcome of reading a stored secret. `unreadable` means the server
 * has a secret we could not decrypt, which is different from having
 * none: callers must not treat it as an empty map, or a server would
 * silently connect without its credentials and the UI would offer an
 * empty editor whose next save wipes the real values.
 */
export type ServerSecretRead =
  | { status: "ok"; value: Record<string, string> | null }
  | { status: "unreadable" };

/**
 * Reads an MCP server's env vars or headers, preferring the encrypted
 * column and falling back to the plaintext one when it can't be read.
 *
 * The fallback keeps servers working on hosts where `safeStorage`
 * turns out to be unreliable. Each fallback is logged so those hosts
 * are identifiable before the plaintext column goes away.
 */
export function readServerSecretMap(
  encrypted: string | null | undefined,
  plaintext: Record<string, string> | null | undefined,
): ServerSecretRead {
  if (!encrypted) {
    return { status: "ok", value: plaintext ?? null };
  }
  const decrypted = decryptSecretMap(encrypted);
  if (decrypted) {
    return { status: "ok", value: decrypted };
  }
  if (plaintext) {
    logger.warn(
      "Could not read an encrypted MCP secret; falling back to the plaintext column",
    );
    return { status: "ok", value: plaintext };
  }
  logger.error(
    "Could not read an encrypted MCP secret and no plaintext fallback exists",
  );
  return { status: "unreadable" };
}
