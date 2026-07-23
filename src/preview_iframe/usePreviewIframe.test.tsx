import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { PreviewIframeProvider } from "./PreviewIframeProvider";
import { useSendPreviewIframeEvent } from "./usePreviewIframe";

function makeWrapper() {
  const store = createStore();
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
});
