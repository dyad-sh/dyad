import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

import { readSettings } from "@/main/settings";
import {
  formatCodeExplorerDisabledReason,
  getCodeExplorerAvailability,
} from "@/ipc/processors/code_explorer";
import {
  AgentContext,
  ToolDefinition,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import type { CodeExplorerResult } from "../../../../../../../shared/code_explorer_types";
import {
  exploreCodeSchema,
  normalizeExploreCodeArgsForApp,
} from "./explore_code_raw";
import { runExploreCodeSubagent } from "./explore_code_subagent";
import { resolveTargetAppPath } from "./resolve_app_context";
import { recordCodeExplorerBenchmarkEvent } from "../benchmark_recorder";

interface CachedExploreCodeReport {
  report: string;
  fileStats: Map<string, CachedFileStat>;
  lastUsedAt: number;
}

interface CachedFileStat {
  mtimeMs: number;
  size: number;
}

const MAX_EXPLORE_CODE_CACHE_ENTRIES = 50;
const exploreCodeReportCache = new Map<string, CachedExploreCodeReport>();

export function getExploreCodeAvailability(ctx: AgentContext): {
  enabled: boolean;
  reason: string | null;
  tsconfigPath: string | null;
} {
  const settings = readSettings();
  if (!settings.enableCodeExplorer) {
    return {
      enabled: false,
      reason: "code_explorer_setting_disabled",
      tsconfigPath: null,
    };
  }

  const availability = getCodeExplorerAvailability(ctx.appPath);
  return {
    enabled: availability.ready,
    reason: availability.ready
      ? null
      : (availability.reason ?? formatCodeExplorerDisabledReason(availability)),
    tsconfigPath: availability.tsconfigPath,
  };
}

function buildExploreCodeAttributes(
  args: Partial<z.infer<typeof exploreCodeSchema>>,
  result?: CodeExplorerResult,
): string {
  const attrs: string[] = [];
  if (args.query) attrs.push(`query="${escapeXmlAttr(args.query)}"`);
  if (args.intent) attrs.push(`intent="${escapeXmlAttr(args.intent)}"`);
  if (args.app_name) attrs.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (args.tsconfig_path) {
    attrs.push(`tsconfig_path="${escapeXmlAttr(args.tsconfig_path)}"`);
  }
  if (result) {
    attrs.push(`files="${result.files.length}"`);
    attrs.push(`symbols="${result.totalSymbols}"`);
    attrs.push(`index_ms="${result.indexMs}"`);
    attrs.push(`search_ms="${result.searchMs}"`);
    if (result.truncated) attrs.push(`truncated="true"`);
  }
  return attrs.join(" ");
}

export const exploreCodeTool: ToolDefinition<
  z.infer<typeof exploreCodeSchema>
> = {
  name: "explore_code",
  description: `Ask a code reconnaissance sub-agent to explore code included in a configured TypeScript project.

Use this when you need to understand how a TypeScript, TSX, JavaScript, or JSX feature, symbol, type, component, service, or flow is implemented across files. It returns a compact flow with quoted evidence, relevant file/line ranges, read targets, confidence, and recommendedPrimaryAction. Treat a high- or medium-confidence report as the codebase map; follow recommendedPrimaryAction instead of rediscovering the code. If a high- or medium-confidence report says answer_from_report, answer or plan from the report. If it says read_targets, explain/locate requests should answer from the report and cite the listed targets as jump points without reading them, unless the report is low confidence or the user explicitly asks for edits, debugging, or exact source verification; edit/debug requests may read only the listed tight ranges before changing code or verifying exact source. If it says targeted_gap_search, run only the rendered Search targets with their exact terms/scopes, then answer from the report plus those search results and name any remaining gap; do not invent broader searches, open arbitrary hits, or call explore_code again. If no executable Search targets are rendered, answer from the observed flow while naming the remaining gap. If confidence is low, inspect the listed read targets or search targets before relying on the report.
Use the intent argument to describe what you will do with the result: use explain for "trace how", data-flow, request-flow, or "how is this computed/surfaced" questions; use locate for finding the best files/symbols; use edit/debug when exact ranges will be read before changing code or verifying behavior.

Do not call this repeatedly for the same investigation after a high- or medium-confidence report. Use the report, or at most the exact rendered Search targets or tight edit/debug read targets.

Only use this for files included in the app's TypeScript config. JavaScript and JSX require TypeScript config support such as allowJs. If the project does not have TypeScript installed and configured, use grep/list_files/read_file instead.`,
  inputSchema: exploreCodeSchema,
  defaultConsent: "always",

  isEnabled: (ctx) => getExploreCodeAvailability(ctx).enabled,

  getConsentPreview: (args) => {
    let preview = `Explore code for "${args.query}"`;
    if (args.app_name) preview += ` (app: ${args.app_name})`;
    return preview;
  },

  buildXml: (args, isComplete) => {
    if (isComplete || !args.query) return undefined;
    return `<dyad-explore-code ${buildExploreCodeAttributes(args)}>Exploring...</dyad-explore-code>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const availability = getExploreCodeAvailability(ctx);
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
    const effectiveArgs = normalizeExploreCodeArgsForApp({
      appPath: targetAppPath,
      args,
      fallbackTsconfigPath: availability.tsconfigPath,
    });
    const cacheKey = getExploreCodeCacheKey({
      chatId: ctx.chatId,
      appPath: targetAppPath,
      args: effectiveArgs,
    });
    const cachedReport = getCachedExploreCodeReport({
      cacheKey,
      appPath: targetAppPath,
    });
    if (cachedReport) {
      recordCodeExplorerBenchmarkEvent({
        type: "explore_code_cache_hit",
        phase: "main",
        chatId: ctx.chatId,
        appId: ctx.appId,
        toolName: "explore_code",
      });
      ctx.onXmlComplete(
        `<dyad-explore-code ${buildExploreCodeAttributes(args)} cached="true">\n${escapeXmlContent(cachedReport)}\n</dyad-explore-code>`,
      );
      return cachedReport;
    }

    recordCodeExplorerBenchmarkEvent({
      type: "explore_code_cache_miss",
      phase: "main",
      chatId: ctx.chatId,
      appId: ctx.appId,
      toolName: "explore_code",
    });
    const resultText = await runExploreCodeSubagent({
      args: effectiveArgs,
      ctx,
    });
    maybeCacheExploreCodeReport({
      cacheKey,
      appPath: targetAppPath,
      report: resultText,
    });
    ctx.onXmlComplete(
      `<dyad-explore-code ${buildExploreCodeAttributes(effectiveArgs)}>\n${escapeXmlContent(resultText)}\n</dyad-explore-code>`,
    );
    return resultText;
  },
};

function getExploreCodeCacheKey({
  chatId,
  appPath,
  args,
}: {
  chatId: number;
  appPath: string;
  args: z.infer<typeof exploreCodeSchema>;
}): string {
  return [
    chatId,
    path.resolve(appPath),
    normalizeCacheText(args.app_name ?? ""),
    normalizeCacheText(args.tsconfig_path ?? ""),
    normalizeCacheText(args.intent ?? "locate"),
    normalizeCacheText(args.query),
  ].join("\0");
}

function normalizeCacheText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function getCachedExploreCodeReport({
  cacheKey,
  appPath,
}: {
  cacheKey: string;
  appPath: string;
}): string | null {
  const cached = exploreCodeReportCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (!areCachedFileStatsCurrent(appPath, cached.fileStats)) {
    exploreCodeReportCache.delete(cacheKey);
    return null;
  }
  cached.lastUsedAt = Date.now();
  return cached.report;
}

function maybeCacheExploreCodeReport({
  cacheKey,
  appPath,
  report,
}: {
  cacheKey: string;
  appPath: string;
  report: string;
}): void {
  const fileStats = collectReportFileStats({ appPath, report });
  if (fileStats.size === 0) {
    return;
  }
  exploreCodeReportCache.set(cacheKey, {
    report,
    fileStats,
    lastUsedAt: Date.now(),
  });
  pruneExploreCodeReportCache();
}

function collectReportFileStats({
  appPath,
  report,
}: {
  appPath: string;
  report: string;
}): Map<string, CachedFileStat> {
  const fileStats = new Map<string, CachedFileStat>();
  for (const filePath of extractReportFilePaths(report)) {
    const resolvedPath = resolveReportFilePath(appPath, filePath);
    if (!resolvedPath) {
      continue;
    }
    const stat = getFileStat(resolvedPath);
    if (!stat) {
      continue;
    }
    fileStats.set(filePath, stat);
  }
  return fileStats;
}

function extractReportFilePaths(report: string): string[] {
  const summary = extractStructuredSummary(report);
  const paths = new Set<string>();
  if (Array.isArray(summary?.paths)) {
    for (const item of summary.paths) {
      if (item && typeof item === "object") {
        const filePath = (item as { path?: unknown }).path;
        if (typeof filePath === "string" && filePath.trim()) {
          paths.add(filePath.trim());
        }
      }
    }
  }
  return [...paths];
}

function extractStructuredSummary(
  report: string,
): Record<string, unknown> | null {
  const match = /```json\s*([\s\S]*?)\s*```/m.exec(report);
  if (!match) {
    return null;
  }
  try {
    const summary = JSON.parse(match[1]);
    return summary && typeof summary === "object" ? summary : null;
  } catch {
    return null;
  }
}

function resolveReportFilePath(
  appPath: string,
  filePath: string,
): string | null {
  if (path.isAbsolute(filePath)) {
    return null;
  }
  const appRoot = path.resolve(appPath);
  const resolvedPath = path.resolve(appRoot, filePath);
  if (
    resolvedPath !== appRoot &&
    !resolvedPath.startsWith(`${appRoot}${path.sep}`)
  ) {
    return null;
  }
  return resolvedPath;
}

function getFileStat(filePath: string): CachedFileStat | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return null;
    }
    return {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    };
  } catch {
    return null;
  }
}

function areCachedFileStatsCurrent(
  appPath: string,
  fileStats: Map<string, CachedFileStat>,
): boolean {
  for (const [filePath, cachedStat] of fileStats) {
    const resolvedPath = resolveReportFilePath(appPath, filePath);
    if (!resolvedPath) {
      return false;
    }
    const currentStat = getFileStat(resolvedPath);
    if (
      !currentStat ||
      currentStat.mtimeMs !== cachedStat.mtimeMs ||
      currentStat.size !== cachedStat.size
    ) {
      return false;
    }
  }
  return true;
}

function pruneExploreCodeReportCache(): void {
  if (exploreCodeReportCache.size <= MAX_EXPLORE_CODE_CACHE_ENTRIES) {
    return;
  }
  const entries = [...exploreCodeReportCache.entries()].sort(
    (left, right) => left[1].lastUsedAt - right[1].lastUsedAt,
  );
  for (
    let index = 0;
    index < entries.length - MAX_EXPLORE_CODE_CACHE_ENTRIES;
    index++
  ) {
    exploreCodeReportCache.delete(entries[index][0]);
  }
}
