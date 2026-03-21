import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import { pipeline } from "node:stream/promises";
import log from "electron-log";

const logger = log.scope("wsl_path_utils");

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

export async function copyFileHandlingWsl(
  sourcePath: string,
  destPath: string,
): Promise<void> {
  try {
    if (isWslPath(sourcePath) || isWslPath(destPath)) {
      const readable = fs.createReadStream(sourcePath);
      const writable = fs.createWriteStream(destPath);
      await pipeline(readable, writable);
      const stats = await fsPromises.stat(sourcePath);
      await fsPromises.chmod(destPath, stats.mode);
    } else {
      await fsPromises.copyFile(sourcePath, destPath);
    }
  } catch (error) {
    logger.error(`Failed to copy file: ${sourcePath} -> ${destPath}`, error);
    throw error;
  }
}

export function copyFileSyncHandlingWsl(
  sourcePath: string,
  destPath: string,
): void {
  try {
    if (isWslPath(sourcePath) || isWslPath(destPath)) {
      const fileBuffer = fs.readFileSync(sourcePath);
      fs.writeFileSync(destPath, fileBuffer);
      const stats = fs.statSync(sourcePath);
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

export async function getFileStatsHandlingWslAsync(
  filePath: string,
): Promise<fs.Stats | undefined> {
  try {
    return await fsPromises.stat(filePath);
  } catch {
    return undefined;
  }
}
