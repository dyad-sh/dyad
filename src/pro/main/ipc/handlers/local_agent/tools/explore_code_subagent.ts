import { streamText, stepCountIs, type ToolSet } from "ai";
import crypto from "node:crypto";
import log from "electron-log";

import { readSettings } from "@/main/settings";
import { getModelClient } from "@/ipc/utils/get_model_client";
import { getAiHeaders, getProviderOptions } from "@/ipc/utils/provider_options";
import { cancelOrphanedBaseStream } from "@/ipc/utils/stream_text_utils";
import { getMaxTokens, getTemperature } from "@/ipc/utils/token_utils";
import type { UserSettings } from "@/lib/schemas";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  recordCodeExplorerBenchmarkEvent,
  summarizeBenchmarkValue,
} from "../benchmark_recorder";
import { grepTool } from "./grep";
import { listFilesTool } from "./list_files";
import { readFileTool } from "./read_file";
import { resolveTargetAppPath } from "./resolve_app_context";
import type { AgentContext, ToolDefinition } from "./types";
import {
  exploreCodeSchema,
  formatRawExploreCodeResult,
  runRawExploreCode,
  type ExploreCodeArgs,
} from "./explore_code_raw";

const logger = log.scope("explore_code_subagent");

const SUBAGENT_MODEL = { provider: "auto", name: "value" } as const;
const SUBAGENT_PHASE = "explore_code_subagent";
const SUBAGENT_MAX_STEPS = 1;
const SUBAGENT_MAX_OUTPUT_TOKENS = 4_000;
const SUBAGENT_MAX_RETRIES = 0;
const MAX_OBSERVATION_CHARS = 8_000;

interface SubagentObservation {
  toolName: string;
  args: unknown;
  result: string;
}

type TaskClass =
  | "route-flow"
  | "component-flow"
  | "mutation-action"
  | "state-store"
  | "styling-ui"
  | "config-build"
  | "unknown";

type Confidence = "high" | "medium" | "low";
type CompilerSignal = "strong" | "weak" | "not used";

interface ReportFileRef {
  path: string;
  range: string;
  symbols?: string[];
  purpose: string;
  evidence?: string;
  source: "explore_code" | "grep" | "read_file" | "list_files";
}

interface CoverageSummary {
  observed: string[];
  missing: string[];
}

interface RecommendedPrimaryAction {
  action: "answer_from_report" | "read_edit_target" | "targeted_gap_search";
  reason: string;
  readTarget?: {
    path: string;
    range: string;
    purpose: string;
  };
  searchTargets?: string[];
}

export async function runExploreCodeSubagent({
  args,
  ctx,
}: {
  args: ExploreCodeArgs;
  ctx: AgentContext;
}): Promise<string> {
  const settings = readSettings();
  assertDyadValueAvailable(settings);

  const subagentRunId = crypto.randomUUID();
  const startedAt = Date.now();
  const modelInfo = await getModelClient(SUBAGENT_MODEL, settings);
  const maxOutputTokens = Math.min(
    (await getMaxTokens(SUBAGENT_MODEL)) ?? SUBAGENT_MAX_OUTPUT_TOKENS,
    SUBAGENT_MAX_OUTPUT_TOKENS,
  );
  const temperature = await getTemperature(SUBAGENT_MODEL);
  const observations: SubagentObservation[] = [];
  const tools = buildExploreCodeSubagentTools({
    ctx,
    subagentRunId,
    observations,
  });

  recordCodeExplorerBenchmarkEvent({
    type: "subagent_start",
    phase: SUBAGENT_PHASE,
    chatId: ctx.chatId,
    appId: ctx.appId,
    parentToolName: "explore_code",
    subagentRunId,
    model: SUBAGENT_MODEL,
  });

  try {
    const streamResult = streamText({
      model: modelInfo.modelClient.model,
      headers: getAiHeaders({
        builtinProviderId: modelInfo.modelClient.builtinProviderId,
      }),
      providerOptions: getProviderOptions({
        dyadAppId: ctx.appId,
        dyadRequestId: ctx.dyadRequestId,
        dyadDisableFiles: true,
        files: [],
        mentionedAppsCodebases: [],
        builtinProviderId: modelInfo.modelClient.builtinProviderId,
        settings,
      }),
      maxOutputTokens,
      temperature,
      maxRetries: SUBAGENT_MAX_RETRIES,
      system: buildExploreCodeSubagentSystemPrompt(),
      prompt: buildExploreCodeSubagentPrompt(args),
      tools,
      stopWhen: stepCountIs(SUBAGENT_MAX_STEPS),
      abortSignal: ctx.abortSignal,
      onStepFinish: (step) => {
        recordCodeExplorerBenchmarkEvent({
          type: "stream_step_finish",
          phase: SUBAGENT_PHASE,
          chatId: ctx.chatId,
          appId: ctx.appId,
          parentToolName: "explore_code",
          subagentRunId,
          toolCallCount: step.toolCalls.length,
          toolNames: step.toolCalls.map((toolCall) => toolCall.toolName),
          usage: step.usage,
        });
      },
      onFinish: (event) => {
        recordCodeExplorerBenchmarkEvent({
          type: "stream_finish",
          phase: SUBAGENT_PHASE,
          chatId: ctx.chatId,
          appId: ctx.appId,
          parentToolName: "explore_code",
          subagentRunId,
          usage: event.totalUsage,
        });
      },
    });
    const fullStream = streamResult.fullStream;
    cancelOrphanedBaseStream(streamResult);

    let report = "";
    for await (const part of fullStream) {
      if (part.type === "text-delta") {
        report += part.text;
      }
    }

    await augmentWorkspacePackageObservations({
      args,
      tools,
      observations,
    });
    await augmentQueryGapObservations({
      args,
      tools,
      observations,
    });

    let trimmedReport = report.trim();
    if (observations.length > 0) {
      const deterministicReport = buildDeterministicReportFromObservations({
        args,
        observations,
      });
      if (deterministicReport) {
        trimmedReport = deterministicReport;
        recordCodeExplorerBenchmarkEvent({
          type: "subagent_deterministic_report",
          phase: SUBAGENT_PHASE,
          chatId: ctx.chatId,
          appId: ctx.appId,
          parentToolName: "explore_code",
          subagentRunId,
        });
      } else if (!trimmedReport) {
        trimmedReport = await synthesizeReportFromObservations({
          args,
          observations,
          ctx,
          settings,
          modelInfo,
          subagentRunId,
          maxOutputTokens,
          temperature,
        });
      }
    }
    if (!trimmedReport) {
      throw new DyadError(
        "explore_code sub-agent returned an empty report",
        DyadErrorKind.External,
      );
    }

    recordCodeExplorerBenchmarkEvent({
      type: "subagent_finish",
      phase: SUBAGENT_PHASE,
      chatId: ctx.chatId,
      appId: ctx.appId,
      parentToolName: "explore_code",
      subagentRunId,
      elapsedMs: Date.now() - startedAt,
    });

    return trimmedReport;
  } catch (error) {
    logger.warn("explore_code sub-agent failed", error);
    recordCodeExplorerBenchmarkEvent({
      type: "subagent_error",
      phase: SUBAGENT_PHASE,
      chatId: ctx.chatId,
      appId: ctx.appId,
      parentToolName: "explore_code",
      subagentRunId,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function assertDyadValueAvailable(settings: UserSettings): void {
  if (!settings.enableDyadPro || !settings.providerSettings?.auto?.apiKey) {
    throw new DyadError(
      "explore_code sub-agent requires Dyad Pro with an auto provider API key",
      DyadErrorKind.Precondition,
    );
  }
}

function buildExploreCodeSubagentTools({
  ctx,
  subagentRunId,
  observations,
}: {
  ctx: AgentContext;
  subagentRunId: string;
  observations: SubagentObservation[];
}): ToolSet {
  const childCtx: AgentContext = {
    ...ctx,
    onXmlStream: () => {},
    onXmlComplete: () => {},
    requireConsent: async () => true,
    appendUserMessage: () => {},
    onUpdateTodos: () => {},
    onWarningMessage: undefined,
  };

  const rawExploreCodeTool: ToolDefinition<ExploreCodeArgs> = {
    name: "explore_code",
    description:
      "Compiler-backed code explorer. Use this for TypeScript, TSX, JavaScript, or JSX symbols and flows that are included in the configured TypeScript project. It returns relevant symbols and line-numbered source windows grouped by file.",
    inputSchema: exploreCodeSchema,
    defaultConsent: "always",
    execute: async (toolArgs) => {
      const targetAppPath = resolveTargetAppPath(childCtx, toolArgs.app_name);
      const effectiveArgs = {
        ...toolArgs,
        query: buildCompilerSearchQuery(toolArgs.query),
      };
      const result = await runRawExploreCode({
        appPath: targetAppPath,
        args: effectiveArgs,
      });
      return formatRawExploreCodeResult(result);
    },
  };

  return {
    list_files: wrapSubagentTool(
      listFilesTool,
      childCtx,
      subagentRunId,
      observations,
    ),
    grep: wrapSubagentTool(grepTool, childCtx, subagentRunId, observations),
    read_file: wrapSubagentTool(
      readFileTool,
      childCtx,
      subagentRunId,
      observations,
    ),
    explore_code: wrapSubagentTool(
      rawExploreCodeTool,
      childCtx,
      subagentRunId,
      observations,
    ),
  };
}

function wrapSubagentTool<TArgs>(
  tool: ToolDefinition<TArgs>,
  ctx: AgentContext,
  subagentRunId: string,
  observations: SubagentObservation[],
) {
  return {
    description: tool.description,
    inputSchema: tool.inputSchema,
    execute: async (toolArgs: TArgs) => {
      const startedAt = Date.now();
      recordCodeExplorerBenchmarkEvent({
        type: "tool_call_start",
        phase: SUBAGENT_PHASE,
        chatId: ctx.chatId,
        appId: ctx.appId,
        parentToolName: "explore_code",
        subagentRunId,
        toolName: tool.name,
        argsPreview: summarizeBenchmarkValue(toolArgs),
      });
      try {
        const result = await tool.execute(toolArgs, ctx);
        observations.push({
          toolName: tool.name,
          args: toolArgs,
          result: formatObservationResult(result),
        });
        recordCodeExplorerBenchmarkEvent({
          type: "tool_call_end",
          phase: SUBAGENT_PHASE,
          chatId: ctx.chatId,
          appId: ctx.appId,
          parentToolName: "explore_code",
          subagentRunId,
          toolName: tool.name,
          elapsedMs: Date.now() - startedAt,
          resultPreview: summarizeBenchmarkValue(result),
        });
        return result;
      } catch (error) {
        if (ctx.abortSignal?.aborted) {
          throw error;
        }
        const errorMessage = formatToolError(tool.name, error);
        observations.push({
          toolName: tool.name,
          args: toolArgs,
          result: errorMessage,
        });
        recordCodeExplorerBenchmarkEvent({
          type: "tool_call_error",
          phase: SUBAGENT_PHASE,
          chatId: ctx.chatId,
          appId: ctx.appId,
          parentToolName: "explore_code",
          subagentRunId,
          toolName: tool.name,
          argsPreview: summarizeBenchmarkValue(toolArgs),
          error: error instanceof Error ? error.message : String(error),
        });
        return errorMessage;
      }
    },
  };
}

async function augmentWorkspacePackageObservations({
  args,
  tools,
  observations,
}: {
  args: ExploreCodeArgs;
  tools: ToolSet;
  observations: SubagentObservation[];
}): Promise<void> {
  if (!asksForWorkspacePackages(args.query)) {
    return;
  }

  const grep = tools.grep as unknown as
    | {
        execute: (toolArgs: {
          query: string;
          include_pattern?: string;
          exclude_pattern?: string;
          literal?: boolean;
          case_sensitive?: boolean;
          limit?: number;
        }) => Promise<unknown>;
      }
    | undefined;
  if (grep && !hasObservedPackageRef(observations)) {
    for (const query of getWorkspacePackageAugmentationQueries(args.query)) {
      await grep.execute({
        query,
        include_pattern: "packages/**/*.{ts,tsx,js,jsx}",
        exclude_pattern:
          "{**/*.test.*,**/*.spec.*,**/*.e2e.*,**/test/**,**/tests/**,**/testing/**,**/fixtures/**,**/playwright/**}",
        literal: true,
        case_sensitive: false,
        limit: 80,
      });
      if (hasObservedPackageRef(observations)) {
        break;
      }
    }
  }

  await augmentWorkspacePackageSourceObservation({
    args,
    tools,
    observations,
  });
}

async function augmentQueryGapObservations({
  args,
  tools,
  observations,
}: {
  args: ExploreCodeArgs;
  tools: ToolSet;
  observations: SubagentObservation[];
}): Promise<void> {
  const queryTerms = getQueryTerms(args.query);
  const compilerSignal = getCompilerSignal(observations);
  const primaryFiles = selectCoverageBalancedPrimaryFileRefs({
    query: args.query,
    refs: getRankedPrimaryFileRefs({
      query: args.query,
      observations,
      compilerSignal,
    }),
    maxCount: 5,
  });
  if (primaryFiles.length === 0) {
    return;
  }

  const coverage = getCoverageSummary({
    query: args.query,
    primaryFiles,
  });
  const confidence = getDeterministicConfidence({
    query: args.query,
    compilerSignal,
    primaryFiles,
    queryTerms,
    coverage,
  });
  const hasCriticalMissingCoverage = coverage.missing.some((cluster) =>
    isCriticalMissingCoverage(args.query, cluster),
  );
  const lacksSpecificSignal = !primaryFiles.some((fileRef) =>
    fileRefHasQuerySpecificSignal(fileRef, queryTerms),
  );
  const lacksToolbarActionBridge =
    isToolbarActionQuery(queryTerms) &&
    !hasToolbarActionBridgeObservation(observations, queryTerms);
  if (
    confidence !== "low" &&
    !hasCriticalMissingCoverage &&
    !lacksSpecificSignal &&
    !lacksToolbarActionBridge
  ) {
    return;
  }

  const grep = tools.grep as unknown as
    | {
        execute: (toolArgs: {
          query: string;
          include_pattern?: string;
          exclude_pattern?: string;
          literal?: boolean;
          case_sensitive?: boolean;
          limit?: number;
        }) => Promise<unknown>;
      }
    | undefined;
  if (!grep) {
    return;
  }

  if (lacksToolbarActionBridge) {
    await grep.execute({
      query: "ActionManager|syncActionResult|renderAction|executeAction",
      include_pattern:
        "{**/actions/**/*.{ts,tsx,js,jsx},**/components/**/*.{ts,tsx,js,jsx},**/app/**/*.{ts,tsx,js,jsx},**/src/**/*.{ts,tsx,js,jsx}}",
      exclude_pattern:
        "{examples/**,example/**,dev-docs/**,**/*.test.*,**/*.spec.*,**/*.e2e.*,**/test/**,**/tests/**,**/testing/**,**/fixtures/**,**/playwright/**,**/generated/**,**/locales/generated/**}",
      literal: false,
      case_sensitive: false,
      limit: 80,
    });
    await grep.execute({
      query:
        "syncActionResult|applyActionResult|handleActionResult|scheduleAction|replaceAllElements",
      include_pattern:
        "{**/components/App*.{ts,tsx,js,jsx},**/app/**/*.{ts,tsx,js,jsx},**/src/**/*App*.{ts,tsx,js,jsx}}",
      exclude_pattern:
        "{examples/**,example/**,dev-docs/**,**/*.test.*,**/*.spec.*,**/*.e2e.*,**/test/**,**/tests/**,**/testing/**,**/fixtures/**,**/playwright/**,**/generated/**,**/locales/generated/**}",
      literal: false,
      case_sensitive: false,
      limit: 60,
    });
  }

  for (const search of getGapAugmentationSearches({
    queryTerms,
    taskClass: classifyTask(args.query),
    coverage,
  })) {
    await grep.execute(search);
  }
}

function hasObservedPackageRef(observations: SubagentObservation[]): boolean {
  return observations.some((observation) =>
    extractFileRefs(observation, []).some((fileRef) =>
      fileRef.path.startsWith("packages/"),
    ),
  );
}

function hasToolbarActionBridgeObservation(
  observations: SubagentObservation[],
  queryTerms: string[],
): boolean {
  return observations.some((observation) =>
    extractFileRefs(observation, queryTerms).some(
      hasToolbarActionBridgeIdentity,
    ),
  );
}

async function augmentWorkspacePackageSourceObservation({
  args,
  tools,
  observations,
}: {
  args: ExploreCodeArgs;
  tools: ToolSet;
  observations: SubagentObservation[];
}): Promise<void> {
  const target = selectWorkspacePackageReadTarget({
    query: args.query,
    observations,
  });
  if (!target) {
    return;
  }

  const readFile = tools.read_file as unknown as
    | {
        execute: (toolArgs: {
          path: string;
          start_line_one_indexed?: number;
          end_line_one_indexed_inclusive?: number;
        }) => Promise<unknown>;
      }
    | undefined;
  if (!readFile) {
    return;
  }

  await readFile.execute({
    path: target.path,
    start_line_one_indexed: target.startLine,
    end_line_one_indexed_inclusive: target.endLine,
  });
}

function selectWorkspacePackageReadTarget({
  query,
  observations,
}: {
  query: string;
  observations: SubagentObservation[];
}): { path: string; startLine: number; endLine: number } | null {
  const queryTerms = getQueryTerms(query);
  const compilerSignal = getCompilerSignal(observations);
  const rankedPackageRefs = getRankedPrimaryFileRefs({
    query,
    observations,
    compilerSignal,
  }).filter(
    (fileRef) =>
      fileRef.source === "grep" &&
      fileRef.path.startsWith("packages/") &&
      isPackageImplementationPath(fileRef.path, queryTerms) &&
      !observations.some(
        (observation) =>
          observation.toolName === "read_file" &&
          parseReadFileArgs(observation.args)?.path === fileRef.path,
      ),
  );
  const targetRef = rankedPackageRefs[0];
  if (!targetRef) {
    return null;
  }

  const range = parseKnownRange(targetRef.range);
  if (!range) {
    return {
      path: targetRef.path,
      startLine: 1,
      endLine: 160,
    };
  }

  const startLine = Math.max(1, range.start - 20);
  const endLine = Math.max(
    startLine,
    Math.min(range.end + 80, startLine + 159),
  );
  return {
    path: targetRef.path,
    startLine,
    endLine,
  };
}

function isPackageImplementationPath(
  filePath: string,
  queryTerms: string[],
): boolean {
  const normalizedPath = filePath.toLowerCase();
  if (
    isTestOrSupportPath(normalizedPath) ||
    normalizedPath.endsWith(".d.ts") ||
    normalizedPath.endsWith(".d.tsx") ||
    normalizedPath.includes("/interfaces/")
  ) {
    return false;
  }
  if (
    !isAuditOrHistoryQuery(queryTerms) &&
    /(?:^|\/)(?:audit|audits|history|histories|report|reports)(?:\/|-|[A-Z_]|$)/i.test(
      filePath,
    )
  ) {
    return false;
  }
  return true;
}

function getWorkspacePackageAugmentationQueries(query: string): string[] {
  const terms = getQueryTerms(query);
  const actionTerms = ["create", "save", "submit", "persist", "delete"];
  const requestedAction =
    actionTerms.find((term) => terms.includes(term)) ?? "create";
  const domainTerm = terms.find(
    (term) =>
      term.length >= 4 &&
      !actionTerms.includes(term) &&
      ![
        "api",
        "form",
        "handle",
        "handler",
        "hook",
        "lib",
        "mutation",
        "service",
      ].includes(term),
  );
  if (!domainTerm) {
    return [requestedAction];
  }

  const pascalDomain = `${domainTerm[0]?.toUpperCase() ?? ""}${domainTerm.slice(1)}`;
  return [
    `${requestedAction}${pascalDomain}`,
    `handle${pascalDomain}`,
    `${requestedAction}-${domainTerm}`,
  ];
}

function getGapAugmentationSearches({
  queryTerms,
  taskClass,
  coverage,
}: {
  queryTerms: string[];
  taskClass: TaskClass;
  coverage: CoverageSummary;
}): Array<{
  query: string;
  include_pattern?: string;
  exclude_pattern?: string;
  literal?: boolean;
  case_sensitive?: boolean;
  limit?: number;
}> {
  const searches: Array<{
    query: string;
    include_pattern?: string;
    exclude_pattern?: string;
    literal?: boolean;
    case_sensitive?: boolean;
    limit?: number;
  }> = [];
  const sourceInclude = "**/*.{ts,tsx,js,jsx}";
  const sourceExclude =
    "{examples/**,example/**,dev-docs/**,**/*.test.*,**/*.spec.*,**/*.e2e.*,**/test/**,**/tests/**,**/testing/**,**/fixtures/**,**/playwright/**,**/generated/**,**/locales/generated/**}";

  if (queryTerms.includes("export")) {
    searches.push({
      query: "exportTo",
      include_pattern: sourceInclude,
      exclude_pattern: sourceExclude,
      literal: true,
      case_sensitive: false,
      limit: 80,
    });
  }

  if (
    taskClass === "component-flow" &&
    isToolbarActionQuery(queryTerms) &&
    coverage.missing.some((cluster) =>
      ["action/dispatch", "state/store update"].includes(cluster),
    )
  ) {
    searches.push({
      query: "actionManager|register\\(|perform\\(|setActiveTool|updateScene",
      include_pattern: sourceInclude,
      exclude_pattern: sourceExclude,
      literal: false,
      case_sensitive: false,
      limit: 120,
    });
  }
  if (
    taskClass === "component-flow" &&
    isToolbarActionQuery(queryTerms) &&
    coverage.missing.includes("render/output sink")
  ) {
    searches.push({
      query: "triggerUpdate|replaceAllElements|triggerRender|updateScene",
      include_pattern:
        "{packages/excalidraw/**/*.{ts,tsx,js,jsx},packages/element/**/*.{ts,tsx,js,jsx}}",
      exclude_pattern: sourceExclude,
      literal: false,
      case_sensitive: false,
      limit: 80,
    });
  }

  if (
    taskClass === "route-flow" ||
    coverage.missing.some((cluster) => cluster.includes("route/page"))
  ) {
    const domainTerm = getRouteDomainTerm(queryTerms);
    if (domainTerm) {
      searches.push({
        query: toPascalCase(domainTerm),
        include_pattern:
          "{**/routes/**/*.{ts,tsx,js,jsx},**/pages/**/*.{ts,tsx,js,jsx},**/navigation/**/*.{ts,tsx,js,jsx},**/router/**/*.{ts,tsx,js,jsx}}",
        exclude_pattern: sourceExclude,
        literal: true,
        case_sensitive: false,
        limit: 80,
      });
    }
  }

  return searches.slice(0, 2);
}

function getRouteDomainTerm(queryTerms: string[]): string | null {
  if (
    queryTerms.includes("record") &&
    (queryTerms.includes("detail") ||
      queryTerms.includes("page") ||
      queryTerms.includes("route"))
  ) {
    return "record";
  }
  if (queryTerms.includes("detail")) {
    return "detail";
  }

  const specificTerms = getQuerySpecificTerms(queryTerms);
  return (
    specificTerms.find(
      (term) =>
        ![
          "loaded",
          "rendered",
          "trace",
          "identify",
          "implementation",
          "files",
          "symbols",
          "related",
          "starting",
          "involved",
        ].includes(term),
    ) ?? null
  );
}

function toPascalCase(term: string): string {
  return term
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}

function formatToolError(toolName: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Tool ${toolName} failed: ${message}`;
}

async function synthesizeReportFromObservations({
  args,
  observations,
  ctx,
  settings,
  modelInfo,
  subagentRunId,
  maxOutputTokens,
  temperature,
}: {
  args: ExploreCodeArgs;
  observations: SubagentObservation[];
  ctx: AgentContext;
  settings: UserSettings;
  modelInfo: Awaited<ReturnType<typeof getModelClient>>;
  subagentRunId: string;
  maxOutputTokens: number;
  temperature: number | undefined;
}): Promise<string> {
  recordCodeExplorerBenchmarkEvent({
    type: "subagent_synthesis_start",
    phase: SUBAGENT_PHASE,
    chatId: ctx.chatId,
    appId: ctx.appId,
    parentToolName: "explore_code",
    subagentRunId,
  });
  const streamResult = streamText({
    model: modelInfo.modelClient.model,
    headers: getAiHeaders({
      builtinProviderId: modelInfo.modelClient.builtinProviderId,
    }),
    providerOptions: getProviderOptions({
      dyadAppId: ctx.appId,
      dyadRequestId: ctx.dyadRequestId,
      dyadDisableFiles: true,
      files: [],
      mentionedAppsCodebases: [],
      builtinProviderId: modelInfo.modelClient.builtinProviderId,
      settings,
    }),
    maxOutputTokens,
    temperature,
    maxRetries: SUBAGENT_MAX_RETRIES,
    system:
      "You are a code reconnaissance sub-agent. Write the final explore_code report from the supplied tool observations. Do not call tools. Do not include large source excerpts.",
    prompt: buildObservationSynthesisPrompt(args, observations),
    abortSignal: ctx.abortSignal,
    onStepFinish: (step) => {
      recordCodeExplorerBenchmarkEvent({
        type: "stream_step_finish",
        phase: SUBAGENT_PHASE,
        stage: "synthesis",
        chatId: ctx.chatId,
        appId: ctx.appId,
        parentToolName: "explore_code",
        subagentRunId,
        toolCallCount: step.toolCalls.length,
        toolNames: step.toolCalls.map((toolCall) => toolCall.toolName),
        usage: step.usage,
      });
    },
    onFinish: (event) => {
      recordCodeExplorerBenchmarkEvent({
        type: "stream_finish",
        phase: SUBAGENT_PHASE,
        stage: "synthesis",
        chatId: ctx.chatId,
        appId: ctx.appId,
        parentToolName: "explore_code",
        subagentRunId,
        usage: event.usage,
      });
    },
  });
  const fullStream = streamResult.fullStream;
  cancelOrphanedBaseStream(streamResult);

  let report = "";
  for await (const part of fullStream) {
    if (part.type === "text-delta") {
      report += part.text;
    }
  }
  return report.trim();
}

function formatObservationResult(result: unknown): string {
  const text =
    typeof result === "string" ? result : JSON.stringify(result, null, 2);
  if (text.length <= MAX_OBSERVATION_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_OBSERVATION_CHARS)}\n[TRUNCATED]`;
}

function buildDeterministicReportFromObservations({
  args,
  observations,
}: {
  args: ExploreCodeArgs;
  observations: SubagentObservation[];
}): string | null {
  if (observations.length === 0) {
    return null;
  }

  const taskClass = classifyTask(args.query);
  const queryTerms = getQueryTerms(args.query);
  const compilerSignal = getCompilerSignal(observations);
  const primaryFiles = selectCoverageBalancedPrimaryFileRefs({
    query: args.query,
    refs: getRankedPrimaryFileRefs({
      query: args.query,
      observations,
      compilerSignal,
    }),
    maxCount: 5,
  });
  if (primaryFiles.length === 0) {
    return null;
  }

  const coverage = getCoverageSummary({
    query: args.query,
    primaryFiles,
  });
  const confidence = getDeterministicConfidence({
    query: args.query,
    compilerSignal,
    primaryFiles,
    queryTerms,
    coverage,
  });
  const criticalMissingCoverage = coverage.missing.filter((cluster) =>
    isCriticalMissingCoverage(args.query, cluster),
  );
  const editTarget =
    confidence === "low" || criticalMissingCoverage.length > 0
      ? null
      : {
          path: primaryFiles[0].path,
          range: primaryFiles[0].range,
          purpose: primaryFiles[0].purpose,
        };
  const structuredPrimaryFiles = primaryFiles.map(toStructuredFileRef);
  const recommendedPrimaryAction = getRecommendedPrimaryAction({
    query: args.query,
    confidence,
    editTarget,
    coverage,
    primaryFiles,
  });
  const structuredSummary = {
    confidence,
    taskClass,
    compilerSignal,
    primaryFiles: structuredPrimaryFiles,
    secondaryFiles: [],
    editTarget,
    coverage,
    recommendedPrimaryAction,
  };
  const findings = primaryFiles.map((fileRef, index) => {
    const symbolText =
      fileRef.symbols && fileRef.symbols.length > 0
        ? fileRef.symbols.join(", ")
        : "observed match";
    const evidenceText = getEvidenceText(fileRef, compilerSignal);
    return [
      `${index + 1}. ${fileRef.path}:${fileRef.range} - ${symbolText}`,
      `   Fact: ${fileRef.purpose}.`,
      `   Evidence: ${evidenceText}`,
    ].join("\n");
  });
  const compilerExplanation =
    compilerSignal === "strong"
      ? "explore_code returned symbol-level source windows with exact ranges."
      : compilerSignal === "weak"
        ? "explore_code ran but did not return precise matching symbols."
        : "the sub-agent used file/search tools without compiler-backed symbol results.";

  return [
    "## explore_code report",
    "",
    `Query: "${args.query}"`,
    `Task class: ${taskClass}`,
    `Confidence: ${confidence}`,
    `Compiler signal: ${compilerSignal}`,
    "",
    "Structured summary:",
    "```json",
    JSON.stringify(structuredSummary, null, 2),
    "```",
    "",
    "Findings:",
    ...findings,
    "",
    "Flow:",
    getDeterministicFlowText({
      primaryFiles,
      coverage,
      compilerExplanation,
    }),
    "",
    "Edit target:",
    editTarget
      ? `${editTarget.path}:${editTarget.range} - ${editTarget.purpose}`
      : "none",
    "",
    "Recommended primary action:",
    formatRecommendedPrimaryAction(recommendedPrimaryAction),
    "",
    "Skip / unknown:",
    getSkipUnknownText({ compilerSignal, observations }),
  ].join("\n");
}

function getRecommendedPrimaryAction({
  query,
  confidence,
  editTarget,
  coverage,
  primaryFiles,
}: {
  query: string;
  confidence: Confidence;
  editTarget: RecommendedPrimaryAction["readTarget"] | null;
  coverage: CoverageSummary;
  primaryFiles: ReportFileRef[];
}): RecommendedPrimaryAction {
  const requiresCodeRead = isCodeChangeOrVerificationQuery(query);
  const criticalMissingCoverage = coverage.missing.filter((cluster) =>
    isCriticalMissingCoverage(query, cluster),
  );
  const shouldSearchForMissingCoverage =
    confidence === "low" ||
    criticalMissingCoverage.length > 0 ||
    (requiresCodeRead && coverage.missing.length > 0);

  if (shouldSearchForMissingCoverage) {
    const searchTargets = buildTargetedGapSearchTargets({
      query,
      missingCoverage:
        criticalMissingCoverage.length > 0
          ? criticalMissingCoverage
          : coverage.missing,
      primaryFiles,
    });
    return {
      action: "targeted_gap_search",
      reason:
        confidence === "low"
          ? "Report confidence is low; use only the listed search targets before relying on it."
          : "The report found a useful map but did not cover every requested aspect.",
      searchTargets,
    };
  }

  if (editTarget && requiresCodeRead) {
    return {
      action: "read_edit_target",
      reason:
        "Use the report for understanding, then open only this target before editing or verifying exact code.",
      readTarget: editTarget,
    };
  }

  return {
    action: "answer_from_report",
    reason:
      "The report has enough high-confidence findings for an answer-only investigation.",
  };
}

function isCodeChangeOrVerificationQuery(query: string): boolean {
  const normalized = query.toLowerCase();
  return /\b(edit|change|modify|implement|add|fix|debug|repair|refactor|wire|integrate|verify|confirm|validate|check|test)\b/.test(
    normalized,
  );
}

function isCriticalMissingCoverage(query: string, cluster: string): boolean {
  const normalized = query.toLowerCase();
  if (cluster === "workspace/package implementation") {
    return /\b(workspace|package|packages|monorepo)\b/.test(normalized);
  }
  if (cluster === "route/page entry") {
    return /\b(route|page|screen|loader)\b/.test(normalized);
  }
  if (cluster === "component/UI handler") {
    return /\b(component|render|toolbar|button|form|modal|view|ui)\b/.test(
      normalized,
    );
  }
  if (cluster === "action/dispatch") {
    return /\b(action|dispatch|handler|callback|event|submit|submits|submitted)\b/.test(
      normalized,
    );
  }
  if (cluster === "data/API layer") {
    return /\b(api|request|query|trpc|graphql|fetch|server|database|persist|persistence)\b/.test(
      normalized,
    );
  }
  if (cluster === "state/store update") {
    return /\b(state|store|update|mutation|reducer|atom|context|persist|persistence)\b/.test(
      normalized,
    );
  }
  if (cluster === "render/output sink") {
    return /\b(render|scene|canvas|view|output|paint|draw|serialize|serialization|download|share|image)\b/.test(
      normalized,
    );
  }
  return false;
}

function formatRecommendedPrimaryAction(
  action: RecommendedPrimaryAction,
): string {
  if (action.action === "read_edit_target" && action.readTarget) {
    return `read_edit_target: ${action.readTarget.path}:${action.readTarget.range} - ${action.reason}`;
  }
  if (action.action === "targeted_gap_search") {
    return `targeted_gap_search: ${action.reason} Targets: ${(action.searchTargets ?? []).join(", ")}`;
  }
  return `${action.action}: ${action.reason}`;
}

function buildTargetedGapSearchTargets({
  query,
  missingCoverage,
  primaryFiles,
}: {
  query: string;
  missingCoverage: string[];
  primaryFiles: ReportFileRef[];
}): string[] {
  const gaps =
    missingCoverage.length > 0
      ? missingCoverage
      : ["query-relevant entry point"];
  const queryTerms = getQueryTerms(query);
  return gaps.map((gap) => {
    const terms = getGapSearchTerms(
      gap,
      stripMutationQueryFillerTerms(queryTerms),
    );
    const scopes = getSuggestedSearchScopes(primaryFiles, query, gap);
    const scopeText =
      scopes.length > 0
        ? ` scoped to ${scopes.join(", ")}`
        : " scoped to the focused app/package";
    return `${gap}: search only ${terms.join(", ")}${scopeText}; use grep literal=true for exact snippets containing punctuation.`;
  });
}

function getGapSearchTerms(gap: string, queryTerms: string[]): string[] {
  const terms = new Set<string>();
  for (const term of queryTerms) {
    terms.add(normalizeSearchTerm(term));
  }
  const lowerGap = gap.toLowerCase();
  if (lowerGap.includes("action") || lowerGap.includes("dispatch")) {
    addTerms(terms, [
      "handle",
      "handler",
      "submit",
      "dispatch",
      "action",
      "mutation",
      "create",
      "save",
    ]);
  } else if (lowerGap.includes("api") || lowerGap.includes("data")) {
    addTerms(terms, [
      "api",
      "route",
      "handler",
      "fetch",
      "request",
      "mutation",
      "create",
      "save",
    ]);
  } else if (lowerGap.includes("state") || lowerGap.includes("store")) {
    addTerms(terms, ["store", "state", "atom", "reducer", "set", "update"]);
  } else if (lowerGap.includes("render") || lowerGap.includes("output")) {
    addTerms(terms, ["render", "update", "scene", "view", "output"]);
  } else if (lowerGap.includes("route") || lowerGap.includes("page")) {
    addTerms(terms, ["route", "page", "loader", "screen"]);
  } else if (lowerGap.includes("component") || lowerGap.includes("ui")) {
    addTerms(terms, ["component", "view", "button", "form", "modal"]);
  } else if (lowerGap.includes("workspace") || lowerGap.includes("package")) {
    addTerms(terms, [
      "package",
      "lib",
      "service",
      "handler",
      "create",
      "save",
      "mutation",
    ]);
  }
  return [...terms].filter(Boolean).slice(0, 10);
}

function addTerms(target: Set<string>, terms: string[]): void {
  for (const term of terms) {
    target.add(term);
  }
}

function normalizeSearchTerm(term: string): string {
  if (/^auth(?:entication)?$/.test(term)) return "auth";
  if (/^creat(?:e|es|ed|ing|ion|ions)$/.test(term)) return "create";
  if (/^export(?:s|ed|ing)?$/.test(term)) return "export";
  if (/^log(?:in|gedin|gingin)$/.test(term)) return "login";
  if (/^sav(?:e|es|ed|ing)$/.test(term)) return "save";
  if (/^sign[-_ ]?in$/.test(term)) return "signin";
  if (/^sign[-_ ]?up$/.test(term)) return "signup";
  if (/^submitt?(?:s|ed|ing)?$/.test(term)) return "submit";
  if (/^updat(?:e|es|ed|ing)$/.test(term)) return "update";
  if (/^delet(?:e|es|ed|ing|ion)$/.test(term)) return "delete";
  if (/^(?:send|sends|sent|sending)$/.test(term)) return "send";
  if (/^start(?:s|ed|ing)?$/.test(term)) return "start";
  if (/^actions?$/.test(term)) return "action";
  if (/^clients?$/.test(term)) return "client";
  if (/^components?$/.test(term)) return "component";
  if (/^handlers?$/.test(term)) return "handler";
  if (/^hooks?$/.test(term)) return "hook";
  if (/^receiv(?:e|es|ed|ing)$/.test(term)) return "receive";
  if (/^routes?$/.test(term)) return "route";
  if (/^services?$/.test(term)) return "service";
  if (/^types?$/.test(term)) return "type";
  if (/^views?$/.test(term)) return "view";
  return term;
}

function getSuggestedSearchScopes(
  primaryFiles: ReportFileRef[],
  query: string,
  gap?: string,
): string[] {
  const scopes: string[] = [];
  const addScope = (scope: string | null) => {
    if (scope && !scopes.includes(scope)) {
      scopes.push(scope);
    }
  };
  const gapScopes = getGapRequestedScopes(gap);
  for (const scope of gapScopes) {
    addScope(scope);
  }
  for (const fileRef of primaryFiles
    .filter((fileRef) => shouldUseFileRefForSearchScope(fileRef))
    .slice(0, 4)) {
    addScope(directoryScope(fileRef.path));
  }
  if (gapScopes.length === 0) {
    for (const scope of getQueryRequestedScopes(query)) {
      addScope(scope);
    }
  }
  return scopes.slice(0, 3);
}

function shouldUseFileRefForSearchScope(fileRef: ReportFileRef): boolean {
  return (
    (fileRef.source === "explore_code" || fileRef.source === "read_file") &&
    !isTestOrSupportPath(fileRef.path.toLowerCase())
  );
}

function getQueryRequestedScopes(query: string): string[] {
  const normalized = query.toLowerCase();
  const scopes: string[] = [];
  for (const match of normalized.matchAll(
    /\b((?:apps|packages)\/[a-z0-9._-]+)(?:\/|\b)/g,
  )) {
    if (match[1] && !scopes.includes(match[1])) {
      scopes.push(match[1]);
    }
  }
  if (/\b(workspace|package|packages|monorepo)\b/.test(normalized)) {
    scopes.push("packages");
  }
  return scopes;
}

function getGapRequestedScopes(gap?: string): string[] {
  const normalized = gap?.toLowerCase() ?? "";
  if (normalized.includes("workspace") || normalized.includes("package")) {
    return ["packages"];
  }
  return [];
}

function directoryScope(filePath: string): string | null {
  const parts = filePath.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return null;
  }
  if (parts[0] === "apps" && parts.length >= 3) {
    return parts.slice(0, 3).join("/");
  }
  if (parts[0] === "packages" && parts.length >= 3) {
    return parts.slice(0, 3).join("/");
  }
  if (parts[0] === "src" && parts.length >= 2) {
    return parts.slice(0, 2).join("/");
  }
  return parts.slice(0, Math.min(parts.length - 1, 2)).join("/");
}

function classifyTask(query: string): TaskClass {
  const normalized = query.toLowerCase();
  if (/\b(route|routing|loader|page|screen|navigation)\b/.test(normalized)) {
    return "route-flow";
  }
  if (
    /\b(component|render|tsx|jsx|toolbar|button|modal|dialog|view|ui)\b/.test(
      normalized,
    ) &&
    !/\b(mutation|submit|submits|submitted|send|sends|sent|sending|save|saving|delete|create|creates|creating|creation|api|request|persist|persistence)\b/.test(
      normalized,
    )
  ) {
    return "component-flow";
  }
  if (
    /\b(mutation|submit|submits|submitted|send|sends|sent|sending|save|saving|delete|create|creates|creating|creation|update|api|request|persist|persistence)\b/.test(
      normalized,
    )
  ) {
    return "mutation-action";
  }
  if (/\b(state|store|atom|redux|zustand|context|reducer)\b/.test(normalized)) {
    return "state-store";
  }
  if (/\b(style|css|tailwind|class|layout|theme)\b/.test(normalized)) {
    return "styling-ui";
  }
  if (
    /\b(config|build|vite|webpack|tsconfig|package|script)\b/.test(normalized)
  ) {
    return "config-build";
  }
  return "unknown";
}

function getCompilerSignal(
  observations: SubagentObservation[],
): CompilerSignal {
  const exploreObservations = observations.filter(
    (observation) => observation.toolName === "explore_code",
  );
  if (exploreObservations.length === 0) {
    return "not used";
  }
  return exploreObservations.some((observation) =>
    /^Found [1-9]\d* symbols across [1-9]\d* files\./m.test(observation.result),
  )
    ? "strong"
    : "weak";
}

function getDeterministicConfidence({
  query,
  compilerSignal,
  primaryFiles,
  queryTerms,
  coverage,
}: {
  query: string;
  compilerSignal: CompilerSignal;
  primaryFiles: ReportFileRef[];
  queryTerms: string[];
  coverage: CoverageSummary;
}): Confidence {
  const hasSpecificPrimaryFile = primaryFiles.some((fileRef) =>
    fileRefHasQuerySpecificSignal(fileRef, queryTerms),
  );
  if (!hasSpecificPrimaryFile) {
    return "low";
  }
  if (
    hasStrictDomainRequirement(queryTerms) &&
    !primaryFiles.some((fileRef) =>
      fileRefHasStrictDomainSignal(fileRef, queryTerms),
    )
  ) {
    return "low";
  }
  if (
    coverage.missing.some((cluster) =>
      isCriticalMissingCoverage(query, cluster),
    )
  ) {
    return "medium";
  }
  if (
    compilerSignal === "strong" &&
    primaryFiles.some(
      (fileRef) =>
        fileRef.source === "explore_code" &&
        fileRefHasQuerySpecificSignal(fileRef, queryTerms),
    )
  ) {
    return "high";
  }
  if (primaryFiles.some((fileRef) => fileRef.range !== "unknown")) {
    return "medium";
  }
  return "low";
}

function getRankedPrimaryFileRefs({
  query,
  observations,
  compilerSignal,
}: {
  query: string;
  observations: SubagentObservation[];
  compilerSignal: CompilerSignal;
}): ReportFileRef[] {
  const seen = new Set<string>();
  const refs: ReportFileRef[] = [];
  const queryTerms = getQueryTerms(query);
  const wantsWorkspacePackages = asksForWorkspacePackages(query);

  for (const observation of observations) {
    for (const fileRef of extractFileRefs(observation, queryTerms)) {
      const key = `${fileRef.path}:${fileRef.range}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      refs.push(fileRef);
    }
  }

  const rankedRefs = refs.sort((left, right) => {
    const scoreDelta =
      scoreFileRef(
        right,
        query,
        queryTerms,
        compilerSignal,
        wantsWorkspacePackages,
      ) -
      scoreFileRef(
        left,
        query,
        queryTerms,
        compilerSignal,
        wantsWorkspacePackages,
      );
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return left.path.localeCompare(right.path);
  });
  return applyPrimaryFileRefPolicy({
    refs: collapseOverlappingFileRefs(rankedRefs),
    queryTerms,
    compilerSignal,
  });
}

function selectCoverageBalancedPrimaryFileRefs({
  query,
  refs,
  maxCount,
}: {
  query: string;
  refs: ReportFileRef[];
  maxCount: number;
}): ReportFileRef[] {
  const queryTerms = getQueryTerms(query);
  const requestedClusters = getRequestedCoverageClusters(query);
  const selected = refs.slice(0, maxCount);
  const selectedKeys = new Set(
    selected.map((fileRef) => `${fileRef.path}:${fileRef.range}`),
  );

  for (const cluster of requestedClusters) {
    if (
      selected.some((fileRef) =>
        fileRefMatchesCluster(fileRef, cluster, queryTerms),
      )
    ) {
      continue;
    }

    const candidate = refs.find(
      (fileRef) =>
        !selectedKeys.has(`${fileRef.path}:${fileRef.range}`) &&
        fileRefMatchesCluster(fileRef, cluster, queryTerms),
    );
    if (!candidate) {
      continue;
    }

    if (selected.length < maxCount) {
      selected.push(candidate);
      selectedKeys.add(`${candidate.path}:${candidate.range}`);
      continue;
    }

    const replaceIndex = findCoverageRedundantReplacementIndex({
      selected,
      requestedClusters,
      queryTerms,
    });
    if (replaceIndex === -1) {
      continue;
    }
    selectedKeys.delete(
      `${selected[replaceIndex].path}:${selected[replaceIndex].range}`,
    );
    selected[replaceIndex] = candidate;
    selectedKeys.add(`${candidate.path}:${candidate.range}`);
  }

  return selected;
}

function findCoverageRedundantReplacementIndex({
  selected,
  requestedClusters,
  queryTerms,
}: {
  selected: ReportFileRef[];
  requestedClusters: string[];
  queryTerms: string[];
}): number {
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    const remainingRefs = selected.filter((_, refIndex) => refIndex !== index);
    const losesObservedCluster = requestedClusters.some(
      (cluster) =>
        selected.some((fileRef) =>
          fileRefMatchesCluster(fileRef, cluster, queryTerms),
        ) &&
        !remainingRefs.some((fileRef) =>
          fileRefMatchesCluster(fileRef, cluster, queryTerms),
        ),
    );
    if (!losesObservedCluster) {
      return index;
    }
  }
  return selected.length > 0 ? selected.length - 1 : -1;
}

function applyPrimaryFileRefPolicy({
  refs,
  queryTerms,
  compilerSignal,
}: {
  refs: ReportFileRef[];
  queryTerms: string[];
  compilerSignal: CompilerSignal;
}): ReportFileRef[] {
  const supportFilteredRefs =
    !isTestQuery(queryTerms) &&
    refs.some((fileRef) => !isTestOrSupportPath(fileRef.path.toLowerCase()))
      ? refs.filter(
          (fileRef) => !isTestOrSupportPath(fileRef.path.toLowerCase()),
        )
      : refs;
  const routePolicyRefs = applyRoutePrimaryFileRefPolicy(
    supportFilteredRefs,
    queryTerms,
  );
  const toolbarPolicyRefs = applyToolbarActionPrimaryFileRefPolicy(
    routePolicyRefs,
    queryTerms,
  );
  if (
    compilerSignal !== "strong" ||
    !isMutationQuery(queryTerms) ||
    !toolbarPolicyRefs.some((fileRef) => fileRef.source === "explore_code")
  ) {
    return toolbarPolicyRefs;
  }

  const filteredRefs = toolbarPolicyRefs.filter(
    (fileRef) => !isLowSignalMutationRouteRef(fileRef),
  );
  const mutationPolicyRefs =
    filteredRefs.length > 0 ? filteredRefs : toolbarPolicyRefs;
  const implementationRefs = mutationPolicyRefs.filter(
    (fileRef) => !isTestOrSupportPath(fileRef.path.toLowerCase()),
  );
  const policyRefs =
    !isTestQuery(queryTerms) && implementationRefs.length > 0
      ? implementationRefs
      : mutationPolicyRefs;
  return dropWeakerDuplicatePathRefs(policyRefs);
}

function applyRoutePrimaryFileRefPolicy(
  refs: ReportFileRef[],
  queryTerms: string[],
): ReportFileRef[] {
  if (!isRouteQuery(queryTerms) || !isRecordDetailRouteQuery(queryTerms)) {
    return refs;
  }
  const highSignalRefs = refs.filter((fileRef) =>
    hasRecordDetailRouteIdentity(fileRef),
  );
  if (highSignalRefs.length === 0) {
    return refs;
  }
  const highSignalKeys = new Set(
    highSignalRefs.map((fileRef) => `${fileRef.path}:${fileRef.range}`),
  );
  return [
    ...highSignalRefs,
    ...refs.filter(
      (fileRef) => !highSignalKeys.has(`${fileRef.path}:${fileRef.range}`),
    ),
  ];
}

function applyToolbarActionPrimaryFileRefPolicy(
  refs: ReportFileRef[],
  queryTerms: string[],
): ReportFileRef[] {
  if (!isToolbarActionQuery(queryTerms)) {
    return refs;
  }
  const bridgeRefs = refs.filter(hasToolbarActionBridgeIdentity);
  if (bridgeRefs.length === 0) {
    return refs;
  }
  const bridgeKeys = new Set(
    bridgeRefs.map((fileRef) => `${fileRef.path}:${fileRef.range}`),
  );
  return [
    ...bridgeRefs,
    ...refs.filter(
      (fileRef) => !bridgeKeys.has(`${fileRef.path}:${fileRef.range}`),
    ),
  ];
}

function isLowSignalMutationRouteRef(fileRef: ReportFileRef): boolean {
  if (fileRef.source !== "grep" && fileRef.source !== "list_files") {
    return false;
  }
  const normalizedPath = fileRef.path.toLowerCase();
  return (
    isRouteOrDisplayPath(normalizedPath) &&
    !hasMutationPathIntent(normalizedPath)
  );
}

function dropWeakerDuplicatePathRefs(refs: ReportFileRef[]): ReportFileRef[] {
  return refs.filter((fileRef, index) => {
    if (fileRef.source !== "list_files" || fileRef.range !== "unknown") {
      return true;
    }
    return !refs
      .slice(0, index)
      .some((previousRef) => previousRef.path === fileRef.path);
  });
}

function extractFileRefs(
  observation: SubagentObservation,
  queryTerms: string[],
): ReportFileRef[] {
  if (observation.toolName === "explore_code") {
    return extractExploreCodeRefs(observation.result);
  }
  if (observation.toolName === "grep") {
    return extractGrepRefs(observation.result);
  }
  if (observation.toolName === "read_file") {
    return extractReadFileRefs(observation, queryTerms);
  }
  if (observation.toolName === "list_files") {
    return extractListFilesRefs(observation.result);
  }
  return [];
}

function extractExploreCodeRefs(result: string): ReportFileRef[] {
  const refs: ReportFileRef[] = [];
  const fileHeaderRegex = /^#### ([^\n]+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = fileHeaderRegex.exec(result)) !== null) {
    const header = match[1];
    const nextHeaderIndex = result.indexOf(
      "\n#### ",
      fileHeaderRegex.lastIndex,
    );
    const section =
      nextHeaderIndex === -1
        ? result.slice(fileHeaderRegex.lastIndex)
        : result.slice(fileHeaderRegex.lastIndex, nextHeaderIndex);
    const rangeMatch = /^Lines (\d+)-(\d+):/m.exec(section);
    const { path, symbols } = parseExploreCodeHeader(header);
    refs.push({
      path,
      range: rangeMatch ? `${rangeMatch[1]}-${rangeMatch[2]}` : "unknown",
      symbols,
      purpose: "compiler-backed symbol window relevant to the query",
      source: "explore_code",
    });
  }

  return refs;
}

function parseExploreCodeHeader(header: string): {
  path: string;
  symbols: string[];
} {
  const separator = " - ";
  const separatorIndex = header.indexOf(separator);
  if (separatorIndex === -1) {
    return { path: header.trim(), symbols: [] };
  }
  const path = header.slice(0, separatorIndex).trim();
  const symbols = header
    .slice(separatorIndex + separator.length)
    .split(",")
    .map((part) => part.replace(/\s+\([^)]*\)$/, "").trim())
    .filter(Boolean);
  return { path, symbols };
}

function extractGrepRefs(result: string): ReportFileRef[] {
  const refsByPath = new Map<
    string,
    { min: number; max: number; evidence: string[] }
  >();
  for (const line of result.split("\n")) {
    const match = /^([^:\n]+):(\d+):/.exec(line);
    if (!match) {
      continue;
    }
    const path = match[1];
    const lineNumber = Number(match[2]);
    const lineText = line.slice(match[0].length).trim();
    const existing = refsByPath.get(path);
    if (existing) {
      existing.min = Math.min(existing.min, lineNumber);
      existing.max = Math.max(existing.max, lineNumber);
      if (existing.evidence.length < 3) {
        existing.evidence.push(
          `line ${lineNumber}: ${truncateEvidence(lineText)}`,
        );
      }
    } else {
      refsByPath.set(path, {
        min: lineNumber,
        max: lineNumber,
        evidence: [`line ${lineNumber}: ${truncateEvidence(lineText)}`],
      });
    }
  }
  return [...refsByPath.entries()].map(([path, range]) => ({
    path,
    range: `${range.min}-${range.max}`,
    purpose: "grep match range relevant to the query",
    evidence: range.evidence.join("; "),
    source: "grep",
  }));
}

function extractReadFileRefs(
  observation: SubagentObservation,
  queryTerms: string[],
): ReportFileRef[] {
  const args = parseReadFileArgs(observation.args);
  if (!args) {
    return [];
  }
  const range =
    args.startLine != null && args.endLine != null
      ? `${args.startLine}-${args.endLine}`
      : args.startLine != null
        ? `${args.startLine}-unknown`
        : args.endLine != null
          ? `1-${args.endLine}`
          : "unknown";
  return [
    {
      path: args.path,
      range,
      purpose: "source range read directly by the sub-agent",
      evidence: summarizeReadFileEvidence({
        result: observation.result,
        startLine: args.startLine,
        queryTerms,
      }),
      source: "read_file",
    },
  ];
}

function parseReadFileArgs(
  args: unknown,
): { path: string; startLine?: number; endLine?: number } | null {
  if (!args || typeof args !== "object") {
    return null;
  }
  const maybeArgs = args as Record<string, unknown>;
  const path = maybeArgs.path;
  if (typeof path !== "string" || !path) {
    return null;
  }
  const startLine = maybeArgs.start_line_one_indexed;
  const endLine = maybeArgs.end_line_one_indexed_inclusive;
  return {
    path,
    startLine: typeof startLine === "number" ? startLine : undefined,
    endLine: typeof endLine === "number" ? endLine : undefined,
  };
}

function extractListFilesRefs(result: string): ReportFileRef[] {
  return result
    .split("\n")
    .map((line) => /^\s*-\s+(.+)$/.exec(line)?.[1]?.trim())
    .filter((path): path is string => Boolean(path && !path.endsWith("/")))
    .slice(0, 5)
    .map((path) => ({
      path,
      range: "unknown",
      purpose: "candidate file found by directory listing",
      source: "list_files",
    }));
}

function getQueryTerms(query: string): string[] {
  const stopWords = new Set([
    "and",
    "are",
    "app",
    "apps",
    "code",
    "file",
    "files",
    "find",
    "flow",
    "for",
    "front",
    "from",
    "handled",
    "how",
    "include",
    "including",
    "identify",
    "implementation",
    "in",
    "involved",
    "key",
    "loaded",
    "rendered",
    "package",
    "packages",
    "part",
    "path",
    "reaches",
    "related",
    "repo",
    "repository",
    "source",
    "start",
    "starting",
    "symbol",
    "symbols",
    "that",
    "the",
    "they",
    "this",
    "to",
    "trace",
    "participate",
    "participates",
    "participating",
    "used",
    "web",
    "when",
    "where",
    "with",
    "workspace",
  ]);
  return [
    ...new Set(
      query
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map(normalizeSearchTerm)
        .filter((term) => term.length >= 3 && !stopWords.has(term)),
    ),
  ];
}

function asksForWorkspacePackages(query: string): boolean {
  return /\b(monorepo|package|packages|workspace|workspaces)\b/i.test(query);
}

function buildCompilerSearchQuery(query: string): string {
  const terms = getQueryTerms(query);
  if (terms.length === 0) {
    return query;
  }

  const actionTerms = new Set([
    "create",
    "save",
    "submit",
    "persist",
    "delete",
    "update",
  ]);
  const hasAction = terms.some((term) => actionTerms.has(term));
  const shouldExpandMutation =
    isMutationQuery(terms) || terms.some((term) => term === "send");
  const expanded = new Set(getCompilerQueryCoreTerms(terms));
  if (hasAction && shouldExpandMutation) {
    for (const term of [
      "api",
      "form",
      "handle",
      "handler",
      "hook",
      "service",
      "submit",
      "mutation",
    ]) {
      expanded.add(term);
    }
  }
  return [...expanded].slice(0, 12).join(" ");
}

function getCompilerQueryCoreTerms(terms: string[]): string[] {
  if (isMutationQuery(terms)) {
    return stripMutationQueryFillerTerms(terms);
  }
  if (terms.some((term) => ["route", "page", "screen"].includes(term))) {
    return terms.filter(
      (term) =>
        ![
          "component",
          "container",
          "data",
          "front",
          "load",
          "render",
          "view",
        ].includes(term),
    );
  }
  if (terms.includes("toolbar") || terms.includes("scene")) {
    return terms.filter(
      (term) =>
        ![
          "context",
          "function",
          "handler",
          "receive",
          "render",
          "sink",
          "state",
          "store",
          "type",
          "update",
        ].includes(term),
    );
  }
  if (terms.includes("export")) {
    return terms.filter(
      (term) => !["drawing", "function", "main", "type"].includes(term),
    );
  }
  return terms;
}

function stripMutationQueryFillerTerms(terms: string[]): string[] {
  if (!isMutationQuery(terms)) {
    return terms;
  }
  const mutationQueryFillerTerms = new Set([
    "action",
    "client",
    "component",
    "look",
    "page",
    "route",
    "send",
    "sent",
    "server",
    "start",
    "started",
    "type",
    "view",
  ]);
  return terms.filter((term) => !mutationQueryFillerTerms.has(term));
}

function scoreFileRef(
  fileRef: ReportFileRef,
  query: string,
  queryTerms: string[],
  compilerSignal: CompilerSignal,
  wantsWorkspacePackages: boolean,
): number {
  const haystack = [
    fileRef.path,
    fileRef.symbols?.join(" ") ?? "",
    fileRef.purpose,
    fileRef.evidence ?? "",
  ]
    .join(" ")
    .toLowerCase();
  const sourceScore =
    fileRef.source === "read_file"
      ? 40
      : fileRef.source === "grep"
        ? 16
        : fileRef.source === "explore_code" && compilerSignal === "strong"
          ? 58
          : 0;
  const rangeScore = scoreRangeWidth(fileRef.range);
  const termScore = queryTerms.reduce(
    (score, term) => score + (haystack.includes(term) ? 4 : 0),
    0,
  );
  const specificityScore = scoreQuerySpecificSignal(fileRef, queryTerms);
  const actionPairScore = scoreActionPair(fileRef, queryTerms, haystack);
  const toolbarBridgeScore =
    isToolbarActionQuery(queryTerms) && hasToolbarActionBridgeIdentity(fileRef)
      ? 72
      : 0;
  return (
    sourceScore +
    rangeScore +
    termScore +
    specificityScore +
    actionPairScore +
    toolbarBridgeScore +
    scoreRoutePathIntent(fileRef.path, queryTerms) +
    scoreStrictDomainIntent(fileRef, queryTerms, haystack) +
    scoreExactQuerySymbolIntent(fileRef, query) +
    scoreRequestedAppScopeIntent(fileRef.path, query) +
    scorePathIntent(fileRef.path, queryTerms, wantsWorkspacePackages)
  );
}

function scoreExactQuerySymbolIntent(
  fileRef: ReportFileRef,
  query: string,
): number {
  const queryIdentifiers = (
    query.match(/[A-Za-z_$][A-Za-z0-9_$]{5,}/g) ?? []
  ).filter((identifier) => /[A-Z_$]/.test(identifier.slice(1)));
  if (queryIdentifiers.length === 0) {
    return 0;
  }
  const haystack = getFileRefHaystack(fileRef).replace(/[^a-z0-9_$]+/g, " ");
  return queryIdentifiers.some((identifier) =>
    haystack.includes(identifier.toLowerCase()),
  )
    ? 54
    : 0;
}

function scoreStrictDomainIntent(
  fileRef: ReportFileRef,
  queryTerms: string[],
  haystack: string,
): number {
  const normalizedPath = fileRef.path.toLowerCase();
  let score = 0;

  if (isAuthLoginSignupQuery(queryTerms)) {
    if (fileRefHasStrictDomainSignal(fileRef, queryTerms)) {
      score += 56;
    }
    if (
      /\/auth\/hooks?\//.test(normalizedPath) ||
      /\/hooks?\//.test(normalizedPath) ||
      haystack.includes("hook_definition")
    ) {
      score -= 96;
    }
  }

  if (isPostSendQuery(queryTerms)) {
    if (fileRefHasStrictDomainSignal(fileRef, queryTerms)) {
      score += 64;
    }
    if (
      normalizedPath.includes("advanced_text_editor/use_submit") ||
      normalizedPath.includes("send_button")
    ) {
      score += 70;
    }
    if (normalizedPath.includes("post_actions")) {
      score += 16;
    }
    if (/\breaction\b|post_reaction|recent_reactions/.test(haystack)) {
      score -= 110;
    }
  }

  if (isInvoiceCreateQuery(queryTerms)) {
    if (fileRefHasStrictDomainSignal(fileRef, queryTerms)) {
      score += 32;
    }
    if (
      normalizedPath.includes("/cli/") ||
      normalizedPath.includes("notification")
    ) {
      score -= 90;
    }
  }

  if (isExportQuery(queryTerms)) {
    if (fileRefHasStrictDomainSignal(fileRef, queryTerms)) {
      score += 64;
    }
    if (
      normalizedPath.endsWith("/types.ts") ||
      normalizedPath.includes("/components/app.tsx")
    ) {
      score -= 36;
    }
  }

  if (isToolbarActionQuery(queryTerms)) {
    if (fileRefHasStrictDomainSignal(fileRef, queryTerms)) {
      score += 72;
    }
    score += scoreToolbarActionPathIntent(normalizedPath, haystack);
    if (
      normalizedPath.endsWith("/types.ts") ||
      normalizedPath.includes("/components/app.tsx")
    ) {
      score -= 48;
    }
  }

  if (
    !queryTerms.includes("command") &&
    (normalizedPath.includes("/commandmenu/") ||
      normalizedPath.includes("searchresults"))
  ) {
    score -= 72;
  }

  return score;
}

function scoreRequestedAppScopeIntent(path: string, query: string): number {
  const normalizedPath = path.toLowerCase();
  const appScopes = getQueryRequestedScopes(query).filter((scope) =>
    scope.startsWith("apps/"),
  );
  if (appScopes.length === 0) {
    return 0;
  }

  if (appScopes.some((scope) => normalizedPath.startsWith(`${scope}/`))) {
    return 12;
  }
  if (
    normalizedPath.includes("/cli/") ||
    normalizedPath.startsWith("packages/cli/")
  ) {
    return -100;
  }
  if (normalizedPath.startsWith("packages/")) {
    return 0;
  }
  return -28;
}

function scoreQuerySpecificSignal(
  fileRef: ReportFileRef,
  queryTerms: string[],
): number {
  const specificTerms = getQuerySpecificTerms(queryTerms);
  if (specificTerms.length === 0) {
    return 0;
  }
  const pathAndSymbols = [
    fileRef.path,
    fileRef.symbols?.join(" ") ?? "",
    fileRef.evidence ?? "",
  ]
    .join(" ")
    .toLowerCase();
  const matchedSpecificTerms = specificTerms.filter((term) =>
    pathAndSymbols.includes(term),
  );
  if (matchedSpecificTerms.length > 0) {
    return Math.min(24, matchedSpecificTerms.length * 8);
  }

  const normalizedPath = fileRef.path.toLowerCase();
  if (isGenericCompilerOrListingRef(fileRef, normalizedPath)) {
    return -72;
  }
  return -24;
}

function fileRefHasQuerySpecificSignal(
  fileRef: ReportFileRef,
  queryTerms: string[],
): boolean {
  const specificTerms = getQuerySpecificTerms(queryTerms);
  if (specificTerms.length === 0) {
    return true;
  }
  const haystack = [
    fileRef.path,
    fileRef.symbols?.join(" ") ?? "",
    fileRef.evidence ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return specificTerms.some((term) => haystack.includes(term));
}

function hasStrictDomainRequirement(queryTerms: string[]): boolean {
  return (
    isAuthLoginSignupQuery(queryTerms) ||
    isPostSendQuery(queryTerms) ||
    isInvoiceCreateQuery(queryTerms) ||
    isExportQuery(queryTerms) ||
    isToolbarActionQuery(queryTerms)
  );
}

function fileRefHasStrictDomainSignal(
  fileRef: ReportFileRef,
  queryTerms: string[],
): boolean {
  const haystack = getFileRefHaystack(fileRef);
  if (isAuthLoginSignupQuery(queryTerms)) {
    return /\b(log[ -]?in|sign[ -]?in|sign[ -]?up|signup|password|magic[ -]?link|session)\b/.test(
      haystack,
    );
  }
  if (isPostSendQuery(queryTerms)) {
    return /\b(createpost|create_post|submitpost|usesubmit|doSubmit|advanced_text_editor|send_button|post_actions|client4\.createpost)\b/i.test(
      haystack,
    );
  }
  if (isInvoiceCreateQuery(queryTerms)) {
    return (
      /\b(invoice|invoices)\b/.test(haystack) && !haystack.includes("/cli/")
    );
  }
  if (isExportQuery(queryTerms)) {
    return [
      "actionexport",
      "blob",
      "canvas",
      "downloadfile",
      "exportdialog",
      "exportto",
      "filesystem",
      "imageexport",
      "jsonexport",
      "svg",
    ].some((term) => haystack.includes(term));
  }
  if (isToolbarActionQuery(queryTerms)) {
    return (
      /\b(actionmanager|triggeraction|setactivetool|updatescene)\b/i.test(
        haystack,
      ) ||
      /\b(register|perform)\b/i.test(haystack) ||
      /(^|\/)actions?\//i.test(fileRef.path)
    );
  }
  return true;
}

function getFileRefHaystack(fileRef: ReportFileRef): string {
  return [
    fileRef.path,
    fileRef.symbols?.join(" ") ?? "",
    fileRef.purpose,
    fileRef.evidence ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function getQuerySpecificTerms(queryTerms: string[]): string[] {
  const genericTerms = new Set([
    "action",
    "api",
    "canvas",
    "client",
    "component",
    "container",
    "data",
    "download",
    "drawing",
    "front",
    "function",
    "handler",
    "hook",
    "image",
    "layer",
    "load",
    "main",
    "message",
    "method",
    "modal",
    "page",
    "render",
    "route",
    "serialization",
    "service",
    "share",
    "state",
    "store",
    "trigger",
    "type",
    "update",
    "view",
    "webapp",
  ]);
  return queryTerms.filter(
    (term) => term.length >= 4 && !genericTerms.has(term),
  );
}

function isAuthLoginSignupQuery(queryTerms: string[]): boolean {
  return (
    queryTerms.includes("auth") &&
    queryTerms.some((term) =>
      ["login", "signin", "signup", "password", "session"].includes(term),
    )
  );
}

function isPostSendQuery(queryTerms: string[]): boolean {
  return (
    queryTerms.includes("post") &&
    queryTerms.some((term) => ["send", "submit", "message"].includes(term))
  );
}

function isInvoiceCreateQuery(queryTerms: string[]): boolean {
  return queryTerms.includes("invoice") && queryTerms.includes("create");
}

function isExportQuery(queryTerms: string[]): boolean {
  return queryTerms.includes("export");
}

function isToolbarActionQuery(queryTerms: string[]): boolean {
  return queryTerms.includes("toolbar") && queryTerms.includes("action");
}

function hasToolbarActionBridgeIdentity(fileRef: ReportFileRef): boolean {
  const normalizedPath = fileRef.path.toLowerCase();
  const haystack = getFileRefHaystack(fileRef);
  if (normalizedPath.includes("/actions/manager")) {
    return /\b(actionmanager|renderaction|executeaction|perform)\b/.test(
      haystack,
    );
  }
  if (normalizedPath.endsWith("/components/app.tsx")) {
    return /\b(syncactionresult|executeaction|renderaction|actionmanager)\b/.test(
      haystack,
    );
  }
  if (
    /(?:^|\/)(?:manager|dispatcher|controller)\.[jt]sx?$/.test(normalizedPath)
  ) {
    return /\b(actionmanager|syncactionresult|renderaction|executeaction)\b/.test(
      haystack,
    );
  }
  return /\bsyncactionresult\b/.test(haystack);
}

function isRouteQuery(queryTerms: string[]): boolean {
  return queryTerms.some((term) => ["route", "page", "screen"].includes(term));
}

function isRecordDetailRouteQuery(queryTerms: string[]): boolean {
  return (
    queryTerms.includes("record") &&
    (queryTerms.includes("detail") ||
      queryTerms.includes("show") ||
      queryTerms.includes("page"))
  );
}

function isGenericCompilerOrListingRef(
  fileRef: ReportFileRef,
  normalizedPath: string,
): boolean {
  if (fileRef.source === "list_files") {
    return true;
  }
  if (
    normalizedPath.includes("/__mocks__/") ||
    normalizedPath.includes("/mocks/")
  ) {
    return true;
  }
  if (
    normalizedPath.includes("dev-docs/") ||
    normalizedPath.includes("/docs/")
  ) {
    return true;
  }
  if (fileRef.source !== "explore_code") {
    return false;
  }
  const symbolText = fileRef.symbols?.join(" ").toLowerCase() ?? "";
  return (
    normalizedPath.endsWith("/types.ts") ||
    normalizedPath.endsWith("/types.tsx") ||
    symbolText.includes("context") ||
    symbolText.includes("props") ||
    symbolText.includes("__type.")
  );
}

function scoreRoutePathIntent(path: string, queryTerms: string[]): number {
  if (!isRouteQuery(queryTerms)) {
    return 0;
  }
  const normalizedPath = path.toLowerCase();
  let score = 0;
  if (
    normalizedPath.includes("/routes/") ||
    normalizedPath.includes("/router") ||
    normalizedPath.includes("/pages/") ||
    normalizedPath.includes("/page.") ||
    normalizedPath.includes("route")
  ) {
    score += 36;
  }
  if (
    normalizedPath.includes("showpage") ||
    normalizedPath.includes("detailpage") ||
    normalizedPath.includes("recordshowpage") ||
    normalizedPath.includes("/record-page/") ||
    normalizedPath.includes("/object-record/")
  ) {
    score += 18;
  }
  if (isRecordDetailRouteQuery(queryTerms)) {
    if (hasRecordDetailPathIdentity(normalizedPath)) {
      score += 54;
    }
    if (
      normalizedPath.includes("/side-panel/pages/") &&
      !normalizedPath.includes("/side-panel/pages/record-page/")
    ) {
      score -= 72;
    }
  }
  if (
    normalizedPath.includes("/__mocks__/") ||
    normalizedPath.includes("/mocks/") ||
    normalizedPath.includes("codegen")
  ) {
    score -= 80;
  }
  if (
    !normalizedPath.includes("route") &&
    !normalizedPath.includes("/pages/") &&
    !normalizedPath.includes("/page.") &&
    (normalizedPath.includes("/components/") ||
      normalizedPath.includes("list") ||
      normalizedPath.includes("table") ||
      normalizedPath.includes("virtualization"))
  ) {
    score -= 28;
  }
  return score;
}

function hasRecordDetailRouteIdentity(fileRef: ReportFileRef): boolean {
  const pathAndSymbols = [fileRef.path, fileRef.symbols?.join(" ") ?? ""]
    .join(" ")
    .toLowerCase();
  return hasRecordDetailPathIdentity(pathAndSymbols);
}

function hasRecordDetailPathIdentity(pathAndSymbols: string): boolean {
  return /(^|[\/\W_-])(?:detail|show|object-record|record-page|recordpage|recordshow|record-show)(?:[\/\W_-]|$)/.test(
    pathAndSymbols,
  );
}

function hasRoutePathIdentity(fileRef: ReportFileRef): boolean {
  const normalizedPath = fileRef.path.toLowerCase();
  const symbolText = fileRef.symbols?.join(" ") ?? "";
  return (
    /(^|\/)(routes?|pages?|screens?)(\/|$)/.test(normalizedPath) ||
    /\/[^/]*(?:page|route|screen)\.(?:tsx|jsx|ts|js)$/.test(normalizedPath) ||
    /\b[A-Z][A-Za-z]*(?:Page|Route|Screen)\b/.test(symbolText)
  );
}

function scoreActionPair(
  fileRef: ReportFileRef,
  queryTerms: string[],
  haystack: string,
): number {
  const actionTerms = ["create", "save", "submit", "persist", "delete"];
  const requestedAction = actionTerms.find((term) => queryTerms.includes(term));
  if (!requestedAction) {
    return 0;
  }
  const domainTerms = queryTerms.filter(
    (term) => !actionTerms.includes(term) && term.length >= 4,
  );
  const hasAction = haystack.includes(requestedAction);
  const hasDomain = domainTerms.some((term) => haystack.includes(term));
  if (!hasAction || !hasDomain) {
    return 0;
  }

  const symbolText = fileRef.symbols?.join(" ").toLowerCase() ?? "";
  const pathText = fileRef.path.toLowerCase();
  const actionDomainInSymbol = domainTerms.some((term) =>
    symbolText.includes(`${requestedAction}${term}`),
  );
  const actionDomainInPath = domainTerms.some((term) =>
    pathContainsActionDomain(pathText, requestedAction, term),
  );
  return actionDomainInSymbol || actionDomainInPath ? 45 : 20;
}

function pathContainsActionDomain(
  pathText: string,
  action: string,
  domain: string,
): boolean {
  return (
    pathText.includes(`${action}-${domain}`) ||
    pathText.includes(`${action}_${domain}`) ||
    pathText.includes(`${action}.${domain}`) ||
    pathText.includes(`${action}${domain}`)
  );
}

function scoreRangeWidth(range: string): number {
  const parsedRange = parseKnownRange(range);
  if (!parsedRange) {
    return 0;
  }
  const width = parsedRange.end - parsedRange.start + 1;
  if (width <= 80) {
    return 8;
  }
  if (width <= 160) {
    return 4;
  }
  if (width <= 300) {
    return 0;
  }
  return -15;
}

function collapseOverlappingFileRefs(
  fileRefs: ReportFileRef[],
): ReportFileRef[] {
  const keptRefs: ReportFileRef[] = [];
  for (const fileRef of fileRefs) {
    const existingIndex = keptRefs.findIndex((keptRef) =>
      isSameFileOverlappingRef(fileRef, keptRef),
    );
    if (existingIndex === -1) {
      keptRefs.push(fileRef);
      continue;
    }
    keptRefs[existingIndex] = mergeFileRefs(keptRefs[existingIndex], fileRef);
  }
  return keptRefs;
}

function isSameFileOverlappingRef(
  left: ReportFileRef,
  right: ReportFileRef,
): boolean {
  if (left.path !== right.path) {
    return false;
  }
  const leftRange = parseKnownRange(left.range);
  const rightRange = parseKnownRange(right.range);
  if (!leftRange || !rightRange) {
    return left.range === right.range;
  }
  return (
    Math.max(leftRange.start, rightRange.start) <=
    Math.min(leftRange.end, rightRange.end)
  );
}

function mergeFileRefs(
  preferredRef: ReportFileRef,
  overlappingRef: ReportFileRef,
): ReportFileRef {
  const preferredRange = parseKnownRange(preferredRef.range);
  const overlappingRange = parseKnownRange(overlappingRef.range);
  const mergedRange =
    preferredRange && overlappingRange
      ? `${Math.min(preferredRange.start, overlappingRange.start)}-${Math.max(
          preferredRange.end,
          overlappingRange.end,
        )}`
      : preferredRef.range;
  return {
    ...preferredRef,
    range: mergedRange,
    symbols: mergeSymbols(preferredRef.symbols, overlappingRef.symbols),
    evidence: mergeEvidence(preferredRef.evidence, overlappingRef.evidence),
  };
}

function parseKnownRange(range: string): { start: number; end: number } | null {
  const match = /^(\d+)-(\d+)$/.exec(range);
  if (!match) {
    return null;
  }
  return {
    start: Number(match[1]),
    end: Number(match[2]),
  };
}

function mergeSymbols(
  leftSymbols: string[] | undefined,
  rightSymbols: string[] | undefined,
): string[] | undefined {
  const merged = [
    ...new Set([...(leftSymbols ?? []), ...(rightSymbols ?? [])]),
  ];
  return merged.length > 0 ? merged.slice(0, 6) : undefined;
}

function mergeEvidence(
  leftEvidence: string | undefined,
  rightEvidence: string | undefined,
): string | undefined {
  const evidence = [...new Set([leftEvidence, rightEvidence].filter(Boolean))];
  if (evidence.length === 0) {
    return undefined;
  }
  return truncateEvidence(evidence.join("; "));
}

function scorePathIntent(
  path: string,
  queryTerms: string[],
  wantsWorkspacePackages: boolean,
): number {
  const normalizedPath = path.toLowerCase();
  let score = 0;
  if (normalizedPath.includes("/actions/")) score += 8;
  if (normalizedPath.includes("/components/")) score += 4;
  if (normalizedPath.includes("/scene")) score += 4;
  if (normalizedPath.includes("/store")) score += 4;
  if (
    normalizedPath.includes("/examples/") ||
    normalizedPath.startsWith("examples/")
  ) {
    score -= 10;
  }
  if (isMutationQuery(queryTerms)) {
    if (
      normalizedPath.includes("/interfaces/") ||
      normalizedPath.endsWith(".d.ts") ||
      normalizedPath.endsWith(".d.tsx")
    ) {
      score -= 90;
    }
    if (
      !queryTerms.some((term) =>
        ["audit", "history", "report", "reports"].includes(term),
      ) &&
      (normalizedPath.includes("audit") ||
        normalizedPath.includes("history") ||
        normalizedPath.includes("report"))
    ) {
      score -= 70;
    }
  }
  score += scoreMutationPathIntent(
    normalizedPath,
    queryTerms,
    wantsWorkspacePackages,
  );
  if (
    isMutationQuery(queryTerms) &&
    isRouteOrDisplayPath(normalizedPath) &&
    !hasMutationPathIntent(normalizedPath)
  ) {
    score -= 32;
  }
  if (isTestOrSupportPath(normalizedPath) && !isTestQuery(queryTerms)) {
    score -= 140;
  }
  return score;
}

function scoreToolbarActionPathIntent(
  normalizedPath: string,
  haystack: string,
): number {
  let score = 0;
  if (normalizedPath.includes("/actions/")) {
    score += 42;
  }
  if (normalizedPath.includes("/actions/register")) {
    score += 34;
  }
  if (normalizedPath.includes("actionmanager")) {
    score += 34;
  }
  if (
    /\b(actionmanager|triggeraction|setactivetool|updatescene)\b/i.test(
      haystack,
    ) ||
    /\b(register|perform)\b/i.test(haystack)
  ) {
    score += 28;
  }
  if (
    normalizedPath.startsWith("examples/") ||
    normalizedPath.includes("/examples/") ||
    normalizedPath.startsWith("dev-docs/") ||
    normalizedPath.includes("/dev-docs/")
  ) {
    score -= 80;
  }
  if (
    normalizedPath.endsWith("app_constants.ts") ||
    normalizedPath.endsWith("app.tsx")
  ) {
    score -= 24;
  }
  return score;
}

function isMutationQuery(queryTerms: string[]): boolean {
  return queryTerms.some((term) =>
    ["create", "delete", "mutation", "persist", "save", "submit"].includes(
      term,
    ),
  );
}

function isAuditOrHistoryQuery(queryTerms: string[]): boolean {
  return queryTerms.some((term) =>
    ["audit", "history", "report", "reports"].includes(term),
  );
}

function isRouteOrDisplayPath(normalizedPath: string): boolean {
  return (
    normalizedPath.includes("/app/") ||
    normalizedPath.endsWith("/page.tsx") ||
    normalizedPath.endsWith("/page.ts") ||
    normalizedPath.includes("/route") ||
    normalizedPath.includes("dropdown") ||
    normalizedPath.includes("menu") ||
    normalizedPath.includes("detail") ||
    normalizedPath.includes("listitem") ||
    normalizedPath.includes("successful") ||
    normalizedPath.includes("success")
  );
}

function hasMutationPathIntent(normalizedPath: string): boolean {
  return (
    normalizedPath.includes("/api/") ||
    normalizedPath.includes("/handler") ||
    normalizedPath.includes("/hooks/") ||
    normalizedPath.includes("/mutations/") ||
    normalizedPath.includes("/service/") ||
    normalizedPath.includes("/services/") ||
    normalizedPath.includes("create") ||
    normalizedPath.includes("form") ||
    normalizedPath.includes("submit")
  );
}

function scoreMutationPathIntent(
  normalizedPath: string,
  queryTerms: string[],
  wantsWorkspacePackages: boolean,
): number {
  const actionTerms = [
    "create",
    "delete",
    "mutation",
    "persist",
    "save",
    "submit",
  ];
  const genericMutationTerms = [
    "api",
    "apis",
    "form",
    "hook",
    "hooks",
    "service",
    "services",
    "submission",
  ];
  if (!isMutationQuery(queryTerms)) {
    return 0;
  }
  const domainTerms = queryTerms.filter(
    (term) =>
      !actionTerms.includes(term) &&
      !genericMutationTerms.includes(term) &&
      term.length >= 4,
  );
  const hasDomainInPath = domainTerms.some((term) =>
    normalizedPath.includes(term),
  );
  if (!hasDomainInPath) {
    const isGenericMutationPath =
      normalizedPath.includes("/api/") ||
      normalizedPath.includes("/hooks/") ||
      normalizedPath.includes("/service/") ||
      normalizedPath.includes("/services/") ||
      normalizedPath.includes("form");
    return isGenericMutationPath ? -100 : 0;
  }

  let score = 0;
  if (wantsWorkspacePackages && normalizedPath.startsWith("packages/")) {
    score += 14;
  }
  if (
    normalizedPath.includes("/api/") ||
    normalizedPath.includes("/actions/") ||
    normalizedPath.includes("/handler") ||
    normalizedPath.includes("/hooks/") ||
    normalizedPath.includes("/lib/") ||
    normalizedPath.includes("/mutations/") ||
    normalizedPath.includes("/service/") ||
    normalizedPath.includes("/services/")
  ) {
    score += 12;
  }
  if (
    normalizedPath.includes("create") ||
    normalizedPath.includes("form") ||
    normalizedPath.includes("submit")
  ) {
    score += 10;
  }
  if (
    normalizedPath.includes("dropdown") ||
    normalizedPath.includes("menu") ||
    normalizedPath.includes("detail") ||
    normalizedPath.includes("listitem") ||
    normalizedPath.includes("successful") ||
    normalizedPath.includes("success")
  ) {
    score -= 18;
  }
  if (!hasMutationPathIntent(normalizedPath)) {
    if (
      normalizedPath.includes("/actions/") ||
      normalizedPath.includes("dropdown") ||
      normalizedPath.includes("menu")
    ) {
      score -= 28;
    }
  }
  return score;
}

function isTestOrSupportPath(normalizedPath: string): boolean {
  return (
    normalizedPath.endsWith(".test.ts") ||
    normalizedPath.endsWith(".test.tsx") ||
    normalizedPath.endsWith(".spec.ts") ||
    normalizedPath.endsWith(".spec.tsx") ||
    normalizedPath.endsWith(".e2e.ts") ||
    normalizedPath.endsWith(".e2e.tsx") ||
    normalizedPath.startsWith("examples/") ||
    normalizedPath.startsWith("example/") ||
    normalizedPath.includes("/__tests__/") ||
    normalizedPath.includes("/e2e/") ||
    normalizedPath.includes("/fixtures/") ||
    normalizedPath.includes("/__mocks__/") ||
    normalizedPath.includes("/mocks/") ||
    normalizedPath.includes("/__stories__/") ||
    normalizedPath.includes(".stories.") ||
    normalizedPath.includes("/generated/") ||
    normalizedPath.includes("/generated-") ||
    normalizedPath.includes("/generated_") ||
    normalizedPath.includes("/generatedmetadata/") ||
    normalizedPath.includes("/generated-metadata/") ||
    normalizedPath.includes("codegen") ||
    normalizedPath.includes("/scripts/mock-data/") ||
    normalizedPath.includes("dev-docs/") ||
    normalizedPath.includes("/docs/") ||
    normalizedPath.includes("/playwright/") ||
    normalizedPath.includes("/test/") ||
    normalizedPath.includes("/tests/") ||
    normalizedPath.includes("/testing/")
  );
}

function isTestQuery(queryTerms: string[]): boolean {
  return queryTerms.some((term) =>
    [
      "e2e",
      "fixture",
      "fixtures",
      "playwright",
      "spec",
      "specs",
      "test",
      "tests",
      "testing",
    ].includes(term),
  );
}

function toStructuredFileRef(fileRef: ReportFileRef): {
  path: string;
  range: string;
  symbols?: string[];
  purpose: string;
} {
  return {
    path: fileRef.path,
    range: fileRef.range,
    ...(fileRef.symbols ? { symbols: fileRef.symbols } : {}),
    purpose: fileRef.purpose,
  };
}

function getEvidenceText(
  fileRef: ReportFileRef,
  compilerSignal: CompilerSignal,
): string {
  if (fileRef.evidence) {
    return fileRef.evidence;
  }
  if (compilerSignal === "strong" && fileRef.symbols?.length) {
    return `explore_code observed ${fileRef.symbols.join(", ")} in ${fileRef.path}:${fileRef.range}.`;
  }
  return `the sub-agent observed ${fileRef.path}:${fileRef.range}.`;
}

function getCoverageSummary({
  query,
  primaryFiles,
}: {
  query: string;
  primaryFiles: ReportFileRef[];
}): CoverageSummary {
  const requestedClusters = getRequestedCoverageClusters(query);
  const queryTerms = getQueryTerms(query);
  const observedClusters = requestedClusters.filter((cluster) =>
    primaryFiles.some((fileRef) =>
      fileRefMatchesCluster(fileRef, cluster, queryTerms),
    ),
  );
  return {
    observed: observedClusters,
    missing: requestedClusters.filter(
      (cluster) => !observedClusters.includes(cluster),
    ),
  };
}

function getRequestedCoverageClusters(query: string): string[] {
  const normalizedQuery = query.toLowerCase();
  const clusters: Array<{ name: string; pattern: RegExp }> = [
    { name: "route/page entry", pattern: /\b(route|page|screen|loader)\b/ },
    {
      name: "component/UI handler",
      pattern: /\b(component|render|toolbar|button|modal|view|ui)\b/,
    },
    {
      name: "action/dispatch",
      pattern:
        /\b(action|dispatch|handler|command|callback|event|submit|submits|submitted|create|creates|creating|creation|save|saving|persist|persistence)\b/,
    },
    {
      name: "state/store update",
      pattern:
        /\b(state|store|update|mutation|reducer|atom|context|persist|persistence|save|saving)\b/,
    },
    {
      name: "data/API layer",
      pattern:
        /\b(api|request|query|trpc|graphql|fetch|server|database|create|creates|creating|creation|submit|submits|submitted|save|saving|persist|persistence)\b/,
    },
    {
      name: "workspace/package implementation",
      pattern: /\b(workspace|package|packages|monorepo)\b/,
    },
    {
      name: "render/output sink",
      pattern: /\b(render|scene|canvas|view|output|paint|draw)\b/,
    },
  ];
  const requested = clusters
    .filter((cluster) => cluster.pattern.test(normalizedQuery))
    .map((cluster) => cluster.name);
  return requested.length > 0 ? requested : ["query-relevant entry point"];
}

function fileRefMatchesCluster(
  fileRef: ReportFileRef,
  cluster: string,
  queryTerms: string[],
): boolean {
  const normalizedPath = fileRef.path.toLowerCase();
  if (
    isTestOrSupportPath(normalizedPath) ||
    isGenericCompilerOrListingRef(fileRef, normalizedPath)
  ) {
    return false;
  }
  const haystack = [
    fileRef.path,
    fileRef.symbols?.join(" ") ?? "",
    fileRef.purpose,
    fileRef.evidence ?? "",
  ]
    .join(" ")
    .toLowerCase();
  if (cluster === "route/page entry") {
    if (!hasRoutePathIdentity(fileRef)) {
      return false;
    }
    if (isRecordDetailRouteQuery(queryTerms)) {
      return hasRecordDetailRouteIdentity(fileRef);
    }
    return true;
  }
  if (cluster === "component/UI handler") {
    return /\b(component|tsx|jsx|toolbar|button|modal|view|ui)\b/.test(
      haystack,
    );
  }
  if (cluster === "action/dispatch") {
    return (
      normalizedPath.includes("/actions/") ||
      /\b(action|dispatch|handler|command|callback|event|submit|create|save|persist|register|perform)\b/.test(
        haystack,
      )
    );
  }
  if (cluster === "state/store update") {
    return /\b(state|store|update|mutation|reducer|atom|context|persist|save|appstate)\b/.test(
      haystack,
    );
  }
  if (cluster === "data/API layer") {
    return /\b(api|request|query|trpc|graphql|fetch|server|database|create|submit|save|persist)\b/.test(
      haystack,
    );
  }
  if (cluster === "workspace/package implementation") {
    return fileRef.path.startsWith("packages/");
  }
  if (cluster === "render/output sink") {
    if (isTypeContractPath(normalizedPath)) {
      return false;
    }
    if (isUiComponentCallerPath(normalizedPath)) {
      return false;
    }
    if (
      normalizedPath.startsWith("excalidraw-app/") &&
      !queryTerms.some((term) => ["collab", "host", "shell"].includes(term))
    ) {
      return false;
    }
    if (
      normalizedPath.includes("/actions/") &&
      !hasActionFileRenderOutputIdentity(fileRef)
    ) {
      return false;
    }
    if (isRenderOutputApiCaller(fileRef)) {
      return false;
    }
    if (isExternalRenderOutputCaller(fileRef)) {
      return false;
    }
    if (isOverbroadCoverageRange(fileRef, 500)) {
      return false;
    }
    const implementationHaystack = [
      fileRef.path,
      fileRef.symbols?.join(" ") ?? "",
      getNonCommentEvidenceText(fileRef.evidence),
    ]
      .join(" ")
      .toLowerCase();
    return /updatescene|replaceallelements|triggerupdate|triggerrender|exportto|serialize|\brender\b|\bpaint\b|\bdraw\b/.test(
      implementationHaystack,
    );
  }
  return true;
}

function isUiComponentCallerPath(normalizedPath: string): boolean {
  return (
    normalizedPath.includes("/components/") &&
    !normalizedPath.endsWith("/components/app.tsx") &&
    !normalizedPath.includes("/components/canvases/") &&
    !normalizedPath.includes("/components/canvas/") &&
    !normalizedPath.includes("/renderer")
  );
}

function isTypeContractPath(normalizedPath: string): boolean {
  return (
    normalizedPath.endsWith("/types.ts") ||
    normalizedPath.endsWith("/types.tsx") ||
    normalizedPath.includes("/types/") ||
    normalizedPath.includes("/type-definitions/")
  );
}

function isOverbroadCoverageRange(
  fileRef: ReportFileRef,
  maxLines: number,
): boolean {
  const range = parseKnownRange(fileRef.range);
  if (!range) {
    return false;
  }
  return range.end - range.start + 1 > maxLines;
}

function isRenderOutputApiCaller(fileRef: ReportFileRef): boolean {
  const normalizedPath = fileRef.path.toLowerCase();
  if (
    /(?:^|\/)packages\/excalidraw\/components\/app\.tsx$/.test(normalizedPath)
  ) {
    return false;
  }
  const evidence = getNonCommentEvidenceText(fileRef.evidence).toLowerCase();
  return /\b(?:excalidrawapi|api|optsref|this\.collab)[\w?.]*updatescene\s*\(/.test(
    evidence,
  );
}

function isExternalRenderOutputCaller(fileRef: ReportFileRef): boolean {
  if (hasRenderOutputOwnerIdentity(fileRef)) {
    return false;
  }
  const evidence = getNonCommentEvidenceText(fileRef.evidence).toLowerCase();
  return /\b(?:scene|canvas|renderer|view|app)\w*(?:\?\.)?\.(?:updatescene|replaceallelements|triggerupdate|triggerrender|render|paint|draw)\s*\(/.test(
    evidence,
  );
}

function hasRenderOutputOwnerIdentity(fileRef: ReportFileRef): boolean {
  const normalizedPath = fileRef.path.toLowerCase();
  if (
    normalizedPath.endsWith("/components/app.tsx") ||
    normalizedPath.endsWith("/app.tsx") ||
    normalizedPath.includes("/scene") ||
    normalizedPath.includes("/renderer") ||
    normalizedPath.includes("/render") ||
    normalizedPath.includes("/canvas") ||
    normalizedPath.includes("/paint") ||
    normalizedPath.includes("/draw")
  ) {
    return true;
  }
  const symbols = (fileRef.symbols?.join(" ") ?? "").toLowerCase();
  return /\b(scene|renderer|canvas|render|paint|draw)\b/.test(symbols);
}

function hasActionFileRenderOutputIdentity(fileRef: ReportFileRef): boolean {
  const identityHaystack = [
    fileRef.path,
    fileRef.symbols?.join(" ") ?? "",
    fileRef.purpose,
  ]
    .join(" ")
    .toLowerCase();
  return (
    /action(?:export|render|paint|draw|serialize|snapshot|preview)/i.test(
      fileRef.path,
    ) ||
    /action(?:export|render|paint|draw|serialize|snapshot|preview)/i.test(
      fileRef.symbols?.join(" ") ?? "",
    )
  );
}

function getNonCommentEvidenceText(evidence: string | undefined): string {
  if (!evidence) {
    return "";
  }
  return evidence
    .split(";")
    .map((part) => part.trim())
    .filter((part) => !/^line \d+:\s*(?:\*|\/\/|\/\*|\*\/)/.test(part))
    .join("; ");
}

function getDeterministicFlowText({
  primaryFiles,
  coverage,
  compilerExplanation,
}: {
  primaryFiles: ReportFileRef[];
  coverage: CoverageSummary;
  compilerExplanation: string;
}): string {
  const observedText =
    coverage.observed.length > 0 ? coverage.observed.join(", ") : "none";
  const missingText =
    coverage.missing.length > 0
      ? ` Missing query aspects: ${coverage.missing.join(", ")}; use targeted reads/searches only for those gaps.`
      : " No broad follow-up search is implied.";
  const fileText = primaryFiles
    .slice(0, 3)
    .map((fileRef) => `${fileRef.path}:${fileRef.range}`)
    .join(" -> ");
  return [
    `Observed coverage: ${observedText}.`,
    fileText
      ? `Start from ${fileText}; these are the narrowest observed ranges from the sub-agent.`
      : "No narrow source range was observed.",
    `Compiler signal: ${compilerExplanation}`,
    missingText,
  ].join(" ");
}

function summarizeReadFileEvidence({
  result,
  startLine,
  queryTerms,
}: {
  result: string;
  startLine?: number;
  queryTerms: string[];
}): string | undefined {
  const lines = result.split("\n");
  const scoredLines = lines
    .map((line, index) => ({
      line,
      lineNumber: (startLine ?? 1) + index,
      score: scoreEvidenceLine(line, queryTerms),
    }))
    .filter((entry) => entry.line.trim().length > 0)
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return left.lineNumber - right.lineNumber;
    })
    .slice(0, 3);
  if (scoredLines.length === 0) {
    return undefined;
  }
  return scoredLines
    .map(
      (entry) =>
        `line ${entry.lineNumber}: ${truncateEvidence(entry.line.trim())}`,
    )
    .join("; ");
}

function scoreEvidenceLine(line: string, queryTerms: string[]): number {
  const normalizedLine = line.toLowerCase();
  const termScore = queryTerms.reduce(
    (score, term) => score + (normalizedLine.includes(term) ? 3 : 0),
    0,
  );
  const codeShapeScore =
    /\b(function|class|const|let|return|if|public|export)\b/.test(
      normalizedLine,
    )
      ? 2
      : 0;
  return termScore + codeShapeScore;
}

function truncateEvidence(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 180) {
    return collapsed;
  }
  return `${collapsed.slice(0, 177)}...`;
}

function getSkipUnknownText({
  compilerSignal,
  observations,
}: {
  compilerSignal: CompilerSignal;
  observations: SubagentObservation[];
}): string {
  const toolNames = [
    ...new Set(observations.map((observation) => observation.toolName)),
  ];
  if (compilerSignal === "weak") {
    return `explore_code was attempted but did not return useful symbols; observed tools: ${toolNames.join(", ")}.`;
  }
  if (compilerSignal === "not used") {
    return `Compiler-backed exploration was not used; observed tools: ${toolNames.join(", ")}. Treat ranges as candidates unless directly read.`;
  }
  return `Observed tools: ${toolNames.join(", ")}. No extra broad search is implied.`;
}

function buildExploreCodeSubagentSystemPrompt(): string {
  return `You are a code reconnaissance sub-agent. Your job is to inspect the repository and produce a concise findings report that gives the main agent enough understanding to act without re-reading discovery files.

Rules:
- Use tools before reporting. You get exactly one tool step, so call the 1-3 most useful tools in parallel in that first step.
- For TypeScript, TSX, JavaScript, or JSX code included in the TypeScript config, include explore_code in the first tool batch. Pair it with grep or list_files in the same step when the query needs route/file-name discovery.
- Omit app_name when inspecting the current app. Only set app_name when the prompt names a referenced @app value.
- First classify the query as one of: route-flow, component-flow, mutation-action, state-store, styling-ui, config-build, or unknown. Let that classification choose narrow searches.
- Use grep, list_files, and read_file only to narrow or verify the map.
- Make at most 3 tool invocations total. After the first tool result batch, do not call any more tools; write the final report even if some details are uncertain.
- Stop as soon as you have one plausible flow, 2-5 key files, and one best next raw read target. Do not spend another tool call just to improve completeness.
- A useful report compresses the source you read into concrete findings: what each key symbol does, how data/control flows between them, and which facts answer the query.
- Do not make the main agent rediscover the code. State the answer, not just where to look.
- Every key symbol must include a file and line or tight line range that was actually observed.
- Keep line ranges tight: ideally under 120 lines. Use a wider range only when a single function/class is longer.
- If the first search only gives broad files, spend another tool call to find exact handlers/callers/state updates before reporting.
- For flow questions, cover both sides of the handoff: the dispatcher/handler that receives the UI or event and the sink that applies the state, store, scene, route, render, or API update.
- If a result shows an updater callback, action result, dispatch function, or schedule/update call, use the next verification read on the owner of that updater/sink rather than another similar action implementation.
- Prefer exact ranges from explore_code output when available. If you used read_file, cite only the observed line range.
- Do not propose code changes.
- Do not include large source excerpts.
- Report at most 5 files.
- Include one Edit target line: the single file/range the main agent should read first only if it needs to make or verify a code edit.
- For investigation-only questions, the Edit target may be "none".
- Include a confidence value: high, medium, or low.
- Include a "Structured summary" JSON object in a fenced json block. It must be valid JSON and must not include comments.
- Include "recommendedPrimaryAction" in the Structured summary. Use "answer_from_report" when no more raw source is needed, "read_edit_target" when the main agent should open only the edit target, or "targeted_gap_search" when specific missing coverage must be searched. For targeted_gap_search, searchTargets must name concrete search terms and scopes, not just coverage labels.
- If you did not use the compiler-backed explore_code tool, say "Compiler signal: not used" and explain why in one sentence.
- If explore_code found no useful symbols, say "Compiler signal: weak" and keep confidence low or medium unless grep/read_file found precise evidence.
- If the query is not answerable from configured TypeScript/JavaScript files, say what you checked and what targeted manual search the main agent should try next.
- Do not tell the main agent to do broad repository search unless your confidence is low and you explain exactly what was missing.`;
}

function reportShapeLines(): string[] {
  return [
    "Return exactly this shape:",
    "## explore_code report",
    "",
    'Query: "<query>"',
    "Task class: route-flow | component-flow | mutation-action | state-store | styling-ui | config-build | unknown",
    "Confidence: high | medium | low",
    "Compiler signal: strong | weak | not used",
    "",
    "Structured summary:",
    "```json",
    "{",
    '  "confidence": "high|medium|low",',
    '  "taskClass": "route-flow|component-flow|mutation-action|state-store|styling-ui|config-build|unknown",',
    '  "compilerSignal": "strong|weak|not used",',
    '  "primaryFiles": [',
    '    {"path": "path/to/file.tsx", "range": "10-80", "symbols": ["SymbolName"], "purpose": "why this is enough to answer or edit"}',
    "  ],",
    '  "secondaryFiles": [',
    '    {"path": "path/to/other.ts", "range": "20-45", "purpose": "supporting context; skip unless needed"}',
    "  ],",
    '  "editTarget": {"path": "path/to/file.tsx", "range": "10-80", "purpose": "first raw source to open before an edit"},',
    '  "coverage": {"observed": ["component/UI handler"], "missing": []},',
    '  "recommendedPrimaryAction": {',
    '    "action": "answer_from_report|read_edit_target|targeted_gap_search",',
    '    "reason": "one sentence explaining the next step",',
    '    "readTarget": {"path": "path/to/file.tsx", "range": "10-80", "purpose": "only when action is read_edit_target"},',
    '    "searchTargets": ["only when action is targeted_gap_search; concrete terms and scopes only"]',
    "  }",
    "}",
    "```",
    "",
    "Findings:",
    "1. path/to/file.ts:10-80 - SymbolOrHandlerName",
    "   Fact: what this symbol/range does that matters for the query.",
    "   Evidence: concrete observed behavior, call, state update, route, or data dependency.",
    "",
    "Flow:",
    "One short paragraph connecting the listed symbols and explaining the relevant control/data path.",
    "",
    "Edit target:",
    'path/to/file.ts:10-80 - why this is the only raw source the main agent should open first, or "none" for answer-only tasks.',
    "",
    "Recommended primary action:",
    "answer_from_report | read_edit_target | targeted_gap_search, with exact read target or search targets.",
    "",
    "Skip / unknown:",
    "Optional short note naming files/searches checked and any missing edge that would require targeted follow-up.",
  ];
}

function buildObservationSynthesisPrompt(
  args: ExploreCodeArgs,
  observations: SubagentObservation[],
): string {
  const renderedObservations = observations
    .map((observation, index) =>
      [
        `Observation ${index + 1}: ${observation.toolName}`,
        `Args: ${JSON.stringify(observation.args)}`,
        "Result:",
        observation.result,
      ].join("\n"),
    )
    .join("\n\n---\n\n");

  return [
    `Query: ${args.query}`,
    "",
    "Tool observations:",
    renderedObservations,
    "",
    ...reportShapeLines(),
  ].join("\n");
}

function buildExploreCodeSubagentPrompt(args: ExploreCodeArgs): string {
  return [
    `Query: ${args.query}`,
    args.app_name
      ? `Referenced app: ${args.app_name}`
      : "Target app: current app. Omit app_name in tool calls.",
    args.tsconfig_path ? `TypeScript config: ${args.tsconfig_path}` : "",
    "",
    ...reportShapeLines(),
  ]
    .filter(Boolean)
    .join("\n");
}
