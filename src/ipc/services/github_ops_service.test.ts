import { beforeEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
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

describe("GithubOpsService lifecycle", () => {
  beforeEach(() => {
    handlers.push.mockReset();
  });

  it("rejects queued operations after the deletion fence is raised", async () => {
    const service = new GithubOpsService();
    service.beginAppDeletion(7);

    await expect(
      service.run(7, { type: "push", mode: "normal" }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
    expect(handlers.push).not.toHaveBeenCalled();

    service.endAppDeletion(7);
  });

  it("rejects every app while a full reset is fenced", async () => {
    const service = new GithubOpsService();
    service.beginReset();

    await expect(
      service.run(7, { type: "push", mode: "normal" }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
    await expect(
      service.run(8, { type: "push", mode: "normal" }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
    expect(handlers.push).not.toHaveBeenCalled();

    service.endReset();
    handlers.push.mockResolvedValue();
    await expect(
      service.run(7, { type: "push", mode: "normal" }),
    ).resolves.toBeUndefined();
  });

  it("keeps settlement pending until an admitted operation finishes", async () => {
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
    const settlement = service.settle(7).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await expect(run).resolves.toBeUndefined();
    await settlement;
    expect(settled).toBe(true);
  });
});
