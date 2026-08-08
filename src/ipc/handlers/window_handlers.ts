import { BrowserWindow, screen } from "electron";
import log from "electron-log";
import { platform } from "os";
import { createTypedHandler } from "./base";
import { systemContracts } from "../types/system";
import {
  getLandscapeWindowBounds,
  getPortraitWindowBounds,
} from "@/lib/window_layout";

const logger = log.scope("window-handlers");

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

  createTypedHandler(
    systemContracts.setAppLayoutMode,
    async (event, { mode }) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) {
        throw new Error("Failed to get the application window");
      }

      if (window.isMaximized() || window.isFullScreen()) {
        window.unmaximize();
        window.setFullScreen(false);
      }

      const display = screen.getDisplayMatching(window.getBounds());
      const bounds =
        mode === "portrait"
          ? getPortraitWindowBounds(display.workArea)
          : getLandscapeWindowBounds(display.workArea);

      window.setMinimumSize(mode === "portrait" ? 640 : 800, 500);
      window.setBounds(bounds, true);

      return { mode, width: bounds.width, height: bounds.height };
    },
  );

  createTypedHandler(systemContracts.getSystemPlatform, async () => {
    return platform();
  });
}
