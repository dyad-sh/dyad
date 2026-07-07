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
  // Rolling two-row DP to keep memory at O(min dimension).
  let previous = Array.from<number>({ length: m + 1 }).fill(0);
  let current = Array.from<number>({ length: m + 1 }).fill(0);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        current[j] = previous[j - 1] + 1;
      } else {
        current[j] = Math.max(previous[j], current[j - 1]);
      }
    }
    [previous, current] = [current, previous];
  }
  return previous[m];
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
