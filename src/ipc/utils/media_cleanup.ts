import log from "electron-log";
import fs from "node:fs/promises";
import path from "node:path";
import { getDyadAppsBaseDirectory } from "@/paths/paths";
import { DYAD_MEDIA_DIR_NAME } from "@/ipc/utils/media_path_utils";

const logger = log.scope("media_cleanup");

export const MEDIA_TTL_DAYS = 30;

/**
 * Delete media files older than TTL from all app .dyad/media directories.
 * Run on app startup to reclaim disk space.
 */
export async function cleanupOldMediaFiles(): Promise<void> {
  const cutoffMs = Date.now() - MEDIA_TTL_DAYS * 24 * 60 * 60 * 1000;

  try {
    const baseDir = getDyadAppsBaseDirectory();

    let appDirs: string[];
    try {
      const entries = await fs.readdir(baseDir, { withFileTypes: true });
      appDirs = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      logger.log("No dyad-apps directory found, skipping media cleanup");
      return;
    }

    const counts = await Promise.all(
      appDirs.map(async (appDir) => {
        const mediaDir = path.join(baseDir, appDir, DYAD_MEDIA_DIR_NAME);

        let files: string[];
        try {
          files = await fs.readdir(mediaDir);
        } catch {
          return 0;
        }

        const results = await Promise.all(
          files.map(async (file) => {
            const filePath = path.join(mediaDir, file);
            try {
              const stat = await fs.stat(filePath);
              if (!stat.isFile()) {
                return 0;
              }
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
        return results.reduce<number>((sum, n) => sum + n, 0);
      }),
    );

    const totalDeleted = counts.reduce<number>((sum, n) => sum + n, 0);
    logger.log(`Cleaned up ${totalDeleted} old media files`);
  } catch (err) {
    logger.warn("Failed to cleanup old media files:", err);
  }
}
