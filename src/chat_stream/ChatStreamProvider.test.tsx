import { StrictMode } from "react";
import { act, render } from "@testing-library/react";
import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";

import { ChatStreamProvider } from "./ChatStreamProvider";
import { ChatStreamManager } from "./manager";

describe("ChatStreamProvider", () => {
  it("survives StrictMode effect replay and disposes after unmount", async () => {
    const manager = new ChatStreamManager(createStore());
    const dispose = vi.spyOn(manager, "dispose");
    const view = render(
      <StrictMode>
        <ChatStreamProvider manager={manager}>
          <div />
        </ChatStreamProvider>
      </StrictMode>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(dispose).not.toHaveBeenCalled();

    view.unmount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(dispose).toHaveBeenCalledOnce();
  });
});
