import { createTypedHandler } from "./base";
import { mediaContracts } from "../types/media";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { getDyadAppPath } from "../../paths/paths";
import { safeJoin } from "../utils/path_utils";
import { getMimeType, MIME_TYPE_MAP } from "../utils/mime_utils";
import { DYAD_MEDIA_DIR_NAME } from "../utils/media_path_utils";
import { INVALID_FILE_NAME_CHARS } from "../../shared/media_validation";
import { withLock } from "../utils/lock_utils";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import log from "electron-log";

const logger = log.scope("media_handlers");

const SUPPORTED_MEDIA_EXTENSIONS = Object.keys(MIME_TYPE_MAP);

async function getMediaFilesForApp(
  appId: number,
  appName: string,
  appPath: string,
) {
  const mediaDir = path.join(appPath, DYAD_MEDIA_DIR_NAME);
  try {
    await fs.promises.access(mediaDir);
  } catch {
    return [];
  }

  const entries = await fs.promises.readdir(mediaDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_MEDIA_EXTENSIONS.includes(ext)) continue;

    const fullPath = path.join(mediaDir, entry.name);
    const stat = await fs.promises.stat(fullPath);

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

async function withMediaLock<T>(
  appIds: number[],
  fn: () => Promise<T>,
): Promise<T> {
  const uniqueSortedIds = [...new Set(appIds)].sort((a, b) => a - b);

  const runWithLock = async (index: number): Promise<T> => {
    if (index >= uniqueSortedIds.length) {
      return fn();
    }

    return withLock(`media:${uniqueSortedIds[index]}`, async () =>
      runWithLock(index + 1),
    );
  };

  return runWithLock(0);
}

function assertSafeFileName(fileName: string): void {
  if (!fileName || fileName.trim().length === 0) {
    throw new Error("File name is required");
  }

  if (fileName !== path.basename(fileName)) {
    throw new Error("Invalid file name");
  }

  if (
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName === "." ||
    fileName === ".." ||
    INVALID_FILE_NAME_CHARS.test(fileName)
  ) {
    throw new Error("Invalid file name");
  }
}

function assertSafeBaseName(baseName: string): string {
  const trimmed = baseName.trim();

  if (!trimmed) {
    throw new Error("New image name is required");
  }

  if (
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed === "." ||
    trimmed === ".." ||
    INVALID_FILE_NAME_CHARS.test(trimmed)
  ) {
    throw new Error("Invalid image name");
  }

  return trimmed;
}

function assertSupportedMediaExtension(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();

  if (!SUPPORTED_MEDIA_EXTENSIONS.includes(extension)) {
    throw new Error("Unsupported media file extension");
  }

  return extension;
}

function getMediaFilePath(appPath: string, fileName: string): string {
  assertSafeFileName(fileName);
  assertSupportedMediaExtension(fileName);
  return safeJoin(appPath, DYAD_MEDIA_DIR_NAME, fileName);
}

function getMediaDirectoryPath(appPath: string): string {
  return path.join(appPath, DYAD_MEDIA_DIR_NAME);
}

async function getAppOrThrow(appId: number) {
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!app) {
    throw new Error("App not found");
  }

  return app;
}

export function registerMediaHandlers() {
  createTypedHandler(mediaContracts.listAllMedia, async () => {
    const allApps = await db.select().from(apps);
    const result = [];

    for (const app of allApps) {
      const appPath = getDyadAppPath(app.path);
      const files = await getMediaFilesForApp(app.id, app.name, appPath);
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

  createTypedHandler(mediaContracts.renameMediaFile, async (_, params) => {
    await withMediaLock([params.appId], async () => {
      const app = await getAppOrThrow(params.appId);
      const appPath = getDyadAppPath(app.path);

      const sourcePath = getMediaFilePath(appPath, params.fileName);
      if (!fs.existsSync(sourcePath)) {
        throw new Error("Media file not found");
      }

      const sourceExtension = assertSupportedMediaExtension(params.fileName);
      const newBaseName = assertSafeBaseName(params.newBaseName);
      const destinationFileName = `${newBaseName}${sourceExtension}`;
      assertSafeFileName(destinationFileName);

      if (destinationFileName === params.fileName) {
        throw new Error("New image name must be different from current name");
      }

      const destinationPath = safeJoin(
        appPath,
        DYAD_MEDIA_DIR_NAME,
        destinationFileName,
      );

      if (fs.existsSync(destinationPath)) {
        throw new Error("A media file with that name already exists");
      }

      fs.renameSync(sourcePath, destinationPath);
      logger.log(`Renamed media file: ${sourcePath} -> ${destinationPath}`);
    });
  });

  createTypedHandler(mediaContracts.deleteMediaFile, async (_, params) => {
    await withMediaLock([params.appId], async () => {
      const app = await getAppOrThrow(params.appId);
      const appPath = getDyadAppPath(app.path);
      const filePath = getMediaFilePath(appPath, params.fileName);

      if (!fs.existsSync(filePath)) {
        throw new Error("Media file not found");
      }

      fs.unlinkSync(filePath);
      logger.log(`Deleted media file: ${filePath}`);
    });
  });

  createTypedHandler(mediaContracts.moveMediaFile, async (_, params) => {
    if (params.sourceAppId === params.targetAppId) {
      throw new Error("Source and target apps must be different");
    }

    await withMediaLock([params.sourceAppId, params.targetAppId], async () => {
      const sourceApp = await getAppOrThrow(params.sourceAppId);
      const targetApp = await getAppOrThrow(params.targetAppId);

      const sourceAppPath = getDyadAppPath(sourceApp.path);
      const targetAppPath = getDyadAppPath(targetApp.path);

      const sourcePath = getMediaFilePath(sourceAppPath, params.fileName);
      if (!fs.existsSync(sourcePath)) {
        throw new Error("Media file not found");
      }

      const targetMediaDirectoryPath = getMediaDirectoryPath(targetAppPath);
      fs.mkdirSync(targetMediaDirectoryPath, { recursive: true });

      const destinationPath = safeJoin(
        targetAppPath,
        DYAD_MEDIA_DIR_NAME,
        params.fileName,
      );

      if (fs.existsSync(destinationPath)) {
        throw new Error(
          `Target app already has a media file named "${params.fileName}"`,
        );
      }

      // Using copy+delete instead of rename to support cross-device moves
      fs.copyFileSync(sourcePath, destinationPath);
      try {
        fs.unlinkSync(sourcePath);
      } catch (e) {
        // Clean up destination to avoid duplicates
        try {
          fs.unlinkSync(destinationPath);
        } catch {}
        throw e;
      }

      logger.log(`Moved media file: ${sourcePath} -> ${destinationPath}`);
    });
  });
}
