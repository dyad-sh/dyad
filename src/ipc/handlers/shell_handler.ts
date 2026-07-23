import { app, shell } from "electron";
import log from "electron-log";
import path from "node:path";
import { createLoggedHandler } from "./safe_handle";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { isFileWithinAnyDyadMediaDir } from "../utils/media_path_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { registerDyadProtocolLinux } from "../../main/linux_protocol_registration";

const logger = log.scope("shell_handlers");
const handle = createLoggedHandler(logger);

// Hosts whose OAuth flows redirect back into the app via a dyad:// deep link
// (Neon, Supabase, and Dyad Pro all live under *.dyad.sh).
function isDyadOAuthUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "dyad.sh" || host.endsWith(".dyad.sh");
  } catch {
    return false;
  }
}

// Only allow opening files with known safe media extensions via shell.openPath.
// This prevents execution of arbitrary executables even if they reside under a
// .dyad/media directory.
const ALLOWED_MEDIA_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".ico",
  ".pdf",
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".xml",
  ".mp3",
  ".mp4",
  ".wav",
  ".ogg",
  ".webm",
]);

export function registerShellHandlers() {
  handle("open-external-url", async (_event, url: string) => {
    if (!url) {
      throw new DyadError("No URL provided.", DyadErrorKind.External);
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      throw new Error("Attempted to open invalid or non-http URL: " + url);
    }
    // In E2E test mode, skip actually opening external URLs to avoid browser windows
    if (IS_TEST_BUILD) {
      logger.debug("E2E test mode: skipped opening external URL:", url);
      return;
    }
    // On Linux, dev and packaged builds share the single dyad:// scheme and it's
    // "last registration wins", so launching the packaged app steals the handler
    // and OAuth callbacks (dyad://neon-oauth-return, etc.) open packaged instead
    // of this dev instance. Reclaim the handler just before the browser opens so
    // the callback routes back here. Best-effort; the helper self-guards platform.
    if (
      !app.isPackaged &&
      process.platform === "linux" &&
      isDyadOAuthUrl(url)
    ) {
      await registerDyadProtocolLinux(app.getPath("userData"));
    }
    await shell.openExternal(url);
    logger.debug("Opened external URL:", url);
  });

  handle("show-item-in-folder", async (_event, fullPath: string) => {
    // Validate that a path was provided
    if (!fullPath) {
      throw new DyadError("No file path provided.", DyadErrorKind.External);
    }

    shell.showItemInFolder(fullPath);
    logger.debug("Showed item in folder:", fullPath);
  });

  handle("open-file-path", async (_event, fullPath: string) => {
    if (!fullPath) {
      throw new DyadError("No file path provided.", DyadErrorKind.External);
    }

    // Security: only allow opening files within .dyad/media subdirectories.
    // The dyad-apps tree contains AI-generated code, so opening arbitrary files
    // there via shell.openPath could execute malicious executables.
    // App paths may be under the default dyad-apps base directory (normal) or
    // at an external location (imported with skipCopy).
    if (!isFileWithinAnyDyadMediaDir(fullPath)) {
      throw new DyadError(
        "Can only open files within .dyad/media directories.",
        DyadErrorKind.External,
      );
    }
    const resolvedPath = path.resolve(fullPath);

    // Defense-in-depth: only allow known media file extensions
    const ext = path.extname(resolvedPath).toLowerCase();
    if (!ALLOWED_MEDIA_EXTENSIONS.has(ext)) {
      throw new Error(
        `File type '${ext}' is not allowed. Only media files can be opened.`,
      );
    }

    const result = await shell.openPath(resolvedPath);
    if (result) {
      // shell.openPath returns an error string if it fails, empty string on success
      throw new DyadError(
        `Failed to open file: ${result}`,
        DyadErrorKind.External,
      );
    }
    logger.debug("Opened file:", resolvedPath);
  });
}
