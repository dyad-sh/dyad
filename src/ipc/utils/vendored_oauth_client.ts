import log from "electron-log";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { mcpServers } from "../../db/schema";
import { getRemoteMcpCatalog } from "@/ipc/shared/remote_mcp_catalog";
import { decryptFromString, encryptToString } from "./secret_storage";

const logger = log.scope("vendored_oauth_client");

/**
 * Writes the OAuth client the catalog vendors for this server into its row
 * when the stored copy is missing or stale. The row's copy is written when
 * the plugin is added, so without this a server whose client columns were
 * cleared, or whose entry gained or changed a vendored client, would try to
 * register its own client and fail against a provider that doesn't support
 * that.
 *
 * Best-effort: an unreachable catalog leaves the stored client alone.
 */
export async function syncVendoredOAuthClient(serverId: number): Promise<void> {
  const [server] = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.id, serverId));
  if (!server?.catalogSlug) return;

  const entries = await getRemoteMcpCatalog();
  const entry = entries.find((e) => e.slug === server.catalogSlug);
  const vendored = entry?.inputs?.find(
    (input) => input.kind === "vendoredOAuthClient",
  );
  if (vendored?.kind !== "vendoredOAuthClient") return;

  const storedSecret = server.oauthClientSecret
    ? decryptFromString(server.oauthClientSecret)
    : null;
  const wantedSecret = vendored.clientSecret ?? null;
  if (
    server.oauthClientId === vendored.clientId &&
    storedSecret === wantedSecret
  ) {
    return;
  }

  logger.info(`Refreshing the vendored OAuth client for server ${serverId}`);
  await db
    .update(mcpServers)
    .set({
      oauthClientId: vendored.clientId,
      oauthClientSecret: wantedSecret ? encryptToString(wantedSecret) : null,
    })
    .where(eq(mcpServers.id, serverId));
}
