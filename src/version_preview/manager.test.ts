import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import type { VersionPreviewRuntime } from "./controller";
import { VersionPreviewManager } from "./manager";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function makeRuntime(): VersionPreviewRuntime {
  return {
    notifyError: vi.fn(),
    notifyRecovery: vi.fn(),
    dismissRecovery: vi.fn(),
    commands: {
      resolveOriginBranch: vi.fn().mockResolvedValue({ branch: "feature/a" }),
      checkoutVersion: vi.fn().mockResolvedValue(undefined),
      returnToBranch: vi.fn().mockResolvedValue(undefined),
      restoreVersion: vi.fn().mockResolvedValue(undefined),
      restoreToMessage: vi.fn().mockResolvedValue(undefined),
    },
  };
}

async function preview(manager: VersionPreviewManager, appId: number) {
  manager.send(appId, { type: "OPEN", appId });
  manager.send(appId, { type: "SELECT_VERSION", versionId: "v1" });
  await flush();
  await flush();
  expect(manager.getSnapshot(appId).type).toBe("previewing");
}

describe("VersionPreviewManager", () => {
  it("drains the previous app directly from the selected-app store", async () => {
    const store = createStore();
    store.set(selectedAppIdAtom, 1);
    const runtime = makeRuntime();
    const manager = new VersionPreviewManager(runtime, store);
    await preview(manager, 1);

    store.set(selectedAppIdAtom, 2);
    expect(manager.getSnapshot(1).type).toBe("returning");
    await flush();
    expect(manager.getSnapshot(1).type).toBe("closed");
    expect(runtime.commands.returnToBranch).toHaveBeenCalledWith({
      appId: 1,
      branch: "feature/a",
    });
    manager.dispose();
  });

  it("notifies only subscribers for the changed app", () => {
    const manager = new VersionPreviewManager(makeRuntime(), createStore());
    const one = vi.fn();
    const two = vi.fn();
    manager.subscribeKey(1, one);
    manager.subscribeKey(2, two);
    manager.send(1, { type: "OPEN", appId: 1 });
    expect(one).toHaveBeenCalledOnce();
    expect(two).not.toHaveBeenCalled();
    manager.dispose();
  });

  it("keeps separate state across manager instances", () => {
    const first = new VersionPreviewManager(makeRuntime(), createStore());
    const second = new VersionPreviewManager(makeRuntime(), createStore());
    first.send(1, { type: "OPEN", appId: 1 });
    expect(first.getSnapshot(1).type).toBe("browsing");
    expect(second.getSnapshot(1).type).toBe("closed");
    first.dispose();
    second.dispose();
  });

  it("derives recovery entries and dismisses the toast when disposing an app", async () => {
    const runtime = makeRuntime();
    vi.mocked(runtime.commands.returnToBranch).mockRejectedValue(
      new Error("return failed"),
    );
    const manager = new VersionPreviewManager(runtime, createStore());
    await preview(manager, 1);
    manager.send(1, { type: "CLOSE" });
    await flush();

    expect(manager.getRecoveryEntries()).toMatchObject([
      { appId: 1, error: { message: "return failed" } },
    ]);
    expect(runtime.notifyRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 1 }),
    );

    manager.disposeApp(1);
    expect(runtime.dismissRecovery).toHaveBeenCalledWith(1);
    expect(manager.getRecoveryEntries()).toEqual([]);
    manager.dispose();
  });
});
