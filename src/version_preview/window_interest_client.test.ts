import { describe, expect, it, vi } from "vitest";
import { VersionPreviewWindowInterestClient } from "./window_interest_client";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("VersionPreviewWindowInterestClient", () => {
  it("serializes a rapid release behind pending acquisition", async () => {
    const acquisition = deferred<void>();
    const calls: string[] = [];
    const ipc = {
      acquirePreviewWindowInterest: vi.fn(async () => {
        calls.push("acquire:start");
        await acquisition.promise;
        calls.push("acquire:end");
        return { acquired: true };
      }),
      restorePreviewWindowInterest: vi.fn(async () => ({ acquired: false })),
      releasePreviewWindowInterest: vi.fn(async () => {
        calls.push("release");
        return { cleanupStarted: false };
      }),
    };
    const interests = new VersionPreviewWindowInterestClient(ipc);

    const acquiring = interests.acquire(7);
    const releasing = interests.release(7, "leave-1", {
      type: "switch-app",
      nextAppId: 8,
    });
    expect(interests.isSelectionEpochCurrent(7, 0)).toBe(false);
    expect(interests.selectionEpoch(7)).toBe(1);
    await vi.waitFor(() => expect(calls).toEqual(["acquire:start"]));

    acquisition.resolve();
    await Promise.all([acquiring, releasing]);

    expect(calls).toEqual(["acquire:start", "acquire:end", "release"]);
  });

  it("reports whether orphaned ownership was restored", async () => {
    const ipc = {
      acquirePreviewWindowInterest: vi.fn(async () => ({ acquired: false })),
      restorePreviewWindowInterest: vi.fn(async () => ({ acquired: true })),
      releasePreviewWindowInterest: vi.fn(async () => ({
        cleanupStarted: false,
      })),
    };
    const interests = new VersionPreviewWindowInterestClient(ipc);

    await expect(interests.restoreIfOrphaned(7)).resolves.toEqual({
      acquired: true,
    });
    expect(ipc.restorePreviewWindowInterest).toHaveBeenCalledWith({ appId: 7 });
  });
});
