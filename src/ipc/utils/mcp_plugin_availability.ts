import {
  appConfigConnection,
  pluginConnection,
  type McpConnectionRef,
} from "@/shared/mcp_connection_ref";

/**
 * Which apps a plugin's default configuration serves (app-scoped plugins
 * experiment):
 * - "all": every app that has no app-specific configuration of the plugin.
 * - "selected": only the apps listed in `mcp_server_default_apps`.
 * - "none": no app; only apps with their own configuration get the plugin.
 */
export type PluginDefaultScope = "all" | "selected" | "none";

export const PLUGIN_DEFAULT_SCOPES: readonly PluginDefaultScope[] = [
  "all",
  "selected",
  "none",
];

/** The `mcp_servers` columns that together store a plugin's availability. */
export interface PluginAvailabilityColumns {
  enabled: boolean;
  defaultScope: string;
  scopedEnabled: boolean;
}

export interface PluginAvailability {
  /** The plugin's on/off switch. Off means no configuration is used. */
  pluginEnabled: boolean;
  defaultScope: PluginDefaultScope;
}

function parseDefaultScope(value: string): PluginDefaultScope {
  return (PLUGIN_DEFAULT_SCOPES as readonly string[]).includes(value)
    ? (value as PluginDefaultScope)
    : "all";
}

/**
 * Reads a plugin's availability from its row.
 *
 * `enabled` is the column builds without the feature read, and they use the
 * plugin in every app when it is true. It is therefore only written true for
 * a plugin that is on with an "all" default, and whenever it is true the
 * default serves every app: an older build (or this build with the
 * experiment off) that turned the plugin on made it global. A plugin whose
 * default is limited keeps `enabled` false, so older builds treat it as off
 * rather than leaking it into every app, and stores its switch in
 * `scopedEnabled`.
 *
 * With the experiment off, only `enabled` counts, exactly as in older
 * builds.
 */
export function readPluginAvailability(
  row: PluginAvailabilityColumns,
  experimentEnabled: boolean,
): PluginAvailability {
  if (!experimentEnabled || row.enabled) {
    return { pluginEnabled: row.enabled, defaultScope: "all" };
  }
  const defaultScope = parseDefaultScope(row.defaultScope);
  if (defaultScope === "all") {
    return { pluginEnabled: false, defaultScope };
  }
  return { pluginEnabled: row.scopedEnabled, defaultScope };
}

/** The column values that store `availability`; see readPluginAvailability. */
export function pluginAvailabilityColumns(
  availability: PluginAvailability,
): PluginAvailabilityColumns {
  const { pluginEnabled, defaultScope } = availability;
  return {
    enabled: pluginEnabled && defaultScope === "all",
    defaultScope,
    scopedEnabled: pluginEnabled && defaultScope !== "all",
  };
}

/**
 * The connection an app uses for one plugin, or null when the plugin is not
 * available in that app: its app-specific configuration if it has one,
 * otherwise the default configuration if the default serves the app.
 */
export function resolvePluginConnectionForApp(params: {
  serverId: number;
  availability: PluginAvailability;
  /** Apps the default serves when its scope is "selected". */
  defaultAppIds: ReadonlySet<number>;
  /** The app-specific configuration assigned to the app, if any. */
  appConfigId: number | null;
  appId: number;
}): McpConnectionRef | null {
  const { availability, appConfigId, serverId } = params;
  if (!availability.pluginEnabled) return null;
  if (appConfigId !== null) return appConfigConnection(serverId, appConfigId);
  switch (availability.defaultScope) {
    case "all":
      return pluginConnection(serverId);
    case "selected":
      return params.defaultAppIds.has(params.appId)
        ? pluginConnection(serverId)
        : null;
    case "none":
      return null;
  }
}
