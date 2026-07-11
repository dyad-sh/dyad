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

async function resolveThroughDeepestExistingAncestor(
  targetPath: string,
  displayPath: string,
): Promise<string> {
  let existingPath = targetPath;
  const missingSegments: string[] = [];

  for (;;) {
    try {
      const realExistingPath = await fs.promises.realpath(existingPath);
      return path.join(realExistingPath, ...missingSegments);
    } catch (error) {
      if (!isNodeErrorWithCode(error, "ENOENT")) {
        throw error;
      }

      try {
        const stat = await fs.promises.lstat(existingPath);
        if (stat.isSymbolicLink()) {
          throw new DyadError(
            `Agent tools cannot modify through an unresolved symlink: ${displayPath}`,
            DyadErrorKind.Precondition,
          );
        }
      } catch (lstatError) {
        if (!isNodeErrorWithCode(lstatError, "ENOENT")) {
          throw lstatError;
        }
      }

      const parentPath = path.dirname(existingPath);
      if (parentPath === existingPath) {
        throw error;
      }
      missingSegments.unshift(path.basename(existingPath));
      existingPath = parentPath;
    }
  }
}

function isPathWithin(parentPath: string, targetPath: string): boolean {
  const relativePath = path.relative(parentPath, targetPath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

function hasGitMetadataPathComponent(relativePath: string): boolean {
  return normalizePath(relativePath)
    .split("/")
    .some(
      (component) =>
        // Win32 aliases path components with trailing dots/spaces to the same
        // on-disk name. Reject those spellings on every platform so the
        // policy does not depend on the host that happens to run a test.
        component.replace(/[ .]+$/u, "").toLowerCase() === ".git",
    );
}

async function canonicalizePathIfPresent(filePath: string): Promise<string> {
  try {
    return await fs.promises.realpath(filePath);
  } catch (error) {
    if (!isNodeErrorWithCode(error, "ENOENT")) {
      throw error;
    }
    return path.resolve(filePath);
  }
}

async function getGitMetadataRoots(realAppPath: string): Promise<string[]> {
  const dotGitPath = path.join(realAppPath, ".git");
  const realDotGitPath = await canonicalizePathIfPresent(dotGitPath);
  const roots = [realDotGitPath];

  let dotGitStat: fs.Stats;
  try {
    dotGitStat = await fs.promises.stat(realDotGitPath);
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return roots;
    }
    throw error;
  }

  let gitDirectoryPath = realDotGitPath;
  if (dotGitStat.isFile()) {
    const gitFile = await fs.promises.readFile(realDotGitPath, "utf8");
    const gitDirectoryMatch = /^gitdir:\s*(.+?)\s*$/imu.exec(gitFile);
    if (!gitDirectoryMatch?.[1]) {
      throw new DyadError(
        "Agent tools cannot safely resolve the repository Git metadata directory",
        DyadErrorKind.Precondition,
      );
    }
    gitDirectoryPath = await canonicalizePathIfPresent(
      path.resolve(path.dirname(realDotGitPath), gitDirectoryMatch[1]),
    );
    roots.push(gitDirectoryPath);
  }

  const commonDirectoryFile = path.join(gitDirectoryPath, "commondir");
  try {
    const commonDirectory = (
      await fs.promises.readFile(commonDirectoryFile, "utf8")
    ).trim();
    if (commonDirectory) {
      roots.push(
        await canonicalizePathIfPresent(
          path.resolve(gitDirectoryPath, commonDirectory),
        ),
      );
    }
  } catch (error) {
    if (!isNodeErrorWithCode(error, "ENOENT")) {
      throw error;
    }
  }

  return [...new Set(roots)];
}

/** Prevent automated file tools from modifying Git's repository metadata. */
export async function assertPathNotGitMetadata(params: {
  appPath: string;
  relativePath: string;
}): Promise<void> {
  if (hasGitMetadataPathComponent(params.relativePath)) {
    throw new DyadError(
      `Agent tools cannot modify Git metadata: ${params.relativePath}`,
      DyadErrorKind.Precondition,
    );
  }

  const realAppPath = await fs.promises.realpath(params.appPath);
  const gitMetadataRoots = await getGitMetadataRoots(realAppPath);

  const targetPath = safeJoin(params.appPath, params.relativePath);
  const resolvedTargetPath = await resolveThroughDeepestExistingAncestor(
    targetPath,
    params.relativePath,
  );
  if (
    gitMetadataRoots.some((metadataRoot) =>
      isPathWithin(metadataRoot, resolvedTargetPath),
    )
  ) {
    throw new DyadError(
      `Agent tools cannot modify Git metadata: ${params.relativePath}`,
      DyadErrorKind.Precondition,
    );
  }
}
