// Shared app-naming policy: an app has an expressive display name and a
// filesystem-safe folder name. Folder names derived from display names are
// lowercase slugs; user-typed folder names are safety-sanitized but keep
// their case. Safe for both renderer and IPC-handler imports.

export const MAX_APP_FOLDER_NAME_LENGTH = 80;
export const FALLBACK_FOLDER_NAME = "untitled-app";
export const FALLBACK_DISPLAY_NAME = "Untitled App";

// Characters invalid in Windows file names (also covers `/` for POSIX).
const INVALID_FOLDER_CHARS = /[<>:"|?*/\\]/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f]/;
// Windows reserves these device names regardless of case, including with an
// extension (`CON.txt` is as unusable as `CON`).
const WINDOWS_RESERVED_BASE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// U+0300-U+036F: combining diacritical marks used by accented Latin letters.
const LATIN_COMBINING_MARKS = /[̀-ͯ]/g;

function isWindowsReservedName(name: string): boolean {
  return WINDOWS_RESERVED_BASE.test(name.split(".")[0].trimEnd());
}

// Truncate on code points, not UTF-16 code units, so an emoji or other
// surrogate pair at the boundary is dropped whole rather than split.
function truncateToCodePoints(value: string, max: number): string {
  const codePoints = Array.from(value);
  return codePoints.length <= max ? value : codePoints.slice(0, max).join("");
}

/**
 * Sanitizes a user-facing app name. Display names stay expressive; only
 * whitespace runs and control characters are cleaned up.
 */
export function sanitizeAppDisplayName(name: string): string {
  const sanitized = name
    // Collapse all whitespace (incl. tabs/newlines) before stripping control
    // chars, so a tab becomes a space rather than disappearing entirely.
    .replace(/\s+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, "")
    .trim();
  return sanitized || FALLBACK_DISPLAY_NAME;
}

/**
 * Derives a lowercase, filesystem-safe folder slug from a display name.
 * Always returns a single path segment. Accented Latin characters are
 * transliterated to ASCII (café → cafe); other Unicode letters/digits (CJK,
 * etc.) are preserved so non-English names stay meaningful.
 */
export function slugifyAppFolderName(name: string): string {
  let slug = name
    // Split camelCase / acronym boundaries before lowercasing so `DraftName`
    // becomes `draft-name` (matching slugifyAppPath, which derives GitHub
    // repo / Vercel project name defaults from the same display name).
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    // NFD splits accented Latin letters into base + combining mark; stripping
    // only the Latin combining-mark range (not all of \p{M}) keeps kana/hangul
    // intact, and NFC recomposes what we didn't strip (e.g. ガ survives).
    .normalize("NFD")
    .replace(LATIN_COMBINING_MARKS, "")
    .normalize("NFC")
    .toLowerCase()
    // Anything that isn't a Unicode letter or digit — punctuation, whitespace,
    // symbols, emoji, separators, control chars — collapses to a single dash.
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  slug = truncateToCodePoints(slug, MAX_APP_FOLDER_NAME_LENGTH).replace(
    /-+$/g,
    "",
  );
  if (!slug) {
    return FALLBACK_FOLDER_NAME;
  }
  if (isWindowsReservedName(slug)) {
    return `${slug}-app`;
  }
  return slug;
}

/**
 * Safety-sanitizes a user-typed folder name without slugifying it: case and
 * inner punctuation are preserved; only filesystem-unsafe content is fixed.
 */
export function sanitizeAppFolderNameInput(folderName: string): string {
  let sanitized = folderName
    .replace(/[<>:"|?*/\\]/g, "-")
    .replace(/\s+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, "")
    .replace(/-{2,}/g, "-")
    .trim()
    // Leading/trailing dashes and periods are trimmed; trailing periods and
    // spaces are invalid on Windows, and stripping leading periods avoids
    // hidden folders (and turns `.`/`..` into the empty-name fallback).
    .replace(/^[-. ]+|[-. ]+$/g, "");
  sanitized = truncateToCodePoints(
    sanitized,
    MAX_APP_FOLDER_NAME_LENGTH,
  ).replace(/[-. ]+$/g, "");
  if (!sanitized) {
    return FALLBACK_FOLDER_NAME;
  }
  if (isWindowsReservedName(sanitized)) {
    return `${sanitized}-app`;
  }
  return sanitized;
}

/**
 * Validates that a folder name is filesystem-safe on macOS, Windows, and
 * POSIX. Deliberately does NOT enforce lowercase-slug format — legacy folders
 * like `My Awesome App` and user-chosen mixed-case folders are valid.
 * Returns an error message, or null when the name is valid.
 */
export function validateAppFolderName(folderName: string): string | null {
  if (!folderName || !folderName.trim()) {
    return "Folder name cannot be empty.";
  }
  if (folderName === "." || folderName === "..") {
    return `"${folderName}" is not a valid folder name.`;
  }
  if (INVALID_FOLDER_CHARS.test(folderName) || CONTROL_CHARS.test(folderName)) {
    return `Folder name "${folderName}" contains characters that are not allowed in folder names: < > : " | ? * / \\ or control characters.`;
  }
  if (folderName !== folderName.trim()) {
    return "Folder name cannot start or end with whitespace.";
  }
  if (/[. ]$/.test(folderName)) {
    return "Folder name cannot end with a period.";
  }
  if (isWindowsReservedName(folderName)) {
    return `"${folderName}" is a reserved name on Windows and cannot be used as a folder name.`;
  }
  if (Array.from(folderName).length > MAX_APP_FOLDER_NAME_LENGTH) {
    return `Folder name is too long (maximum ${MAX_APP_FOLDER_NAME_LENGTH} characters).`;
  }
  return null;
}

/**
 * Appends a numeric collision suffix, shortening the base first so the suffix
 * always fits within the length limit and is never truncated away.
 * Suffix 1 means "no suffix" (the base name itself).
 */
export function appFolderNameWithSuffix(base: string, suffix: number): string {
  if (suffix <= 1) {
    return base;
  }
  const suffixText = `-${suffix}`;
  const truncated = truncateToCodePoints(
    base,
    MAX_APP_FOLDER_NAME_LENGTH - suffixText.length,
  ).replace(/-+$/g, "");
  return `${truncated}${suffixText}`;
}
