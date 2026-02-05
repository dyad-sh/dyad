/**
 * OpenClaw IPC Handlers
 * 
 * Exposes OpenClaw functionality to the renderer process via IPC.
 * OpenClaw is the central nervous system of JoyCreate - providing
 * multi-channel messaging, AI agents, and memory capabilities.
 * 
 * 🦞 EXFOLIATE! EXFOLIATE!
 */

import { ipcMain, IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import {
  getOpenClawIntegration,
  initializeOpenClaw,
  type OpenClawIntegrationConfig,
  type OpenClawAgentRequest,
  type OpenClawMessageRequest,
  type OpenClawBroadcastRequest,
  type OpenClawMemorySearchRequest,
  type OpenClawChannel,
} from "@/lib/openclaw_integration";

const logger = log.scope("openclaw_ipc");

// =============================================================================
// HANDLER REGISTRATION
// =============================================================================

export function registerOpenClawIPCHandlers(): void {
  logger.info("🦞 Registering OpenClaw IPC handlers (extended)...");

  // NOTE: Core handlers (initialize, shutdown, config, gateway management)
  // are registered in openclaw_handlers.ts - this file only adds
  // additional handlers for agent, messaging, memory, and plugin functionality.

  // ---------------------------------------------------------------------------
  // AGENT INTERFACE
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "openclaw:agent:run",
    async (_event: IpcMainInvokeEvent, request: OpenClawAgentRequest) => {
      logger.info("Running OpenClaw agent:", { message: request.message.slice(0, 50) });
      const integration = getOpenClawIntegration();
      return integration.runAgent(request);
    }
  );

  // Note: Streaming is handled via events, not IPC invoke
  // See the event forwarding section below

  // ---------------------------------------------------------------------------
  // MESSAGING INTERFACE
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "openclaw:message:send",
    async (_event: IpcMainInvokeEvent, request: OpenClawMessageRequest) => {
      logger.info("Sending message via OpenClaw:", { target: request.target });
      const integration = getOpenClawIntegration();
      return integration.sendMessage(request);
    }
  );

  ipcMain.handle(
    "openclaw:message:broadcast",
    async (_event: IpcMainInvokeEvent, request: OpenClawBroadcastRequest) => {
      logger.info("Broadcasting message via OpenClaw:", { targets: request.targets.length });
      const integration = getOpenClawIntegration();
      return integration.broadcastMessage(request);
    }
  );

  ipcMain.handle(
    "openclaw:message:read",
    async (
      _event: IpcMainInvokeEvent,
      target: string,
      channel?: OpenClawChannel,
      limit?: number
    ) => {
      const integration = getOpenClawIntegration();
      return integration.readMessages(target, channel, limit);
    }
  );

  // ---------------------------------------------------------------------------
  // MEMORY INTERFACE
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "openclaw:memory:search",
    async (_event: IpcMainInvokeEvent, request: OpenClawMemorySearchRequest) => {
      logger.info("Searching OpenClaw memory:", { query: request.query });
      const integration = getOpenClawIntegration();
      return integration.searchMemory(request);
    }
  );

  // ---------------------------------------------------------------------------
  // CHANNEL MANAGEMENT
  // ---------------------------------------------------------------------------

  ipcMain.handle("openclaw:channels:list", async () => {
    const integration = getOpenClawIntegration();
    return integration.getChannels();
  });

  ipcMain.handle(
    "openclaw:channels:configure",
    async (_event: IpcMainInvokeEvent, channel: OpenClawChannel) => {
      const integration = getOpenClawIntegration();
      await integration.configureChannel(channel);
      return { success: true };
    }
  );

  // ---------------------------------------------------------------------------
  // PLUGIN MANAGEMENT
  // ---------------------------------------------------------------------------

  ipcMain.handle("openclaw:plugins:list", async () => {
    const integration = getOpenClawIntegration();
    return integration.listPlugins();
  });

  ipcMain.handle(
    "openclaw:plugins:install",
    async (_event: IpcMainInvokeEvent, pluginId: string) => {
      logger.info("Installing OpenClaw plugin:", pluginId);
      const integration = getOpenClawIntegration();
      await integration.installPlugin(pluginId);
      return { success: true };
    }
  );

  ipcMain.handle(
    "openclaw:plugins:uninstall",
    async (_event: IpcMainInvokeEvent, pluginId: string) => {
      logger.info("Uninstalling OpenClaw plugin:", pluginId);
      const integration = getOpenClawIntegration();
      await integration.uninstallPlugin(pluginId);
      return { success: true };
    }
  );

  ipcMain.handle(
    "openclaw:plugins:enable",
    async (_event: IpcMainInvokeEvent, pluginId: string) => {
      const integration = getOpenClawIntegration();
      await integration.enablePlugin(pluginId);
      return { success: true };
    }
  );

  ipcMain.handle(
    "openclaw:plugins:disable",
    async (_event: IpcMainInvokeEvent, pluginId: string) => {
      const integration = getOpenClawIntegration();
      await integration.disablePlugin(pluginId);
      return { success: true };
    }
  );

  // ---------------------------------------------------------------------------
  // DIAGNOSTICS
  // ---------------------------------------------------------------------------

  ipcMain.handle("openclaw:doctor", async () => {
    logger.info("Running OpenClaw doctor...");
    const integration = getOpenClawIntegration();
    return integration.runDoctor();
  });

  logger.info("🦞 OpenClaw IPC handlers registered - ready to EXFOLIATE!");
}

// =============================================================================
// EVENT FORWARDING TO RENDERER
// =============================================================================

/**
 * Set up event forwarding from OpenClaw to the renderer process
 * Call this after creating the main window
 */
export function setupOpenClawEventForwarding(mainWindow: Electron.BrowserWindow): void {
  const integration = getOpenClawIntegration();

  const events = [
    "connected",
    "disconnected",
    "error",
    "gateway-started",
    "gateway-stopped",
    "gateway-restarted",
    "agent-thinking",
    "agent-tool-call",
    "agent-response",
    "agent-completed",
    "message-received",
    "message-sent",
    "channel-connected",
    "channel-disconnected",
    "plugin-installed",
    "plugin-uninstalled",
    "plugin-enabled",
    "plugin-disabled",
    "config-updated",
    "reconnect-failed",
    "warning",
  ];

  for (const event of events) {
    integration.on(event, (data: unknown) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(`openclaw:event:${event}`, data);
      }
    });
  }

  logger.info("OpenClaw event forwarding configured for renderer");
}
