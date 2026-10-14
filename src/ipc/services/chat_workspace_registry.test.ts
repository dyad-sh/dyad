import { describe, expect, it } from "vitest";
import { ChatWorkspaceRegistry } from "./chat_workspace_registry";

const APP = 1;

function reserve(
  registry: ChatWorkspaceRegistry,
  chatId: number,
  options: {
    existingWorkspaceId?: number | null;
    isolationEnabled?: boolean;
  } = {},
) {
  return registry.reserveWritableTurn({
    appId: APP,
    chatId,
    existingWorkspaceId: options.existingWorkspaceId ?? null,
    isolationEnabled: options.isolationEnabled ?? true,
  });
}

describe("ChatWorkspaceRegistry", () => {
  it("gives the original folder to only one of two simultaneous submissions", () => {
    const registry = new ChatWorkspaceRegistry();
    // Both decisions happen synchronously, exactly as two turns admitted in
    // the same tick would make them.
    const first = reserve(registry, 10);
    const second = reserve(registry, 20);
    expect(first.kind).toBe("original");
    expect(second.kind).toBe("new-workspace");
    expect(registry.getWritableChatIds(APP).sort()).toEqual([10, 20]);
  });

  it("isolates a new writer while any other writer runs, even in a worktree", () => {
    const registry = new ChatWorkspaceRegistry();
    const isolated = reserve(registry, 10, { existingWorkspaceId: 7 });
    expect(isolated.kind).toBe("existing-workspace");
    expect(reserve(registry, 20).kind).toBe("new-workspace");
  });

  it("shares the original folder while isolation is disabled", () => {
    const registry = new ChatWorkspaceRegistry();
    expect(reserve(registry, 10, { isolationEnabled: false }).kind).toBe(
      "original",
    );
    expect(reserve(registry, 20, { isolationEnabled: false }).kind).toBe(
      "original",
    );
  });

  it("keeps an existing workspace even after isolation is disabled", () => {
    const registry = new ChatWorkspaceRegistry();
    const decision = reserve(registry, 10, {
      existingWorkspaceId: 3,
      isolationEnabled: false,
    });
    expect(decision).toMatchObject({
      kind: "existing-workspace",
      workspaceId: 3,
    });
    expect(registry.isWorkspaceTurnActive(3)).toBe(true);
  });

  it("returns the original folder once the other writer releases", () => {
    const registry = new ChatWorkspaceRegistry();
    const first = reserve(registry, 10);
    if (first.kind !== "original") throw new Error("expected original");
    registry.release(first.reservation);
    expect(reserve(registry, 20).kind).toBe("original");
  });

  it("lets a pending isolated reservation fall back when it becomes the only writer", () => {
    const registry = new ChatWorkspaceRegistry();
    const first = reserve(registry, 10);
    const second = reserve(registry, 20);
    if (first.kind !== "original" || second.kind !== "new-workspace") {
      throw new Error("unexpected decisions");
    }
    expect(registry.fallBackToOriginal(second.reservation)).toBe(false);
    registry.release(first.reservation);
    expect(registry.fallBackToOriginal(second.reservation)).toBe(true);
    // A third chat now sees an original-folder writer and isolates.
    expect(reserve(registry, 30).kind).toBe("new-workspace");
  });

  it("makes integration and turns exclusive on a workspace", () => {
    const registry = new ChatWorkspaceRegistry();
    const turn = reserve(registry, 10, { existingWorkspaceId: 5 });
    if (turn.kind !== "existing-workspace") throw new Error("expected reuse");
    expect(registry.tryClaimWorkspaceForIntegration(APP, 5)).toBeNull();
    registry.release(turn.reservation);

    const releaseIntegration = registry.tryClaimWorkspaceForIntegration(APP, 5);
    expect(releaseIntegration).not.toBeNull();
    expect(reserve(registry, 10, { existingWorkspaceId: 5 })).toEqual({
      kind: "wait",
      reason: "workspace-integrating",
    });
    releaseIntegration!();
    expect(reserve(registry, 10, { existingWorkspaceId: 5 }).kind).toBe(
      "existing-workspace",
    );
  });

  it("holds new original-folder writers during the final fast-forward", () => {
    const registry = new ChatWorkspaceRegistry();
    const writer = reserve(registry, 10);
    if (writer.kind !== "original") throw new Error("expected original");
    // A writer is in the original folder, so integration must wait.
    expect(registry.tryClaimOriginalForIntegration(APP)).toBeNull();
    registry.release(writer.reservation);

    const release = registry.tryClaimOriginalForIntegration(APP);
    expect(release).not.toBeNull();
    expect(reserve(registry, 20)).toEqual({
      kind: "wait",
      reason: "original-integrating",
    });
    release!();
    expect(reserve(registry, 20).kind).toBe("original");
  });

  it("never removes a workspace a turn or reader is using", () => {
    const registry = new ChatWorkspaceRegistry();
    const releaseReader = registry.addReader(APP, 9);
    expect(registry.tryClaimWorkspaceForRemoval(APP, 9)).toBeNull();
    releaseReader();

    const releaseRemoval = registry.tryClaimWorkspaceForRemoval(APP, 9);
    expect(releaseRemoval).not.toBeNull();
    // A turn that wants the workspace waits; a reader falls back.
    expect(reserve(registry, 10, { existingWorkspaceId: 9 }).kind).toBe("wait");
    expect(registry.tryAddReader(APP, 9)).toBeNull();
    releaseRemoval!();
    expect(registry.tryAddReader(APP, 9)).not.toBeNull();
  });

  it("wakes waiters on every change and supports cancellation", async () => {
    const registry = new ChatWorkspaceRegistry();
    const woke = registry.waitForChange();
    const writer = reserve(registry, 10);
    await expect(woke).resolves.toBeUndefined();

    const controller = new AbortController();
    const cancelled = registry.waitForChange(controller.signal);
    controller.abort(new Error("stopped"));
    await expect(cancelled).rejects.toThrow("stopped");
    if (writer.kind === "original") registry.release(writer.reservation);
  });

  it("ignores a release from a reservation that was already released", () => {
    const registry = new ChatWorkspaceRegistry();
    const turn = reserve(registry, 10, { existingWorkspaceId: 4 });
    if (turn.kind !== "existing-workspace") throw new Error("expected reuse");
    registry.release(turn.reservation);
    const next = reserve(registry, 10, { existingWorkspaceId: 4 });
    registry.release(turn.reservation);
    // The stale release must not drop the successor's lock.
    expect(registry.isWorkspaceTurnActive(4)).toBe(true);
    if (next.kind === "existing-workspace") registry.release(next.reservation);
  });

  it("hands out the last capacity slot to exactly one creator", () => {
    const registry = new ChatWorkspaceRegistry();
    const writer = reserve(registry, 10);
    const first = reserve(registry, 20);
    const second = reserve(registry, 30);
    if (
      writer.kind !== "original" ||
      first.kind !== "new-workspace" ||
      second.kind !== "new-workspace"
    ) {
      throw new Error("unexpected decisions");
    }
    const limits = { liveWorkspaces: 3, maxWorkspaces: 4 };
    expect(registry.tryStartWorkspaceCreation(first.reservation, limits)).toBe(
      true,
    );
    expect(registry.tryStartWorkspaceCreation(second.reservation, limits)).toBe(
      false,
    );
    // A creator that gives up returns its slot; a waiter never held one, so
    // two turns waiting at the limit cannot block each other.
    registry.abandonWorkspaceCreation(first.reservation);
    expect(registry.tryStartWorkspaceCreation(second.reservation, limits)).toBe(
      true,
    );
    registry.bindWorkspace(second.reservation, 11);
    expect(registry.isWorkspaceTurnActive(11)).toBe(true);
    expect(
      registry.tryStartWorkspaceCreation(first.reservation, {
        liveWorkspaces: 3,
        maxWorkspaces: 4,
      }),
    ).toBe(true);
  });
});
