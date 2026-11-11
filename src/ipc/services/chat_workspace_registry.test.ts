import { describe, expect, it, vi } from "vitest";
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
  it("isolates a chat's first writable turn even when no other chat is writing", () => {
    const registry = new ChatWorkspaceRegistry();
    expect(reserve(registry, 10).kind).toBe("new-workspace");
  });

  it("lets only one of a chat's writers create its workspace", () => {
    const registry = new ChatWorkspaceRegistry();
    // A turn and a proposal approval in the same chat at once.
    const first = reserve(registry, 10);
    expect(first.kind).toBe("new-workspace");
    expect(reserve(registry, 10)).toEqual({
      kind: "wait",
      reason: "workspace-busy",
    });
    if (first.kind !== "new-workspace") throw new Error("expected creation");
    registry.bindWorkspace(first.reservation, 4);
    // Once bound, the second writer waits for that workspace instead.
    expect(reserve(registry, 10, { existingWorkspaceId: 4 })).toEqual({
      kind: "wait",
      reason: "workspace-busy",
    });
    registry.release(first.reservation);
    expect(reserve(registry, 10, { existingWorkspaceId: 4 }).kind).toBe(
      "existing-workspace",
    );
  });

  it("isolates both of two simultaneous submissions", () => {
    const registry = new ChatWorkspaceRegistry();
    // Both decisions happen synchronously, exactly as two turns admitted in
    // the same tick would make them.
    const first = reserve(registry, 10);
    const second = reserve(registry, 20);
    expect(first.kind).toBe("new-workspace");
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

  it("leaves the original folder free for the final fast-forward while every writer is isolated", () => {
    const registry = new ChatWorkspaceRegistry();
    const writer = reserve(registry, 10);
    if (writer.kind !== "new-workspace") throw new Error("expected isolation");
    const release = registry.tryClaimOriginalForIntegration(APP);
    expect(release).not.toBeNull();
    release!();
    registry.release(writer.reservation);
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
    // Only chats that cannot be isolated write in the original folder.
    const shared = { isolationEnabled: false };
    const writer = reserve(registry, 10, shared);
    if (writer.kind !== "original") throw new Error("expected original");
    // A writer is in the original folder, so integration must wait.
    expect(registry.tryClaimOriginalForIntegration(APP)).toBeNull();
    registry.release(writer.reservation);

    const release = registry.tryClaimOriginalForIntegration(APP);
    expect(release).not.toBeNull();
    expect(reserve(registry, 20, shared)).toEqual({
      kind: "wait",
      reason: "original-integrating",
    });
    release!();
    expect(reserve(registry, 20, shared).kind).toBe("original");
  });

  it("never removes a workspace a turn or reader is using", () => {
    const registry = new ChatWorkspaceRegistry();
    const releaseReader = registry.addReader(APP, 9);
    expect(registry.tryClaimWorkspaceForRemoval(APP, 9)).toBeNull();
    releaseReader();

    const turn = reserve(registry, 10, { existingWorkspaceId: 9 });
    if (turn.kind !== "existing-workspace") throw new Error("expected reuse");
    expect(registry.tryClaimWorkspaceForRemoval(APP, 9)).toBeNull();
    registry.release(turn.reservation);

    const releaseRemoval = registry.tryClaimWorkspaceForRemoval(APP, 9);
    expect(releaseRemoval).not.toBeNull();
    // A turn that wants the workspace waits; a reader falls back.
    expect(reserve(registry, 10, { existingWorkspaceId: 9 }).kind).toBe("wait");
    expect(registry.tryAddReader(APP, 9)).toBeNull();
    releaseRemoval!();
    expect(registry.tryAddReader(APP, 9)).not.toBeNull();
  });

  it("publishes turn changes but not Ask/Plan readers", async () => {
    const registry = new ChatWorkspaceRegistry();
    const published: number[] = [];
    registry.subscribe((appId) => published.push(appId));

    // One change wakes every waiter (a turn and an integration worker, say),
    // not only the first.
    const woke = [registry.waitForChange(), registry.waitForChange()];
    const releaseReader = registry.addReader(APP, 9);
    await expect(Promise.all(woke)).resolves.toEqual([undefined, undefined]);
    releaseReader();
    expect(published).toEqual([]);

    const writer = reserve(registry, 10);
    expect(published).toEqual([APP]);
    if (writer.kind !== "wait") registry.release(writer.reservation);
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
    if (writer.kind !== "wait") registry.release(writer.reservation);
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

  it("stops waiting after a timeout without leaving a waiter behind", async () => {
    const registry = new ChatWorkspaceRegistry();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    // Polling loops wait like this repeatedly; each wait must clean up.
    for (let round = 0; round < 3; round++) {
      await expect(
        registry.waitForChange(controller.signal, { timeoutMs: 1 }),
      ).resolves.toBeUndefined();
    }
    expect(
      removeListener.mock.calls.filter(([type]) => type === "abort"),
    ).toHaveLength(3);
    // A later abort reaches no stale waiter (it would reject unhandled).
    controller.abort(new Error("stopped"));
    const woke = registry.waitForChange(undefined, { timeoutMs: 1_000 });
    const writer = reserve(registry, 10);
    await expect(woke).resolves.toBeUndefined();
    if (writer.kind !== "wait") registry.release(writer.reservation);
  });
});
