import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import log from "electron-log";

const logger = log.scope("wsl_path_utils");

/**
 * Detects if a path is a WSL2 network UNC path.
 * Matches patterns like:
 * - \\wsl.localhost\Ubuntu\home\user\project ...
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
 * Copies a file, with detecting and handling WSL2 paths.
 * When the source is a WSL2 path, we read it as a buffer and write it,
 * which works around Node.js fs.copyFile limitations with UNC paths.
 * @param sourcePath The source file path (may be a WSL2 UNC path)
 * @param destPath The destination file path (should be Windows filesystem)
 * @throws Error if the source file doesn't exist or copy fails
 */
export async function copyFileHandlingWsl(
  sourcePath: string,
  destPath: string,
): Promise<void> {
  try {
    if (isWslPath(sourcePath)) {
      logger.debug(`Detected WSL path, using buffer copy: ${sourcePath}`);
      const fileBuffer = await fsPromises.readFile(sourcePath);
      await fsPromises.writeFile(destPath, fileBuffer);
      logger.debug(
        `Successfully copied WSL file: ${sourcePath} -> ${destPath}`,
      );
    } else {
      await fsPromises.copyFile(sourcePath, destPath);
    }
  } catch (error) {
    logger.error(`Failed to copy file: ${sourcePath} -> ${destPath}`, error);
    throw error;
  }
}

/**
 * Synchronous version of copyFileHandlingWsl backupp.
 * Use this when async is not available.
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
      const fileBuffer = fs.readFileSync(sourcePath);
      fs.writeFileSync(destPath, fileBuffer);
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
 * Checks if a path exists, with special handling for WSL paths.
 * WSL paths may not work reliably with fs.existsSync on some systems.
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
