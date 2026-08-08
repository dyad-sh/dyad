import { shell } from "electron";
import log from "electron-log";
import path from "node:path";
import fsSync from "node:fs";
import { createLoggedHandler } from "./safe_handle";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { isFileWithinAnyDyadMediaDir } from "../utils/media_path_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("shell_handlers");
const handle = createLoggedHandler(logger);

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

  handle(
    "read-local-image",
    async (
      _event,
      { path: filePath }: { path: string },
    ): Promise<{ dataUrl: string; name: string; sizeBytes: number }> => {
      const resolved = path.resolve(filePath.replace(/^file:\/\//, ""));
      const extension = path.extname(resolved).toLowerCase();
      const mimeTypes: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".avif": "image/avif",
        ".svg": "image/svg+xml",
        ".bmp": "image/bmp",
      };
      const mimeType = mimeTypes[extension];
      // Images only: this must not become a way to read arbitrary files.
      if (!mimeType) {
        throw new DyadError(
          "That file is not an image.",
          DyadErrorKind.Validation,
        );
      }

      let stat: fsSync.Stats;
      try {
        stat = fsSync.statSync(resolved);
      } catch {
        throw new DyadError(
          "That image no longer exists.",
          DyadErrorKind.NotFound,
        );
      }
      if (!stat.isFile()) {
        throw new DyadError(
          "That path is not a file.",
          DyadErrorKind.Validation,
        );
      }
      const MAX_BYTES = 16 * 1024 * 1024;
      if (stat.size > MAX_BYTES) {
        throw new DyadError(
          "That image is too large to preview.",
          DyadErrorKind.Validation,
        );
      }

      const data = fsSync.readFileSync(resolved);
      return {
        dataUrl: `data:${mimeType};base64,${data.toString("base64")}`,
        name: path.basename(resolved),
        sizeBytes: stat.size,
      };
    },
  );

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
