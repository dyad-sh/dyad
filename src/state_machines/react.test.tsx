import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useControllerSnapshot,
  useKeyedController,
  useManagerLifecycle,
  type KeyedSnapshotSource,
} from "./react";
import { SnapshotStore } from "./snapshot_store";

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

function StrictModeWrapper({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

async function flushMicrotasks() {
  await act(async () => undefined);
}

describe("useManagerLifecycle", () => {
  it("keeps a manager alive across StrictMode effect replay", async () => {
    const manager = {
      start: vi.fn(),
      dispose: vi.fn(),
    };
    const hook = renderHook(() => useManagerLifecycle(manager), {
      wrapper: StrictModeWrapper,
    });

    await flushMicrotasks();
    expect(manager.start).toHaveBeenCalled();
    expect(manager.dispose).not.toHaveBeenCalled();

    hook.unmount();
    await flushMicrotasks();
    expect(manager.dispose).toHaveBeenCalledTimes(1);
  });

  it("supports managers without a start lifecycle", async () => {
    const manager = { dispose: vi.fn() };
    const hook = renderHook(() => useManagerLifecycle(manager));

    hook.unmount();
    await flushMicrotasks();
    expect(manager.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes a replaced manager independently", async () => {
    const first = { dispose: vi.fn() };
    const second = { dispose: vi.fn() };
    const hook = renderHook(({ manager }) => useManagerLifecycle(manager), {
      initialProps: { manager: first },
    });

    hook.rerender({ manager: second });
    await flushMicrotasks();
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).not.toHaveBeenCalled();

    hook.unmount();
    await flushMicrotasks();
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });

  it("does not let an older cleanup dispose a reclaimed manager", async () => {
    const first = { dispose: vi.fn() };
    const second = { dispose: vi.fn() };
    const hook = renderHook(({ manager }) => useManagerLifecycle(manager), {
      initialProps: { manager: first },
    });

    hook.rerender({ manager: second });
    hook.rerender({ manager: first });
    await flushMicrotasks();
    expect(first.dispose).not.toHaveBeenCalled();
    expect(second.dispose).toHaveBeenCalledTimes(1);

    hook.unmount();
    await flushMicrotasks();
    expect(first.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("useKeyedController", () => {
  it("updates only from the subscribed key", () => {
    const source = new Source();
    const { result } = renderHook(() => useKeyedController(source, 1));
    act(() => source.set(2, 2));
    expect(result.current).toBe(0);
    act(() => source.set(1, 1));
    expect(result.current).toBe(1);
  });

  it("supports an explicit keyed snapshot selector", () => {
    const source = new Source();
    const { result } = renderHook(() =>
      useKeyedController(source, 1, (current, key) => current.getSnapshot(key)),
    );
    act(() => source.set(1, 4));
    expect(result.current).toBe(4);
  });
});

describe("useControllerSnapshot", () => {
  it("binds a non-keyed disposable controller", () => {
    const controller = new SnapshotStore(0);
    const { result } = renderHook(() => useControllerSnapshot(controller));
    act(() => controller.setState(2));
    expect(result.current).toBe(2);
  });
});
