/**
 * Plugin System
 * Plugin runtime, installation, management, and hot-reload for JoyCreate
 */

import { app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { EventEmitter } from "node:events";

// =============================================================================
// TYPES
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
  
  // Requirements
  minAppVersion?: string;
  maxAppVersion?: string;
  dependencies?: Record<string, string>; // plugin-id -> version
  permissions?: PluginPermission[];
  
  // Entry points
  main?: string; // Main process entry
  renderer?: string; // Renderer process entry
  preload?: string; // Preload script
  styles?: string[]; // CSS files
  
  // Extension points
  contributes?: PluginContributions;
  
  // Configuration
  configuration?: PluginConfiguration[];
  
  // Assets
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
  context: string; // e.g., "editor", "explorer", "chat"
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
  permissions: string[]; // Granted permissions
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

export interface PluginRuntime {
  id: PluginId;
  manifest: PluginManifest;
  api: PluginAPI;
  dispose: () => Promise<void>;
}

export interface PluginAPI {
  // Commands
  registerCommand(command: string, handler: (...args: any[]) => any): () => void;
  executeCommand(command: string, ...args: any[]): Promise<any>;
  
  // Settings
  getConfig<T>(key: string): T | undefined;
  setConfig<T>(key: string, value: T): void;
  onConfigChange(callback: (key: string, value: any) => void): () => void;
  
  // UI
  showMessage(message: string, type?: "info" | "warning" | "error"): void;
  showProgress(title: string, handler: (progress: (percent: number) => void) => Promise<void>): Promise<void>;
  createStatusBarItem(options: { text: string; tooltip?: string; command?: string }): { update: (text: string) => void; dispose: () => void };
  
  // Storage
  getStorageValue<T>(key: string): Promise<T | undefined>;
  setStorageValue<T>(key: string, value: T): Promise<void>;
  
  // Events
  on(event: string, handler: (...args: any[]) => void): () => void;
  emit(event: string, ...args: any[]): void;
  
  // Logging
  log: {
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
    debug: (...args: any[]) => void;
  };
}

// =============================================================================
// PLUGIN SYSTEM
// =============================================================================

export class PluginSystem extends EventEmitter {
  private db: Database.Database | null = null;
  private pluginsDir: string;
  private registryUrl: string;
  private installedPlugins: Map<PluginId, InstalledPlugin> = new Map();
  private runningPlugins: Map<PluginId, PluginRuntime> = new Map();
  private commands: Map<string, { pluginId: PluginId; handler: (...args: any[]) => any }> = new Map();
  private isInitialized = false;

  constructor() {
    super();
    this.pluginsDir = path.join(app.getPath("userData"), "plugins");
    this.registryUrl = "https://plugins.joycreate.io/api"; // Plugin registry API
  }

  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Ensure plugins directory exists
    await fs.mkdir(this.pluginsDir, { recursive: true });

    // Initialize database
    const dbPath = path.join(this.pluginsDir, "plugins.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initializeSchema();

    // Load installed plugins
    await this.loadInstalledPlugins();

    // Auto-enable installed plugins
    for (const plugin of this.installedPlugins.values()) {
      if (plugin.status === "enabled") {
        try {
          await this.enablePlugin(plugin.id);
        } catch (error) {
          console.error(`Failed to enable plugin ${plugin.id}:`, error);
          this.updatePluginStatus(plugin.id, "error", String(error));
        }
      }
    }

    this.isInitialized = true;
  }

  private initializeSchema(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY,
        manifest TEXT NOT NULL,
        install_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'installed',
        trust TEXT NOT NULL DEFAULT 'unknown',
        installed_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_error TEXT,
        config_values TEXT DEFAULT '{}',
        permissions TEXT DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS plugin_storage (
        plugin_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (plugin_id, key),
        FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS registry_cache (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        cached_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_plugin_status ON plugins(status);
      CREATE INDEX IF NOT EXISTS idx_plugin_trust ON plugins(trust);
    `);
  }

  async shutdown(): Promise<void> {
    // Disable all running plugins
    for (const [id, runtime] of this.runningPlugins) {
      try {
        await runtime.dispose();
      } catch (error) {
        console.error(`Error disposing plugin ${id}:`, error);
      }
    }
    this.runningPlugins.clear();

    if (this.db) {
      this.db.close();
      this.db = null;
    }

    this.isInitialized = false;
  }

  // ---------------------------------------------------------------------------
  // PLUGIN INSTALLATION
  // ---------------------------------------------------------------------------

  async installFromRegistry(pluginId: string): Promise<InstalledPlugin> {
    // Fetch plugin info from registry
    const response = await fetch(`${this.registryUrl}/plugins/${pluginId}`);
    if (!response.ok) {
      throw new Error(`Plugin not found in registry: ${pluginId}`);
    }
    const registryEntry = await response.json() as PluginRegistryEntry;

    // Download and install
    return this.installFromUrl(registryEntry.packageUrl, registryEntry.trust);
  }

  async installFromUrl(url: string, trust: PluginTrust = "unknown"): Promise<InstalledPlugin> {
    // Download plugin package
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download plugin: ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    return this.installFromBuffer(buffer, trust);
  }

  async installFromFile(filePath: string, trust: PluginTrust = "local"): Promise<InstalledPlugin> {
    const buffer = await fs.readFile(filePath);
    return this.installFromBuffer(buffer, trust);
  }

  async installFromBuffer(buffer: Buffer, trust: PluginTrust = "unknown"): Promise<InstalledPlugin> {
    // Extract and validate package
    const tempDir = path.join(this.pluginsDir, ".temp", randomUUID());
    await fs.mkdir(tempDir, { recursive: true });

    try {
      // Assume zip format, extract
      const AdmZip = (await import("adm-zip")).default;
      const zip = new AdmZip(buffer);
      zip.extractAllTo(tempDir, true);

      // Read manifest
      const manifestPath = path.join(tempDir, "plugin.json");
      const manifestContent = await fs.readFile(manifestPath, "utf-8");
      const manifest = JSON.parse(manifestContent) as PluginManifest;

      // Validate manifest
      this.validateManifest(manifest);

      // Check if already installed
      const existingPlugin = this.installedPlugins.get(manifest.id as PluginId);
      if (existingPlugin) {
        // Update existing plugin
        await this.uninstallPlugin(existingPlugin.id);
      }

      // Move to final location
      const installPath = path.join(this.pluginsDir, manifest.id);
      await fs.rm(installPath, { recursive: true, force: true });
      await fs.rename(tempDir, installPath);

      // Register plugin
      const plugin: InstalledPlugin = {
        id: manifest.id as PluginId,
        manifest,
        installPath,
        status: "installed",
        trust,
        installedAt: Date.now(),
        updatedAt: Date.now(),
        configValues: this.getDefaultConfig(manifest),
        permissions: [],
      };

      this.savePlugin(plugin);
      this.installedPlugins.set(plugin.id, plugin);

      this.emitEvent("plugin:installed", plugin.id, { manifest });

      return plugin;
    } finally {
      // Cleanup temp directory
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private validateManifest(manifest: PluginManifest): void {
    if (!manifest.id) throw new Error("Plugin manifest missing 'id'");
    if (!manifest.name) throw new Error("Plugin manifest missing 'name'");
    if (!manifest.version) throw new Error("Plugin manifest missing 'version'");
    if (!manifest.description) throw new Error("Plugin manifest missing 'description'");
    if (!manifest.author) throw new Error("Plugin manifest missing 'author'");
    if (!manifest.license) throw new Error("Plugin manifest missing 'license'");

    // Validate ID format
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(manifest.id)) {
      throw new Error("Invalid plugin ID format. Use lowercase letters, numbers, and hyphens.");
    }

    // Validate version format
    if (!/^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/.test(manifest.version)) {
      throw new Error("Invalid version format. Use semver (e.g., 1.0.0)");
    }
  }

  private getDefaultConfig(manifest: PluginManifest): Record<string, unknown> {
    const defaults: Record<string, unknown> = {};

    if (manifest.configuration) {
      for (const config of manifest.configuration) {
        for (const [key, setting] of Object.entries(config.properties)) {
          defaults[`${config.key}.${key}`] = setting.default;
        }
      }
    }

    if (manifest.contributes?.settings) {
      for (const setting of manifest.contributes.settings) {
        defaults[setting.key] = setting.default;
      }
    }

    return defaults;
  }

  // ---------------------------------------------------------------------------
  // PLUGIN LIFECYCLE
  // ---------------------------------------------------------------------------

  async enablePlugin(id: PluginId): Promise<void> {
    const plugin = this.installedPlugins.get(id);
    if (!plugin) throw new Error(`Plugin not found: ${id}`);
    if (this.runningPlugins.has(id)) return; // Already running

    // Check permissions
    const requiredPermissions = plugin.manifest.permissions?.filter((p) => p.required) || [];
    const grantedPermissions = new Set(plugin.permissions);
    for (const perm of requiredPermissions) {
      if (!grantedPermissions.has(perm.name)) {
        throw new Error(`Plugin requires permission: ${perm.name}`);
      }
    }

    // Create plugin API
    const api = this.createPluginAPI(id);

    // Load plugin main module
    let dispose: () => Promise<void> = async () => {};

    if (plugin.manifest.main) {
      const mainPath = path.join(plugin.installPath, plugin.manifest.main);
      try {
        // Dynamic import of plugin
        const pluginModule = require(mainPath);
        
        if (typeof pluginModule.activate === "function") {
          const result = await pluginModule.activate(api);
          if (typeof result?.dispose === "function") {
            dispose = result.dispose;
          }
        }
      } catch (error) {
        throw new Error(`Failed to load plugin: ${error}`);
      }
    }

    // Register contributions
    this.registerContributions(id, plugin.manifest.contributes);

    // Store runtime
    const runtime: PluginRuntime = {
      id,
      manifest: plugin.manifest,
      api,
      dispose: async () => {
        await dispose();
        this.unregisterContributions(id);
      },
    };
    this.runningPlugins.set(id, runtime);

    // Update status
    this.updatePluginStatus(id, "enabled");
    this.emitEvent("plugin:enabled", id);
  }

  async disablePlugin(id: PluginId): Promise<void> {
    const runtime = this.runningPlugins.get(id);
    if (!runtime) return;

    await runtime.dispose();
    this.runningPlugins.delete(id);

    this.updatePluginStatus(id, "disabled");
    this.emitEvent("plugin:disabled", id);
  }

  async uninstallPlugin(id: PluginId): Promise<void> {
    // Disable first if running
    if (this.runningPlugins.has(id)) {
      await this.disablePlugin(id);
    }

    const plugin = this.installedPlugins.get(id);
    if (!plugin) return;

    // Remove files
    await fs.rm(plugin.installPath, { recursive: true, force: true });

    // Remove from database
    if (this.db) {
      this.db.prepare("DELETE FROM plugins WHERE id = ?").run(id);
      this.db.prepare("DELETE FROM plugin_storage WHERE plugin_id = ?").run(id);
    }

    this.installedPlugins.delete(id);
    this.emitEvent("plugin:uninstalled", id);
  }

  async updatePlugin(id: PluginId): Promise<InstalledPlugin> {
    const plugin = this.installedPlugins.get(id);
    if (!plugin) throw new Error(`Plugin not found: ${id}`);

    this.updatePluginStatus(id, "updating");

    try {
      // Re-fetch from registry
      const newPlugin = await this.installFromRegistry(plugin.manifest.id);
      
      // Restore config and permissions
      newPlugin.configValues = { ...plugin.configValues };
      newPlugin.permissions = [...plugin.permissions];
      this.savePlugin(newPlugin);

      // Re-enable if was running
      const wasRunning = this.runningPlugins.has(id);
      if (wasRunning) {
        await this.enablePlugin(newPlugin.id);
      }

      this.emitEvent("plugin:updated", id, { 
        oldVersion: plugin.manifest.version,
        newVersion: newPlugin.manifest.version,
      });

      return newPlugin;
    } catch (error) {
      this.updatePluginStatus(id, "error", String(error));
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // PLUGIN API
  // ---------------------------------------------------------------------------

  private createPluginAPI(pluginId: PluginId): PluginAPI {
    const plugin = this.installedPlugins.get(pluginId)!;
    const eventHandlers: Map<string, Set<(...args: any[]) => void>> = new Map();

    return {
      // Commands
      registerCommand: (command: string, handler: (...args: any[]) => any) => {
        const fullCommand = `${pluginId}.${command}`;
        this.commands.set(fullCommand, { pluginId, handler });
        return () => this.commands.delete(fullCommand);
      },

      executeCommand: async (command: string, ...args: any[]) => {
        const cmd = this.commands.get(command);
        if (!cmd) throw new Error(`Command not found: ${command}`);
        return cmd.handler(...args);
      },

      // Settings
      getConfig: <T>(key: string) => plugin.configValues[key] as T | undefined,

      setConfig: <T>(key: string, value: T) => {
        plugin.configValues[key] = value;
        this.savePlugin(plugin);
        this.emitEvent("plugin:config-changed", pluginId, { key, value });
      },

      onConfigChange: (callback: (key: string, value: any) => void) => {
        const handler = (event: PluginEvent) => {
          if (event.type === "plugin:config-changed" && event.pluginId === pluginId) {
            callback(event.data.key, event.data.value);
          }
        };
        this.on("plugin:event", handler as any);
        return () => this.off("plugin:event", handler as any);
      },

      // UI
      showMessage: (message: string, type = "info") => {
        // Emit to renderer for UI display
        this.emitEvent("plugin:message", pluginId, { message, type });
      },

      showProgress: async (title: string, handler: (progress: (percent: number) => void) => Promise<void>) => {
        const progressId = randomUUID();
        this.emitEvent("plugin:progress:start", pluginId, { progressId, title });
        try {
          await handler((percent: number) => {
            this.emitEvent("plugin:progress:update", pluginId, { progressId, percent });
          });
        } finally {
          this.emitEvent("plugin:progress:end", pluginId, { progressId });
        }
      },

      createStatusBarItem: (options) => {
        const itemId = randomUUID();
        this.emitEvent("plugin:statusbar:create", pluginId, { itemId, ...options });
        return {
          update: (text: string) => {
            this.emitEvent("plugin:statusbar:update", pluginId, { itemId, text });
          },
          dispose: () => {
            this.emitEvent("plugin:statusbar:dispose", pluginId, { itemId });
          },
        };
      },

      // Storage
      getStorageValue: async <T>(key: string) => {
        if (!this.db) return undefined;
        const row = this.db.prepare(
          "SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?"
        ).get(pluginId, key) as { value: string } | undefined;
        return row ? JSON.parse(row.value) as T : undefined;
      },

      setStorageValue: async <T>(key: string, value: T) => {
        if (!this.db) return;
        this.db.prepare(`
          INSERT OR REPLACE INTO plugin_storage (plugin_id, key, value)
          VALUES (?, ?, ?)
        `).run(pluginId, key, JSON.stringify(value));
      },

      // Events
      on: (event: string, handler: (...args: any[]) => void) => {
        if (!eventHandlers.has(event)) {
          eventHandlers.set(event, new Set());
        }
        eventHandlers.get(event)!.add(handler);
        return () => eventHandlers.get(event)?.delete(handler);
      },

      emit: (event: string, ...args: any[]) => {
        eventHandlers.get(event)?.forEach((handler) => handler(...args));
      },

      // Logging
      log: {
        info: (...args: any[]) => console.log(`[${pluginId}]`, ...args),
        warn: (...args: any[]) => console.warn(`[${pluginId}]`, ...args),
        error: (...args: any[]) => console.error(`[${pluginId}]`, ...args),
        debug: (...args: any[]) => console.debug(`[${pluginId}]`, ...args),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // CONTRIBUTIONS
  // ---------------------------------------------------------------------------

  private registerContributions(pluginId: PluginId, contributions?: PluginContributions): void {
    if (!contributions) return;

    // Register commands
    if (contributions.commands) {
      for (const cmd of contributions.commands) {
        const fullCommand = cmd.command.includes(".") ? cmd.command : `${pluginId}.${cmd.command}`;
        // Commands are registered by plugin's activate function
        // Here we just track metadata
      }
    }

    // TODO: Register other contributions (menus, themes, views, etc.)
    // These would integrate with the app's UI system
  }

  private unregisterContributions(pluginId: PluginId): void {
    // Remove all commands registered by this plugin
    for (const [command, info] of this.commands) {
      if (info.pluginId === pluginId) {
        this.commands.delete(command);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // QUERIES
  // ---------------------------------------------------------------------------

  getInstalledPlugins(): InstalledPlugin[] {
    return Array.from(this.installedPlugins.values());
  }

  getPlugin(id: PluginId): InstalledPlugin | null {
    return this.installedPlugins.get(id) || null;
  }

  isPluginEnabled(id: PluginId): boolean {
    return this.runningPlugins.has(id);
  }

  getPluginConfig(id: PluginId): Record<string, unknown> | null {
    return this.installedPlugins.get(id)?.configValues || null;
  }

  async setPluginConfig(id: PluginId, key: string, value: unknown): Promise<void> {
    const plugin = this.installedPlugins.get(id);
    if (!plugin) throw new Error(`Plugin not found: ${id}`);

    plugin.configValues[key] = value;
    this.savePlugin(plugin);

    // Notify running plugin
    const runtime = this.runningPlugins.get(id);
    if (runtime) {
      this.emitEvent("plugin:config-changed", id, { key, value });
    }
  }

  async grantPermission(id: PluginId, permission: string): Promise<void> {
    const plugin = this.installedPlugins.get(id);
    if (!plugin) throw new Error(`Plugin not found: ${id}`);

    if (!plugin.permissions.includes(permission)) {
      plugin.permissions.push(permission);
      this.savePlugin(plugin);
    }
  }

  async revokePermission(id: PluginId, permission: string): Promise<void> {
    const plugin = this.installedPlugins.get(id);
    if (!plugin) throw new Error(`Plugin not found: ${id}`);

    const index = plugin.permissions.indexOf(permission);
    if (index >= 0) {
      plugin.permissions.splice(index, 1);
      this.savePlugin(plugin);
    }
  }

  // ---------------------------------------------------------------------------
  // REGISTRY
  // ---------------------------------------------------------------------------

  async searchRegistry(query: PluginSearchQuery): Promise<PluginRegistryEntry[]> {
    const params = new URLSearchParams();
    if (query.query) params.set("q", query.query);
    if (query.category) params.set("category", query.category);
    if (query.trust) params.set("trust", query.trust.join(","));
    if (query.sortBy) params.set("sort", query.sortBy);
    if (query.limit) params.set("limit", String(query.limit));
    if (query.offset) params.set("offset", String(query.offset));

    try {
      const response = await fetch(`${this.registryUrl}/plugins?${params}`);
      if (!response.ok) {
        throw new Error(`Registry error: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      // Return cached results if offline
      return this.getCachedRegistryResults(query);
    }
  }

  async getRegistryPlugin(id: string): Promise<PluginRegistryEntry | null> {
    try {
      const response = await fetch(`${this.registryUrl}/plugins/${id}`);
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  private getCachedRegistryResults(query: PluginSearchQuery): PluginRegistryEntry[] {
    // Return empty for now - could implement caching
    return [];
  }

  // ---------------------------------------------------------------------------
  // PERSISTENCE
  // ---------------------------------------------------------------------------

  private async loadInstalledPlugins(): Promise<void> {
    if (!this.db) return;

    const rows = this.db.prepare("SELECT * FROM plugins").all() as any[];
    for (const row of rows) {
      const plugin: InstalledPlugin = {
        id: row.id as PluginId,
        manifest: JSON.parse(row.manifest),
        installPath: row.install_path,
        status: row.status,
        trust: row.trust,
        installedAt: row.installed_at,
        updatedAt: row.updated_at,
        lastError: row.last_error,
        configValues: JSON.parse(row.config_values),
        permissions: JSON.parse(row.permissions),
      };
      this.installedPlugins.set(plugin.id, plugin);
    }
  }

  private savePlugin(plugin: InstalledPlugin): void {
    if (!this.db) return;

    this.db.prepare(`
      INSERT OR REPLACE INTO plugins 
      (id, manifest, install_path, status, trust, installed_at, updated_at, last_error, config_values, permissions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      plugin.id,
      JSON.stringify(plugin.manifest),
      plugin.installPath,
      plugin.status,
      plugin.trust,
      plugin.installedAt,
      plugin.updatedAt,
      plugin.lastError || null,
      JSON.stringify(plugin.configValues),
      JSON.stringify(plugin.permissions)
    );
  }

  private updatePluginStatus(id: PluginId, status: PluginStatus, error?: string): void {
    const plugin = this.installedPlugins.get(id);
    if (!plugin) return;

    plugin.status = status;
    plugin.lastError = error;
    plugin.updatedAt = Date.now();
    this.savePlugin(plugin);
  }

  // ---------------------------------------------------------------------------
  // EVENTS
  // ---------------------------------------------------------------------------

  private emitEvent(type: PluginEventType, pluginId?: PluginId, data?: any): void {
    const event: PluginEvent = { type, pluginId, data };
    this.emit("plugin:event", event);
  }

  subscribe(callback: (event: PluginEvent) => void): () => void {
    this.on("plugin:event", callback);
    return () => this.off("plugin:event", callback);
  }
}

// Global instance
let pluginSystem: PluginSystem | null = null;

export function getPluginSystem(): PluginSystem {
  if (!pluginSystem) {
    pluginSystem = new PluginSystem();
  }
  return pluginSystem;
}
