import type { Agent, AgentStatus } from "@/pages/agent-os/data";

/**
 * The Hermes agents the dashboard lists.
 *
 * Registered agents only, and only the ones switched on: a disabled agent is
 * not available, so listing it would answer the wrong question. An agent that
 * is registered but unreachable stays in the list with its real status,
 * because hiding a broken agent is the dashboard lying by omission — you would
 * see a short list and conclude nothing was wrong.
 *
 * Reachable ones sort first, so what is actually usable reads first.
 */

const REACHABLE: AgentStatus[] = ["online", "idle"];

export function isAgentReachable(status: AgentStatus): boolean {
  return REACHABLE.includes(status);
}

export function dashboardAgents(agents: Agent[]): Agent[] {
  return agents
    .filter((agent) => agent.type === "Hermes" && agent.enabled)
    .slice()
    .sort((a, b) => {
      const reachable =
        Number(isAgentReachable(b.status)) - Number(isAgentReachable(a.status));
      if (reachable !== 0) return reachable;
      return a.name.localeCompare(b.name);
    });
}

/** How many of them are actually reachable, for the channel's count. */
export function reachableAgentCount(agents: Agent[]): number {
  return agents.filter((agent) => isAgentReachable(agent.status)).length;
}
