import { describe, expect, it, vi } from "vitest";
import { KeyedControllerHost, type KeyedController } from "./keyed_host";

class FakeController implements KeyedController<number> {
  private snapshot = 0;
  private listeners = new Set<() => void>();
  readonly dispose = vi.fn();

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  update(value: number) {
    this.snapshot = value;
    for (const listener of this.listeners) listener();
  }
}

describe("KeyedControllerHost", () => {
  it("creates one controller per key and isolates key subscriptions", () => {
    const host = new KeyedControllerHost(() => new FakeController());
    const appOneListener = vi.fn();
    const anyListener = vi.fn();
    host.subscribeKey(1, appOneListener);
    host.subscribeAny(anyListener);

    const one = host.ensure(1);
    expect(host.ensure(1)).toBe(one);
    const two = host.ensure(2);

    two.update(2);
    expect(appOneListener).not.toHaveBeenCalled();
    expect(anyListener).toHaveBeenCalledTimes(1);

    one.update(1);
    expect(appOneListener).toHaveBeenCalledTimes(1);
    expect(anyListener).toHaveBeenCalledTimes(2);
  });

  it("disposes individual keys and the whole host deterministically", () => {
    const host = new KeyedControllerHost(() => new FakeController());
    const one = host.ensure(1);
    const two = host.ensure(2);

    host.disposeKey(1);
    expect(one.dispose).toHaveBeenCalledOnce();
    expect(host.get(1)).toBeUndefined();

    host.dispose();
    expect(two.dispose).toHaveBeenCalledOnce();
    expect(() => host.ensure(3)).toThrow(/disposed host/);
  });
});
