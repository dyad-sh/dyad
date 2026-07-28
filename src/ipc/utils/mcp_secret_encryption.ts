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

/**
 * Works out what a secret's encrypted column should hold, or undefined
 * when it's already correct and should be left alone.
 *
 * Plaintext wins when the two disagree. This build clears the plaintext
 * column whenever it writes a secret, so a plaintext value that differs
 * from the encrypted one can only have been written afterwards by a
 * build that predates the encrypted columns.
 */
function nextEncryptedValue(
  plaintext: Record<string, string> | null,
  encrypted: string | null,
): string | undefined {
  if (plaintext && Object.keys(plaintext).length > 0) {
    const current = encrypted ? decryptSecretMap(encrypted) : null;
    if (current && sameMap(current, plaintext)) {
      return undefined;
    }
    return encryptSecretMap(plaintext) ?? undefined;
  }
  // A `plain:` blob is only base64, so upgrade it once a keyring shows
  // up. Without one, re-encrypting would just rewrite the same tag.
  if (
    encrypted?.startsWith(PLAINTEXT_PREFIX) &&
    isSecretEncryptionAvailable()
  ) {
    const decoded = decryptSecretMap(encrypted);
    return decoded ? (encryptSecretMap(decoded) ?? undefined) : undefined;
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
