import {
  DIFF_BINARY_PLACEHOLDER,
  DIFF_TOO_LARGE_PLACEHOLDER,
} from "@/shared/diff_placeholders";

// Guard against dumping binary blobs or huge files into the renderer's diff
// editor. Binary files render as garbage and large files hurt performance.
const MAX_DIFF_CONTENT_BYTES = 1_000_000; // ~1 MB

// A NUL byte is a strong signal the file is binary.
const NUL_BYTE = /\u0000/;

// The callers read files as UTF-8 (`fs.readFile(path, "utf-8")` / `git show`),
// so a binary blob whose invalid byte sequences contain no NUL is decoded to
// U+FFFD replacement characters rather than being caught by the NUL check.
// Treat the presence of U+FFFD the same as a NUL: it means the source bytes
// were not valid UTF-8, so the content can't be losslessly saved back and must
// stay a read-only placeholder. A genuine text file almost never contains
// U+FFFD, and if one does the only cost is showing a placeholder instead of an
// editable diff — far cheaper than corrupting the file by writing mojibake back
// on save.
const REPLACEMENT_CHAR = /\uFFFD/;

/**
 * Replace binary or oversized file content with a placeholder before it reaches
 * the renderer's diff editor. Binary content must never be shown (or, in edit
 * mode, saved back) as text: doing so would corrupt the file. The renderer
 * recognizes these placeholders (see `isDiffPlaceholder`) and keeps such diffs
 * read-only.
 */
export function sanitizeDiffContent(content: string): string {
  // Size guard first: content.length is an O(1) check that short-circuits
  // oversized files before the O(N) NUL scan / byte-length traversal below.
  // Fast-path: every UTF-8 character is at least 1 byte, so if the string
  // length already exceeds the limit, the byte length must too — which lets us
  // skip the Buffer.byteLength traversal for large files entirely.
  if (
    content.length > MAX_DIFF_CONTENT_BYTES ||
    Buffer.byteLength(content, "utf-8") > MAX_DIFF_CONTENT_BYTES
  ) {
    return DIFF_TOO_LARGE_PLACEHOLDER;
  }
  if (NUL_BYTE.test(content) || REPLACEMENT_CHAR.test(content)) {
    return DIFF_BINARY_PLACEHOLDER;
  }
  return content;
}
