import { describe, expect, it } from "vitest";
import { WindowRegistry } from "@/window_infrastructure/main/window_registry";
import {
  VersionPreviewWindowInterestService,
  type VersionPreviewWindowRelease,
} from "./version_preview_window_interest";

function endpoint(id: number) {
  return {
    id,
    isDestroyed: () => false,
    send: () => undefined,
  };
}

describe("VersionPreviewWindowInterestService", () => {
  it("retains repository ownership until the last interested window releases", () => {
    const windows = new WindowRegistry();
    const interests = new VersionPreviewWindowInterestService(windows);
    windows.register(
      endpoint(1),
      "00000000-0000-4000-8000-000000000001" as never,
    );
    windows.register(
      endpoint(2),
      "00000000-0000-4000-8000-000000000002" as never,
    );

    interests.acquire(7, 1);
    interests.acquire(7, 2);

    expect(interests.isLastOwner(7, 1)).toBe(false);
    expect(interests.release(7, 1)).toBe(
      "retained-by-other-window" satisfies VersionPreviewWindowRelease,
    );
    expect(interests.inspect(7)).toEqual([2]);
    expect(interests.isLastOwner(7, 2)).toBe(true);
    expect(interests.release(7, 2)).toBe(
      "last-owner-released" satisfies VersionPreviewWindowRelease,
    );
    expect(interests.inspect(7)).toEqual([]);
    interests.dispose();
  });

  it("drops a destroyed window without treating renderer loss as an exit", () => {
    const windows = new WindowRegistry();
    const interests = new VersionPreviewWindowInterestService(windows);
    windows.register(
      endpoint(1),
      "00000000-0000-4000-8000-000000000001" as never,
    );
    interests.acquire(7, 1);

    windows.unregister(1);

    expect(interests.inspect(7)).toEqual([]);
    expect(interests.release(7, 1)).toBe("not-owned");
    interests.dispose();
  });

  it("keeps interests isolated by app", () => {
    const interests = new VersionPreviewWindowInterestService(
      new WindowRegistry(),
    );
    interests.acquire(7, 1);
    interests.acquire(8, 1);

    interests.clearApp(7);

    expect(interests.inspect(7)).toEqual([]);
    expect(interests.inspect(8)).toEqual([1]);
    interests.dispose();
  });
});
