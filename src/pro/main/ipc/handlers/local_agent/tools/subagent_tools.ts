import { z } from "zod";

import { db } from "@/db";
import { agentThreads } from "@/db/schema";
import { eq } from "drizzle-orm";
import { buildAgentToolSet } from "../tool_definitions";
import {
  cancelSubagent,
  followupSubagent,
  listSubagents,
  sendSubagentMessage,
  spawnModelSubagent,
} from "../subagents/subagent_manager";
import type { AgentContext, ToolDefinition } from "./types";

const baseSpawnShape = {
  task_name: z.string().min(1).describe("A stable short name for this task"),
  assignment: z
    .string()
    .min(1)
    .describe("A bounded assignment and intended outcome"),
  scope: z
    .array(z.string())
    .default([])
    .describe("Explicit relative paths or path prefixes in scope"),
};

const spawnFallbackSchema = z.object({
  persona: z.enum(["explorer", "implementer"]),
  ...baseSpawnShape,
});

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
  usesEngineEndpoint: true,
  isEnabled: (ctx) =>
    Boolean(
      ctx.isDyadPro &&
      (ctx.canUseExplorerSubagent || ctx.canUseImplementerSubagent) &&
      !ctx.subagentThreadId,
    ),
  execute: async (args, ctx) => {
    const allowlist =
      args.persona === "explorer"
        ? ["read_file", "list_files", "grep", "code_search"]
        : ["read_file", "list_files", "grep", "write_file", "search_replace"];
    const threadId = await spawnModelSubagent({
      ctx,
      persona: args.persona,
      taskName: args.task_name,
      assignment: args.assignment,
      scope: args.scope,
      buildTools: (threadId) => {
        const childCtx: AgentContext = {
          ...ctx,
          subagentThreadId: threadId,
          subagentPersona: args.persona,
          subagentPathScope: args.scope,
          canUseExplorerSubagent: false,
          canUseImplementerSubagent: false,
          referencedApps: new Map(ctx.referencedApps),
          todos: [],
          fileEditTracker: Object.create(null),
          onXmlStream: () => {},
          onXmlComplete: () => {},
        };
        const allTools = buildAgentToolSet(childCtx, {
          readOnly: args.persona === "explorer",
          enableAppBlueprint: false,
        });
        return Object.fromEntries(
          Object.entries(allTools).filter(([name]) => allowlist.includes(name)),
        );
      },
    });
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
  isEnabled: (ctx) => Boolean(ctx.isDyadPro && !ctx.subagentThreadId),
  execute: async (args) => {
    while (true) {
      const rows = await Promise.all(
        args.thread_ids.map((id) =>
          db.query.agentThreads.findFirst({ where: eq(agentThreads.id, id) }),
        ),
      );
      if (
        rows.every(
          (row) =>
            row &&
            !["queued", "running", "waiting_for_writer"].includes(row.status),
        )
      )
        return JSON.stringify(rows);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  },
};

export const cancelAgentTool: ToolDefinition<{ thread_id: string }> = {
  name: "cancel_agent",
  description: "Cancel a running sub-agent at its next safe boundary.",
  inputSchema: z.object({ thread_id: z.string() }),
  defaultConsent: "always",
  isEnabled: (ctx) => Boolean(ctx.isDyadPro && !ctx.subagentThreadId),
  execute: async (args) => {
    await cancelSubagent(args.thread_id);
    return "Cancellation requested.";
  },
};

const messageSchema = z.object({
  thread_id: z.string(),
  message: z.string().min(1),
});

export const sendMessageTool: ToolDefinition<z.infer<typeof messageSchema>> = {
  name: "send_message",
  description: "Durably queue a message for an existing sub-agent thread.",
  inputSchema: messageSchema,
  defaultConsent: "always",
  isEnabled: (ctx) => Boolean(ctx.isDyadPro && !ctx.subagentThreadId),
  execute: async (args) => {
    await sendSubagentMessage(args.thread_id, args.message);
    return "Message queued durably.";
  },
};

export const followupTaskTool: ToolDefinition<z.infer<typeof messageSchema>> = {
  ...sendMessageTool,
  name: "followup_task",
  description:
    "Queue a durable follow-up assignment on an existing child thread. An idle child will consume it on its next turn.",
  execute: async (args) => {
    await followupSubagent(args.thread_id, args.message);
    return "Follow-up queued durably.";
  },
};
