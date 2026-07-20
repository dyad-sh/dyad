import { renderHook, act } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  currentConsoleEntriesAtom,
  currentAppUrlAtom,
  currentPackageManagerWarningAtom,
  currentPreviewAppExitAtom,
  currentPreviewErrorAtom,
  currentPreviewLoadingAtom,
  currentPreviewReloadTokenAtom,
  setConsoleEntriesForAppAtom,
  setPreviewRunStateForAppAtom,
} from "@/atoms/previewRuntimeAtoms";
import {
  useAppOutputSubscription,
  useRebuildAppAfterPnpmInstall,
  useRunApp,
} from "@/hooks/useRunApp";

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
  store.set(selectedAppIdAtom, appId);

  return {
    store,
    Wrapper({ children }: PropsWithChildren) {
      return <Provider store={store}>{children}</Provider>;
    },
  };
}

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

  it("shows throttled sync failure toasts and clears sync errors after recovery", () => {
    const { store, Wrapper } = makeWrapper(1);
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

    expect(showErrorMock).toHaveBeenCalledTimes(1);
    expect(store.get(currentPreviewErrorAtom)).toEqual({
      message: "Cloud sandbox sync failed: network down",
      source: "dyad-sync",
    });
    expect(store.get(currentConsoleEntriesAtom)).toHaveLength(1);

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

    expect(store.get(currentPreviewErrorAtom)).toBeUndefined();
    expect(
      store.get(currentConsoleEntriesAtom).map((entry) => entry.message),
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

  it("tracks app process exit without adding an extra console log", () => {
    const { store, Wrapper } = makeWrapper(1);
    const { unmount } = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

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

    expect(store.get(currentPreviewAppExitAtom)).toEqual({
      appId: 1,
      exitCode: 1,
      timestamp: 123,
    });
    expect(store.get(currentConsoleEntriesAtom)).toEqual([]);

    unmount();
  });

  it("reloads the preview when the proxy reports a ready URL", () => {
    const { store, Wrapper } = makeWrapper(1);
    const { unmount } = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    expect(store.get(currentPreviewReloadTokenAtom)).toBe(0);
    act(() => {
      store.set(setPreviewRunStateForAppAtom, {
        appId: 1,
        state: { operation: "run", startedAt: 100 },
      });
    });
    expect(store.get(currentPreviewLoadingAtom)).toBe(true);

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

    expect(store.get(currentAppUrlAtom)).toEqual({
      appUrl: "http://localhost:42101",
      appId: 1,
      originalUrl: "http://localhost:32101",
      mode: "host",
    });
    expect(store.get(currentPreviewReloadTokenAtom)).toBe(1);
    expect(store.get(currentPreviewLoadingAtom)).toBe(false);

    unmount();
  });

  it("stores pnpm warning state for the current preview app", () => {
    settingsMock.current = {
      enablePnpmMinimumReleaseAgeWarning: true,
    };
    const { store, Wrapper } = makeWrapper(1);
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

    expect(store.get(currentPackageManagerWarningAtom)).toEqual({
      kind: "release-age",
      message: "Install pnpm 10.16.0 or newer for the strongest protection",
      appId: 1,
    });

    unmount();
  });

  it("does not store pnpm warning state when the experiment is disabled", () => {
    const { store, Wrapper } = makeWrapper(1);
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

    expect(store.get(currentPackageManagerWarningAtom)).toBeUndefined();

    unmount();
  });

  it("stores pnpm migration warnings even when the release-age warning setting is disabled", () => {
    settingsMock.current = {
      hidePnpmMinimumReleaseAgeWarning: true,
    };
    const { store, Wrapper } = makeWrapper(1);
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

    expect(store.get(currentPackageManagerWarningAtom)).toEqual({
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
    const { store, Wrapper } = makeWrapper(1);
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

    expect(store.get(currentPackageManagerWarningAtom)).toBeUndefined();

    act(() => {
      store.set(selectedAppIdAtom, 2);
    });

    expect(store.get(currentPackageManagerWarningAtom)).toEqual({
      kind: "release-age",
      message: "Install pnpm 10.16.0 or newer for the strongest protection",
      appId: 2,
    });

    unmount();
  });

  it("stores app output by app so background logs do not overwrite the selected app", () => {
    const { store, Wrapper } = makeWrapper(1);
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

    expect(store.get(currentConsoleEntriesAtom)).toEqual([]);

    act(() => {
      store.set(selectedAppIdAtom, 2);
    });

    expect(
      store.get(currentConsoleEntriesAtom).map((entry) => entry.message),
    ).toEqual(["Background app log"]);

    unmount();
  });

  it("does not affect visible app logs when a background pnpm warning is stored", () => {
    settingsMock.current = {
      enablePnpmMinimumReleaseAgeWarning: true,
    };
    const { store, Wrapper } = makeWrapper(1);
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
      store.set(setConsoleEntriesForAppAtom, {
        appId: 2,
        entries: [
          {
            level: "info",
            type: "server",
            message: "Current app log",
            appId: 2,
            timestamp: Date.now(),
          },
        ],
      });
    });

    expect(store.get(currentPackageManagerWarningAtom)).toBeUndefined();
    expect(
      store.get(currentConsoleEntriesAtom).map((entry) => entry.message),
    ).toEqual(["Current app log"]);

    act(() => {
      store.set(selectedAppIdAtom, 1);
    });

    expect(store.get(currentPackageManagerWarningAtom)).toEqual({
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
      removeNodeModules: false,
      recreateSandbox: false,
    });
  });
});
