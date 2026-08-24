import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDotenvFilePath } from "@/utils/dotenv_redaction";

export const TEMP_PREVIEW_MAX_FILES = 100;
export const TEMP_PREVIEW_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const TEMP_PREVIEW_MAX_BUNDLE_BYTES = 50 * 1024 * 1024;

const SENSITIVE_BUNDLE_PATH_PATTERNS = [
  /(^|\/)(?:\.git|\.ssh|\.aws|\.azure|\.kube|\.docker|\.config\/gcloud)(?:\/|$)/i,
  /(^|\/)(?:\.npmrc|\.yarnrc(?:\.yml)?|\.pypirc|\.netrc|\.git-credentials)$/i,
  /(^|\/)id_(?:rsa|dsa|ecdsa|ed25519|xmss)(?:_sk)?$/i,
  /\.(?:key|pem|ppk|p12|pfx|jks|keystore|kdbx)$/i,
  /(^|\/)(?:credentials(?:\.json|\.ya?ml|\.toml)?|secrets?\.(?:json|ya?ml|toml))$/i,
  /(^|\/)(?:(?:[^/]+[-_])?service[-_]?account(?:[-_]?key)?|private[-_]?key)\.json$/i,
  /(^|\/)[^/]*firebase-adminsdk[^/]*\.json$/i,
  /(^|\/)client_secrets?(?:_[^/]+)?\.json$/i,
  /(^|\/)application_default_credentials\.json$/i,
];

export interface TempPreviewBundleFile {
  path: string;
  size: number;
  contentType: string;
  hash: string;
  contents: Uint8Array<ArrayBuffer>;
}

interface DiscoveredBundleFile {
  absolutePath: string;
  root: BundleRootIdentity;
  path: string;
  size: number;
  contentType: string;
  metadata: Stats;
}

interface BundleRootIdentity {
  absolutePath: string;
  realPath: string;
  metadata: Stats;
}

export async function discoverTempPreviewBundle(
  sourcePath: string,
  options: { beforeTraversal?: () => Promise<void> } = {},
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
  const sourceRealPath = await realpath(source);
  const currentSourceStat = await lstat(source);
  if (
    currentSourceStat.isSymbolicLink() ||
    !currentSourceStat.isDirectory() ||
    !isSameFile(sourceStat, currentSourceStat)
  ) {
    throw bundleFileChangedError("The build output");
  }
  const root: BundleRootIdentity = {
    absolutePath: source,
    realPath: sourceRealPath,
    metadata: sourceStat,
  };

  const paths: string[] = [];
  await options.beforeTraversal?.();
  await assertRootUnchanged(root);
  await walk(source, source, root, paths);
  await assertRootUnchanged(root);
  paths.sort((a, b) => a.localeCompare(b));

  if (!paths.includes("index.html")) {
    throw new Error(
      "The build did not produce dist/index.html. Temporary previews currently support static Vite apps only.",
    );
  }

  const discovered: DiscoveredBundleFile[] = [];
  let totalBytes = 0;
  for (const bundlePath of paths) {
    await assertRootUnchanged(root);
    const absolutePath = join(source, ...bundlePath.split("/"));
    await assertPathContained(sourceRealPath, absolutePath, bundlePath);
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
      root,
      path: bundlePath,
      size: metadata.size,
      contentType: contentTypeFor(absolutePath),
      metadata,
    });
    await assertRootUnchanged(root);
  }

  const files: TempPreviewBundleFile[] = [];
  for (const file of discovered) {
    await assertRootUnchanged(root);
    files.push(await snapshotFile(file));
    await assertRootUnchanged(root);
  }
  await assertRootUnchanged(root);
  return files;
}

async function walk(
  root: string,
  directory: string,
  rootIdentity: BundleRootIdentity,
  paths: string[],
): Promise<void> {
  await assertRootUnchanged(rootIdentity);
  const directoryPath = toPosix(relative(root, directory));
  const displayPath = directoryPath || "The build output";
  const beforeMetadata = await lstat(directory);
  if (beforeMetadata.isSymbolicLink() || !beforeMetadata.isDirectory()) {
    throw bundleFileChangedError(displayPath);
  }
  await assertPathContained(rootIdentity.realPath, directory, displayPath);
  const entries = await readdir(directory, { withFileTypes: true });
  const afterMetadata = await lstat(directory);
  await assertPathContained(rootIdentity.realPath, directory, displayPath);
  if (!isSameFile(beforeMetadata, afterMetadata)) {
    throw bundleFileChangedError(displayPath);
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;

    const absolutePath = join(directory, entry.name);
    const bundlePath = toPosix(relative(root, absolutePath));
    if (entry.isDirectory()) {
      await walk(root, absolutePath, rootIdentity, paths);
      continue;
    }
    if (!entry.isFile()) continue;

    if (isSensitiveBundlePath(bundlePath)) {
      throw new Error(
        `Temporary preview blocked because ${bundlePath} looks like a credential or secret file. Remove it from dist and retry.`,
      );
    }

    paths.push(bundlePath);
    if (paths.length > TEMP_PREVIEW_MAX_FILES) {
      throw new Error(
        `The build contains more than ${TEMP_PREVIEW_MAX_FILES} files, which is the temporary preview limit.`,
      );
    }
  }
  await assertRootUnchanged(rootIdentity);
}

function isSensitiveBundlePath(bundlePath: string): boolean {
  return (
    isDotenvFilePath(bundlePath) ||
    SENSITIVE_BUNDLE_PATH_PATTERNS.some((pattern) => pattern.test(bundlePath))
  );
}

async function snapshotFile(
  file: DiscoveredBundleFile,
): Promise<TempPreviewBundleFile> {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  let handle;
  try {
    await assertRootUnchanged(file.root);
    await assertPathContained(file.root.realPath, file.absolutePath, file.path);
    handle = await open(file.absolutePath, constants.O_RDONLY | noFollow);
    const [openedMetadata, currentPathMetadata, currentRealPath] =
      await Promise.all([
        handle.stat(),
        lstat(file.absolutePath),
        realpath(file.absolutePath),
      ]);
    if (
      !openedMetadata.isFile() ||
      !currentPathMetadata.isFile() ||
      currentPathMetadata.isSymbolicLink() ||
      !isSameFile(file.metadata, openedMetadata) ||
      !isSameFile(openedMetadata, currentPathMetadata) ||
      !isPathContained(file.root.realPath, currentRealPath) ||
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
    const [finalMetadata, finalRealPath] = await Promise.all([
      handle.stat(),
      realpath(file.absolutePath),
    ]);
    if (
      offset !== file.size ||
      finalMetadata.size !== file.size ||
      !isSameFile(openedMetadata, finalMetadata) ||
      !isPathContained(file.root.realPath, finalRealPath)
    ) {
      throw bundleFileChangedError(file.path);
    }
    await assertRootUnchanged(file.root);

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

async function assertRootUnchanged(root: BundleRootIdentity): Promise<void> {
  try {
    const [metadata, currentRealPath] = await Promise.all([
      lstat(root.absolutePath),
      realpath(root.absolutePath),
    ]);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      !isSameFile(root.metadata, metadata) ||
      relative(root.realPath, currentRealPath) !== ""
    ) {
      throw bundleFileChangedError("The build output");
    }
  } catch (error) {
    if (isFileReplacementError(error)) {
      throw bundleFileChangedError("The build output", error);
    }
    throw error;
  }
}

async function assertPathContained(
  rootRealPath: string,
  candidatePath: string,
  displayPath: string,
): Promise<void> {
  let candidateRealPath: string;
  try {
    candidateRealPath = await realpath(candidatePath);
  } catch (error) {
    if (isFileReplacementError(error)) {
      throw bundleFileChangedError(displayPath, error);
    }
    throw error;
  }
  if (!isPathContained(rootRealPath, candidateRealPath)) {
    throw bundleFileChangedError(displayPath);
  }
}

function isPathContained(rootRealPath: string, candidateRealPath: string) {
  const relativePath = relative(rootRealPath, candidateRealPath);
  return (
    relativePath === "" ||
    (!isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`))
  );
}

function isSameFile(first: Stats, second: Stats): boolean {
  return (
    first.dev === second.dev &&
    first.ino === second.ino &&
    first.size === second.size &&
    first.mtimeMs === second.mtimeMs &&
    first.ctimeMs === second.ctimeMs
  );
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
