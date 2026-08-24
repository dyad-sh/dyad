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
  registerGithubBranchHandlers,
} from "@/ipc/handlers/git_branch_handlers";
import {
  gitListBranches,
  gitListRemoteBranches,
  gitDeleteBranch,
} from "@/ipc/utils/git_utils";
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
