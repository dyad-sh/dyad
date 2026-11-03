import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  findFirst: vi.fn(async () => ({ path: "app" })),
}));
const git = vi.hoisted(() => ({
  getCurrentCommitHash: vi.fn(async () => "live-head"),
  getGitUncommittedFilesWithStatus: vi.fn(async () => []),
  gitAddAll: vi.fn(async () => undefined),
  gitCommit: vi.fn(async () => "saved-head"),
  gitCurrentBranch: vi.fn(async () => "main"),
  inspectRepositoryHealth: vi.fn(async () => ({
    branch: "main" as string | null,
    headOid: "live-head",
    isClean: true,
    unmergedFiles: [] as string[],
    operationInProgress: null as
      | "merge"
      | "rebase"
      | "cherry-pick"
      | "revert"
      | "bisect"
      | null,
  })),
}));
const appFolder = vi.hoisted(() => ({
  assertAppFolderExists: vi.fn(async (_appPath: string) => undefined),
  assertAppGitRepository: vi.fn(async (_appPath: string) => undefined),
}));
const handlers = vi.hoisted(() => ({
  revertVersion: vi.fn(),
  restoreToMessage: vi.fn(),
  checkoutVersion: vi.fn(),
}));
const coordination = vi.hoisted(() => ({
  requests: [] as Array<Record<string, unknown>>,
  hasActiveActor: vi.fn(async () => false),
  hasActiveLegacy: vi.fn(async () => false),
  releaseActor: vi.fn(),
  releaseStreams: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: { query: { apps: { findFirst: database.findFirst } } },
}));
vi.mock("@/db/schema", () => ({ apps: { id: "id" } }));
vi.mock("@/paths/paths", () => ({ getDyadAppPath: () => "/test/app" }));
vi.mock("node:fs", () => ({
  default: { existsSync: vi.fn(() => true) },
}));
vi.mock("../utils/git_utils", () => git);
vi.mock("@/ipc/utils/app_git_repository", () => appFolder);
vi.mock("./app_operation_coordinator", () => ({
  readAppResource: (resource: string) => `read:${resource}`,
  appOperationCoordinator: {
    run: (
      request: Record<string, unknown>,
      operation: () => Promise<unknown>,
    ) => {
      coordination.requests.push(request);
      return operation();
    },
  },
}));
vi.mock("./chat_actor_service", () => ({
  beginAppChatActorMutation: vi.fn(async () => coordination.releaseActor),
  hasActiveAppChatActors: coordination.hasActiveActor,
}));
vi.mock("../handlers/chat_stream_handlers", () => ({
  blockNewStreamsForApp: vi.fn(() => coordination.releaseStreams),
  hasActiveStreamsForApp: coordination.hasActiveLegacy,
}));
vi.mock("../handlers/version_handlers", () => ({
  versionPreviewHandlerService: handlers,
}));
vi.mock("./version_preview_presentation_service", () => ({
  versionPreviewPresentationService: { originEndpointFor: vi.fn() },
}));

import fs from "node:fs";
import { VersionPreviewService } from "./version_preview_service";

describe("VersionPreviewService reconciliation admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coordination.requests.length = 0;
    database.findFirst.mockResolvedValue({ path: "app" });
    git.getCurrentCommitHash.mockResolvedValue("live-head");
    git.gitCurrentBranch.mockResolvedValue("main");
    git.getGitUncommittedFilesWithStatus.mockResolvedValue([]);
    git.gitCommit.mockResolvedValue("saved-head");
    git.inspectRepositoryHealth.mockResolvedValue({
      branch: "main",
      headOid: "live-head",
      isClean: true,
      unmergedFiles: [],
      operationInProgress: null,
    });
  });

  it("blocks renderer intents until startup reconciliation settles", () => {
    const service = new VersionPreviewService();

    service.beginReconciliation(7);
    expect(() => service.assertReadyForIntent(7)).toThrow(
      "Version preview is reconciling after restart",
    );

    service.endReconciliation(7);
    expect(() => service.assertReadyForIntent(7)).not.toThrow();
  });

  it("checkpoints the intended branch and HEAD before starting a Git restore", async () => {
    handlers.revertVersion.mockResolvedValue({
      repositoryOutcome: "target-applied",
      notification: null,
      runtimeAction: "none",
      affectedChatId: null,
      createdChatId: null,
    });
    const progress: unknown[] = [];
    const service = new VersionPreviewService();

    await service.run(
      {
        type: "restore",
        appId: 7,
        versionId: "target-head",
        targetBranch: null,
      },
      "restore-1",
      (checkpoint) => progress.push(checkpoint),
    );

    expect(progress).toEqual([
      {
        preRestoreHead: "live-head",
        preRestoreBranch: "main",
        targetHead: "target-head",
        nextStep: "preparing",
      },
    ]);
    expect(handlers.revertVersion).toHaveBeenCalledOnce();
  });

  it("does not persist a fact-free checkpoint before a chat-only restore", async () => {
    handlers.restoreToMessage.mockResolvedValue({
      repositoryOutcome: "unchanged",
      notification: null,
      runtimeAction: "none",
      affectedChatId: null,
      createdChatId: 9,
    });
    const progress: unknown[] = [];
    const service = new VersionPreviewService();

    await service.run(
      {
        type: "restore-to-message",
        appId: 7,
        chatId: 2,
        messageId: 3,
        restoreCodebase: false,
        targetBranch: null,
      },
      "restore-2",
      (checkpoint) => progress.push(checkpoint),
    );

    expect(progress).toEqual([]);
    expect(git.getCurrentCommitHash).not.toHaveBeenCalled();
    expect(handlers.restoreToMessage).toHaveBeenCalledOnce();
  });

  it("accepts only a clean repository on a named branch", async () => {
    const service = new VersionPreviewService();

    await expect(service.validateCurrentRepository(7)).resolves.toEqual({
      kind: "healthy",
      branch: "main",
      headOid: "live-head",
    });

    git.inspectRepositoryHealth.mockResolvedValueOnce({
      branch: null,
      headOid: "live-head",
      isClean: true,
      unmergedFiles: [],
      operationInProgress: null,
    });
    await expect(service.validateCurrentRepository(7)).resolves.toMatchObject({
      kind: "blocked",
      assessment: { type: "blocked", blocker: "detached-head" },
    });
  });

  it("explains a missing app folder when the repository is missing", async () => {
    const service = new VersionPreviewService();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    appFolder.assertAppFolderExists.mockRejectedValueOnce(
      new Error(
        "App folder not found: '/test/app'. It may have been moved or deleted.",
      ),
    );

    try {
      await expect(service.validateCurrentRepository(7)).resolves.toMatchObject(
        {
          kind: "blocked",
          assessment: { type: "blocked", blocker: "missing-repository" },
          message:
            "App folder not found: '/test/app'. It may have been moved or deleted.",
        },
      );
      expect(appFolder.assertAppFolderExists).toHaveBeenCalledWith("/test/app");

      // A folder without .git keeps the generic message.
      await expect(service.validateCurrentRepository(7)).resolves.toMatchObject(
        {
          kind: "blocked",
          message: "The project repository could not be found.",
        },
      );
    } finally {
      vi.mocked(fs.existsSync).mockReturnValue(true);
    }
  });

  it("refuses recovery actions during recording instead of queueing silently", async () => {
    const service = new VersionPreviewService();

    await service.validateCurrentRepository(7);
    await service.checkpointCurrentRepository(7);

    expect(coordination.requests).toEqual([
      expect.objectContaining({
        operation: "validate-current-version",
        refuseWhenRecording: "use the current version",
      }),
      expect.objectContaining({
        operation: "checkpoint-current-version",
        refuseWhenRecording: "save the current version",
      }),
    ]);
  });

  it("refuses repository recovery while a generation is active", async () => {
    coordination.hasActiveActor.mockResolvedValueOnce(true);
    const service = new VersionPreviewService();

    await expect(service.checkpointCurrentRepository(7)).rejects.toThrow(
      "Stop the active generation",
    );
    expect(coordination.requests).toHaveLength(0);
    expect(coordination.releaseActor).toHaveBeenCalledOnce();
    expect(coordination.releaseStreams).toHaveBeenCalledOnce();
    expect(git.gitAddAll).not.toHaveBeenCalled();
  });

  it("checkpoints a dirty repository with a visible recovery version", async () => {
    git.inspectRepositoryHealth
      .mockResolvedValueOnce({
        branch: "main",
        headOid: "live-head",
        isClean: false,
        unmergedFiles: [],
        operationInProgress: null,
      })
      .mockResolvedValueOnce({
        branch: "main",
        headOid: "saved-head",
        isClean: true,
        unmergedFiles: [],
        operationInProgress: null,
      });
    const service = new VersionPreviewService();

    await expect(service.checkpointCurrentRepository(7)).resolves.toEqual({
      kind: "healthy",
      branch: "main",
      headOid: "saved-head",
      savedVersionId: "saved-head",
    });
    expect(git.gitAddAll).toHaveBeenCalledWith({ path: "/test/app" });
    expect(git.gitCommit).toHaveBeenCalledWith({
      path: "/test/app",
      message:
        "[Recovery] Saved current changes before continuing Version History",
    });
  });

  it("does not mutate a conflicted repository", async () => {
    git.inspectRepositoryHealth.mockResolvedValueOnce({
      branch: "main",
      headOid: "live-head",
      isClean: false,
      unmergedFiles: ["src/conflicted.ts"],
      operationInProgress: "merge",
    });
    const service = new VersionPreviewService();

    await expect(service.checkpointCurrentRepository(7)).resolves.toMatchObject(
      {
        kind: "blocked",
        assessment: { type: "blocked", blocker: "conflicted" },
      },
    );
    expect(git.gitAddAll).not.toHaveBeenCalled();
    expect(git.gitCommit).not.toHaveBeenCalled();
  });
});
