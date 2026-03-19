/**
 * Tailscale IPC Handlers
 *
 * Backend handlers for Tailscale VPN detection, status, and configuration.
 * Enables accessing JoyCreate services (Ollama, n8n, Celestia, OpenClaw)
 * from any device on the tailnet.
 */

import { ipcMain } from "electron";
import log from "electron-log";
import {
  getTailscaleStatus,
  getTailscaleConfig,
  saveTailscaleConfig,
  getAllServiceUrls,
  type TailscaleConfig,
} from "../../lib/tailscale_service";

const logger = log.scope("tailscale_handlers");

export function registerTailscaleHandlers(): void {
  // Get Tailscale VPN status (installed, running, IP, tailnet name)
  ipcMain.handle("tailscale:status", async (_event, forceRefresh?: boolean) => {
    return getTailscaleStatus(forceRefresh ?? false);
  });

  // Get current Tailscale configuration from settings
  ipcMain.handle("tailscale:config:get", async () => {
    return getTailscaleConfig();
  });

  // Save Tailscale configuration
  ipcMain.handle(
    "tailscale:config:save",
    async (_event, config: TailscaleConfig) => {
      saveTailscaleConfig(config);
      logger.info("Tailscale config saved:", {
        enabled: config.enabled,
        exposeServices: config.exposeServices,
      });
      return getTailscaleConfig();
    },
  );

  // Get all service URLs (local + tailnet)
  ipcMain.handle("tailscale:service-urls", async () => {
    return getAllServiceUrls();
  });

  logger.info("Tailscale IPC handlers registered");
}
