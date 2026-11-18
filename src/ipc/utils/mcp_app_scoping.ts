import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  mcpAppConfigApps,
  mcpAppConfigs,
  mcpServerDefaultApps,
  mcpServers,
} from "../../db/schema";
import { readSettings } from "../../main/settings";
import type { McpConnectionRef } from "@/shared/mcp_connection_ref";
import { appConfigDisplayName } from "./mcp_connection_store";
import {
  readPluginAvailability,
  resolvePluginConnectionForApp,
  type PluginAvailability,
} from "./mcp_plugin_availability";

export function isAppScopedPluginsEnabled(): boolean {
  return !!readSettings().enableAppScopedPlugins;
}

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
          })
          .from(mcpAppConfigApps)
          .innerJoin(
            mcpAppConfigs,
            eq(mcpAppConfigs.id, mcpAppConfigApps.appConfigId),
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
    };
  });
}

/**
 * The plugins an app's chat can use, each with the configuration it uses
 * there: an app-specific configuration if the app has one, otherwise the
 * default when it serves the app.
 */
export async function resolveMcpConnectionsForApp(
  appId: number,
): Promise<ResolvedMcpConnection[]> {
  const statuses = await readPluginStatusesForApp(appId);
  return statuses.flatMap((status) =>
    status.availability.pluginEnabled && status.coveringConnection
      ? [status.coveringConnection]
      : [],
  );
}
