import { createTypedHandler } from "./base";
import { mediaContracts } from "../types/media";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { getDyadAppPath } from "../../paths/paths";
import { safeJoin } from "../utils/path_utils";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import log from "electron-log";

const logger = log.scope("media_handlers");

const SUPPORTED_MEDIA_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
];

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  };
  return map[ext] || "application/octet-stream";
}

function getMediaFilesForApp(appId: number, appName: string, appPath: string) {
  const mediaDir = path.join(appPath, ".dyad", "media");
  if (!fs.existsSync(mediaDir)) return [];

  const entries = fs.readdirSync(mediaDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_MEDIA_EXTENSIONS.includes(ext)) continue;

    const fullPath = path.join(mediaDir, entry.name);
    const stat = fs.statSync(fullPath);

    files.push({
      fileName: entry.name,
      filePath: fullPath,
      appId,
      appName,
      sizeBytes: stat.size,
      mimeType: getMimeType(ext),
    });
  }

  return files;
}

export function registerMediaHandlers() {
  createTypedHandler(mediaContracts.listAllMedia, async () => {
    const allApps = await db.select().from(apps);
    const result = [];

    for (const app of allApps) {
      const appPath = getDyadAppPath(app.path);
      const files = getMediaFilesForApp(app.id, app.name, appPath);
      if (files.length > 0) {
        result.push({
          appId: app.id,
          appName: app.name,
          appPath,
          files,
        });
      }
    }

    return { apps: result };
  });

  createTypedHandler(mediaContracts.readMediaFile, async (_, params) => {
    const app = await db.query.apps.findFirst({
      where: eq(apps.id, params.appId),
    });
    if (!app) throw new Error("App not found");

    const appPath = getDyadAppPath(app.path);
    const filePath = safeJoin(appPath, ".dyad", "media", params.fileName);

    if (!fs.existsSync(filePath)) {
      throw new Error("Media file not found");
    }

    const ext = path.extname(params.fileName).toLowerCase();
    const buffer = fs.readFileSync(filePath);

    logger.log(`Read media file: ${filePath}`);

    return {
      base64Data: buffer.toString("base64"),
      mimeType: getMimeType(ext),
      fileName: params.fileName,
    };
  });
}
