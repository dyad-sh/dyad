import { describe, expect, it } from "vitest";
import {
  getEffectiveTempPreviewExpiry,
  isTempPreviewExpired,
  TEMP_PREVIEW_LIFETIME_MS,
} from "./expiry";

describe("temporary preview expiry", () => {
  it("derives a seven-day expiry when the provider omits one", () => {
    const lastPublishedAt = "2026-08-24T00:00:00.000Z";

    expect(getEffectiveTempPreviewExpiry(null, lastPublishedAt)).toBe(
      new Date(
        Date.parse(lastPublishedAt) + TEMP_PREVIEW_LIFETIME_MS,
      ).toISOString(),
    );
  });

  it("fails closed when no valid expiry can be derived", () => {
    expect(isTempPreviewExpired(null, "not-a-timestamp")).toBe(true);
    expect(
      isTempPreviewExpired("also-not-a-timestamp", "not-a-timestamp"),
    ).toBe(true);
  });
});
