import { z } from "zod";
import type { ToolSet } from "ai";
import type { SubagentThreadSummary } from "@/ipc/types";

import { buildAgentToolSet, type AgentToolName } from "../tool_definitions";
import {
  cancelSubagent,
  followupSubagent,
  listSubagents,
  sendSubagentMessage,
  spawnModelSubagent,
  updateSubagentActivity,
  waitForSubagents,
} from "../subagents/subagent_manager";
import { normalizeMutationScope } from "../subagents/mutation_lease";
import {
  escapeXmlAttr,
  escapeXmlContent,
  type AgentContext,
  type ToolDefinition,
} from "./types";
import {
  formatRawExploreCodeResult,
  normalizeExploreCodeArgsForApp,
  rawExploreCodeSchema,
  runRawExploreCode,
} from "./explore_code_raw";
import { resolveTargetAppPath } from "./resolve_app_context";
import {
  getExploreCodeAvailability,
  getExploreCodeAvailabilityForAppPath,
} from "./explore_code";

const baseSpawnShape = {
  task_name: z
    .string()
    .min(1)
    .max(100)
    .describe("A stable short name for this task"),
  assignment: z.string().min(1).max(20_000).describe(
    // Restating the form here puts the reminder at the moment the call is
    // composed, which is where assignments lose their MUST HOLD content.
    "The assignment. For implementer tasks use the form GOAL / MUST HOLD / OUT OF SCOPE / DONE WHEN, where MUST HOLD lists every project rule the change could touch (access, scoping, invariants) or explains why none apply.",
  ),
  scope: z
    .array(z.string().min(1).max(500))
    .max(100)
    .default([])
    .describe(
      "Advisory relative paths or path prefixes expected to be in scope",
    ),
};

const spawnFallbackSchema = z.object({
  persona: z.enum(["explorer", "implementer"]),
  ...baseSpawnShape,
});

interface SubagentToolContextParams {
  ctx: AgentContext;
  threadId: string;
  persona: "explorer" | "implementer";
  taskName: string;
  scope: string[];
  abortSignal: AbortSignal;
}

export function buildSubagentContext(
  params: SubagentToolContextParams,
): AgentContext {
  const { ctx, threadId, persona, taskName, scope, abortSignal } = params;
  return {
    ...ctx,
    subagentThreadId: threadId,
    subagentPersona: persona,
    subagentPathScope: scope.map(normalizeMutationScope),
    abortSignal,
    onWorkspaceMutation: (didMutateFile) => {
      ctx.mutationCount = (ctx.mutationCount ?? 0) + 1;
      if (didMutateFile) {
        ctx.fileMutationCount = (ctx.fileMutationCount ?? 0) + 1;
      }
      ctx.workspaceMutated = true;
      ctx.onWorkspaceMutation?.(didMutateFile);
    },
    requireConsent: (consent) =>
      ctx.requireConsent({
        ...consent,
        abortSignal,
        subagent: { threadId, persona, taskName },
      }),
    allowDeploySideEffects: false,
    onSharedServerModuleChange: (relativePath) => {
      ctx.isSharedModulesChanged = true;
      if (!ctx.sharedServerModulePaths.includes(relativePath)) {
        ctx.sharedServerModulePaths.push(relativePath);
      }
    },
    onDeferredFunctionDeploy: (functionName) => {
      if (!ctx.pendingFunctionDeploys.includes(functionName)) {
        ctx.pendingFunctionDeploys.push(functionName);
      }
    },
    onDeferredFunctionDelete: (functionName) => {
      ctx.pendingFunctionDeletes ??= [];
      if (!ctx.pendingFunctionDeletes.includes(functionName)) {
        ctx.pendingFunctionDeletes.push(functionName);
      }
    },
    canUseExplorerSubagent: false,
    canUseImplementerSubagent: false,
    canUseAdvancedSubagentTools: false,
    referencedApps: new Map(ctx.referencedApps),
    todos: [],
    fileEditTracker: ctx.fileEditTracker,
    onXmlStream: () => {},
    onXmlComplete: () => {},
    onToolActivity: (activity) =>
      updateSubagentActivity({
        chatId: ctx.chatId,
        threadId,
        ...activity,
      }),
  };
}

/**
 * Child capabilities are explicit and fail closed: adding a new root tool does
 * not silently grant it to every sub-agent. This intentionally excludes MCP
 * discovery/execution, sandbox scripts, nested agents/history explorers, and
 * root-owned provider or application configuration side effects.
 */
const SUBAGENT_ALLOWED_TOOLS = new Set<AgentToolName>([
  "read_file",
  "list_files",
  "grep",
  "code_search",
  "search_chats",
  "read_chat",
  "explore_code",
  "write_file",
  "search_replace",
  "copy_file",
  "delete_file",
  "rename_file",
  "git_status",
  "git_diff",
  "git_log",
  "git_show_commit",
  "git_show_file",
  "git_restore_file",
  "get_supabase_project_info",
  "get_neon_project_info",
  "get_database_table_schema",
  "read_logs",
  "run_type_checks",
  "run_build",
  "run_tests",
  "restart_app",
  "read_guide",
  "web_search",
  "web_crawl",
  "web_fetch",
]);

export function buildSubagentToolSet(
  params: SubagentToolContextParams,
): ToolSet {
  const { ctx, persona } = params;
  const childCtx = buildSubagentContext(params);
  const allTools = buildAgentToolSet(childCtx, {
    readOnly: persona === "explorer",
    enableAppBlueprint: ctx.enableAppBlueprint,
    freeModelMode: ctx.freeModelMode,
  });
  return Object.fromEntries(
    Object.entries(allTools).filter(([name]) =>
      SUBAGENT_ALLOWED_TOOLS.has(name),
    ),
  );
}

export const spawnAgentTool: ToolDefinition<
  z.infer<typeof spawnFallbackSchema>
> = {
  name: "spawn_agent",
  description:
    "Run a blocking depth-one Explorer or enabled Implementer sub-agent. The sub-agent returns its report before the tool call completes. Reviewer is user/application controlled and is never available here.",
  inputSchema: spawnFallbackSchema,
  getInputSchema: (ctx) => {
    const personas = [
      ...(ctx.canUseExplorerSubagent ? ["explorer" as const] : []),
      ...(ctx.canUseImplementerSubagent ? ["implementer" as const] : []),
    ];
    if (personas.length === 0) return spawnFallbackSchema;
    return z.object({
      persona:
        personas.length === 1
          ? z.literal(personas[0])
          : z.enum(
              personas as [
                "explorer" | "implementer",
                ...("explorer" | "implementer")[],
              ],
            ),
      ...baseSpawnShape,
    });
  },
  defaultConsent: "always",
  modifiesState: true,
  // Explorer only reads the app, so Ask and Plan may create its durable
  // orchestration record when the turn-scoped schema excludes Implementer.
  allowInReadOnlyModes: (ctx) => ctx.canUseImplementerSubagent !== true,
  subagentOnly: true,
  requiresMutationLease: false,
  requiresBlueprintApproval: false,
  usesEngineEndpoint: true,
  isEnabled: (ctx) =>
    Boolean(
      ctx.isDyadPro &&
      (ctx.canUseExplorerSubagent || ctx.canUseImplementerSubagent) &&
      !ctx.subagentThreadId,
    ),
  execute: async (args, ctx) => {
    const threadId = await spawnModelSubagent({
      ctx,
      persona: args.persona,
      taskName: args.task_name,
      assignment: args.assignment,
      scope: args.scope,
      buildTools: (child) =>
        buildSubagentToolSet({
          ctx,
          ...child,
        }),
    });
    ctx.spawnedSubagentThreadIds ??= [];
    ctx.spawnedSubagentThreadIds.push(threadId);
    if (args.persona === "implementer") {
      ctx.spawnedImplementerThreadIds ??= [];
      ctx.spawnedImplementerThreadIds.push(threadId);
    }
    ctx.onXmlComplete(
      `<dyad-subagent chat-id="${escapeXmlAttr(String(ctx.chatId))}" thread-id="${escapeXmlAttr(threadId)}" persona="${escapeXmlAttr(args.persona)}" task-name="${escapeXmlAttr(args.task_name)}"></dyad-subagent>`,
    );
    let subagent: SubagentThreadSummary;
    try {
      [subagent] = await waitForSubagents(
        ctx.chatId,
        [threadId],
        ctx.abortSignal,
      );
    } catch (error) {
      try {
        await cancelSubagent(ctx.chatId, threadId);
      } catch (cancellationError) {
        // Keep the thread registered so the end-of-turn barrier remains
        // fail-closed when cancellation itself did not complete.
        throw new AggregateError(
          [error, cancellationError],
          "The sub-agent wait and cancellation both failed.",
        );
      }
      // This tool has now taken responsibility for the thread: it cancelled it
      // and is about to report the failure to the model, which can retry or work
      // around it. Leaving the id in spawnedImplementerThreadIds would hand the
      // end-of-turn join barrier a thread that is permanently "cancelled", and
      // that barrier treats any non-completed Implementer as fatal — so a
      // transient wait failure here would kill the whole turn at the very end,
      // discarding milestones the agent had already finished by other means.
      const implementers = ctx.spawnedImplementerThreadIds;
      if (implementers) {
        const at = implementers.indexOf(threadId);
        if (at >= 0) implementers.splice(at, 1);
      }
      const spawned = ctx.spawnedSubagentThreadIds;
      if (spawned) {
        const at = spawned.indexOf(threadId);
        if (at >= 0) spawned.splice(at, 1);
      }
      throw error;
    }
    if (args.persona === "explorer") {
      ctx.deliveredExplorerThreadIds ??= [];
      if (!ctx.deliveredExplorerThreadIds.includes(threadId)) {
        ctx.deliveredExplorerThreadIds.push(threadId);
      }
    }
    return JSON.stringify({
      threadId: subagent.id,
      status: subagent.status,
      report:
        typeof subagent.result?.report === "string"
          ? subagent.result.report
          : null,
      error: subagent.error,
    });
  },
};

const threadIdsSchema = z.object({ thread_ids: z.array(z.string()).min(1) });

function canUseAdvancedSubagentTools(ctx: AgentContext): boolean {
  return Boolean(
    ctx.isDyadPro && ctx.canUseAdvancedSubagentTools && !ctx.subagentThreadId,
  );
}

export const listAgentsTool: ToolDefinition<{}> = {
  name: "list_agents",
  description:
    "List durable sub-agent threads and their current status for this chat.",
  inputSchema: z.object({}),
  defaultConsent: "always",
  subagentOnly: true,
  isEnabled: canUseAdvancedSubagentTools,
  execute: async (_args, ctx) =>
    JSON.stringify(await listSubagents(ctx.chatId)),
};

export const waitAgentsTool: ToolDefinition<z.infer<typeof threadIdsSchema>> = {
  name: "wait_agents",
  description:
    "Wait until all specified sub-agents reach a terminal or idle state.",
  inputSchema: threadIdsSchema,
  defaultConsent: "always",
  modifiesState: true,
  subagentOnly: true,
  requiresMutationLease: false,
  requiresBlueprintApproval: false,
  isEnabled: canUseAdvancedSubagentTools,
  execute: async (args, ctx) => {
    const summaries = await waitForSubagents(
      ctx.chatId,
      args.thread_ids,
      ctx.abortSignal,
    );
    return JSON.stringify(summaries);
  },
};

export const cancelAgentTool: ToolDefinition<{ thread_id: string }> = {
  name: "cancel_agent",
  description: "Cancel a running sub-agent at its next safe boundary.",
  inputSchema: z.object({ thread_id: z.string() }),
  defaultConsent: "always",
  modifiesState: true,
  subagentOnly: true,
  requiresMutationLease: false,
  requiresBlueprintApproval: false,
  isEnabled: canUseAdvancedSubagentTools,
  execute: async (args, ctx) => {
    await cancelSubagent(ctx.chatId, args.thread_id);
    return "Cancellation requested.";
  },
};

const messageSchema = z.object({
  thread_id: z.string(),
  message: z.string().min(1).max(20_000),
});

export const sendMessageTool: ToolDefinition<z.infer<typeof messageSchema>> = {
  name: "send_message",
  description: "Durably queue a message for an existing sub-agent thread.",
  inputSchema: messageSchema,
  defaultConsent: "always",
  modifiesState: true,
  subagentOnly: true,
  requiresMutationLease: false,
  requiresBlueprintApproval: false,
  isEnabled: canUseAdvancedSubagentTools,
  execute: async (args, ctx) => {
    await sendSubagentMessage(ctx.chatId, args.thread_id, args.message);
    return "Message queued durably.";
  },
};

export const followupTaskTool: ToolDefinition<z.infer<typeof messageSchema>> = {
  ...sendMessageTool,
  name: "followup_task",
  description:
    "Queue a durable follow-up assignment on an existing child thread. An idle child will consume it on its next turn.",
  subagentOnly: true,
  requiresMutationLease: false,
  requiresBlueprintApproval: false,
  usesEngineEndpoint: true,
  execute: async (args, ctx) => {
    const persona = await followupSubagent(
      ctx.chatId,
      args.thread_id,
      args.message,
      {
        ctx,
        buildTools: (child) =>
          buildSubagentToolSet({
            ctx,
            ...child,
          }),
      },
    );
    ctx.spawnedSubagentThreadIds ??= [];
    if (!ctx.spawnedSubagentThreadIds.includes(args.thread_id)) {
      ctx.spawnedSubagentThreadIds.push(args.thread_id);
    }
    if (persona === "implementer") {
      ctx.spawnedImplementerThreadIds ??= [];
      if (!ctx.spawnedImplementerThreadIds.includes(args.thread_id)) {
        ctx.spawnedImplementerThreadIds.push(args.thread_id);
      }
    }
    return "Follow-up queued durably.";
  },
};

export const exploreCodeTool: ToolDefinition<
  z.infer<typeof rawExploreCodeSchema>
> = {
  name: "explore_code",
  description:
    "Explore the configured TypeScript project using compiler-backed symbol and dependency analysis. Returns relevant symbols and line-numbered source windows grouped by file.",
  inputSchema: rawExploreCodeSchema,
  defaultConsent: "always",
  subagentOnly: true,
  isEnabled: (ctx) =>
    ctx.subagentPersona === "explorer" &&
    (getExploreCodeAvailability(ctx).enabled ||
      [...ctx.referencedApps.values()].some(
        (appPath) => getExploreCodeAvailabilityForAppPath(ctx, appPath).enabled,
      )),
  buildXml: (args, isComplete) => {
    if (!args.query || isComplete) return undefined;
    return `<dyad-explore-code${buildExploreCodeAttributes(args)}>Exploring...`;
  },
  execute: async (args, ctx) => {
    const appPath = resolveTargetAppPath(ctx, args.app_name);
    const availability = getExploreCodeAvailabilityForAppPath(ctx, appPath);
    const effectiveArgs = normalizeExploreCodeArgsForApp({
      appPath,
      args,
      fallbackTsconfigPath: availability.tsconfigPath,
    });
    const result = await runRawExploreCode({ appPath, args: effectiveArgs });
    const resultText = formatRawExploreCodeResult(result);
    const attributes = buildExploreCodeAttributes(effectiveArgs, {
      files: result.files.length,
      symbols: result.totalSymbols,
      indexMs: result.indexMs,
      searchMs: result.searchMs,
      truncated: result.truncated,
    });
    ctx.onXmlComplete(
      `<dyad-explore-code${attributes}>\n${escapeXmlContent(resultText)}\n</dyad-explore-code>`,
    );
    return resultText;
  },
};

function buildExploreCodeAttributes(
  args: Partial<z.infer<typeof rawExploreCodeSchema>>,
  result?: {
    files: number;
    symbols: number;
    indexMs: number;
    searchMs: number;
    truncated: boolean;
  },
): string {
  const attributes: string[] = [];
  if (args.query) attributes.push(`query="${escapeXmlAttr(args.query)}"`);
  if (args.app_name)
    attributes.push(`app_name="${escapeXmlAttr(args.app_name)}"`);
  if (args.tsconfig_path) {
    attributes.push(`tsconfig_path="${escapeXmlAttr(args.tsconfig_path)}"`);
  }
  if (result) {
    attributes.push(`files="${result.files}"`);
    attributes.push(`symbols="${result.symbols}"`);
    attributes.push(`index_ms="${result.indexMs}"`);
    attributes.push(`search_ms="${result.searchMs}"`);
    if (result.truncated) attributes.push('truncated="true"');
  }
  return attributes.length > 0 ? ` ${attributes.join(" ")}` : "";
}
