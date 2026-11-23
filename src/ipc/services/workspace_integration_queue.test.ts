import { describe, expect, it, vi } from "vitest";

const { listAllWorkspaces } = vi.hoisted(() => ({
  listAllWorkspaces: vi.fn(),
}));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("./chat_workspace_store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./chat_workspace_store")>()),
  listAllWorkspaces,
}));

import { chatWorkspaceRegistry } from "./chat_workspace_registry";
import { WorkspaceIntegrationQueue } from "./workspace_integration_queue";

describe("WorkspaceIntegrationQueue.shutdown", () => {
  it("stays stopped when recovery starts the queue after quitting began", () => {
    const queue = new WorkspaceIntegrationQueue();
    const subscribe = vi.spyOn(chatWorkspaceRegistry, "subscribe");
    try {
      queue.shutdown();
      // Startup recovery is not awaited; its `finally` starts the queue.
      queue.start();
      expect(subscribe).not.toHaveBeenCalled();

      // Stopping alone (not quitting) can still be undone.
      const restartable = new WorkspaceIntegrationQueue();
      restartable.stop();
      restartable.start();
      expect(subscribe).toHaveBeenCalledTimes(1);
      restartable.stop();
    } finally {
      subscribe.mockRestore();
    }
  });
});

describe("WorkspaceIntegrationQueue.resumePending", () => {
  listAllWorkspaces.mockReturnValue([
    { id: 1, appId: 10, status: "active", integrationStatus: "validating" },
    { id: 2, appId: 10, status: "active", integrationStatus: "queued" },
    { id: 3, appId: 10, status: "active", integrationStatus: "merged" },
    { id: 4, appId: 20, status: "active", integrationStatus: "queued" },
    { id: 5, appId: 20, status: "removing", integrationStatus: "queued" },
  ]);

  function resumed(appId?: number): Array<[number, number]> {
    const queue = new WorkspaceIntegrationQueue();
    const schedule = vi
      .spyOn(queue, "schedule")
      .mockImplementation(() => undefined);
    queue.resumePending(appId);
    return schedule.mock.calls;
  }

  it("re-queues every app's pending workspaces at startup", () => {
    expect(resumed()).toEqual([
      [10, 1],
      [10, 2],
      [20, 4],
    ]);
  });

  it("re-queues only the app whose deletion did not go through", () => {
    // Another app's deletion may still be holding its integration stopped.
    expect(resumed(10)).toEqual([
      [10, 1],
      [10, 2],
    ]);
  });
});
