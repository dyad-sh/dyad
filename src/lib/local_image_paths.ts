/**
 * Finds local image files referenced in assistant text.
 *
 * Agents that generate images often reply with the file path rather than the
 * image itself. Showing that raw path is useless in a chat, so these paths are
 * pulled out and rendered as thumbnails instead.
 */

const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "svg",
  "bmp",
];

const EXTENSION_GROUP = IMAGE_EXTENSIONS.join("|");

/**
 * Absolute POSIX paths and file:// URLs ending in an image extension.
 * Deliberately not matching bare relative names: too many false positives on
 * ordinary prose like "see diagram.png".
 */
const IMAGE_PATH_PATTERN = new RegExp(
  String.raw`(?:file://)?(/(?:[^\s"'<>()\[\]]|\\ )+\.(?:${EXTENSION_GROUP}))`,
  "gi",
);

/** Trailing punctuation that belongs to the sentence, not the filename. */
function trimTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:!?)\]]+$/g, "");
}

export function extractLocalImagePaths(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const match of text.matchAll(IMAGE_PATH_PATTERN)) {
    const candidate = trimTrailingPunctuation(match[1]).replace(/\\ /g, " ");
    if (
      candidate.length > 1 &&
      !found.includes(candidate) &&
      // A markdown image already renders on its own.
      !text.includes(`](${candidate})`)
    ) {
      found.push(candidate);
    }
  }
  return found;
}

/**
 * The same text with those paths removed, so a chat bubble does not repeat
 * what the thumbnail already shows. Lines that held nothing but a path (with
 * optional bullet or label) disappear entirely.
 */
export function stripLocalImagePaths(text: string, paths: string[]): string {
  if (paths.length === 0) return text;

  let result = text;
  for (const imagePath of paths) {
    const escaped = imagePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Whole line: an optional bullet/label, then just the path. The line
    // ending goes too, so a removed line does not become a blank paragraph.
    result = result.replace(
      new RegExp(
        String.raw`^[ \t]*(?:[-*]\s*)?(?:[\w \t]{0,40}:)?[ \t]*(?:file://)?${escaped}[ \t]*\r?\n?`,
        "gim",
      ),
      "",
    );
    result = result.replace(new RegExp(`(?:file://)?${escaped}`, "g"), "");
  }

  return result
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
