import { spawn } from "node:child_process";
import path from "node:path";
import log from "electron-log";
import type { AppFileSearchResult } from "../types/app";
import { normalizePath } from "../../../shared/normalizePath";
import {
  getRgExecutablePath,
  MAX_FILE_SEARCH_SIZE,
  RIPGREP_EXCLUDED_GLOBS,
} from "./ripgrep_utils";
import { takeUtf8Prefix, takeUtf8Suffix, truncateUtf8 } from "./result_limits";

const logger = log.scope("app_file_search");

export const MAX_APP_FILE_SEARCH_FILES = 100;
export const MAX_APP_FILE_SEARCH_SNIPPETS = 300;
export const MAX_APP_FILE_SEARCH_RESULT_BYTES = 256 * 1024;
export const MAX_APP_FILE_SEARCH_SNIPPET_BYTES = 2 * 1024;
const MAX_MATCH_BYTES = 512;

function sanitizeSnippetText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/** Convert ripgrep's UTF-8 byte offset to a JavaScript string index. */
function byteOffsetToCharIndex(text: string, byteOffset: number): number {
  const safeByteOffset = Math.max(0, byteOffset);
  let bytes = 0;
  let characterIndex = 0;
  for (const character of text) {
    if (bytes >= safeByteOffset) return characterIndex;
    bytes += Buffer.byteLength(character, "utf8");
    characterIndex += character.length;
  }
  return text.length;
}

function buildSnippetFromMatch({
  lineText,
  start,
  end,
  lineNumber,
}: {
  lineText: string;
  start: number;
  end: number;
  lineNumber: number;
}): NonNullable<AppFileSearchResult["snippets"]>[number] {
  const safeLine = lineText.replace(/\r?\n$/, "");
  const startChar = byteOffsetToCharIndex(safeLine, start);
  const endChar = byteOffsetToCharIndex(safeLine, end);
  const match = truncateUtf8(
    sanitizeSnippetText(safeLine.slice(startChar, endChar)),
    MAX_MATCH_BYTES,
  ).text;
  const remainingBytes = Math.max(
    0,
    MAX_APP_FILE_SEARCH_SNIPPET_BYTES - Buffer.byteLength(match, "utf8"),
  );
  const beforeBudget = Math.floor(remainingBytes / 2);
  const afterBudget = remainingBytes - beforeBudget;
  const before = truncateUtf8(
    sanitizeSnippetText(
      takeUtf8Suffix(safeLine.slice(0, startChar), beforeBudget),
    ),
    beforeBudget,
    "",
  ).text;
  const after = truncateUtf8(
    sanitizeSnippetText(takeUtf8Prefix(safeLine.slice(endChar), afterBudget)),
    afterBudget,
    "",
  ).text;

  return { before, match, after, line: lineNumber };
}

function estimateSnippetBytes(
  pathName: string,
  snippet: NonNullable<AppFileSearchResult["snippets"]>[number],
  includePath: boolean,
): number {
  return (
    (includePath ? Buffer.byteLength(pathName, "utf8") : 0) +
    Buffer.byteLength(snippet.before, "utf8") +
    Buffer.byteLength(snippet.match, "utf8") +
    Buffer.byteLength(snippet.after, "utf8") +
    64
  );
}

/**
 * Search app files while bounding retained paths, snippets, and UTF-8 bytes.
 * Ripgrep is terminated as soon as the next unique match would exceed a cap.
 */
export async function searchAppFilesWithRipgrep({
  appPath,
  query,
}: {
  appPath: string;
  query: string;
}): Promise<AppFileSearchResult[]> {
  return new Promise((resolve, reject) => {
    const results = new Map<string, AppFileSearchResult>();
    const args = [
      "--json",
      "--no-config",
      "--ignore-case",
      "--fixed-strings",
      "--max-filesize",
      `${MAX_FILE_SEARCH_SIZE}`,
      ...RIPGREP_EXCLUDED_GLOBS.flatMap((glob) => ["--glob", glob]),
      "--",
      query,
      ".",
    ];

    const rg = spawn(getRgExecutablePath(), args, { cwd: appPath });
    let buffer = "";
    let resultBytes = 0;
    let snippetCount = 0;
    let stoppedEarly = false;

    const stopEarly = () => {
      if (stoppedEarly) return;
      stoppedEarly = true;
      buffer = "";
      rg.kill();
    };

    rg.stdout.on("data", (data) => {
      if (stoppedEarly) return;
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type !== "match" || !event.data) continue;

          const matchPath = event.data.path?.text as string;
          if (!matchPath) continue;
          const absolutePath = path.isAbsolute(matchPath)
            ? matchPath
            : path.join(appPath, matchPath);
          const relativePath = normalizePath(
            path.relative(appPath, absolutePath),
          );
          if (relativePath.startsWith("..")) continue;

          const lineText = event.data.lines?.text as string;
          const lineNumber = event.data.line_number as number;
          const submatch = event.data.submatches?.[0];
          if (
            typeof lineText !== "string" ||
            typeof lineNumber !== "number" ||
            !submatch
          ) {
            continue;
          }

          const existing = results.get(relativePath);
          if (
            existing?.snippets?.some((snippet) => snippet.line === lineNumber)
          ) {
            continue;
          }
          const snippet = buildSnippetFromMatch({
            lineText,
            start: submatch.start,
            end: submatch.end,
            lineNumber,
          });
          const incrementalBytes = estimateSnippetBytes(
            relativePath,
            snippet,
            !existing,
          );
          if (
            snippetCount >= MAX_APP_FILE_SEARCH_SNIPPETS ||
            (!existing && results.size >= MAX_APP_FILE_SEARCH_FILES) ||
            resultBytes + incrementalBytes > MAX_APP_FILE_SEARCH_RESULT_BYTES
          ) {
            stopEarly();
            break;
          }

          if (existing) {
            existing.snippets ??= [];
            existing.snippets.push(snippet);
          } else {
            results.set(relativePath, {
              path: relativePath,
              matchesContent: true,
              snippets: [snippet],
            });
          }
          snippetCount += 1;
          resultBytes += incrementalBytes;
        } catch (error) {
          logger.warn("Failed to parse ripgrep output line:", line, error);
        }
      }
    });

    rg.stderr.on("data", (data) => {
      const message = data.toString();
      if (message.toLowerCase().includes("binary file skipped")) return;
      logger.debug("ripgrep stderr:", message);
    });

    rg.on("close", (code) => {
      if (!stoppedEarly && code !== 0 && code !== 1) {
        reject(new Error(`ripgrep exited with code ${code}`));
        return;
      }
      const values = Array.from(results.values());
      if (stoppedEarly) {
        for (const result of values) result.truncated = true;
      }
      resolve(values);
    });

    rg.on("error", reject);
  });
}
