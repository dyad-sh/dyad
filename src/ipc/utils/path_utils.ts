import fs from "node:fs";
import path from "node:path";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { normalizePath } from "../../../shared/normalizePath";

/**
 * Safely joins paths while ensuring the result stays within the base directory.
 * This prevents directory traversal attacks where malicious paths like "../../etc/passwd"
 * could be used to access files outside the intended directory.
 *
 * @param basePath The base directory that should contain the result
 * @param ...paths Path segments to join with the base path
 * @returns The joined path if it's within the base directory
 * @throws Error if the resulting path would be outside the base directory
 */
export function safeJoin(basePath: string, ...paths: string[]): string {
  // Normalize backslashes to forward slashes for cross-platform consistency
  const normalizedPaths = paths.map((p) => normalizePath(p));

  // Check if any of the path segments are absolute paths (which would be unsafe)
  for (const pathSegment of normalizedPaths) {
    if (path.isAbsolute(pathSegment)) {
      throw new DyadError(
        `Unsafe path: joining "${paths.join(", ")}" with base "${basePath}" would escape the base directory`,
        DyadErrorKind.Validation,
      );
    }
    // Also check for home directory shortcuts which are effectively absolute
    if (pathSegment.startsWith("~/")) {
      throw new DyadError(
        `Unsafe path: joining "${paths.join(", ")}" with base "${basePath}" would escape the base directory`,
        DyadErrorKind.Validation,
      );
    }
    // Check for Windows-style absolute paths (C:\, D:\, etc.)
    if (/^[A-Za-z]:[/\\]/.test(pathSegment)) {
      throw new DyadError(
        `Unsafe path: joining "${paths.join(", ")}" with base "${basePath}" would escape the base directory`,
        DyadErrorKind.Validation,
      );
    }
    // Check for UNC paths (\\server\share)
    if (pathSegment.startsWith("\\\\")) {
      throw new DyadError(
        `Unsafe path: joining "${paths.join(", ")}" with base "${basePath}" would escape the base directory`,
        DyadErrorKind.Validation,
      );
    }
  }

  // Join all the paths
  const joinedPath = path.join(basePath, ...normalizedPaths);

  // Resolve both paths to absolute paths to handle any ".." components
  const resolvedBasePath = path.resolve(basePath);
  const resolvedJoinedPath = path.resolve(joinedPath);

  // Check if the resolved joined path starts with the base path
  // Use path.relative to ensure we're doing a proper path comparison
  const relativePath = path.relative(resolvedBasePath, resolvedJoinedPath);

  // If relativePath starts with ".." or is absolute, then resolvedJoinedPath is outside basePath
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new DyadError(
      `Unsafe path: joining "${paths.join(", ")}" with base "${basePath}" would escape the base directory`,
      DyadErrorKind.Validation,
    );
  }

  return joinedPath;
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function stripTrailingPathSeparators(filePath: string): string {
  const root = path.parse(filePath).root;
  let strippedPath = filePath;
  while (
    strippedPath.length > root.length &&
    (strippedPath.endsWith(path.sep) || strippedPath.endsWith("/"))
  ) {
    strippedPath = strippedPath.slice(0, -1);
  }
  return strippedPath;
}

/**
 * Validate that a mutation path remains inside the app after resolving
 * symlinks, and return the canonical app-relative path to operate on.
 *
 * Most writes follow the final symlink, so that is the default. Operations
 * such as rename and unlink mutate the final directory entry itself; those
 * callers can preserve that entry while still canonicalizing every ancestor.
 */
export async function assertMutationPathAllowed(params: {
  appPath: string;
  relativePath: string;
  followFinalSymlink?: boolean;
}): Promise<string> {
  const realAppPath = await fs.promises.realpath(params.appPath);
  const joinedPath = stripTrailingPathSeparators(
    safeJoin(params.appPath, params.relativePath),
  );
  const followFinalSymlink = params.followFinalSymlink !== false;
  const finalEntryName = followFinalSymlink
    ? undefined
    : path.basename(joinedPath);
  let existing = followFinalSymlink ? joinedPath : path.dirname(joinedPath);
  const missingSegments: string[] = [];
  let realExisting: string;

  for (;;) {
    try {
      realExisting = await fs.promises.realpath(existing);
      break;
    } catch (error) {
      if (!isNodeErrorWithCode(error, "ENOENT")) {
        throw error;
      }
      try {
        const stat = await fs.promises.lstat(existing);
        if (stat.isSymbolicLink()) {
          throw new DyadError(
            `Cannot modify through symlink: ${params.relativePath}`,
            DyadErrorKind.Precondition,
          );
        }
      } catch (lstatError) {
        if (!isNodeErrorWithCode(lstatError, "ENOENT")) {
          throw lstatError;
        }
      }
      const parent = path.dirname(existing);
      if (parent === existing) {
        throw error;
      }
      missingSegments.unshift(path.basename(existing));
      existing = parent;
    }
  }

  const resolvedTarget = path.join(
    realExisting,
    ...missingSegments,
    ...(finalEntryName ? [finalEntryName] : []),
  );
  const relative = path.relative(realAppPath, resolvedTarget);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new DyadError(
      relative === ""
        ? `Cannot modify the app root: ${params.relativePath}`
        : `Cannot modify files outside the app: ${params.relativePath}`,
      DyadErrorKind.Precondition,
    );
  }
  return relative.split(path.sep).join("/");
}

/**
 * Returns whether a model-provided relative path resolves lexically to the
 * project root. The case-insensitive comparison also covers the common
 * case-insensitive macOS and Windows filesystems.
 */
export function isProjectRootPath(
  basePath: string,
  inputPath: string,
): boolean {
  const resolvedBasePath = path.resolve(basePath);
  const resolvedTargetPath = path.resolve(
    path.join(basePath, normalizePath(inputPath)),
  );
  return resolvedTargetPath.toLowerCase() === resolvedBasePath.toLowerCase();
}

export function assertNotProjectRootPath(
  basePath: string,
  inputPath: string,
): void {
  if (isProjectRootPath(basePath, inputPath)) {
    throw new DyadError(
      `Refusing to delete project root for path: "${inputPath}"`,
      DyadErrorKind.Validation,
    );
  }
  safeJoin(basePath, inputPath);
}

export interface PreparedDeletePath {
  /** Canonical project-relative path to the physical entry being removed. */
  relativePath: string;
  /** Canonical absolute path to the physical entry being removed. */
  fullPath: string;
}

/**
 * Canonically validate a delete target while preserving a final symlink as
 * the directory entry to unlink. Symlinked ancestors must remain contained.
 */
export async function prepareDeletePath(
  basePath: string,
  inputPath: string,
): Promise<PreparedDeletePath> {
  assertNotProjectRootPath(basePath, inputPath);
  const relativePath = path.posix
    .normalize(normalizePath(inputPath))
    .replace(/\/+$/, "");
  const canonicalRelativePath = await assertMutationPathAllowed({
    appPath: basePath,
    relativePath,
    followFinalSymlink: false,
  });
  const realBasePath = await fs.promises.realpath(basePath);

  return {
    relativePath: canonicalRelativePath,
    fullPath: path.join(realBasePath, ...canonicalRelativePath.split("/")),
  };
}
