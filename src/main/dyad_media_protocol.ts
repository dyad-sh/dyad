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

  let realTargetDir: string;
  let realCandidatePath: string;
  try {
    [realTargetDir, realCandidatePath] = await Promise.all([
      fs.realpath(targetDir),
      fs.realpath(candidatePath),
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new MediaThumbnailError("Not Found", 404);
    }
    throw error;
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

      // Format: dyad-media://media/{app-path}/.dyad/{subdir}/{filename}
      const pathSegments = url.pathname.slice(1).split("/");
      const allowedSubdirs = [DYAD_MEDIA_SUBDIR, DYAD_SCREENSHOT_SUBDIR];
      if (
        pathSegments.length !== 4 ||
        pathSegments[1] !== DYAD_INTERNAL_DIR_NAME ||
        !allowedSubdirs.includes(pathSegments[2])
      ) {
        return response(403, "Forbidden");
      }

      const appPathRaw = decodeURIComponent(pathSegments[0]);
      const subdir = pathSegments[2];
      const filename = decodeURIComponent(pathSegments[3]);
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
        resolveAppPath(appPathRaw),
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
      const responseBody = thumbnail.data.buffer.slice(
        thumbnail.data.byteOffset,
        thumbnail.data.byteOffset + thumbnail.data.byteLength,
      ) as ArrayBuffer;
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
