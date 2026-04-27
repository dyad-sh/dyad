import path from "node:path";

/**
 * The root ".dyad" directory within each app that holds Dyad-managed files.
 */
export const DYAD_INTERNAL_DIR_NAME = ".dyad";

/**
 * The ".dyad"-relative subdir for uploaded media files.
 */
export const DYAD_MEDIA_SUBDIR = "media";

/**
 * The ".dyad"-relative subdir for screenshot files.
 */
export const DYAD_SCREENSHOT_SUBDIR = "screenshot";

/**
 * The subdirectory within each app where uploaded media files are stored.
 */
export const DYAD_MEDIA_DIR_NAME = `${DYAD_INTERNAL_DIR_NAME}/${DYAD_MEDIA_SUBDIR}`;

/**
 * The subdirectory within each app where screenshot files are stored.
 */
export const DYAD_SCREENSHOT_DIR_NAME = `${DYAD_INTERNAL_DIR_NAME}/${DYAD_SCREENSHOT_SUBDIR}`;

/**
 * Maximum number of per-commit screenshots retained per app.
 */
export const MAX_SCREENSHOTS_PER_APP = 100;

/**
 * Matches a screenshot filename keyed by a 40-char hex SHA-1 commit hash.
 */
export const SCREENSHOT_FILENAME_REGEX = /^[0-9a-f]{40}\.png$/;

/**
 * Check if an absolute path falls within the app's .dyad/media directory.
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

/**
 * Check if an absolute path is a file inside a .dyad/media directory
 * (without requiring a known app path). Validates by finding consecutive
 * ".dyad" + "media" path segments with at least one segment (filename) after,
 * then confirms the resolved path doesn't escape via ".." traversal.
 */
export function isFileWithinAnyDyadMediaDir(absPath: string): boolean {
  const resolved = path.resolve(absPath);
  const segments = resolved.split(path.sep);

  let mediaIdx = -1;
  for (let i = 0; i < segments.length - 2; i++) {
    if (segments[i] === ".dyad" && segments[i + 1] === "media") {
      mediaIdx = i + 1;
      break;
    }
  }
  if (mediaIdx === -1) {
    return false;
  }

  const mediaDirPath = segments.slice(0, mediaIdx + 1).join(path.sep);
  const relativePath = path.relative(mediaDirPath, resolved);
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}
