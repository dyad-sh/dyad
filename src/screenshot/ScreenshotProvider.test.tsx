import { act, render } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { pendingScreenshotAppIdsAtom } from "@/atoms/previewAtoms";
import { ScreenshotProvider } from "./ScreenshotProvider";
import { ScreenshotManager } from "./manager";

describe("ScreenshotProvider inbox adapter", () => {
  it("consumes an atom write into CAPTURE_REQUESTED and clears the entry", () => {
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
      store.set(pendingScreenshotAppIdsAtom, new Map([[7, "stream" as const]]));
    });

    expect(manager.getSnapshot(7)).toMatchObject({
      status: "pending",
      source: "stream",
    });
    expect(store.get(pendingScreenshotAppIdsAtom)).toEqual(new Map());
  });
});
