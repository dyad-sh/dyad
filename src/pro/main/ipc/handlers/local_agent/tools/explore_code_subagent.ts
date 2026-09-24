import { getAuxiliaryModel } from "@/lib/auxiliaryModel";
import { withReferencedAppRead } from "./referenced_app_read";
import { streamText, stepCountIs, type ModelMessage, type ToolSet } from "ai";
import log from "electron-log";

import { getChatInferenceSettings } from "@/ipc/services/chat_inference_settings";
import { SMALL_MODEL_NAME } from "@/ipc/shared/language_model_constants";
import { resolveModelSelection } from "@/ipc/utils/model_effort";
import { getModelPreferenceKey } from "@/lib/modelEffort";
import { cleanMessage } from "@/ipc/utils/ai_messages_utils";
import { getModelClient } from "@/ipc/utils/get_model_client";
import { getAiHeaders, getProviderOptions } from "@/ipc/utils/provider_options";
import {
  cancelOrphanedBaseStream,
  fastTextOutput,
} from "@/ipc/utils/stream_text_utils";
import { getMaxTokens, getTemperature } from "@/ipc/utils/token_utils";
import type { UserSettings } from "@/lib/schemas";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
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
  buildCandidate,
  candidatesFromGrepResult,
  candidatesFromListFilesResult,
  candidatesFromRawExploreCodeResult,
  candidatesFromReadFileResult,
  createCandidateRegistry,
  formatObservationResult,
  getQueryTerms,
  getObservedCandidates,
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
import { formatExploreProgressLog } from "./explore_code_subagent_progress";

const logger = log.scope("explore_code_subagent");

const SUBAGENT_MODEL = { provider: "openai", name: SMALL_MODEL_NAME } as const;
// Max model turns in the agent loop. Each step may issue several parallel tool
// calls, so this is distinct from the read-only tool-call budget below.
const SUBAGENT_MAX_STEPS = 12;
// Max individual read-only tool executions (grep/list_files/read_file/
// explore_code) across the whole run. Higher than the step cap so a step that
// batches several parallel calls doesn't starve later reasoning turns.
// submit_report is exempt and never counts against this.
const SUBAGENT_MAX_TOOL_CALLS = 50;
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
  tools: durableTools,
  onProgress,
  onUsage,
  onFinalized,
}: {
  args: ExploreCodeArgs;
  ctx: AgentContext;
  tools?: ToolSet;
  onProgress?: (progressText: string) => void;
  onUsage?: (usage: {
    inputTokens: number;
    outputTokens: number;
    toolCallCount: number;
    stepCount: number;
  }) => Promise<void> | void;
  onFinalized?: (result: {
    usedFallback: boolean;
    observationCount: number;
  }) => void;
}): Promise<string> {
  const storedSettings = await getChatInferenceSettings(
    ctx.chatId,
    ctx.inferenceSettings,
  );
  assertDyadValueAvailable(storedSettings);
  const auxiliaryModel = getAuxiliaryModel(storedSettings, SUBAGENT_MODEL);
  const selectedModel = await resolveModelSelection({
    model: auxiliaryModel,
    preferredEffortLevel:
      storedSettings.modelEffortPreferences?.[
        getModelPreferenceKey(auxiliaryModel)
      ],
  });
  const settings = { ...storedSettings, selectedModel };

  const modelInfo = await getModelClient(
    auxiliaryModel,
    settings,
    selectedModel,
  );
  const maxOutputTokens = Math.min(
    (await getMaxTokens(auxiliaryModel)) ?? SUBAGENT_MAX_OUTPUT_TOKENS,
    SUBAGENT_MAX_OUTPUT_TOKENS,
  );
  const temperature = await getTemperature(auxiliaryModel);
  const intent: ExploreIntent = args.intent ?? "locate";
  const observations: SubagentObservation[] = [];
  const candidateRegistry = createCandidateRegistry();
  const readOnlyToolBudget = createReadOnlyToolBudget();
  const acceptedRef: { current: AcceptedReport | null } = { current: null };
  let subagentStepCount = 0;
  let explainBounceUsed = false;
  // Set only when a report is finally accepted (not on a bounced submit_report).
  // Used to stop the agent loop right after acceptance so the AI SDK does not
  // spend an extra Dyad Engine step feeding the "Report accepted." tool result
  // back to the model (which could also run more read-only tools post-report).
  let reportFinalized = false;

  const tools = buildExploreCodeSubagentTools({
    args,
    ctx,
    durableTools,
    observations,
    candidateRegistry,
    readOnlyToolBudget,
    onProgress,
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
      reportFinalized = true;
      return "Report accepted.";
    },
  });

  try {
    const streamResult = streamText({
      output: fastTextOutput(),
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
        reasoningEffortProviderId:
          modelInfo.modelClient.reasoningEffortProviderId,
        modelSelection: selectedModel,
      }),
      maxOutputTokens,
      temperature,
      maxRetries: SUBAGENT_MAX_RETRIES,
      system: buildExploreCodeSubagentSystemPrompt(),
      prompt: buildExploreCodeSubagentPrompt(args),
      tools,
      prepareStep: ({ messages }) => {
        subagentStepCount++;
        return prepareExploreCodeSubagentStep({
          messages,
          observations,
          acceptedRef,
          stepCount: subagentStepCount,
          exploreCodeAvailable: Boolean(tools.explore_code),
        });
      },
      stopWhen: [stepCountIs(SUBAGENT_MAX_STEPS), () => reportFinalized],
      abortSignal: ctx.abortSignal,
    });
    const fullStream = streamResult.fullStream;

    for await (const _part of fullStream) {
      // Drain the stream so tool calls execute.
    }

    const [usage, steps] = await Promise.all([
      streamResult.totalUsage ?? Promise.resolve(undefined),
      streamResult.steps ?? Promise.resolve([]),
    ]);
    cancelOrphanedBaseStream(streamResult);
    await onUsage?.({
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      toolCallCount: steps.reduce(
        (count, step) => count + step.toolCalls.length,
        0,
      ),
      stepCount: steps.length,
    });

    if (observations.length === 0 && !durableTools) {
      await collectRawExploreObservation({
        args,
        ctx,
        observations,
        candidateRegistry,
        onProgress,
      });
    }

    const reportText = renderFinalReport({
      args,
      intent,
      acceptedRef,
      observations,
    });
    onFinalized?.({
      usedFallback: acceptedRef.current === null,
      observationCount: observations.length,
    });
    return reportText;
  } catch (error) {
    logger.warn("explore_code sub-agent failed", error);
    if (acceptedRef.current || observations.length > 0) {
      const reportText = renderFinalReport({
        args,
        intent,
        acceptedRef,
        observations,
      });
      onFinalized?.({
        usedFallback: acceptedRef.current === null,
        observationCount: observations.length,
      });
      return reportText;
    }
    throw error;
  }
}

async function collectRawExploreObservation({
  args,
  ctx,
  observations,
  candidateRegistry,
  onProgress,
}: {
  args: ExploreCodeArgs;
  ctx: AgentContext;
  observations: SubagentObservation[];
  candidateRegistry: CandidateRegistry;
  onProgress?: (progressText: string) => void;
}): Promise<void> {
  const { effectiveArgs, rawResult } = await withReferencedAppRead(
    "explore_code",
    args,
    ctx,
    async (readCtx) => {
      const targetAppPath = resolveTargetAppPath(readCtx, args.app_name);
      const effectiveArgs = normalizeExploreCodeArgsForApp({
        appPath: targetAppPath,
        args,
      });
      const rawResult = await runRawExploreCode({
        appPath: targetAppPath,
        args: effectiveArgs,
      });
      return { effectiveArgs, rawResult };
    },
  );
  const resultText = formatRawExploreCodeResult(rawResult);
  const candidates = candidateRegistry.register(
    candidatesFromRawExploreCodeResult(rawResult),
  );
  pushObservation(
    observations,
    {
      toolName: "explore_code",
      args: effectiveArgs,
      result: annotateObservationResult(resultText, candidates),
      candidates,
      warnings: rawResult.notes.filter((note) => note.startsWith("Warning:")),
    },
    onProgress,
  );
}

function pushObservation(
  observations: SubagentObservation[],
  observation: SubagentObservation,
  onProgress?: (progressText: string) => void,
): void {
  observations.push(observation);
  onProgress?.(formatExploreProgressLog(observations));
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
  const warnings = [
    ...new Set(
      observations.flatMap((observation) => observation.warnings ?? []),
    ),
  ];
  if (accepted) {
    return buildReport({
      query: args.query,
      intent,
      resolved: accepted.resolved,
      outcome: accepted.outcome,
      warnings,
    });
  }
  return buildDeterministicReport({
    query: args.query,
    intent,
    observations,
    warnings,
  });
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
      if (usedCalls >= SUBAGENT_MAX_TOOL_CALLS) {
        return `Sub-agent read-only tool budget exhausted after ${SUBAGENT_MAX_TOOL_CALLS} calls. Do not call ${toolName} again; call submit_report with observed candidate IDs.`;
      }
      usedCalls += 1;
      return null;
    },
  };
}

function buildExploreCodeSubagentTools({
  args,
  ctx,
  durableTools,
  observations,
  candidateRegistry,
  readOnlyToolBudget,
  onProgress,
  onSubmitReport,
}: {
  args: ExploreCodeArgs;
  ctx: AgentContext;
  durableTools?: ToolSet;
  observations: SubagentObservation[];
  candidateRegistry: CandidateRegistry;
  readOnlyToolBudget: ReadOnlyToolBudget;
  onProgress?: (progressText: string) => void;
  onSubmitReport: (selection: ExploreSelection) => string;
}): ToolSet {
  if (durableTools) {
    return buildDurableExploreCodeSubagentTools({
      tools: durableTools,
      observations,
      candidateRegistry,
      readOnlyToolBudget,
      onProgress,
      onSubmitReport,
    });
  }

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
      onProgress,
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
      onProgress,
      candidatesFromResult: (toolArgs, result) =>
        candidatesFromGrepResult(String(result), toolArgs),
    }),
    read_file: wrapSubagentTool({
      tool: readFileTool,
      ctx: childCtx,
      observations,
      candidateRegistry,
      readOnlyToolBudget,
      onProgress,
      candidatesFromResult: (toolArgs, result) =>
        candidatesFromReadFileResult(String(result), toolArgs),
    }),
    explore_code: buildObservedExploreCodeTool({
      parentArgs: args,
      ctx: childCtx,
      observations,
      candidateRegistry,
      readOnlyToolBudget,
      onProgress,
    }),
    submit_report: {
      description:
        "Submit the final code exploration report. Summarize the grounded answer, reference observed candidate IDs only, and give each flow step an open role label and a fact tied to the query. Do not write quotes or choose an action — those are produced for you.",
      inputSchema: submitReportSchema,
      execute: async (selection: ExploreSelection) => {
        return onSubmitReport(selection);
      },
    },
  };
}

function buildDurableExploreCodeSubagentTools({
  tools,
  observations,
  candidateRegistry,
  readOnlyToolBudget,
  onProgress,
  onSubmitReport,
}: {
  tools: ToolSet;
  observations: SubagentObservation[];
  candidateRegistry: CandidateRegistry;
  readOnlyToolBudget: ReadOnlyToolBudget;
  onProgress?: (progressText: string) => void;
  onSubmitReport: (selection: ExploreSelection) => string;
}): ToolSet {
  const wrapped: ToolSet = {};
  const addTool = (
    toolName: string,
    candidatesFromResult: (
      args: unknown,
      result: string,
    ) => ExplorerCandidate[],
    compactBroadCall?: (args: unknown) => string | null,
  ) => {
    const tool = tools[toolName];
    if (!tool) return;
    wrapped[toolName] = wrapDurableSubagentTool({
      toolName,
      tool,
      observations,
      candidateRegistry,
      readOnlyToolBudget,
      onProgress,
      candidatesFromResult,
      compactBroadCall,
    });
  };

  addTool(
    "list_files",
    (args, result) => candidatesFromListFilesResult(result, args),
    compactBroadListFilesCall,
  );
  addTool("grep", (args, result) => candidatesFromGrepResult(result, args));
  addTool("read_file", (args, result) =>
    candidatesFromReadFileResult(result, args),
  );
  addTool("code_search", (args, result) =>
    candidatesFromListFilesResult(result, args),
  );
  addTool("explore_code", (_args, result) =>
    candidatesFromFormattedExploreCodeResult(result),
  );
  wrapped.submit_report = {
    description:
      "Submit the final code exploration report. Summarize the grounded answer, reference observed candidate IDs only, and give each flow step an open role label and a fact tied to the query. Do not write quotes or choose an action — those are produced for you.",
    inputSchema: submitReportSchema,
    execute: async (selection: ExploreSelection) => onSubmitReport(selection),
  };
  return wrapped;
}

function wrapDurableSubagentTool({
  toolName,
  tool,
  observations,
  candidateRegistry,
  readOnlyToolBudget,
  onProgress,
  candidatesFromResult,
  compactBroadCall,
}: {
  toolName: string;
  tool: ToolSet[string];
  observations: SubagentObservation[];
  candidateRegistry: CandidateRegistry;
  readOnlyToolBudget: ReadOnlyToolBudget;
  onProgress?: (progressText: string) => void;
  candidatesFromResult: (args: unknown, result: string) => ExplorerCandidate[];
  compactBroadCall?: (args: unknown) => string | null;
}) {
  return {
    description: tool.description,
    inputSchema: tool.inputSchema,
    execute: async (toolArgs: unknown, executionOptions?: unknown) => {
      const budgetMessage = readOnlyToolBudget.reserve(toolName);
      if (budgetMessage) {
        pushObservation(
          observations,
          { toolName, args: toolArgs, result: budgetMessage, candidates: [] },
          onProgress,
        );
        return budgetMessage;
      }
      const compactResult = compactBroadCall?.(toolArgs);
      if (compactResult) {
        pushObservation(
          observations,
          { toolName, args: toolArgs, result: compactResult, candidates: [] },
          onProgress,
        );
        return compactResult;
      }
      try {
        if (!tool.execute) throw new Error(`${toolName} is not executable`);
        const rawResult = await tool.execute(
          toolArgs,
          executionOptions as never,
        );
        const resultText = toolResultText(rawResult);
        const registeredCandidates = candidateRegistry.register(
          candidatesFromResult(toolArgs, resultText),
        );
        const annotatedResult = formatObservationResult(
          annotateObservationResult(resultText, registeredCandidates),
          observations,
        );
        pushObservation(
          observations,
          {
            toolName,
            args: toolArgs,
            result: annotatedResult,
            candidates: registeredCandidates,
          },
          onProgress,
        );
        return { type: "text" as const, value: annotatedResult };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        const errorResult = formatToolError(toolName, error);
        pushObservation(
          observations,
          { toolName, args: toolArgs, result: errorResult, candidates: [] },
          onProgress,
        );
        return { type: "text" as const, value: errorResult };
      }
    },
  };
}

function toolResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (
    result &&
    typeof result === "object" &&
    "type" in result &&
    result.type === "text" &&
    "value" in result &&
    typeof result.value === "string"
  ) {
    return result.value;
  }
  return JSON.stringify(result, null, 2);
}

function candidatesFromFormattedExploreCodeResult(
  result: string,
): ExplorerCandidate[] {
  const lines = result.split("\n");
  const queryTerms = getQueryTerms(
    /^## Code exploration:\s*(.*)$/m.exec(result)?.[1] ?? "",
  );
  const candidates: ExplorerCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^####\s+(.+?)(?:\s+-\s+(.*))?$/.exec(lines[index]);
    if (!heading) continue;
    const path = heading[1];
    const symbols = parseFormattedSymbols(heading[2]);
    let foundWindow = false;

    for (index += 1; index < lines.length; index += 1) {
      if (lines[index].startsWith("#### ")) {
        index -= 1;
        break;
      }
      const range = /^Lines\s+(\d+)-(\d+):$/.exec(lines[index]);
      if (!range || lines[index + 1] !== "```ts") continue;
      const sourceLines: string[] = [];
      index += 2;
      while (index < lines.length && lines[index] !== "```") {
        sourceLines.push(lines[index]);
        index += 1;
      }
      foundWindow = true;
      candidates.push(
        buildCandidate({
          path,
          range: { start: Number(range[1]), end: Number(range[2]) },
          symbols,
          source: "compiler",
          provenance: ["compiler-backed source window"],
          observedText: sourceLines.join("\n"),
          queryTerms,
        }),
      );
    }

    if (!foundWindow) {
      candidates.push(
        buildCandidate({
          path,
          range: null,
          symbols,
          source: "compiler",
          provenance: ["compiler-backed exploration result"],
          queryTerms,
        }),
      );
    }
  }

  return candidates;
}

function parseFormattedSymbols(
  summary: string | undefined,
): Array<{ name: string; kind: string; line: number }> {
  if (!summary) return [];
  return [...summary.matchAll(/(?:^|,\s*)(.+?)\s+\(([^:()]+):(\d+)\)/g)].map(
    (match) => ({
      name: match[1],
      kind: match[2],
      line: Number(match[3]),
    }),
  );
}

function buildObservedExploreCodeTool({
  parentArgs,
  ctx,
  observations,
  candidateRegistry,
  readOnlyToolBudget,
  onProgress,
}: {
  parentArgs: ExploreCodeArgs;
  ctx: AgentContext;
  observations: SubagentObservation[];
  candidateRegistry: CandidateRegistry;
  readOnlyToolBudget: ReadOnlyToolBudget;
  onProgress?: (progressText: string) => void;
}) {
  return {
    description:
      "Compiler-backed code explorer. Use this for TypeScript, TSX, JavaScript, or JSX symbols and flows included in the configured TypeScript project. It returns relevant symbols and line-numbered source windows grouped by file.",
    inputSchema: rawExploreCodeSchema,
    execute: async (toolArgs: RawExploreCodeArgs) => {
      const budgetMessage = readOnlyToolBudget.reserve("explore_code");
      if (budgetMessage) {
        pushObservation(
          observations,
          {
            toolName: "explore_code",
            args: toolArgs,
            result: budgetMessage,
            candidates: [],
          },
          onProgress,
        );
        return budgetMessage;
      }
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
        const { effectiveToolArgs, rawResult } = await withReferencedAppRead(
          "explore_code",
          lockedArgs,
          ctx,
          async (readCtx) => {
            const targetAppPath = resolveTargetAppPath(
              readCtx,
              lockedArgs.app_name,
            );
            const effectiveToolArgs = normalizeExploreCodeArgsForApp({
              appPath: targetAppPath,
              args: lockedArgs,
            });
            const rawResult = await runRawExploreCode({
              appPath: targetAppPath,
              args: effectiveToolArgs,
            });
            return { effectiveToolArgs, rawResult };
          },
        );
        const resultText = formatRawExploreCodeResult(rawResult);
        const candidates = candidateRegistry.register(
          candidatesFromRawExploreCodeResult(rawResult),
        );
        const annotatedResult = formatObservationResult(
          annotateObservationResult(resultText, candidates),
          observations,
        );
        pushObservation(
          observations,
          {
            toolName: "explore_code",
            args: effectiveToolArgs,
            result: annotatedResult,
            candidates,
            warnings: rawResult.notes.filter((note) =>
              note.startsWith("Warning:"),
            ),
          },
          onProgress,
        );
        return annotatedResult;
      } catch (error) {
        if (ctx.abortSignal?.aborted) {
          throw error;
        }
        const errorMessage = formatToolError("explore_code", error);
        pushObservation(
          observations,
          {
            toolName: "explore_code",
            args: toolArgs,
            result: errorMessage,
            candidates: [],
          },
          onProgress,
        );
        return errorMessage;
      }
    },
  };
}

function wrapSubagentTool<TArgs extends { app_name?: string }>({
  tool,
  ctx,
  observations,
  candidateRegistry,
  readOnlyToolBudget,
  onProgress,
  candidatesFromResult,
  compactBroadCall,
}: {
  tool: ToolDefinition<TArgs>;
  ctx: AgentContext;
  observations: SubagentObservation[];
  candidateRegistry: CandidateRegistry;
  readOnlyToolBudget: ReadOnlyToolBudget;
  onProgress?: (progressText: string) => void;
  candidatesFromResult: (args: TArgs, result: unknown) => ExplorerCandidate[];
  compactBroadCall?: (args: TArgs) => string | null;
}) {
  return {
    description: tool.description,
    inputSchema: tool.inputSchema,
    execute: async (toolArgs: TArgs) => {
      const budgetMessage = readOnlyToolBudget.reserve(tool.name);
      if (budgetMessage) {
        pushObservation(
          observations,
          {
            toolName: tool.name,
            args: toolArgs,
            result: budgetMessage,
            candidates: [],
          },
          onProgress,
        );
        return budgetMessage;
      }
      try {
        const compactResult = compactBroadCall?.(toolArgs);
        if (compactResult) {
          pushObservation(
            observations,
            {
              toolName: tool.name,
              args: toolArgs,
              result: compactResult,
              candidates: [],
            },
            onProgress,
          );
          return compactResult;
        }

        const result = await withReferencedAppRead(
          tool.name,
          toolArgs,
          ctx,
          (readCtx) => tool.execute(toolArgs, readCtx),
        );
        const resultText =
          typeof result === "string" ? result : JSON.stringify(result, null, 2);
        const registeredCandidates = candidateRegistry.register(
          candidatesFromResult(toolArgs, result),
        );
        const annotatedResult = formatObservationResult(
          annotateObservationResult(resultText, registeredCandidates),
          observations,
        );
        pushObservation(
          observations,
          {
            toolName: tool.name,
            args: toolArgs,
            result: annotatedResult,
            candidates: registeredCandidates,
          },
          onProgress,
        );
        // Always return the annotated string the observation log recorded. For
        // non-string tool output (e.g. structured list_files results) returning
        // the raw object would hand the model a result with no candidate-ID
        // annotations, breaking the candidate-selection contract.
        return annotatedResult;
      } catch (error) {
        if (ctx.abortSignal?.aborted) {
          throw error;
        }
        const errorMessage = formatToolError(tool.name, error);
        pushObservation(
          observations,
          {
            toolName: tool.name,
            args: toolArgs,
            result: errorMessage,
            candidates: [],
          },
          onProgress,
        );
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
  stepCount,
  exploreCodeAvailable = true,
}: {
  messages: ModelMessage[];
  observations: SubagentObservation[];
  acceptedRef: { current: AcceptedReport | null };
  stepCount: number;
  exploreCodeAvailable?: boolean;
}) {
  let forcedStep: ReturnType<
    typeof forceExploreCodeStep | typeof forceSubmitReportStep
  > | null = null;

  // First step must use the compiler-backed explorer.
  if (observations.length === 0 && exploreCodeAvailable) {
    forcedStep = forceExploreCodeStep();
  } else if (
    // Last allowed step with nothing accepted yet: force a report so we get
    // the model's own candidate selection instead of the heuristic fallback.
    !acceptedRef.current &&
    stepCount >= SUBAGENT_MAX_STEPS
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
