import { BrowserWindow, ipcMain } from "electron";
import log from "electron-log";

import { createTypedHandler } from "./base";
import {
  previewViewContracts,
  previewViewSendContracts,
} from "../types/preview_view";
import { assertTrustedRenderer } from "../utils/renderer_security";
import { resolveRemoteDebuggingEndpoint } from "@/main/remote_debugging";
import {
  hidePreviewView,
  previewViewGoBack,
  previewViewGoForward,
  previewViewReload,
  setPreviewViewBounds,
  showPreviewView,
} from "@/main/preview_web_contents_view";

const logger = log.scope("preview_view_handlers");

function resolveWindow(
  event: Electron.IpcMainInvokeEvent,
  command: string,
): BrowserWindow | null {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    logger.error(`Failed to get BrowserWindow instance for ${command}`);
    return null;
  }
  return window;
}

export function registerPreviewViewHandlers(): void {
  createTypedHandler(previewViewContracts.show, async (event, input) => {
    const window = resolveWindow(event, "preview view show");
    if (!window) return;
    showPreviewView(window, input);
  });

  createTypedHandler(previewViewContracts.hide, async (event) => {
    const window = resolveWindow(event, "preview view hide");
    if (!window) return;
    hidePreviewView(window);
  });

  createTypedHandler(previewViewContracts.goBack, async (event) => {
    const window = resolveWindow(event, "preview view back");
    if (!window) return;
    previewViewGoBack(window);
  });

  createTypedHandler(previewViewContracts.goForward, async (event) => {
    const window = resolveWindow(event, "preview view forward");
    if (!window) return;
    previewViewGoForward(window);
  });

  createTypedHandler(previewViewContracts.reload, async (event) => {
    const window = resolveWindow(event, "preview view reload");
    if (!window) return;
    previewViewReload(window);
  });

  createTypedHandler(previewViewContracts.getAutomationStatus, async () => ({
    cdpReady: (await resolveRemoteDebuggingEndpoint()) !== null,
  }));

  // Bounds arrive on every animation frame while a panel divider is dragged, so
  // they use a one-way channel. Invalid payloads are logged and dropped rather
  // than surfaced: there is no caller waiting on a result.
  ipcMain?.on(
    previewViewSendContracts.setBounds.channel,
    (event, input: unknown) => {
      try {
        assertTrustedRenderer(event);
        const bounds = previewViewSendContracts.setBounds.input.parse(input);
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return;
        setPreviewViewBounds(window, bounds);
      } catch (error) {
        logger.error("Ignoring invalid preview view bounds", error);
      }
    },
  );
}
