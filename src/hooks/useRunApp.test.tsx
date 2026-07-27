import { renderHook, act } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  runAppLifecycleInBackground,
  useAppOutputSubscription,
  useRebuildAppAfterPnpmInstall,
  useRunApp,
} from "@/hooks/useRunApp";
import { useAppRunState } from "@/hooks/useAppRun";
import { AppRunProvider } from "@/app_run/AppRunProvider";
import { selectAppExit, selectAppUrl } from "@/app_run/selectors";
import { AppRunManager } from "@/app_run/manager";
import {
  DeferredPreviewErrorFacade,
  PreviewErrorFacadeProvider,
} from "@/app_wiring/preview_error_facade";
import { PackageManagerWarningProvider } from "@/package_manager_warnings/PackageManagerWarningProvider";
import { PackageManagerWarningStore } from "@/package_manager_warnings/store";
import { PreviewIframeManager } from "@/preview_iframe/manager";
import { PreviewIframeProvider } from "@/preview_iframe/PreviewIframeProvider";
import { createPreviewIframeCommandAdapter } from "@/preview_iframe/commands";

const {
  addLogMock,
  appOutputBatchListeners,
  appOutputBatchSubscribeMock,
  appOutputListeners,
  appOutputSubscribeMock,
  clearLogsMock,
  respondToAppInputMock,
  restartAppMock,
  runAppMock,
  settingsMock,
  showErrorMock,
  showInputRequestMock,
  stopAppMock,
  updateSettingsMock,
} = vi.hoisted(() => ({
  addLogMock: vi.fn(),
  appOutputBatchListeners: new Set<(outputs: unknown[]) => void>(),
  appOutputBatchSubscribeMock: vi.fn(),
  appOutputListeners: new Set<(output: unknown) => void>(),
  appOutputSubscribeMock: vi.fn(),
  clearLogsMock: vi.fn(),
  respondToAppInputMock: vi.fn(),
  restartAppMock: vi.fn(),
  runAppMock: vi.fn(),
  settingsMock: {
    current: {} as
      | {
          enablePnpmMinimumReleaseAgeWarning?: boolean;
          hidePnpmMinimumReleaseAgeWarning?: boolean;
        }
      | undefined,
  },
  showErrorMock: vi.fn(),
  showInputRequestMock: vi.fn(),
  stopAppMock: vi.fn(),
  updateSettingsMock: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    app: {
      respondToAppInput: respondToAppInputMock,
      restartApp: restartAppMock,
      runApp: runAppMock,
      stopApp: stopAppMock,
    },
    misc: {
      addLog: addLogMock,
      clearLogs: clearLogsMock,
    },
    events: {
      misc: {
        onAppOutput: (listener: (output: unknown) => void) => {
          appOutputSubscribeMock();
          appOutputListeners.add(listener);
          return () => appOutputListeners.delete(listener);
        },
        onAppOutputBatch: (listener: (outputs: unknown[]) => void) => {
          appOutputBatchSubscribeMock();
          appOutputBatchListeners.add(listener);
          return () => appOutputBatchListeners.delete(listener);
        },
      },
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  showError: showErrorMock,
  showInputRequest: showInputRequestMock,
}));

vi.mock("./useSettings", () => ({
  useSettings: () => ({
    settings: settingsMock.current,
    updateSettings: updateSettingsMock,
  }),
}));

function makeWrapper(appId: number) {
  const store = createStore();
  const previewErrors = new DeferredPreviewErrorFacade();
  const packageWarnings = new PackageManagerWarningStore();
  const manager = new AppRunManager(store, undefined, undefined, {
    previewErrors,
    packageWarnings,
  });
  const previewIframeManager = new PreviewIframeManager(
    createPreviewIframeCommandAdapter(store),
  );
  store.set(selectedAppIdAtom, appId);

  return {
    manager,
    packageWarnings,
    previewIframeManager,
    store,
    Wrapper({ children }: PropsWithChildren) {
      return (
        <Provider store={store}>
          <PreviewErrorFacadeProvider facade={previewErrors}>
            <PackageManagerWarningProvider manager={packageWarnings}>
              <AppRunProvider manager={manager}>
                <PreviewIframeProvider
                  appRunState={manager}
                  manager={previewIframeManager}
                >
                  {children}
                </PreviewIframeProvider>
              </AppRunProvider>
            </PackageManagerWarningProvider>
          </PreviewErrorFacadeProvider>
        </Provider>
      );
    },
  };
}

describe("useAppRunState", () => {
  it("does not subscribe to a real app when no app is selected", () => {
    const { manager, Wrapper } = makeWrapper(1);
    const subscribe = vi.spyOn(manager, "subscribeKey");

    const { result } = renderHook(() => useAppRunState(null), {
      wrapper: Wrapper,
    });

    expect(result.current.phase).toBe("idle");
    expect(subscribe).not.toHaveBeenCalled();
  });
});

describe("useAppOutputSubscription", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    addLogMock.mockReset();
    appOutputListeners.clear();
    appOutputBatchListeners.clear();
    appOutputSubscribeMock.mockReset();
    appOutputBatchSubscribeMock.mockReset();
    clearLogsMock.mockReset();
    respondToAppInputMock.mockReset();
    restartAppMock.mockReset();
    runAppMock.mockReset();
    settingsMock.current = {};
    showErrorMock.mockReset();
    showInputRequestMock.mockReset();
    stopAppMock.mockReset();
    updateSettingsMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows throttled sync failure toasts and clears sync errors after recovery", async () => {
    const { manager, previewIframeManager, Wrapper } = makeWrapper(1);
    const { unmount } = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    expect(appOutputListeners.size).toBe(1);
    expect(appOutputBatchListeners.size).toBe(1);

    const emitOutput = (output: {
      type: string;
      message: string;
      appId: number;
    }) => {
      act(() => {
        for (const listener of appOutputListeners) {
          listener(output);
        }
      });
    };

    emitOutput({
      type: "sync-error",
      message: "Cloud sandbox sync failed: network down",
      appId: 1,
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(showErrorMock).toHaveBeenCalledTimes(1);
    expect(previewIframeManager.getSnapshot(1).error).toEqual({
      message: "Cloud sandbox sync failed: network down",
      source: "dyad-sync",
    });
    expect(manager.previewConsole.getSnapshot(1)).toHaveLength(1);

    emitOutput({
      type: "sync-error",
      message: "Cloud sandbox sync failed: network down",
      appId: 1,
    });

    expect(showErrorMock).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    emitOutput({
      type: "sync-error",
      message: "Cloud sandbox sync failed: network down",
      appId: 1,
    });

    expect(showErrorMock).toHaveBeenCalledTimes(2);

    emitOutput({
      type: "sync-recovered",
      message:
        "Cloud sandbox sync recovered. Local changes are uploading again.",
      appId: 1,
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(previewIframeManager.getSnapshot(1).error).toBeUndefined();
    expect(
      manager.previewConsole.getSnapshot(1).map((entry) => entry.message),
    ).toContain(
      "Cloud sandbox sync recovered. Local changes are uploading again.",
    );

    unmount();

    expect(appOutputListeners.size).toBe(0);
    expect(appOutputBatchListeners.size).toBe(0);
  });

  it("does not resubscribe to app output events when settings change", () => {
    const { Wrapper } = makeWrapper(1);
    const { rerender, unmount } = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    expect(appOutputSubscribeMock).toHaveBeenCalledTimes(1);
    expect(appOutputBatchSubscribeMock).toHaveBeenCalledTimes(1);

    settingsMock.current = { hidePnpmMinimumReleaseAgeWarning: true };
    rerender();

    expect(appOutputSubscribeMock).toHaveBeenCalledTimes(1);
    expect(appOutputBatchSubscribeMock).toHaveBeenCalledTimes(1);
    expect(appOutputListeners.size).toBe(1);
    expect(appOutputBatchListeners.size).toBe(1);

    unmount();
  });

  it("tracks app process exit without adding an extra console log", async () => {
    const { manager, Wrapper } = makeWrapper(1);
    const { unmount } = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await manager.dispatch(1, { type: "START", startedAt: 100 });
    });
    const consoleEntriesBeforeExit = manager.previewConsole.getSnapshot(1);

    act(() => {
      for (const listener of appOutputListeners) {
        listener({
          type: "app-exit",
          message: "App process exited with code 1",
          appId: 1,
          exitCode: 1,
          timestamp: 123,
        });
      }
    });

    expect(selectAppExit(manager.getSnapshot(1))).toEqual({
      appId: 1,
      exitCode: 1,
      timestamp: 123,
    });
    expect(manager.previewConsole.getSnapshot(1)).toBe(
      consoleEntriesBeforeExit,
    );

    unmount();
  });

  it("retains an exit that arrives before the run IPC settles", async () => {
    const { manager, Wrapper } = makeWrapper(1);
    let finishRunApp: () => void = () => {};
    runAppMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishRunApp = resolve;
      }),
    );
    const { unmount } = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    const pendingRun = manager.dispatch(1, { type: "START", startedAt: 100 });
    await act(async () => {
      await Promise.resolve();
    });
    const runCall = runAppMock.mock.calls[0];
    if (!runCall) throw new Error("expected run IPC call");

    act(() => {
      for (const listener of appOutputListeners) {
        listener({
          type: "app-exit",
          message: "App process exited before startup settled",
          appId: 1,
          invocationRef: runCall[0].invocationRef,
          exitCode: 1,
          timestamp: 123,
        });
      }
    });

    expect(selectAppExit(manager.getSnapshot(1))).toEqual({
      appId: 1,
      exitCode: 1,
      timestamp: 123,
    });

    finishRunApp();
    await pendingRun;
    expect(selectAppExit(manager.getSnapshot(1))).toEqual({
      appId: 1,
      exitCode: 1,
      timestamp: 123,
    });
    unmount();
  });

  it("does not project a stale exit from a superseded invocation", async () => {
    const { manager, Wrapper } = makeWrapper(1);
    let finishRunApp: () => void = () => {};
    runAppMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishRunApp = resolve;
      }),
    );
    let finishRestartApp: () => void = () => {};
    restartAppMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishRestartApp = resolve;
      }),
    );
    const { unmount } = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    const oldRun = manager.dispatch(1, { type: "START", startedAt: 100 });
    await act(async () => {
      await Promise.resolve();
    });
    const firstCall = runAppMock.mock.calls[0];
    if (!firstCall) throw new Error("expected run IPC call");
    const oldRef = firstCall[0].invocationRef;

    const replacement = manager.dispatch(1, {
      type: "RESTART",
      startedAt: 200,
      options: { removeNodeModules: false, recreateSandbox: false },
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      for (const listener of appOutputListeners) {
        listener({
          type: "app-exit",
          message: "Old process failed",
          appId: 1,
          invocationRef: oldRef,
          exitCode: 1,
          timestamp: 250,
        });
      }
    });

    expect(selectAppExit(manager.getSnapshot(1))).toBeNull();
    expect(manager.getSnapshot(1)).toMatchObject({
      type: "starting",
      startedAt: 200,
    });

    finishRunApp();
    await oldRun;
    finishRestartApp();
    await replacement;
    unmount();
  });

  it("reloads the preview after the proxy URL commits", async () => {
    const { manager, Wrapper } = makeWrapper(1);
    const { unmount } = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    expect(manager.getReloadToken(1)).toBe(0);
    await act(async () => {
      for (const listener of appOutputListeners) {
        listener({
          type: "stdout",
          appId: 1,
          message:
            "[dyad-proxy-server]started=[http://localhost:42101] original=[http://localhost:32101] mode=[host]",
        });
      }
      await Promise.resolve();
    });

    expect(selectAppUrl(manager.getSnapshot(1))).toEqual({
      appUrl: "http://localhost:42101",
      appId: 1,
      originalUrl: "http://localhost:32101",
      mode: "host",
    });
    expect(manager.getReloadToken(1)).toBe(1);
    expect(manager.getSnapshot(1).type).toBe("ready");

    unmount();
  });

  it("stores pnpm warning state for the current preview app", () => {
    settingsMock.current = {
      enablePnpmMinimumReleaseAgeWarning: true,
    };
    const { packageWarnings, Wrapper } = makeWrapper(1);
    const { unmount } = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    act(() => {
      for (const listener of appOutputListeners) {
        listener({
          type: "package-manager-warning",
          warningKind: "release-age",
          message: "Install pnpm 10.16.0 or newer for the strongest protection",
          appId: 1,
        });
      }
    });

    expect(packageWarnings.getSnapshot(1)).toEqual({
      kind: "release-age",
      message: "Install pnpm 10.16.0 or newer for the strongest protection",
      appId: 1,
    });

    unmount();
  });

  it("does not store pnpm warning state when the experiment is disabled", () => {
    const { packageWarnings, Wrapper } = makeWrapper(1);
    const { unmount } = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    act(() => {
      for (const listener of appOutputListeners) {
        listener({
          type: "package-manager-warning",
          warningKind: "release-age",
          message: "Install pnpm 10.16.0 or newer for the strongest protection",
          appId: 1,
        });
      }
    });

    expect(packageWarnings.getSnapshot(1)).toBeUndefined();

    unmount();
  });

  it("stores pnpm migration warnings even when the release-age warning setting is disabled", () => {
    settingsMock.current = {
      hidePnpmMinimumReleaseAgeWarning: true,
    };
    const { packageWarnings, Wrapper } = makeWrapper(1);
    const { unmount } = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    act(() => {
      for (const listener of appOutputListeners) {
        listener({
          type: "package-manager-warning",
          warningKind: "pnpm-migration",
          message:
            "This app pins an older pnpm that can't read the lockfile Dyad writes.",
          appId: 1,
        });
      }
    });

    expect(packageWarnings.getSnapshot(1)).toEqual({
      kind: "pnpm-migration",
      message:
        "This app pins an older pnpm that can't read the lockfile Dyad writes.",
      appId: 1,
    });

    unmount();
  });

  it("stores pnpm warning state for the Dyad session from a background app", () => {
    settingsMock.current = {
      enablePnpmMinimumReleaseAgeWarning: true,
    };
    const { packageWarnings, store, Wrapper } = makeWrapper(1);
    const { unmount } = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    act(() => {
      for (const listener of appOutputListeners) {
        listener({
          type: "package-manager-warning",
          warningKind: "release-age",
          message: "Install pnpm 10.16.0 or newer for the strongest protection",
          appId: 2,
        });
      }
    });

    expect(packageWarnings.getSnapshot(1)).toBeUndefined();

    act(() => {
      store.set(selectedAppIdAtom, 2);
    });

    expect(packageWarnings.getSnapshot(2)).toEqual({
      kind: "release-age",
      message: "Install pnpm 10.16.0 or newer for the strongest protection",
      appId: 2,
    });

    unmount();
  });

  it("stores app output by app so background logs do not overwrite the selected app", () => {
    const { manager, store, Wrapper } = makeWrapper(1);
    const { unmount } = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    act(() => {
      for (const listener of appOutputBatchListeners) {
        listener([
          {
            type: "stdout",
            message: "Background app log",
            appId: 2,
          },
        ]);
      }
    });

    expect(manager.previewConsole.getSnapshot(1)).toEqual([]);

    act(() => {
      store.set(selectedAppIdAtom, 2);
    });

    expect(
      manager.previewConsole.getSnapshot(2).map((entry) => entry.message),
    ).toEqual(["Background app log"]);

    unmount();
  });

  it("does not affect visible app logs when a background pnpm warning is stored", () => {
    settingsMock.current = {
      enablePnpmMinimumReleaseAgeWarning: true,
    };
    const { manager, packageWarnings, store, Wrapper } = makeWrapper(1);
    const { unmount } = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    act(() => {
      for (const listener of appOutputListeners) {
        listener({
          type: "package-manager-warning",
          warningKind: "release-age",
          message: "Install pnpm 10.16.0 or newer for the strongest protection",
          appId: 1,
        });
      }
      store.set(selectedAppIdAtom, 2);
      manager.previewConsole.replace(2, [
        {
          level: "info",
          type: "server",
          message: "Current app log",
          appId: 2,
          timestamp: Date.now(),
        },
      ]);
    });

    expect(packageWarnings.getSnapshot(2)).toBeUndefined();
    expect(
      manager.previewConsole.getSnapshot(2).map((entry) => entry.message),
    ).toEqual(["Current app log"]);

    act(() => {
      store.set(selectedAppIdAtom, 1);
    });

    expect(packageWarnings.getSnapshot(1)).toEqual({
      kind: "release-age",
      message: "Install pnpm 10.16.0 or newer for the strongest protection",
      appId: 1,
    });

    unmount();
  });

  it("keeps run loading scoped to the operation app", async () => {
    const { store, Wrapper } = makeWrapper(1);
    let finishRunApp: () => void = () => {};
    runAppMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishRunApp = resolve;
      }),
    );

    const { result, unmount } = renderHook(() => useRunApp(), {
      wrapper: Wrapper,
    });

    let runPromise = Promise.resolve();
    await act(async () => {
      runPromise = result.current.runApp(1);
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(true);

    act(() => {
      store.set(selectedAppIdAtom, 2);
    });

    expect(result.current.loading).toBe(false);

    act(() => {
      store.set(selectedAppIdAtom, 1);
    });

    expect(result.current.loading).toBe(true);

    await act(async () => {
      finishRunApp();
      await runPromise;
    });

    expect(result.current.loading).toBe(false);

    unmount();
  });

  it("keeps a restart's loading state when a cached proxy line arrives, then applies the buffered URL", async () => {
    const { manager, Wrapper } = makeWrapper(1);
    let finishRestartApp: () => void = () => {};
    restartAppMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishRestartApp = resolve;
      }),
    );

    const { result, unmount } = renderHook(
      () => {
        useAppOutputSubscription();
        return useRunApp();
      },
      { wrapper: Wrapper },
    );

    let restartPromise = Promise.resolve();
    await act(async () => {
      restartPromise = result.current.restartApp();
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(true);
    const tokenBefore = manager.getReloadToken(1);

    // A cached proxy line (re-emitted for an already-running app before the
    // restart) arrives while the restart IPC is still in flight.
    act(() => {
      for (const listener of appOutputListeners) {
        listener({
          type: "stdout",
          appId: 1,
          message:
            "[dyad-proxy-server]started=[http://localhost:42101] original=[http://localhost:32101] mode=[host]",
        });
      }
    });

    // It must NOT clear the restart's loading state or apply the URL yet.
    expect(result.current.loading).toBe(true);
    expect(manager.getSnapshot(1).type).toBe("starting");
    expect(selectAppUrl(manager.getSnapshot(1)).appUrl).toBeNull();

    await act(async () => {
      finishRestartApp();
      await restartPromise;
    });

    expect(result.current.loading).toBe(false);
    expect(selectAppUrl(manager.getSnapshot(1))).toEqual({
      appUrl: "http://localhost:42101",
      appId: 1,
      originalUrl: "http://localhost:32101",
      mode: "host",
    });
    expect(manager.getReloadToken(1)).toBeGreaterThan(tokenBefore);

    unmount();
  });

  it("ignores a superseded run's late resolution after a restart begins", async () => {
    const { manager, Wrapper } = makeWrapper(1);
    let finishRunApp: () => void = () => {};
    runAppMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishRunApp = resolve;
      }),
    );
    let finishRestartApp: () => void = () => {};
    restartAppMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishRestartApp = resolve;
      }),
    );

    const { result, unmount } = renderHook(() => useRunApp(), {
      wrapper: Wrapper,
    });

    let runPromise = Promise.resolve();
    await act(async () => {
      runPromise = result.current.runApp(1);
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(true);

    let restartPromise = Promise.resolve();
    await act(async () => {
      restartPromise = result.current.restartApp();
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(true);

    // The first run's IPC promise settles late: previously its `finally`
    // cleared the restart's fresh loading state (last writer wins).
    await act(async () => {
      finishRunApp();
      await runPromise;
    });
    expect(result.current.loading).toBe(true);
    expect(manager.getSnapshot(1).type).toBe("starting");

    await act(async () => {
      finishRestartApp();
      await restartPromise;
    });
    expect(result.current.loading).toBe(false);

    unmount();
  });

  it("settles stopApp and clears loading when the stop IPC throws synchronously", async () => {
    const { manager, previewIframeManager, Wrapper } = makeWrapper(1);
    stopAppMock.mockImplementationOnce(() => {
      throw new Error("ipc channel broken");
    });

    const { result, unmount } = renderHook(() => useRunApp(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      // Must resolve (not hang) even though stopApp threw synchronously.
      await result.current.stopApp(1);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(manager.getSnapshot(1).type).toBe("errored");
    expect(previewIframeManager.getSnapshot(1).error).toEqual({
      message: "ipc channel broken",
      source: "dyad-app",
    });

    unmount();
  });

  it("keeps pnpm rebuild loading scoped to the rebuilt app", async () => {
    const { store, Wrapper } = makeWrapper(1);
    let finishRestartApp: () => void = () => {};
    restartAppMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishRestartApp = resolve;
      }),
    );

    const { result, unmount } = renderHook(
      () => {
        const rebuildAppAfterPnpmInstall = useRebuildAppAfterPnpmInstall();
        const runAppState = useRunApp();
        return { rebuildAppAfterPnpmInstall, runAppState };
      },
      {
        wrapper: Wrapper,
      },
    );

    let installPromise = Promise.resolve();
    await act(async () => {
      installPromise = result.current.rebuildAppAfterPnpmInstall(1);
      await Promise.resolve();
    });

    expect(result.current.runAppState.loading).toBe(true);

    act(() => {
      store.set(selectedAppIdAtom, 2);
    });

    expect(result.current.runAppState.loading).toBe(false);

    await act(async () => {
      finishRestartApp();
      await installPromise;
    });

    expect(result.current.runAppState.loading).toBe(false);

    unmount();
  });

  it("can restart an explicitly targeted app after selection changes", async () => {
    const { Wrapper } = makeWrapper(1);
    restartAppMock.mockResolvedValue(undefined);
    clearLogsMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useRunApp(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.restartApp({ appId: 2 });
    });

    expect(clearLogsMock).toHaveBeenCalledWith({ appId: 2 });
    expect(restartAppMock).toHaveBeenCalledWith({
      appId: 2,
      invocationRef: expect.objectContaining({
        kind: "app-run",
        entityKey: 2,
      }),
      removeNodeModules: false,
      recreateSandbox: false,
    });
  });
});

describe("runAppLifecycleInBackground", () => {
  it("handles lifecycle rejection without changing awaited dispatch semantics", async () => {
    const error = new Error("spawn failed");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    runAppLifecycleInBackground("start", Promise.reject(error));
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        "[app-run] Failed to start app:",
        error,
      );
    });

    consoleError.mockRestore();
  });
});
