/**
 * A2A (Agent-to-Agent) → ToolDefinition Adapter
 *
 * Lets the local swarm hire remote agents from the decentralized A2A network.
 * Exposes search / createTask / getTask / completeTask as agent tools.
 */

import { z } from "zod";
import { a2aProtocolService } from "@/lib/a2a_protocol_service";
import type { ToolDefinition } from "./types";

const a2aSearchAgentsTool: ToolDefinition = {
  name: "a2a_search_agents",
  description:
    "Discover remote agents on the A2A network by capability, category, price, or reputation.",
  inputSchema: z.object({
    query: z.string().optional(),
    categories: z.array(z.string()).optional(),
    onlineOnly: z.boolean().optional().default(true),
    minReputation: z.number().optional(),
    limit: z.number().int().min(1).max(50).optional().default(10),
  }),
  defaultConsent: "always",
  execute: async (args) => {
    const result = await a2aProtocolService.searchAgents({
      query: args.query,
      categories: args.categories as never,
      onlineOnly: args.onlineOnly,
      minReputation: args.minReputation,
      limit: args.limit,
    });
    return JSON.stringify(
      {
        total: result.total,
        agents: result.agents.map((a) => ({
          id: a.card.id,
          name: a.card.name,
          description: a.card.description,
          reputation: a.card.reputationScore,
          categories: a.categories,
        })),
      },
      null,
      2,
    );
  },
};

const a2aCreateTaskTool: ToolDefinition = {
  name: "a2a_create_task",
  description:
    "Create a task to be executed by a remote agent on the A2A network. Returns the task id.",
  inputSchema: z.object({
    requesterId: z.string().describe("DID of the local agent acting as requester"),
    executorId: z.string().describe("DID of the remote agent that will execute the task"),
    capabilityId: z.string(),
    input: z.record(z.unknown()),
    maxBudget: z.string().optional(),
    currency: z.string().optional().default("JOY"),
  }),
  defaultConsent: "ask",
  getConsentPreview: (args) => `a2a_create_task(executor=${args.executorId}, cap=${args.capabilityId})`,
  execute: async (args) => {
    const task = await a2aProtocolService.createTask(
      args.requesterId,
      args.executorId,
      args.capabilityId,
      args.input,
      { maxBudget: args.maxBudget, currency: args.currency },
    );
    return JSON.stringify({ taskId: task.id, status: task.status });
  },
};

const a2aGetTaskTool: ToolDefinition = {
  name: "a2a_get_task",
  description: "Retrieve the current status, progress, and output of an A2A task.",
  inputSchema: z.object({ taskId: z.string() }),
  defaultConsent: "always",
  execute: async (args) => {
    const task = await a2aProtocolService.getTask(args.taskId);
    if (!task) throw new Error(`A2A task not found: ${args.taskId}`);
    return JSON.stringify({
      id: task.id,
      status: task.status,
      progress: task.progress,
      output: task.output,
      paymentStatus: task.paymentStatus,
    });
  },
};

export const A2A_AGENT_TOOLS: readonly ToolDefinition[] = [
  a2aSearchAgentsTool,
  a2aCreateTaskTool,
  a2aGetTaskTool,
];

export function getA2aAgentToolNames(): string[] {
  return A2A_AGENT_TOOLS.map((t) => t.name);
}
