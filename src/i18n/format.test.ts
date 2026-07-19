import { afterEach, describe, expect, test, vi } from "vitest";
import {
  formatDate,
  formatNumber,
  formatRelativeTime,
  formatTime,
} from "./format";

describe("locale-aware formatting", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("formats dates with Simplified Chinese locale data", () => {
    const formatted = formatDate(new Date("2026-01-02T03:04:05.000Z"), "zh-CN");

    expect(formatted).toContain("2026");
    expect(formatted).not.toBe(
      formatDate(new Date("2026-01-02T03:04:05.000Z"), "en-US"),
    );
  });

  test("formats numbers with Simplified Chinese locale data", () => {
    expect(formatNumber(1234567.89, "zh-CN")).toBe("1,234,567.89");
  });

  test("formats times with Simplified Chinese locale data", () => {
    const formatted = formatTime(
      new Date("2026-01-02T03:04:05.000Z"),
      "zh-CN",
      { hour: "2-digit", minute: "2-digit", hour12: false },
    );

    expect(formatted).toMatch(/^\d{2}:\d{2}$/);
    expect(
      formatTime(new Date("2026-01-02T03:04:05.000Z"), "en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
    ).toMatch(/AM|PM/);
  });

  test("formats relative time with Simplified Chinese locale data", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    expect(
      formatRelativeTime(new Date("2026-01-02T00:00:00.000Z"), "zh-CN"),
    ).toBe("明天");
  });
});
