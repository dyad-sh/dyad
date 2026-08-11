import { Boxes, Code2, Hammer, Settings2, type LucideIcon } from "lucide-react";

/**
 * The Agents section, as data.
 *
 * Categorisation only. Every destination here already existed and still opens
 * the same screen it always did; this file records which group it belongs to
 * and nothing else.
 *
 * My Agents is deliberately absent from the fixed list below. Those entries are
 * the agents the user has actually registered, read at render time from the
 * same source the Agent OS dashboard reads. Writing "Brainiac" and "EMC2" here
 * would turn live records into hard-coded navigation, and the list would be
 * wrong the moment an agent is renamed, added or removed.
 */

export type AgentGroup = "My Agents" | "Coding" | "Configuration";

/** Order the groups appear in. */
export const AGENT_GROUPS: AgentGroup[] = [
  "My Agents",
  "Coding",
  "Configuration",
];

export type AgentDestinationId =
  | "coding-agents"
  | "build-studio"
  | "hermes-agents";

export type AgentDestination = {
  id: AgentDestinationId;
  label: string;
  /** One line saying what this is, so the groups stay distinguishable. */
  summary: string;
  group: Exclude<AgentGroup, "My Agents">;
  icon: LucideIcon;
  /** The route it already had, unchanged. */
  route: string;
};

export const AGENT_DESTINATIONS: AgentDestination[] = [
  {
    id: "coding-agents",
    label: "Coding Agents",
    summary: "Agents that plan, write and review code",
    group: "Coding",
    icon: Code2,
    route: "/coder",
  },
  {
    id: "build-studio",
    label: "Build Studio",
    summary: "Build and iterate on an app with an agent",
    group: "Coding",
    icon: Hammer,
    route: "/coder/studio",
  },
  {
    id: "hermes-agents",
    label: "Hermes Agents",
    summary: "Register agents and manage their connections",
    group: "Configuration",
    icon: Settings2,
    route: "/agent-os",
  },
];

/** Icon for the section itself, so the sidebar and page agree. */
export const AGENTS_SECTION_ICON = Boxes;

export function agentDestinationsInGroup(
  group: AgentGroup,
): AgentDestination[] {
  return AGENT_DESTINATIONS.filter(
    (destination) => destination.group === group,
  );
}

export function findAgentDestination(
  id: string | null | undefined,
): AgentDestination | undefined {
  return AGENT_DESTINATIONS.find((destination) => destination.id === id);
}
