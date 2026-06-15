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
  return getExploreCodeAvailabilityForAppPath(ctx, ctx.appPath);
}

function getExploreCodeAvailabilityForAppPath(
  ctx: AgentContext,
  appPath: string,
): {
  enabled: boolean;
  reason: string | null;
  tsconfigPath: string | null;
} {
  if (!ctx.isDyadPro) {
    return {
      enabled: false,
      reason: "dyad_pro_required",
      tsconfigPath: null,
    };
  }

  const settings = readSettings();
  if (!settings.enableCodeExplorer) {
    return {
      enabled: false,
      reason: "code_explorer_setting_disabled",
      tsconfigPath: null,
    };
  }

  const availability = getCodeExplorerAvailability(appPath);
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

Use this when you need to understand how a TypeScript, TSX, JavaScript, or JSX feature, symbol, type, component, service, or flow is implemented across files. It returns a compact report: a Flow of file/line ranges with quoted evidence, optional Read targets and Search targets, a Confidence, and an Action. Treat a high- or medium-confidence report as the codebase map and follow its Action rather than rediscovering the code.

Set the intent argument to what you will do with the result: explain for "trace how", data-flow, request-flow, or "how is this computed/surfaced" questions; locate for finding the best files/symbols; edit or debug when you will read exact ranges before changing code or verifying behavior.

Follow the report's Action:

| Action | Do next | Do NOT |
|--------|---------|--------|
| answer_from_report | Answer or plan directly from the report. | Re-read discovery files, grep, or call explore_code again. |
| read_targets | explain/locate: answer from the report, citing the listed targets as jump points. edit/debug: read only the listed tight ranges before changing or verifying code. | Read targets just to confirm the map for explain/locate (unless confidence is low or the user asked for edits/debugging/exact verification). |
| targeted_gap_search | Run only the rendered Search targets with their exact terms/scopes, then answer from the report plus those results and name any remaining gap. | Invent broader searches, open arbitrary hits, or call explore_code again. |
| skip_explore_result | Proceed without the report; nothing relevant was found. | Treat it as a map. |

If confidence is low, inspect the listed read/search targets before relying on the report. If an Action calls for Search targets but none are rendered, answer from the observed Flow and name the remaining gap. Do not call explore_code repeatedly for the same investigation after a high- or medium-confidence report.

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
    const targetAppPath = resolveTargetAppPath(ctx, args.app_name);
    const availability = getExploreCodeAvailabilityForAppPath(
      ctx,
      targetAppPath,
    );
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
      ctx.onXmlComplete(
        `<dyad-explore-code ${buildExploreCodeAttributes(effectiveArgs)} cached="true">\n${escapeXmlContent(cachedReport)}\n</dyad-explore-code>`,
      );
      return cachedReport;
    }

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
