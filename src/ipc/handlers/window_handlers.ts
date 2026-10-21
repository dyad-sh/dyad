import { BrowserWindow, ipcMain } from "electron";
import log from "electron-log";
import { platform } from "os";
import { createTypedHandler } from "./base";
import { systemContracts, systemSendContracts } from "../types/system";
import { assertTrustedRenderer } from "../utils/renderer_security";
import { getInitialLoadIsFirstSession } from "@/main/settings";
import { getPreviousSessionAppSize } from "@/main/last_session_store";
import { AppSizeTelemetrySchema } from "@/shared/app_size_telemetry";
import { queryWindowsPagefileSettings } from "@/utils/windows_pagefile";
import {
  clearRendererHeapReport,
  recordRendererHeapReport,
} from "@/utils/renderer_heap_reports";

const logger = log.scope("window-handlers");

// Senders whose destroyed hook is already attached, by webContents id.
const trackedHeapReporters = new Set<number>();

export function registerWindowHandlers() {
  logger.debug("Registering window control handlers");

  createTypedHandler(systemContracts.minimizeWindow, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      logger.error("Failed to get BrowserWindow instance for minimize command");
      return;
    }
    window.minimize();
  });

  createTypedHandler(systemContracts.maximizeWindow, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      logger.error("Failed to get BrowserWindow instance for maximize command");
      return;
    }
    if (window.isMaximized()) {
      window.restore();
    } else {
      window.maximize();
    }
  });

  createTypedHandler(systemContracts.closeWindow, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      logger.error("Failed to get BrowserWindow instance for close command");
      return;
    }
    window.close();
  });

  createTypedHandler(systemContracts.focusWindow, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      logger.error("Failed to get BrowserWindow instance for focus command");
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.show(); // Ensures window is visible on macOS
    window.focus();
  });

  createTypedHandler(systemContracts.getSystemPlatform, async () => {
    return platform();
  });

  createTypedHandler(
    systemContracts.getInitialLoadTelemetryContext,
    async () => {
      const previous = getPreviousSessionAppSize();
      // Narrowed by the schema rather than copied field by field, so a wrong
      // field cannot creep in. The app id identifies an app on this machine
      // only and nothing in the renderer uses it, so it does not cross.
      const narrowed = previous
        ? AppSizeTelemetrySchema.safeParse(previous)
        : null;
      return {
        isFirstSession: getInitialLoadIsFirstSession(),
        previousSessionAppSize: narrowed?.success ? narrowed.data : null,
        // Started at launch; by now it has long resolved (or timed out).
        pagefile: await queryWindowsPagefileSettings(),
      };
    },
  );

  // Heap reports arrive every 30s from each window's preload. One-way: an
  // invalid payload is logged and dropped, since nothing waits on a reply.
  ipcMain?.on(
    systemSendContracts.reportRendererHeap.channel,
    (event, input: unknown) => {
      try {
        assertTrustedRenderer(event);
        const report =
          systemSendContracts.reportRendererHeap.input.parse(input);
        const sender = event.sender;
        if (!trackedHeapReporters.has(sender.id)) {
          // Forget a closed window at once rather than after the report
          // expiry, so its figure cannot be pinned on a later crash.
          trackedHeapReporters.add(sender.id);
          sender.once("destroyed", () => {
            trackedHeapReporters.delete(sender.id);
            clearRendererHeapReport(sender.id);
          });
        }
        recordRendererHeapReport(sender.id, report);
      } catch (error) {
        logger.debug("Ignoring renderer heap report", error);
      }
    },
  );
}
