import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  findFirst: vi.fn(async () => ({ path: "app" })),
}));
const git = vi.hoisted(() => ({
  getCurrentCommitHash: vi.fn(async () => "live-head"),
  getGitUncommittedFilesWithStatus: vi.fn(async () => []),
  gitCurrentBranch: vi.fn(async () => "main"),
}));
const handlers = vi.hoisted(() => ({
  revertVersion: vi.fn(),
  restoreToMessage: vi.fn(),
  checkoutVersion: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: { query: { apps: { findFirst: database.findFirst } } },
}));
vi.mock("@/db/schema", () => ({ apps: { id: "id" } }));
vi.mock("@/paths/paths", () => ({ getDyadAppPath: () => "/test/app" }));
vi.mock("../utils/git_utils", () => git);
vi.mock("../handlers/version_handlers", () => ({
  versionPreviewHandlerService: handlers,
}));
vi.mock("./version_preview_presentation_service", () => ({
  versionPreviewPresentationService: { originEndpointFor: vi.fn() },
}));

import { VersionPreviewService } from "./version_preview_service";

describe("VersionPreviewService reconciliation admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.findFirst.mockResolvedValue({ path: "app" });
    git.getCurrentCommitHash.mockResolvedValue("live-head");
    git.gitCurrentBranch.mockResolvedValue("main");
    git.getGitUncommittedFilesWithStatus.mockResolvedValue([]);
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
});
