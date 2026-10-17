import { beforeEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import type { PushSummary } from "@/github_ops/state";
import { activeRecordings } from "./recording_registry";
import {
  getGithubOperationResources,
  GithubOpsService,
} from "./github_ops_service";

const handlers = vi.hoisted(() => ({
  disconnect: vi.fn<() => Promise<void>>(),
  push: vi.fn<() => Promise<PushSummary>>(),
}));

const pushSummary: PushSummary = {
  outcome: "pushed",
  pushedBranch: "main",
  currentBranch: "main",
  commitsPushed: 1,
  files: { added: 1, modified: 0, deleted: 0, renamed: 0 },
  uncommittedFiles: 0,
  commitsNotOnRemote: 0,
  head: "ffb1463",
  remoteTip: "ffb1463",
};

vi.mock("../handlers/github_handlers", () => ({
  handlePushToGithub: handlers.push,
  handleAbortRebase: vi.fn(),
  handleConnectToExistingRepo: vi.fn(),
  handleContinueRebase: vi.fn(),
  handleCreateRepo: vi.fn(),
  handleDisconnectGithubRepo: handlers.disconnect,
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
    activeRecordings.clear();
    handlers.disconnect.mockReset();
    handlers.push.mockReset();
  });

  it("coordinates metadata-only disconnects without claiming the repository", () => {
    expect(getGithubOperationResources({ type: "disconnect" })).toEqual([
      "metadata",
    ]);
    expect(
      getGithubOperationResources({
        type: "connect-repo",
        provider: "github",
        mode: "create",
        org: "dyad",
        repo: "app",
        branch: "main",
        thenAutoPush: false,
      }),
    ).toEqual([
      { resource: "app-path", mode: "read" },
      "metadata",
      "repository",
    ]);
  });

  it("rejects queued operations after the deletion fence is raised", async () => {
    const service = new GithubOpsService();
    service.beginAppDeletion(7);

    await expect(
      service.run(7, { type: "push", mode: "normal", provider: "github" }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
    expect(handlers.push).not.toHaveBeenCalled();

    service.endAppDeletion(7);
  });

  it("refuses repository operations during recording but allows metadata-only disconnect", async () => {
    const service = new GithubOpsService();
    activeRecordings.set(7, {
      appId: 7,
      stop: () => {},
      done: Promise.resolve({ envRestored: true }),
    });
    handlers.disconnect.mockResolvedValue();

    await expect(
      service.run(7, { type: "push", mode: "normal", provider: "github" }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
    await expect(
      service.run(7, { type: "disconnect" }),
    ).resolves.toBeUndefined();

    expect(handlers.push).not.toHaveBeenCalled();
    expect(handlers.disconnect).toHaveBeenCalledOnce();
  });

  it("rejects every app while a full reset is fenced", async () => {
    const service = new GithubOpsService();
    service.beginReset();

    await expect(
      service.run(7, { type: "push", mode: "normal", provider: "github" }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
    await expect(
      service.run(8, { type: "push", mode: "normal", provider: "github" }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
    expect(handlers.push).not.toHaveBeenCalled();

    service.endReset();
    handlers.push.mockResolvedValue(pushSummary);
    await expect(
      service.run(7, { type: "push", mode: "normal", provider: "github" }),
    ).resolves.toEqual({ type: "push", summary: pushSummary });
  });

  it("keeps settlement pending until an admitted operation finishes", async () => {
    let release!: () => void;
    handlers.push.mockImplementation(
      () =>
        new Promise<PushSummary>((resolve) => {
          release = () => resolve(pushSummary);
        }),
    );
    const service = new GithubOpsService();
    const run = service.run(7, {
      type: "push",
      mode: "normal",
      provider: "github",
    });
    await vi.waitFor(() => expect(handlers.push).toHaveBeenCalledOnce());

    let settled = false;
    const settlement = service.settle(7).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await expect(run).resolves.toEqual({ type: "push", summary: pushSummary });
    await settlement;
    expect(settled).toBe(true);
  });
});
