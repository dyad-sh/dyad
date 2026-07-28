import log from "electron-log";
import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { mcpServers } from "@/db/schema";
import { encryptSecretMap } from "./secret_storage";

const logger = log.scope("mcp_secret_encryption");

/**
 * Copies plaintext MCP env vars and headers into their encrypted
 * columns. The plaintext columns are left intact so a build that
 * predates the encrypted columns keeps working against the same
 * database.
 *
 * Run on app startup. After the first pass the query matches nothing,
 * and it picks the row up again if an older build writes plaintext for
 * a server whose encrypted column is empty.
 *
 * Returns the number of rows updated. Never throws: a failure here
 * must not block startup, and the plaintext columns stay readable.
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
          and(isNotNull(mcpServers.envJson), isNull(mcpServers.envEncrypted)),
          and(
            isNotNull(mcpServers.headersJson),
            isNull(mcpServers.headersEncrypted),
          ),
        ),
      );

    let updated = 0;
    for (const row of rows) {
      const update: Partial<typeof mcpServers.$inferInsert> = {};
      if (row.envJson && !row.envEncrypted) {
        update.envEncrypted = encryptSecretMap(row.envJson);
      }
      if (row.headersJson && !row.headersEncrypted) {
        update.headersEncrypted = encryptSecretMap(row.headersJson);
      }
      if (Object.keys(update).length === 0) {
        continue;
      }
      await db.update(mcpServers).set(update).where(eq(mcpServers.id, row.id));
      updated++;
    }

    if (updated > 0) {
      logger.info(`Encrypted stored MCP secrets for ${updated} server(s).`);
    }
    return updated;
  } catch (error) {
    logger.error("Failed to encrypt stored MCP secrets", error);
    return 0;
  }
}
