import { describe, expect, it, vi } from "vitest";
import { VersionPreviewActorService } from "./version_preview_actor_service";

const service = vi.hoisted(() => ({
  beginAppDeletion: vi.fn(),
  endAppDeletion: vi.fn(),
  settle: vi.fn(async () => undefined),
}));
const persistence = vi.hoisted(() => ({
  remove: vi.fn(),
  removeAll: vi.fn(),
}));

vi.mock("./version_preview_service", () => ({
  versionPreviewService: service,
}));
vi.mock("./version_preview_persistence", () => ({
  versionPreviewPersistence: persistence,
}));

describe("VersionPreviewActorService", () => {
  it("records close compensation and settles it before entity disposal", async () => {
    const send = vi.fn();
    const host = {
      peek: vi.fn(() => ({
        getSnapshot: () => ({
          state: {
            type: "checking-out",
            session: {
              appId: 7,
              originBranch: "feature/origin",
              targetVersionId: "abc123",
              checkedOutVersionId: null,
              exitIntent: { type: "none" },
              selectedDiffFile: null,
              isDiffVisible: false,
            },
          },
        }),
        send,
      })),
      disposeKey: vi.fn(async () => undefined),
      disposeMachine: vi.fn(async () => undefined),
    };
    const actors = new VersionPreviewActorService(host as never);

    actors.beginAppDeletion(7);
    await actors.prepareAppDeletion(7);
    await actors.disposeApp(7);
    actors.endAppDeletion(7);

    expect(service.beginAppDeletion).toHaveBeenCalledWith(7);
    expect(send).toHaveBeenCalledWith({
      type: "CLOSE",
      operationId: "version-preview:delete:7",
    });
    expect(service.settle).toHaveBeenCalledWith(7);
    expect(host.disposeKey).toHaveBeenCalledAfter(service.settle);
    expect(service.endAppDeletion).toHaveBeenCalledWith(7);
  });

  it("retries the retained return branch before deleting a recovery actor", async () => {
    const send = vi.fn();
    const host = {
      peek: vi.fn(() => ({
        getSnapshot: () => ({
          state: {
            type: "recovery-required",
            session: {
              appId: 7,
              originBranch: "feature/origin",
              targetVersionId: "abc123",
              checkedOutVersionId: "abc123",
              exitIntent: { type: "close" },
              selectedDiffFile: null,
              isDiffVisible: false,
            },
            error: { message: "return failed", kind: "external" },
          },
        }),
        send,
      })),
      disposeKey: vi.fn(async () => undefined),
      disposeMachine: vi.fn(async () => undefined),
    };
    const actors = new VersionPreviewActorService(host as never);

    await actors.prepareAppDeletion(7);

    expect(send).toHaveBeenCalledWith({
      type: "RETRY_RETURN",
      operationId: "version-preview:delete:7",
    });
    expect(service.settle).toHaveBeenCalledWith(7);
  });

  it("removes persisted state even when no actor was instantiated", async () => {
    const host = {
      peek: vi.fn(() => undefined),
      disposeKey: vi.fn(async () => undefined),
      disposeMachine: vi.fn(async () => undefined),
    };
    const actors = new VersionPreviewActorService(host as never);

    await actors.disposeApp(7);
    await actors.disposeAllApps();

    expect(persistence.remove).toHaveBeenCalledWith(7);
    expect(persistence.removeAll).toHaveBeenCalled();
  });
});
