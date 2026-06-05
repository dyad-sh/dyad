import * as fs from "node:fs";
import * as path from "node:path";
import type {
  CodeExplorerFileResult,
  CodeExplorerResult,
  CodeExplorerSourceWindow,
} from "../../../shared/code_explorer_types";
import { GraphIndex, GraphNode } from "./types";

const LINE_PADDING = 4;
const MERGE_DISTANCE = 12;
const MAX_WINDOWS_PER_FILE = 3;
const MAX_LINES_PER_FILE = 120;
const MAX_TOTAL_LINES = 450;
const MAX_CHARS = 40_000;

export function renderResult({
  index,
  query,
  selected,
  maxFiles,
  indexMs,
  searchMs,
}: {
  index: GraphIndex;
  query: string;
  selected: Map<string, number>;
  maxFiles: number;
  indexMs: number;
  searchMs: number;
}): CodeExplorerResult {
  const notes: string[] = [];
  const fileScores = new Map<string, number>();
  const fileNodes = new Map<string, GraphNode[]>();

  for (const [nodeId, score] of selected) {
    const node = index.nodes.get(nodeId);
    if (!node || node.kind === "file") continue;
    fileScores.set(node.filePath, (fileScores.get(node.filePath) ?? 0) + score);
    const nodes = fileNodes.get(node.filePath) ?? [];
    nodes.push(node);
    fileNodes.set(node.filePath, nodes);
  }

  const rankedFiles = [...fileScores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxFiles);
  if (fileScores.size > rankedFiles.length) {
    notes.push(
      `Truncated to ${rankedFiles.length} of ${fileScores.size} matching files.`,
    );
  }

  let totalLines = 0;
  let totalChars = 0;
  let truncated = notes.length > 0;
  const files: CodeExplorerFileResult[] = [];

  for (const [relativePath] of rankedFiles) {
    const nodes = (fileNodes.get(relativePath) ?? []).sort(
      (a, b) => a.startLine - b.startLine,
    );
    const sourcePath = path.join(index.appPath, relativePath);
    const source = fs.readFileSync(sourcePath, "utf8");
    const sourceLines = source.split(/\r?\n/);
    const windows = buildWindows(nodes, sourceLines.length);
    const cappedWindows: CodeExplorerSourceWindow[] = [];
    let fileLineCount = 0;

    for (const window of windows.slice(0, MAX_WINDOWS_PER_FILE)) {
      if (totalLines >= MAX_TOTAL_LINES || totalChars >= MAX_CHARS) {
        truncated = true;
        break;
      }

      const remainingFileLines = MAX_LINES_PER_FILE - fileLineCount;
      const remainingTotalLines = MAX_TOTAL_LINES - totalLines;
      const maxWindowLines = Math.min(
        window.endLine - window.startLine + 1,
        remainingFileLines,
        remainingTotalLines,
      );
      if (maxWindowLines <= 0) {
        truncated = true;
        break;
      }

      const lines = sourceLines
        .slice(window.startLine - 1, window.startLine - 1 + maxWindowLines)
        .map((line, index) => `${window.startLine + index} ${line}`);
      const charCount = lines.join("\n").length;
      if (totalChars + charCount > MAX_CHARS) {
        truncated = true;
        break;
      }

      cappedWindows.push({ startLine: window.startLine, lines });
      fileLineCount += lines.length;
      totalLines += lines.length;
      totalChars += charCount;
    }

    if (windows.length > cappedWindows.length) {
      truncated = true;
    }

    files.push({
      path: relativePath,
      symbols: nodes.slice(0, 12).map((node) => ({
        name: node.qualifiedName || node.name,
        kind: node.kind,
        line: node.startLine,
      })),
      windows: cappedWindows,
    });
  }

  if (truncated && !notes.some((note) => note.startsWith("Output truncated"))) {
    notes.push("Output truncated by file, line, or character caps.");
  }

  return {
    query,
    totalSymbols: selected.size,
    totalFiles: fileScores.size,
    indexedFileCount: new Set(index.rootFileNames).size,
    indexMs,
    searchMs,
    files,
    truncated,
    notes,
  };
}

function buildWindows(
  nodes: GraphNode[],
  totalLines: number,
): Array<{ startLine: number; endLine: number }> {
  const ranges = nodes
    .map((node) => ({
      startLine: Math.max(1, node.startLine - LINE_PADDING),
      endLine: Math.min(totalLines, node.endLine + LINE_PADDING),
    }))
    .sort((a, b) => a.startLine - b.startLine);

  const merged: Array<{ startLine: number; endLine: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.startLine <= last.endLine + MERGE_DISTANCE) {
      last.endLine = Math.max(last.endLine, range.endLine);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}
