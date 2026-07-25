import { act, renderHook } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppRunManager } from "@/app_run/manager";
import { AppRunProvider } from "@/app_run/AppRunProvider";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  currentConsoleEntriesAtom,
  currentPackageManagerWarningAtom,
} from "@/atoms/previewRuntimeAtoms";
import { useAppOutputSubscription } from "@/hooks/useRunApp";
import { createImageGenerationCommandRunner } from "@/image_generation/commands";
import { createVersionPreviewRuntime } from "@/version_preview/commands";

const mocks = vi.hoisted(() => ({
  appOutputBatchListeners: new Set<(outputs: any[]) => void>(),
  appOutputListeners: new Set<(output: any) => void>(),
  showInputRequest: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/ipc/types", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ipc/types")>();
  return {
    ...original,
    ipc: {
      ...original.ipc,
      app: {
        ...original.ipc.app,
        respondToAppInput: vi.fn().mockResolvedValue(undefined),
      },
      events: {
        ...original.ipc.events,
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
      imageGeneration: {
        ...original.ipc.imageGeneration,
        generateImage: vi.fn(),
        cancelImageGeneration: vi.fn(),
      },
      misc: {
        ...original.ipc.misc,
        addLog: vi.fn(),
      },
    },
  };
});

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: { enablePnpmMinimumReleaseAgeWarning: true },
  }),
}));

vi.mock("@/lib/toast", () => ({
  showError: vi.fn(),
  showInputRequest: mocks.showInputRequest,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: mocks.toastError,
    dismiss: vi.fn(),
  },
}));

function makeRunWrapper() {
  const store = createStore();
  const manager = new AppRunManager(store);
  store.set(selectedAppIdAtom, 7);
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <Provider store={store}>
        <AppRunProvider manager={manager}>{children}</AppRunProvider>
      </Provider>
    );
  }
  return { store, Wrapper };
}

describe("golden single-window: runtime presentation delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appOutputBatchListeners.clear();
    mocks.appOutputListeners.clear();
  });

  it("retains the first console line emitted immediately after subscription", () => {
    const { store, Wrapper } = makeRunWrapper();
    const hook = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    act(() => {
      for (const listener of mocks.appOutputListeners) {
        listener({
          type: "stdout",
          message: "first line",
          appId: 7,
          timestamp: 123,
        });
      }
    });

    // Protects the Phase B interest-keyed console fan-out.
    expect(store.get(currentConsoleEntriesAtom)).toEqual([
      expect.objectContaining({ message: "first line", timestamp: 123 }),
    ]);
    hook.unmount();
  });

  it("routes package warnings and consent prompts once to the selected app", () => {
    const { store, Wrapper } = makeRunWrapper();
    const hook = renderHook(() => useAppOutputSubscription(), {
      wrapper: Wrapper,
    });

    act(() => {
      for (const listener of mocks.appOutputListeners) {
        listener({
          type: "package-manager-warning",
          warningKind: "release-age",
          message: "Upgrade pnpm",
          appId: 7,
        });
        listener({
          type: "input-requested",
          message: "Proceed with install?",
          appId: 7,
        });
      }
    });

    expect(store.get(currentPackageManagerWarningAtom)).toEqual({
      kind: "release-age",
      message: "Upgrade pnpm",
      appId: 7,
    });
    expect(mocks.showInputRequest).toHaveBeenCalledExactlyOnceWith(
      "Proceed with install?",
      expect.any(Function),
    );
    hook.unmount();
  });

  it("invalidates media exactly once when image generation settles", () => {
    const queryClient = new QueryClient();
    const invalidate = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    const runner = createImageGenerationCommandRunner({ queryClient });

    runner.run({ type: "InvalidateMediaQueries" }, vi.fn());

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["media"] });
  });

  it("shows one stable recovery toast for version-preview recovery", () => {
    const runtime = createVersionPreviewRuntime({
      queryClient: new QueryClient(),
      store: createStore(),
      restartApp: vi.fn().mockResolvedValue(undefined),
    });
    const retry = vi.fn();

    runtime.notifyRecovery({
      appId: 7,
      error: new Error("return failed"),
      retry,
    });

    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
      "Unable to return to the branch that was active before previewing this version.",
      expect.objectContaining({
        id: "version-preview-recovery-7",
        duration: Infinity,
        action: { label: "Retry", onClick: retry },
      }),
    );
  });
});
