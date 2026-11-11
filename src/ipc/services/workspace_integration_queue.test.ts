import { describe, expect, it, vi } from "vitest";

const { listAllWorkspaces } = vi.hoisted(() => ({
  listAllWorkspaces: vi.fn(),
}));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("./chat_workspace_store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./chat_workspace_store")>()),
  listAllWorkspaces,
}));

import { WorkspaceIntegrationQueue } from "./workspace_integration_queue";

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
