import log from "electron-log";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { mcpServers } from "../../db/schema";
import {
  getRemoteMcpCatalog,
  peekRemoteMcpCatalog,
} from "@/ipc/shared/remote_mcp_catalog";
import { applyOAuthClientChange } from "./mcp_oauth_provider";
import { decryptFromString, encryptToString } from "./secret_storage";

const logger = log.scope("vendored_oauth_client");

/**
 * Writes the OAuth client the catalog vendors for this server into its row
 * when the stored copy is missing or stale, and clears the stored client
 * registration that would otherwise shadow it. The row's copy is written
 * when the plugin is added, so without this a server whose client columns
 * were cleared, or whose entry gained or changed a vendored client, would
 * try to register its own client and fail against a provider that doesn't
 * support that.
 *
 * Resolves to whether anything changed, so callers can drop a cached client
 * that holds the old credentials. Best-effort: with no catalog to read, the
 * stored client is left alone. `cachedOnly` keeps callers on hot paths off
 * the network.
 */
export async function syncVendoredOAuthClient(
  serverId: number,
  { cachedOnly = false }: { cachedOnly?: boolean } = {},
): Promise<boolean> {
  const [server] = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.id, serverId));
  // Only an http server with OAuth on can use a client, so anything else
  // needs no catalog read at all.
  if (!server?.catalogSlug) return false;
  if (server.transport !== "http" || !server.oauthEnabled) return false;

  const entries = cachedOnly
    ? (peekRemoteMcpCatalog() ?? [])
    : await getRemoteMcpCatalog();
  const entry = entries.find((e) => e.slug === server.catalogSlug);
  const vendored = entry?.inputs?.find(
    (input) => input.kind === "vendoredOAuthClient",
  );
  if (vendored?.kind !== "vendoredOAuthClient") return false;

  const storedSecret = server.oauthClientSecret
    ? decryptFromString(server.oauthClientSecret)
    : null;
  const wantedSecret = vendored.clientSecret ?? null;
  if (
    server.oauthClientId === vendored.clientId &&
    storedSecret === wantedSecret
  ) {
    return false;
  }

  logger.info(`Refreshing the vendored OAuth client for server ${serverId}`);
  await db
    .update(mcpServers)
    .set({
      oauthClientId: vendored.clientId,
      oauthClientSecret: wantedSecret ? encryptToString(wantedSecret) : null,
    })
    .where(eq(mcpServers.id, serverId));
  await applyOAuthClientChange(serverId, {
    clientId: vendored.clientId,
    clientSecret: wantedSecret,
  });
  return true;
}
