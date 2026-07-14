import { describe, expect, it } from "vitest";

import {
  cancelAgentTool,
  compilerExploreTool,
  followupTaskTool,
  listAgentsTool,
  sendMessageTool,
  spawnAgentTool,
  waitAgentsTool,
} from "./subagent_tools";
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

  it("classifies durable orchestration writes as state modifying", () => {
    expect(spawnAgentTool.modifiesState).toBe(true);
    expect(cancelAgentTool.modifiesState).toBe(true);
    expect(sendMessageTool.modifiesState).toBe(true);
    expect(followupTaskTool.modifiesState).toBe(true);
  });

  it("derives Pro gating and mutation-lease exemptions from tool metadata", () => {
    expect(
      [
        spawnAgentTool,
        listAgentsTool,
        waitAgentsTool,
        cancelAgentTool,
        sendMessageTool,
        followupTaskTool,
        compilerExploreTool,
      ].every((tool) => tool.subagentOnly),
    ).toBe(true);
    expect(spawnAgentTool.requiresMutationLease).toBe(false);
    expect(cancelAgentTool.requiresMutationLease).toBe(false);
    expect(sendMessageTool.requiresMutationLease).toBe(false);
    expect(followupTaskTool.requiresMutationLease).toBe(false);
  });

  it("exposes bounded compiler exploration arguments", () => {
    expect(
      compilerExploreTool.inputSchema.safeParse({
        query: "trace the request flow",
        max_files: 8,
        max_depth: 3,
      }).success,
    ).toBe(true);
    expect(
      compilerExploreTool.inputSchema.safeParse({
        query: "trace the request flow",
        max_files: 9,
      }).success,
    ).toBe(false);
  });
});
