import { describe, expect, it } from "vitest";

import {
  dashboardAgents,
  isAgentReachable,
  reachableAgentCount,
} from "@/lib/dashboard/dashboard_agents";
import type { Agent, AgentStatus, AgentType } from "@/pages/agent-os/data";

/**
 * The dashboard's agent row answers "which of my agents can I use right now".
 * The two ways it could mislead are listing one that is switched off, and
 * quietly dropping one that is broken — the second is worse, because a short
 * list reads as a healthy list.
 */

function agent(overrides: {
  id: string;
  name?: string;
  type?: AgentType;
  status?: AgentStatus;
  enabled?: boolean;
}): Agent {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    description: "",
    type: overrides.type ?? "Hermes",
    endpoint: "",
    imageBaseUrl: "",
    model: "",
    status: overrides.status ?? "online",
    capabilities: [],
    icon: "",
    lastActivity: "never",
    taskCount: 0,
    enabled: overrides.enabled ?? true,
    hasApiKey: false,
  };
}

describe("the dashboard's agent list", () => {
  it("lists registered Hermes agents", () => {
    const listed = dashboardAgents([
      agent({ id: "one" }),
      agent({ id: "two" }),
    ]);
    expect(listed.map((entry) => entry.id)).toEqual(["one", "two"]);
  });

  it("leaves out agents that are switched off", () => {
    // A disabled agent is not available, so it answers the wrong question.
    const listed = dashboardAgents([
      agent({ id: "on" }),
      agent({ id: "off", enabled: false }),
    ]);
    expect(listed.map((entry) => entry.id)).toEqual(["on"]);
  });

  it("leaves out agents of other kinds", () => {
    const listed = dashboardAgents([
      agent({ id: "hermes" }),
      agent({ id: "mcp", type: "MCP" }),
      agent({ id: "custom", type: "Custom" }),
    ]);
    expect(listed.map((entry) => entry.id)).toEqual(["hermes"]);
  });

  it("keeps an unreachable agent in the list rather than hiding it", () => {
    // Dropping it would make a broken setup look like a small one.
    const listed = dashboardAgents([
      agent({ id: "broken", status: "error" }),
      agent({ id: "gone", status: "offline" }),
    ]);
    expect(listed.map((entry) => entry.id).sort()).toEqual(["broken", "gone"]);
  });

  it("puts the usable ones first", () => {
    const listed = dashboardAgents([
      agent({ id: "c-offline", name: "C", status: "offline" }),
      agent({ id: "a-online", name: "A", status: "online" }),
      agent({ id: "b-idle", name: "B", status: "idle" }),
    ]);
    expect(listed.map((entry) => entry.id)).toEqual([
      "a-online",
      "b-idle",
      "c-offline",
    ]);
  });

  it("does not reorder the caller's array", () => {
    const agents = [
      agent({ id: "offline", status: "offline" }),
      agent({ id: "online" }),
    ];
    dashboardAgents(agents);
    expect(agents.map((entry) => entry.id)).toEqual(["offline", "online"]);
  });

  it("counts only the reachable ones", () => {
    const agents = [
      agent({ id: "a", status: "online" }),
      agent({ id: "b", status: "idle" }),
      agent({ id: "c", status: "offline" }),
      agent({ id: "d", status: "error" }),
    ];
    expect(reachableAgentCount(agents)).toBe(2);
  });

  it("treats idle as reachable and error as not", () => {
    expect(isAgentReachable("online")).toBe(true);
    expect(isAgentReachable("idle")).toBe(true);
    expect(isAgentReachable("offline")).toBe(false);
    expect(isAgentReachable("error")).toBe(false);
  });
});
