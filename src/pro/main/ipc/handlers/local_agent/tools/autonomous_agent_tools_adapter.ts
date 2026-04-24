/**
 * Autonomous Agent → ToolDefinition Adapter
 *
 * Lets the swarm spin up persistent, self-directed autonomous agents
 * (different from ephemeral subagents). Backed by `AutonomousAgentSystem`.
 */

import { z } from "zod";
import { getAutonomousAgentSystem } from "@/lib/autonomous_agent";
import type { ToolDefinition } from "./types";

const autonomousAgentCreateTool: ToolDefinition = {
  name: "autonomous_agent_create",
  description:
    "Create a persistent autonomous agent that runs missions on its own. Returns agent id.",
  inputSchema: z.object({
    name: z.string(),
    purpose: z.string().describe("What this agent should accomplish over time"),
    autonomyLevel: z
      .enum(["supervised", "semi-autonomous", "autonomous", "fully-autonomous"])
      .optional()
      .default("semi-autonomous"),
  }),
  defaultConsent: "ask",
  getConsentPreview: (args) => `autonomous_agent_create(name=${args.name})`,
  execute: async (args) => {
    const sys = getAutonomousAgentSystem();
    const agent = await sys.createAgent({
      name: args.name,
      purpose: args.purpose,
      config: { autonomyLevel: args.autonomyLevel },
    });
    return JSON.stringify({ id: agent.id, name: agent.name, state: agent.state });
  },
};

const autonomousAgentActivateTool: ToolDefinition = {
  name: "autonomous_agent_activate",
  description: "Activate (wake up) a previously-created autonomous agent so it begins executing missions.",
  inputSchema: z.object({ agentId: z.string() }),
  defaultConsent: "ask",
  getConsentPreview: (args) => `autonomous_agent_activate(${args.agentId})`,
  execute: async (args) => {
    const sys = getAutonomousAgentSystem();
    await sys.activateAgent(args.agentId as never);
    return JSON.stringify({ ok: true, agentId: args.agentId });
  },
};

const autonomousAgentAssignMissionTool: ToolDefinition = {
  name: "autonomous_agent_assign_mission",
  description: "Assign a mission/objective to an autonomous agent. The agent will plan and execute it.",
  inputSchema: z.object({
    agentId: z.string(),
    objective: z.string(),
    priority: z.enum(["low", "normal", "high", "critical"]).optional().default("normal"),
  }),
  defaultConsent: "ask",
  getConsentPreview: (args) => `autonomous_agent_assign_mission(${args.agentId})`,
  execute: async (args) => {
    const sys = getAutonomousAgentSystem();
    const mission = await sys.createMission({
      agentId: args.agentId as never,
      objective: args.objective,
      priority: args.priority as never,
    } as never);
    return JSON.stringify({ missionId: (mission as { id?: string }).id ?? null, ok: true });
  },
};

const autonomousAgentEventsTool: ToolDefinition = {
  name: "autonomous_agent_recent_events",
  description: "Read the recent event log of an autonomous agent (actions, decisions, errors).",
  inputSchema: z.object({
    agentId: z.string(),
    limit: z.number().int().min(1).max(500).optional().default(50),
  }),
  defaultConsent: "always",
  execute: async (args) => {
    const sys = getAutonomousAgentSystem();
    const events = await sys.getRecentEvents(args.agentId as never, args.limit);
    return JSON.stringify(events);
  },
};

export const AUTONOMOUS_AGENT_TOOLS: readonly ToolDefinition[] = [
  autonomousAgentCreateTool,
  autonomousAgentActivateTool,
  autonomousAgentAssignMissionTool,
  autonomousAgentEventsTool,
];

export function getAutonomousAgentToolNames(): string[] {
  return AUTONOMOUS_AGENT_TOOLS.map((t) => t.name);
}
