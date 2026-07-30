import type { McpServer } from "@/ipc/types";
import type { McpCatalogEntry } from "@/ipc/types/mcp_catalog";
import type { CatalogCardStatus } from "./CatalogCard";

/**
 * What an entry's card should report.
 *
 * `addedSlugs` and the server rows come from separate queries that
 * settle independently, so a slug can be added before its row arrives.
 * That reports a plain "added" rather than guessing at a connection
 * state.
 *
 * Only a required-OAuth entry can be "not connected". An optional one
 * works anonymously and offers Connect on its own card, so reporting it
 * here would call a working plugin broken.
 */
export function catalogCardStatus({
  entry,
  addedSlugs,
  serverBySlug,
  connectingServerId,
}: {
  entry: McpCatalogEntry;
  addedSlugs: ReadonlySet<string>;
  serverBySlug: ReadonlyMap<string, McpServer>;
  connectingServerId: number | null;
}): CatalogCardStatus {
  if (!addedSlugs.has(entry.slug)) return "not-added";
  const server = serverBySlug.get(entry.slug);
  if (!server) return "added";
  if (connectingServerId === server.id) return "connecting";
  const requiresOauth = entry.transport === "http" && entry.oauth?.required;
  if (requiresOauth && !server.oauthConnected) return "needs-connect";
  return "added";
}
