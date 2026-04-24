/**
 * Swarm Orchestration Tools
 *
 * These tools turn a swarm agent into a true coordinator: it can create
 * subordinate swarms, spawn typed subagents (workers/specialists/scouts),
 * delegate tasks, query swarm-shared knowledge, deposit findings into the
 * collective memory, and trigger n8n workflows that compose new tools.
 *
 * The "primary agent → spawn subagents → use scraped knowledge → execute
 * workflow-built tools" loop is exactly what the user asked for.
 *
 * Identity: each tool reads the calling agent's swarm/agent ids from the
 * `swarm_call_context` side-channel set by the swarm runtime before each
 * tool invocation.
 */

import { z } from "zod";
import log from "electron-log";
import { ToolDefinition } from "./types";
import { getAgentSwarm, type AgentRole, type SwarmId, type AgentNodeId, type KnowledgeType } from "@/lib/agent_swarm";
import { requireSwarmCallContext } from "@/lib/swarm_call_context";
import { getOpenClawN8nBridge } from "@/lib/openclaw_n8n_bridge";

const logger = log.scope("swarm_orchestration_tools");

const AGENT_ROLES: readonly AgentRole[] = [
  "coordinator",
  "worker",
  "specialist",
  "scout",
  "synthesizer",
  "validator",
  "witness",
  "replicator",
] as const;

const KNOWLEDGE_TYPES: readonly KnowledgeType[] = [
  "learned_pattern",
  "best_practice",
  "error_recovery",
  "optimization",
  "domain_expertise",
  "tool_usage",
  "user_preference",
] as const;

// ─── 1. swarm_spawn_subagent ───────────────────────────────────────────────

const spawnSchema = z.object({
  name: z.string().min(1).describe("Human-readable subagent name"),
  role: z.enum(AGENT_ROLES as readonly [AgentRole, ...AgentRole[]]),
  systemPrompt: z.string().optional().describe("Override system prompt"),
  tools: z
    .array(z.string())
    .optional()
    .describe(
      "Whitelist of tool names this subagent may use (e.g. ['email_search','web_scraper']). Empty means inherit defaults.",
    ),
  initialTask: z
    .object({
      type: z
        .enum([
          "code",
          "research",
          "analysis",
          "synthesis",
          "validation",
          "coordination",
          "learning",
          "custom",
        ])
        .default("custom"),
      description: z.string(),
      input: z.unknown().optional(),
      priority: z.number().int().min(0).max(10).default(1),
    })
    .optional()
    .describe("Optional task to assign on spawn"),
  start: z.boolean().default(true).describe("Start the subagent immediately"),
});

export const swarmSpawnSubagentTool: ToolDefinition<z.infer<typeof spawnSchema>> = {
  name: "swarm_spawn_subagent",
  description:
    "Spawn a child agent inside the current swarm to handle a specialized task. The new agent inherits the swarm but gets its own role, system prompt, and tool whitelist. Returns the new agent id.",
  inputSchema: spawnSchema,
  defaultConsent: "always",
  getConsentPreview: (a) => `Spawn ${a.role} subagent "${a.name}"`,

  execute: async (args) => {
    const { swarmId, callerAgentId } = requireSwarmCallContext();
    const swarm = getAgentSwarm();

    const initialTask = args.initialTask
      ? {
          type: args.initialTask.type,
          description: args.initialTask.description,
          input: args.initialTask.input,
          priority: args.initialTask.priority,
          assignedBy: callerAgentId,
          // assignTask fills in id/status/createdAt
        }
      : undefined;

    const child = await swarm.spawnAgent(
      swarmId,
      {
        name: args.name,
        role: args.role,
        config: {
          systemPrompt: args.systemPrompt ?? "",
          tools: args.tools ?? [],
        },
        initialTask: initialTask as any,
      },
      callerAgentId,
    );

    if (args.start) {
      await swarm.startAgent(child.id);
    }

    logger.info(
      `Agent ${callerAgentId} spawned ${args.role} subagent ${child.id} (${args.name})`,
    );
    return [
      `Spawned subagent:`,
      `  id:    ${child.id}`,
      `  name:  ${child.name}`,
      `  role:  ${child.role}`,
      `  tools: ${child.config.tools.join(", ") || "(default set)"}`,
      `  state: ${args.start ? "running" : "idle"}`,
      args.initialTask
        ? `  initialTask: "${args.initialTask.description.slice(0, 80)}"`
        : null,
    ].filter(Boolean).join("\n");
  },
};

// ─── 2. swarm_assign_task ─────────────────────────────────────────────────────

const assignTaskSchema = z.object({
  agentId: z.string().describe("Target agent id (use swarm_get_status to list)"),
  description: z.string(),
  type: z
    .enum([
      "code",
      "research",
      "analysis",
      "synthesis",
      "validation",
      "coordination",
      "learning",
      "custom",
    ])
    .default("custom"),
  input: z.unknown().optional(),
  priority: z.number().int().min(0).max(10).default(1),
  deadlineMs: z.number().int().optional().describe("Unix timestamp deadline"),
});

export const swarmAssignTaskTool: ToolDefinition<z.infer<typeof assignTaskSchema>> = {
  name: "swarm_assign_task",
  description:
    "Delegate a task to a specific subagent in the current swarm. The subagent's autonomous loop will execute it. Returns the task id.",
  inputSchema: assignTaskSchema,
  defaultConsent: "always",
  getConsentPreview: (a) => `Assign task to ${a.agentId.slice(0, 8)}…: "${a.description.slice(0, 60)}"`,

  execute: async (args) => {
    const { callerAgentId } = requireSwarmCallContext();
    const swarm = getAgentSwarm();

    const task = await swarm.assignTask(args.agentId as AgentNodeId, {
      type: args.type,
      description: args.description,
      input: args.input,
      priority: args.priority,
      deadline: args.deadlineMs,
      assignedBy: callerAgentId,
    });

    return `Assigned task ${task.id} to agent ${args.agentId} (priority ${args.priority})`;
  },
};

// ─── 3. swarm_get_status ─────────────────────────────────────────────────────

const statusSchema = z.object({
  agentId: z.string().optional().describe("Inspect a specific agent; omit to list all"),
});

export const swarmGetStatusTool: ToolDefinition<z.infer<typeof statusSchema>> = {
  name: "swarm_get_status",
  description:
    "Get the current state of the swarm: list all agents with their roles, statuses, pending tasks, and metrics. Or pass agentId to inspect one in detail.",
  inputSchema: statusSchema,
  defaultConsent: "always",
  getConsentPreview: (a) =>
    a.agentId ? `Inspect agent ${a.agentId.slice(0, 8)}…` : "List swarm agents",

  execute: async (args) => {
    const { swarmId } = requireSwarmCallContext();
    const swarm = getAgentSwarm();

    if (args.agentId) {
      const agent = await swarm.getAgent(args.agentId as AgentNodeId);
      if (!agent) throw new Error(`Agent ${args.agentId} not found`);
      return [
        `Agent ${agent.id}:`,
        `  name:        ${agent.name}`,
        `  role:        ${agent.role}`,
        `  status:      ${agent.status}`,
        `  generation:  ${agent.generation}`,
        `  parent:      ${agent.parentId ?? "(root)"}`,
        `  children:    ${agent.childIds.length}`,
        `  pendingTasks: ${agent.state.pendingTasks.length}`,
        `  completed:   ${agent.metrics.successfulTasks}/${agent.metrics.totalTasks}`,
        `  tools:       ${agent.config.tools.join(", ") || "(defaults)"}`,
        agent.state.currentTask
          ? `  currentTask: ${agent.state.currentTask.description.slice(0, 80)}`
          : null,
      ].filter(Boolean).join("\n");
    }

    const swarmObj = await swarm.getSwarm(swarmId);
    if (!swarmObj) throw new Error("Swarm not found");
    const agents = await swarm.listAgents(swarmId);

    const lines = [
      `Swarm "${swarmObj.name}" (${swarmObj.status}):`,
      `  agents: ${swarmObj.metrics.totalAgents} (${swarmObj.metrics.activeAgents} active)`,
      `  tasks:  ${swarmObj.metrics.completedTasks}/${swarmObj.metrics.totalTasks}`,
      `  knowledge entries: ${swarmObj.metrics.knowledgeEntries}`,
      ``,
      `Members:`,
    ];
    for (const a of agents) {
      lines.push(
        `  [${a.id.slice(0, 8)}] ${a.role.padEnd(12)} ${a.name} — ${a.status}` +
          ` (${a.state.pendingTasks.length} pending, ${a.metrics.successfulTasks}/${a.metrics.totalTasks} done)`,
      );
    }
    return lines.join("\n");
  },
};

// ─── 4. knowledge_search ─────────────────────────────────────────────────────

const knowledgeSearchSchema = z.object({
  query: z.string().describe("FTS5 search query (supports prefix*, phrases)"),
  type: z.enum(KNOWLEDGE_TYPES as readonly [KnowledgeType, ...KnowledgeType[]]).optional(),
  limit: z.number().int().min(1).max(50).default(10),
  apply: z.boolean().default(false).describe("Mark applied (increments usage count)"),
});

export const knowledgeSearchTool: ToolDefinition<z.infer<typeof knowledgeSearchSchema>> = {
  name: "knowledge_search",
  description:
    "Search the swarm's shared knowledge base (everything contributed by all agents — scraped facts, learned patterns, best practices). Use BEFORE researching from scratch to avoid redundant work.",
  inputSchema: knowledgeSearchSchema,
  defaultConsent: "always",
  getConsentPreview: (a) => `Search swarm knowledge for "${a.query}"`,

  execute: async (args) => {
    const { swarmId, callerAgentId } = requireSwarmCallContext();
    const swarm = getAgentSwarm();

    const results = await swarm.searchKnowledge(swarmId, args.query, args.type);
    const limited = results.slice(0, args.limit);

    if (args.apply) {
      for (const k of limited) {
        try {
          await swarm.applyKnowledge(callerAgentId, k.id);
        } catch {
          // Already applied or agent not found — ignore
        }
      }
    }

    if (limited.length === 0) {
      return `No swarm knowledge found for "${args.query}"`;
    }
    return [
      `Found ${limited.length} knowledge entries:`,
      ...limited.map(
        (k) =>
          `[${k.id.slice(0, 8)}] (${k.type}, used ${k.usageCount}× rated ${k.rating.toFixed(1)})\n  ${k.content.slice(0, 240)}${k.content.length > 240 ? "…" : ""}`,
      ),
    ].join("\n\n");
  },
};

// ─── 5. knowledge_add ────────────────────────────────────────────────────────

const knowledgeAddSchema = z.object({
  type: z.enum(KNOWLEDGE_TYPES as readonly [KnowledgeType, ...KnowledgeType[]]),
  content: z.string().min(10).describe("The knowledge to share with the swarm"),
  metadata: z.record(z.unknown()).optional(),
});

export const knowledgeAddTool: ToolDefinition<z.infer<typeof knowledgeAddSchema>> = {
  name: "knowledge_add",
  description:
    "Contribute a learning, fact, or pattern to the swarm's shared knowledge base. Future agents (and your future self) can discover it via knowledge_search.",
  inputSchema: knowledgeAddSchema,
  defaultConsent: "always",
  getConsentPreview: (a) => `Share knowledge: "${a.content.slice(0, 60)}…"`,

  execute: async (args) => {
    const { callerAgentId } = requireSwarmCallContext();
    const swarm = getAgentSwarm();
    const k = await swarm.shareKnowledge(callerAgentId, args.type, args.content, args.metadata);
    return `Knowledge ${k.id} stored (${k.type}, ${k.content.length} chars)`;
  },
};

// ─── 6. workflow_trigger ─────────────────────────────────────────────────────

const workflowTriggerSchema = z.object({
  workflowId: z.string().describe("n8n workflow id (use workflow_list to discover)"),
  data: z.record(z.unknown()).optional().describe("Input payload for the workflow"),
  connectionId: z.string().optional().describe("n8n connection id (uses default if omitted)"),
  waitForCompletion: z.boolean().default(false),
});

export const workflowTriggerTool: ToolDefinition<z.infer<typeof workflowTriggerSchema>> = {
  name: "workflow_trigger",
  description:
    "Execute an n8n workflow as a tool. Workflows can compose APIs, transformations, and integrations the swarm doesn't have native tools for — this turns n8n into a tool factory.",
  inputSchema: workflowTriggerSchema,
  defaultConsent: "always",
  getConsentPreview: (a) => `Trigger workflow ${a.workflowId}`,

  execute: async (args) => {
    const bridge = getOpenClawN8nBridge();
    const result = await bridge.triggerWorkflow({
      workflowId: args.workflowId,
      data: args.data,
      connectionId: args.connectionId,
      waitForCompletion: args.waitForCompletion,
    });
    return [
      `Workflow ${args.workflowId} triggered:`,
      `  executionId: ${result.executionId}`,
      `  status:      ${result.status}`,
      result.result
        ? `  result:      ${JSON.stringify(result.result).slice(0, 400)}`
        : null,
      result.error ? `  error:       ${result.error}` : null,
    ].filter(Boolean).join("\n");
  },
};

// ─── 7. workflow_list ────────────────────────────────────────────────────────

const workflowListSchema = z.object({
  connectionId: z.string().optional(),
});

export const workflowListTool: ToolDefinition<z.infer<typeof workflowListSchema>> = {
  name: "workflow_list",
  description:
    "List available n8n workflows that can be invoked as tools via workflow_trigger.",
  inputSchema: workflowListSchema,
  defaultConsent: "always",
  getConsentPreview: () => "List n8n workflows",

  execute: async (args) => {
    const bridge = getOpenClawN8nBridge();
    const workflows = await bridge.listWorkflows(args.connectionId);
    if (workflows.length === 0) return "No n8n workflows available.";
    return [
      `${workflows.length} workflow(s):`,
      ...workflows.map((w) => `  [${w.id}] ${w.name}${w.active ? " (active)" : ""}`),
    ].join("\n");
  },
};

// ─── Registry ────────────────────────────────────────────────────────────────

export const SWARM_ORCHESTRATION_TOOLS: readonly ToolDefinition[] = [
  swarmSpawnSubagentTool,
  swarmAssignTaskTool,
  swarmGetStatusTool,
  knowledgeSearchTool,
  knowledgeAddTool,
  workflowTriggerTool,
  workflowListTool,
];
