import path from "node:path";

/**
 * The subdirectory within each app where uploaded media files are stored.
 */
export const DYAD_MEDIA_DIR_NAME = "dyad-media";

/**
 * Check if an absolute path falls within the app's dyad-media directory.
 * Used to validate that file copy operations only read from the allowed media dir.
 */
export function isWithinDyadMediaDir(
  absPath: string,
  appPath: string,
): boolean {
  const resolved = path.resolve(absPath);
  const resolvedMediaDir = path.resolve(
    path.join(appPath, DYAD_MEDIA_DIR_NAME),
  );
  const relativePath = path.relative(resolvedMediaDir, resolved);
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}
