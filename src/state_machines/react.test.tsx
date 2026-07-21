import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useKeyedController, type KeyedSnapshotSource } from "./react";

class Source implements KeyedSnapshotSource<number, number> {
  private values = new Map<number, number>();
  private listeners = new Map<number, Set<() => void>>();
  subscribeKey = (key: number, listener: () => void) => {
    const listeners = this.listeners.get(key) ?? new Set();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => listeners.delete(listener);
  };
  getSnapshot = (key: number) => this.values.get(key) ?? 0;
  set(key: number, value: number) {
    this.values.set(key, value);
    for (const listener of this.listeners.get(key) ?? []) listener();
  }
}

describe("useKeyedController", () => {
  it("updates only from the subscribed key", () => {
    const source = new Source();
    const { result } = renderHook(() => useKeyedController(source, 1));
    act(() => source.set(2, 2));
    expect(result.current).toBe(0);
    act(() => source.set(1, 1));
    expect(result.current).toBe(1);
  });
});
