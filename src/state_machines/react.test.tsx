import { StrictMode, type ReactNode } from "react";
import { act, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useControllerSnapshot,
  createMachineProvider,
  EntityDisposalProvider,
  useEntityDisposal,
  useKeyedController,
  useManagerLifecycle,
  useManagerPagehideDisposal,
  type KeyedSnapshotSource,
} from "./react";
import { SnapshotStore } from "./snapshot_store";
import { EntityDisposalRegistry } from "./entity_disposal";
import { registerAtomWriter, type AtomProjectionWriter } from "./projection";

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

  it("releases a replaced manager before starting its replacement", async () => {
    const store = { set: vi.fn() };
    const atom = {};
    const createManager = () => {
      let writer: AtomProjectionWriter<number> | undefined;
      return {
        start: vi.fn(() => {
          writer = registerAtomWriter(store, atom);
        }),
        stop: vi.fn(() => {
          writer?.dispose();
          writer = undefined;
        }),
        dispose: vi.fn(),
      };
    };
    const first = createManager();
    const second = createManager();
    const hook = renderHook(({ manager }) => useManagerLifecycle(manager), {
      initialProps: { manager: first },
    });

    expect(() => hook.rerender({ manager: second })).not.toThrow();
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.start).toHaveBeenCalledOnce();
    await flushMicrotasks();
    expect(first.dispose).toHaveBeenCalledOnce();

    hook.unmount();
    await flushMicrotasks();
  });

  it("disposes a rapidly reclaimed manager only once", async () => {
    const first = { dispose: vi.fn() };
    const second = { dispose: vi.fn() };
    const hook = renderHook(({ manager }) => useManagerLifecycle(manager), {
      initialProps: { manager: first },
    });

    hook.rerender({ manager: second });
    hook.rerender({ manager: first });
    hook.rerender({ manager: second });
    await flushMicrotasks();
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(second.dispose).not.toHaveBeenCalled();

    hook.unmount();
    await flushMicrotasks();
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("useManagerPagehideDisposal", () => {
  it("disposes before non-persisted document teardown", () => {
    const manager = { dispose: vi.fn() };
    const hook = renderHook(() => useManagerPagehideDisposal(manager));
    const pagehide = new Event("pagehide");
    Object.defineProperty(pagehide, "persisted", { value: false });

    act(() => window.dispatchEvent(pagehide));

    expect(manager.dispose).toHaveBeenCalledTimes(1);
    hook.unmount();
  });

  it("keeps the manager alive when the page enters the back-forward cache", () => {
    const manager = { dispose: vi.fn() };
    const hook = renderHook(() => useManagerPagehideDisposal(manager));
    const pagehide = new Event("pagehide");
    Object.defineProperty(pagehide, "persisted", { value: true });

    act(() => window.dispatchEvent(pagehide));

    expect(manager.dispose).not.toHaveBeenCalled();
    hook.unmount();
  });
});

describe("createMachineProvider", () => {
  it("constructs an owned manager and accepts an injected manager", async () => {
    const owned = { dispose: vi.fn() };
    const injected = { dispose: vi.fn() };
    const machine = createMachineProvider({
      name: "Example",
      useOwnedManager: () => owned,
    });
    function Consumer() {
      return (
        <span>{machine.useManager() === injected ? "injected" : "owned"}</span>
      );
    }

    const view = render(
      <machine.Provider manager={injected}>
        <Consumer />
      </machine.Provider>,
    );
    expect(screen.getByText("injected")).toBeTruthy();
    view.unmount();
    await flushMicrotasks();
    expect(injected.dispose).toHaveBeenCalledOnce();

    const ownedView = render(
      <machine.Provider>
        <Consumer />
      </machine.Provider>,
    );
    expect(screen.getByText("owned")).toBeTruthy();
    ownedView.unmount();
    await flushMicrotasks();
    expect(owned.dispose).toHaveBeenCalledOnce();
  });
});

describe("EntityDisposalProvider", () => {
  it("exposes one provider-owned registry", () => {
    const { result } = renderHook(() => useEntityDisposal(), {
      wrapper: EntityDisposalProvider,
    });
    expect(result.current).toBeInstanceOf(EntityDisposalRegistry);
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
