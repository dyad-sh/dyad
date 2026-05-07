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
        const mediaDir = path.join(appPath, DYAD_MEDIA_DIR_NAME);

        let files: string[];
        try {
          files = await fs.readdir(mediaDir);
        } catch {
          return 0;
        }

        const results = await Promise.all(
          files.map(async (file) => {
            if (file === ATTACHMENTS_MANIFEST_FILE) {
              return 0;
            }
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
        try {
          await pruneAttachmentManifest(appPath);
        } catch (err) {
          logger.warn(
            `Failed to prune attachment manifest for ${mediaDir}:`,
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
