import { describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import {
  AppDeletionInProgressError,
  AppOperationCoordinator,
  readAppResource,
} from "./app_operation_coordinator";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("AppOperationCoordinator", () => {
  it("runs unrelated resources concurrently while serializing conflicts", async () => {
    const coordinator = new AppOperationCoordinator();
    const runtimeRelease = deferred();
    const secondRuntime = vi.fn();
    const chat = vi.fn();

    const runtime = coordinator.run(
      { appId: 1, operation: "start", resources: ["runtime"] },
      () => runtimeRelease.promise,
    );
    const queuedRuntime = coordinator.run(
      { appId: 1, operation: "restart", resources: ["runtime"] },
      async () => secondRuntime(),
    );
    const concurrentChat = coordinator.run(
      {
        appId: 1,
        operation: "create-chat",
        resources: ["chat-membership"],
      },
      async () => chat(),
    );

    await concurrentChat;
    expect(chat).toHaveBeenCalledOnce();
    expect(secondRuntime).not.toHaveBeenCalled();

    runtimeRelease.resolve();
    await Promise.all([runtime, queuedRuntime]);
    expect(secondRuntime).toHaveBeenCalledOnce();
  });

  it("does not start conflicting queued operations together after a blocker releases", async () => {
    const coordinator = new AppOperationCoordinator();
    const firstRelease = deferred();
    const secondRelease = deferred();
    const order: string[] = [];

    const first = coordinator.run(
      { appId: 1, operation: "first", resources: ["runtime"] },
      () => firstRelease.promise,
    );
    const second = coordinator.run(
      { appId: 1, operation: "second", resources: ["runtime"] },
      async () => {
        order.push("second");
        await secondRelease.promise;
      },
    );
    const third = coordinator.run(
      { appId: 1, operation: "third", resources: ["runtime"] },
      async () => {
        order.push("third");
      },
    );

    firstRelease.resolve();
    await first;
    await vi.waitFor(() => expect(order).toEqual(["second"]));
    secondRelease.resolve();
    await Promise.all([second, third]);
    expect(order).toEqual(["second", "third"]);
  });

  it("allows concurrent readers and makes a waiting writer a fairness barrier", async () => {
    const coordinator = new AppOperationCoordinator();
    const firstReaderRelease = deferred();
    const order: string[] = [];

    const firstReader = coordinator.run(
      {
        appId: 1,
        operation: "read-path",
        resources: [readAppResource("app-path")],
      },
      async () => {
        order.push("reader-1");
        await firstReaderRelease.promise;
      },
    );
    const writer = coordinator.run(
      { appId: 1, operation: "move", resources: ["app-path"] },
      async () => {
        order.push("writer");
      },
    );
    const laterReader = coordinator.run(
      {
        appId: 1,
        operation: "read-path-later",
        resources: [readAppResource("app-path")],
      },
      async () => {
        order.push("reader-2");
      },
    );

    await Promise.resolve();
    expect(order).toEqual(["reader-1"]);
    firstReaderRelease.resolve();
    await Promise.all([firstReader, writer, laterReader]);
    expect(order).toEqual(["reader-1", "writer", "reader-2"]);
  });

  it("acquires multi-resource operations atomically without deadlock", async () => {
    const coordinator = new AppOperationCoordinator();
    const release = deferred();
    const order: string[] = [];

    const first = coordinator.run(
      {
        appId: 1,
        operation: "first",
        resources: ["runtime", "repository"],
      },
      async () => {
        order.push("first");
        await release.promise;
      },
    );
    const second = coordinator.run(
      {
        appId: 1,
        operation: "second",
        resources: ["repository", "runtime"],
      },
      async () => {
        order.push("second");
      },
    );

    await Promise.resolve();
    expect(order).toEqual(["first"]);
    release.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  it("closes deletion admission and drains active and queued work", async () => {
    const coordinator = new AppOperationCoordinator();
    const activeRelease = deferred();
    const queued = vi.fn();

    const active = coordinator.run(
      { appId: 1, operation: "active", resources: ["runtime"] },
      () => activeRelease.promise,
    );
    const queuedOperation = coordinator.run(
      { appId: 1, operation: "queued", resources: ["runtime"] },
      async () => queued(),
    );
    const deletion = coordinator.beginAppDeletion(1);

    await expect(
      coordinator.run(
        { appId: 1, operation: "late", resources: ["chat-membership"] },
        async () => undefined,
      ),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });

    const drained = vi.fn();
    const drainPromise = deletion.drain().then(drained);
    await Promise.resolve();
    expect(drained).not.toHaveBeenCalled();

    activeRelease.resolve();
    await Promise.all([active, queuedOperation, drainPromise]);
    expect(queued).toHaveBeenCalledOnce();
    expect(drained).toHaveBeenCalledOnce();

    await deletion.runExclusive(async () => undefined);
    deletion.release();
    await expect(
      coordinator.run(
        { appId: 1, operation: "after", resources: ["runtime"] },
        async () => "ok",
      ),
    ).resolves.toBe("ok");
  });

  it("releases resources after rejection", async () => {
    const coordinator = new AppOperationCoordinator();
    await expect(
      coordinator.run(
        { appId: 1, operation: "failure", resources: ["repository"] },
        async () => {
          throw new Error("boom");
        },
      ),
    ).rejects.toThrow("boom");

    await expect(
      coordinator.run(
        { appId: 1, operation: "recovery", resources: ["repository"] },
        async () => "ok",
      ),
    ).resolves.toBe("ok");
  });

  it("rejects overlapping deletion-exclusive operations", async () => {
    const coordinator = new AppOperationCoordinator();
    const deletion = coordinator.beginAppDeletion(1);
    const release = deferred();
    await deletion.drain();

    const first = deletion.runExclusive(() => release.promise);
    await expect(deletion.runExclusive(async () => undefined)).rejects.toThrow(
      "exclusive operation in progress",
    );
    expect(() => deletion.release()).toThrow(
      "cannot be released during an exclusive operation",
    );

    release.resolve();
    await first;
    deletion.release();
  });

  // `deleteAppById` has to recognise this to report "already being deleted" as
  // a Precondition rather than an unclassified product exception. Matching on
  // the message text coupled the two files through a string nothing checks.
  it("throws a recognisable error for a second deletion of the same app", () => {
    const coordinator = new AppOperationCoordinator();
    coordinator.beginAppDeletion(1);

    expect(() => coordinator.beginAppDeletion(1)).toThrow(
      AppDeletionInProgressError,
    );
    // A different app is unaffected.
    expect(() => coordinator.beginAppDeletion(2)).not.toThrow();
  });
});
