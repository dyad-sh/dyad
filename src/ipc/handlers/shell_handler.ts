import { shell } from "electron";
import log from "electron-log";
import path from "node:path";
import { createLoggedHandler } from "./safe_handle";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { getDyadAppsBaseDirectory } from "../../paths/paths";

const logger = log.scope("shell_handlers");
const handle = createLoggedHandler(logger);

export function registerShellHandlers() {
  handle("open-external-url", async (_event, url: string) => {
    if (!url) {
      throw new Error("No URL provided.");
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      throw new Error("Attempted to open invalid or non-http URL: " + url);
    }
    // In E2E test mode, skip actually opening external URLs to avoid browser windows
    if (IS_TEST_BUILD) {
      logger.debug("E2E test mode: skipped opening external URL:", url);
      return;
    }
    await shell.openExternal(url);
    logger.debug("Opened external URL:", url);
  });

  handle("show-item-in-folder", async (_event, fullPath: string) => {
    // Validate that a path was provided
    if (!fullPath) {
      throw new Error("No file path provided.");
    }

    shell.showItemInFolder(fullPath);
    logger.debug("Showed item in folder:", fullPath);
  });

  handle("open-file-path", async (_event, fullPath: string) => {
    if (!fullPath) {
      throw new Error("No file path provided.");
    }

    // Security: only allow opening files within the dyad-apps directory
    const resolvedPath = path.resolve(fullPath);
    const resolvedBase = path.resolve(getDyadAppsBaseDirectory());
    if (!resolvedPath.startsWith(resolvedBase + path.sep)) {
      throw new Error("Cannot open files outside the dyad-apps directory.");
    }

    const result = await shell.openPath(resolvedPath);
    if (result) {
      // shell.openPath returns an error string if it fails, empty string on success
      throw new Error(`Failed to open file: ${result}`);
    }
    logger.debug("Opened file:", resolvedPath);
  });
}
