/**
 * Plugin System IPC Handlers
 * Handles IPC communication for the plugin marketplace and management
 */

import { ipcMain, BrowserWindow } from "electron";
import { getPluginSystem } from "@/lib/plugin_system";
import type {
  PluginId,
  PluginSearchQuery,
  PluginTrust,
  PluginEvent,
} from "@/lib/plugin_system";

export function registerPluginHandlers(): void {
  const pluginSystem = getPluginSystem();
  let subscribedWindow: BrowserWindow | null = null;

  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  ipcMain.handle("plugin:initialize", async () => {
    await pluginSystem.initialize();
    return { success: true };
  });

  ipcMain.handle("plugin:shutdown", async () => {
    await pluginSystem.shutdown();
    return { success: true };
  });

  // ---------------------------------------------------------------------------
  // PLUGIN MANAGEMENT
  // ---------------------------------------------------------------------------

  ipcMain.handle("plugin:list", async () => {
    return pluginSystem.getInstalledPlugins();
  });

  ipcMain.handle("plugin:get", async (_, id: PluginId) => {
    return pluginSystem.getPlugin(id);
  });

  ipcMain.handle("plugin:is-enabled", async (_, id: PluginId) => {
    return pluginSystem.isPluginEnabled(id);
  });

  // ---------------------------------------------------------------------------
  // INSTALLATION
  // ---------------------------------------------------------------------------

  ipcMain.handle("plugin:install-from-registry", async (_, pluginId: string) => {
    return pluginSystem.installFromRegistry(pluginId);
  });

  ipcMain.handle("plugin:install-from-url", async (_, url: string, trust?: PluginTrust) => {
    return pluginSystem.installFromUrl(url, trust);
  });

  ipcMain.handle("plugin:install-from-file", async (_, filePath: string) => {
    return pluginSystem.installFromFile(filePath, "local");
  });

  ipcMain.handle("plugin:uninstall", async (_, id: PluginId) => {
    await pluginSystem.uninstallPlugin(id);
    return { success: true };
  });

  ipcMain.handle("plugin:update", async (_, id: PluginId) => {
    return pluginSystem.updatePlugin(id);
  });

  // ---------------------------------------------------------------------------
  // LIFECYCLE
  // ---------------------------------------------------------------------------

  ipcMain.handle("plugin:enable", async (_, id: PluginId) => {
    await pluginSystem.enablePlugin(id);
    return { success: true };
  });

  ipcMain.handle("plugin:disable", async (_, id: PluginId) => {
    await pluginSystem.disablePlugin(id);
    return { success: true };
  });

  // ---------------------------------------------------------------------------
  // CONFIGURATION
  // ---------------------------------------------------------------------------

  ipcMain.handle("plugin:get-config", async (_, id: PluginId) => {
    return pluginSystem.getPluginConfig(id);
  });

  ipcMain.handle("plugin:set-config", async (_, id: PluginId, key: string, value: unknown) => {
    await pluginSystem.setPluginConfig(id, key, value);
    return { success: true };
  });

  // ---------------------------------------------------------------------------
  // PERMISSIONS
  // ---------------------------------------------------------------------------

  ipcMain.handle("plugin:grant-permission", async (_, id: PluginId, permission: string) => {
    await pluginSystem.grantPermission(id, permission);
    return { success: true };
  });

  ipcMain.handle("plugin:revoke-permission", async (_, id: PluginId, permission: string) => {
    await pluginSystem.revokePermission(id, permission);
    return { success: true };
  });

  // ---------------------------------------------------------------------------
  // REGISTRY
  // ---------------------------------------------------------------------------

  ipcMain.handle("plugin:search-registry", async (_, query: PluginSearchQuery) => {
    return pluginSystem.searchRegistry(query);
  });

  ipcMain.handle("plugin:get-registry-plugin", async (_, id: string) => {
    return pluginSystem.getRegistryPlugin(id);
  });

  // ---------------------------------------------------------------------------
  // EVENTS
  // ---------------------------------------------------------------------------

  ipcMain.handle("plugin:subscribe", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return { success: false };

    subscribedWindow = window;

    const unsubscribe = pluginSystem.subscribe((pluginEvent: PluginEvent) => {
      if (subscribedWindow && !subscribedWindow.isDestroyed()) {
        subscribedWindow.webContents.send("plugin:event", pluginEvent);
      }
    });

    // Clean up on window close
    window.on("closed", () => {
      unsubscribe();
      if (subscribedWindow === window) {
        subscribedWindow = null;
      }
    });

    return { success: true };
  });
}
