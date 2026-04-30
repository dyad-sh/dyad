// Minimal unified-diff generator — no third-party deps.
//
// Uses an LCS dynamic-programming table to align two files line by line,
// backtracks it into a sequence of keep/add/remove ops, and groups those
// into hunks with a fixed number of context lines. Output matches the
// unified diff format consumed by `patch -p0`.
//
// Performance: O(m*n) time and space, where m and n are line counts.
// Fine for eval fixtures (hundreds of lines). Callers that need to diff
// multi-thousand-line files should reach for a real Myers implementation.

const DEFAULT_CONTEXT = 3;

type OpType = "keep" | "add" | "remove";

interface DiffOp {
  type: OpType;
  line: string;
}

interface PositionedOp {
  op: DiffOp;
  oldPos: number; // 1-indexed line number in the old file
  newPos: number; // 1-indexed line number in the new file
}

interface Hunk {
  oldStart: number;
  oldLen: number;
  newStart: number;
  newLen: number;
  lines: string[];
}

function computeLcsTable(
  oldLines: readonly string[],
  newLines: readonly string[],
): number[][] {
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from<number>({ length: n + 1 }).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

function backtrackOps(
  dp: number[][],
  oldLines: readonly string[],
  newLines: readonly string[],
): DiffOp[] {
  const ops: DiffOp[] = [];
  let i = oldLines.length;
  let j = newLines.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: "keep", line: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: "add", line: newLines[j - 1] });
      j--;
    } else {
      ops.push({ type: "remove", line: oldLines[i - 1] });
      i--;
    }
  }
  return ops.reverse();
}

function assignPositions(ops: readonly DiffOp[]): PositionedOp[] {
  const out: PositionedOp[] = [];
  let oldCursor = 1;
  let newCursor = 1;
  for (const op of ops) {
    out.push({ op, oldPos: oldCursor, newPos: newCursor });
    if (op.type === "keep") {
      oldCursor++;
      newCursor++;
    } else if (op.type === "remove") {
      oldCursor++;
    } else {
      newCursor++;
    }
  }
  return out;
}

function buildHunks(
  positioned: readonly PositionedOp[],
  context: number,
): Hunk[] {
  const include = Array.from<boolean>({ length: positioned.length }).fill(
    false,
  );
  for (let i = 0; i < positioned.length; i++) {
    if (positioned[i].op.type !== "keep") {
      const lo = Math.max(0, i - context);
      const hi = Math.min(positioned.length - 1, i + context);
      for (let k = lo; k <= hi; k++) include[k] = true;
    }
  }

  const hunks: Hunk[] = [];
  let i = 0;
  while (i < positioned.length) {
    if (!include[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < positioned.length && include[j]) j++;

    const group = positioned.slice(i, j);
    const first = group[0];
    let oldStart = first.oldPos;
    let newStart = first.newPos;
    let oldLen = 0;
    let newLen = 0;
    const lines: string[] = [];

    for (const p of group) {
      if (p.op.type === "keep") {
        oldLen++;
        newLen++;
        lines.push(` ${p.op.line}`);
      } else if (p.op.type === "remove") {
        oldLen++;
        lines.push(`-${p.op.line}`);
      } else {
        newLen++;
        lines.push(`+${p.op.line}`);
      }
    }

    // Unified diff convention: zero-length sides use the line number of
    // the preceding line (or 0 if there is none).
    if (oldLen === 0) oldStart = Math.max(0, oldStart - 1);
    if (newLen === 0) newStart = Math.max(0, newStart - 1);

    hunks.push({ oldStart, oldLen, newStart, newLen, lines });
    i = j;
  }

  return hunks;
}

/**
 * Produce a unified diff between two strings. Returns an empty string
 * when the inputs are identical. Trailing newlines are preserved by
 * round-tripping through `split("\n")`, which yields an empty final
 * element that the diff walker treats like any other line.
 */
export function createUnifiedDiff(
  oldContent: string,
  newContent: string,
  options: {
    oldLabel?: string;
    newLabel?: string;
    context?: number;
  } = {},
): string {
  if (oldContent === newContent) return "";

  const oldLabel = options.oldLabel ?? "original";
  const newLabel = options.newLabel ?? "modified";
  const context = options.context ?? DEFAULT_CONTEXT;

  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const dp = computeLcsTable(oldLines, newLines);
  const ops = backtrackOps(dp, oldLines, newLines);
  const positioned = assignPositions(ops);
  const hunks = buildHunks(positioned, context);

  if (hunks.length === 0) return "";

  const out: string[] = [];
  out.push(`--- ${oldLabel}`);
  out.push(`+++ ${newLabel}`);
  for (const h of hunks) {
    out.push(`@@ -${h.oldStart},${h.oldLen} +${h.newStart},${h.newLen} @@`);
    for (const line of h.lines) out.push(line);
  }
  return out.join("\n") + "\n";
}
