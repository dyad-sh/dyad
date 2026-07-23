import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { previewRunStateByAppIdAtom } from "@/atoms/previewRuntimeAtoms";
import { PreviewIframeProvider } from "./PreviewIframeProvider";
import {
  usePreviewIframeController,
  useSendPreviewIframeEvent,
} from "./usePreviewIframe";

function makeWrapper(store = createStore()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <Provider store={store}>
        <PreviewIframeProvider>{children}</PreviewIframeProvider>
      </Provider>
    );
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
      { wrapper: makeWrapper() },
    );
    const initialRenderCount = renderCount;

    act(() => result.current({ type: "SELECTOR_READY" }));

    expect(renderCount).toBe(initialRenderCount);
  });

  it("resets preserved navigation when a restart begins", () => {
    const store = createStore();
    const { result } = renderHook(() => usePreviewIframeController(1), {
      wrapper: makeWrapper(store),
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

    act(() => {
      store.set(
        previewRunStateByAppIdAtom,
        new Map([[1, { operation: "restart" as const, startedAt: 1_000 }]]),
      );
    });

    expect(result.current.state).toMatchObject({
      history: [],
      currentUrl: null,
      preservedUrl: null,
    });
  });
});
