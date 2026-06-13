import { parentPort } from "node:worker_threads";
import * as fs from "node:fs";
import * as path from "node:path";

import type {
  CodeExplorerWorkerInput,
  CodeExplorerWorkerOutput,
} from "../../shared/code_explorer_types";
import {
  buildCodeExplorerIndex,
  searchCodeExplorerIndex,
  type BuiltCodeExplorerIndex,
} from "./core";

function loadLocalTypeScript(appPath: string): typeof import("typescript") {
  try {
    const requirePath = require.resolve("typescript", { paths: [appPath] });
    return require(requirePath);
  } catch (error) {
    throw new Error(
      `Failed to load TypeScript from ${appPath} because of ${error}`,
    );
  }
}

interface CachedTypeScript {
  appPath: string;
  ts: typeof import("typescript");
}

interface CachedIndex {
  key: string;
  built: BuiltCodeExplorerIndex;
  watchedPaths: string[];
  newestMtimeMs: number;
}

let cachedTypeScript: CachedTypeScript | undefined;
const indexCache = new Map<string, CachedIndex>();

async function processCodeExplorer(
  input: CodeExplorerWorkerInput,
): Promise<CodeExplorerWorkerOutput> {
  try {
    const ts = loadCachedTypeScript(input.appPath);
    const built = getCachedIndex(ts, input);
    const result = searchCodeExplorerIndex(built, input);
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function loadCachedTypeScript(appPath: string): typeof import("typescript") {
  if (cachedTypeScript?.appPath === appPath) {
    return cachedTypeScript.ts;
  }
  const ts = loadLocalTypeScript(appPath);
  cachedTypeScript = { appPath, ts };
  indexCache.clear();
  return ts;
}

function getCachedIndex(
  ts: typeof import("typescript"),
  input: CodeExplorerWorkerInput,
): BuiltCodeExplorerIndex {
  const key = `${input.appPath}\0${input.tsconfigPath ?? ""}`;
  const cached = indexCache.get(key);
  if (cached && isCacheFresh(cached)) {
    return cached.built;
  }

  const built = buildCodeExplorerIndex(ts, input);
  const watchedPaths = [
    ...built.tsconfigPaths,
    ...built.index.rootFileNames,
    ...sourceDirectories(built.index.rootFileNames),
  ].filter(Boolean);
  indexCache.set(key, {
    key,
    built,
    watchedPaths,
    newestMtimeMs: newestMtimeMs(watchedPaths),
  });
  return built;
}

function sourceDirectories(filePaths: string[]): string[] {
  return [...new Set(filePaths.map((filePath) => path.dirname(filePath)))];
}

function isCacheFresh(cached: CachedIndex): boolean {
  return newestMtimeMs(cached.watchedPaths) <= cached.newestMtimeMs;
}

function newestMtimeMs(paths: string[]): number {
  let newest = 0;
  for (const filePath of paths) {
    try {
      newest = Math.max(newest, fs.statSync(filePath).mtimeMs);
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }
  return newest;
}

parentPort?.on("message", async (input: CodeExplorerWorkerInput) => {
  const output = await processCodeExplorer(input);
  parentPort?.postMessage(output);
});
