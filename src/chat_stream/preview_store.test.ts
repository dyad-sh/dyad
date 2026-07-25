import { describe, expect, it, vi } from "vitest";
import { ChatStreamPreviewStore } from "./preview_store";

describe("ChatStreamPreviewStore", () => {
  it("keeps identical chunks as identity-stable notification no-ops", () => {
    const store = new ChatStreamPreviewStore();
    const listener = vi.fn();
    store.subscribeKey(7, listener);

    expect(store.set(7, "<tool>one")).toBe(true);
    expect(store.set(7, "<tool>one")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("isolates updates and disposal by chat", () => {
    const store = new ChatStreamPreviewStore();
    const first = vi.fn();
    const second = vi.fn();
    store.subscribeKey(1, first);
    store.subscribeKey(2, second);

    store.set(1, "preview");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    store.disposeKey(1);
    expect(store.getSnapshot(1)).toBe("");
    expect(store.getSnapshot(2)).toBe("");
  });
});
