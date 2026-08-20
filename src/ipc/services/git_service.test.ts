import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureGitLineEndingPolicy: vi.fn(),
  GIT_ERROR_CODES: {
    COMMIT_CANCELLED: "COMMIT_CANCELLED",
    PRE_COMMIT_FAILED: "PRE_COMMIT_FAILED",
    COMMIT_MSG_FAILED: "COMMIT_MSG_FAILED",
  },
  GitStateError: vi.fn((message: string, code: string) =>
    Object.assign(new Error(message), { code }),
  ),
  gitInit: vi.fn(),
  gitAdd: vi.fn(),
  gitAddAll: vi.fn(),
  gitCommit: vi.fn(async () => "commit-hash"),
  gitRemove: vi.fn(),
  hasStagedChanges: vi.fn(async () => true),
  isCommitMsgHookAvailable: vi.fn(async () => false),
  isPrepareCommitMsgHookAvailable: vi.fn(async () => false),
  isPreCommitHookAvailable: vi.fn(async () => true),
  runCommitMsgHook: vi.fn(),
  runPrepareCommitMsgHook: vi.fn(),
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
  isCommitMsgHookAvailable: mocks.isCommitMsgHookAvailable,
  isPrepareCommitMsgHookAvailable: mocks.isPrepareCommitMsgHookAvailable,
  isPreCommitHookAvailable: mocks.isPreCommitHookAvailable,
  runCommitMsgHook: mocks.runCommitMsgHook,
  runPrepareCommitMsgHook: mocks.runPrepareCommitMsgHook,
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
        if (name === "isCommitMsgHookAvailable") return false;
        if (name === "isPrepareCommitMsgHookAvailable") return false;
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
      "isPrepareCommitMsgHookAvailable",
      "isCommitMsgHookAvailable",
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
      "isPrepareCommitMsgHookAvailable",
      "isCommitMsgHookAvailable",
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

  it("keeps hook spawn failures on the ordinary commit error path", async () => {
    mocks.runPreCommitHook.mockRejectedValueOnce(new Error("spawn ENOENT"));

    const error = await service
      .stageAllAndCommitWithPreCommit({
        path: "/repo",
        message: "msg",
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      message: expect.stringContaining("could not start"),
    });
    expect(error).not.toHaveProperty("code");
    expect(mocks.gitCommit).not.toHaveBeenCalled();
  });

  it("returns a coded pre-commit failure when the hook times out", async () => {
    mocks.runPreCommitHook.mockResolvedValueOnce({
      code: 1,
      stdout: "still running",
      stderr: "",
      aborted: false,
      timedOut: true,
    });

    await expect(
      service.stageAllAndCommitWithPreCommit({
        path: "/repo",
        message: "msg",
      }),
    ).rejects.toMatchObject({
      code: "PRE_COMMIT_FAILED",
      message: expect.stringContaining("exceeded 10 minutes"),
    });
    expect(mocks.gitCommit).not.toHaveBeenCalled();
  });

  it("returns a cancellation code when the hook is aborted", async () => {
    mocks.runPreCommitHook.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "",
      aborted: true,
      timedOut: false,
    });

    await expect(
      service.stageAllAndCommitWithPreCommit({
        path: "/repo",
        message: "msg",
      }),
    ).rejects.toMatchObject({
      code: "COMMIT_CANCELLED",
    });
    expect(mocks.gitCommit).not.toHaveBeenCalled();
  });

  it("validates commit-msg separately and commits its updated message", async () => {
    const phases: string[] = [];
    mocks.isCommitMsgHookAvailable.mockResolvedValueOnce(true);
    mocks.runCommitMsgHook.mockResolvedValueOnce({
      code: 0,
      stdout: "",
      stderr: "",
      aborted: false,
      timedOut: false,
      message: "PROJ-123: msg",
    });

    await service.stageAllAndCommitWithPreCommit({
      path: "/repo",
      message: "msg",
      onProgress: (phase) => phases.push(phase),
    });

    expect(mocks.runCommitMsgHook).toHaveBeenCalledWith({
      path: "/repo",
      message: "msg",
      signal: undefined,
    });
    expect(mocks.gitCommit).toHaveBeenCalledWith({
      path: "/repo",
      message: "PROJ-123: msg",
    });
    expect(phases).toEqual([
      "staging",
      "pre-commit",
      "commit-msg",
      "committing",
    ]);
  });

  it("does not commit when commit-msg rejects the message", async () => {
    mocks.isCommitMsgHookAvailable.mockResolvedValueOnce(true);
    mocks.runCommitMsgHook.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "message must include an issue key",
      aborted: false,
      timedOut: false,
      message: "msg",
    });

    await expect(
      service.stageAllAndCommitWithPreCommit({
        path: "/repo",
        message: "msg",
      }),
    ).rejects.toMatchObject({
      code: "COMMIT_MSG_FAILED",
      message: expect.stringContaining("message must include an issue key"),
    });
    expect(mocks.gitCommit).not.toHaveBeenCalled();
  });

  it("runs prepare-commit-msg before commit-msg and commits the prepared message", async () => {
    const phases: string[] = [];
    mocks.isPrepareCommitMsgHookAvailable.mockResolvedValueOnce(true);
    mocks.isCommitMsgHookAvailable.mockResolvedValueOnce(true);
    mocks.runPrepareCommitMsgHook.mockImplementationOnce(async () => {
      callOrder.push("runPrepareCommitMsgHook");
      return {
        code: 0,
        stdout: "",
        stderr: "",
        aborted: false,
        timedOut: false,
        message: "msg\n\nChange-Id: I1234",
      };
    });
    mocks.runCommitMsgHook.mockImplementationOnce(async () => {
      callOrder.push("runCommitMsgHook");
      return {
        code: 0,
        stdout: "",
        stderr: "",
        aborted: false,
        timedOut: false,
        message: "msg\n\nChange-Id: I1234",
      };
    });

    await service.stageAllAndCommitWithPreCommit({
      path: "/repo",
      message: "msg",
      onProgress: (phase) => phases.push(phase),
    });

    // Git's order is pre-commit -> prepare-commit-msg -> commit-msg, so the
    // text commit-msg validates is the text that actually gets committed.
    expect(callOrder).toEqual([
      "gitAddAll",
      "isPreCommitHookAvailable",
      "runPreCommitHook",
      "runPrepareCommitMsgHook",
      "runCommitMsgHook",
      "gitCommit",
    ]);
    expect(mocks.runCommitMsgHook).toHaveBeenCalledWith({
      path: "/repo",
      message: "msg\n\nChange-Id: I1234",
      signal: undefined,
    });
    expect(mocks.gitCommit).toHaveBeenCalledWith({
      path: "/repo",
      message: "msg\n\nChange-Id: I1234",
    });
    expect(phases).toEqual([
      "staging",
      "pre-commit",
      "commit-msg",
      "committing",
    ]);
  });

  it("commits the prepared message when only prepare-commit-msg is installed", async () => {
    mocks.isPrepareCommitMsgHookAvailable.mockResolvedValueOnce(true);
    mocks.runPrepareCommitMsgHook.mockResolvedValueOnce({
      code: 0,
      stdout: "",
      stderr: "",
      aborted: false,
      timedOut: false,
      message: "PROJ-9: msg",
    });

    await service.stageAllAndCommitWithPreCommit({
      path: "/repo",
      message: "msg",
    });

    expect(mocks.runCommitMsgHook).not.toHaveBeenCalled();
    expect(mocks.gitCommit).toHaveBeenCalledWith({
      path: "/repo",
      message: "PROJ-9: msg",
    });
  });

  it("does not commit when prepare-commit-msg fails", async () => {
    mocks.isPrepareCommitMsgHookAvailable.mockResolvedValueOnce(true);
    mocks.runPrepareCommitMsgHook.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "could not resolve the ticket id",
      aborted: false,
      timedOut: false,
      message: "msg",
    });

    await expect(
      service.stageAllAndCommitWithPreCommit({
        path: "/repo",
        message: "msg",
      }),
    ).rejects.toMatchObject({
      code: "COMMIT_MSG_FAILED",
      message: expect.stringContaining("could not resolve the ticket id"),
    });
    expect(mocks.runCommitMsgHook).not.toHaveBeenCalled();
    expect(mocks.gitCommit).not.toHaveBeenCalled();
  });

  it("does not create the commit when cancel lands after the last hook", async () => {
    // The window the renderer's Cancel button races: the hook process has
    // already exited, so nothing is left to abort mid-flight.
    const controller = new AbortController();
    mocks.runPreCommitHook.mockImplementationOnce(async () => {
      callOrder.push("runPreCommitHook");
      controller.abort();
      return {
        code: 0,
        stdout: "checks passed",
        stderr: "",
        aborted: false,
        timedOut: false,
      };
    });

    await expect(
      service.stageAllAndCommitWithPreCommit({
        path: "/repo",
        message: "msg",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "COMMIT_CANCELLED" });
    expect(mocks.gitCommit).not.toHaveBeenCalled();
  });

  it("reports an already-aborted signal as a cancellation rather than an AbortError", async () => {
    await expect(
      service.stageAllAndCommitWithPreCommit({
        path: "/repo",
        message: "msg",
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ code: "COMMIT_CANCELLED" });
    expect(mocks.gitAddAll).not.toHaveBeenCalled();
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
