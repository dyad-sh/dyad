import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { mcpAppConfigs, mcpServers } from "../../db/schema";
import { isAppScopedPluginsEnabled } from "./mcp_app_scoped_experiment";
import {
  appConfigConnection,
  pluginConnection,
  type McpConnectionRef,
} from "@/shared/mcp_connection_ref";

/**
 * Storage for anything Dyad connects to, addressed by McpConnectionRef. The
 * connection cache, the OAuth flow and the OAuth client sync read and write
 * configurations only through here, so they work the same for a plugin's
 * default configuration (`mcp_servers`) and an app-specific one
 * (`mcp_app_configs`).
 */
export interface McpConnectionRecord {
  connection: McpConnectionRef;
  /** The plugin's name. Tool keys use it, so they don't depend on configs. */
  pluginName: string;
  /** What the user sees: the plugin name, plus the configuration's name. */
  displayName: string;
  transport: string;
  command: string | null;
  args: string[] | null;
  // Legacy plaintext columns; app-specific configurations never have them.
  envJson: Record<string, string> | null;
  headersJson: Record<string, string> | null;
  envEncrypted: string | null;
  headersEncrypted: string | null;
  url: string | null;
  oauthEnabled: boolean;
  oauthState: string | null;
  oauthClientId: string | null;
  oauthClientSecret: string | null;
  oauthScope: string | null;
  oauthCallbackPort: number | null;
  /** The plugin's catalog entry; app-specific configurations share it. */
  catalogSlug: string | null;
}

export function appConfigDisplayName(
  pluginName: string,
  configName: string,
): string {
  return `${pluginName} (${configName})`;
}

/**
 * The stored connection a ref points at. An app-specific configuration
 * reads as missing while the app-scoped plugins experiment is off, so no
 * channel can connect to it, list its tools or sign it in.
 */
export async function readMcpConnection(
  ref: McpConnectionRef,
): Promise<McpConnectionRecord | undefined> {
  if (ref.appConfigId === null) {
    const [row] = await db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, ref.serverId));
    if (!row) return undefined;
    return {
      connection: pluginConnection(row.id),
      pluginName: row.name,
      displayName: row.name,
      transport: row.transport,
      command: row.command,
      args: row.args,
      envJson: row.envJson,
      headersJson: row.headersJson,
      envEncrypted: row.envEncrypted,
      headersEncrypted: row.headersEncrypted,
      url: row.url,
      oauthEnabled: row.oauthEnabled,
      oauthState: row.oauthState,
      oauthClientId: row.oauthClientId,
      oauthClientSecret: row.oauthClientSecret,
      oauthScope: row.oauthScope,
      oauthCallbackPort: row.oauthCallbackPort,
      catalogSlug: row.catalogSlug,
    };
  }
  if (!isAppScopedPluginsEnabled()) return undefined;
  const [row] = await db
    .select({
      config: mcpAppConfigs,
      pluginName: mcpServers.name,
      catalogSlug: mcpServers.catalogSlug,
    })
    .from(mcpAppConfigs)
    .innerJoin(mcpServers, eq(mcpServers.id, mcpAppConfigs.serverId))
    .where(appConfigRowFilter(ref.serverId, ref.appConfigId));
  if (!row) return undefined;
  const { config } = row;
  return {
    connection: appConfigConnection(config.serverId, config.id),
    pluginName: row.pluginName,
    displayName: appConfigDisplayName(row.pluginName, config.name),
    transport: config.transport,
    command: config.command,
    args: config.args,
    envJson: null,
    headersJson: null,
    envEncrypted: config.envEncrypted,
    headersEncrypted: config.headersEncrypted,
    url: config.url,
    oauthEnabled: config.oauthEnabled,
    oauthState: config.oauthState,
    oauthClientId: config.oauthClientId,
    oauthClientSecret: config.oauthClientSecret,
    oauthScope: config.oauthScope,
    oauthCallbackPort: config.oauthCallbackPort,
    catalogSlug: row.catalogSlug,
  };
}

export async function readMcpConnectionOAuthState(
  ref: McpConnectionRef,
): Promise<string | null> {
  if (ref.appConfigId === null) {
    const [row] = await db
      .select({ oauthState: mcpServers.oauthState })
      .from(mcpServers)
      .where(eq(mcpServers.id, ref.serverId));
    return row?.oauthState ?? null;
  }
  const [row] = await db
    .select({ oauthState: mcpAppConfigs.oauthState })
    .from(mcpAppConfigs)
    .where(appConfigRowFilter(ref.serverId, ref.appConfigId));
  return row?.oauthState ?? null;
}

/** The OAuth columns the connection machinery itself writes. */
export interface McpConnectionOAuthColumns {
  oauthState?: string | null;
  oauthCallbackPort?: number | null;
  oauthClientId?: string | null;
  oauthClientSecret?: string | null;
}

/** Writes OAuth columns of a connection. */
export async function writeMcpConnectionOAuthColumns(
  ref: McpConnectionRef,
  values: McpConnectionOAuthColumns,
): Promise<void> {
  if (ref.appConfigId === null) {
    await db
      .update(mcpServers)
      .set(values)
      .where(eq(mcpServers.id, ref.serverId));
    return;
  }
  await db
    .update(mcpAppConfigs)
    .set(values)
    .where(appConfigRowFilter(ref.serverId, ref.appConfigId));
}

/**
 * Writes a connection's OAuth client, but only while the row is still an
 * http configuration with OAuth on, so an edit that landed in between is
 * not overwritten. Returns whether a row was written.
 */
export async function writeMcpConnectionOAuthClientIfHttpOAuth(
  ref: McpConnectionRef,
  values: Pick<
    McpConnectionOAuthColumns,
    "oauthClientId" | "oauthClientSecret"
  >,
): Promise<boolean> {
  if (ref.appConfigId === null) {
    const written = await db
      .update(mcpServers)
      .set(values)
      .where(
        and(
          eq(mcpServers.id, ref.serverId),
          eq(mcpServers.transport, "http"),
          eq(mcpServers.oauthEnabled, true),
        ),
      )
      .returning({ id: mcpServers.id });
    return written.length > 0;
  }
  const written = await db
    .update(mcpAppConfigs)
    .set(values)
    .where(
      and(
        appConfigRowFilter(ref.serverId, ref.appConfigId),
        eq(mcpAppConfigs.transport, "http"),
        eq(mcpAppConfigs.oauthEnabled, true),
      ),
    )
    .returning({ id: mcpAppConfigs.id });
  return written.length > 0;
}

/**
 * Matches an app-specific configuration only under the plugin the ref
 * names, so a ref whose ids don't belong together never reads or writes a
 * row.
 */
export function appConfigRowFilter(serverId: number, appConfigId: number) {
  return and(
    eq(mcpAppConfigs.id, appConfigId),
    eq(mcpAppConfigs.serverId, serverId),
  );
}
