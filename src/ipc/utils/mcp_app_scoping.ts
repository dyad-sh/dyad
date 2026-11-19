import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  mcpAppConfigApps,
  mcpAppConfigs,
  mcpServerDefaultApps,
  mcpServers,
} from "../../db/schema";
import { isAppScopedPluginsEnabled } from "./mcp_app_scoped_experiment";
import {
  getRemoteMcpCatalog,
  peekRemoteMcpCatalog,
} from "@/ipc/shared/remote_mcp_catalog";
import type { McpCatalogEntry } from "@/ipc/types/mcp_catalog";
import type { McpConnectionRef } from "@/shared/mcp_connection_ref";
import { needsCatalogSetup } from "@/shared/mcp_setup_inputs";
import { readServerSecretMap } from "./secret_storage";
import { appConfigDisplayName } from "./mcp_connection_store";
import {
  readPluginAvailability,
  resolvePluginConnectionForApp,
  type PluginAvailability,
} from "./mcp_plugin_availability";

export { isAppScopedPluginsEnabled };

/** One plugin as an app's chat sees it. */
export interface ResolvedMcpConnection {
  connection: McpConnectionRef;
  /** Prefix for the plugin's tool keys, the same for every configuration. */
  pluginName: string;
  /** Shown on tool cards and approval prompts. */
  displayName: string;
  transport: string;
}

/** How one plugin relates to one app. */
export interface PluginAppStatus {
  serverId: number;
  catalogSlug: string | null;
  availability: PluginAvailability;
  /**
   * The connection the app would use if the plugin's switch were on, or
   * null when neither the default nor an app-specific configuration serves
   * the app.
   */
  coveringConnection: ResolvedMcpConnection | null;
  /** The default configuration's stored OAuth state. */
  defaultOAuthState: string | null;
  /** The app-specific configuration's OAuth state, when it covers the app. */
  appConfigOAuthState: string | null;
  /**
   * The app-specific configuration covering the app still has required
   * catalog setup inputs unfilled, so the app has no working plugin yet.
   */
  appConfigNeedsSetup: boolean;
}

/** The stored columns a connection's setup inputs are saved in. */
export interface StoredSetupValues {
  envEncrypted: string | null;
  headersEncrypted: string | null;
  envJson?: Record<string, string> | null;
  headersJson?: Record<string, string> | null;
  oauthClientId: string | null;
}

/**
 * Whether a stored connection still has required catalog setup inputs
 * unfilled. A connection whose entry or stored values can't be read is
 * reported as set up, so connecting proceeds as before.
 */
export function connectionNeedsSetup(
  entry: McpCatalogEntry | undefined,
  stored: StoredSetupValues,
): boolean {
  if (!entry?.inputs?.length) return false;
  const env = readServerSecretMap(stored.envEncrypted, stored.envJson);
  const headers = readServerSecretMap(
    stored.headersEncrypted,
    stored.headersJson,
  );
  if (env.status !== "ok" || headers.status !== "ok") return false;
  return needsCatalogSetup(
    {
      envJson: env.value,
      headersJson: headers.value,
      oauthClientId: stored.oauthClientId,
    },
    entry.inputs,
  );
}

/**
 * A plugin's catalog entry from the cache, for checks that run on every
 * chat turn and must not wait on the network. When the cache is cold it
 * starts a refresh for the next turn and returns undefined.
 */
function cachedCatalogEntry(
  catalogSlug: string | null,
): McpCatalogEntry | undefined {
  if (!catalogSlug) return undefined;
  const catalog = peekRemoteMcpCatalog();
  if (!catalog) {
    void getRemoteMcpCatalog().catch(() => {});
    return undefined;
  }
  return catalog.find((e) => e.slug === catalogSlug);
}

/**
 * Every plugin's status for one app. With the experiment off, every plugin
 * serves every app through its default configuration and only `enabled`
 * counts, exactly as in builds without the feature.
 */
export async function readPluginStatusesForApp(
  appId: number,
): Promise<PluginAppStatus[]> {
  const experimentEnabled = isAppScopedPluginsEnabled();
  const [servers, defaultAppRows, assignedConfigs] = await Promise.all([
    db
      .select({
        id: mcpServers.id,
        name: mcpServers.name,
        transport: mcpServers.transport,
        catalogSlug: mcpServers.catalogSlug,
        oauthState: mcpServers.oauthState,
        enabled: mcpServers.enabled,
        defaultScope: mcpServers.defaultScope,
        scopedEnabled: mcpServers.scopedEnabled,
      })
      .from(mcpServers),
    experimentEnabled
      ? db
          .select({ serverId: mcpServerDefaultApps.serverId })
          .from(mcpServerDefaultApps)
          .where(eq(mcpServerDefaultApps.appId, appId))
      : [],
    experimentEnabled
      ? db
          .select({
            serverId: mcpAppConfigApps.serverId,
            appConfigId: mcpAppConfigs.id,
            name: mcpAppConfigs.name,
            transport: mcpAppConfigs.transport,
            oauthState: mcpAppConfigs.oauthState,
            envEncrypted: mcpAppConfigs.envEncrypted,
            headersEncrypted: mcpAppConfigs.headersEncrypted,
            oauthClientId: mcpAppConfigs.oauthClientId,
          })
          .from(mcpAppConfigApps)
          // Matching the plugin too means an assignment whose plugin
          // disagrees with its configuration's is ignored.
          .innerJoin(
            mcpAppConfigs,
            and(
              eq(mcpAppConfigs.id, mcpAppConfigApps.appConfigId),
              eq(mcpAppConfigs.serverId, mcpAppConfigApps.serverId),
            ),
          )
          .where(eq(mcpAppConfigApps.appId, appId))
      : [],
  ]);
  // Both lists are already narrowed to this app, so membership by plugin
  // is all the resolution needs.
  const servedByDefault = new Set(defaultAppRows.map((row) => row.serverId));
  const configByPlugin = new Map(
    assignedConfigs.map((config) => [config.serverId, config]),
  );

  return servers.map((server) => {
    const availability = readPluginAvailability(server, experimentEnabled);
    const config = configByPlugin.get(server.id);
    const connection = resolvePluginConnectionForApp({
      serverId: server.id,
      // Coverage is independent of the switch, which callers check.
      availability: { ...availability, pluginEnabled: true },
      defaultAppIds: servedByDefault.has(server.id)
        ? new Set([appId])
        : new Set(),
      appConfigId: config?.appConfigId ?? null,
      appId,
    });
    const usesAppConfig = !!config && connection?.appConfigId != null;
    return {
      serverId: server.id,
      catalogSlug: server.catalogSlug,
      availability,
      coveringConnection:
        connection === null
          ? null
          : usesAppConfig
            ? {
                connection,
                pluginName: server.name,
                displayName: appConfigDisplayName(server.name, config.name),
                transport: config.transport,
              }
            : {
                connection,
                pluginName: server.name,
                displayName: server.name,
                transport: server.transport,
              },
      defaultOAuthState: server.oauthState,
      appConfigOAuthState: usesAppConfig ? config.oauthState : null,
      appConfigNeedsSetup:
        usesAppConfig &&
        connectionNeedsSetup(cachedCatalogEntry(server.catalogSlug), config),
    };
  });
}

/**
 * The plugins an app's chat can use, each with the configuration it uses
 * there: an app-specific configuration if the app has one, otherwise the
 * default when it serves the app. An app-specific configuration that still
 * needs setup leaves the app without the plugin; it never falls back to
 * the default, which may reach a different server or account. Setup is
 * judged from the cached catalog, so while the cache is cold an unfinished
 * configuration is tried, and its connection fails, for that turn.
 */
export async function resolveMcpConnectionsForApp(
  appId: number,
): Promise<ResolvedMcpConnection[]> {
  const statuses = await readPluginStatusesForApp(appId);
  return statuses.flatMap((status) =>
    status.availability.pluginEnabled &&
    status.coveringConnection &&
    !status.appConfigNeedsSetup
      ? [status.coveringConnection]
      : [],
  );
}
