/**
 * Plugin IPC Integration
 *
 * Provides utilities for registering plugin IPC handlers with the Electron IPC system.
 */

import log from "electron-log";
import { ipcMain } from "electron";
import { getAllPluginIpcHandlers } from "./registry";
import { IS_TEST_BUILD } from "../ipc/utils/test_utils";

const logger = log.scope("plugin_ipc");

// ─────────────────────────────────────────────────────────────────────
// IPC Handler Registration
// ─────────────────────────────────────────────────────────────────────

/**
 * Register all plugin IPC handlers with the Electron IPC system.
 *
 * This function should be called after all plugins have been registered
 * and during the IPC initialization phase.
 */
export function registerPluginIpcHandlers(): void {
  const handlers = getAllPluginIpcHandlers();

  for (const handler of handlers) {
    // Skip test-only handlers in non-test builds
    if (handler.testOnly && !IS_TEST_BUILD) {
      continue;
    }

    const channel = handler.fullChannel;

    // Check if handler already exists
    if (ipcMain.listenerCount(channel) > 0) {
      logger.warn(`IPC handler for '${channel}' already registered, skipping.`);
      continue;
    }

    // Create a wrapped handler with error handling and logging
    ipcMain.handle(channel, async (event, params) => {
      const startTime = Date.now();
      logger.debug(`[${channel}] Request received`, { params });

      try {
        const result = await handler.handler(event, params);
        const duration = Date.now() - startTime;
        logger.debug(`[${channel}] Request completed in ${duration}ms`);
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error(`[${channel}] Request failed in ${duration}ms:`, error);
        throw error;
      }
    });

    logger.info(`Registered plugin IPC handler: ${channel}`);
  }
}

/**
 * Unregister all plugin IPC handlers.
 * Useful for cleanup during hot reload or shutdown.
 */
export function unregisterPluginIpcHandlers(): void {
  const handlers = getAllPluginIpcHandlers();

  for (const handler of handlers) {
    const channel = handler.fullChannel;
    ipcMain.removeHandler(channel);
    logger.info(`Unregistered plugin IPC handler: ${channel}`);
  }
}
