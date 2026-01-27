/**
 * Plugin System IPC Client
 * Renderer-side API for plugin management
 */

import type { IpcRenderer } from "electron";

// =============================================================================
// TYPES (mirrored from plugin_system.ts)
// =============================================================================

export type PluginId = string & { __brand: "PluginId" };
export type PluginStatus = "installed" | "enabled" | "disabled" | "error" | "updating";
export type PluginCategory = "ai" | "ui" | "tools" | "integrations" | "themes" | "data" | "automation" | "other";
export type PluginTrust = "official" | "verified" | "community" | "local" | "unknown";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  authorUrl?: string;
  homepage?: string;
  repository?: string;
  license: string;
  category: PluginCategory;
  keywords: string[];
  minAppVersion?: string;
  maxAppVersion?: string;
  dependencies?: Record<string, string>;
  permissions?: PluginPermission[];
  main?: string;
  renderer?: string;
  preload?: string;
  styles?: string[];
  contributes?: PluginContributions;
  configuration?: PluginConfiguration[];
  icon?: string;
  screenshots?: string[];
  readme?: string;
}

export interface PluginPermission {
  name: string;
  description: string;
  required: boolean;
}

export interface PluginContributions {
  commands?: PluginCommand[];
  menus?: PluginMenu[];
  settings?: PluginSetting[];
  themes?: PluginTheme[];
  languages?: PluginLanguage[];
  snippets?: PluginSnippet[];
  views?: PluginView[];
  toolbarItems?: PluginToolbarItem[];
  contextMenus?: PluginContextMenu[];
  keybindings?: PluginKeybinding[];
  aiProviders?: PluginAIProvider[];
  mcpServers?: PluginMCPServer[];
}

export interface PluginCommand {
  command: string;
  title: string;
  category?: string;
  icon?: string;
  enablement?: string;
}

export interface PluginMenu {
  id: string;
  label: string;
  group?: string;
  when?: string;
  submenu?: PluginMenu[];
}

export interface PluginSetting {
  key: string;
  type: "string" | "number" | "boolean" | "array" | "object" | "enum";
  default: unknown;
  description: string;
  enum?: unknown[];
  enumDescriptions?: string[];
  scope?: "application" | "window" | "resource";
}

export interface PluginTheme {
  id: string;
  label: string;
  uiTheme: "dark" | "light" | "hc-dark" | "hc-light";
  path: string;
}

export interface PluginLanguage {
  id: string;
  aliases: string[];
  extensions: string[];
  filenames?: string[];
  configuration?: string;
}

export interface PluginSnippet {
  language: string;
  path: string;
}

export interface PluginView {
  id: string;
  name: string;
  group?: string;
  icon?: string;
  type?: "webview" | "tree" | "custom";
  when?: string;
}

export interface PluginToolbarItem {
  id: string;
  icon: string;
  tooltip: string;
  command: string;
  group?: string;
  when?: string;
}

export interface PluginContextMenu {
  id: string;
  label: string;
  command: string;
  context: string;
  when?: string;
  group?: string;
}

export interface PluginKeybinding {
  command: string;
  key: string;
  mac?: string;
  linux?: string;
  when?: string;
}

export interface PluginAIProvider {
  id: string;
  name: string;
  description: string;
  type: "local" | "cloud" | "hybrid";
  models?: string[];
}

export interface PluginMCPServer {
  id: string;
  name: string;
  description: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface PluginConfiguration {
  key: string;
  title: string;
  description?: string;
  properties: Record<string, PluginSetting>;
}

export interface InstalledPlugin {
  id: PluginId;
  manifest: PluginManifest;
  installPath: string;
  status: PluginStatus;
  trust: PluginTrust;
  installedAt: number;
  updatedAt: number;
  lastError?: string;
  configValues: Record<string, unknown>;
  permissions: string[];
}

export interface PluginRegistryEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  category: PluginCategory;
  trust: PluginTrust;
  downloads: number;
  rating: number;
  ratingCount: number;
  tags: string[];
  publishedAt: number;
  updatedAt: number;
  packageUrl: string;
  iconUrl?: string;
  verified: boolean;
}

export interface PluginSearchQuery {
  query?: string;
  category?: PluginCategory;
  trust?: PluginTrust[];
  sortBy?: "downloads" | "rating" | "updated" | "name";
  limit?: number;
  offset?: number;
}

export type PluginEventType = 
  | "plugin:installed"
  | "plugin:uninstalled"
  | "plugin:enabled"
  | "plugin:disabled"
  | "plugin:updated"
  | "plugin:error"
  | "plugin:config-changed"
  | "plugin:registry-updated"
  | "plugin:message"
  | "plugin:progress:start"
  | "plugin:progress:update"
  | "plugin:progress:end"
  | "plugin:statusbar:create"
  | "plugin:statusbar:update"
  | "plugin:statusbar:dispose";

export interface PluginEvent {
  type: PluginEventType;
  pluginId?: PluginId;
  data?: any;
}

// =============================================================================
// CLIENT
// =============================================================================

let ipcRenderer: IpcRenderer | null = null;

function getIpcRenderer(): IpcRenderer {
  if (!ipcRenderer) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ipcRenderer = (window as any).electron?.ipcRenderer;
    if (!ipcRenderer) {
      throw new Error("IPC Renderer not available");
    }
  }
  return ipcRenderer;
}

export const PluginSystemClient = {
  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  async initialize(): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("plugin:initialize");
  },

  async shutdown(): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("plugin:shutdown");
  },

  // ---------------------------------------------------------------------------
  // PLUGIN MANAGEMENT
  // ---------------------------------------------------------------------------

  async listPlugins(): Promise<InstalledPlugin[]> {
    return getIpcRenderer().invoke("plugin:list");
  },

  async getPlugin(id: PluginId): Promise<InstalledPlugin | null> {
    return getIpcRenderer().invoke("plugin:get", id);
  },

  async isPluginEnabled(id: PluginId): Promise<boolean> {
    return getIpcRenderer().invoke("plugin:is-enabled", id);
  },

  // ---------------------------------------------------------------------------
  // INSTALLATION
  // ---------------------------------------------------------------------------

  async installFromRegistry(pluginId: string): Promise<InstalledPlugin> {
    return getIpcRenderer().invoke("plugin:install-from-registry", pluginId);
  },

  async installFromUrl(url: string, trust?: PluginTrust): Promise<InstalledPlugin> {
    return getIpcRenderer().invoke("plugin:install-from-url", url, trust);
  },

  async installFromFile(filePath: string): Promise<InstalledPlugin> {
    return getIpcRenderer().invoke("plugin:install-from-file", filePath);
  },

  async uninstallPlugin(id: PluginId): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("plugin:uninstall", id);
  },

  async updatePlugin(id: PluginId): Promise<InstalledPlugin> {
    return getIpcRenderer().invoke("plugin:update", id);
  },

  // ---------------------------------------------------------------------------
  // LIFECYCLE
  // ---------------------------------------------------------------------------

  async enablePlugin(id: PluginId): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("plugin:enable", id);
  },

  async disablePlugin(id: PluginId): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("plugin:disable", id);
  },

  // ---------------------------------------------------------------------------
  // CONFIGURATION
  // ---------------------------------------------------------------------------

  async getPluginConfig(id: PluginId): Promise<Record<string, unknown> | null> {
    return getIpcRenderer().invoke("plugin:get-config", id);
  },

  async setPluginConfig(id: PluginId, key: string, value: unknown): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("plugin:set-config", id, key, value);
  },

  // ---------------------------------------------------------------------------
  // PERMISSIONS
  // ---------------------------------------------------------------------------

  async grantPermission(id: PluginId, permission: string): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("plugin:grant-permission", id, permission);
  },

  async revokePermission(id: PluginId, permission: string): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("plugin:revoke-permission", id, permission);
  },

  // ---------------------------------------------------------------------------
  // REGISTRY
  // ---------------------------------------------------------------------------

  async searchRegistry(query: PluginSearchQuery): Promise<PluginRegistryEntry[]> {
    return getIpcRenderer().invoke("plugin:search-registry", query);
  },

  async getRegistryPlugin(id: string): Promise<PluginRegistryEntry | null> {
    return getIpcRenderer().invoke("plugin:get-registry-plugin", id);
  },

  // ---------------------------------------------------------------------------
  // EVENTS
  // ---------------------------------------------------------------------------

  async subscribe(): Promise<{ success: boolean }> {
    return getIpcRenderer().invoke("plugin:subscribe");
  },

  onEvent(callback: (event: PluginEvent) => void): () => void {
    const handler = (_: unknown, event: PluginEvent) => callback(event);
    getIpcRenderer().on("plugin:event" as any, handler);
    return () => {
      getIpcRenderer().removeListener("plugin:event" as any, handler);
    };
  },
};

export default PluginSystemClient;
