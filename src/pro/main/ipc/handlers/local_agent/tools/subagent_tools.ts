import { z } from "zod";
import type { ToolSet } from "ai";

import { buildAgentToolSet } from "../tool_definitions";
import {
  cancelSubagent,
  followupSubagent,
  listSubagents,
  sendSubagentMessage,
  spawnModelSubagent,
  waitForSubagents,
} from "../subagents/subagent_manager";
import type { AgentContext, ToolDefinition } from "./types";
import {
  formatRawExploreCodeResult,
  normalizeExploreCodeArgsForApp,
  rawExploreCodeSchema,
  runRawExploreCode,
} from "./explore_code_raw";
import { resolveTargetAppPath } from "./resolve_app_context";
import { getExploreCodeAvailability } from "./explore_code";

const baseSpawnShape = {
  task_name: z
    .string()
    .min(1)
    .max(100)
    .describe("A stable short name for this task"),
  assignment: z
    .string()
    .min(1)
    .max(20_000)
    .describe("A bounded assignment and intended outcome"),
  scope: z
    .array(z.string().min(1).max(500))
    .max(100)
    .default([])
    .describe("Explicit relative paths or path prefixes in scope"),
};

const spawnFallbackSchema = z.object({
  persona: z.enum(["explorer", "implementer"]),
  ...baseSpawnShape,
});

function buildSubagentToolSet(params: {
  ctx: AgentContext;
  threadId: string;
  persona: "explorer" | "implementer";
  scope: string[];
}): ToolSet {
  const { ctx, threadId, persona, scope } = params;
  const allowlist =
    persona === "explorer"
      ? ["read_file", "list_files", "grep", "code_search", "compiler_explore"]
      : ["read_file", "list_files", "grep", "write_file", "search_replace"];
  const childCtx: AgentContext = {
    ...ctx,
    subagentThreadId: threadId,
    subagentPersona: persona,
    subagentPathScope: scope,
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
    canUseExplorerSubagent: false,
    canUseImplementerSubagent: false,
    referencedApps: new Map(ctx.referencedApps),
    todos: [],
    fileEditTracker: ctx.fileEditTracker,
    onXmlStream: () => {},
    onXmlComplete: () => {},
  };
  const allTools = buildAgentToolSet(childCtx, {
    readOnly: persona === "explorer",
    enableAppBlueprint: ctx.enableAppBlueprint,
  });
  return Object.fromEntries(
    Object.entries(allTools).filter(([name]) => allowlist.includes(name)),
  );
}

export const spawnAgentTool: ToolDefinition<
  z.infer<typeof spawnFallbackSchema>
> = {
  name: "spawn_agent",
  description:
    "Start an asynchronous depth-one Explorer or enabled Implementer sub-agent. Reviewer is user/application controlled and is never available here.",
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
  subagentOnly: true,
  requiresMutationLease: false,
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
      buildTools: (threadId) =>
        buildSubagentToolSet({
          ctx,
          threadId,
          persona: args.persona,
          scope: args.scope,
        }),
    });
    ctx.spawnedSubagentThreadIds ??= [];
    ctx.spawnedSubagentThreadIds.push(threadId);
    if (args.persona === "implementer") {
      ctx.spawnedImplementerThreadIds ??= [];
      ctx.spawnedImplementerThreadIds.push(threadId);
    }
    return `Started ${args.persona} sub-agent ${threadId}. Use list_agents or wait_agents to inspect it.`;
  },
};

const threadIdsSchema = z.object({ thread_ids: z.array(z.string()).min(1) });

export const listAgentsTool: ToolDefinition<{}> = {
  name: "list_agents",
  description:
    "List durable sub-agent threads and their current status for this chat.",
  inputSchema: z.object({}),
  defaultConsent: "always",
  subagentOnly: true,
  isEnabled: (ctx) => Boolean(ctx.isDyadPro && !ctx.subagentThreadId),
  execute: async (_args, ctx) =>
    JSON.stringify(await listSubagents(ctx.chatId)),
};

export const waitAgentsTool: ToolDefinition<z.infer<typeof threadIdsSchema>> = {
  name: "wait_agents",
  description:
    "Wait until all specified sub-agents reach a terminal or idle state.",
  inputSchema: threadIdsSchema,
  defaultConsent: "always",
  subagentOnly: true,
  isEnabled: (ctx) => Boolean(ctx.isDyadPro && !ctx.subagentThreadId),
  execute: async (args, ctx) =>
    JSON.stringify(
      await waitForSubagents(ctx.chatId, args.thread_ids, ctx.abortSignal),
    ),
};

export const cancelAgentTool: ToolDefinition<{ thread_id: string }> = {
  name: "cancel_agent",
  description: "Cancel a running sub-agent at its next safe boundary.",
  inputSchema: z.object({ thread_id: z.string() }),
  defaultConsent: "always",
  modifiesState: true,
  subagentOnly: true,
  requiresMutationLease: false,
  isEnabled: (ctx) => Boolean(ctx.isDyadPro && !ctx.subagentThreadId),
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
  isEnabled: (ctx) => Boolean(ctx.isDyadPro && !ctx.subagentThreadId),
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
  execute: async (args, ctx) => {
    const persona = await followupSubagent(
      ctx.chatId,
      args.thread_id,
      args.message,
      {
        ctx,
        buildTools: (threadId, childPersona, scope) =>
          buildSubagentToolSet({
            ctx,
            threadId,
            persona: childPersona,
            scope,
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

export const compilerExploreTool: ToolDefinition<
  z.infer<typeof rawExploreCodeSchema>
> = {
  name: "compiler_explore",
  description:
    "Explore the configured TypeScript project using compiler-backed symbol and dependency analysis.",
  inputSchema: rawExploreCodeSchema,
  defaultConsent: "always",
  subagentOnly: true,
  isEnabled: (ctx) =>
    ctx.subagentPersona === "explorer" &&
    getExploreCodeAvailability(ctx).enabled,
  execute: async (args, ctx) => {
    const appPath = resolveTargetAppPath(ctx, args.app_name);
    const effectiveArgs = normalizeExploreCodeArgsForApp({ appPath, args });
    return formatRawExploreCodeResult(
      await runRawExploreCode({ appPath, args: effectiveArgs }),
    );
  },
};
