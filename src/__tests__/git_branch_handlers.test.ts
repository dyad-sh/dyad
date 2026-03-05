import { describe, it, expect, vi, beforeEach } from "vitest";
import { IpcMainInvokeEvent } from "electron";

vi.mock("../ipc/utils/git_utils", () => ({
  gitListBranches: vi.fn(),
  gitListRemoteBranches: vi.fn(),
  gitDeleteBranch: vi.fn(),
  gitMergeAbort: vi.fn(),
  gitFetch: vi.fn(),
  gitPull: vi.fn(),
  gitCreateBranch: vi.fn(),
  gitCheckout: vi.fn(),
  gitMerge: vi.fn(),
  gitCurrentBranch: vi.fn(),
  gitRenameBranch: vi.fn(),
  GitStateError: vi.fn(),
  GIT_ERROR_CODES: {},
  isGitMergeInProgress: vi.fn(),
  isGitRebaseInProgress: vi.fn(),
  getGitUncommittedFilesWithStatus: vi.fn(),
  gitAddAll: vi.fn(),
  gitCommit: vi.fn(),
}));

vi.mock("../paths/paths", () => ({
  getDyadAppPath: vi.fn((p: string) => `/mock/apps/${p}`),
}));

vi.mock("../db", () => ({
  db: {
    query: {
      apps: {
        findFirst: vi.fn(),
      },
    },
  },
}));

vi.mock("../db/schema", () => ({
  apps: { id: "id" },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn(),
  };
});

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock("../ipc/utils/lock_utils", () => ({
  withLock: vi.fn(),
}));

vi.mock("../ipc/handlers/github_handlers", () => ({
  updateAppGithubRepo: vi.fn(),
  ensureCleanWorkspace: vi.fn(),
}));

vi.mock("../ipc/handlers/base", () => ({
  createTypedHandler: vi.fn(),
}));

vi.mock("../ipc/types/github", () => ({
  githubContracts: {},
  gitContracts: {},
}));

vi.mock("../main/settings", () => ({
  readSettings: vi.fn(),
}));

import { handleDeleteBranch } from "../ipc/handlers/git_branch_handlers";
import {
  gitListBranches,
  gitListRemoteBranches,
  gitDeleteBranch,
} from "../ipc/utils/git_utils";
import { db } from "../db";

const mockEvent = {} as IpcMainInvokeEvent;

const mockApp = {
  id: 1,
  path: "test-app",
  githubOrg: "test-org",
  githubRepo: "test-repo",
};

describe("handleDeleteBranch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.query.apps.findFirst).mockResolvedValue(mockApp as any);
  });

  it("deletes branch when it exists locally", async () => {
    vi.mocked(gitListBranches).mockResolvedValue(["main", "feature"]);
    vi.mocked(gitDeleteBranch).mockResolvedValue(undefined);

    await handleDeleteBranch(mockEvent, { appId: 1, branch: "feature" });

    expect(gitDeleteBranch).toHaveBeenCalledWith({
      path: "/mock/apps/test-app",
      branch: "feature",
    });
    expect(gitListRemoteBranches).not.toHaveBeenCalled();
  });

  it("throws error when branch only exists on remote with GitHub URL", async () => {
    vi.mocked(gitListBranches).mockResolvedValue(["main"]);
    vi.mocked(gitListRemoteBranches).mockResolvedValue(["main", "feature"]);

    await expect(
      handleDeleteBranch(mockEvent, { appId: 1, branch: "feature" }),
    ).rejects.toThrow(
      /only exists on the remote.*https:\/\/github\.com\/test-org\/test-repo\/branches/,
    );
  });

  it("succeeds silently when branch doesn't exist locally or remotely", async () => {
    vi.mocked(gitListBranches).mockResolvedValue(["main"]);
    vi.mocked(gitListRemoteBranches).mockResolvedValue(["main"]);

    await handleDeleteBranch(mockEvent, { appId: 1, branch: "nonexistent" });

    expect(gitDeleteBranch).not.toHaveBeenCalled();
  });

  it("throws error when branch doesn't exist locally and remote listing fails", async () => {
    vi.mocked(gitListBranches).mockResolvedValue(["main"]);
    vi.mocked(gitListRemoteBranches).mockRejectedValue(
      new Error("network error"),
    );

    await expect(
      handleDeleteBranch(mockEvent, { appId: 1, branch: "feature" }),
    ).rejects.toThrow(
      /does not exist locally and remote branches could not be checked/,
    );
  });

  it("throws generic error when branch only exists on remote for non-GitHub app", async () => {
    const nonGithubApp = {
      id: 1,
      path: "test-app",
      githubOrg: null,
      githubRepo: null,
    };
    vi.mocked(db.query.apps.findFirst).mockResolvedValue(nonGithubApp as any);
    vi.mocked(gitListBranches).mockResolvedValue(["main"]);
    vi.mocked(gitListRemoteBranches).mockResolvedValue(["main", "feature"]);

    await expect(
      handleDeleteBranch(mockEvent, { appId: 1, branch: "feature" }),
    ).rejects.toThrow(
      /only exists on the remote and cannot be deleted locally.*remote Git hosting provider/,
    );
  });

  it("throws when app not found", async () => {
    vi.mocked(db.query.apps.findFirst).mockResolvedValue(undefined);

    await expect(
      handleDeleteBranch(mockEvent, { appId: 999, branch: "feature" }),
    ).rejects.toThrow("App not found");
  });
});
