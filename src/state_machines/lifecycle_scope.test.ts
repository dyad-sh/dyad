import { describe, expect, it, vi } from "vitest";
import { createLifecycleScope } from "./lifecycle_scope";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("createLifecycleScope", () => {
  it("orders hooks, releases registered resources, and disposes once", () => {
    const order: string[] = [];
    const scope = createLifecycleScope<string>({
      stopAdmission: () => order.push("stop-admission"),
      settleWaiters: () => order.push("settle-waiters"),
      publishFinalProjection: () => order.push("final-projection"),
      releaseResources: () => order.push("release-domain-resources"),
      onLateSettlement: () => order.push("late-settlement"),
    });
    scope.replace("writer", () => order.push("release-writer"));

    scope.dispose();
    scope.dispose();

    expect(order).toEqual([
      "stop-admission",
      "settle-waiters",
      "final-projection",
      "release-domain-resources",
      "release-writer",
    ]);
  });

  it("runs late registration and late settlement cleanup after disposal", async () => {
    const lateRegistration = vi.fn();
    const lateSettlement = vi.fn();
    const pending = deferred();
    const scope = createLifecycleScope({
      stopAdmission: vi.fn(),
      settleWaiters: vi.fn(),
      publishFinalProjection: vi.fn(),
      releaseResources: vi.fn(),
      onLateSettlement: lateSettlement,
    });
    const tracked = scope.trackPromise(pending.promise);

    scope.dispose();
    scope.replace("late", lateRegistration);
    pending.resolve();
    await tracked;

    expect(lateRegistration).toHaveBeenCalledOnce();
    expect(lateSettlement).toHaveBeenCalledOnce();
  });

  it("aggregates hook and resource failures without interrupting teardown", () => {
    const order: string[] = [];
    const fail = (name: string) => () => {
      order.push(name);
      throw new Error(name);
    };
    const scope = createLifecycleScope({
      stopAdmission: fail("stop"),
      settleWaiters: fail("settle"),
      publishFinalProjection: fail("publish"),
      releaseResources: fail("release"),
      onLateSettlement: vi.fn(),
    });
    scope.replace("resource", fail("resource"));

    let error: unknown;
    try {
      scope.dispose();
    } catch (caught) {
      error = caught;
    }

    expect(order).toEqual(["stop", "settle", "publish", "release", "resource"]);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(5);
  });
});
