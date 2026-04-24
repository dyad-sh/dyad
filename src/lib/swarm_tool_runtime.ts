/**
 * Swarm Tool Runtime
 *
 * Wires the local agent's TOOL_DEFINITIONS into the agent swarm so swarm agents
 * can actually USE tools (email, web scraping, planning, etc.) instead of
 * returning text-only responses.
 *
 * Why this layer exists:
 *   The swarm executor previously called `cns.chat()` which is plain text-only.
 *   Agents listed `config.tools: string[]` but had no way to invoke them.
 *   This module bridges the gap by exposing a curated subset of TOOL_DEFINITIONS
 *   as AI SDK tools and running multi-step generation.
 *
 * Curated subset:
 *   We only expose tools that are safe to run without a per-app sandbox context
 *   (an empty AgentContext is supplied). This includes:
 *     - All email tools (search/read/triage/summarize/draft/archive/follow-up)
 *     - send_email
 *     - web_scraper
 *     - think_and_plan
 *   App-mutating tools (write_file, run_command, execute_sql) are NOT exposed
 *   here — those live behind the chat agent which has a real AgentContext.
 */

import { generateText, stepCountIs, tool, type ToolSet } from "ai";
import type { z } from "zod";
import log from "electron-log";
import { TOOL_DEFINITIONS } from "@/pro/main/ipc/handlers/local_agent/tool_definitions";
import type {
  ToolDefinition,
  AgentContext,
} from "@/pro/main/ipc/handlers/local_agent/tools/types";
import { getMcpAgentToolNames } from "@/pro/main/ipc/handlers/local_agent/tools/mcp_tools_adapter";
import { getA2aAgentToolNames } from "@/pro/main/ipc/handlers/local_agent/tools/a2a_tools_adapter";
import { getAutonomousAgentToolNames } from "@/pro/main/ipc/handlers/local_agent/tools/autonomous_agent_tools_adapter";
import { getMemoryAgentToolNames } from "@/pro/main/ipc/handlers/local_agent/tools/memory_tools_adapter";
import { getExtensionSubsystemToolNames } from "@/pro/main/ipc/handlers/local_agent/tools/extension_subsystem_tools";
import { getPluginAgentToolNames } from "@/pro/main/ipc/handlers/local_agent/tools/plugin_tools_adapter";
import { readSettings } from "@/main/settings";
import { getModelClient } from "@/ipc/utils/get_model_client";
import { getAgentSwarm, type AgentNode } from "@/lib/agent_swarm";
import {
  setSwarmCallContext,
  type SwarmCallContext,
} from "@/lib/swarm_call_context";

const logger = log.scope("swarm_tool_runtime");

/**
 * Native tool names always exposed to swarm agents (independent of MCP).
 * The full set is `NATIVE_SWARM_TOOLS ∪ getMcpAgentToolNames()`.
 */
const NATIVE_SWARM_TOOLS: readonly string[] = [
  // Email — the whole hub
  "email_search",
  "email_list_unread",
  "email_read_message",
  "email_triage",
  "email_summarize_thread",
  "email_draft_reply",
  "email_archive",
  "email_schedule_followup",
  "send_email",
  // Knowledge & reasoning
  "web_scraper",
  "think_and_plan",
  // Swarm orchestration — primary agent can spawn subagents, share knowledge,
  // delegate, and call workflow-built tools
  "swarm_spawn_subagent",
  "swarm_assign_task",
  "swarm_get_status",
  "knowledge_search",
  "knowledge_add",
  "workflow_trigger",
  "workflow_list",
];

/**
 * Build the full default tool name set lazily so the MCP adapter only runs
 * when a swarm agent actually executes (not at module load).
 */
let _defaultToolNames: Set<string> | null = null;
function getDefaultToolNames(): Set<string> {
  if (_defaultToolNames) return _defaultToolNames;
  _defaultToolNames = new Set<string>([
    ...NATIVE_SWARM_TOOLS,
    ...getMcpAgentToolNames(),
    ...getA2aAgentToolNames(),
    ...getAutonomousAgentToolNames(),
    ...getMemoryAgentToolNames(),
    ...getExtensionSubsystemToolNames(),
    ...getPluginAgentToolNames(),
  ]);
  return _defaultToolNames;
}

/**
 * Build a minimal AgentContext suitable for swarm tool calls.
 *
 * The curated swarm tool set (email_*, send_email, web_scraper, think_and_plan)
 * does not touch `event`, `appPath`, `supabaseProjectId`, XML streaming, or
 * consent prompting — so safe stubs are sufficient. Auto-approves consent
 * because the user has already consented by running the swarm.
 */
function buildSwarmAgentContext(_agent: AgentNode): AgentContext {
  return {
    event: null as unknown as AgentContext["event"],
    appPath: "",
    chatId: 0,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    messageId: 0,
    isSharedModulesChanged: false,
    onXmlStream: () => {
      /* swarm executor broadcasts its own progress */
    },
    onXmlComplete: () => {
      /* swarm executor broadcasts its own progress */
    },
    requireConsent: async () => true,
  };
}

/**
 * Resolve which tools a given swarm agent may use.
 * Precedence:
 *   1. If `agent.config.tools` is non-empty → intersect with the default set
 *   2. Otherwise → use the full default set (native + every MCP tool)
 */
function resolveToolsForAgent(agent: AgentNode): ToolDefinition[] {
  const defaults = getDefaultToolNames();
  const allowed = new Set<string>(
    agent.config.tools && agent.config.tools.length > 0
      ? agent.config.tools.filter((n) => defaults.has(n))
      : defaults,
  );
  return TOOL_DEFINITIONS.filter((t) => allowed.has(t.name));
}

/**
 * Wrap a TOOL_DEFINITIONS entry as an AI SDK v5 tool.
 *
 * Two extras vs. a plain wrapper:
 *  1. Sets the `swarm_call_context` side-channel before each invocation so
 *     swarm orchestration tools (knowledge_*, swarm_*) can identify the caller.
 *  2. Auto-deposits `web_scraper` output into the swarm's shared knowledge
 *     so other agents can `knowledge_search` what was already learned.
 */
function wrapToolForSdk(
  def: ToolDefinition,
  ctx: AgentContext,
  callContext: SwarmCallContext,
): ReturnType<typeof tool> {
  return tool({
    description: def.description,
    inputSchema: def.inputSchema as z.ZodTypeAny,
    execute: async (args: unknown) => {
      setSwarmCallContext(callContext);
      try {
        const result = await def.execute(args as never, ctx);
        const text = typeof result === "string" ? result : JSON.stringify(result);

        // Auto-share scraping results into swarm knowledge so future
        // agents can discover them via knowledge_search.
        if (def.name === "web_scraper" && text && text.length > 40) {
          try {
            const swarm = getAgentSwarm();
            await swarm.shareKnowledge(
              callContext.callerAgentId,
              "domain_expertise",
              `[web_scraper] ${text.slice(0, 4000)}`,
              {
                source: "web_scraper",
                args: args as Record<string, unknown>,
                contributorRole: callContext.callerRole,
              },
            );
          } catch (shareErr) {
            logger.debug(`Could not auto-share scraper result: ${shareErr}`);
          }
        }

        return text;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[swarm-tool] ${def.name} failed: ${msg}`);
        return `ERROR: ${msg}`;
      } finally {
        setSwarmCallContext(null);
      }
    },
  });
}

export interface SwarmToolRunResult {
  text: string;
  toolCallCount: number;
  toolsUsed: string[];
  steps: number;
}

/**
 * Run a tool-aware generation step for a swarm agent.
 *
 * The model can take up to `maxSteps` interleaved (text, tool-call, tool-result)
 * turns. Returns the final assistant text plus per-step telemetry.
 */
export async function runSwarmAgentWithTools(
  agent: AgentNode,
  prompt: string,
  options?: { systemPrompt?: string; maxSteps?: number },
): Promise<SwarmToolRunResult> {
  const settings = readSettings();
  const { modelClient } = await getModelClient(settings.selectedModel, settings);

  const ctx = buildSwarmAgentContext(agent);
  const toolDefs = resolveToolsForAgent(agent);

  const callContext: SwarmCallContext = {
    swarmId: agent.swarmId,
    callerAgentId: agent.id,
    callerAgentName: agent.name,
    callerRole: agent.role,
  };

  const sdkTools: ToolSet = {};
  for (const def of toolDefs) {
    sdkTools[def.name] = wrapToolForSdk(def, ctx, callContext);
  }

  const systemPrompt =
    options?.systemPrompt ??
    agent.config.systemPrompt ??
    `You are a ${agent.role} agent named "${agent.name}" in an autonomous agent swarm.\n` +
      `Use the available tools to complete the assigned task. ` +
      `Prefer concrete actions (search, read, draft, send) over speculation. ` +
      `When done, return a concise summary of what you accomplished.`;

  const maxSteps = options?.maxSteps ?? 10;

  logger.info(
    `[swarm-run] agent=${agent.name} tools=${toolDefs.length} maxSteps=${maxSteps}`,
  );

  const result = await generateText({
    model: modelClient.model,
    system: systemPrompt,
    prompt,
    tools: sdkTools,
    stopWhen: stepCountIs(maxSteps),
  });

  const toolsUsed: string[] = [];
  let toolCallCount = 0;
  for (const step of result.steps ?? []) {
    for (const call of step.toolCalls ?? []) {
      toolCallCount += 1;
      if (!toolsUsed.includes(call.toolName)) toolsUsed.push(call.toolName);
    }
  }

  return {
    text: result.text,
    toolCallCount,
    toolsUsed,
    steps: result.steps?.length ?? 0,
  };
}
