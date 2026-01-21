/**
 * Plugin System Entry Point
 *
 * This module exports the plugin system API and registers all built-in plugins.
 */

// Export core types
export * from "./types";

// Export registry
export * from "./registry";

// Export built-in plugins
export { supabasePlugin, SUPABASE_PLUGIN_ID } from "./supabase";

// ─────────────────────────────────────────────────────────────────────
// Plugin System Initialization
// ─────────────────────────────────────────────────────────────────────

import { registerPlugin, initializeAllPlugins } from "./registry";
import { supabasePlugin } from "./supabase";

/**
 * Built-in plugins that are registered by default.
 * Add new built-in plugins here.
 */
const BUILTIN_PLUGINS = [supabasePlugin];

/**
 * Register all built-in plugins.
 * Call this during app initialization.
 */
export function registerBuiltinPlugins(): void {
  for (const plugin of BUILTIN_PLUGINS) {
    registerPlugin(plugin);
  }
}

/**
 * Initialize the plugin system.
 * Registers all built-in plugins and initializes them.
 */
export async function initializePluginSystem(): Promise<void> {
  registerBuiltinPlugins();
  await initializeAllPlugins();
}
