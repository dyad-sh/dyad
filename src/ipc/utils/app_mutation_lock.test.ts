import { describe, expect, it, vi } from "vitest";

import { createAppMutationLock } from "./app_mutation_lock";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("createAppMutationLock", () => {
  it("serializes mutations for the same app", async () => {
    const first = deferred();
    const handler = vi.fn(async (_event: unknown, input: { appId: number }) => {
      if (handler.mock.calls.length === 1) await first.promise;
      return input.appId;
    });
    const locked = createAppMutationLock(handler);

    const firstCall = locked({}, { appId: 1 });
    const secondCall = locked({}, { appId: 1 });
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);

    first.resolve();
    await expect(Promise.all([firstCall, secondCall])).resolves.toEqual([1, 1]);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("allows mutations for different apps to overlap", async () => {
    const release = deferred();
    const started: number[] = [];
    const locked = createAppMutationLock(
      async (_event: unknown, input: { appId: number }) => {
        started.push(input.appId);
        await release.promise;
        return input.appId;
      },
    );

    const appOne = locked({}, { appId: 1 });
    const appTwo = locked({}, { appId: 2 });
    await Promise.resolve();
    expect(started).toEqual([1, 2]);

    release.resolve();
    await expect(Promise.all([appOne, appTwo])).resolves.toEqual([1, 2]);
  });
});
