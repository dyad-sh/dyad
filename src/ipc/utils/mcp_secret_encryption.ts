import log from "electron-log";
import { and, eq, isNotNull, isNull, like, or, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { db } from "@/db";
import { mcpServers } from "@/db/schema";
import {
  decryptSecretMap,
  encryptSecretMap,
  isSecretEncryptionAvailable,
  PLAINTEXT_PREFIX,
} from "./secret_storage";

const logger = log.scope("mcp_secret_encryption");

const PLAINTEXT_BLOB_PATTERN = `${PLAINTEXT_PREFIX}%`;

function sameMap(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key, i) => bKeys[i] === key && a[key] === b[key])
  );
}

// What the plaintext column says. `empty` is distinct from `absent`:
// only a build predating the encrypted columns writes here, so an
// empty map is that build deleting the last entry, while absent means
// it never touched the row.
type PlaintextState = "absent" | "empty" | "values";

// What the encrypted column holds. `plainTagged` is a base64 blob
// written when no keyring was available, so it is readable but not
// actually encrypted.
type EncryptedState = "absent" | "plainTagged" | "readable" | "unreadable";

function plaintextStateOf(
  plaintext: Record<string, string> | null,
): PlaintextState {
  if (!plaintext) return "absent";
  return Object.keys(plaintext).length === 0 ? "empty" : "values";
}

function encryptedStateOf(encrypted: string | null): EncryptedState {
  if (!encrypted) return "absent";
  if (encrypted.startsWith(PLAINTEXT_PREFIX)) return "plainTagged";
  return decryptSecretMap(encrypted) ? "readable" : "unreadable";
}

/**
 * Works out what a secret's encrypted column should hold, or undefined
 * when it's already correct and should be left alone. Every
 * combination of the two column states is handled explicitly.
 *
 * Plaintext wins whenever the two disagree. This build clears the
 * plaintext column every time it writes a secret, so any value there
 * was written afterwards by a build that predates the encrypted
 * columns.
 */
function nextEncryptedValue(
  plaintext: Record<string, string> | null,
  encrypted: string | null,
): string | null | undefined {
  const from = plaintextStateOf(plaintext);
  const to = encryptedStateOf(encrypted);

  switch (from) {
    case "values":
      switch (to) {
        // Already encrypted from this same value, unless it is only
        // base64, which a keyring can now upgrade.
        case "readable":
          return sameMap(decryptSecretMap(encrypted!)!, plaintext!)
            ? undefined
            : encryptSecretMap(plaintext!);
        // Rewrite for either reason: a keyring can now encrypt it, or
        // the value itself has changed. Without a keyring the rewrite
        // is another base64 blob, but it carries the current value.
        case "plainTagged": {
          const current = decryptSecretMap(encrypted!);
          const inSync = !!current && sameMap(current, plaintext!);
          if (inSync && !isSecretEncryptionAvailable()) return undefined;
          return encryptSecretMap(plaintext!);
        }
        // Never encrypted, or encrypted under a key we no longer have.
        // Either way the plaintext column can rebuild it.
        case "absent":
        case "unreadable":
          return encryptSecretMap(plaintext!);
      }
      break;
    case "empty":
      // An older build removed the last entry, so drop whatever the
      // encrypted column still holds.
      switch (to) {
        case "readable":
        case "plainTagged":
        case "unreadable":
          return null;
        case "absent":
          return undefined;
      }
      break;
    case "absent":
      switch (to) {
        // Only base64 at rest, so upgrade it once a keyring shows up.
        // Without one, re-encrypting would rewrite the same tag.
        case "plainTagged":
          if (!isSecretEncryptionAvailable()) return undefined;
          return encryptSecretMap(decryptSecretMap(encrypted!)) ?? undefined;
        // Nothing to reconcile against: the encrypted column is the
        // only copy, and an unreadable one can't be rebuilt here.
        case "absent":
        case "readable":
        case "unreadable":
          return undefined;
      }
  }
  return undefined;
}

// Only write if the column still holds what we read, so a secret the
// user edits while this is running isn't rolled back.
function unchanged(
  column: AnySQLiteColumn,
  value: string | null,
): SQL | undefined {
  return value === null ? isNull(column) : eq(column, value);
}

/**
 * Brings the encrypted env var and header columns in line with what is
 * actually stored, and returns the number of columns it rewrote.
 *
 * Three cases: a secret that has never been encrypted, one an older
 * build edited through the plaintext column, and one written as a
 * `plain:` blob before a keyring was available. The plaintext columns
 * are left in place so builds that predate the encrypted columns keep
 * working.
 *
 * Runs on app startup. Never throws: a failure here must not block
 * startup, and the plaintext columns stay readable.
 */
export async function encryptStoredMcpSecrets(): Promise<number> {
  try {
    const rows = await db
      .select({
        id: mcpServers.id,
        envJson: mcpServers.envJson,
        headersJson: mcpServers.headersJson,
        envEncrypted: mcpServers.envEncrypted,
        headersEncrypted: mcpServers.headersEncrypted,
      })
      .from(mcpServers)
      .where(
        or(
          isNotNull(mcpServers.envJson),
          isNotNull(mcpServers.headersJson),
          like(mcpServers.envEncrypted, PLAINTEXT_BLOB_PATTERN),
          like(mcpServers.headersEncrypted, PLAINTEXT_BLOB_PATTERN),
        ),
      );

    let updated = 0;
    for (const row of rows) {
      const nextEnv = nextEncryptedValue(row.envJson, row.envEncrypted);
      if (nextEnv !== undefined) {
        const result = await db
          .update(mcpServers)
          .set({ envEncrypted: nextEnv })
          .where(
            and(
              eq(mcpServers.id, row.id),
              unchanged(mcpServers.envEncrypted, row.envEncrypted),
            ),
          );
        updated += result.changes;
      }

      const nextHeaders = nextEncryptedValue(
        row.headersJson,
        row.headersEncrypted,
      );
      if (nextHeaders !== undefined) {
        const result = await db
          .update(mcpServers)
          .set({ headersEncrypted: nextHeaders })
          .where(
            and(
              eq(mcpServers.id, row.id),
              unchanged(mcpServers.headersEncrypted, row.headersEncrypted),
            ),
          );
        updated += result.changes;
      }
    }

    if (updated > 0) {
      logger.info(`Encrypted ${updated} stored MCP secret(s).`);
    }
    return updated;
  } catch (error) {
    logger.error("Failed to encrypt stored MCP secrets", error);
    return 0;
  }
}
