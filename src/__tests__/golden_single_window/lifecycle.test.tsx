import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useManagerLifecycle,
  useManagerPagehideDisposal,
} from "@/state_machines/react";

describe("golden single-window: reload and quit teardown", () => {
  it("stops a window-local manager before final disposal on reload", async () => {
    const order: string[] = [];
    const manager = {
      start: vi.fn(() => order.push("start")),
      stop: vi.fn(() => order.push("stop")),
      dispose: vi.fn(() => order.push("dispose")),
    };
    const hook = renderHook(() => {
      useManagerLifecycle(manager);
      useManagerPagehideDisposal(manager);
    });

    const pagehide = new Event("pagehide");
    Object.defineProperty(pagehide, "persisted", { value: false });
    act(() => window.dispatchEvent(pagehide));

    // Protects the Phase B pagehide/disposal split.
    expect(order).toEqual(["start", "dispose"]);
    hook.unmount();
    await act(() => Promise.resolve());
  });

  it("stops a window-local manager before disposing it on final unmount", async () => {
    const order: string[] = [];
    const manager = {
      start: vi.fn(() => order.push("start")),
      stop: vi.fn(() => order.push("stop")),
      dispose: vi.fn(() => order.push("dispose")),
    };
    const hook = renderHook(() => useManagerLifecycle(manager));

    hook.unmount();
    expect(order).toEqual(["start", "stop"]);
    await act(() => Promise.resolve());

    // Protects final-unmount ordering after the Phase B pagehide split.
    expect(order).toEqual(["start", "stop", "dispose"]);
  });
});
