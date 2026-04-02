import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import { pipeline } from "node:stream/promises";
import log from "electron-log";

const logger = log.scope("wsl_path_utils");

/**
 * Detects if a path is  WSL2 network UNC path.
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
      try {
        await fsPromises.chmod(destPath, stats.mode);
      } catch (err) {
        // Chmod failure on filesystems without POSIX mode support (FAT/exFAT,
        // SMB shares) should not abort the copy since the file was successfully streamed.
        // Log as warning but continue - the file contents are intact.
        logger.warn(
          `Failed to preserve file mode for ${destPath}, but file copy succeeded:`,
          err,
        );
      }
    } else {
      await fsPromises.copyFile(sourcePath, destPath);
    }
  } catch (error) {
    logger.error(`Failed to copy file: ${sourcePath} -> ${destPath}`, error);
    throw error;
  }
}

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
