import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewRunStateByAppIdAtom } from "@/atoms/previewRuntimeAtoms";
import { AppRunManager } from "./manager";

const { addLogMock, clearLogsMock, restartAppMock, runAppMock, stopAppMock } =
  vi.hoisted(() => ({
    addLogMock: vi.fn(),
    clearLogsMock: vi.fn(),
    restartAppMock: vi.fn(),
    runAppMock: vi.fn(),
    stopAppMock: vi.fn(),
  }));

vi.mock("@/ipc/types", () => ({
  ipc: {
    app: {
      restartApp: restartAppMock,
      runApp: runAppMock,
      stopApp: stopAppMock,
    },
    misc: {
      addLog: addLogMock,
      clearLogs: clearLogsMock,
    },
  },
}));

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("AppRunManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLogsMock.mockResolvedValue(undefined);
    restartAppMock.mockResolvedValue(undefined);
    runAppMock.mockResolvedValue(undefined);
    stopAppMock.mockResolvedValue(undefined);
  });

  it("isolates manager instances backed by separate stores", async () => {
    const storeA = createStore();
    const storeB = createStore();
    const managerA = new AppRunManager(storeA);
    const managerB = new AppRunManager(storeB);

    const pending = managerA.dispatch(7, { type: "START", startedAt: 100 });

    expect(managerA.getSnapshot(7)).toMatchObject({ type: "starting" });
    expect(managerB.getSnapshot(7)).toEqual({ type: "idle" });
    expect(storeA.get(previewRunStateByAppIdAtom).get(7)).toEqual({
      operation: "run",
      startedAt: 100,
    });
    expect(storeB.get(previewRunStateByAppIdAtom).has(7)).toBe(false);

    managerA.dispose();
    managerB.dispose();
    await pending;
  });

  it("dispose resolves dispatch and blocks late projection writes", async () => {
    const run = deferred();
    runAppMock.mockReturnValueOnce(run.promise);
    const store = createStore();
    const manager = new AppRunManager(store);

    const pending = manager.dispatch(7, { type: "START", startedAt: 100 });
    expect(manager.getSnapshot(7)).toMatchObject({ type: "starting" });

    manager.dispose();
    await pending;

    const marker = { operation: "restart" as const, startedAt: 999 };
    store.set(previewRunStateByAppIdAtom, new Map([[7, marker]]));
    run.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(store.get(previewRunStateByAppIdAtom).get(7)).toBe(marker);
  });

  it("disposeKey for app A leaves app B's in-flight run untouched", async () => {
    const runA = deferred();
    const runB = deferred();
    runAppMock.mockImplementation(({ appId }: { appId: number }) =>
      appId === 1 ? runA.promise : runB.promise,
    );
    const store = createStore();
    const manager = new AppRunManager(store);

    const pendingA = manager.dispatch(1, { type: "START", startedAt: 100 });
    let appBSettled = false;
    const pendingB = manager
      .dispatch(2, { type: "START", startedAt: 200 })
      .then(() => {
        appBSettled = true;
      });

    manager.disposeKey(1);
    await pendingA;
    expect(manager.getSnapshot(1)).toEqual({ type: "idle" });
    expect(manager.getSnapshot(2)).toMatchObject({ type: "starting" });
    expect(appBSettled).toBe(false);

    runA.resolve();
    await Promise.resolve();
    expect(manager.getSnapshot(2)).toMatchObject({ type: "starting" });

    runB.resolve();
    await pendingB;
    expect(manager.getSnapshot(2)).toMatchObject({ type: "ready" });
    manager.dispose();
  });
});
