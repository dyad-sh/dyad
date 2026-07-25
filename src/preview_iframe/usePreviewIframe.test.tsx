import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { AppRunProvider } from "@/app_run/AppRunProvider";
import { AppRunManager } from "@/app_run/manager";
import { PreviewIframeProvider } from "./PreviewIframeProvider";
import {
  usePreviewIframeController,
  useSendPreviewIframeEvent,
} from "./usePreviewIframe";

function makeWrapper(store = createStore()) {
  const appRunManager = new AppRunManager(store);
  return {
    appRunManager,
    Wrapper({ children }: { children: ReactNode }) {
      return (
        <Provider store={store}>
          <AppRunProvider manager={appRunManager}>
            <PreviewIframeProvider appRunState={appRunManager}>
              {children}
            </PreviewIframeProvider>
          </AppRunProvider>
        </Provider>
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

  it("resets preserved navigation when a restart begins", async () => {
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
    expect(result.current.state.currentUrl).toBe("http://localhost:3000/about");

    await act(async () => {
      appRunManager.beginExternal(1, {
        requestId: "restart-1",
        operation: "restart",
        startedAt: 1_000,
      });
      await Promise.resolve();
    });

    expect(result.current.state).toMatchObject({
      history: [],
      currentUrl: null,
      preservedUrl: null,
    });
  });
});
