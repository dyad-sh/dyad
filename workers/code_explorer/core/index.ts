import { performance } from "node:perf_hooks";
import type { CodeExplorerResult } from "../../../shared/code_explorer_types";
import { createProjectPrograms } from "./program";
import { buildIndex } from "./indexer";
import { searchNodes } from "./search";
import { expandNodes } from "./expand";
import { renderResult } from "./render";
import type { GraphIndex, TypeScriptModule } from "./types";

export interface ExploreCodeInput {
  appPath: string;
  query: string;
  tsconfigPath?: string;
  tsBuildInfoCacheDir?: string;
  maxFiles?: number;
  maxDepth?: number;
}

export function exploreCode(
  ts: TypeScriptModule,
  input: ExploreCodeInput,
): CodeExplorerResult {
  const built = buildCodeExplorerIndex(ts, input);
  return searchCodeExplorerIndex(built, input);
}

export interface BuiltCodeExplorerIndex {
  index: GraphIndex;
  indexMs: number;
  tsconfigPaths: string[];
  rootFileNames: string[];
  configDiagnostics: CodeExplorerConfigDiagnostic[];
}

export interface CodeExplorerConfigDiagnostic {
  code: number;
  message: string;
  tsconfigPath: string;
}

export function buildCodeExplorerIndex(
  ts: TypeScriptModule,
  input: Pick<
    ExploreCodeInput,
    "appPath" | "tsconfigPath" | "tsBuildInfoCacheDir"
  >,
): BuiltCodeExplorerIndex {
  const indexStart = performance.now();
  const projects = createProjectPrograms(ts, {
    appPath: input.appPath,
    tsconfigPath: input.tsconfigPath,
    tsBuildInfoCacheDir: input.tsBuildInfoCacheDir,
  });
  const index = buildIndex(ts, input.appPath, projects);
  const indexMs = Math.round(performance.now() - indexStart);
  return {
    index,
    indexMs,
    tsconfigPaths: projects.map((project) => project.tsconfigPath),
    rootFileNames: projects.flatMap((project) =>
      project.program.getRootFileNames(),
    ),
    configDiagnostics: projects.flatMap((project) =>
      project.configFileParsingDiagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        tsconfigPath: project.tsconfigPath,
      })),
    ),
  };
}

export function searchCodeExplorerIndex(
  built: BuiltCodeExplorerIndex,
  input: ExploreCodeInput,
): CodeExplorerResult {
  const maxFiles = clamp(input.maxFiles ?? 5, 1, 8);
  const maxDepth = clamp(input.maxDepth ?? 2, 0, 3);

  const searchStart = performance.now();
  const roots = searchNodes(built.index, input.query);
  const selected = expandNodes(built.index, roots.slice(0, 8), maxDepth);
  const searchMs = Math.round(performance.now() - searchStart);

  return renderResult({
    index: built.index,
    query: input.query,
    selected,
    maxFiles,
    indexMs: built.indexMs,
    searchMs,
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
