import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

export const TEMP_PREVIEW_MAX_FILES = 100;
export const TEMP_PREVIEW_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const TEMP_PREVIEW_MAX_BUNDLE_BYTES = 50 * 1024 * 1024;

export interface TempPreviewBundleFile {
  absolutePath: string;
  path: string;
  size: number;
  contentType: string;
  hash: string;
}

export async function discoverTempPreviewBundle(
  sourcePath: string,
): Promise<TempPreviewBundleFile[]> {
  const source = resolve(sourcePath);
  const sourceStat = await stat(source);
  if (!sourceStat.isDirectory()) {
    throw new Error("The temporary preview build output is not a directory.");
  }

  const paths: string[] = [];
  await walk(source, source, paths);
  paths.sort((a, b) => a.localeCompare(b));

  if (!paths.includes("index.html")) {
    throw new Error(
      "The build did not produce dist/index.html. Temporary previews currently support static Vite apps only.",
    );
  }

  const files = await Promise.all(
    paths.map(async (bundlePath) => {
      const absolutePath = join(source, ...bundlePath.split("/"));
      const metadata = await stat(absolutePath);
      if (metadata.size > TEMP_PREVIEW_MAX_FILE_BYTES) {
        throw new Error(
          `${bundlePath} exceeds the 10 MB temporary preview file limit.`,
        );
      }
      return {
        absolutePath,
        path: bundlePath,
        size: metadata.size,
        contentType: contentTypeFor(absolutePath),
        hash: await hashFile(absolutePath),
      };
    }),
  );

  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > TEMP_PREVIEW_MAX_BUNDLE_BYTES) {
    throw new Error("The build exceeds the 50 MB temporary preview limit.");
  }

  return files;
}

async function walk(
  root: string,
  directory: string,
  paths: string[],
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;

    const absolutePath = join(directory, entry.name);
    const bundlePath = toPosix(relative(root, absolutePath));
    if (entry.isDirectory()) {
      await walk(root, absolutePath, paths);
      continue;
    }
    if (!entry.isFile()) continue;

    paths.push(bundlePath);
    if (paths.length > TEMP_PREVIEW_MAX_FILES) {
      throw new Error(
        `The build contains more than ${TEMP_PREVIEW_MAX_FILES} files, which is the temporary preview limit.`,
      );
    }
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function contentTypeFor(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".html": "text/html",
    ".htm": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".txt": "text/plain",
    ".xml": "application/xml",
    ".webmanifest": "application/manifest+json",
  };
  return types[extension] ?? "application/octet-stream";
}

function toPosix(filePath: string): string {
  return sep === "/" ? filePath : filePath.split(sep).join("/");
}
