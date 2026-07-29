import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRunRemoteProvider } from "@/app_run/AppRunRemoteProvider";
import { AppRunRemoteManager } from "@/app_run/remote_manager";
import { TestAppRunRemoteConnection } from "@/app_run/testing";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useAppRunState } from "@/hooks/useAppRun";
import {
  DeferredPreviewErrorFacade,
  PreviewErrorFacadeProvider,
} from "@/app_wiring/preview_error_facade";
import { PackageManagerWarningProvider } from "@/package_manager_warnings/PackageManagerWarningProvider";
import { PackageManagerWarningStore } from "@/package_manager_warnings/store";
import { createSequentialIdSource } from "@/state_machines/testing";
import {
  runAppLifecycleInBackground,
  useAppOutputSubscription,
  useRebuildAppAfterPnpmInstall,
  useRunApp,
} from "./useRunApp";

const mocks = vi.hoisted(() => ({
  addLog: vi.fn(),
  appOutputBatchListeners: new Set<(outputs: any[]) => void>(),
  appOutputListeners: new Set<(output: any) => void>(),
  respondToAppInput: vi.fn(),
  settings: {
    current: {} as
      | {
          enablePnpmMinimumReleaseAgeWarning?: boolean;
          hidePnpmMinimumReleaseAgeWarning?: boolean;
        }
      | undefined,
  },
  showError: vi.fn(),
  showInputRequest: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    app: { respondToAppInput: mocks.respondToAppInput },
    misc: { addLog: mocks.addLog },
    events: {
      misc: {
        onAppOutput: (listener: (output: any) => void) => {
          mocks.appOutputListeners.add(listener);
          return () => mocks.appOutputListeners.delete(listener);
        },
        onAppOutputBatch: (listener: (outputs: any[]) => void) => {
          mocks.appOutputBatchListeners.add(listener);
          return () => mocks.appOutputBatchListeners.delete(listener);
        },
      },
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  showError: mocks.showError,
  showInputRequest: mocks.showInputRequest,
}));

vi.mock("./useSettings", () => ({
  useSettings: () => ({ settings: mocks.settings.current }),
}));

function makeWrapper(appId: number) {
  const store = createStore();
  const previewErrors = new DeferredPreviewErrorFacade();
  const packageWarnings = new PackageManagerWarningStore();
  const connection = new TestAppRunRemoteConnection();
  const manager = new AppRunRemoteManager(
    createSequentialIdSource(),
    connection,
  );
  store.set(selectedAppIdAtom, appId);

  return {
    connection,
    manager,
    packageWarnings,
    store,
    Wrapper({ children }: PropsWithChildren) {
      return (
        <Provider store={store}>
          <PreviewErrorFacadeProvider facade={previewErrors}>
            <PackageManagerWarningProvider manager={packageWarnings}>
              <AppRunRemoteProvider manager={manager}>
                {children}
              </AppRunRemoteProvider>
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

function emitOutput(output: any): void {
  act(() => {
    for (const listener of mocks.appOutputListeners) listener(output);
  });
}

describe("useAppOutputSubscription", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.addLog.mockReset();
    mocks.appOutputBatchListeners.clear();
    mocks.appOutputListeners.clear();
    mocks.respondToAppInput.mockReset();
    mocks.settings.current = {};
    mocks.showError.mockReset();
    mocks.showInputRequest.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it("keeps lifecycle output presentation-only", async () => {
    const { connection, manager, Wrapper } = makeWrapper(1);
    const hook = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    emitOutput({
      type: "app-exit",
      message: "App process exited",
      appId: 1,
      exitCode: 1,
      timestamp: 123,
    });
    emitOutput({
      type: "stdout",
      appId: 1,
      message:
        "[dyad-proxy-server]started=[http://localhost:42101] original=[http://localhost:32101] mode=[host]",
    });
    emitOutput({
      type: "stdout",
      appId: 1,
      message: "[vite] hmr update",
    });
    await act(async () => Promise.resolve());

    expect(connection.dispatches).toEqual([]);
    expect(manager.getSnapshot(1)).toMatchObject({
      phase: "idle",
      exit: null,
      previewReloadEpoch: 0,
    });
    expect(manager.previewConsole.getSnapshot(1)).toHaveLength(2);
    hook.unmount();
  });

  it("shows throttled sync errors and records recovery presentation", () => {
    const { manager, Wrapper } = makeWrapper(1);
    const hook = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    emitOutput({
      type: "sync-error",
      message: "Cloud sandbox sync failed",
      appId: 1,
    });
    emitOutput({
      type: "sync-error",
      message: "Cloud sandbox sync failed",
      appId: 1,
    });
    expect(mocks.showError).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(30_000));
    emitOutput({
      type: "sync-error",
      message: "Cloud sandbox sync failed",
      appId: 1,
    });
    emitOutput({
      type: "sync-recovered",
      message: "Cloud sandbox sync recovered",
      appId: 1,
    });

    expect(mocks.showError).toHaveBeenCalledTimes(2);
    expect(
      manager.previewConsole.getSnapshot(1).map((entry) => entry.message),
    ).toContain("Cloud sandbox sync recovered");
    hook.unmount();
  });

  it("keeps console and package warnings keyed by app", () => {
    mocks.settings.current = { enablePnpmMinimumReleaseAgeWarning: true };
    const { manager, packageWarnings, Wrapper } = makeWrapper(1);
    const hook = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    act(() => {
      for (const listener of mocks.appOutputBatchListeners) {
        listener([{ type: "stdout", message: "background", appId: 2 }]);
      }
    });
    emitOutput({
      type: "package-manager-warning",
      warningKind: "release-age",
      message: "Upgrade pnpm",
      appId: 2,
    });

    expect(manager.previewConsole.getSnapshot(1)).toEqual([]);
    expect(
      manager.previewConsole.getSnapshot(2).map((entry) => entry.message),
    ).toContain("background");
    expect(packageWarnings.getSnapshot(2)).toMatchObject({
      message: "Upgrade pnpm",
    });
    hook.unmount();
  });
});

describe("useRunApp remote intents", () => {
  it("dispatches start, restart, stop, and rebuild through the remote actor", async () => {
    const { connection, Wrapper } = makeWrapper(1);
    const hook = renderHook(
      () => ({
        run: useRunApp(),
        rebuild: useRebuildAppAfterPnpmInstall(),
      }),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await hook.result.current.run.runApp(1);
      await hook.result.current.run.restartApp({ appId: 2 });
      await hook.result.current.run.stopApp(1);
      await hook.result.current.rebuild(3);
    });

    expect(connection.dispatches.map((event) => event.type)).toEqual([
      "START",
      "RESTART",
      "STOP_REQUESTED",
      "RESTART",
    ]);
    expect(connection.dispatches[1]).toMatchObject({
      type: "RESTART",
      operation: "restart",
    });
    expect(connection.dispatches[3]).toMatchObject({
      type: "RESTART",
      operation: "rebuild",
    });
  });

  it("keeps the run callback stable across mutation state renders", async () => {
    const { Wrapper } = makeWrapper(1);
    const hook = renderHook(() => useRunApp(), { wrapper: Wrapper });
    const initialRunApp = hook.result.current.runApp;

    await act(async () => {
      await hook.result.current.runApp(1);
    });

    expect(hook.result.current.runApp).toBe(initialRunApp);
  });

  it("keeps package warnings mounted until restart dispatches", async () => {
    const { connection, packageWarnings, Wrapper } = makeWrapper(1);
    packageWarnings.setWarning(1, {
      kind: "pnpm-migration",
      message: "Migrate pnpm",
    });
    connection.onDispatch = (_appId, event) => {
      if (event.type === "RESTART") {
        expect(packageWarnings.getSnapshot(1)).toBeDefined();
      }
    };
    const hook = renderHook(() => useRunApp(), { wrapper: Wrapper });

    await act(async () => {
      await hook.result.current.restartApp();
    });

    expect(packageWarnings.getSnapshot(1)).toBeUndefined();
  });

  it("preserves a package warning emitted during restart", async () => {
    const { connection, packageWarnings, Wrapper } = makeWrapper(1);
    connection.onDispatch = (_appId, event) => {
      if (event.type === "RESTART") {
        packageWarnings.setWarning(1, {
          kind: "pnpm-migration",
          message: "Migrate pnpm",
        });
      }
    };
    const hook = renderHook(() => useRunApp(), { wrapper: Wrapper });

    await act(async () => {
      await hook.result.current.restartApp();
    });

    expect(packageWarnings.getSnapshot(1)).toMatchObject({
      kind: "pnpm-migration",
      message: "Migrate pnpm",
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
