import { act, render } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { ScreenshotProvider } from "./ScreenshotProvider";
import { ScreenshotManager } from "./manager";

describe("ScreenshotProvider", () => {
  it("accepts capture requests through the manager facade", () => {
    const store = createStore();
    const commands = {
      attach: vi.fn(() => () => undefined),
      execute: vi.fn(),
      disposeKey: vi.fn(),
    };
    const manager = new ScreenshotManager(commands);

    render(
      <Provider store={store}>
        <ScreenshotProvider manager={manager}>
          <div />
        </ScreenshotProvider>
      </Provider>,
    );

    act(() => {
      manager.requestCapture(7, "stream");
    });

    expect(manager.getSnapshot(7)).toMatchObject({
      status: "pending",
      source: "stream",
    });
  });
});
