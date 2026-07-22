import { describe, expect, it, vi } from "vitest";
import { SnapshotStore } from "./snapshot_store";

describe("SnapshotStore", () => {
  it("notifies only when the snapshot reference changes", () => {
    const initial = { value: 1 };
    const store = new SnapshotStore(initial);
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.setState(initial)).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    const next = { value: 1 };
    expect(store.setState(next)).toBe(true);
    expect(store.getSnapshot()).toBe(next);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("updates the snapshot before running pre-notification work", () => {
    const store = new SnapshotStore(1);
    const order: string[] = [];
    store.subscribe(() => order.push(`listener:${store.getSnapshot()}`));

    store.setState(2, () => order.push(`before:${store.getSnapshot()}`));

    expect(order).toEqual(["before:2", "listener:2"]);
  });

  it("reports the current subscriber count", () => {
    const store = new SnapshotStore(1);
    const unsubscribeFirst = store.subscribe(() => undefined);
    const unsubscribeSecond = store.subscribe(() => undefined);

    expect(store.subscriberCount()).toBe(2);
    unsubscribeFirst();
    expect(store.subscriberCount()).toBe(1);
    unsubscribeSecond();
    expect(store.subscriberCount()).toBe(0);
  });

  it("stops updates and subscriptions after disposal", () => {
    const store = new SnapshotStore(1);
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispose();

    expect(store.subscriberCount()).toBe(0);
    expect(store.setState(2)).toBe(false);
    expect(store.getSnapshot()).toBe(1);
    expect(listener).not.toHaveBeenCalled();
  });
});
