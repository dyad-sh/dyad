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
      }),
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
    await vi.waitFor(() => expect(calls).toEqual(["acquire:start"]));

    acquisition.resolve();
    await Promise.all([acquiring, releasing]);

    expect(calls).toEqual(["acquire:start", "acquire:end", "release"]);
  });
});
