import { streamText, stepCountIs, type ToolSet } from "ai";
import crypto from "node:crypto";
import log from "electron-log";
import { z } from "zod";

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
  MAX_DEPTH,
  MAX_FILES,
  formatRawExploreCodeResult,
  normalizeExploreCodeArgsForApp,
  rawExploreCodeSchema,
  runRawExploreCode,
  type ExploreCodeArgs,
  type RawExploreCodeArgs,
} from "./explore_code_raw";
import type { CodeExplorerResult } from "../../../../../../../shared/code_explorer_types";

const logger = log.scope("explore_code_subagent");

const SUBAGENT_MODEL = { provider: "auto", name: "value" } as const;
const SUBAGENT_PHASE = "explore_code_subagent";
const SUBAGENT_MAX_STEPS = 12;
const SUBAGENT_NUDGE_MAX_STEPS = 2;
const SUBAGENT_MAX_OUTPUT_TOKENS = 4_000;
const SUBAGENT_MAX_RETRIES = 1;
const SUBAGENT_MAX_VALIDATION_CONTINUATIONS = 2;
const MAX_OBSERVATION_CHARS = 12_000;
const MAX_TOTAL_OBSERVATION_CHARS = 60_000;
const MAX_NUDGE_OBSERVED_EVIDENCE_CHARS = 12_000;
const MAX_REPORT_CHARS = 2_500;
const MAX_PRIMARY_FILES = 5;
const MAX_READ_TARGETS = 8;
const MAX_RANGE_LINES = 120;
const MAX_RENDERED_FLOW_LINKS = 4;
const MAX_REPORT_QUERY_CHARS = 110;
const MAX_REPORT_ROLE_CHARS = 36;
const MAX_REPORT_FACT_CHARS = 90;
const MAX_REPORT_PURPOSE_CHARS = 64;
const MAX_REPORT_SEARCH_TARGET_CHARS = 140;
const MAX_REPORT_MISSING_CHARS = 220;
const MAX_MACHINE_PATHS = 8;
const MAX_PACKET_CANDIDATES = 30;
const MAX_INTERNAL_CANDIDATES = 80;
const GREP_CLUSTER_GAP_LINES = 30;
const GREP_CONTEXT_LINES = 20;
const ROOT_RECURSIVE_LIST_FILES_MESSAGE =
  "Root recursive listing is intentionally compacted for the explorer sub-agent. Use targeted grep/explore_code first, or list a specific directory.";

type CandidateSource = "compiler" | "grep" | "read_file" | "list_files";
type CandidateId = `c${number}`;
type ExploreIntent = "explain" | "locate" | "edit" | "debug";

interface ExplorerCandidate {
  id?: CandidateId;
  path: string;
  range: { start: number; end: number } | null;
  symbols: Array<{ name: string; kind: string; line: number }>;
  score: number;
  source: CandidateSource;
  provenance: string[];
  traits: {
    isTest: boolean;
    isSupport: boolean;
    isGenerated: boolean;
    isDocsExample: boolean;
    pathKinds: string[];
  };
  estimatedTokens: number;
  evidence?: string;
  observedText?: string;
}

interface SubagentObservation {
  toolName: string;
  args: unknown;
  result: string;
  candidates: ExplorerCandidate[];
}

const candidateIdSchema = z
  .string()
  .regex(/^c\d+$/)
  .transform((value) => value as CandidateId);

const submitReportSchema = z.object({
  primaryCandidateIds: z.array(candidateIdSchema).max(MAX_PRIMARY_FILES),
  readTargets: z
    .array(
      z.object({
        candidateId: candidateIdSchema,
        purpose: z.string().max(180),
        required: z.boolean(),
      }),
    )
    .max(MAX_READ_TARGETS),
  flow: z
    .array(
      z.object({
        candidateId: candidateIdSchema,
        role: z.string().max(60),
        fact: z.string().max(220),
        quote: z
          .string()
          .max(300)
          .describe(
            "Copy one exact quote option shown for this candidate when possible. Use one complete verbatim source line, or two lines maximum. Do not include code fences, commentary, ellipses, or blocks.",
          ),
      }),
    )
    .max(MAX_PACKET_CANDIDATES),
  missingCoverage: z.array(z.string().max(180)).max(3),
  recommendedPrimaryAction: z.enum([
    "answer_from_report",
    "read_targets",
    "targeted_gap_search",
    "skip_explore_result",
  ]),
  searchTargets: z
    .array(
      z
        .string()
        .max(180)
        .describe(
          'Executable grep instruction, for example: query="ExactObservedIdentifier" include="src/**/*.{ts,tsx}" literal=true. Use exact observed identifiers or paths, not prose phrases.',
        ),
    )
    .max(5)
    .optional(),
  confidence: z.enum(["high", "medium", "low"]),
  intent: z.enum(["explain", "locate", "edit", "debug"]).optional(),
});

type ExploreSelectionV2 = z.infer<typeof submitReportSchema>;

interface CandidateRegistry {
  register(candidates: ExplorerCandidate[]): ExplorerCandidate[];
}

interface ReadOnlyToolBudget {
  reserve(toolName: string): string | null;
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
  const intent: ExploreIntent = args.intent ?? "locate";
  const observations: SubagentObservation[] = [];
  let submittedSelection: ExploreSelectionV2 | null = null;
  const acceptedSelectionRef: { current: ValidatedExploreSelectionV2 | null } =
    {
      current: null,
    };
  const candidateRegistry = createCandidateRegistry();
  const readOnlyToolBudget = createReadOnlyToolBudget();
  let validationContinuationRounds = 0;
  let needsRevisedReport = false;
  let reviseAfterObservationCount: number | null = null;
  const tools = buildExploreCodeSubagentTools({
    args,
    ctx,
    subagentRunId,
    observations,
    candidateRegistry,
    readOnlyToolBudget,
    onSubmitReport: (selection): string => {
      submittedSelection = selection;
      const candidates = getObservedCandidates(observations);
      const validatedSelection = validateExploreSelectionV2({
        selection,
        candidates,
        observations,
        intent,
      });
      if (!validatedSelection) {
        return "Report could not be validated because no selected observed candidates survived. Select observed candidate IDs from tool results and call submit_report again.";
      }
      acceptedSelectionRef.current = validatedSelection;
      const gap = getCriticalValidationGap({
        validated: validatedSelection,
        intent,
        candidates,
      });
      if (
        gap &&
        validationContinuationRounds < SUBAGENT_MAX_VALIDATION_CONTINUATIONS
      ) {
        validationContinuationRounds += 1;
        const remainingContinuationRounds =
          SUBAGENT_MAX_VALIDATION_CONTINUATIONS - validationContinuationRounds;
        needsRevisedReport = true;
        reviseAfterObservationCount =
          gapRequiresNewEvidence(gap) && remainingContinuationRounds > 0
            ? observations.length
            : null;
        const revisionMessage = [
          `Your report needs revision: ${gap}`,
          `You have ${remainingContinuationRounds} continuation round(s) remaining.`,
          reviseAfterObservationCount !== null
            ? "Find observed evidence for that gap with the read-only tools, then call submit_report again."
            : gapRequiresNewEvidence(gap)
              ? "Call submit_report again now. If the gap is still unresolved, choose targeted_gap_search and include bounded searchTargets for the exact missing symbol or scope; otherwise remove that missingCoverage entry."
              : "Call submit_report again now. For each flow quote, copy one of the listed exact quote option strings verbatim, or remove that flow link if none fits.",
        ].join("\n");
        return revisionMessage;
      }
      needsRevisedReport = false;
      reviseAfterObservationCount = null;
      return "Report accepted.";
    },
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
      prepareStep: () => {
        if (observations.length === 0) {
          return forceExploreCodeStep();
        }
        if (
          shouldForceSubmitReportStep({
            observations,
            submittedSelection,
            needsRevisedReport,
            reviseAfterObservationCount,
          })
        ) {
          return forceSubmitReportStep();
        }
      },
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

    let explorationFinalText = "";
    for await (const part of fullStream) {
      if (part.type === "text-delta") {
        explorationFinalText += part.text;
      }
    }

    let candidates = getRankedCandidates(observations, args.query);
    if (!submittedSelection) {
      await runSubmitReportNudge({
        args,
        ctx,
        subagentRunId,
        modelInfo,
        maxOutputTokens,
        temperature,
        observations,
        tools,
      });
      candidates = getRankedCandidates(observations, args.query);
    }
    const acceptedSelection = acceptedSelectionRef.current;
    const reportText = acceptedSelection
      ? buildV2Report({
          query: args.query,
          intent,
          validated: acceptedSelection,
        })
      : chooseReport({
          args,
          candidates,
          observations,
          ctx,
          subagentRunId,
          explorationFinalTextChars: explorationFinalText.length,
          selection: null,
          followupExhausted: false,
        });

    recordCodeExplorerBenchmarkEvent({
      type: "subagent_finish",
      phase: SUBAGENT_PHASE,
      chatId: ctx.chatId,
      appId: ctx.appId,
      parentToolName: "explore_code",
      subagentRunId,
      elapsedMs: Date.now() - startedAt,
      reportChars: reportText.length,
      rawObservationChars: totalObservationChars(observations),
      renderedAction: getRenderedAction(reportText),
      renderedConfidence: getRenderedConfidence(reportText),
      factUnverifiedCount:
        acceptedSelection?.droppedReasons.filter((reason) =>
          reason.startsWith("fact_unverified:"),
        ).length ?? 0,
      validationDroppedReasons: acceptedSelection?.droppedReasons ?? [],
    });

    return reportText;
  } catch (error) {
    logger.warn("explore_code sub-agent failed", error);
    const elapsedMs = Date.now() - startedAt;
    recordCodeExplorerBenchmarkEvent({
      type: "subagent_error",
      phase: SUBAGENT_PHASE,
      chatId: ctx.chatId,
      appId: ctx.appId,
      parentToolName: "explore_code",
      subagentRunId,
      elapsedMs,
      error: error instanceof Error ? error.message : String(error),
    });
    if (acceptedSelectionRef.current) {
      const reportText = buildV2Report({
        query: args.query,
        intent,
        validated: acceptedSelectionRef.current,
      });
      recordCodeExplorerBenchmarkEvent({
        type: "subagent_partial_recovery",
        phase: SUBAGENT_PHASE,
        chatId: ctx.chatId,
        appId: ctx.appId,
        parentToolName: "explore_code",
        subagentRunId,
        elapsedMs,
        reportChars: reportText.length,
        rawObservationChars: totalObservationChars(observations),
        renderedAction: getRenderedAction(reportText),
        renderedConfidence: getRenderedConfidence(reportText),
      });
      return reportText;
    }
    if (observations.length > 0) {
      const candidates = getRankedCandidates(observations, args.query);
      const reportText = chooseReport({
        args,
        candidates,
        observations,
        ctx,
        subagentRunId,
        explorationFinalTextChars: 0,
        selection: null,
        followupExhausted: false,
      });
      recordCodeExplorerBenchmarkEvent({
        type: "subagent_partial_recovery",
        phase: SUBAGENT_PHASE,
        chatId: ctx.chatId,
        appId: ctx.appId,
        parentToolName: "explore_code",
        subagentRunId,
        elapsedMs,
        reportChars: reportText.length,
        rawObservationChars: totalObservationChars(observations),
      });
      return reportText;
    }
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

function createReadOnlyToolBudget(): ReadOnlyToolBudget {
  let usedCalls = 0;
  return {
    reserve(toolName: string): string | null {
      if (usedCalls >= SUBAGENT_MAX_STEPS) {
        return `Sub-agent read-only tool budget exhausted after ${SUBAGENT_MAX_STEPS} calls. Do not call ${toolName} again; call submit_report with observed candidate IDs or skip_explore_result.`;
      }
      usedCalls += 1;
      return null;
    },
  };
}

function buildExploreCodeSubagentTools({
  args,
  ctx,
  subagentRunId,
  observations,
  candidateRegistry,
  readOnlyToolBudget,
  onSubmitReport,
}: {
  args: ExploreCodeArgs;
  ctx: AgentContext;
  subagentRunId: string;
  observations: SubagentObservation[];
  candidateRegistry: CandidateRegistry;
  readOnlyToolBudget: ReadOnlyToolBudget;
  onSubmitReport: (selection: ExploreSelectionV2) => string;
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

  return {
    list_files: wrapSubagentTool({
      tool: listFilesTool,
      ctx: childCtx,
      subagentRunId,
      observations,
      candidateRegistry,
      readOnlyToolBudget,
      compactBroadCall: compactBroadListFilesCall,
      candidatesFromResult: (args, result) =>
        candidatesFromListFilesResult(String(result), args),
    }),
    grep: wrapSubagentTool({
      tool: grepTool,
      ctx: childCtx,
      subagentRunId,
      observations,
      candidateRegistry,
      readOnlyToolBudget,
      candidatesFromResult: (args, result) =>
        candidatesFromGrepResult(String(result), args),
    }),
    read_file: wrapSubagentTool({
      tool: readFileTool,
      ctx: childCtx,
      subagentRunId,
      observations,
      candidateRegistry,
      readOnlyToolBudget,
      candidatesFromResult: (args, result) =>
        candidatesFromReadFileResult(String(result), args),
    }),
    explore_code: buildObservedExploreCodeTool({
      parentArgs: args,
      ctx: childCtx,
      subagentRunId,
      observations,
      candidateRegistry,
      readOnlyToolBudget,
    }),
    submit_report: {
      description:
        "Submit the final code exploration report. Select observed candidate IDs only; include open role labels, facts tied to the caller intent, and one exact quote option copied from each selected candidate's observed evidence.",
      inputSchema: submitReportSchema,
      execute: async (selection: ExploreSelectionV2) => {
        const result = onSubmitReport(selection);
        recordCodeExplorerBenchmarkEvent({
          type: "submit_report_result",
          phase: SUBAGENT_PHASE,
          chatId: ctx.chatId,
          appId: ctx.appId,
          parentToolName: "explore_code",
          subagentRunId,
          resultPreview: summarizeBenchmarkValue(result),
          continuationRequested: result.includes("needs revision"),
          submittedIntent: args.intent ?? "locate",
        });
        return result;
      },
    },
  };
}

function buildObservedExploreCodeTool({
  parentArgs,
  ctx,
  subagentRunId,
  observations,
  candidateRegistry,
  readOnlyToolBudget,
}: {
  parentArgs: ExploreCodeArgs;
  ctx: AgentContext;
  subagentRunId: string;
  observations: SubagentObservation[];
  candidateRegistry: CandidateRegistry;
  readOnlyToolBudget: ReadOnlyToolBudget;
}) {
  return {
    description:
      "Compiler-backed code explorer. Use this for TypeScript, TSX, JavaScript, or JSX symbols and flows included in the configured TypeScript project. It returns relevant symbols and line-numbered source windows grouped by file.",
    inputSchema: rawExploreCodeSchema,
    execute: async (toolArgs: RawExploreCodeArgs) => {
      const startedAt = Date.now();
      const budgetMessage = readOnlyToolBudget.reserve("explore_code");
      if (budgetMessage) {
        observations.push({
          toolName: "explore_code",
          args: toolArgs,
          result: budgetMessage,
          candidates: [],
        });
        return budgetMessage;
      }
      recordCodeExplorerBenchmarkEvent({
        type: "tool_call_start",
        phase: SUBAGENT_PHASE,
        chatId: ctx.chatId,
        appId: ctx.appId,
        parentToolName: "explore_code",
        subagentRunId,
        toolName: "explore_code",
        argsPreview: summarizeBenchmarkValue(toolArgs),
      });
      try {
        const lockedArgs: RawExploreCodeArgs = {
          ...toolArgs,
          app_name: parentArgs.app_name,
          tsconfig_path: parentArgs.tsconfig_path,
          max_files:
            toolArgs.max_files ??
            (parentArgs.intent === "explain" ? MAX_FILES : undefined),
          max_depth:
            toolArgs.max_depth ??
            (parentArgs.intent === "explain" ? MAX_DEPTH : undefined),
        };
        const targetAppPath = resolveTargetAppPath(ctx, lockedArgs.app_name);
        const effectiveToolArgs = normalizeExploreCodeArgsForApp({
          appPath: targetAppPath,
          args: lockedArgs,
        });
        const rawResult = await runRawExploreCode({
          appPath: targetAppPath,
          args: effectiveToolArgs,
        });
        const resultText = formatRawExploreCodeResult(rawResult);
        const candidates = candidateRegistry.register(
          candidatesFromRawExploreCodeResult(rawResult),
        );
        const annotatedResult = formatObservationResult(
          annotateObservationResult(resultText, candidates),
          observations,
        );
        observations.push({
          toolName: "explore_code",
          args: effectiveToolArgs,
          result: annotatedResult,
          candidates,
        });
        recordCodeExplorerBenchmarkEvent({
          type: "tool_call_end",
          phase: SUBAGENT_PHASE,
          chatId: ctx.chatId,
          appId: ctx.appId,
          parentToolName: "explore_code",
          subagentRunId,
          toolName: "explore_code",
          elapsedMs: Date.now() - startedAt,
          resultPreview: summarizeBenchmarkValue(resultText),
        });
        return annotatedResult;
      } catch (error) {
        if (ctx.abortSignal?.aborted) {
          throw error;
        }
        const errorMessage = formatToolError("explore_code", error);
        observations.push({
          toolName: "explore_code",
          args: toolArgs,
          result: errorMessage,
          candidates: [],
        });
        recordCodeExplorerBenchmarkEvent({
          type: "tool_call_error",
          phase: SUBAGENT_PHASE,
          chatId: ctx.chatId,
          appId: ctx.appId,
          parentToolName: "explore_code",
          subagentRunId,
          toolName: "explore_code",
          argsPreview: summarizeBenchmarkValue(toolArgs),
          error: error instanceof Error ? error.message : String(error),
        });
        return errorMessage;
      }
    },
  };
}

function wrapSubagentTool<TArgs>({
  tool,
  ctx,
  subagentRunId,
  observations,
  candidateRegistry,
  readOnlyToolBudget,
  candidatesFromResult,
  compactBroadCall,
}: {
  tool: ToolDefinition<TArgs>;
  ctx: AgentContext;
  subagentRunId: string;
  observations: SubagentObservation[];
  candidateRegistry: CandidateRegistry;
  readOnlyToolBudget: ReadOnlyToolBudget;
  candidatesFromResult: (args: TArgs, result: unknown) => ExplorerCandidate[];
  compactBroadCall?: (args: TArgs) => string | null;
}) {
  return {
    description: tool.description,
    inputSchema: tool.inputSchema,
    execute: async (toolArgs: TArgs) => {
      const startedAt = Date.now();
      const budgetMessage = readOnlyToolBudget.reserve(tool.name);
      if (budgetMessage) {
        observations.push({
          toolName: tool.name,
          args: toolArgs,
          result: budgetMessage,
          candidates: [],
        });
        return budgetMessage;
      }
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
        const compactResult = compactBroadCall?.(toolArgs);
        if (compactResult) {
          observations.push({
            toolName: tool.name,
            args: toolArgs,
            result: compactResult,
            candidates: [],
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
            resultPreview: summarizeBenchmarkValue(compactResult),
          });
          return compactResult;
        }

        const result = await tool.execute(toolArgs, ctx);
        const resultText = formatObservationResult(result, observations);
        const registeredCandidates = candidateRegistry.register(
          candidatesFromResult(toolArgs, result),
        );
        const annotatedResult = formatObservationResult(
          annotateObservationResult(resultText, registeredCandidates),
          observations,
        );
        observations.push({
          toolName: tool.name,
          args: toolArgs,
          result: annotatedResult,
          candidates: registeredCandidates,
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
        return typeof result === "string" ? annotatedResult : result;
      } catch (error) {
        if (ctx.abortSignal?.aborted) {
          throw error;
        }
        const errorMessage = formatToolError(tool.name, error);
        observations.push({
          toolName: tool.name,
          args: toolArgs,
          result: errorMessage,
          candidates: [],
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

function compactBroadListFilesCall(args: unknown): string | null {
  if (!args || typeof args !== "object") {
    return null;
  }
  const listArgs = args as { recursive?: unknown; directory?: unknown };
  if (listArgs.recursive === true && !listArgs.directory) {
    return ROOT_RECURSIVE_LIST_FILES_MESSAGE;
  }
  return null;
}

function formatToolError(toolName: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Tool ${toolName} failed: ${message}`;
}

function formatObservationResult(
  result: unknown,
  observations: SubagentObservation[],
): string {
  const text =
    typeof result === "string" ? result : JSON.stringify(result, null, 2);
  const usedBudget = totalObservationChars(observations);
  const remainingBudget = Math.max(0, MAX_TOTAL_OBSERVATION_CHARS - usedBudget);
  const maxChars = Math.min(
    MAX_OBSERVATION_CHARS,
    remainingBudget > 0 ? remainingBudget : 0,
  );
  if (maxChars <= 0) {
    return "";
  }
  if (text.length <= maxChars) {
    return text;
  }
  const suffix = "\n[TRUNCATED]";
  if (maxChars <= suffix.length) {
    return text.slice(0, maxChars);
  }
  return `${text.slice(0, maxChars - suffix.length)}${suffix}`;
}

function createCandidateRegistry(): CandidateRegistry {
  let nextId = 1;
  const idByKey = new Map<string, CandidateId>();
  return {
    register(candidates) {
      return candidates.map((candidate) => {
        const key = candidateKey(candidate);
        let id = idByKey.get(key);
        if (!id) {
          id = `c${nextId++}` as CandidateId;
          idByKey.set(key, id);
        }
        return { ...candidate, id };
      });
    },
  };
}

function annotateObservationResult(
  result: string,
  candidates: ExplorerCandidate[],
): string {
  if (candidates.length === 0) {
    return result;
  }
  const ids = candidates
    .map((candidate) => {
      const quoteHints = getObservedQuoteHints(candidate.observedText);
      const quoteText =
        quoteHints.length > 0
          ? ` | exact quote options to copy: ${quoteHints
              .map((hint) => `"${hint}"`)
              .join(" / ")}`
          : "";
      return `${requireCandidateId(candidate)} ${formatCandidateRef(candidate)}${quoteText}`;
    })
    .slice(0, 40);
  return `${result}\n\nObserved candidate IDs:\n${ids
    .map((entry) => `- [${entry}]`)
    .join("\n")}`;
}

function shouldForceSubmitReportStep({
  observations,
  submittedSelection,
  needsRevisedReport,
  reviseAfterObservationCount,
}: {
  observations: SubagentObservation[];
  submittedSelection: ExploreSelectionV2 | null;
  needsRevisedReport: boolean;
  reviseAfterObservationCount: number | null;
}): boolean {
  if (submittedSelection === null) {
    return false;
  }
  if (!needsRevisedReport) {
    return false;
  }
  return (
    reviseAfterObservationCount === null ||
    observations.length > reviseAfterObservationCount
  );
}

function forceSubmitReportStep() {
  return {
    activeTools: ["submit_report"],
    toolChoice: { type: "tool" as const, toolName: "submit_report" },
  };
}

function forceExploreCodeStep() {
  return {
    activeTools: ["explore_code"],
    toolChoice: { type: "tool" as const, toolName: "explore_code" },
  };
}

async function runSubmitReportNudge({
  args,
  ctx,
  subagentRunId,
  modelInfo,
  maxOutputTokens,
  temperature,
  observations,
  tools,
}: {
  args: ExploreCodeArgs;
  ctx: AgentContext;
  subagentRunId: string;
  modelInfo: Awaited<ReturnType<typeof getModelClient>>;
  maxOutputTokens: number;
  temperature: number | undefined;
  observations: SubagentObservation[];
  tools: ToolSet;
}): Promise<void> {
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
      settings: readSettings(),
    }),
    maxOutputTokens,
    temperature,
    maxRetries: SUBAGENT_MAX_RETRIES,
    system: buildExploreCodeSubagentSystemPrompt(),
    prompt: [
      buildExploreCodeSubagentPrompt(args),
      "",
      buildNudgeObservedEvidence(observations),
      "",
      "You stopped without submit_report. Use the observed candidate IDs already returned by tools, then call submit_report now.",
    ].join("\n"),
    tools,
    ...forceSubmitReportStep(),
    stopWhen: stepCountIs(SUBAGENT_NUDGE_MAX_STEPS),
    abortSignal: ctx.abortSignal,
    onFinish: (event) => {
      recordCodeExplorerBenchmarkEvent({
        type: "submit_report_nudge_finish",
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
  for await (const _part of fullStream) {
    // Drain the stream so tool calls execute.
  }
}

function buildNudgeObservedEvidence(
  observations: SubagentObservation[],
): string {
  const candidates = getNudgeObservedCandidates(observations).slice(0, 60);
  if (candidates.length === 0) {
    return "Observed evidence from prior tool results: none";
  }
  const observedSections = candidates.map((candidate) => {
    const quoteHints = getObservedQuoteHints(candidate.observedText);
    return [
      `- [${requireCandidateId(candidate)} ${formatCandidateRef(candidate)}]`,
      candidate.evidence ? `  evidence: ${candidate.evidence}` : null,
      quoteHints.length > 0
        ? `  exact quote options to copy: ${quoteHints
            .map((hint) => `"${hint}"`)
            .join(" / ")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");
  });
  return truncateToMaxChars(
    [
      "Observed candidate IDs from prior tool results:",
      ...observedSections,
    ].join("\n\n"),
    MAX_NUDGE_OBSERVED_EVIDENCE_CHARS,
  );
}

function getNudgeObservedCandidates(
  observations: SubagentObservation[],
): ExplorerCandidate[] {
  const seen = new Set<CandidateId>();
  const entries = observations.flatMap((observation, observationIndex) =>
    observation.candidates.map((candidate, candidateIndex) => ({
      candidate,
      observationIndex,
      candidateIndex,
    })),
  );
  return entries
    .sort((left, right) => {
      const recencyDelta = right.observationIndex - left.observationIndex;
      if (recencyDelta !== 0) {
        return recencyDelta;
      }
      const qualityDelta =
        nudgeCandidateQuality(right.candidate) -
        nudgeCandidateQuality(left.candidate);
      if (qualityDelta !== 0) {
        return qualityDelta;
      }
      return left.candidateIndex - right.candidateIndex;
    })
    .map((entry) => entry.candidate)
    .filter((candidate) => {
      const id = requireCandidateId(candidate);
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    });
}

function nudgeCandidateQuality(candidate: ExplorerCandidate): number {
  const sourceRank =
    candidate.source === "read_file"
      ? 4
      : candidate.source === "compiler"
        ? 3
        : candidate.source === "grep"
          ? 2
          : 1;
  return (
    sourceRank * 100 +
    (candidate.range ? 40 : 0) +
    (candidate.observedText ? 20 : 0) +
    Math.min(candidate.score, 100)
  );
}

interface ValidatedExploreSelectionV2 {
  primary: ExplorerCandidate[];
  readTargets: Array<{
    candidate: ExplorerCandidate;
    purpose: string;
    required: boolean;
  }>;
  flow: Array<{
    candidate: ExplorerCandidate;
    role: string;
    fact: string;
    quote: string;
  }>;
  missingCoverage: string[];
  recommendedPrimaryAction: ExploreSelectionV2["recommendedPrimaryAction"];
  searchTargets: string[];
  confidence: ExploreSelectionV2["confidence"];
  droppedReasons: string[];
}

function validateExploreSelectionV2({
  selection,
  candidates,
  observations,
  intent,
}: {
  selection: ExploreSelectionV2;
  candidates: ExplorerCandidate[];
  observations: SubagentObservation[];
  intent: ExploreIntent;
}): ValidatedExploreSelectionV2 | null {
  const candidateById = new Map(
    candidates.map((candidate) => [requireCandidateId(candidate), candidate]),
  );
  const droppedReasons: string[] = [];
  const primary = resolveCandidateIds(
    selection.primaryCandidateIds,
    candidateById,
  ).slice(0, MAX_PRIMARY_FILES);
  const readTargets = selection.readTargets
    .map((target) => {
      const candidate = candidateById.get(target.candidateId);
      if (!candidate || !candidate.range) {
        droppedReasons.push(`read_target_unobserved:${target.candidateId}`);
        return null;
      }
      return {
        candidate,
        purpose: target.purpose,
        required: target.required,
      };
    })
    .filter(
      (target): target is ValidatedExploreSelectionV2["readTargets"][number] =>
        Boolean(target),
    )
    .slice(0, MAX_READ_TARGETS);
  const flow = selection.flow
    .slice(0, MAX_PACKET_CANDIDATES)
    .map((link) => {
      const candidate = candidateById.get(link.candidateId);
      if (!candidate) {
        droppedReasons.push(`flow_unknown_candidate:${link.candidateId}`);
        return null;
      }
      if (quoteLineCount(link.quote) > 2) {
        droppedReasons.push(`quote_too_long:${link.candidateId}`);
        return null;
      }
      if (!isValidObservedQuote(link.quote, candidate, observations)) {
        droppedReasons.push(`fact_unverified:${link.candidateId}`);
        return null;
      }
      return {
        candidate,
        role: link.role,
        fact: link.fact,
        quote: clampQuote(link.quote),
      };
    })
    .filter((link): link is ValidatedExploreSelectionV2["flow"][number] =>
      Boolean(link),
    )
    .filter((link, index, links) => {
      const firstIndex = links.findIndex(
        (item) =>
          item.candidate.path === link.candidate.path &&
          formatRange(item.candidate.range) ===
            formatRange(link.candidate.range),
      );
      if (firstIndex !== index) {
        droppedReasons.push(
          `flow_duplicate_range:${requireCandidateId(link.candidate)}`,
        );
        return false;
      }
      return true;
    });

  if (
    primary.length === 0 &&
    selection.recommendedPrimaryAction !== "skip_explore_result"
  ) {
    return null;
  }

  let recommendedPrimaryAction = selection.recommendedPrimaryAction;
  if (
    recommendedPrimaryAction === "answer_from_report" &&
    (intent === "edit" || intent === "debug")
  ) {
    recommendedPrimaryAction =
      readTargets.length > 0 ? "read_targets" : "targeted_gap_search";
  }
  if (recommendedPrimaryAction === "answer_from_report" && flow.length === 0) {
    recommendedPrimaryAction =
      readTargets.length > 0 ? "read_targets" : "targeted_gap_search";
  }
  if (recommendedPrimaryAction === "read_targets" && readTargets.length === 0) {
    recommendedPrimaryAction = "targeted_gap_search";
  }

  const searchTargets = (selection.searchTargets ?? []).filter((target) => {
    if (isExecutableSearchTarget(target)) {
      return true;
    }
    droppedReasons.push("search_target_invalid");
    return false;
  });
  if (
    recommendedPrimaryAction === "targeted_gap_search" &&
    searchTargets.length === 0
  ) {
    recommendedPrimaryAction =
      readTargets.length > 0
        ? "read_targets"
        : flow.length > 0
          ? "answer_from_report"
          : "skip_explore_result";
  }
  let confidence = selection.confidence;
  if (
    confidence === "high" &&
    (droppedReasons.length > 0 || selection.missingCoverage.length > 0)
  ) {
    confidence = "medium";
  }
  if (confidence === "medium" && flow.length === 0) {
    confidence = "low";
  }
  if (recommendedPrimaryAction === "skip_explore_result") {
    confidence = "low";
  }
  if (
    confidence === "low" &&
    recommendedPrimaryAction === "answer_from_report"
  ) {
    recommendedPrimaryAction =
      readTargets.length > 0 ? "read_targets" : "targeted_gap_search";
  }

  return {
    primary,
    readTargets,
    flow,
    missingCoverage: selection.missingCoverage.slice(0, 3),
    recommendedPrimaryAction,
    searchTargets: searchTargets.slice(0, 5),
    confidence,
    droppedReasons,
  };
}

function getOrderedQueryTerms(query: string): string[] {
  return query
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3);
}

function getQueryTerms(query: string): string[] {
  return [...new Set(getOrderedQueryTerms(query))];
}

function summarizeEvidence(
  result: string,
  queryTerms: string[],
): string | undefined {
  const lines = result
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      line,
      index,
      score:
        queryTerms.reduce(
          (score, term) => score + (line.toLowerCase().includes(term) ? 2 : 0),
          0,
        ) +
        (/\b(function|class|const|return|export|async)\b/.test(line) ? 1 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 3)
    .map((entry) => truncate(entry.line));
  return lines.length > 0 ? lines.join("; ") : undefined;
}

function truncate(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= 180 ? collapsed : `${collapsed.slice(0, 177)}...`;
}

function truncateToMaxChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n[TRUNCATED]`;
}

function isExecutableSearchTarget(target: string): boolean {
  const query = target.match(/\bquery="([^"]{2,})"/)?.[1];
  const include = target.match(/\binclude="([^"]{2,})"/)?.[1];
  if (!query || !include) {
    return false;
  }
  return (
    !/\s/.test(include) &&
    (include.includes("/") || include.includes("*")) &&
    /(?:\.[jt]sx?$|\{[^}]*[jt]sx?[^}]*\})/.test(include)
  );
}

function getCriticalValidationGap({
  validated,
  intent,
  candidates,
}: {
  validated: ValidatedExploreSelectionV2;
  intent: ExploreIntent;
  candidates: ExplorerCandidate[];
}): string | null {
  const droppedFact = validated.droppedReasons.find(
    (reason) =>
      reason.startsWith("fact_unverified:") ||
      reason.startsWith("quote_too_long:"),
  );
  if (droppedFact) {
    return formatValidationGap(droppedFact, candidates);
  }
  if (
    validated.recommendedPrimaryAction === "skip_explore_result" &&
    (validated.primary.length > 0 ||
      validated.readTargets.length > 0 ||
      validated.flow.length > 0)
  ) {
    return "skip_explore_result is only valid when nothing relevant was found. If any observed candidate is relevant, choose answer_from_report, read_targets, or targeted_gap_search instead.";
  }
  if (
    validated.recommendedPrimaryAction === "targeted_gap_search" &&
    validated.searchTargets.length === 0
  ) {
    return 'targeted_gap_search requires executable searchTargets in this form: query="ExactObservedIdentifier" include="src/**/*.{ts,tsx}" literal=true';
  }
  if (
    validated.missingCoverage.length > 0 &&
    (validated.flow.length === 0 ||
      intent === "explain" ||
      intent === "edit" ||
      intent === "debug" ||
      validated.recommendedPrimaryAction === "targeted_gap_search")
  ) {
    return validated.missingCoverage[0];
  }
  if (
    (intent === "edit" || intent === "debug") &&
    validated.readTargets.length === 0
  ) {
    return "no ranged candidates survived for edit/debug intent";
  }
  return null;
}

function gapRequiresNewEvidence(gap: string): boolean {
  return (
    !gap.startsWith("Quote for ") && !gap.startsWith("Quote was not found")
  );
}

function formatValidationGap(
  reason: string,
  candidates: ExplorerCandidate[],
): string {
  if (reason.startsWith("quote_too_long:")) {
    const candidateId = reason.slice("quote_too_long:".length) as CandidateId;
    return [
      `Quote for ${candidateId} was longer than two lines. Use one complete source line when possible; never paste a block.`,
      formatQuoteHint(candidateId, candidates),
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (reason.startsWith("fact_unverified:")) {
    const candidateId = reason.slice("fact_unverified:".length) as CandidateId;
    return [
      `Quote was not found in observed evidence for ${candidateId}. Find a candidate whose observed source contains the exact quote, or remove that flow link.`,
      formatQuoteHint(candidateId, candidates),
    ]
      .filter(Boolean)
      .join(" ");
  }
  return reason;
}

function formatQuoteHint(
  candidateId: CandidateId,
  candidates: ExplorerCandidate[],
): string | null {
  const candidate = candidates.find(
    (item) => requireCandidateId(item) === candidateId,
  );
  const hints = getObservedQuoteHints(candidate?.observedText);
  if (hints.length === 0) {
    return null;
  }
  return `Copy one of these exact quote options verbatim: ${hints
    .map((hint) => `"${hint}"`)
    .join(" / ")}`;
}

function getObservedQuoteHints(observedText?: string): string[] {
  if (!observedText) {
    return [];
  }
  const sourceLines = observedText
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*\d+\s*/, "")
        .replace(/^line\s+\d+:\s*/i, "")
        .trim(),
    )
    .filter(Boolean)
    .filter((line) => !line.startsWith("```"))
    .filter((line) => line.length <= 180)
    .filter((line) => /[{}();=]|\b(import|export|class|function|const|return|type|interface)\b/.test(line));
  const scoredLines = sourceLines
    .map((line, index) => ({
      line,
      index,
      score:
        (/\b(export|function|class|const|type|interface)\b/.test(line)
          ? 6
          : 0) +
        (/\b(return|await|useQuery|mutate|router|handler|import)\b/.test(line)
          ? 4
          : 0) +
        (/[.=]\w+\(/.test(line) ? 2 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return [...new Set(scoredLines.map((entry) => entry.line))].slice(0, 5);
}

function isValidObservedQuote(
  quote: string,
  candidate: ExplorerCandidate,
  observations: SubagentObservation[],
): boolean {
  const normalizedQuote = normalizeQuoteText(quote);
  if (!normalizedQuote) {
    return false;
  }
  const observedText = [
    candidate.observedText,
    ...observations
      .flatMap((observation) => observation.candidates)
      .filter(
        (observedCandidate) =>
          requireCandidateId(observedCandidate) ===
          requireCandidateId(candidate),
      )
      .map((observedCandidate) => observedCandidate.observedText),
  ]
    .filter((text): text is string => Boolean(text))
    .join("\n");
  return normalizeQuoteText(observedText).includes(normalizedQuote);
}

function normalizeQuoteText(text: string): string {
  return text
    .replace(/^\s*\d+\s*\|\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampQuote(quote: string): string {
  return quote.split("\n").slice(0, 2).join("\n").trim();
}

function quoteLineCount(quote: string): number {
  return quote.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function buildV2Report({
  query,
  intent,
  validated,
}: {
  query: string;
  intent: ExploreIntent;
  validated: ValidatedExploreSelectionV2;
}): string {
  const renderedFlow = getRenderedFlowLinks(validated.flow);
  const renderedPathSet = new Set<string>();
  const lines: string[] = [
    "## explore_code report",
    `Query: "${truncateInline(query, MAX_REPORT_QUERY_CHARS)}" | Intent: ${intent} | Confidence: ${validated.confidence} | Action: ${validated.recommendedPrimaryAction}`,
    "",
    "Flow:",
  ];
  if (renderedFlow.length === 0) {
    lines.push("none");
  } else {
    renderedFlow.forEach((link, index) => {
      renderedPathSet.add(link.candidate.path);
      lines.push(
        `${index + 1}. ${link.ref} (${truncateInline(link.role, MAX_REPORT_ROLE_CHARS)}) - ${truncateInline(link.fact, MAX_REPORT_FACT_CHARS)}`,
        `> ${clampQuote(link.quote)}`,
      );
    });
  }
  lines.push("");
  if (validated.recommendedPrimaryAction === "answer_from_report") {
    lines.push("Missing: none");
  } else {
    const missingText =
      validated.recommendedPrimaryAction === "skip_explore_result" &&
      validated.primary.length === 0
        ? "explorer found nothing relevant; proceed without it"
        : validated.missingCoverage.length > 0
          ? validated.missingCoverage.join("; ")
          : "none";
    lines.push(
      `Missing: ${truncateInline(missingText, MAX_REPORT_MISSING_CHARS)}`,
    );
  }
  const renderedReadTargets =
    validated.recommendedPrimaryAction === "read_targets"
      ? validated.readTargets
      : [];
  if (renderedReadTargets.length > 0) {
    const flowIndexByPath = new Map(
      renderedFlow.map((link, index) => [link.candidate.path, index + 1]),
    );
    lines.push(
      "Read targets:",
      ...renderedReadTargets.map((target) => {
        const flowIndex = flowIndexByPath.get(target.candidate.path);
        if (flowIndex) {
          return `flow ${flowIndex} - ${truncateInline(target.purpose, MAX_REPORT_PURPOSE_CHARS)}`;
        }
        renderedPathSet.add(target.candidate.path);
        return `${formatCandidateRef(clampCandidateRange(target.candidate))} - ${truncateInline(target.purpose, MAX_REPORT_PURPOSE_CHARS)}`;
      }),
    );
  }
  const machinePathCandidates = getMachinePathCandidates({
    primary: validated.primary,
    flow: validated.flow,
    readTargets: renderedReadTargets,
  });
  if (
    validated.recommendedPrimaryAction === "targeted_gap_search" &&
    validated.searchTargets.length > 0
  ) {
    const searchTargetRefs = buildSearchTargetRefs(renderedFlow);
    const searchTargets = validated.searchTargets.map((target) =>
      truncateInline(
        renderSearchTarget(target, searchTargetRefs),
        MAX_REPORT_SEARCH_TARGET_CHARS,
      ),
    );
    for (const candidate of machinePathCandidates) {
      if (searchTargets.some((target) => target.includes(candidate.path))) {
        renderedPathSet.add(candidate.path);
      }
    }
    lines.push("Search targets:", ...searchTargets);
  }
  const remainingPathCandidates = machinePathCandidates.filter(
    (candidate) => !renderedPathSet.has(candidate.path),
  );
  if (remainingPathCandidates.length > 0) {
    lines.push(
      "Paths:",
      ...remainingPathCandidates.map((candidate) =>
        formatCandidateRef(clampCandidateRange(candidate)),
      ),
    );
  }
  const machine = {
    action: validated.recommendedPrimaryAction,
    confidence: validated.confidence,
    paths: machinePathCandidates.map((candidate) => ({
      path: candidate.path,
      range: formatRange(clampRangeForReport(candidate.range)),
    })),
  };
  lines.push("", "```json", JSON.stringify(machine), "```");
  return clampReportLength(lines.join("\n"));
}

function buildSearchTargetRefs(
  renderedFlow: Array<
    ValidatedExploreSelectionV2["flow"][number] & { ref: string }
  >,
): Map<string, string> {
  const refs = new Map<string, string>();
  renderedFlow.forEach((link, index) => {
    if (!refs.has(link.candidate.path)) {
      refs.set(link.candidate.path, `flow ${index + 1}`);
    }
  });
  return refs;
}

function renderSearchTarget(
  target: string,
  pathRefs: Map<string, string>,
): string {
  let rendered = target;
  for (const [filePath, ref] of pathRefs) {
    rendered = rendered.replace(new RegExp(escapeRegExp(filePath), "g"), ref);
  }
  return rendered.replace(/\s+/g, " ").trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getMachinePathCandidates({
  primary,
  flow,
  readTargets,
}: {
  primary: ExplorerCandidate[];
  flow: ValidatedExploreSelectionV2["flow"];
  readTargets: ValidatedExploreSelectionV2["readTargets"];
}): ExplorerCandidate[] {
  const candidates: ExplorerCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of [
    ...primary,
    ...flow.map((link) => link.candidate),
    ...readTargets.map((target) => target.candidate),
  ]) {
    const key = `${candidate.path}:${formatRange(candidate.range)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push(candidate);
  }
  return candidates.slice(0, MAX_MACHINE_PATHS);
}

function getRenderedFlowLinks(
  flow: ValidatedExploreSelectionV2["flow"],
): Array<ValidatedExploreSelectionV2["flow"][number] & { ref: string }> {
  const seenPaths = new Set<string>();
  const rendered: Array<
    ValidatedExploreSelectionV2["flow"][number] & { ref: string }
  > = [];
  for (const link of flow) {
    const ref = seenPaths.has(link.candidate.path)
      ? `same file:${formatRange(clampRangeForReport(link.candidate.range))}`
      : formatCandidateRef(clampCandidateRange(link.candidate));
    seenPaths.add(link.candidate.path);
    rendered.push({ ...link, ref });
    if (rendered.length >= MAX_RENDERED_FLOW_LINKS) {
      break;
    }
  }
  return rendered;
}

function clampCandidateRange(candidate: ExplorerCandidate): ExplorerCandidate {
  return {
    ...candidate,
    range: clampRangeForReport(candidate.range),
  };
}

function chooseReport({
  args,
  candidates,
  observations,
  ctx,
  subagentRunId,
  explorationFinalTextChars,
}: {
  args: ExploreCodeArgs;
  candidates: ExplorerCandidate[];
  observations: SubagentObservation[];
  ctx: AgentContext;
  subagentRunId: string;
  explorationFinalTextChars: number;
  selection: null;
  followupExhausted: false;
}): string {
  const report = buildDeterministicReport({
    query: args.query,
    intent: args.intent ?? "locate",
    candidates,
    observations,
  });
  const reportSummary = summarizeRenderedReport(report);
  recordCodeExplorerBenchmarkEvent({
    type: "subagent_deterministic_report",
    phase: SUBAGENT_PHASE,
    chatId: ctx.chatId,
    appId: ctx.appId,
    parentToolName: "explore_code",
    subagentRunId,
    candidateCount: candidates.length,
    explorationFinalTextChars,
    renderedAction: reportSummary.action,
    renderedConfidence: reportSummary.confidence,
    renderedIntent: reportSummary.intent,
    renderedPrimaryFileCount: reportSummary.primaryFileCount,
    renderedReadTargetCount: reportSummary.readTargetCount,
  });
  return report;
}

function summarizeRenderedReport(report: string): {
  action: string | null;
  confidence: string | null;
  intent: string | null;
  primaryFileCount: number;
  readTargetCount: number;
} {
  const jsonText = /```json\n([\s\S]+?)\n```/.exec(report)?.[1];
  if (!jsonText) {
    return {
      action: null,
      confidence: null,
      intent: null,
      primaryFileCount: 0,
      readTargetCount: 0,
    };
  }
  try {
    const summary = JSON.parse(jsonText) as {
      confidence?: unknown;
      readTargets?: unknown;
      paths?: unknown;
      action?: unknown;
    };
    return {
      action: typeof summary.action === "string" ? summary.action : null,
      confidence:
        typeof summary.confidence === "string" ? summary.confidence : null,
      intent: null,
      primaryFileCount: Array.isArray(summary.paths) ? summary.paths.length : 0,
      readTargetCount: Array.isArray(summary.readTargets)
        ? summary.readTargets.length
        : countRenderedSectionItems(report, "Read targets"),
    };
  } catch {
    return {
      action: null,
      confidence: null,
      intent: null,
      primaryFileCount: 0,
      readTargetCount: 0,
    };
  }
}

function countRenderedSectionItems(
  report: string,
  sectionName: string,
): number {
  const lines = report.split("\n");
  const sectionIndex = lines.findIndex((line) => line === `${sectionName}:`);
  if (sectionIndex === -1) {
    return 0;
  }
  let count = 0;
  for (let index = sectionIndex + 1; index < lines.length; index++) {
    const line = lines[index];
    if (
      line.trim() === "" ||
      line === "```json" ||
      /^[A-Z][A-Za-z ]+:$/.test(line)
    ) {
      break;
    }
    count += 1;
  }
  return count;
}

function getRenderedAction(report: string): string | null {
  return parseReportHeaderValue(report, "Action");
}

function getRenderedConfidence(report: string): string | null {
  return parseReportHeaderValue(report, "Confidence");
}

function parseReportHeaderValue(report: string, key: string): string | null {
  const match = new RegExp(`${key}:\\s*([^|\\n]+)`).exec(report);
  return match?.[1]?.trim() ?? null;
}

function buildDeterministicReport({
  query,
  intent,
  candidates,
  observations,
}: {
  query: string;
  intent: ExploreIntent;
  candidates: ExplorerCandidate[];
  observations: SubagentObservation[];
}): string {
  const primary = candidates.slice(0, MAX_PRIMARY_FILES);
  const readTargets = primary
    .filter((candidate) => candidate.range)
    .slice(0, MAX_READ_TARGETS);
  const confidence = "low";
  const action =
    readTargets.length > 0 ? "read_targets" : "targeted_gap_search";
  const machine = {
    action,
    confidence,
    paths: primary.map((candidate) => ({
      path: candidate.path,
      range: formatRange(clampRangeForReport(candidate.range)),
    })),
  };
  const searchTargets =
    action === "targeted_gap_search" ? getQueryTerms(query) : [];
  return clampReportLength(
    [
      "## explore_code report",
      `Query: "${query}" | Intent: ${intent} | Confidence: ${confidence} | Action: ${action}`,
      "",
      "Flow:",
      primary.length > 0
        ? primary
            .map(
              (candidate, index) =>
                `${index + 1}. ${formatCandidateRef(clampCandidateRange(candidate))} (observed) - ${candidate.provenance.join("; ")}`,
            )
            .join("\n")
        : "none",
      "",
      `Missing: ${
        primary.length > 0
          ? "submit_report was not called"
          : `no relevant candidates; tools used: ${
              [
                ...new Set(
                  observations.map((observation) => observation.toolName),
                ),
              ].join(", ") || "none"
            }`
      }`,
      readTargets.length > 0
        ? [
            "Read targets:",
            ...readTargets.map(
              (candidate, index) =>
                `flow ${index + 1} - observed fallback target`,
            ),
          ].join("\n")
        : "",
      searchTargets.length > 0
        ? ["Search targets:", ...searchTargets].join("\n")
        : "",
      "",
      "```json",
      JSON.stringify(machine),
      "```",
    ]
      .filter((line) => line !== "")
      .join("\n"),
  );
}
function resolveCandidateIds(
  ids: CandidateId[],
  candidateById: Map<CandidateId, ExplorerCandidate>,
): ExplorerCandidate[] {
  const resolved: ExplorerCandidate[] = [];
  const seen = new Set<CandidateId>();
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    const candidate = candidateById.get(id);
    if (!candidate) {
      continue;
    }
    seen.add(id);
    resolved.push(candidate);
  }
  return resolved;
}

function requireCandidateId(candidate: ExplorerCandidate): CandidateId {
  if (!candidate.id) {
    throw new Error(`Candidate missing id: ${candidate.path}`);
  }
  return candidate.id;
}

function candidateKey(candidate: ExplorerCandidate): string {
  return `${candidate.path}:${formatRange(candidate.range)}:${candidate.source}`;
}

function formatCandidateRef(candidate: ExplorerCandidate): string {
  const range = formatRange(candidate.range);
  return range ? `${candidate.path}:${range}` : candidate.path;
}

function truncateInline(text: string, maxChars: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function formatRange(range: { start: number; end: number } | null): string {
  return range ? `${range.start}-${range.end}` : "unknown";
}

function clampRangeForReport(
  range: { start: number; end: number } | null,
): { start: number; end: number } | null {
  if (!range) {
    return null;
  }
  const start = Math.max(1, range.start);
  const end = Math.max(start, range.end);
  if (end - start + 1 <= MAX_RANGE_LINES) {
    return { start, end };
  }
  return { start, end: start + MAX_RANGE_LINES - 1 };
}

function totalObservationChars(observations: SubagentObservation[]): number {
  return observations.reduce(
    (total, observation) => total + observation.result.length,
    0,
  );
}

function clampReportLength(report: string): string {
  if (report.length <= MAX_REPORT_CHARS) {
    return report;
  }
  const suffix = "\n[TRUNCATED: report exceeded density budget]";
  const jsonMatch = /\n```json\n[\s\S]*?\n```$/.exec(report);
  if (!jsonMatch) {
    return `${report.slice(0, MAX_REPORT_CHARS - suffix.length)}${suffix}`;
  }
  const jsonBlock = jsonMatch[0];
  const prefixBudget = MAX_REPORT_CHARS - jsonBlock.length - suffix.length;
  if (prefixBudget <= 0) {
    return `${report.slice(0, MAX_REPORT_CHARS - suffix.length)}${suffix}`;
  }
  const prefix = report.slice(0, jsonMatch.index);
  return `${prefix.slice(0, prefixBudget)}${suffix}${jsonBlock}`;
}

function candidatesFromRawExploreCodeResult(
  result: CodeExplorerResult,
): ExplorerCandidate[] {
  return result.files.flatMap((file) =>
    file.windows.map((window) =>
      buildCandidate({
        path: file.path,
        range: { start: window.startLine, end: window.endLine },
        symbols: file.symbols.map((symbol) => ({
          name: symbol.name,
          kind: symbol.kind,
          line: symbol.line,
        })),
        source: "compiler",
        provenance: ["compiler-backed symbol window"],
        evidence: summarizeEvidence(window.lines.join("\n"), [
          ...getQueryTerms(result.query),
          ...getQueryTerms(file.path),
        ]),
        observedText: window.lines.join("\n"),
      }),
    ),
  );
}

function candidatesFromGrepResult(
  result: string,
  args: unknown,
): ExplorerCandidate[] {
  const queryTerms = getQueryTerms(
    typeof args === "object" && args && "query" in args
      ? String((args as { query?: unknown }).query ?? "")
      : "",
  );
  const refsByPath = new Map<
    string,
    Array<{ lineNumber: number; lineText: string }>
  >();
  for (const line of result.split("\n")) {
    const match = /^([^:\n]+):(\d+):/.exec(line);
    if (!match) {
      continue;
    }
    const path = match[1];
    const lineNumber = Number(match[2]);
    const lineText = line.slice(match[0].length).trim();
    const existing = refsByPath.get(path) ?? [];
    existing.push({ lineNumber, lineText });
    refsByPath.set(path, existing);
  }
  return [...refsByPath.entries()].flatMap(([path, matches]) =>
    clusterGrepMatches(matches).map((cluster) =>
      buildCandidate({
        path,
        range: grepClusterRange(cluster),
        symbols: [],
        source: "grep",
        provenance: ["targeted text match"],
        evidence: cluster
          .slice(0, 3)
          .map((item) => `line ${item.lineNumber}: ${truncate(item.lineText)}`)
          .join("; "),
        observedText: cluster
          .map((item) => `line ${item.lineNumber}: ${item.lineText}`)
          .join("\n"),
        queryTerms,
      }),
    ),
  );
}

function clusterGrepMatches(
  matches: Array<{ lineNumber: number; lineText: string }>,
): Array<Array<{ lineNumber: number; lineText: string }>> {
  const sorted = [...matches].sort((a, b) => a.lineNumber - b.lineNumber);
  const clusters: Array<Array<{ lineNumber: number; lineText: string }>> = [];
  for (const match of sorted) {
    const current = clusters.at(-1);
    const last = current?.at(-1);
    if (
      current &&
      last &&
      match.lineNumber - last.lineNumber <= GREP_CLUSTER_GAP_LINES
    ) {
      current.push(match);
    } else {
      clusters.push([match]);
    }
  }
  return clusters;
}

function grepClusterRange(
  cluster: Array<{ lineNumber: number; lineText: string }>,
): { start: number; end: number } {
  const min = Math.min(...cluster.map((match) => match.lineNumber));
  const max = Math.max(...cluster.map((match) => match.lineNumber));
  const start = Math.max(1, min - GREP_CONTEXT_LINES);
  const paddedEnd = max + GREP_CONTEXT_LINES;
  return {
    start,
    end: Math.min(paddedEnd, start + MAX_RANGE_LINES - 1),
  };
}

function candidatesFromReadFileResult(
  result: string,
  args: unknown,
): ExplorerCandidate[] {
  const readArgs = parseReadFileArgs(args);
  if (!readArgs) {
    return [];
  }
  return [
    buildCandidate({
      path: readArgs.path,
      range:
        readArgs.startLine || readArgs.endLine
          ? {
              start: readArgs.startLine ?? 1,
              end: readArgs.endLine ?? readArgs.startLine ?? 1,
            }
          : null,
      symbols: [],
      source: "read_file",
      provenance: ["source range read directly by the sub-agent"],
      evidence: summarizeEvidence(result, getQueryTerms(readArgs.path)),
      observedText: result,
    }),
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
  return {
    path,
    startLine:
      typeof maybeArgs.start_line_one_indexed === "number"
        ? maybeArgs.start_line_one_indexed
        : undefined,
    endLine:
      typeof maybeArgs.end_line_one_indexed_inclusive === "number"
        ? maybeArgs.end_line_one_indexed_inclusive
        : undefined,
  };
}

function candidatesFromListFilesResult(
  result: string,
  args: unknown,
): ExplorerCandidate[] {
  const queryTerms = getQueryTerms(
    typeof args === "object" && args && "directory" in args
      ? String((args as { directory?: unknown }).directory ?? "")
      : "",
  );
  return result
    .split("\n")
    .map((line) => /^\s*-\s+(.+)$/.exec(line)?.[1]?.trim())
    .filter((path): path is string => Boolean(path && !path.endsWith("/")))
    .slice(0, 40)
    .map((path) =>
      buildCandidate({
        path,
        range: null,
        symbols: [],
        source: "list_files",
        provenance: ["candidate path from directory listing"],
        queryTerms,
      }),
    );
}

function buildCandidate({
  path,
  range,
  symbols,
  source,
  provenance,
  evidence,
  observedText,
  queryTerms = [],
}: {
  path: string;
  range: { start: number; end: number } | null;
  symbols: Array<{ name: string; kind: string; line: number }>;
  source: CandidateSource;
  provenance: string[];
  evidence?: string;
  observedText?: string;
  queryTerms?: string[];
}): ExplorerCandidate {
  const traits = getPathTraits(path);
  const rangeWidth = range ? Math.max(1, range.end - range.start + 1) : 40;
  const basename = path.split("/").at(-1) ?? path;
  const basenameHaystack = basename.toLowerCase();
  const symbolHaystack = symbols
    .map((symbol) => symbol.name)
    .join(" ")
    .toLowerCase();
  const evidenceHaystack = (evidence ?? "").toLowerCase();
  const basenameMatches = queryTerms.filter((term) =>
    basenameHaystack.includes(term),
  ).length;
  const symbolMatches = queryTerms.filter((term) =>
    symbolHaystack.includes(term),
  ).length;
  const evidenceMatches = queryTerms.filter((term) =>
    evidenceHaystack.includes(term),
  ).length;
  const sourceScore =
    source === "compiler"
      ? 60
      : source === "read_file"
        ? 45
        : source === "grep"
          ? 30
          : 5;
  const supportPenalty =
    traits.isTest ||
    traits.isSupport ||
    traits.isGenerated ||
    traits.isDocsExample
      ? -40
      : 0;
  return {
    path,
    range,
    symbols,
    score:
      sourceScore +
      evidenceMatches * 10 +
      symbolMatches * 10 +
      basenameMatches * 6 +
      (rangeWidth <= 120 ? 8 : rangeWidth > MAX_RANGE_LINES ? -20 : 0) +
      supportPenalty,
    source,
    provenance,
    traits,
    estimatedTokens: Math.ceil(rangeWidth * 4),
    evidence,
    observedText,
  };
}

function getRankedCandidates(
  observations: SubagentObservation[],
  query: string,
): ExplorerCandidate[] {
  const queryTerms = getQueryTerms(query);
  const seen = new Map<string, ExplorerCandidate>();
  for (const candidate of observations.flatMap(
    (observation) => observation.candidates,
  )) {
    const rescored = {
      ...buildCandidate({
        ...candidate,
        queryTerms,
      }),
      id: candidate.id,
    };
    const key = `${rescored.path}:${formatRange(rescored.range)}`;
    const overlappingKey = findOverlappingCandidateKey(seen, rescored);
    if (overlappingKey) {
      const existing = seen.get(overlappingKey);
      if (existing && shouldReplaceOverlappingCandidate(existing, rescored)) {
        seen.delete(overlappingKey);
        seen.set(key, rescored);
      }
      continue;
    }
    const existing = seen.get(key);
    if (!existing || rescored.score > existing.score) {
      seen.set(key, rescored);
    }
  }
  const ranked = [...seen.values()].sort((left, right) => {
    const scoreDelta = right.score - left.score;
    if (scoreDelta !== 0) {
      return scoreDelta;
    }
    return left.path.localeCompare(right.path);
  });
  return dedupeOverlappingRankedCandidates(ranked)
    .slice(0, MAX_INTERNAL_CANDIDATES)
    .map((candidate) => {
      if (!candidate.id) {
        throw new Error(
          `Ranked candidate missing stable id: ${candidate.path}`,
        );
      }
      return candidate;
    });
}

function getObservedCandidates(
  observations: SubagentObservation[],
): ExplorerCandidate[] {
  const candidateById = new Map<CandidateId, ExplorerCandidate>();
  for (const candidate of observations.flatMap(
    (observation) => observation.candidates,
  )) {
    const id = requireCandidateId(candidate);
    if (!candidateById.has(id)) {
      candidateById.set(id, candidate);
    }
  }
  return [...candidateById.values()];
}

function dedupeOverlappingRankedCandidates(
  candidates: ExplorerCandidate[],
): ExplorerCandidate[] {
  const kept: ExplorerCandidate[] = [];
  for (const candidate of candidates) {
    const overlapsKept = kept.some(
      (existing) =>
        existing.path === candidate.path &&
        existing.range &&
        candidate.range &&
        rangesOverlap(existing.range, candidate.range),
    );
    if (!overlapsKept) {
      kept.push(candidate);
    }
  }
  return kept;
}

function findOverlappingCandidateKey(
  seen: Map<string, ExplorerCandidate>,
  candidate: ExplorerCandidate,
): string | null {
  if (!candidate.range) {
    return null;
  }
  for (const [key, existing] of seen) {
    if (
      existing.path === candidate.path &&
      existing.range &&
      rangesOverlap(existing.range, candidate.range)
    ) {
      return key;
    }
  }
  return null;
}

function shouldReplaceOverlappingCandidate(
  existing: ExplorerCandidate,
  candidate: ExplorerCandidate,
): boolean {
  if (candidate.score !== existing.score) {
    return candidate.score > existing.score;
  }
  return rangeWidth(candidate.range) < rangeWidth(existing.range);
}

function rangesOverlap(
  left: { start: number; end: number },
  right: { start: number; end: number },
): boolean {
  return left.start <= right.end && right.start <= left.end;
}

function rangeWidth(range: { start: number; end: number } | null): number {
  return range
    ? Math.max(1, range.end - range.start + 1)
    : Number.MAX_SAFE_INTEGER;
}

function getPathTraits(path: string): ExplorerCandidate["traits"] {
  const normalized = path.toLowerCase();
  const pathKinds: string[] = [];
  if (
    /(^|\/)(routes?|pages?|screens?)(\/|$)|\/page\.[tj]sx?$/.test(normalized)
  ) {
    pathKinds.push("route");
  }
  if (/\.(tsx|jsx)$/.test(normalized) || normalized.includes("/components/")) {
    pathKinds.push("component");
  }
  if (normalized.includes("/hooks/") || /use[A-Z]/.test(path)) {
    pathKinds.push("hook");
  }
  if (normalized.includes("/services/") || normalized.includes("/service/")) {
    pathKinds.push("service");
  }
  if (normalized.includes("/api/") || normalized.includes("/server/")) {
    pathKinds.push("api");
  }
  if (
    normalized.includes("/store") ||
    normalized.includes("/stores/") ||
    normalized.includes("/state") ||
    normalized.includes("/atoms/")
  ) {
    pathKinds.push("store");
  }
  if (normalized.includes("/actions/") || normalized.includes("/commands/")) {
    pathKinds.push("action");
  }
  if (
    normalized.endsWith(".d.ts") ||
    normalized.includes("/types/") ||
    normalized.endsWith("types.ts")
  ) {
    pathKinds.push("type");
  }
  if (
    normalized.includes("config") ||
    normalized.endsWith(".json") ||
    normalized.endsWith(".yml") ||
    normalized.endsWith(".yaml")
  ) {
    pathKinds.push("config");
  }
  return {
    isTest: isTestPath(normalized),
    isSupport: isSupportPath(normalized),
    isGenerated: isGeneratedPath(normalized),
    isDocsExample: isDocsExamplePath(normalized),
    pathKinds: [...new Set(pathKinds)],
  };
}

function isTestPath(path: string): boolean {
  return (
    /\.(test|spec|e2e)\.[tj]sx?$/.test(path) ||
    path.includes("/__tests__/") ||
    path.includes("/test/") ||
    path.includes("/tests/") ||
    path.includes("/e2e/")
  );
}

function isSupportPath(path: string): boolean {
  return (
    path.includes("/__snapshots__/") ||
    path.includes("/fixtures/") ||
    path.includes("/help/") ||
    path.includes("/mocks/") ||
    path.includes("/__mocks__/") ||
    path.includes("/playwright/") ||
    path.includes("/testing/") ||
    path.includes(".stories.") ||
    path.includes("/__stories__/")
  );
}

function isGeneratedPath(path: string): boolean {
  return (
    path.includes("/generated/") ||
    path.includes("/generated-") ||
    path.includes("/generated_") ||
    path.includes("codegen")
  );
}

function isDocsExamplePath(path: string): boolean {
  return (
    path.startsWith("examples/") ||
    path.startsWith("example/") ||
    path.includes("/examples/") ||
    path.includes("/docs/") ||
    path.startsWith("docs/")
  );
}

function buildExploreCodeSubagentSystemPrompt(): string {
  return `You are a general code reconnaissance sub-agent. Explore enough to understand the user's requested code area, then finish by calling submit_report.

Rules:
- Use read-only tools only.
- You may take multiple tool steps when needed. Explore broadly inside the sub-agent.
- Prefer compiler-backed explore_code for TypeScript/TSX/JavaScript/JSX included in the TypeScript config.
- Use grep/list_files for generic framework surfaces, routes, file names, and fallback lexical discovery.
- Use read_file only for tight verification ranges after you have candidate paths. If grep returns exact symbol or path matches for a missing core computation, handler, or rendered output, read the tight implementation range for the best matching files before submit_report when tool budget remains; do not defer already-found exact symbols as searchTargets without observing their source.
- Tool results include observed candidate IDs like [c7]. Select those IDs only; never type file paths or line ranges into submit_report.
- Do not tune to specific repositories or benchmark tasks. Use open role labels that fit the code you observed, such as entry, UI, handler, state, data/API, persistence, render/output, type, or test.
- Every flow fact must include a quote copied verbatim from the selected candidate's observed source. Prefer one complete source line; two lines maximum. Never quote a block, function body, markdown fence, ellipsis, or paraphrase. If no exact short quote is available, omit that flow link and list the gap in missingCoverage.
- For explain traces, prefer the execution path over nearby files that only share query terms. When the requested behavior crosses layers, select observed links for the user-facing entry/UI, request or transport boundary, core computation/service, and returned data or rendered output when those links exist. Preserve qualifiers in the user's phrase: if an exact multi-word query has no hits, search the meaningful words separately in scoped UI/package paths before settling for a shared noun. If separate terms lead only to management, listing, or settings surfaces while the query asks how user-facing behavior is computed or surfaced, keep exploring call sites, handlers, returned data, or rendered output before reporting. Trace the path that produces the displayed/returned result; do not substitute adjacent validation, reservation, logging, cache, raw-source collection, or configuration paths unless the query asks for them. If you only observe a partial source such as busy times, permissions, or persistence but not the service/handler that computes the requested user-facing result, list that as missingCoverage or choose targeted_gap_search/read_targets instead of answer_from_report.
- Choose answer_from_report for explain/locate intent once the observed flow is sufficient to answer, even if you still name residual gaps in missingCoverage. Choose read_targets for edit/debug when exact ranges should be read before changing code. Choose targeted_gap_search only when answer_from_report/read_targets are insufficient and you can provide executable searchTargets in this form: query="ExactObservedIdentifier" include="src/**/*.{ts,tsx}" literal=true. Do not use natural-language search phrases. Choose skip_explore_result only when nothing relevant was found; do not include primary IDs, read targets, or flow links with skip_explore_result.
- Prefer observed evidence over guessed paths. If a path read fails, rediscover with grep/list_files instead of repeating guesses.
- Do not write prose, markdown, source excerpts, or code fences as the final response. When done exploring, call submit_report.`;
}

function buildExploreCodeSubagentPrompt(args: ExploreCodeArgs): string {
  const targetText = args.app_name
    ? `Target app: ${args.app_name}. Use app_name only for this referenced app.`
    : "Target app: current app. Omit app_name in tool calls.";
  return [
    `User query: ${args.query}`,
    targetText,
    args.tsconfig_path ? `TypeScript config: ${args.tsconfig_path}` : "",
    "",
    `Intent: ${args.intent ?? "locate"}`,
    "Explore with the available read-only tools. When you have enough evidence, call submit_report using observed candidate IDs and verbatim quotes.",
  ]
    .filter(Boolean)
    .join("\n");
}
