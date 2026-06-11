import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gitInit: vi.fn(),
  gitAdd: vi.fn(),
  gitAddAll: vi.fn(),
  gitCommit: vi.fn(async () => "commit-hash"),
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

    expect(callOrder).toEqual(["gitInit", "gitAddAll", "gitCommit"]);
    expect(mocks.gitInit).toHaveBeenCalledWith({ path: "/repo", ref: "main" });
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

  it("commitFile stages the file before committing", async () => {
    const hash = await service.commitFile({
      path: "/repo",
      filepath: "src/a.ts",
      message: "msg",
    });

    expect(callOrder).toEqual(["gitAdd", "gitCommit"]);
    expect(mocks.gitAdd).toHaveBeenCalledWith({
      path: "/repo",
      filepath: "src/a.ts",
    });
    expect(hash).toBe("commit-hash");
  });
});
