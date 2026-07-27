import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  DYAD_INTERNAL_DIR_NAME,
  DYAD_MEDIA_SUBDIR,
  DYAD_SCREENSHOT_SUBDIR,
} from "../ipc/utils/media_path_utils";
import {
  createMediaThumbnailService,
  MediaThumbnailError,
  type CreateThumbnailFromPath,
} from "../ipc/utils/media_thumbnail";

type DyadMediaProtocolDependencies = {
  cacheRoot: string;
  resolveAppPath: (appPath: string) => string;
  resolveAppId: (appId: number) => Promise<string | null>;
  fetchFile: (url: string) => Promise<Response>;
  createThumbnailFromPath: CreateThumbnailFromPath;
};

function response(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function resolveContainedMediaPath(
  appPath: string,
  subdir: string,
  filename: string,
): Promise<{ sourcePath: string; cacheKeyPath: string }> {
  const targetDir = path.resolve(
    path.join(appPath, DYAD_INTERNAL_DIR_NAME, subdir),
  );
  const candidatePath = path.resolve(path.join(targetDir, filename));
  const relativeCandidate = path.relative(targetDir, candidatePath);
  if (
    relativeCandidate.startsWith("..") ||
    path.isAbsolute(relativeCandidate)
  ) {
    throw new MediaThumbnailError("Forbidden", 403);
  }

  let realAppPath: string;
  let realTargetDir: string;
  let realCandidatePath: string;
  try {
    [realAppPath, realTargetDir, realCandidatePath] = await Promise.all([
      fs.realpath(appPath),
      fs.realpath(targetDir),
      fs.realpath(candidatePath),
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new MediaThumbnailError("Not Found", 404);
    }
    throw error;
  }

  // Do not let .dyad or its media subdirectory redirect the protocol to a
  // different directory through a symlink.
  const expectedTargetDir = path.resolve(
    realAppPath,
    DYAD_INTERNAL_DIR_NAME,
    subdir,
  );
  if (path.relative(expectedTargetDir, realTargetDir) !== "") {
    throw new MediaThumbnailError("Forbidden", 403);
  }

  // Prevent a symlink inside .dyad/media from escaping the app directory.
  const relativeRealPath = path.relative(realTargetDir, realCandidatePath);
  if (relativeRealPath.startsWith("..") || path.isAbsolute(relativeRealPath)) {
    throw new MediaThumbnailError("Forbidden", 403);
  }

  return { sourcePath: realCandidatePath, cacheKeyPath: candidatePath };
}

export function createDyadMediaProtocolHandler({
  cacheRoot,
  resolveAppPath,
  resolveAppId,
  fetchFile,
  createThumbnailFromPath,
}: DyadMediaProtocolDependencies) {
  const thumbnailService = createMediaThumbnailService({
    cacheRoot,
    createThumbnailFromPath,
  });

  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (url.protocol !== "dyad-media:" || url.hostname !== "media") {
        return response(403, "Forbidden");
      }

      // Formats:
      // dyad-media://media/{app-path}/.dyad/{subdir}/{filename}
      // dyad-media://media/app-id/{id}/.dyad/{subdir}/{filename}
      const pathSegments = url.pathname.slice(1).split("/");
      const allowedSubdirs = [DYAD_MEDIA_SUBDIR, DYAD_SCREENSHOT_SUBDIR];
      const usesAppId = pathSegments[0] === "app-id";
      const internalDirIndex = usesAppId ? 2 : 1;
      const subdirIndex = internalDirIndex + 1;
      const filenameIndex = internalDirIndex + 2;
      if (
        pathSegments.length !== filenameIndex + 1 ||
        pathSegments[internalDirIndex] !== DYAD_INTERNAL_DIR_NAME ||
        !allowedSubdirs.includes(pathSegments[subdirIndex])
      ) {
        return response(403, "Forbidden");
      }

      let appPath: string;
      if (usesAppId) {
        const appId = Number(pathSegments[1]);
        if (!Number.isSafeInteger(appId) || appId <= 0) {
          return response(403, "Forbidden");
        }
        const resolvedAppPath = await resolveAppId(appId);
        if (!resolvedAppPath) return response(404, "Not Found");
        appPath = resolvedAppPath;
      } else {
        appPath = resolveAppPath(decodeURIComponent(pathSegments[0]));
      }
      const subdir = pathSegments[subdirIndex];
      const filename = decodeURIComponent(pathSegments[filenameIndex]);
      if (
        !filename ||
        filename.includes("..") ||
        filename.includes("/") ||
        filename.includes("\\") ||
        filename.includes("\0")
      ) {
        return response(403, "Forbidden");
      }

      const { sourcePath, cacheKeyPath } = await resolveContainedMediaPath(
        appPath,
        subdir,
        filename,
      );
      const wantsThumbnail = url.searchParams.get("thumbnail") === "1";

      if (!wantsThumbnail) {
        return await fetchFile(pathToFileURL(sourcePath).href);
      }
      if (subdir !== DYAD_MEDIA_SUBDIR) {
        return response(403, "Forbidden");
      }

      const thumbnail = await thumbnailService.getOrCreate(
        sourcePath,
        cacheKeyPath,
      );
      const requestedVersion = url.searchParams.get("v");
      const responseBody = new Uint8Array(
        thumbnail.data.buffer as ArrayBuffer,
        thumbnail.data.byteOffset,
        thumbnail.data.byteLength,
      );
      return new Response(responseBody, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(thumbnail.data.length),
          "Cache-Control":
            requestedVersion === thumbnail.sourceVersion
              ? "private, max-age=31536000, immutable"
              : "no-store",
          "X-Dyad-Thumbnail-Cache": thumbnail.cacheHit ? "hit" : "miss",
        },
      });
    } catch (error) {
      if (error instanceof MediaThumbnailError) {
        return response(error.status, error.message);
      }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return response(404, "Not Found");
      }
      if (error instanceof URIError || error instanceof TypeError) {
        return response(400, "Bad Request");
      }
      return response(500, "Could not load media");
    }
  };
}
