import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

export const TEMP_PREVIEW_MAX_FILES = 100;
export const TEMP_PREVIEW_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const TEMP_PREVIEW_MAX_BUNDLE_BYTES = 50 * 1024 * 1024;

export interface TempPreviewBundleFile {
  path: string;
  size: number;
  contentType: string;
  hash: string;
  contents: Uint8Array;
}

interface DiscoveredBundleFile {
  absolutePath: string;
  path: string;
  size: number;
  contentType: string;
  metadata: Stats;
}

export async function discoverTempPreviewBundle(
  sourcePath: string,
): Promise<TempPreviewBundleFile[]> {
  const source = resolve(sourcePath);
  let sourceStat;
  try {
    sourceStat = await lstat(source);
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new Error(
        "The build did not produce a dist directory. Temporary previews currently support static Vite apps only.",
        { cause: error },
      );
    }
    throw error;
  }
  if (sourceStat.isSymbolicLink()) {
    throw new Error(
      "The temporary preview build output must not be a symbolic link.",
    );
  }
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

  const discovered: DiscoveredBundleFile[] = [];
  let totalBytes = 0;
  for (const bundlePath of paths) {
    const absolutePath = join(source, ...bundlePath.split("/"));
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(
        `${bundlePath} changed while the temporary preview was being prepared.`,
      );
    }
    if (metadata.size > TEMP_PREVIEW_MAX_FILE_BYTES) {
      throw new Error(
        `${bundlePath} exceeds the 10 MB temporary preview file limit.`,
      );
    }
    totalBytes += metadata.size;
    if (totalBytes > TEMP_PREVIEW_MAX_BUNDLE_BYTES) {
      throw new Error("The build exceeds the 50 MB temporary preview limit.");
    }
    discovered.push({
      absolutePath,
      path: bundlePath,
      size: metadata.size,
      contentType: contentTypeFor(absolutePath),
      metadata,
    });
  }

  const files: TempPreviewBundleFile[] = [];
  for (const file of discovered) {
    files.push(await snapshotFile(file));
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

async function snapshotFile(
  file: DiscoveredBundleFile,
): Promise<TempPreviewBundleFile> {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  let handle;
  try {
    handle = await open(file.absolutePath, constants.O_RDONLY | noFollow);
    const [openedMetadata, currentPathMetadata] = await Promise.all([
      handle.stat(),
      lstat(file.absolutePath),
    ]);
    if (
      !openedMetadata.isFile() ||
      !currentPathMetadata.isFile() ||
      currentPathMetadata.isSymbolicLink() ||
      !isSameFile(file.metadata, openedMetadata) ||
      !isSameFile(openedMetadata, currentPathMetadata) ||
      openedMetadata.size !== file.size
    ) {
      throw bundleFileChangedError(file.path);
    }

    const contents = Buffer.alloc(file.size);
    let offset = 0;
    while (offset < contents.length) {
      const { bytesRead } = await handle.read(
        contents,
        offset,
        contents.length - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const finalMetadata = await handle.stat();
    if (
      offset !== file.size ||
      finalMetadata.size !== file.size ||
      !isSameFile(openedMetadata, finalMetadata)
    ) {
      throw bundleFileChangedError(file.path);
    }

    return {
      path: file.path,
      size: file.size,
      contentType: file.contentType,
      hash: createHash("sha256").update(contents).digest("hex"),
      contents,
    };
  } catch (error) {
    if (isFileReplacementError(error)) {
      throw bundleFileChangedError(file.path, error);
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

function isSameFile(first: Stats, second: Stats): boolean {
  return first.dev === second.dev && first.ino === second.ino;
}

function bundleFileChangedError(path: string, cause?: unknown): Error {
  return new Error(
    `${path} changed while the temporary preview was being prepared.`,
    cause === undefined ? undefined : { cause },
  );
}

function isFileReplacementError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ELOOP" || error.code === "ENOENT")
  );
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
    ".wasm": "application/wasm",
  };
  return types[extension] ?? "application/octet-stream";
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function toPosix(filePath: string): string {
  return sep === "/" ? filePath : filePath.split(sep).join("/");
}
