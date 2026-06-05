import { performance } from "node:perf_hooks";
import type { CodeExplorerResult } from "../../../shared/code_explorer_types";
import { createProjectPrograms } from "./program";
import { buildIndex } from "./indexer";
import { searchNodes } from "./search";
import { expandNodes } from "./expand";
import { renderResult } from "./render";
import type { TypeScriptModule } from "./types";

export interface ExploreCodeInput {
  appPath: string;
  query: string;
  tsconfigPath?: string;
  maxFiles?: number;
  maxDepth?: number;
}

export function exploreCode(
  ts: TypeScriptModule,
  input: ExploreCodeInput,
): CodeExplorerResult {
  const maxFiles = clamp(input.maxFiles ?? 5, 1, 8);
  const maxDepth = clamp(input.maxDepth ?? 2, 0, 3);

  const indexStart = performance.now();
  const projects = createProjectPrograms(ts, {
    appPath: input.appPath,
    tsconfigPath: input.tsconfigPath,
  });
  const index = buildIndex(ts, input.appPath, projects);
  const indexMs = Math.round(performance.now() - indexStart);

  const searchStart = performance.now();
  const roots = searchNodes(index, input.query);
  const selected = expandNodes(index, roots.slice(0, 8), maxDepth);
  const searchMs = Math.round(performance.now() - searchStart);

  return renderResult({
    index,
    query: input.query,
    selected,
    maxFiles,
    indexMs,
    searchMs,
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
