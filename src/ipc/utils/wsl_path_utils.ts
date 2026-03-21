import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import { pipeline } from "node:stream/promises";
import log from "electron-log";

const logger = log.scope("wsl_path_utils");

/**
 * Detects if a path is a WSL2 network UNC path.
 * Matches patterns like \\wsl.localhost\Ubuntu\home\user\project and \\wsl$\Ubuntu\home\user\project.
 */
export function isWslPath(filePath: string): boolean {
  if (!filePath || typeof filePath !== "string") {
    return false;
  }
  const normalized = filePath.replace(/\//g, "\\").toLowerCase();
  return (
    normalized.startsWith("\\\\wsl.localhost\\") ||
    normalized.startsWith("\\\\wsl$\\")
  );
}

/**
 * Copies a file with WSL2 path support using streaming for UNC paths.
 * Ensures file permissions are preserved and cleans up partial files on error.
 */
export async function copyFileHandlingWsl(
  sourcePath: string,
  destPath: string,
): Promise<void> {
  try {
    if (isWslPath(sourcePath) || isWslPath(destPath)) {
      const stats = await fsPromises.stat(sourcePath);
      const readable = fs.createReadStream(sourcePath);
      const writable = fs.createWriteStream(destPath);
      try {
        await pipeline(readable, writable);
      } catch (err) {
        await fsPromises.unlink(destPath).catch(() => {});
        throw err;
      }
      await fsPromises.chmod(destPath, stats.mode);
    } else {
      await fsPromises.copyFile(sourcePath, destPath);
    }
  } catch (error) {
    logger.error(`Failed to copy file: ${sourcePath} -> ${destPath}`, error);
    throw error;
  }
}

/**
 * Synchronous version of copyFileHandlingWsl.
 */
export function copyFileSyncHandlingWsl(
  sourcePath: string,
  destPath: string,
): void {
  try {
    if (isWslPath(sourcePath) || isWslPath(destPath)) {
      const stats = fs.statSync(sourcePath);
      const fileBuffer = fs.readFileSync(sourcePath);
      try {
        fs.writeFileSync(destPath, fileBuffer);
      } catch (err) {
        try {
          fs.unlinkSync(destPath);
        } catch {}
        throw err;
      }
      fs.chmodSync(destPath, stats.mode);
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
 * Async check if a path exists.
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
 * Sync check if a path exists.
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
 * Async get file stats.
 */
export async function getFileStatsHandlingWslAsync(
  filePath: string,
): Promise<fs.Stats | undefined> {
  try {
    return await fsPromises.stat(filePath);
  } catch {
    return undefined;
  }
}
