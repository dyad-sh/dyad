import { describe, expect, it } from "vitest";

import { withLock, withLocks } from "./lock_utils";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("withLocks", () => {
  it("acquires multiple locks in canonical order", async () => {
    const firstLockId = "filewrite:/app/a.ts";
    const secondLockId = "filewrite:/app/b.ts";
    const blockerStarted = deferred();
    const releaseBlocker = deferred();
    const events: string[] = [];

    const blocker = withLock(secondLockId, async () => {
      blockerStarted.resolve();
      await releaseBlocker.promise;
    });
    await blockerStarted.promise;

    const multiple = withLocks(
      [secondLockId, firstLockId],
      async () => void events.push("multiple"),
    );
    const single = withLock(
      firstLockId,
      async () => void events.push("single"),
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual([]);

    releaseBlocker.resolve();
    await Promise.all([blocker, multiple, single]);
    expect(events).toEqual(["multiple", "single"]);
  });

  it("deduplicates repeated lock IDs", async () => {
    await expect(
      withLocks(["filewrite:/app/a.ts", "filewrite:/app/a.ts"], async () => 1),
    ).resolves.toBe(1);
  });
});
