import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureGitLineEndingPolicy: vi.fn(),
  gitInit: vi.fn(),
  gitAdd: vi.fn(),
  gitAddAll: vi.fn(),
  gitCommit: vi.fn(async () => "commit-hash"),
  gitRemove: vi.fn(),
  hasStagedChanges: vi.fn(async () => true),
}));

vi.mock("../utils/git_utils", () => mocks);

import { GitService } from "./git_service";

describe("GitService", () => {
  const service = new GitService();
  const callOrder: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;
    for (const [name, fn] of Object.entries(mocks)) {
      fn.mockImplementation(async () => {
        callOrder.push(name);
        if (name === "gitCommit") return "commit-hash";
        if (name === "hasStagedChanges") return true;
        return undefined;
      });
    }
  });

  it("initRepoWithInitialCommit inits, stages all, then commits", async () => {
    const hash = await service.initRepoWithInitialCommit({ path: "/repo" });

    expect(callOrder).toEqual([
      "gitInit",
      "ensureGitLineEndingPolicy",
      "gitAddAll",
      "gitCommit",
    ]);
    expect(mocks.gitInit).toHaveBeenCalledWith({ path: "/repo", ref: "main" });
    expect(mocks.ensureGitLineEndingPolicy).toHaveBeenCalledWith({
      path: "/repo",
      writeGitattributes: true,
    });
    expect(mocks.gitCommit).toHaveBeenCalledWith({
      path: "/repo",
      message: "Init Dyad app",
      noVerify: true,
    });
    expect(hash).toBe("commit-hash");
  });

  it("initRepoWithInitialCommit honors custom message and ref", async () => {
    await service.initRepoWithInitialCommit({
      path: "/repo",
      message: "custom",
      ref: "master",
    });

    expect(mocks.gitInit).toHaveBeenCalledWith({
      path: "/repo",
      ref: "master",
    });
    expect(mocks.gitCommit).toHaveBeenCalledWith({
      path: "/repo",
      message: "custom",
      noVerify: true,
    });
  });

  it("stageAllAndCommit stages before committing", async () => {
    const hash = await service.stageAllAndCommit({
      path: "/repo",
      message: "msg",
    });

    expect(callOrder).toEqual(["gitAddAll", "gitCommit"]);
    expect(mocks.gitCommit).toHaveBeenCalledWith({
      path: "/repo",
      message: "msg",
      noVerify: false,
    });
    expect(hash).toBe("commit-hash");
  });

  it("stageAllAndCommitIfChanged commits when changes are staged", async () => {
    const hash = await service.stageAllAndCommitIfChanged({
      path: "/repo",
      message: "msg",
    });

    expect(callOrder).toEqual(["gitAddAll", "hasStagedChanges", "gitCommit"]);
    expect(hash).toBe("commit-hash");
  });

  it("stageAllAndCommitIfChanged returns null when nothing is staged", async () => {
    mocks.hasStagedChanges.mockImplementation(async () => {
      callOrder.push("hasStagedChanges");
      return false;
    });

    const hash = await service.stageAllAndCommitIfChanged({
      path: "/repo",
      message: "msg",
    });

    expect(hash).toBeNull();
    expect(mocks.gitCommit).not.toHaveBeenCalled();
  });

  it("stageFile stages the file without committing", async () => {
    await service.stageFile({ path: "/repo", filepath: "src/a.ts" });

    expect(callOrder).toEqual(["gitAdd"]);
    expect(mocks.gitAdd).toHaveBeenCalledWith({
      path: "/repo",
      filepath: "src/a.ts",
    });
    expect(mocks.gitCommit).not.toHaveBeenCalled();
  });

  it("commitFile stages the file before committing", async () => {
    const hash = await service.commitFile({
      path: "/repo",
      filepath: "src/a.ts",
      message: "msg",
    });

    expect(callOrder).toEqual(["gitAdd", "hasStagedChanges", "gitCommit"]);
    expect(mocks.gitAdd).toHaveBeenCalledWith({
      path: "/repo",
      filepath: "src/a.ts",
    });
    expect(hash).toBe("commit-hash");
  });

  it("commitFile returns null when the file was ignored (nothing staged)", async () => {
    mocks.hasStagedChanges.mockImplementation(async () => {
      callOrder.push("hasStagedChanges");
      return false;
    });

    const hash = await service.commitFile({
      path: "/repo",
      filepath: ".env.local",
      message: "msg",
    });

    expect(callOrder).toEqual(["gitAdd", "hasStagedChanges"]);
    expect(hash).toBeNull();
    expect(mocks.gitCommit).not.toHaveBeenCalled();
  });

  it("removeFileAndCommit commits only the removed path", async () => {
    const result = await service.removeFileAndCommit({
      path: "/repo",
      filepath: "e2e-tests/a.spec.ts",
      message: "msg",
    });

    expect(callOrder).toEqual(["gitRemove", "gitCommit"]);
    expect(mocks.gitRemove).toHaveBeenCalledWith({
      path: "/repo",
      filepath: "e2e-tests/a.spec.ts",
    });
    // Scoped to the one path, so unrelated staged changes stay uncommitted.
    expect(mocks.gitCommit).toHaveBeenCalledWith({
      path: "/repo",
      message: "msg",
      noVerify: true,
      paths: ["e2e-tests/a.spec.ts"],
    });
    expect(result).toEqual({
      commitHash: "commit-hash",
      uncommittedReason: null,
    });
  });

  it("removeFileAndCommit reports an untracked file without committing", async () => {
    mocks.gitRemove.mockRejectedValueOnce(new Error("did not match any files"));

    const result = await service.removeFileAndCommit({
      path: "/repo",
      filepath: "e2e-tests/untracked.spec.ts",
      message: "msg",
    });

    // Distinct from a failed commit: nothing was removed or staged, so the
    // caller still owns deleting the file and can't promise a way back.
    expect(result).toEqual({
      commitHash: null,
      uncommittedReason: "untracked",
    });
    expect(mocks.gitCommit).not.toHaveBeenCalled();
  });

  it("removeFileAndCommit reports a failed commit, leaving it staged", async () => {
    mocks.gitCommit.mockRejectedValueOnce(
      new Error("cannot do a partial commit during a merge"),
    );

    const result = await service.removeFileAndCommit({
      path: "/repo",
      filepath: "e2e-tests/a.spec.ts",
      message: "msg",
    });

    expect(result).toEqual({
      commitHash: null,
      uncommittedReason: "commit-failed",
    });
    expect(mocks.gitRemove).toHaveBeenCalled();
  });
});
