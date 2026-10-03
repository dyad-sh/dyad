import log from "electron-log";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { mcpServers } from "../../db/schema";
import {
  getRemoteMcpCatalog,
  peekRemoteMcpCatalog,
} from "@/ipc/shared/remote_mcp_catalog";
import {
  applyOAuthClientChange,
  readStoredOAuthClient,
  revokeMcpOAuthWriteAuthority,
} from "./mcp_oauth_provider";
import { decryptFromString, encryptToString } from "./secret_storage";

const logger = log.scope("vendored_oauth_client");

/**
 * Writes the OAuth client the catalog vendors for this server into its row
 * when the stored copy is missing or stale, covering both the row's columns
 * and the client the provider saved on its first connect, which otherwise
 * shadows them. The row's copy is written when the plugin is added, so
 * without this a server whose client columns were cleared, or whose entry
 * gained or changed a vendored client, would try to register its own client
 * and fail against a provider that doesn't support that.
 *
 * Resolves to whether the caller should drop its cached client for this
 * server, which is true once the old client's writes have been fenced, even
 * if the write that follows fails. Best-effort otherwise: with no catalog to
 * read, or on an unexpected failure, the stored client is left alone and the
 * caller continues with it. `cachedOnly` keeps callers on hot paths off the
 * network.
 */
export async function syncVendoredOAuthClient(
  serverId: number,
  { cachedOnly = false }: { cachedOnly?: boolean } = {},
): Promise<boolean> {
  // A cached client whose provider lost its write authority can no longer
  // persist tokens, so the caller has to drop it even when the writes that
  // follow the fence fail.
  const fence = { revoked: false };
  try {
    return await syncOrThrow(serverId, cachedOnly, fence);
  } catch (error) {
    logger.warn(
      `Could not refresh the vendored OAuth client for server ${serverId}`,
      error,
    );
    return fence.revoked;
  }
}

async function syncOrThrow(
  serverId: number,
  cachedOnly: boolean,
  fence: { revoked: boolean },
): Promise<boolean> {
  const [server] = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.id, serverId));
  // Only an http server with OAuth on can use a client, so anything else
  // needs no catalog read at all.
  if (!server?.catalogSlug) return false;
  if (server.transport !== "http" || !server.oauthEnabled) return false;
  // Connecting can't work without a client, so that is the one case worth
  // correcting here. Anything else waits for Connect or a re-add, which must
  // not have their flows fenced by a background connection.
  if (cachedOnly && server.oauthClientId) return false;

  const entries = cachedOnly
    ? (peekRemoteMcpCatalog() ?? [])
    : await getRemoteMcpCatalog();
  const entry = entries.find((e) => e.slug === server.catalogSlug);
  const vendored = entry?.inputs?.find(
    (input) => input.kind === "vendoredOAuthClient",
  );
  if (vendored?.kind !== "vendoredOAuthClient") return false;

  const wantedSecret = vendored.clientSecret ?? null;
  const storedSecret = server.oauthClientSecret
    ? decryptFromString(server.oauthClientSecret)
    : null;
  const columnsMatch =
    server.oauthClientId === vendored.clientId && storedSecret === wantedSecret;
  // A stored client that disagrees with the catalog keeps being sent even
  // once the columns are right, so it counts as stale on its own.
  const stored = await readStoredOAuthClient(serverId);
  const storedStateMatches =
    !stored ||
    (stored.client_id === vendored.clientId &&
      (stored.client_secret ?? null) === wantedSecret);
  if (columnsMatch && storedStateMatches) return false;

  logger.info(`Refreshing the vendored OAuth client for server ${serverId}`);
  // Fence providers built from the old client: their later writes would put
  // the credentials this is replacing back.
  await revokeMcpOAuthWriteAuthority(serverId);
  fence.revoked = true;
  // Conditional on the row still being an http server with OAuth on, the
  // same shape checked above: an edit landing in between must not leave a
  // client on a server that no longer uses one.
  const written = await db
    .update(mcpServers)
    .set({
      oauthClientId: vendored.clientId,
      oauthClientSecret: wantedSecret ? encryptToString(wantedSecret) : null,
    })
    .where(
      and(
        eq(mcpServers.id, serverId),
        eq(mcpServers.transport, "http"),
        eq(mcpServers.oauthEnabled, true),
      ),
    )
    .returning({ id: mcpServers.id });
  if (written.length === 0) return true;
  await applyOAuthClientChange(serverId, {
    clientId: vendored.clientId,
    clientSecret: wantedSecret,
    clientIdChanged: server.oauthClientId !== vendored.clientId,
  });
  return true;
}
