import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureGitLineEndingPolicy: vi.fn(),
  GIT_ERROR_CODES: { PRE_COMMIT_FAILED: "PRE_COMMIT_FAILED" },
  GitStateError: vi.fn((message: string, code: string) =>
    Object.assign(new Error(message), { code }),
  ),
  gitInit: vi.fn(),
  gitAdd: vi.fn(),
  gitAddAll: vi.fn(),
  gitCommit: vi.fn(async () => "commit-hash"),
  gitRemove: vi.fn(),
  hasStagedChanges: vi.fn(async () => true),
  isPreCommitHookAvailable: vi.fn(async () => true),
  runPreCommitHook: vi.fn(async () => ({
    code: 0,
    stdout: "checks passed",
    stderr: "",
    aborted: false,
    timedOut: false,
  })),
}));

vi.mock("../utils/git_utils", () => mocks);
vi.mock("./pre_commit_service", () => ({
  PRE_COMMIT_TIMEOUT_MS: 10 * 60_000,
  formatPreCommitOutput: (stdout: string, stderr: string) =>
    [stdout, stderr].filter(Boolean).join("\n") ||
    "The hook produced no output.",
  isPreCommitHookAvailable: mocks.isPreCommitHookAvailable,
  runPreCommitHook: mocks.runPreCommitHook,
}));

import { GitService } from "./git_service";

describe("GitService", () => {
  const service = new GitService();
  const callOrder: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    callOrder.length = 0;
    for (const [name, fn] of Object.entries(mocks)) {
      if (typeof fn !== "function") continue;
      if (name === "GitStateError") {
        fn.mockImplementation((message: string, code: string) =>
          Object.assign(new Error(message), { code }),
        );
        continue;
      }
      fn.mockImplementation(async () => {
        callOrder.push(name);
        if (name === "gitCommit") return "commit-hash";
        if (name === "hasStagedChanges") return true;
        if (name === "isPreCommitHookAvailable") return true;
        if (name === "runPreCommitHook") {
          return {
            code: 0,
            stdout: "checks passed",
            stderr: "",
            aborted: false,
            timedOut: false,
          };
        }
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
    });
    expect(hash).toBe("commit-hash");
  });

  it("runs pre-commit separately before a user-initiated commit", async () => {
    const phases: string[] = [];
    const hash = await service.stageAllAndCommitWithPreCommit({
      path: "/repo",
      message: "msg",
      onProgress: (phase) => phases.push(phase),
    });

    expect(callOrder).toEqual([
      "gitAddAll",
      "isPreCommitHookAvailable",
      "runPreCommitHook",
      "gitCommit",
    ]);
    expect(mocks.gitCommit).toHaveBeenCalledWith({
      path: "/repo",
      message: "msg",
    });
    expect(hash).toBe("commit-hash");
    expect(phases).toEqual(["staging", "pre-commit", "committing"]);
  });

  it("commits directly when no pre-commit hook is installed", async () => {
    const phases: string[] = [];
    mocks.isPreCommitHookAvailable.mockImplementation(async () => {
      callOrder.push("isPreCommitHookAvailable");
      return false;
    });

    await service.stageAllAndCommitWithPreCommit({
      path: "/repo",
      message: "msg",
      onProgress: (phase) => phases.push(phase),
    });

    expect(callOrder).toEqual([
      "gitAddAll",
      "isPreCommitHookAvailable",
      "gitCommit",
    ]);
    expect(mocks.runPreCommitHook).not.toHaveBeenCalled();
    expect(phases).toEqual(["staging", "committing"]);
  });

  it("returns a coded error and does not commit when pre-commit fails", async () => {
    mocks.runPreCommitHook.mockImplementation(async () => {
      callOrder.push("runPreCommitHook");
      return {
        code: 1,
        stdout: "",
        stderr: "lint failed",
        aborted: false,
        timedOut: false,
      };
    });

    await expect(
      service.stageAllAndCommitWithPreCommit({
        path: "/repo",
        message: "msg",
      }),
    ).rejects.toMatchObject({
      code: "PRE_COMMIT_FAILED",
      message: expect.stringContaining("lint failed"),
    });
    expect(mocks.gitCommit).not.toHaveBeenCalled();
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
