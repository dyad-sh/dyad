import { beforeEach, describe, expect, it, vi } from "vitest";
import { GithubOpsService } from "./github_ops_service";

const handlers = vi.hoisted(() => ({
  push: vi.fn<() => Promise<void>>(),
}));

vi.mock("../handlers/github_handlers", () => ({
  handlePushToGithub: handlers.push,
  handleAbortRebase: vi.fn(),
  handleConnectToExistingRepo: vi.fn(),
  handleContinueRebase: vi.fn(),
  handleCreateRepo: vi.fn(),
  handleDisconnectGithubRepo: vi.fn(),
  handleGetGitState: vi.fn(),
  handleGetMergeConflicts: vi.fn(),
  handleRebaseFromGithub: vi.fn(),
}));

vi.mock("../handlers/git_branch_handlers", () => ({
  handleAbortMerge: vi.fn(),
  handleCreateBranch: vi.fn(),
  handleDeleteBranch: vi.fn(),
  handleFetchFromGithub: vi.fn(),
  handleMergeBranch: vi.fn(),
  handlePullFromGithub: vi.fn(),
  handleRenameBranch: vi.fn(),
  handleSwitchBranch: vi.fn(),
}));

describe("GithubOpsService", () => {
  beforeEach(() => {
    handlers.push.mockReset();
  });

  it("returns the complete Git continuation to the actor host", async () => {
    let release!: () => void;
    handlers.push.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const service = new GithubOpsService();
    const run = service.run(7, { type: "push", mode: "normal" });
    await vi.waitFor(() => expect(handlers.push).toHaveBeenCalledOnce());

    let settled = false;
    void run.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await expect(run).resolves.toBeUndefined();
  });
});
