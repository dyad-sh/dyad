import path from "node:path";

/**
 * Resolve and validate that `directory` stays within `appPath`.
 *
 * Why not `startsWith`?
 * - On Windows, `path.resolve` normalizes to backslashes, while stored `appPath`
 *   values may contain forward slashes. A string `startsWith` check can then
 *   falsely reject valid subdirectories.
 *
 * This uses `path.relative` instead, and treats Windows paths as case-insensitive.
 */
export function resolveDirectoryWithinAppPath(params: {
  appPath: string;
  directory: string;
}): string {
  // Disallow any ".." path segment (even if the resolved path would remain within root).
  // This makes path traversal attempts explicit and avoids surprising "a/../b" style inputs.
  if (/(^|[\\/])\.\.([\\/]|$)/.test(params.directory)) {
    throw new Error(
      `Invalid directory path: "${params.directory}" contains ".." path traversal segment`,
    );
  }

  // We sometimes persist Windows paths with forward slashes (e.g. "C:/..."),
  // so detect win32-style roots and use win32 semantics for the safety check.
  const looksLikeWin32Path =
    /^[a-zA-Z]:[\\/]/.test(params.appPath) ||
    params.appPath.startsWith("\\\\") ||
    params.appPath.includes("\\");

  const pathImpl = looksLikeWin32Path ? path.win32 : path.posix;
  const caseInsensitive = looksLikeWin32Path;

  const resolvedAppPath = pathImpl.resolve(params.appPath);
  const resolvedPath = pathImpl.resolve(resolvedAppPath, params.directory);

  const appForCheck = caseInsensitive
    ? resolvedAppPath.toLowerCase()
    : resolvedAppPath;
  const targetForCheck = caseInsensitive
    ? resolvedPath.toLowerCase()
    : resolvedPath;

  const relForCheck = pathImpl.relative(appForCheck, targetForCheck);

  const isWithinRoot =
    relForCheck === "" ||
    (!relForCheck.startsWith(`..${pathImpl.sep}`) &&
      relForCheck !== ".." &&
      !pathImpl.isAbsolute(relForCheck));

  if (!isWithinRoot) {
    throw new Error(
      `Invalid directory path: "${params.directory}" escapes the project directory`,
    );
  }

  return pathImpl.relative(resolvedAppPath, resolvedPath);
}
