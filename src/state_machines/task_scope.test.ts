import { describe, expect, it, vi } from "vitest";
import { TaskScope } from "./task_scope";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("TaskScope", () => {
  it("replaces and removes keyed cleanups exactly once", () => {
    const scope = new TaskScope<string>();
    const first = vi.fn();
    const second = vi.fn();

    scope.replace("resource", first);
    scope.replace("resource", second);
    scope.remove("resource");
    scope.dispose();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it("runs registrations after disposal immediately", () => {
    const scope = new TaskScope<string>();
    const cleanup = vi.fn();
    scope.dispose();

    scope.replace("late", cleanup);

    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("compensates promises that settle after disposal", async () => {
    const scope = new TaskScope();
    const setup = deferred<string>();
    const lateCleanup = vi.fn();
    const tracked = scope.trackPromise(setup.promise, lateCleanup);

    scope.dispose();
    setup.resolve("ready");

    await expect(tracked).resolves.toBe("ready");
    expect(lateCleanup).toHaveBeenCalledOnce();
  });

  it("preserves tracked rejection while running late cleanup", async () => {
    const scope = new TaskScope();
    const setup = deferred<void>();
    const lateCleanup = vi.fn();
    const tracked = scope.trackPromise(setup.promise, lateCleanup);

    scope.dispose();
    setup.reject(new Error("setup failed"));

    await expect(tracked).rejects.toThrow("setup failed");
    expect(lateCleanup).toHaveBeenCalledOnce();
  });

  it("is idempotent and aggregates disposer errors after all cleanup", () => {
    const scope = new TaskScope<string>();
    const order: string[] = [];
    scope.replace("first", () => {
      order.push("first");
      throw new Error("first failed");
    });
    scope.replace("second", () => {
      order.push("second");
      throw new Error("second failed");
    });

    expect(() => scope.dispose()).toThrow(AggregateError);
    expect(order).toEqual(["second", "first"]);
    expect(() => scope.dispose()).not.toThrow();
  });
});
