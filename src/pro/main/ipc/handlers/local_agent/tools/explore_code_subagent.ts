import { streamText, stepCountIs, type ModelMessage, type ToolSet } from "ai";
import crypto from "node:crypto";
import log from "electron-log";

import { readSettings } from "@/main/settings";
import { cleanMessage } from "@/ipc/utils/ai_messages_utils";
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
import {
  annotateObservationResult,
  candidatesFromGrepResult,
  candidatesFromListFilesResult,
  candidatesFromRawExploreCodeResult,
  candidatesFromReadFileResult,
  createCandidateRegistry,
  formatObservationResult,
  getObservedCandidates,
  totalObservationChars,
  type CandidateRegistry,
  type ExplorerCandidate,
  type SubagentObservation,
} from "./explore_code_subagent_candidates";
import {
  buildDeterministicReport,
  buildReport,
  deriveOutcome,
  getExplainSufficiencyGap,
  resolveSelection,
  submitReportSchema,
  type ExploreIntent,
  type ExploreSelection,
  type Outcome,
  type ResolvedSelection,
} from "./explore_code_subagent_report";
import {
  buildExploreCodeSubagentPrompt,
  buildExploreCodeSubagentSystemPrompt,
} from "./explore_code_subagent_prompts";

const logger = log.scope("explore_code_subagent");

const SUBAGENT_MODEL = { provider: "auto", name: "value" } as const;
const SUBAGENT_PHASE = "explore_code_subagent";
const SUBAGENT_MAX_STEPS = 12;
const SUBAGENT_MAX_OUTPUT_TOKENS = 16_000;
const SUBAGENT_MAX_RETRIES = 1;
const ROOT_RECURSIVE_LIST_FILES_MESSAGE =
  "Root recursive listing is intentionally compacted for the explorer sub-agent. Use targeted grep/explore_code first, or list a specific directory.";

interface AcceptedReport {
  resolved: ResolvedSelection;
  outcome: Outcome;
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
  const candidateRegistry = createCandidateRegistry();
  const readOnlyToolBudget = createReadOnlyToolBudget();
  const acceptedRef: { current: AcceptedReport | null } = { current: null };
  let explainBounceUsed = false;

  const record = (event: Record<string, unknown>): void => {
    recordCodeExplorerBenchmarkEvent({
      phase: SUBAGENT_PHASE,
      chatId: ctx.chatId,
      appId: ctx.appId,
      parentToolName: "explore_code",
      subagentRunId,
      ...event,
    });
  };

  const tools = buildExploreCodeSubagentTools({
    args,
    ctx,
    observations,
    candidateRegistry,
    readOnlyToolBudget,
    record,
    onSubmitReport: (selection): string => {
      const candidates = getObservedCandidates(observations);
      const resolved = resolveSelection({ selection, candidates });
      if (!resolved) {
        return "No selected candidate IDs matched observed evidence. Reference observed candidate IDs (like c3) shown in tool results, then call submit_report again.";
      }
      if (!explainBounceUsed) {
        const gap = getExplainSufficiencyGap(intent, resolved);
        if (gap) {
          explainBounceUsed = true;
          // Keep this as a provisional accept so a dropped stream still renders
          // something better than the heuristic fallback.
          acceptedRef.current = {
            resolved,
            outcome: deriveOutcome(intent, resolved),
          };
          return gap;
        }
      }
      acceptedRef.current = {
        resolved,
        outcome: deriveOutcome(intent, resolved),
      };
      return "Report accepted.";
    },
  });

  record({ type: "subagent_start", model: SUBAGENT_MODEL });

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
      prepareStep: ({ messages }) =>
        prepareExploreCodeSubagentStep({
          messages,
          observations,
          acceptedRef,
        }),
      stopWhen: stepCountIs(SUBAGENT_MAX_STEPS),
      abortSignal: ctx.abortSignal,
      onStepFinish: (step) => {
        record({
          type: "stream_step_finish",
          toolCallCount: step.toolCalls.length,
          toolNames: step.toolCalls.map((toolCall) => toolCall.toolName),
          usage: step.usage,
        });
      },
      onFinish: (event) => {
        record({ type: "stream_finish", usage: event.totalUsage });
      },
    });
    const fullStream = streamResult.fullStream;
    cancelOrphanedBaseStream(streamResult);

    for await (const _part of fullStream) {
      // Drain the stream so tool calls execute.
    }

    const reportText = renderFinalReport({
      args,
      intent,
      acceptedRef,
      observations,
    });
    recordFinish({ record, acceptedRef, observations, reportText, startedAt });
    return reportText;
  } catch (error) {
    logger.warn("explore_code sub-agent failed", error);
    const elapsedMs = Date.now() - startedAt;
    record({
      type: "subagent_error",
      elapsedMs,
      error: error instanceof Error ? error.message : String(error),
    });
    if (acceptedRef.current || observations.length > 0) {
      const reportText = renderFinalReport({
        args,
        intent,
        acceptedRef,
        observations,
      });
      record({
        type: "subagent_partial_recovery",
        elapsedMs,
        reportChars: reportText.length,
        rawObservationChars: totalObservationChars(observations),
      });
      return reportText;
    }
    throw error;
  }
}

function renderFinalReport({
  args,
  intent,
  acceptedRef,
  observations,
}: {
  args: ExploreCodeArgs;
  intent: ExploreIntent;
  acceptedRef: { current: AcceptedReport | null };
  observations: SubagentObservation[];
}): string {
  const accepted = acceptedRef.current;
  if (accepted) {
    return buildReport({
      query: args.query,
      intent,
      resolved: accepted.resolved,
      outcome: accepted.outcome,
    }).text;
  }
  return buildDeterministicReport({ query: args.query, intent, observations });
}

function recordFinish({
  record,
  acceptedRef,
  observations,
  reportText,
  startedAt,
}: {
  record: (event: Record<string, unknown>) => void;
  acceptedRef: { current: AcceptedReport | null };
  observations: SubagentObservation[];
  reportText: string;
  startedAt: number;
}): void {
  const accepted = acceptedRef.current;
  record({
    type: "subagent_finish",
    elapsedMs: Date.now() - startedAt,
    reportChars: reportText.length,
    rawObservationChars: totalObservationChars(observations),
    fromModelSelection: accepted != null,
    renderedAction: accepted?.outcome.action ?? null,
    renderedConfidence: accepted?.outcome.confidence ?? null,
    droppedReasons: accepted?.resolved.droppedReasons ?? [],
  });
  if (!accepted) {
    record({
      type: "subagent_deterministic_report",
      candidateCount: observations.reduce(
        (total, observation) => total + observation.candidates.length,
        0,
      ),
    });
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
        return `Sub-agent read-only tool budget exhausted after ${SUBAGENT_MAX_STEPS} calls. Do not call ${toolName} again; call submit_report with observed candidate IDs.`;
      }
      usedCalls += 1;
      return null;
    },
  };
}

function buildExploreCodeSubagentTools({
  args,
  ctx,
  observations,
  candidateRegistry,
  readOnlyToolBudget,
  record,
  onSubmitReport,
}: {
  args: ExploreCodeArgs;
  ctx: AgentContext;
  observations: SubagentObservation[];
  candidateRegistry: CandidateRegistry;
  readOnlyToolBudget: ReadOnlyToolBudget;
  record: (event: Record<string, unknown>) => void;
  onSubmitReport: (selection: ExploreSelection) => string;
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
      observations,
      candidateRegistry,
      readOnlyToolBudget,
      record,
      compactBroadCall: compactBroadListFilesCall,
      candidatesFromResult: (toolArgs, result) =>
        candidatesFromListFilesResult(String(result), toolArgs),
    }),
    grep: wrapSubagentTool({
      tool: grepTool,
      ctx: childCtx,
      observations,
      candidateRegistry,
      readOnlyToolBudget,
      record,
      candidatesFromResult: (toolArgs, result) =>
        candidatesFromGrepResult(String(result), toolArgs),
    }),
    read_file: wrapSubagentTool({
      tool: readFileTool,
      ctx: childCtx,
      observations,
      candidateRegistry,
      readOnlyToolBudget,
      record,
      candidatesFromResult: (toolArgs, result) =>
        candidatesFromReadFileResult(String(result), toolArgs),
    }),
    explore_code: buildObservedExploreCodeTool({
      parentArgs: args,
      ctx: childCtx,
      observations,
      candidateRegistry,
      readOnlyToolBudget,
      record,
    }),
    submit_report: {
      description:
        "Submit the final code exploration report. Reference observed candidate IDs only; give each flow step an open role label and a fact tied to the query. Do not write quotes or choose an action — those are produced for you.",
      inputSchema: submitReportSchema,
      execute: async (selection: ExploreSelection) => {
        const result = onSubmitReport(selection);
        record({
          type: "submit_report_result",
          toolName: "submit_report",
          resultPreview: summarizeBenchmarkValue(result),
          accepted: result === "Report accepted.",
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
  observations,
  candidateRegistry,
  readOnlyToolBudget,
  record,
}: {
  parentArgs: ExploreCodeArgs;
  ctx: AgentContext;
  observations: SubagentObservation[];
  candidateRegistry: CandidateRegistry;
  readOnlyToolBudget: ReadOnlyToolBudget;
  record: (event: Record<string, unknown>) => void;
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
      record({
        type: "tool_call_start",
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
        record({
          type: "tool_call_end",
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
        record({
          type: "tool_call_error",
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
  observations,
  candidateRegistry,
  readOnlyToolBudget,
  record,
  candidatesFromResult,
  compactBroadCall,
}: {
  tool: ToolDefinition<TArgs>;
  ctx: AgentContext;
  observations: SubagentObservation[];
  candidateRegistry: CandidateRegistry;
  readOnlyToolBudget: ReadOnlyToolBudget;
  record: (event: Record<string, unknown>) => void;
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
      record({
        type: "tool_call_start",
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
          record({
            type: "tool_call_end",
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
        record({
          type: "tool_call_end",
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
        record({
          type: "tool_call_error",
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

function prepareExploreCodeSubagentStep({
  messages,
  observations,
  acceptedRef,
}: {
  messages: ModelMessage[];
  observations: SubagentObservation[];
  acceptedRef: { current: AcceptedReport | null };
}) {
  let forcedStep: ReturnType<
    typeof forceExploreCodeStep | typeof forceSubmitReportStep
  > | null = null;

  // First step must use the compiler-backed explorer.
  if (observations.length === 0) {
    forcedStep = forceExploreCodeStep();
  } else if (
    // Last allowed step with nothing accepted yet: force a report so we get
    // the model's own candidate selection instead of the heuristic fallback.
    !acceptedRef.current &&
    observations.length >= SUBAGENT_MAX_STEPS - 1
  ) {
    forcedStep = forceSubmitReportStep();
  }

  const cleanedMessages = messages.map(cleanMessage);
  const hasCleanedMessages = cleanedMessages.some(
    (message, index) => message !== messages[index],
  );

  if (!hasCleanedMessages) {
    return forcedStep ?? undefined;
  }

  return {
    ...forcedStep,
    messages: cleanedMessages,
  };
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
