import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { AppRunProvider } from "@/app_run/AppRunProvider";
import { AppRunManager } from "@/app_run/manager";
import type { AppRunInvocationRef } from "@/app_run/state";
import {
  EntityDisposalProvider,
  useEntityDisposal,
} from "@/state_machines/react";
import { PreviewIframeProvider } from "./PreviewIframeProvider";
import {
  usePreviewIframeController,
  useSendPreviewIframeEvent,
} from "./usePreviewIframe";
import {
  PreviewErrorFacadeProvider,
  usePreviewErrorFacade,
} from "@/app_wiring/preview_error_facade";

function makeWrapper(store = createStore()) {
  const appRunManager = new AppRunManager(store);
  return {
    appRunManager,
    Wrapper({ children }: { children: ReactNode }) {
      return (
        <EntityDisposalProvider>
          <Provider store={store}>
            <PreviewErrorFacadeProvider>
              <AppRunProvider manager={appRunManager}>
                <PreviewIframeProvider appRunState={appRunManager}>
                  {children}
                </PreviewIframeProvider>
              </AppRunProvider>
            </PreviewErrorFacadeProvider>
          </Provider>
        </EntityDisposalProvider>
      );
    },
  };
}

describe("useSendPreviewIframeEvent", () => {
  it("does not subscribe the caller to preview iframe state changes", () => {
    let renderCount = 0;
    const { result } = renderHook(
      () => {
        renderCount += 1;
        return useSendPreviewIframeEvent(1);
      },
      { wrapper: makeWrapper().Wrapper },
    );
    const initialRenderCount = renderCount;

    act(() => result.current({ type: "SELECTOR_READY" }));

    expect(renderCount).toBe(initialRenderCount);
  });

  it.each(["restart", "rebuild"] as const)(
    "resets preserved navigation when a %s begins",
    async (operation) => {
      const store = createStore();
      const { Wrapper, appRunManager } = makeWrapper(store);
      const { result } = renderHook(() => usePreviewIframeController(1), {
        wrapper: Wrapper,
      });

      act(() => {
        result.current.send({
          type: "APP_URL_CHANGED",
          url: "http://localhost:3000",
        });
        result.current.send({
          type: "NAVIGATED_IN_APP",
          kind: "pushState",
          url: "http://localhost:3000/about",
        });
      });
      expect(result.current.state.currentUrl).toBe(
        "http://localhost:3000/about",
      );

      await act(async () => {
        appRunManager.beginExternal(1, {
          requestId: `${operation}-1`,
          operation,
          startedAt: 1_000,
        });
        await Promise.resolve();
      });

      expect(result.current.state).toMatchObject({
        history: [],
        currentUrl: null,
        preservedUrl: null,
      });
    },
  );

  it("clears restart dedupe metadata when the app is disposed", async () => {
    const store = createStore();
    const { Wrapper, appRunManager } = makeWrapper(store);
    const { result } = renderHook(
      () => ({
        preview: usePreviewIframeController(1),
        entityDisposal: useEntityDisposal(),
      }),
      { wrapper: Wrapper },
    );
    const invocationRef: AppRunInvocationRef = {
      kind: "app-run",
      entityKey: 1,
      operationId: "reused-operation",
    };

    await act(async () => {
      appRunManager.beginExternal(1, {
        requestId: "restart-before-delete",
        operation: "restart",
        startedAt: 1_000,
        invocationRef,
      });
      await Promise.resolve();
      result.current.entityDisposal.disposeForApp(1);
      result.current.preview.send({
        type: "APP_URL_CHANGED",
        url: "http://localhost:3000",
      });
      result.current.preview.send({
        type: "NAVIGATED_IN_APP",
        kind: "pushState",
        url: "http://localhost:3000/about",
      });
    });
    expect(result.current.preview.state.currentUrl).toBe(
      "http://localhost:3000/about",
    );

    await act(async () => {
      appRunManager.beginExternal(1, {
        requestId: "restart-after-delete",
        operation: "restart",
        startedAt: 2_000,
        invocationRef,
      });
      await Promise.resolve();
    });

    expect(result.current.preview.state).toMatchObject({
      history: [],
      currentUrl: null,
      preservedUrl: null,
    });
  });

  it("does not recreate preview state from queued or late errors after disposal", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => ({
        preview: usePreviewIframeController(1),
        previewErrors: usePreviewErrorFacade(),
        entityDisposal: useEntityDisposal(),
      }),
      { wrapper: Wrapper },
    );

    await act(async () => {
      result.current.previewErrors.setAppError(1, "queued");
      result.current.entityDisposal.disposeForApp(1);
      await Promise.resolve();
      result.current.previewErrors.setSyncError(1, "late");
      await Promise.resolve();
    });

    expect(result.current.preview.state.error).toBeUndefined();
  });
});
