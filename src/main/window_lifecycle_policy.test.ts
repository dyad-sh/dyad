import { describe, expect, it } from "vitest";
import {
  closedWindowSessionDisposition,
  shouldQuitAfterAllWindowsClosed,
} from "@/main/window_lifecycle_policy";

describe("window lifecycle policy", () => {
  it("forgets explicitly closed peer windows but retains shutdown sessions", () => {
    expect(
      closedWindowSessionDisposition({
        isAppQuitting: false,
        openWindowCountBeforeClose: 2,
      }),
    ).toBe("forget");
    expect(
      closedWindowSessionDisposition({
        isAppQuitting: true,
        openWindowCountBeforeClose: 2,
      }),
    ).toBe("retain");
  });

  it("retains the last window for macOS activation and future launches", () => {
    expect(
      closedWindowSessionDisposition({
        isAppQuitting: false,
        openWindowCountBeforeClose: 1,
      }),
    ).toBe("retain");
    expect(shouldQuitAfterAllWindowsClosed("darwin")).toBe(false);
  });

  it.each(["win32", "linux"] as const)(
    "quits after the last window closes on %s",
    (platform) => {
      expect(shouldQuitAfterAllWindowsClosed(platform)).toBe(true);
    },
  );
});
