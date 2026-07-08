export interface LineDiffStats {
  additions: number;
  deletions: number;
}

const EMPTY_STATS: LineDiffStats = { additions: 0, deletions: 0 };

/**
 * Splits content into lines for diffing. A trailing newline should not count as
 * an extra empty line, so it is stripped before splitting. Empty content yields
 * zero lines (not a single empty line).
 */
function toLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }
  const normalized = content.replace(/\n$/, "");
  return normalized.split("\n");
}

// Above this many DP cells (rows × columns of the untrimmable middle) we skip
// the LCS and treat the middle as entirely changed. computeLineDiffStats runs
// synchronously during render, so a pathological input (e.g. a large minified
// bundle where every line differs) could otherwise block the main thread.
const MAX_LCS_CELLS = 4_000_000;

/**
 * Length of the longest common subsequence between two line arrays. Used to
 * derive how many lines were added/removed the same way `git diff` reports them:
 * lines that don't participate in the LCS are counted as changes.
 */
function lcsLength(a: string[], b: string[]): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) {
    return 0;
  }

  // Most edits change only a handful of lines, so trim the shared prefix and
  // suffix first. This shrinks the DP table (often to nothing) and keeps the
  // computation fast even for large files.
  let start = 0;
  while (start < n && start < m && a[start] === b[start]) {
    start++;
  }
  let endA = n - 1;
  let endB = m - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }

  // Shared prefix + suffix lines already accounted for as common.
  const trimmedCommon = start + (n - 1 - endA);
  const lenA = endA - start + 1;
  const lenB = endB - start + 1;
  if (lenA === 0 || lenB === 0) {
    return trimmedCommon;
  }

  // Guard against pathological inputs: skip the DP and treat the untrimmable
  // middle as entirely changed rather than block the main thread.
  if (lenA * lenB > MAX_LCS_CELLS) {
    return trimmedCommon;
  }

  // Use the smaller dimension for the rolling DP columns so memory/allocation
  // stays at O(min(lenA, lenB)). The LCS length is symmetric in its arguments.
  const [small, large] =
    lenA <= lenB
      ? [a.slice(start, endA + 1), b.slice(start, endB + 1)]
      : [b.slice(start, endB + 1), a.slice(start, endA + 1)];
  const sLen = small.length;
  const lLen = large.length;

  let previous = Array.from<number>({ length: sLen + 1 }).fill(0);
  let current = Array.from<number>({ length: sLen + 1 }).fill(0);
  for (let i = 1; i <= lLen; i++) {
    for (let j = 1; j <= sLen; j++) {
      if (large[i - 1] === small[j - 1]) {
        current[j] = previous[j - 1] + 1;
      } else {
        current[j] = Math.max(previous[j], current[j - 1]);
      }
    }
    [previous, current] = [current, previous];
  }
  return trimmedCommon + previous[sLen];
}

/**
 * Computes added/deleted line counts between two file contents, matching how a
 * line-based diff (e.g. `git diff`) tallies changes: additions are new lines not
 * present in the longest common subsequence, deletions are old lines missing
 * from it. A modified line therefore counts as one deletion plus one addition.
 *
 * Returns zeros when there is nothing to diff (identical content) or when either
 * side is a sanitized placeholder (binary/oversized files), which would produce
 * meaningless counts.
 */
export function computeLineDiffStats(
  oldContent: string,
  newContent: string,
): LineDiffStats {
  if (oldContent === newContent) {
    return EMPTY_STATS;
  }

  const oldLines = toLines(oldContent);
  const newLines = toLines(newContent);

  if (oldLines.length === 0) {
    return { additions: newLines.length, deletions: 0 };
  }
  if (newLines.length === 0) {
    return { additions: 0, deletions: oldLines.length };
  }

  const common = lcsLength(oldLines, newLines);
  return {
    additions: newLines.length - common,
    deletions: oldLines.length - common,
  };
}
