import { renderHook, act } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appConsoleEntriesAtom,
  previewAppExitAtom,
  previewErrorMessageAtom,
  selectedAppIdAtom,
} from "@/atoms/appAtoms";
import { useAppOutputSubscription, useRunApp } from "@/hooks/useRunApp";

const {
  addLogMock,
  appOutputBatchListeners,
  appOutputBatchSubscribeMock,
  appOutputListeners,
  appOutputSubscribeMock,
  clearLogsMock,
  installPnpmMock,
  openExternalUrlMock,
  respondToAppInputMock,
  restartAppMock,
  settingsMock,
  showErrorMock,
  showInputRequestMock,
  showPnpmMinimumReleaseAgeWarningMock,
  updateSettingsMock,
} = vi.hoisted(() => ({
  addLogMock: vi.fn(),
  appOutputBatchListeners: new Set<(outputs: unknown[]) => void>(),
  appOutputBatchSubscribeMock: vi.fn(),
  appOutputListeners: new Set<(output: unknown) => void>(),
  appOutputSubscribeMock: vi.fn(),
  clearLogsMock: vi.fn(),
  installPnpmMock: vi.fn(),
  openExternalUrlMock: vi.fn(),
  respondToAppInputMock: vi.fn(),
  restartAppMock: vi.fn(),
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
  showPnpmMinimumReleaseAgeWarningMock: vi.fn(),
  updateSettingsMock: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    app: {
      respondToAppInput: respondToAppInputMock,
      restartApp: restartAppMock,
    },
    misc: {
      addLog: addLogMock,
      clearLogs: clearLogsMock,
    },
    system: {
      installPnpm: installPnpmMock,
      openExternalUrl: openExternalUrlMock,
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
  showPnpmMinimumReleaseAgeWarning: showPnpmMinimumReleaseAgeWarningMock,
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
    installPnpmMock.mockReset();
    openExternalUrlMock.mockReset();
    respondToAppInputMock.mockReset();
    restartAppMock.mockReset();
    settingsMock.current = {};
    showErrorMock.mockReset();
    showInputRequestMock.mockReset();
    showPnpmMinimumReleaseAgeWarningMock.mockReset();
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
    expect(store.get(previewErrorMessageAtom)).toEqual({
      message: "Cloud sandbox sync failed: network down",
      source: "dyad-sync",
    });
    expect(store.get(appConsoleEntriesAtom)).toHaveLength(1);

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

    expect(store.get(previewErrorMessageAtom)).toBeUndefined();
    expect(
      store.get(appConsoleEntriesAtom).map((entry) => entry.message),
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

    expect(store.get(previewAppExitAtom)).toEqual({
      appId: 1,
      exitCode: 1,
      timestamp: 123,
    });
    expect(store.get(appConsoleEntriesAtom)).toEqual([]);

    unmount();
  });

  it("shows pnpm warning toast with install and docs actions", async () => {
    settingsMock.current = {
      enablePnpmMinimumReleaseAgeWarning: true,
    };
    const { Wrapper } = makeWrapper(1);
    const { unmount } = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    act(() => {
      for (const listener of appOutputListeners) {
        listener({
          type: "package-manager-warning",
          message: "Install pnpm 10.16.0 or newer for the strongest protection",
          appId: 1,
        });
      }
    });

    expect(showPnpmMinimumReleaseAgeWarningMock).toHaveBeenCalledTimes(1);
    const toastArgs = showPnpmMinimumReleaseAgeWarningMock.mock.calls[0][0];

    await act(async () => {
      await toastArgs.onInstallPnpm();
      await Promise.resolve();
    });
    expect(installPnpmMock).toHaveBeenCalledTimes(1);
    expect(clearLogsMock).toHaveBeenCalledWith({ appId: 1 });
    expect(restartAppMock).toHaveBeenCalledWith({
      appId: 1,
      removeNodeModules: true,
      recreateSandbox: false,
    });

    toastArgs.onOpenDocs();
    expect(openExternalUrlMock).toHaveBeenCalledWith(
      "https://pnpm.io/installation",
    );

    unmount();
  });

  it("does not show pnpm warning toast when the experiment is disabled", () => {
    const { Wrapper } = makeWrapper(1);
    const { unmount } = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    act(() => {
      for (const listener of appOutputListeners) {
        listener({
          type: "package-manager-warning",
          message: "Install pnpm 10.16.0 or newer for the strongest protection",
          appId: 1,
        });
      }
    });

    expect(showPnpmMinimumReleaseAgeWarningMock).not.toHaveBeenCalled();

    unmount();
  });

  it("does not clear visible app logs when a stale pnpm toast rebuilds another app", async () => {
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
          message: "Install pnpm 10.16.0 or newer for the strongest protection",
          appId: 1,
        });
      }
      store.set(selectedAppIdAtom, 2);
      store.set(appConsoleEntriesAtom, [
        {
          level: "info",
          type: "server",
          message: "Current app log",
          appId: 2,
          timestamp: Date.now(),
        },
      ]);
    });

    const toastArgs = showPnpmMinimumReleaseAgeWarningMock.mock.calls[0][0];
    await act(async () => {
      await toastArgs.onInstallPnpm();
    });

    expect(clearLogsMock).toHaveBeenCalledWith({ appId: 1 });
    expect(restartAppMock).toHaveBeenCalledWith({
      appId: 1,
      removeNodeModules: true,
      recreateSandbox: false,
    });
    expect(
      store.get(appConsoleEntriesAtom).map((entry) => entry.message),
    ).toEqual(["Current app log"]);

    unmount();
  });

  it("clears pnpm rebuild loading when the selected app changes mid-rebuild", async () => {
    settingsMock.current = {
      enablePnpmMinimumReleaseAgeWarning: true,
    };
    const { store, Wrapper } = makeWrapper(1);
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
      {
        wrapper: Wrapper,
      },
    );

    act(() => {
      for (const listener of appOutputListeners) {
        listener({
          type: "package-manager-warning",
          message: "Install pnpm 10.16.0 or newer for the strongest protection",
          appId: 1,
        });
      }
    });

    const toastArgs = showPnpmMinimumReleaseAgeWarningMock.mock.calls[0][0];
    let installPromise = Promise.resolve();
    await act(async () => {
      installPromise = toastArgs.onInstallPnpm();
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(true);

    act(() => {
      store.set(selectedAppIdAtom, 2);
    });

    await act(async () => {
      finishRestartApp();
      await installPromise;
    });

    expect(result.current.loading).toBe(false);

    unmount();
  });
});
