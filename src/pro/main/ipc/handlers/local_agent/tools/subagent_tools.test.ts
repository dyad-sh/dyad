import { beforeEach, describe, expect, it, vi } from "vitest";

const subagentManagerMocks = vi.hoisted(() => ({
  cancelSubagent: vi.fn(async () => {}),
  followupSubagent: vi.fn(async () => "explorer" as const),
  listSubagents: vi.fn(async () => []),
  sendSubagentMessage: vi.fn(async () => {}),
  spawnModelSubagent: vi.fn(async () => "explorer-1"),
  updateSubagentActivity: vi.fn(async () => {}),
  waitForSubagents: vi.fn(async () => [] as any[]),
}));

vi.mock("../subagents/subagent_manager", () => subagentManagerMocks);

import {
  buildSubagentContext,
  cancelAgentTool,
  exploreCodeTool,
  followupTaskTool,
  listAgentsTool,
  sendMessageTool,
  spawnAgentTool,
  waitAgentsTool,
} from "./subagent_tools";
import type { AgentContext } from "./types";
import { trackAppMutation } from "./tool_invocation";

const advancedSubagentTools = [
  listAgentsTool,
  waitAgentsTool,
  cancelAgentTool,
  sendMessageTool,
  followupTaskTool,
];

describe("spawn_agent schema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subagentManagerMocks.spawnModelSubagent.mockResolvedValue("explorer-1");
  });

  it("binds child consent and tools to the child abort signal", async () => {
    const requireConsent = vi.fn(async () => true);
    const rootSignal = new AbortController().signal;
    const childSignal = new AbortController().signal;
    const child = buildSubagentContext({
      ctx: {
        requireConsent,
        abortSignal: rootSignal,
        sharedServerModulePaths: [],
        pendingFunctionDeploys: [],
        fileEditTracker: { attemptsByFile: new Map() },
      } as unknown as AgentContext,
      threadId: "child-1",
      persona: "implementer",
      taskName: "Edit auth flow",
      scope: ["./src/auth/"],
      abortSignal: childSignal,
    });

    await child.requireConsent({ toolName: "write_file" });

    expect(child.abortSignal).toBe(childSignal);
    expect(child.subagentPathScope).toEqual(["src/auth"]);
    expect(requireConsent).toHaveBeenCalledWith({
      toolName: "write_file",
      abortSignal: childSignal,
      subagent: {
        threadId: "child-1",
        persona: "implementer",
        taskName: "Edit auth flow",
      },
    });
  });

  it("propagates successful child mutations to the root turn", () => {
    const root = {
      sharedServerModulePaths: [],
      pendingFunctionDeploys: [],
      referencedApps: new Map(),
      fileEditTracker: { attemptsByFile: new Map() },
    } as unknown as AgentContext;
    const child = buildSubagentContext({
      ctx: root,
      threadId: "implementer-1",
      persona: "implementer",
      taskName: "Edit auth flow",
      scope: ["src/auth"],
      abortSignal: new AbortController().signal,
    });

    trackAppMutation(child, "write_file", true, true);

    expect(child.mutationCount).toBe(1);
    expect(root.mutationCount).toBe(1);
    expect(root.fileMutationCount).toBe(1);
    expect(root.workspaceMutated).toBe(true);
  });

  it("blocks Explorer spawning until its report is returned", async () => {
    subagentManagerMocks.waitForSubagents.mockResolvedValueOnce([
      {
        id: "explorer-1",
        status: "completed",
        result: { report: "## explore_code report\nSummary:\nGrounded result" },
        error: null,
      },
    ]);
    const abortSignal = new AbortController().signal;
    const onXmlComplete = vi.fn();
    const ctx = {
      chatId: 7,
      abortSignal,
      onXmlComplete,
      spawnedSubagentThreadIds: [],
      deliveredExplorerThreadIds: [],
      canUseAdvancedSubagentTools: false,
    } as unknown as AgentContext;

    const result = await spawnAgentTool.execute(
      {
        persona: "explorer",
        task_name: "Trace auth",
        assignment: "Explain the authentication flow",
        scope: ["src/auth"],
      },
      ctx,
    );

    expect(subagentManagerMocks.waitForSubagents).toHaveBeenCalledWith(
      7,
      ["explorer-1"],
      abortSignal,
    );
    expect(JSON.parse(result)).toEqual({
      threadId: "explorer-1",
      status: "completed",
      report: "## explore_code report\nSummary:\nGrounded result",
      error: null,
    });
    expect(ctx.deliveredExplorerThreadIds).toEqual(["explorer-1"]);
    expect(onXmlComplete).toHaveBeenCalledWith(
      expect.stringContaining('thread-id="explorer-1"'),
    );
  });

  it("cancels a spawned child when the blocking wait fails", async () => {
    const waitError = new Error("Timed out waiting for sub-agents to finish.");
    subagentManagerMocks.waitForSubagents.mockRejectedValueOnce(waitError);
    const ctx = {
      chatId: 7,
      abortSignal: new AbortController().signal,
      onXmlComplete: vi.fn(),
      spawnedSubagentThreadIds: [],
    } as unknown as AgentContext;

    await expect(
      spawnAgentTool.execute(
        {
          persona: "explorer",
          task_name: "Trace auth",
          assignment: "Explain the authentication flow",
          scope: ["src/auth"],
        },
        ctx,
      ),
    ).rejects.toBe(waitError);

    expect(subagentManagerMocks.cancelSubagent).toHaveBeenCalledWith(
      7,
      "explorer-1",
    );
  });

  it("unregisters an Implementer it cancelled, so the join barrier ignores it", async () => {
    subagentManagerMocks.spawnModelSubagent.mockResolvedValueOnce(
      "implementer-1",
    );
    const waitError = new Error("Timed out waiting for sub-agents to finish.");
    subagentManagerMocks.waitForSubagents.mockRejectedValueOnce(waitError);
    const ctx = {
      chatId: 7,
      abortSignal: new AbortController().signal,
      onXmlComplete: vi.fn(),
      spawnedSubagentThreadIds: [],
      spawnedImplementerThreadIds: [],
    } as unknown as AgentContext;

    await expect(
      spawnAgentTool.execute(
        {
          persona: "implementer",
          task_name: "Fix the activity feed",
          assignment: "Repair the activity feed query",
          scope: ["src/app"],
        },
        ctx,
      ),
    ).rejects.toBe(waitError);

    expect(subagentManagerMocks.cancelSubagent).toHaveBeenCalledWith(
      7,
      "implementer-1",
    );
    // The thread is now permanently "cancelled". Leaving it registered would
    // make waitForSubagentsAndBeginFinalization fail the entire turn at the end,
    // even though the model was told about the failure and could recover.
    expect(ctx.spawnedImplementerThreadIds).toEqual([]);
  });

  it("hides advanced tools by default and when explicitly disabled", () => {
    for (const canUseAdvancedSubagentTools of [undefined, false]) {
      const ctx = {
        isDyadPro: true,
        canUseAdvancedSubagentTools,
      } as AgentContext;

      expect(
        advancedSubagentTools.every((tool) => tool.isEnabled?.(ctx) === false),
      ).toBe(true);
    }
  });

  it("exposes advanced tools to enabled root turns", () => {
    const ctx = {
      isDyadPro: true,
      canUseAdvancedSubagentTools: true,
    } as AgentContext;

    expect(
      advancedSubagentTools.every((tool) => tool.isEnabled?.(ctx) === true),
    ).toBe(true);
  });

  it("keeps advanced tools hidden from child agents when enabled for root", () => {
    const root = {
      isDyadPro: true,
      canUseAdvancedSubagentTools: true,
      sharedServerModulePaths: [],
      pendingFunctionDeploys: [],
      referencedApps: new Map(),
      fileEditTracker: { attemptsByFile: new Map() },
    } as unknown as AgentContext;
    const child = buildSubagentContext({
      ctx: root,
      threadId: "explorer-1",
      persona: "explorer",
      taskName: "Trace auth flow",
      scope: ["src/auth"],
      abortSignal: new AbortController().signal,
    });

    expect(child.canUseAdvancedSubagentTools).toBe(false);
    expect(
      advancedSubagentTools.every((tool) => tool.isEnabled?.(child) === false),
    ).toBe(true);
  });

  it("blocks Implementer spawning until its report is returned", async () => {
    subagentManagerMocks.spawnModelSubagent.mockResolvedValueOnce(
      "implementer-1",
    );
    subagentManagerMocks.waitForSubagents.mockResolvedValueOnce([
      {
        id: "implementer-1",
        status: "completed",
        result: { report: "Changed src/auth.ts and verified its types." },
        error: null,
      },
    ]);
    const abortSignal = new AbortController().signal;
    const ctx = {
      chatId: 7,
      abortSignal,
      onXmlComplete: vi.fn(),
      spawnedSubagentThreadIds: [],
      spawnedImplementerThreadIds: [],
    } as unknown as AgentContext;

    const result = await spawnAgentTool.execute(
      {
        persona: "implementer",
        task_name: "Update auth",
        assignment: "Make the bounded authentication edit",
        scope: ["src/auth.ts"],
      },
      ctx,
    );

    expect(subagentManagerMocks.waitForSubagents).toHaveBeenCalledWith(
      7,
      ["implementer-1"],
      abortSignal,
    );
    expect(JSON.parse(result)).toEqual({
      threadId: "implementer-1",
      status: "completed",
      report: "Changed src/auth.ts and verified its types.",
      error: null,
    });
    expect(ctx.spawnedImplementerThreadIds).toEqual(["implementer-1"]);
  });

  it("keeps schema introspection safe when no spawn persona is enabled", () => {
    const schema = spawnAgentTool.getInputSchema?.({
      canUseExplorerSubagent: false,
      canUseImplementerSubagent: false,
    } as AgentContext);

    expect(
      schema?.safeParse({
        persona: "explorer",
        task_name: "map-flow",
        assignment: "Trace the flow",
        scope: ["src"],
      }).success,
    ).toBe(true);
  });

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

  it("allows Explorer-only spawning without misclassifying orchestration writes", () => {
    expect(spawnAgentTool.modifiesState).toBe(true);
    expect(typeof spawnAgentTool.allowInReadOnlyModes).toBe("function");
    const allowInReadOnlyModes = spawnAgentTool.allowInReadOnlyModes as (
      ctx: AgentContext,
    ) => boolean;
    expect(
      allowInReadOnlyModes({
        canUseImplementerSubagent: true,
      } as AgentContext),
    ).toBe(false);
    expect(
      allowInReadOnlyModes({
        canUseImplementerSubagent: false,
      } as AgentContext),
    ).toBe(true);
    expect(cancelAgentTool.modifiesState).toBe(true);
    expect(waitAgentsTool.modifiesState).toBe(true);
    expect(waitAgentsTool.requiresMutationLease).toBe(false);
    expect(waitAgentsTool.requiresBlueprintApproval).toBe(false);
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
        exploreCodeTool,
      ].every((tool) => tool.subagentOnly),
    ).toBe(true);
    expect(spawnAgentTool.requiresMutationLease).toBe(false);
    expect(spawnAgentTool.requiresBlueprintApproval).toBe(false);
    expect(spawnAgentTool.usesEngineEndpoint).toBe(true);
    expect(cancelAgentTool.requiresMutationLease).toBe(false);
    expect(cancelAgentTool.requiresBlueprintApproval).toBe(false);
    expect(sendMessageTool.requiresMutationLease).toBe(false);
    expect(sendMessageTool.requiresBlueprintApproval).toBe(false);
    expect(followupTaskTool.requiresMutationLease).toBe(false);
    expect(followupTaskTool.requiresBlueprintApproval).toBe(false);
    expect(followupTaskTool.usesEngineEndpoint).toBe(true);
  });

  it("exposes bounded compiler exploration arguments", () => {
    expect(
      exploreCodeTool.inputSchema.safeParse({
        query: "trace the request flow",
        max_files: 8,
        max_depth: 3,
      }).success,
    ).toBe(true);
    expect(
      exploreCodeTool.inputSchema.safeParse({
        query: "trace the request flow",
        max_files: 9,
      }).success,
    ).toBe(false);
  });
});
