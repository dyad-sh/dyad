// Type definitions and small constants for the Agent OS command center.
//
// Agents are real, persisted records served by the Agent OS IPC layer
// (`ipc.agentOs.*`, backed by the `agent_os_agents` SQLite table). There is no
// mock/seed data here — the UI renders whatever the user has registered.

export type AgentStatus = "online" | "idle" | "offline" | "error";
export type AgentType = "Hermes" | "OpenClaw" | "MCP" | "Custom";

/** Renderer-side shape consumed by the Agent OS views. Derived from the
 *  persisted `AgentOsAgentDto` (see `useAgentOsAgents`). */
export type Agent = {
  id: string;
  name: string;
  description: string;
  type: AgentType;
  endpoint: string;
  /** Blank means "derive it from the endpoint origin". */
  imageBaseUrl: string;
  model: string;
  status: AgentStatus;
  capabilities: string[];
  icon: string;
  /** Human-readable relative time, computed from `lastActivityAt`/`updatedAt`. */
  lastActivity: string;
  taskCount: number;
  enabled: boolean;
  hasApiKey: boolean;
};

// Status types still referenced by shared UI badges.
export type TaskStatus = "pending" | "running" | "completed" | "failed";
export type LogLevel = "info" | "warning" | "error";

export const AGENT_TYPES: AgentType[] = ["Hermes", "OpenClaw", "MCP", "Custom"];

/**
 * Whether an agent's chat should render with the app's main-chat UI (rich
 * markdown, centered column, copy/model footer) instead of the compact
 * holographic bubble style. Matched by type OR name, so an agent named e.g.
 * "Hermes Phantom" or "OpenClaw Scout" qualifies regardless of its type.
 */
export function usesMainChatStyle(
  agent: Pick<Agent, "type" | "name">,
): boolean {
  return (
    agent.type === "Hermes" ||
    agent.type === "OpenClaw" ||
    /hermes|openclaw/i.test(agent.name)
  );
}

/** Icon choices offered when creating an agent. */
export const AGENT_ICONS = [
  "🤖",
  "🪽",
  "🦅",
  "🗄️",
  "📁",
  "🍌",
  "🎙️",
  "⏱️",
  "🧠",
  "🛰️",
  "⚡",
  "🔮",
  "🌐",
  "🧭",
];

/** Default per-type metadata used to pre-fill the create form. */
export const AGENT_TYPE_PRESETS: Record<
  AgentType,
  { icon: string; endpoint: string; capabilities: string }
> = {
  Hermes: {
    icon: "🪽",
    endpoint: "https://",
    capabilities: "reasoning, planning, tools, memory",
  },
  OpenClaw: {
    icon: "🦅",
    endpoint: "https://",
    capabilities: "web, scrape, vision",
  },
  MCP: { icon: "🗄️", endpoint: "mcp://", capabilities: "tools" },
  Custom: { icon: "🤖", endpoint: "https://", capabilities: "" },
};
