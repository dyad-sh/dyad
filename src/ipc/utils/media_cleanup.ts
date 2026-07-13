import log from "electron-log";
import fs from "node:fs/promises";
import path from "node:path";
import { getDyadAppPath } from "@/paths/paths";
import {
  ATTACHMENTS_MANIFEST_FILE,
  DYAD_MEDIA_DIR_NAME,
  pruneAttachmentManifest,
} from "@/ipc/utils/media_path_utils";
import { db } from "@/db";
import { apps } from "@/db/schema";

const logger = log.scope("media_cleanup");

export const MEDIA_TTL_DAYS = 30;

function isPathWithinDirectory(filePath: string, directoryPath: string) {
  const relativePath = path.relative(directoryPath, filePath);
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

async function getSafeMediaDirectory(
  appPath: string,
): Promise<{ path: string } | null> {
  const mediaDir = path.join(appPath, DYAD_MEDIA_DIR_NAME);
  try {
    const appRealPath = await fs.realpath(appPath);
    const mediaDirStat = await fs.lstat(mediaDir);
    if (!mediaDirStat.isDirectory() || mediaDirStat.isSymbolicLink()) {
      return null;
    }

    const realMediaDir = await fs.realpath(mediaDir);
    const expectedMediaDir = path.join(appRealPath, DYAD_MEDIA_DIR_NAME);
    if (
      realMediaDir !== expectedMediaDir ||
      !isPathWithinDirectory(realMediaDir, appRealPath)
    ) {
      return null;
    }

    const manifestPath = path.join(realMediaDir, ATTACHMENTS_MANIFEST_FILE);
    try {
      const realManifestPath = await fs.realpath(manifestPath);
      if (!isPathWithinDirectory(realManifestPath, realMediaDir)) {
        return null;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }

    return { path: realMediaDir };
  } catch {
    return null;
  }
}

/**
 * Delete media files older than TTL from all app .dyad/media directories.
 * Run on app startup to reclaim disk space.
 */
export async function cleanupOldMediaFiles(): Promise<void> {
  const cutoffMs = Date.now() - MEDIA_TTL_DAYS * 24 * 60 * 60 * 1000;

  try {
    const allApps = await db.select({ path: apps.path }).from(apps);

    const counts = await Promise.all(
      allApps.map(async (app) => {
        const appPath = getDyadAppPath(app.path);
        const safeMediaDir = await getSafeMediaDirectory(appPath);
        if (!safeMediaDir) {
          return 0;
        }

        let files: string[];
        try {
          files = await fs.readdir(safeMediaDir.path);
        } catch {
          return 0;
        }

        const results = await Promise.all(
          files.map(async (file) => {
            if (file === ATTACHMENTS_MANIFEST_FILE) {
              return 0;
            }
            const filePath = path.join(safeMediaDir.path, file);
            try {
              const entryStat = await fs.lstat(filePath);
              if (entryStat.isSymbolicLink() || !entryStat.isFile()) {
                return 0;
              }
              const realFilePath = await fs.realpath(filePath);
              if (!isPathWithinDirectory(realFilePath, safeMediaDir.path)) {
                return 0;
              }
              const stat = await fs.stat(filePath);
              if (stat.mtimeMs < cutoffMs) {
                await fs.unlink(filePath);
                return 1;
              }
            } catch (err) {
              logger.warn(`Failed to process media file ${filePath}:`, err);
            }
            return 0;
          }),
        );
        try {
          await pruneAttachmentManifest(appPath);
        } catch (err) {
          logger.warn(
            `Failed to prune attachment manifest for ${safeMediaDir.path}:`,
            err,
          );
        }
        return results.reduce<number>((sum, n) => sum + n, 0);
      }),
    );

    const totalDeleted = counts.reduce<number>((sum, n) => sum + n, 0);
    logger.log(`Cleaned up ${totalDeleted} old media files`);
  } catch (err) {
    logger.warn("Failed to cleanup old media files:", err);
  }
}
