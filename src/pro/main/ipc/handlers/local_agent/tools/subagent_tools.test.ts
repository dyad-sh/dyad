import { describe, expect, it } from "vitest";

import { spawnAgentTool } from "./subagent_tools";
import type { AgentContext } from "./types";

describe("spawn_agent schema", () => {
  it("never exposes Reviewer and gates Implementer independently", () => {
    const explorerOnly = spawnAgentTool.getInputSchema?.({
      canUseExplorerSubagent: true,
      canUseImplementerSubagent: false,
    } as AgentContext);
    expect(
      explorerOnly?.safeParse({
        persona: "explorer",
        task_name: "map-flow",
        assignment: "Trace the flow",
        scope: ["src"],
      }).success,
    ).toBe(true);
    expect(
      explorerOnly?.safeParse({
        persona: "reviewer",
        task_name: "review",
        assignment: "Review changes",
        scope: [],
      }).success,
    ).toBe(false);
    expect(
      explorerOnly?.safeParse({
        persona: "implementer",
        task_name: "edit",
        assignment: "Edit a file",
        scope: ["src"],
      }).success,
    ).toBe(false);
  });
});
