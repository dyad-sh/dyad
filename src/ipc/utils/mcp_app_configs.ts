import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  apps,
  mcpAppConfigApps,
  mcpAppConfigs,
  mcpServerDefaultApps,
  mcpServers,
} from "../../db/schema";
import { DyadError, DyadErrorKind } from "../../errors/dyad_error";
import { getRemoteMcpCatalog } from "@/ipc/shared/remote_mcp_catalog";
import type { McpCatalogEntry } from "@/ipc/types/mcp_catalog";
import type { McpAppConfig, McpTransport } from "@/ipc/types/mcp";
import {
  appConfigConnection,
  type McpConnectionRef,
} from "@/shared/mcp_connection_ref";
import {
  encryptSecretMap,
  encryptToString,
  readServerSecretMap,
} from "./secret_storage";
import { getOAuthStateStatus } from "./mcp_oauth_provider";
import { appConfigRowFilter } from "./mcp_connection_store";
import {
  connectionNeedsSetup,
  isAppScopedPluginsEnabled,
} from "./mcp_app_scoping";
import {
  pluginAvailabilityColumns,
  readPluginAvailability,
  type PluginDefaultScope,
} from "./mcp_plugin_availability";

type ServerRow = typeof mcpServers.$inferSelect;
type AppConfigRow = typeof mcpAppConfigs.$inferSelect;

/** The configuration columns a catalog entry starts a configuration with. */
export function catalogEntryConnectionValues(entry: McpCatalogEntry) {
  if (entry.transport === "stdio") {
    return {
      transport: "stdio" as const,
      command: entry.command,
      args: entry.args,
      envEncrypted: encryptSecretMap(entry.env),
    };
  }
  // Only kept for an entry that uses OAuth, matching the vendored client
  // sync, which leaves OAuth-disabled servers alone.
  const vendoredClient = entry.oauth
    ? entry.inputs?.find((input) => input.kind === "vendoredOAuthClient")
    : undefined;
  return {
    transport: "http" as const,
    url: entry.url,
    headersEncrypted: encryptSecretMap(entry.headers),
    oauthEnabled: entry.oauth != null,
    oauthScope: entry.oauth?.scope ?? null,
    oauthClientId: vendoredClient?.clientId ?? null,
    oauthClientSecret: vendoredClient?.clientSecret
      ? encryptToString(vendoredClient.clientSecret)
      : null,
  };
}

export function assertAppScopedPluginsEnabled(): void {
  if (!isAppScopedPluginsEnabled()) {
    throw new DyadError(
      "App-specific plugin configurations are an experiment that is turned off. Turn it on in Settings → Experiments.",
      DyadErrorKind.Precondition,
    );
  }
}

/** Plugin-level fields of McpServer that depend on the experiment. */
export interface PluginScopeFields {
  enabled: boolean;
  defaultScope: PluginDefaultScope;
  defaultAppIds: number[];
  appConfigCount: number;
}

/** Scope fields for every plugin, keyed by plugin id. */
export async function readPluginScopeFields(
  servers: Pick<
    ServerRow,
    "id" | "enabled" | "defaultScope" | "scopedEnabled"
  >[],
): Promise<Map<number, PluginScopeFields>> {
  const experimentEnabled = isAppScopedPluginsEnabled();
  const [defaultApps, configs] = experimentEnabled
    ? await Promise.all([
        db.select().from(mcpServerDefaultApps),
        db.select({ serverId: mcpAppConfigs.serverId }).from(mcpAppConfigs),
      ])
    : [[], []];
  const fields = new Map<number, PluginScopeFields>();
  for (const server of servers) {
    const availability = readPluginAvailability(server, experimentEnabled);
    fields.set(server.id, {
      enabled: availability.pluginEnabled,
      defaultScope: availability.defaultScope,
      defaultAppIds: defaultApps
        .filter((row) => row.serverId === server.id)
        .map((row) => row.appId),
      appConfigCount: configs.filter((row) => row.serverId === server.id)
        .length,
    });
  }
  return fields;
}

function toMcpAppConfig(
  config: AppConfigRow,
  plugin: Pick<ServerRow, "catalogSlug">,
  pluginEnabled: boolean,
  appIds: number[],
): McpAppConfig {
  const env = readServerSecretMap(config.envEncrypted, null);
  const headers = readServerSecretMap(config.headersEncrypted, null);
  return {
    id: config.id,
    connection: appConfigConnection(config.serverId, config.id),
    serverId: config.serverId,
    name: config.name,
    transport: config.transport as McpTransport,
    command: config.command,
    args: config.args,
    envJson: env.status === "ok" ? env.value : null,
    headersJson: headers.status === "ok" ? headers.value : null,
    envUnreadable: env.status === "unreadable",
    headersUnreadable: headers.status === "unreadable",
    url: config.url,
    enabled: pluginEnabled,
    oauthEnabled: config.oauthEnabled,
    ...getOAuthStateStatus(config.oauthState),
    oauthCallbackPort: config.oauthCallbackPort,
    oauthClientId: config.oauthClientId,
    catalogSlug: plugin.catalogSlug,
    appIds,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

export async function listAppConfigs(
  serverId?: number,
): Promise<McpAppConfig[]> {
  const experimentEnabled = isAppScopedPluginsEnabled();
  const rows = await db
    .select({ config: mcpAppConfigs, plugin: mcpServers })
    .from(mcpAppConfigs)
    .innerJoin(mcpServers, eq(mcpServers.id, mcpAppConfigs.serverId))
    .where(
      serverId === undefined ? undefined : eq(mcpAppConfigs.serverId, serverId),
    );
  if (rows.length === 0) return [];
  const assignments = await db
    .select({
      appConfigId: mcpAppConfigApps.appConfigId,
      appId: mcpAppConfigApps.appId,
    })
    .from(mcpAppConfigApps)
    .where(
      inArray(
        mcpAppConfigApps.appConfigId,
        rows.map((row) => row.config.id),
      ),
    );
  return rows.map(({ config, plugin }) =>
    toMcpAppConfig(
      config,
      plugin,
      readPluginAvailability(plugin, experimentEnabled).pluginEnabled,
      assignments
        .filter((row) => row.appConfigId === config.id)
        .map((row) => row.appId),
    ),
  );
}

/** An app-specific configuration, addressed by its plugin and its id. */
export interface AppConfigRef {
  serverId: number;
  appConfigId: number;
}

export async function readAppConfig(ref: AppConfigRef): Promise<McpAppConfig> {
  const configs = await listAppConfigs(ref.serverId);
  const config = configs.find((candidate) => candidate.id === ref.appConfigId);
  if (!config) {
    throw new DyadError(
      `App-specific configuration not found: ${ref.appConfigId}`,
      DyadErrorKind.NotFound,
    );
  }
  return config;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function assertAppsExist(tx: Tx, appIds: number[]): void {
  if (appIds.length === 0) return;
  const found = tx
    .select({ id: apps.id })
    .from(apps)
    .where(inArray(apps.id, appIds))
    .all();
  if (found.length !== new Set(appIds).size) {
    throw new DyadError(
      "One or more of the selected apps no longer exist.",
      DyadErrorKind.NotFound,
    );
  }
}

// Assigns apps to a configuration. An app can use only one configuration of
// a plugin, so an app assigned to another of the plugin's configurations
// moves to this one.
function replaceAssignments(
  tx: Tx,
  config: { id: number; serverId: number },
  appIds: number[],
): void {
  tx.delete(mcpAppConfigApps)
    .where(eq(mcpAppConfigApps.appConfigId, config.id))
    .run();
  const unique = [...new Set(appIds)];
  if (unique.length === 0) return;
  tx.delete(mcpAppConfigApps)
    .where(
      and(
        eq(mcpAppConfigApps.serverId, config.serverId),
        inArray(mcpAppConfigApps.appId, unique),
      ),
    )
    .run();
  tx.insert(mcpAppConfigApps)
    .values(
      unique.map((appId) => ({
        appConfigId: config.id,
        serverId: config.serverId,
        appId,
      })),
    )
    .run();
}

export async function createAppConfig(params: {
  serverId: number;
  name: string;
  appIds: number[];
}): Promise<McpAppConfig> {
  assertAppScopedPluginsEnabled();
  const [plugin] = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.id, params.serverId));
  if (!plugin) {
    throw new DyadError(
      `Plugin not found: ${params.serverId}`,
      DyadErrorKind.NotFound,
    );
  }
  const values = await initialConfigValues(plugin);
  const created = db.transaction((tx) => {
    assertAppsExist(tx, params.appIds);
    const config = tx
      .insert(mcpAppConfigs)
      .values({ serverId: plugin.id, name: params.name.trim(), ...values })
      .returning()
      .get();
    replaceAssignments(tx, config, params.appIds);
    return config;
  });
  return readAppConfig({ serverId: plugin.id, appConfigId: created.id });
}

/**
 * A new configuration starts from the plugin's catalog entry, with the
 * entry's setup fields left for the user to fill in, or, for a plugin set
 * up by hand, from the plugin's connection settings. Credentials (env
 * values, headers, tokens) are never copied from the default: a separate
 * configuration exists to reach a different server or account. A
 * hand-configured OAuth client is copied, since it belongs to the OAuth
 * app registered at the provider, not to an account.
 */
async function initialConfigValues(
  plugin: ServerRow,
): Promise<Omit<typeof mcpAppConfigs.$inferInsert, "serverId" | "name">> {
  if (plugin.catalogSlug) {
    const entries = await getRemoteMcpCatalog();
    const entry = entries.find((e) => e.slug === plugin.catalogSlug);
    if (!entry) {
      throw new DyadError(
        entries.length === 0
          ? "Could not reach the plugin catalog. Please check your connection and try again."
          : `This plugin is no longer in the catalog: ${plugin.catalogSlug}`,
        entries.length === 0
          ? DyadErrorKind.Precondition
          : DyadErrorKind.NotFound,
      );
    }
    if (entry.transport !== plugin.transport) {
      throw new DyadError(
        `${plugin.name}'s catalog entry has changed how it connects. Remove the plugin and add it again to use the new version.`,
        DyadErrorKind.Precondition,
      );
    }
    if (entry.transport === "stdio") return reviewedStdioValues(plugin, entry);
    return catalogEntryConnectionValues(entry);
  }
  return {
    transport: plugin.transport,
    command: plugin.command,
    args: plugin.args,
    url: plugin.url,
    oauthEnabled: plugin.oauthEnabled,
    oauthScope: plugin.oauthScope,
    oauthClientId: plugin.oauthClientId,
    oauthClientSecret: plugin.oauthClientSecret,
    oauthCallbackPort: plugin.oauthCallbackPort,
  };
}

/**
 * A stdio configuration runs the command the user reviewed when adding the
 * plugin, which is the plugin's own, not whatever the catalog lists now.
 * The catalog's fixed env vars are taken from the plugin too; the setup
 * inputs (credentials) are left for the user to fill in.
 */
function reviewedStdioValues(
  plugin: ServerRow,
  entry: McpCatalogEntry & { transport: "stdio" },
) {
  const stored = readServerSecretMap(plugin.envEncrypted, plugin.envJson);
  if (stored.status !== "ok") {
    throw new DyadError(
      `${plugin.name}'s saved settings can't be read. Unlock or restore your OS keyring and try again.`,
      DyadErrorKind.Precondition,
    );
  }
  const env: Record<string, string> = {};
  for (const key of Object.keys(entry.env ?? {})) {
    const value = stored.value?.[key];
    if (value !== undefined) env[key] = value;
  }
  return {
    transport: "stdio" as const,
    command: plugin.command,
    args: plugin.args,
    envEncrypted: encryptSecretMap(env),
  };
}

export async function setAppConfigApps(
  params: AppConfigRef & { appIds: number[] },
): Promise<McpAppConfig> {
  assertAppScopedPluginsEnabled();
  db.transaction((tx) => {
    const config = tx
      .select({ id: mcpAppConfigs.id, serverId: mcpAppConfigs.serverId })
      .from(mcpAppConfigs)
      .where(appConfigRowFilter(params.serverId, params.appConfigId))
      .get();
    if (!config) {
      throw new DyadError(
        `App-specific configuration not found: ${params.appConfigId}`,
        DyadErrorKind.NotFound,
      );
    }
    assertAppsExist(tx, params.appIds);
    replaceAssignments(tx, config, params.appIds);
  });
  return readAppConfig(params);
}

/** Sets which apps the plugin's default configuration serves. */
export async function setPluginAvailability(params: {
  serverId: number;
  defaultScope: PluginDefaultScope;
  defaultAppIds: number[];
}): Promise<void> {
  assertAppScopedPluginsEnabled();
  const servesApps =
    params.defaultScope === "all" ||
    (params.defaultScope === "selected" && params.defaultAppIds.length > 0);
  // The catalog read can't happen inside the transaction below.
  const [before] = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.id, params.serverId));
  // Only the check for a plugin that is on needs the catalog, so a plugin
  // that is off never waits on the fetch.
  const entry =
    servesApps &&
    before?.catalogSlug &&
    readPluginAvailability(before, true).pluginEnabled
      ? (await getRemoteMcpCatalog()).find((e) => e.slug === before.catalogSlug)
      : undefined;
  db.transaction((tx) => {
    const plugin = tx
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.id, params.serverId))
      .get();
    if (!plugin) {
      throw new DyadError(
        `Plugin not found: ${params.serverId}`,
        DyadErrorKind.NotFound,
      );
    }
    const { pluginEnabled } = readPluginAvailability(plugin, true);
    // An unfinished default must not start serving apps while the plugin
    // is on. With an "all" scope this would also turn the plugin on for
    // builds without the feature.
    if (pluginEnabled && servesApps && connectionNeedsSetup(entry, plugin)) {
      throw new DyadError(
        `Finish setting up ${plugin.name}'s default configuration before making it available to apps.`,
        DyadErrorKind.Precondition,
      );
    }
    tx.update(mcpServers)
      .set(
        pluginAvailabilityColumns({
          pluginEnabled,
          defaultScope: params.defaultScope,
        }),
      )
      .where(eq(mcpServers.id, plugin.id))
      .run();
    // The list is kept while the scope is "all" or "none", so switching
    // back to "selected" restores it.
    if (params.defaultScope !== "selected") return;
    assertAppsExist(tx, params.defaultAppIds);
    tx.delete(mcpServerDefaultApps)
      .where(eq(mcpServerDefaultApps.serverId, plugin.id))
      .run();
    const unique = [...new Set(params.defaultAppIds)];
    if (unique.length > 0) {
      tx.insert(mcpServerDefaultApps)
        .values(unique.map((appId) => ({ serverId: plugin.id, appId })))
        .run();
    }
  });
}

/**
 * Columns to write when the plugin's switch changes. With the experiment
 * off the switch means on or off for every app, so the default's scope is
 * written as "all".
 */
export function pluginSwitchColumns(
  plugin: Pick<ServerRow, "enabled" | "defaultScope" | "scopedEnabled">,
  pluginEnabled: boolean,
) {
  const experimentEnabled = isAppScopedPluginsEnabled();
  const current = readPluginAvailability(plugin, experimentEnabled);
  return pluginAvailabilityColumns({ ...current, pluginEnabled });
}

/** Connections for each of a plugin's app-specific configurations. */
export async function listAppConfigConnections(
  serverId: number,
): Promise<McpConnectionRef[]> {
  const rows = await db
    .select({ id: mcpAppConfigs.id })
    .from(mcpAppConfigs)
    .where(eq(mcpAppConfigs.serverId, serverId));
  return rows.map((row) => appConfigConnection(serverId, row.id));
}

/**
 * A copied app uses the same plugin configurations as its source: the same
 * app-specific configurations, and the default where it served the source.
 */
export function copyPluginAssignments(
  tx: Tx,
  sourceAppId: number,
  newAppId: number,
): void {
  const configs = tx
    .select()
    .from(mcpAppConfigApps)
    .where(eq(mcpAppConfigApps.appId, sourceAppId))
    .all();
  if (configs.length > 0) {
    tx.insert(mcpAppConfigApps)
      .values(configs.map((row) => ({ ...row, appId: newAppId })))
      .run();
  }
  const defaults = tx
    .select()
    .from(mcpServerDefaultApps)
    .where(eq(mcpServerDefaultApps.appId, sourceAppId))
    .all();
  if (defaults.length > 0) {
    tx.insert(mcpServerDefaultApps)
      .values(defaults.map((row) => ({ ...row, appId: newAppId })))
      .run();
  }
}
