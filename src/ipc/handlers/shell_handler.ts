import { shell } from "electron";
import log from "electron-log";
import path from "node:path";
import { createLoggedHandler } from "./safe_handle";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { DYAD_MEDIA_DIR_NAME } from "../utils/media_path_utils";

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

    // Security: only allow opening files within dyad-media subdirectories.
    // The dyad-apps tree contains AI-generated code, so opening arbitrary files
    // there via shell.openPath could execute malicious executables.
    // App paths may be under the default dyad-apps base directory (normal) or
    // at an external location (imported with skipCopy).
    const resolvedPath = path.resolve(fullPath);
    const segments = resolvedPath.split(path.sep);
    const mediaIdx = segments.lastIndexOf(DYAD_MEDIA_DIR_NAME);
    // The dyad-media segment must exist with at least one segment (filename) after it
    if (mediaIdx === -1 || mediaIdx >= segments.length - 1) {
      throw new Error("Can only open files within dyad-media directories.");
    }
    // Verify the resolved path is within the dyad-media directory (defense-in-depth)
    const mediaDirPath = segments.slice(0, mediaIdx + 1).join(path.sep);
    const relativeFromMedia = path.relative(mediaDirPath, resolvedPath);
    if (
      relativeFromMedia.startsWith("..") ||
      path.isAbsolute(relativeFromMedia)
    ) {
      throw new Error("Can only open files within dyad-media directories.");
    }

    const result = await shell.openPath(resolvedPath);
    if (result) {
      // shell.openPath returns an error string if it fails, empty string on success
      throw new Error(`Failed to open file: ${result}`);
    }
    logger.debug("Opened file:", resolvedPath);
  });
}
