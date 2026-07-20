import * as fs from "node:fs";
import * as path from "node:path";
import * as v8 from "node:v8";
import * as vm from "node:vm";

import type {
  CodeExplorerHostRequest,
  CodeExplorerHostResponse,
  CodeExplorerWorkerInput,
  CodeExplorerWorkerOutput,
} from "../../shared/code_explorer_types";
import {
  buildCodeExplorerIndex,
  searchCodeExplorerIndex,
  type BuiltCodeExplorerIndex,
} from "./core";
import { resolveProjectFileSet } from "./core/program";
import { evictionPlan } from "./eviction";
import type { TypeScriptModule } from "./core/types";

// This process's heap is bounded by the V8 pointer-compression cage (~4GB;
// Electron 40 ignores a lower --max-old-space-size passed via execArgv).
// Keeping cached indexes under ~2GB leaves headroom for the transient
// ts.Program built during (re)indexing (released before the index is cached,
// as before).
const INDEX_CACHE_BUDGET_BYTES = 2 * 1024 * 1024 * 1024;
// Secondary cap so many tiny projects don't accumulate unbounded metadata.
const INDEX_CACHE_MAX_ENTRIES = 4;

const REQUIRED_TYPESCRIPT_FUNCTIONS = [
  "createCompilerHost",
  "createIncrementalCompilerHost",
  "createIncrementalProgram",
  "createProgram",
  "flattenDiagnosticMessageText",
  "forEachChild",
  "getConfigFileParsingDiagnostics",
  "getParsedCommandLineOfConfigFile",
  "isCallExpression",
  "isClassDeclaration",
  "isEnumDeclaration",
  "isFunctionDeclaration",
  "isIdentifier",
  "isImportDeclaration",
  "isImportSpecifier",
  "isInterfaceDeclaration",
  "isMethodDeclaration",
  "isMethodSignature",
  "isPropertyDeclaration",
  "isPropertySignature",
  "isStringLiteral",
  "isTypeAliasDeclaration",
  "isVariableDeclaration",
] as const;

export type CodeExplorerCompilerSource = "local" | "bundled-ts6";

export interface ResolvedCodeExplorerCompiler {
  module: TypeScriptModule;
  source: CodeExplorerCompilerSource;
  version: string;
  fallbackReason?: string;
}

export interface CodeExplorerCompilerLoaders {
  resolveLocalPackage(appPath: string): string;
  loadPackageVersion(packageJsonPath: string): string;
  loadLocal(appPath: string): unknown;
  loadBundled(): unknown;
}

const defaultCompilerLoaders: CodeExplorerCompilerLoaders = {
  resolveLocalPackage: (appPath) =>
    require.resolve("typescript/package.json", { paths: [appPath] }),
  loadPackageVersion: (packageJsonPath) =>
    String(
      (require(packageJsonPath) as { version?: unknown }).version ?? "unknown",
    ),
  loadLocal: (appPath) =>
    require(require.resolve("typescript", { paths: [appPath] })),
  loadBundled: () => require("@typescript/typescript6"),
};

function compilerVersion(candidate: unknown): string {
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    "version" in candidate &&
    typeof candidate.version === "string"
  ) {
    return candidate.version;
  }
  return "unknown";
}

export function getMissingCodeExplorerCompilerApis(
  candidate: unknown,
): string[] {
  if (typeof candidate !== "object" || candidate === null) {
    return ["module"];
  }

  const compiler = candidate as Record<string, unknown>;
  const missing: string[] = REQUIRED_TYPESCRIPT_FUNCTIONS.filter(
    (name) => typeof compiler[name] !== "function",
  );
  for (const name of ["SymbolFlags", "SyntaxKind", "sys"] as const) {
    if (typeof compiler[name] !== "object" || compiler[name] === null) {
      missing.push(name);
    }
  }
  return missing;
}

function assertCompatibleCompiler(
  candidate: unknown,
  label: string,
): asserts candidate is TypeScriptModule {
  const missing = getMissingCodeExplorerCompilerApis(candidate);
  if (missing.length > 0) {
    throw new Error(`${label} is missing compiler APIs: ${missing.join(", ")}`);
  }
}

export function resolveCodeExplorerCompiler(
  appPath: string,
  loaders: CodeExplorerCompilerLoaders = defaultCompilerLoaders,
): ResolvedCodeExplorerCompiler {
  let localPackagePath: string;
  try {
    // Resolve first so a project without TypeScript never receives the fallback.
    localPackagePath = loaders.resolveLocalPackage(appPath);
  } catch (error) {
    throw new Error(
      `Failed to load TypeScript from ${appPath} because it is not installed: ${error}`,
    );
  }

  let localCandidate: unknown;
  let localVersion = "unknown";
  try {
    localVersion = loaders.loadPackageVersion(localPackagePath);
  } catch {
    // Loading the compiler below remains authoritative; version is for logs.
  }
  let fallbackReason: string;
  try {
    localCandidate = loaders.loadLocal(appPath);
    localVersion = compilerVersion(localCandidate);
    assertCompatibleCompiler(localCandidate, "Local TypeScript");
    return {
      module: localCandidate,
      source: "local",
      version: compilerVersion(localCandidate),
    };
  } catch (error) {
    fallbackReason = error instanceof Error ? error.message : String(error);
  }

  let bundledCandidate: unknown;
  try {
    bundledCandidate = loaders.loadBundled();
    assertCompatibleCompiler(bundledCandidate, "Bundled TypeScript 6");
  } catch (error) {
    throw new Error(
      `Failed to load TypeScript from ${appPath}: local TypeScript ${localVersion} is incompatible with Code Explorer (${fallbackReason}), and the bundled TypeScript 6 fallback failed to load: ${error}`,
    );
  }

  const version = compilerVersion(bundledCandidate);
  console.warn(
    `[code-explorer] local TypeScript ${localVersion} is incompatible (${fallbackReason}); using bundled TypeScript ${version}`,
  );
  return {
    module: bundledCandidate,
    source: "bundled-ts6",
    version,
    fallbackReason,
  };
}

interface CachedIndex {
  key: string;
  built: BuiltCodeExplorerIndex;
  watchedPaths: string[];
  newestMtimeMs: number;
  fileSetFingerprint: string;
  /** GC'd heap delta measured across this index's build. */
  bytes: number;
  lastUsedAt: number;
}

// One host process serves every explorer session, so both caches are keyed —
// different apps may resolve different TypeScript installs, and the index
// cache holds one entry per appPath+tsconfig within the byte budget above.
const typeScriptCache = new Map<string, ResolvedCodeExplorerCompiler>();
const indexCache = new Map<string, CachedIndex>();

export async function processCodeExplorer(
  input: CodeExplorerWorkerInput,
): Promise<CodeExplorerWorkerOutput> {
  try {
    const compiler = loadCachedTypeScript(input.appPath);
    const output = await processCodeExplorerWithTypeScript(
      compiler.module,
      input,
      compiler,
    );
    if (!output.success && compiler.source === "bundled-ts6") {
      return {
        success: false,
        error: `${output.error} (Code Explorer used bundled TypeScript ${compiler.version} because the local compiler API was incompatible)`,
      };
    }
    return output;
  } catch (error) {
    return codeExplorerErrorOutput(error);
  }
}

export async function processCodeExplorerWithTypeScript(
  ts: typeof import("typescript"),
  input: CodeExplorerWorkerInput,
  compiler?: ResolvedCodeExplorerCompiler,
): Promise<CodeExplorerWorkerOutput> {
  try {
    const built = getCachedIndex(ts, input);
    const result = searchCodeExplorerIndex(built, input);
    if (compiler?.source === "bundled-ts6") {
      result.notes.unshift(...getBundledCompilerNotes(compiler, built));
    }
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    return codeExplorerErrorOutput(error);
  }
}

const MAX_CONFIG_DIAGNOSTICS_IN_NOTE = 3;

function getBundledCompilerNotes(
  compiler: ResolvedCodeExplorerCompiler,
  built: BuiltCodeExplorerIndex,
): string[] {
  const notes = [
    `Warning: Code Explorer used bundled TypeScript ${compiler.version} because the app-local compiler API was incompatible. Results are best-effort.`,
  ];
  if (built.configDiagnostics.length === 0) {
    return notes;
  }

  const shownDiagnostics = built.configDiagnostics
    .slice(0, MAX_CONFIG_DIAGNOSTICS_IN_NOTE)
    .map((diagnostic) => {
      const configPath = path.relative(
        built.index.appPath,
        diagnostic.tsconfigPath,
      );
      const message = diagnostic.message.replaceAll("\n", " ").slice(0, 240);
      return `${configPath || path.basename(diagnostic.tsconfigPath)} TS${diagnostic.code}: ${message}`;
    });
  const omittedCount = built.configDiagnostics.length - shownDiagnostics.length;
  notes.push(
    `Warning: Bundled TypeScript ${compiler.version} continued after ${built.configDiagnostics.length} project configuration diagnostic${built.configDiagnostics.length === 1 ? "" : "s"}: ${shownDiagnostics.join("; ")}${omittedCount > 0 ? `; and ${omittedCount} more` : ""}. Some configuration was ignored, so results may be incomplete.`,
  );
  return notes;
}

function codeExplorerErrorOutput(error: unknown): CodeExplorerWorkerOutput {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function clearCodeExplorerWorkerCachesForTests(): void {
  typeScriptCache.clear();
  indexCache.clear();
}

function loadCachedTypeScript(appPath: string): ResolvedCodeExplorerCompiler {
  const cached = typeScriptCache.get(appPath);
  if (cached) {
    return cached;
  }
  const compiler = resolveCodeExplorerCompiler(appPath);
  typeScriptCache.set(appPath, compiler);
  return compiler;
}

function getCachedIndex(
  ts: typeof import("typescript"),
  input: CodeExplorerWorkerInput,
): BuiltCodeExplorerIndex {
  const key = `${input.appPath}\0${input.tsconfigPath ?? ""}`;
  const cached = indexCache.get(key);
  if (cached && isCacheFresh(ts, input, cached)) {
    cached.lastUsedAt = Date.now();
    return cached.built;
  }

  // Evict BEFORE building: drop the stale index for this key first so the old
  // index and the new ts.Program never coexist, then free LRU indexes until
  // the measured heap fits the budget. Re-measure and re-plan after each
  // round: per-entry `bytes` can overestimate what deleting the entry
  // actually frees (shared allocations like the TypeScript module cache
  // survive eviction), so a single round can leave the heap over budget.
  // Terminates because every round evicts at least one entry.
  indexCache.delete(key);
  let preBuildHeapBytes = gcAndMeasureHeapBytes();
  while (indexCache.size > 0) {
    const evictKeys = evictionPlan({
      entries: [...indexCache.values()].map((entry) => ({
        key: entry.key,
        lastUsedAt: entry.lastUsedAt,
        bytes: entry.bytes,
      })),
      usedHeapBytes: preBuildHeapBytes,
      budgetBytes: INDEX_CACHE_BUDGET_BYTES,
      maxEntries: INDEX_CACHE_MAX_ENTRIES,
    });
    if (evictKeys.length === 0) {
      break;
    }
    for (const evictKey of evictKeys) {
      const evicted = indexCache.get(evictKey);
      indexCache.delete(evictKey);
      console.log(
        `[code-explorer] evicting cached index ${evictKey.replaceAll("\0", "::")} (~${evicted?.bytes ?? 0} bytes) to fit the ${INDEX_CACHE_BUDGET_BYTES}-byte budget`,
      );
    }
    preBuildHeapBytes = gcAndMeasureHeapBytes();
  }

  const built = buildCodeExplorerIndex(ts, input);
  const watchedPaths = [
    ...built.tsconfigPaths,
    ...built.index.rootFileNames,
    ...sourceDirectories(built.index.rootFileNames),
  ].filter(Boolean);
  const postBuildHeapBytes = gcAndMeasureHeapBytes();
  indexCache.set(key, {
    key,
    built,
    watchedPaths,
    newestMtimeMs: newestMtimeMs(watchedPaths),
    fileSetFingerprint: fileSetFingerprint(built.rootFileNames),
    bytes: Math.max(0, postBuildHeapBytes - preBuildHeapBytes),
    lastUsedAt: Date.now(),
  });
  return built;
}

let forcedGc: (() => void) | undefined | null = null;

// Electron 40's utilityProcess delivers execArgv to process.execArgv but does
// NOT apply V8 flags from it (verified empirically: globalThis.gc stays
// undefined and heap_size_limit stays at the pointer-compression cage
// default), so prefer globalThis.gc when present but otherwise expose gc at
// runtime. If neither works, degrade to measuring without a forced
// collection (over-counts, never fails).
function acquireForcedGc(): (() => void) | undefined {
  const globalGc = (globalThis as { gc?: () => void }).gc;
  if (typeof globalGc === "function") {
    return globalGc;
  }
  try {
    v8.setFlagsFromString("--expose-gc");
    const gc = vm.runInNewContext("gc") as unknown;
    if (typeof gc === "function") {
      return gc as () => void;
    }
  } catch {
    // Fall through to un-collected measurement.
  }
  console.warn(
    "[code-explorer] forced GC is unavailable; heap measurements include uncollected garbage",
  );
  return undefined;
}

// GC before measuring so used_heap_size reflects retained indexes rather than
// garbage.
function gcAndMeasureHeapBytes(): number {
  if (forcedGc === null) {
    forcedGc = acquireForcedGc();
  }
  forcedGc?.();
  return v8.getHeapStatistics().used_heap_size;
}

function sourceDirectories(filePaths: string[]): string[] {
  return [...new Set(filePaths.map((filePath) => path.dirname(filePath)))];
}

function isCacheFresh(
  ts: typeof import("typescript"),
  input: CodeExplorerWorkerInput,
  cached: CachedIndex,
): boolean {
  if (newestMtimeMs(cached.watchedPaths) > cached.newestMtimeMs) {
    return false;
  }

  const currentFileSet = resolveProjectFileSet(ts, {
    appPath: input.appPath,
    tsconfigPath: input.tsconfigPath,
  });
  return (
    fileSetFingerprint(currentFileSet.rootFileNames) ===
    cached.fileSetFingerprint
  );
}

function fileSetFingerprint(fileNames: string[]): string {
  return [...new Set(fileNames.map((fileName) => path.resolve(fileName)))]
    .sort()
    .join("\0");
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

// This file runs as an Electron utility process (see
// src/ipc/processors/code_explorer.ts), which exposes IPC via
// `process.parentPort` instead of worker_threads' parentPort. Electron's
// typings for it live in the `electron` module, which isn't part of this
// worker's tsconfig, so declare the minimal surface we use.
interface UtilityProcessParentPort {
  on(
    event: "message",
    listener: (messageEvent: { data: CodeExplorerHostRequest }) => void,
  ): void;
  postMessage(message: CodeExplorerHostResponse): void;
}

const parentPort = (
  process as unknown as { parentPort?: UtilityProcessParentPort }
).parentPort;

// Handle messages from the main process. Requests are correlated by
// requestId; the actual indexing/search work is synchronous, so concurrent
// requests execute one at a time on this thread regardless of arrival order.
if (parentPort) {
  parentPort.on("message", async (messageEvent) => {
    const { requestId, input } = messageEvent.data;
    const output = await processCodeExplorer(input);
    parentPort.postMessage({ requestId, ...output });
  });
}
