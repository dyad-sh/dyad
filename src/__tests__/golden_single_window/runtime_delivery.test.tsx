import { act, render, renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppRunManager } from "@/app_run/manager";
import { AppRunProvider } from "@/app_run/AppRunProvider";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useAppOutputSubscription, useRunApp } from "@/hooks/useRunApp";
import { createImageGenerationCommandRunner } from "@/image_generation/commands";
import { ImageGenerationProvider } from "@/image_generation/ImageGenerationProvider";
import { ImageGenerationManager } from "@/image_generation/manager";
import { PackageManagerWarningProvider } from "@/package_manager_warnings/PackageManagerWarningProvider";
import { PackageManagerWarningStore } from "@/package_manager_warnings/store";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { createVersionPreviewRuntime } from "@/version_preview/commands";
import {
  DeferredPreviewErrorFacade,
  PreviewErrorFacadeProvider,
} from "@/app_wiring/preview_error_facade";

const mocks = vi.hoisted(() => ({
  appOutputBatchListeners: new Set<(outputs: any[]) => void>(),
  appOutputListeners: new Set<(output: any) => void>(),
  dismissImageGenerationToast: vi.fn(),
  generateImage: vi.fn(),
  runApp: vi.fn(),
  showImageGeneratingToast: vi.fn(),
  showImageSuccessToast: vi.fn(),
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
        runApp: mocks.runApp,
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
        generateImage: mocks.generateImage,
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

vi.mock("@/components/ImageGenerationToast", () => ({
  dismissImageGenerationToast: mocks.dismissImageGenerationToast,
  showImageGeneratingToast: mocks.showImageGeneratingToast,
  showImageSuccessToast: mocks.showImageSuccessToast,
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
  const previewErrors = new DeferredPreviewErrorFacade();
  const packageWarnings = new PackageManagerWarningStore();
  const manager = new AppRunManager(store, undefined, undefined, {
    previewErrors,
    packageWarnings,
  });
  store.set(selectedAppIdAtom, 7);
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <Provider store={store}>
        <PreviewErrorFacadeProvider facade={previewErrors}>
          <PackageManagerWarningProvider manager={packageWarnings}>
            <AppRunProvider manager={manager}>{children}</AppRunProvider>
          </PackageManagerWarningProvider>
        </PreviewErrorFacadeProvider>
      </Provider>
    );
  }
  return { manager, packageWarnings, store, Wrapper };
}

describe("golden single-window: runtime presentation delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appOutputBatchListeners.clear();
    mocks.appOutputListeners.clear();
    mocks.runApp.mockImplementation(() => {
      for (const listener of mocks.appOutputListeners) {
        listener({
          type: "stdout",
          message: "first line",
          appId: 7,
          timestamp: 123,
        });
      }
      return Promise.resolve();
    });
  });

  it("retains the first console line emitted at the app-start boundary", async () => {
    const { manager, Wrapper } = makeRunWrapper();
    const hook = renderHook(
      () => {
        useAppOutputSubscription();
        return useRunApp();
      },
      { wrapper: Wrapper },
    );

    await act(async () => {
      await hook.result.current.runApp(7);
    });

    // Protects the Phase B interest-keyed console fan-out.
    expect(mocks.runApp).toHaveBeenCalledOnce();
    expect(
      manager.previewConsole
        .getSnapshot(7)
        .filter((entry) => entry.message === "first line"),
    ).toEqual([expect.objectContaining({ timestamp: 123 })]);
    hook.unmount();
  });

  it("routes package warnings and consent prompts once to the selected app", () => {
    const { packageWarnings, Wrapper } = makeRunWrapper();
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

    expect(packageWarnings.getSnapshot(7)).toEqual({
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

  it("invalidates media and presents success once when generation settles", async () => {
    const queryClient = new QueryClient();
    const invalidate = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue(undefined);
    const result = {
      fileName: "generated.png",
      filePath: "/tmp/generated.png",
      appPath: "app",
      appId: 7,
      appName: "Golden app",
    };
    mocks.generateImage.mockResolvedValue(result);
    const manager = new ImageGenerationManager({
      clock: createFakeClock(10),
      idSource: createSequentialIdSource(),
      runner: createImageGenerationCommandRunner({ queryClient }),
    });
    const view = render(
      <ImageGenerationProvider manager={manager}>
        <div />
      </ImageGenerationProvider>,
    );

    act(() => {
      manager.submit({
        prompt: "A lighthouse",
        themeMode: "plain",
        targetAppId: 7,
        targetAppName: "Golden app",
      });
    });

    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["media"] });
    expect(mocks.showImageSuccessToast).toHaveBeenCalledExactlyOnceWith(
      result,
      expect.any(Function),
    );
    view.unmount();
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
