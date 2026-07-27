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

  it("returns the repository only after the last window releases interest", () => {
    const send = vi.fn();
    const host = {
      peek: vi.fn(() => ({
        getSnapshot: () => ({
          state: {
            type: "previewing",
            session: {
              appId: 7,
              originBranch: "main",
              targetVersionId: "abc123",
              checkedOutVersionId: "abc123",
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
    const owners = new Map<number, Set<number>>();
    const interests = {
      acquire: (appId: number, webContentsId: number) => {
        const appOwners = owners.get(appId) ?? new Set<number>();
        appOwners.add(webContentsId);
        owners.set(appId, appOwners);
      },
      release: (appId: number, webContentsId: number) => {
        const appOwners = owners.get(appId);
        if (!appOwners?.delete(webContentsId)) return "not-owned" as const;
        if (appOwners.size > 0) return "retained-by-other-window" as const;
        owners.delete(appId);
        return "last-owner-released" as const;
      },
      isLastOwner: (appId: number, webContentsId: number) => {
        const appOwners = owners.get(appId);
        return appOwners?.size === 1 && appOwners.has(webContentsId);
      },
      clearApp: vi.fn(),
      clearAll: vi.fn(),
    };
    const presentation = { recordInitiator: vi.fn() };
    const actors = new VersionPreviewActorService(
      host as never,
      interests as never,
      presentation as never,
    );
    actors.acquireWindowInterest(7, 1);
    actors.acquireWindowInterest(7, 2);

    expect(
      actors.releaseWindowInterest({
        appId: 7,
        webContentsId: 1,
        windowSessionId: "window-1",
        operationId: "leave-1",
        exit: { type: "switch-app", nextAppId: 8 },
      }),
    ).toBe(false);
    expect(send).not.toHaveBeenCalled();

    expect(
      actors.releaseWindowInterest({
        appId: 7,
        webContentsId: 2,
        windowSessionId: "window-2",
        operationId: "leave-2",
        exit: { type: "switch-app", nextAppId: 8 },
      }),
    ).toBe(true);
    expect(presentation.recordInitiator).toHaveBeenCalledWith(
      "leave-2",
      "window-2",
    );
    expect(send).toHaveBeenCalledWith({
      type: "APP_CHANGED",
      nextAppId: 8,
      operationId: "leave-2",
    });
  });

  it("retains the last window interest when initiator admission is full", () => {
    const send = vi.fn();
    const host = {
      peek: vi.fn(() => ({
        getSnapshot: () => ({
          state: {
            type: "previewing",
            session: {
              appId: 7,
              originBranch: "main",
              targetVersionId: "abc123",
              checkedOutVersionId: "abc123",
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
    const owners = new Set([1]);
    const interests = {
      acquire: vi.fn(),
      isLastOwner: vi.fn(() => owners.size === 1 && owners.has(1)),
      release: vi.fn(() => {
        owners.delete(1);
        return "last-owner-released" as const;
      }),
      clearApp: vi.fn(),
      clearAll: vi.fn(),
    };
    const capacityError = new Error("initiator capacity exhausted");
    const presentation = {
      recordInitiator: vi.fn(() => {
        throw capacityError;
      }),
    };
    const actors = new VersionPreviewActorService(
      host as never,
      interests as never,
      presentation as never,
    );

    expect(() =>
      actors.releaseWindowInterest({
        appId: 7,
        webContentsId: 1,
        windowSessionId: "window-1",
        operationId: "leave-1",
        exit: { type: "close" },
      }),
    ).toThrow(capacityError);
    expect(interests.release).not.toHaveBeenCalled();
    expect(owners).toEqual(new Set([1]));
    expect(send).not.toHaveBeenCalled();
  });
});
