import { describe, it, expect, vi, beforeEach } from "vitest";
import { IpcMainInvokeEvent } from "electron";
import { EventEmitter } from "node:events";

// Keyed by contract channel rather than registration order: positional lookup
// silently repoints at the wrong handler the moment another one is registered,
// and a signature-compatible mismatch still passes.
const registeredHandlers = vi.hoisted(
  () => new Map<string, (event: any, input: any) => Promise<unknown>>(),
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
  GitStateError: vi.fn((message: string, code: string) =>
    Object.assign(new Error(message), { code }),
  ),
  GIT_ERROR_CODES: { COMMIT_CANCELLED: "COMMIT_CANCELLED" },
  isGitMergeInProgress: vi.fn(),
  isGitRebaseInProgress: vi.fn(),
  getGitUncommittedFilesWithStatus: vi.fn(),
  gitAddAll: vi.fn(),
  gitCommit: vi.fn(),
}));

vi.mock("@/paths/paths", () => ({
  getDyadAppPath: vi.fn((p: string) => `/mock/apps/${p}`),
}));

/** What reached `db.update(...).set(...)`, so a test can read the columns written. */
const dbWrites = vi.hoisted(() => ({
  updates: [] as Record<string, unknown>[],
}));

vi.mock("@/db", () => ({
  db: {
    query: {
      apps: {
        findFirst: vi.fn(),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          dbWrites.updates.push(values);
        }),
      })),
    })),
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
      contract: { channel: string },
      handler: (event: any, input: any) => Promise<unknown>,
    ) => {
      registeredHandlers.set(contract.channel, handler);
    },
  ),
}));

vi.mock("@/ipc/types/github", () => ({
  githubContracts: {
    listLocalBranches: { channel: "github:list-local-branches" },
    listRemoteBranches: { channel: "github:list-remote-branches" },
  },
  gitContracts: {
    getUncommittedFiles: { channel: "git:get-uncommitted-files" },
    getUncommittedFileDiff: { channel: "git:get-uncommitted-file-diff" },
    commitChanges: { channel: "git:commit-changes" },
    cancelCommit: { channel: "git:cancel-commit" },
    discardChanges: { channel: "git:discard-changes" },
  },
  gitEvents: {
    commitProgress: { channel: "git:commit-progress" },
  },
}));

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(),
}));

import {
  handleDeleteBranch,
  handleFetchFromGithub,
  handleRenameBranch,
  handleSwitchBranch,
  registerGithubBranchHandlers,
} from "@/ipc/handlers/git_branch_handlers";
import { resolveAppGitRemote } from "@/ipc/utils/app_git_remote";
import {
  gitFetch,
  gitListBranches,
  gitListRemoteBranches,
  gitDeleteBranch,
  gitCurrentBranch,
} from "@/ipc/utils/git_utils";
import { readSettings } from "@/main/settings";
import { db } from "@/db";
import { gitContracts, gitEvents } from "@/ipc/types/github";
import { createAppOperationHandler } from "@/ipc/utils/app_mutation_lock";
import { reserveRecordingStart } from "@/ipc/services/recording_registry";

function handlerFor(channel: string) {
  const handler = registeredHandlers.get(channel);
  if (!handler) {
    throw new Error(`No handler registered for channel "${channel}"`);
  }
  return handler;
}

const mockEvent = { sender: { id: 99 } } as IpcMainInvokeEvent;

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
    registeredHandlers.clear();
    registerGithubBranchHandlers();
  });

  it("refuses commit and discard while a recording owns the app", async () => {
    const commit = handlerFor(gitContracts.commitChanges.channel);
    const discard = handlerFor(gitContracts.discardChanges.channel);
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
    registeredHandlers.clear();
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
    const commit = handlerFor(gitContracts.commitChanges.channel);

    await expect(
      commit(
        {
          sender: {
            id: 99,
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
        gitEvents.commitProgress.channel,
        { appId: 1, operationId: "commit:123", phase: "staging" },
      ],
      [
        gitEvents.commitProgress.channel,
        { appId: 1, operationId: "commit:123", phase: "pre-commit" },
      ],
      [
        gitEvents.commitProgress.channel,
        { appId: 1, operationId: "commit:123", phase: "committing" },
      ],
    ]);
  });

  it("aborts only the matching commit owned by the requesting renderer", async () => {
    let receivedSignal: AbortSignal | undefined;
    gitServiceMocks.stageAllAndCommitWithPreCommit.mockImplementationOnce(
      async ({ signal, onProgress }) => {
        receivedSignal = signal;
        onProgress("pre-commit");
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
        return "unreachable";
      },
    );
    const commit = handlerFor(gitContracts.commitChanges.channel);
    const cancel = handlerFor(gitContracts.cancelCommit.channel);
    const sender = {
      id: 99,
      isDestroyed: () => false,
      isCrashed: () => false,
      send: vi.fn(),
    };

    const commitPromise = commit(
      { sender },
      { appId: 1, message: "Save work", operationId: "commit:cancel" },
    );
    await vi.waitFor(() => expect(receivedSignal).toBeDefined());

    await expect(
      cancel(
        { sender: { ...sender, id: 100 } },
        { appId: 1, operationId: "commit:cancel" },
      ),
    ).resolves.toBe(false);
    expect(receivedSignal?.aborted).toBe(false);

    await expect(
      cancel({ sender }, { appId: 1, operationId: "commit:cancel" }),
    ).resolves.toBe(true);
    expect(receivedSignal?.aborted).toBe(true);
    await expect(commitPromise).rejects.toThrow("aborted");
  });

  it("classifies cancellation while the commit is queued", async () => {
    let releaseBlocker!: () => void;
    const blocker = createAppOperationHandler(
      "test-blocker",
      ["repository"],
      () =>
        new Promise<void>((resolve) => {
          releaseBlocker = resolve;
        }),
    );
    const blockerPromise = blocker({}, { appId: 1 });
    await vi.waitFor(() => expect(releaseBlocker).toBeDefined());
    const commit = handlerFor(gitContracts.commitChanges.channel);
    const cancel = handlerFor(gitContracts.cancelCommit.channel);
    const sender = {
      id: 99,
      isDestroyed: () => false,
      isCrashed: () => false,
      send: vi.fn(),
    };
    const commitPromise = commit(
      { sender },
      { appId: 1, message: "Save work", operationId: "commit:queued" },
    );

    await expect(
      cancel({ sender }, { appId: 1, operationId: "commit:queued" }),
    ).resolves.toBe(true);
    // Settles without waiting for the blocker, so the dialog is not stuck on a
    // disabled "Cancelling..." for as long as the blocking operation runs.
    await expect(commitPromise).rejects.toMatchObject({
      code: "COMMIT_CANCELLED",
    });

    releaseBlocker();
    await blockerPromise;
    expect(
      gitServiceMocks.stageAllAndCommitWithPreCommit,
    ).not.toHaveBeenCalled();
  });

  it("rejects cancellation once the irreversible commit phase begins", async () => {
    let finishCommit!: () => void;
    gitServiceMocks.stageAllAndCommitWithPreCommit.mockImplementationOnce(
      async ({ onProgress }) => {
        onProgress("committing");
        await new Promise<void>((resolve) => {
          finishCommit = resolve;
        });
        return "commit-hash";
      },
    );
    const commit = handlerFor(gitContracts.commitChanges.channel);
    const cancel = handlerFor(gitContracts.cancelCommit.channel);
    const sender = {
      id: 99,
      isDestroyed: () => false,
      isCrashed: () => false,
      send: vi.fn(),
    };
    const commitPromise = commit(
      { sender },
      { appId: 1, message: "Save work", operationId: "commit:finishing" },
    );
    await vi.waitFor(() => expect(finishCommit).toBeDefined());

    await expect(
      cancel({ sender }, { appId: 1, operationId: "commit:finishing" }),
    ).resolves.toBe(false);
    finishCommit();
    await expect(commitPromise).resolves.toBe("commit-hash");
  });

  it("aborts an operation when its initiating renderer is destroyed", async () => {
    let receivedSignal: AbortSignal | undefined;
    gitServiceMocks.stageAllAndCommitWithPreCommit.mockImplementationOnce(
      async ({ signal }) => {
        receivedSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
        return "unreachable";
      },
    );
    const commit = handlerFor(gitContracts.commitChanges.channel);
    const sender = Object.assign(new EventEmitter(), {
      id: 99,
      isDestroyed: () => false,
      isCrashed: () => false,
      send: vi.fn(),
    });

    const commitPromise = commit(
      { sender },
      { appId: 1, message: "Save work", operationId: "commit:destroyed" },
    );
    await vi.waitFor(() => expect(receivedSignal).toBeDefined());

    sender.emit("destroyed");

    expect(receivedSignal?.aborted).toBe(true);
    await expect(commitPromise).rejects.toThrow("aborted");
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

describe("handleFetchFromGithub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.query.apps.findFirst).mockResolvedValue(mockApp as any);
    vi.mocked(readSettings).mockReturnValue({
      githubAccessToken: { value: "token" },
    } as any);
  });

  it("prunes so branches deleted on GitHub leave the branch list", async () => {
    await handleFetchFromGithub(mockEvent, { appId: 1 });

    expect(gitFetch).toHaveBeenCalledWith({
      path: "/mock/apps/test-app",
      remote: "origin",
      auth: {
        hostUrl: "https://github.com",
        username: "token",
        password: "x-oauth-basic",
      },
      prune: true,
    });
  });
});

/**
 * Switching and renaming record the branch the app is now on. Which column
 * that lands in decides which branch the next push uses, because
 * handlePushToGithub picks its refspec from resolveAppGitRemote — so these
 * assert the round trip, not just the column name.
 */
describe("recording the branch an app moved to", () => {
  const gitlabApp = {
    id: 7,
    path: "gitlab-app",
    githubOrg: null,
    githubRepo: null,
    githubBranch: null,
    gitlabHost: "https://gitlab.example.com",
    gitlabProjectId: 9,
    gitlabProjectPath: "team/demo",
    gitlabBranch: "main",
  };

  const githubApp = {
    id: 8,
    path: "github-app",
    githubOrg: "acme",
    githubRepo: "demo",
    githubBranch: "main",
    gitlabHost: null,
    gitlabProjectId: null,
    gitlabProjectPath: null,
    gitlabBranch: null,
  };

  /** The row as it stands after the writes this test recorded. */
  function rowAfterWrites<T extends object>(app: T): T {
    return Object.assign({}, app, ...dbWrites.updates);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    dbWrites.updates.length = 0;
  });

  it("switching a GitLab app moves the branch the push will use", async () => {
    vi.mocked(db.query.apps.findFirst).mockResolvedValue(gitlabApp as any);

    await handleSwitchBranch(mockEvent, { appId: 7, branch: "feature-x" });

    expect(dbWrites.updates).toEqual([{ gitlabBranch: "feature-x" }]);
    // The regression: github_branch used to move while gitlab_branch stayed,
    // so the next sync pushed main:main from a checkout sitting on feature-x
    // and still reported success.
    expect(resolveAppGitRemote(rowAfterWrites(gitlabApp))).toMatchObject({
      provider: "gitlab",
      branch: "feature-x",
    });
  });

  it("renaming the current branch of a GitLab app moves it too", async () => {
    vi.mocked(db.query.apps.findFirst).mockResolvedValue(gitlabApp as any);
    vi.mocked(gitCurrentBranch).mockResolvedValue("main");

    await handleRenameBranch(mockEvent, {
      appId: 7,
      oldBranch: "main",
      newBranch: "release",
    });

    expect(dbWrites.updates).toEqual([{ gitlabBranch: "release" }]);
    expect(resolveAppGitRemote(rowAfterWrites(gitlabApp))?.branch).toBe(
      "release",
    );
  });

  it("leaves the branch alone when renaming one the app is not on", async () => {
    vi.mocked(db.query.apps.findFirst).mockResolvedValue(gitlabApp as any);
    vi.mocked(gitCurrentBranch).mockResolvedValue("main");

    await handleRenameBranch(mockEvent, {
      appId: 7,
      oldBranch: "other",
      newBranch: "renamed",
    });

    expect(dbWrites.updates).toEqual([]);
  });

  it("switching a GitHub app still writes the GitHub column", async () => {
    vi.mocked(db.query.apps.findFirst).mockResolvedValue(githubApp as any);

    await handleSwitchBranch(mockEvent, { appId: 8, branch: "feature-y" });

    expect(dbWrites.updates).toEqual([{ githubBranch: "feature-y" }]);
    expect(resolveAppGitRemote(rowAfterWrites(githubApp))).toMatchObject({
      provider: "github",
      branch: "feature-y",
    });
  });

  it("no longer writes an empty repo name over a row it is not linking", async () => {
    // The old call passed `repo: app.githubRepo || ""`, which put an empty
    // string into github_repo for every app that was not linked to GitHub.
    vi.mocked(db.query.apps.findFirst).mockResolvedValue(gitlabApp as any);

    await handleSwitchBranch(mockEvent, { appId: 7, branch: "feature-x" });

    expect(dbWrites.updates[0]).not.toHaveProperty("githubRepo");
    expect(dbWrites.updates[0]).not.toHaveProperty("githubOrg");
  });

  it("records the branch of an unlinked app the way it always did", async () => {
    const unlinked = { id: 9, path: "unlinked" };
    vi.mocked(db.query.apps.findFirst).mockResolvedValue(unlinked as any);

    await handleSwitchBranch(mockEvent, { appId: 9, branch: "scratch" });

    expect(dbWrites.updates).toEqual([{ githubBranch: "scratch" }]);
  });
});
