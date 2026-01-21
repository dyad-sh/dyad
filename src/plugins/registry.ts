/**
 * Plugin Registry
 *
 * Central registry for managing plugins. Handles plugin loading, registration,
 * and provides a unified API for accessing plugin capabilities.
 */

import log from "electron-log";
import type {
  PluginDefinition,
  PluginId,
  PluginMetadata,
  PluginCapabilities,
  PluginCategory,
  DatabaseCapability,
  OAuthCapability,
  FunctionsCapability,
  AgentContextCapability,
  AgentToolsCapability,
  PromptsCapability,
  PluginIpcHandler,
} from "./types";

const logger = log.scope("plugin_registry");

// ─────────────────────────────────────────────────────────────────────
// Plugin Registry State
// ─────────────────────────────────────────────────────────────────────

interface RegisteredPlugin {
  definition: PluginDefinition;
  enabled: boolean;
  loadedAt: Date;
}

/** Map of plugin ID to registered plugin */
const plugins = new Map<PluginId, RegisteredPlugin>();

/** Plugins that have been loaded and initialized */
const initializedPlugins = new Set<PluginId>();

// ─────────────────────────────────────────────────────────────────────
// Plugin Registration
// ─────────────────────────────────────────────────────────────────────

/**
 * Register a plugin with the registry.
 * Does not initialize the plugin - call initializePlugin() separately.
 */
export function registerPlugin(definition: PluginDefinition): void {
  const { id } = definition.metadata;

  if (plugins.has(id)) {
    logger.warn(`Plugin '${id}' is already registered, skipping.`);
    return;
  }

  plugins.set(id, {
    definition,
    enabled: definition.metadata.enabledByDefault ?? true,
    loadedAt: new Date(),
  });

  logger.info(`Registered plugin: ${id} (${definition.metadata.displayName})`);
}

/**
 * Unregister a plugin from the registry.
 */
export async function unregisterPlugin(pluginId: PluginId): Promise<void> {
  const plugin = plugins.get(pluginId);
  if (!plugin) {
    logger.warn(`Plugin '${pluginId}' is not registered.`);
    return;
  }

  // Call unload lifecycle hook if plugin was initialized
  if (initializedPlugins.has(pluginId)) {
    await plugin.definition.lifecycle?.onUnload?.();
    initializedPlugins.delete(pluginId);
  }

  plugins.delete(pluginId);
  logger.info(`Unregistered plugin: ${pluginId}`);
}

/**
 * Initialize a plugin (call onLoad lifecycle hook).
 */
export async function initializePlugin(pluginId: PluginId): Promise<void> {
  const plugin = plugins.get(pluginId);
  if (!plugin) {
    throw new Error(`Plugin '${pluginId}' is not registered.`);
  }

  if (initializedPlugins.has(pluginId)) {
    logger.warn(`Plugin '${pluginId}' is already initialized.`);
    return;
  }

  await plugin.definition.lifecycle?.onLoad?.();
  initializedPlugins.add(pluginId);
  logger.info(`Initialized plugin: ${pluginId}`);
}

/**
 * Initialize all registered plugins.
 */
export async function initializeAllPlugins(): Promise<void> {
  for (const [pluginId, plugin] of plugins) {
    if (plugin.enabled && !initializedPlugins.has(pluginId)) {
      try {
        await initializePlugin(pluginId);
      } catch (error) {
        logger.error(`Failed to initialize plugin '${pluginId}':`, error);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Plugin Queries
// ─────────────────────────────────────────────────────────────────────

/**
 * Get a plugin by ID.
 */
export function getPlugin(pluginId: PluginId): PluginDefinition | undefined {
  return plugins.get(pluginId)?.definition;
}

/**
 * Get all registered plugins.
 */
export function getAllPlugins(): PluginDefinition[] {
  return Array.from(plugins.values()).map((p) => p.definition);
}

/**
 * Get all enabled plugins.
 */
export function getEnabledPlugins(): PluginDefinition[] {
  return Array.from(plugins.values())
    .filter((p) => p.enabled)
    .map((p) => p.definition);
}

/**
 * Get plugin metadata by ID.
 */
export function getPluginMetadata(
  pluginId: PluginId,
): PluginMetadata | undefined {
  return plugins.get(pluginId)?.definition.metadata;
}

/**
 * Get all plugins by category.
 */
export function getPluginsByCategory(
  category: PluginCategory,
): PluginDefinition[] {
  return getAllPlugins().filter((p) => p.metadata.category === category);
}

/**
 * Check if a plugin is enabled.
 */
export function isPluginEnabled(pluginId: PluginId): boolean {
  return plugins.get(pluginId)?.enabled ?? false;
}

/**
 * Enable a plugin.
 */
export function enablePlugin(pluginId: PluginId): void {
  const plugin = plugins.get(pluginId);
  if (plugin) {
    plugin.enabled = true;
    logger.info(`Enabled plugin: ${pluginId}`);
  }
}

/**
 * Disable a plugin.
 */
export function disablePlugin(pluginId: PluginId): void {
  const plugin = plugins.get(pluginId);
  if (plugin) {
    plugin.enabled = false;
    logger.info(`Disabled plugin: ${pluginId}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Capability Queries
// ─────────────────────────────────────────────────────────────────────

/**
 * Get all plugins with a specific capability.
 */
export function getPluginsWithCapability<K extends keyof PluginCapabilities>(
  capability: K,
): Array<{ pluginId: PluginId; capability: NonNullable<PluginCapabilities[K]> }> {
  const result: Array<{
    pluginId: PluginId;
    capability: NonNullable<PluginCapabilities[K]>;
  }> = [];

  for (const [pluginId, plugin] of plugins) {
    if (plugin.enabled) {
      const cap = plugin.definition.capabilities[capability];
      if (cap) {
        result.push({
          pluginId,
          capability: cap as NonNullable<PluginCapabilities[K]>,
        });
      }
    }
  }

  return result;
}

/**
 * Get a specific capability from a plugin.
 */
export function getCapability<K extends keyof PluginCapabilities>(
  pluginId: PluginId,
  capability: K,
): PluginCapabilities[K] | undefined {
  const plugin = plugins.get(pluginId);
  if (!plugin?.enabled) return undefined;
  return plugin.definition.capabilities[capability];
}

/**
 * Get the database capability for a plugin.
 */
export function getDatabaseCapability(
  pluginId: PluginId,
): DatabaseCapability | undefined {
  return getCapability(pluginId, "database");
}

/**
 * Get the OAuth capability for a plugin.
 */
export function getOAuthCapability(
  pluginId: PluginId,
): OAuthCapability | undefined {
  return getCapability(pluginId, "oauth");
}

/**
 * Get the functions capability for a plugin.
 */
export function getFunctionsCapability(
  pluginId: PluginId,
): FunctionsCapability | undefined {
  return getCapability(pluginId, "functions");
}

/**
 * Get the agent context capability for a plugin.
 */
export function getAgentContextCapability(
  pluginId: PluginId,
): AgentContextCapability | undefined {
  return getCapability(pluginId, "agentContext");
}

/**
 * Get the agent tools capability for a plugin.
 */
export function getAgentToolsCapability(
  pluginId: PluginId,
): AgentToolsCapability | undefined {
  return getCapability(pluginId, "agentTools");
}

/**
 * Get the prompts capability for a plugin.
 */
export function getPromptsCapability(
  pluginId: PluginId,
): PromptsCapability | undefined {
  return getCapability(pluginId, "prompts");
}

// ─────────────────────────────────────────────────────────────────────
// IPC Handler Registration
// ─────────────────────────────────────────────────────────────────────

/**
 * Get all IPC handlers from all enabled plugins.
 * Handler channels are prefixed with the plugin ID.
 */
export function getAllPluginIpcHandlers(): Array<
  PluginIpcHandler & { pluginId: PluginId; fullChannel: string }
> {
  const handlers: Array<
    PluginIpcHandler & { pluginId: PluginId; fullChannel: string }
  > = [];

  for (const [pluginId, plugin] of plugins) {
    if (plugin.enabled && plugin.definition.ipcHandlers) {
      for (const handler of plugin.definition.ipcHandlers) {
        handlers.push({
          ...handler,
          pluginId,
          fullChannel: `${pluginId}:${handler.channel}`,
        });
      }
    }
  }

  return handlers;
}

// ─────────────────────────────────────────────────────────────────────
// Lifecycle Events
// ─────────────────────────────────────────────────────────────────────

/**
 * Notify all plugins that the app has started.
 */
export async function notifyAppStart(): Promise<void> {
  for (const [pluginId, plugin] of plugins) {
    if (plugin.enabled && initializedPlugins.has(pluginId)) {
      try {
        await plugin.definition.lifecycle?.onAppStart?.();
      } catch (error) {
        logger.error(`Plugin '${pluginId}' onAppStart failed:`, error);
      }
    }
  }
}

/**
 * Notify all plugins that an app was selected.
 */
export async function notifyAppSelected(appId: number): Promise<void> {
  for (const [pluginId, plugin] of plugins) {
    if (plugin.enabled && initializedPlugins.has(pluginId)) {
      try {
        await plugin.definition.lifecycle?.onAppSelected?.(appId);
      } catch (error) {
        logger.error(`Plugin '${pluginId}' onAppSelected failed:`, error);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Agent Integration
// ─────────────────────────────────────────────────────────────────────

/**
 * Get all agent tool definitions from all enabled plugins.
 */
export function getAllAgentToolDefinitions() {
  const tools: Array<{
    pluginId: PluginId;
    tool: ReturnType<AgentToolsCapability["getToolDefinitions"]>[0];
  }> = [];

  const pluginsWithTools = getPluginsWithCapability("agentTools");
  for (const { pluginId, capability } of pluginsWithTools) {
    const toolDefs = capability.getToolDefinitions();
    for (const tool of toolDefs) {
      tools.push({ pluginId, tool });
    }
  }

  return tools;
}

/**
 * Get combined system prompt from all enabled plugins.
 */
export async function getCombinedSystemPrompt(params: {
  projectId?: string;
  accountId?: string;
}): Promise<string> {
  const prompts: string[] = [];

  const pluginsWithPrompts = getPluginsWithCapability("prompts");
  for (const { capability } of pluginsWithPrompts) {
    try {
      const prompt = await capability.getSystemPrompt(params);
      if (prompt) {
        prompts.push(prompt);
      }
    } catch (error) {
      logger.error("Failed to get system prompt:", error);
    }
  }

  return prompts.join("\n\n");
}
