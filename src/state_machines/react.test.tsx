import { StrictMode, type ReactNode } from "react";
import { act, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useControllerSnapshot,
  createMachineProvider,
  EntityDisposalProvider,
  useEntityDisposal,
  useKeyedController,
  useKeyedMachineSelector,
  useMachineSelector,
  useManagerLifecycle,
  useManagerPagehideDisposal,
  useMainHostedSubscriptionPagehideRelease,
  useProjectionSource,
  type KeyedSnapshotSource,
} from "./react";
import { SnapshotStore } from "./snapshot_store";
import { EntityDisposalRegistry } from "./entity_disposal";

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
    let claimed = false;
    const createManager = () => {
      let ownsClaim = false;
      return {
        start: vi.fn(() => {
          if (claimed) throw new Error("resource already claimed");
          claimed = true;
          ownsClaim = true;
        }),
        stop: vi.fn(() => {
          if (ownsClaim) claimed = false;
          ownsClaim = false;
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

describe("useMainHostedSubscriptionPagehideRelease", () => {
  it("releases only the window subscription on pagehide", () => {
    const releaseSubscription = vi.fn();
    const disposeMainActor = vi.fn();
    const hook = renderHook(() =>
      useMainHostedSubscriptionPagehideRelease(releaseSubscription),
    );

    const event = new Event("pagehide");
    Object.defineProperty(event, "persisted", { value: false });
    act(() => window.dispatchEvent(event));

    expect(releaseSubscription).toHaveBeenCalledOnce();
    expect(disposeMainActor).not.toHaveBeenCalled();
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

describe("machine selectors", () => {
  it("does not rerender a keyed consumer for unrelated-key updates", () => {
    const source = new Source();
    let renders = 0;
    function Consumer() {
      renders++;
      return (
        <span>{useKeyedMachineSelector(source, 1, (value) => value)}</span>
      );
    }
    render(<Consumer />);
    expect(renders).toBe(1);

    act(() => source.set(2, 2));
    expect(renders).toBe(1);

    act(() => source.set(1, 1));
    expect(renders).toBe(2);
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("survives StrictMode subscription replay", () => {
    const source = new Source();
    let renders = 0;
    function Consumer() {
      renders++;
      return (
        <span>{useKeyedMachineSelector(source, 1, (value) => value)}</span>
      );
    }
    render(
      <StrictMode>
        <Consumer />
      </StrictMode>,
    );

    expect(renders).toBeGreaterThan(1);
    act(() => source.set(1, 3));
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("does not resubscribe when only the selector closure changes", () => {
    const store = new SnapshotStore({ value: 2 });
    const subscribe = vi.spyOn(store, "subscribe");
    const { result, rerender } = renderHook(
      ({ multiplier }) =>
        useMachineSelector(store, (snapshot) => snapshot.value * multiplier),
      { initialProps: { multiplier: 2 } },
    );
    expect(result.current).toBe(4);
    expect(subscribe).toHaveBeenCalledTimes(1);

    rerender({ multiplier: 3 });
    expect(result.current).toBe(6);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it("gates small-object updates with optional equality", () => {
    const store = new SnapshotStore({ value: 1, unrelated: 0 });
    let renders = 0;
    let selection: { odd: boolean } | undefined;
    function Consumer() {
      renders++;
      selection = useMachineSelector(
        store,
        (snapshot) => ({ odd: snapshot.value % 2 === 1 }),
        (previous, next) => previous.odd === next.odd,
      );
      return null;
    }
    render(<Consumer />);
    const firstSelection = selection;

    act(() => store.setState({ value: 3, unrelated: 1 }));
    expect(renders).toBe(1);
    expect(selection).toBe(firstSelection);

    act(() => store.setState({ value: 4, unrelated: 1 }));
    expect(renders).toBe(2);
    expect(selection).toEqual({ odd: false });
  });

  it("returns the projection source's reference-stable snapshot", () => {
    const initial = { value: 1 };
    const store = new SnapshotStore(initial);
    const { result } = renderHook(() => useProjectionSource(store));
    expect(result.current).toBe(initial);

    act(() => store.setState(initial));
    expect(result.current).toBe(initial);

    const next = { value: 2 };
    act(() => store.setState(next));
    expect(result.current).toBe(next);
  });
});
