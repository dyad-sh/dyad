import { describe, it, expect, vi, beforeEach } from "vitest";
import { IpcMainInvokeEvent } from "electron";

const registeredHandlers = vi.hoisted(
  () => [] as Array<(event: any, input: any) => Promise<unknown>>,
);
const gitServiceMocks = vi.hoisted(() => ({
  stageAllAndCommitWithPreCommit: vi.fn(),
}));

vi.mock("@/ipc/services/git_service", () => ({
  gitService: gitServiceMocks,
}));

vi.mock("@/ipc/handlers/gitignoreUtils", () => ({
  ensureDyadGitignored: vi.fn(),
}));

vi.mock("@/ipc/utils/git_utils", () => ({
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

vi.mock("@/paths/paths", () => ({
  getDyadAppPath: vi.fn((p: string) => `/mock/apps/${p}`),
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      apps: {
        findFirst: vi.fn(),
      },
    },
  },
}));

vi.mock("@/db/schema", () => ({
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

vi.mock("@/ipc/handlers/github_handlers", () => ({
  updateAppGithubRepo: vi.fn(),
  ensureCleanWorkspace: vi.fn(),
}));

vi.mock("@/ipc/handlers/base", () => ({
  createTypedHandler: vi.fn(
    (
      _contract: unknown,
      handler: (event: any, input: any) => Promise<unknown>,
    ) => {
      registeredHandlers.push(handler);
    },
  ),
}));

vi.mock("@/ipc/types/github", () => ({
  githubContracts: {},
  gitContracts: {},
}));

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(),
}));

import {
  handleDeleteBranch,
  registerGithubBranchHandlers,
} from "@/ipc/handlers/git_branch_handlers";
import {
  gitListBranches,
  gitListRemoteBranches,
  gitDeleteBranch,
} from "@/ipc/utils/git_utils";
import { db } from "@/db";
import { createAppOperationHandler } from "@/ipc/utils/app_mutation_lock";
import { reserveRecordingStart } from "@/ipc/services/recording_registry";

const mockEvent = {} as IpcMainInvokeEvent;

const mockApp = {
  id: 1,
  path: "test-app",
  githubOrg: "test-org",
  githubRepo: "test-repo",
};

describe("whole-operation app mutation locks", () => {
  it("serializes push and switch for one app without blocking another app", async () => {
    const events: string[] = [];
    let releasePush!: () => void;
    const pushCanFinish = new Promise<void>((resolve) => {
      releasePush = resolve;
    });
    let markPushStarted!: () => void;
    const pushStarted = new Promise<void>((resolve) => {
      markPushStarted = resolve;
    });

    const push = createAppOperationHandler(
      "test-push",
      ["repository"],
      async (_event: unknown, { appId }: { appId: number }) => {
        events.push(`push:${appId}:start`);
        markPushStarted();
        await pushCanFinish;
        events.push(`push:${appId}:end`);
      },
    );
    const switchBranch = createAppOperationHandler(
      "test-switch-branch",
      ["repository"],
      async (_event: unknown, { appId }: { appId: number }) => {
        events.push(`switch:${appId}`);
      },
    );

    const pushPromise = push({}, { appId: 1 });
    await pushStarted;
    const sameAppSwitch = switchBranch({}, { appId: 1 });
    const otherAppSwitch = switchBranch({}, { appId: 2 });
    await otherAppSwitch;

    expect(events).toEqual(["push:1:start", "switch:2"]);

    releasePush();
    await Promise.all([pushPromise, sameAppSwitch]);
    expect(events).toEqual([
      "push:1:start",
      "switch:2",
      "push:1:end",
      "switch:1",
    ]);
  });
});

describe("recording admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredHandlers.length = 0;
    registerGithubBranchHandlers();
  });

  it("refuses commit and discard while a recording owns the app", async () => {
    const commit = registeredHandlers.at(-2)!;
    const discard = registeredHandlers.at(-1)!;
    const reservation = reserveRecordingStart(1);
    expect(reservation).not.toBeNull();

    try {
      await expect(
        commit(mockEvent, { appId: 1, message: "Save work" }),
      ).rejects.toThrow("before you commit");
      await expect(discard(mockEvent, { appId: 1 })).rejects.toThrow(
        "before you discard changes",
      );
      expect(db.query.apps.findFirst).not.toHaveBeenCalled();
    } finally {
      reservation?.release();
    }
  });
});

describe("commit progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredHandlers.length = 0;
    vi.mocked(db.query.apps.findFirst).mockResolvedValue(mockApp as any);
    gitServiceMocks.stageAllAndCommitWithPreCommit.mockImplementation(
      async ({ onProgress }) => {
        onProgress("staging");
        onProgress("pre-commit");
        onProgress("committing");
        return "commit-hash";
      },
    );
    registerGithubBranchHandlers();
  });

  it("emits correlated phases to the renderer that started the commit", async () => {
    const send = vi.fn();
    const commit = registeredHandlers.at(-2)!;

    await expect(
      commit(
        {
          sender: {
            isDestroyed: () => false,
            isCrashed: () => false,
            send,
          },
        },
        { appId: 1, message: "Save work", operationId: "commit:123" },
      ),
    ).resolves.toBe("commit-hash");

    expect(send.mock.calls).toEqual([
      [
        "git:commit-progress",
        { appId: 1, operationId: "commit:123", phase: "staging" },
      ],
      [
        "git:commit-progress",
        { appId: 1, operationId: "commit:123", phase: "pre-commit" },
      ],
      [
        "git:commit-progress",
        { appId: 1, operationId: "commit:123", phase: "committing" },
      ],
    ]);
  });
});

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
