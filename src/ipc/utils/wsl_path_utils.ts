import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import log from "electron-log";

const logger = log.scope("wsl_path_utils");

/**
 * Detects if a path is a WSL2 network UNC path.
 * Matches patterns like:
 * - \\wsl.localhost\Ubuntu\home\user\project
 * - \\wsl$\Ubuntu\home\user\project
 */
export function isWslPath(filePath: string): boolean {
  if (!filePath || typeof filePath !== "string") {
    return false;
  }
  const normalized = filePath.replace(/\//g, "\\");
  return (
    normalized.toLowerCase().includes("\\wsl.localhost\\") ||
    normalized.toLowerCase().includes("\\wsl$\\")
  );
}

/**
 * Copies a file with special handling for WSL2 paths using streaming.
 * Uses streams instead of buffering to avoid memory issues with large files.
 * Also preserves file permissions/mode.
 *
 * @param sourcePath Source file path (may be a WSL2 UNC path)
 * @param destPath Destination file path
 * @throws Error if the source doesn't exist or copy fails
 */
export async function copyFileHandlingWsl(
  sourcePath: string,
  destPath: string,
): Promise<void> {
  try {
    if (isWslPath(sourcePath)) {
      logger.debug(`Detected WSL path, using streaming copy: ${sourcePath}`);
      // Use streaming for WSL paths to avoid memory issues with large files
      // Also preserves file permissions via chmod after write
      await new Promise<void>((resolve, reject) => {
        const readable = fs.createReadStream(sourcePath);
        const writable = fs.createWriteStream(destPath);

        readable.on("error", reject);
        writable.on("error", reject);

        readable.pipe(writable);

        writable.on("finish", async () => {
          try {
            // Preserve file permissions from source
            const stats = await fsPromises.stat(sourcePath);
            await fsPromises.chmod(destPath, stats.mode);
            logger.debug(
              `Successfully copied WSL file with mode: ${sourcePath} -> ${destPath}`,
            );
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
    } else {
      // For regular paths, use copyFile which is more efficient
      await fsPromises.copyFile(sourcePath, destPath);
    }
  } catch (error) {
    logger.error(`Failed to copy file: ${sourcePath} -> ${destPath}`, error);
    throw error;
  }
}

/**
 * Synchronous version of copyFileHandlingWsl.
 * Use sparingly - synchronous I/O can block the main thread.
 */
export function copyFileSyncHandlingWsl(
  sourcePath: string,
  destPath: string,
): void {
  try {
    if (isWslPath(sourcePath)) {
      logger.debug(
        `Detected WSL path (sync), using buffer copy: ${sourcePath}`,
      );
      // Sync version must use buffer (no streaming for sync)
      const fileBuffer = fs.readFileSync(sourcePath);
      fs.writeFileSync(destPath, fileBuffer);
      // Preserve file permissions
      const stats = fs.statSync(sourcePath);
      fs.chmodSync(destPath, stats.mode);
      logger.debug(
        `Successfully copied WSL file (sync): ${sourcePath} -> ${destPath}`,
      );
    } else {
      fs.copyFileSync(sourcePath, destPath);
    }
  } catch (error) {
    logger.error(
      `Failed to copy file (sync): ${sourcePath} -> ${destPath}`,
      error,
    );
    throw error;
  }
}

/**
 * ASYNC version: Checks if a path exists with WSL support.
 * Non-blocking, safe for Electron main process.
 * Prefer this over the sync version in async contexts.
 */
export async function pathExistsHandlingWslAsync(
  filePath: string,
): Promise<boolean> {
  try {
    await fsPromises.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * DEPRECATED: Use pathExistsHandlingWslAsync instead.
 * This synchronous variant blocks the event loop and should be avoided
 * in async handlers (like IPC endpoints).
 */
export function pathExistsHandlingWsl(filePath: string): boolean {
  try {
    if (isWslPath(filePath)) {
      fs.statSync(filePath);
      return true;
    } else {
      return fs.existsSync(filePath);
    }
  } catch {
    return false;
  }
}

/**
 * Gets file stats, with special handling for WSL paths.
 */
export function getFileStatsHandlingWsl(
  filePath: string,
): fs.Stats | undefined {
  try {
    return fs.statSync(filePath);
  } catch {
    return undefined;
  }
}
