import { describe, expect, it } from "vitest";
import {
  getNeonErrorMessage,
  getRetentionWindowFromError,
  isRetentionWindowError,
} from "./neon_errors";

// Mimics the shape of an axios error thrown by the Neon API client.
function neonApiError({
  message,
  detail,
}: {
  message: string;
  detail: string;
}) {
  return Object.assign(new Error(message), {
    response: { status: 400, data: { message: detail } },
  });
}

const RETENTION_ERROR = neonApiError({
  message: "Request failed with status code 400",
  detail:
    'timestamp is before retention window; timestamp:"2026-06-04 00:25:59 +0000 UTC", retention_window:"6h0m0s"',
});

describe("getNeonErrorMessage", () => {
  it("combines the error message with the API detail message", () => {
    expect(getNeonErrorMessage(RETENTION_ERROR)).toBe(
      'Request failed with status code 400 timestamp is before retention window; timestamp:"2026-06-04 00:25:59 +0000 UTC", retention_window:"6h0m0s"',
    );
  });

  it("falls back to the plain error message", () => {
    expect(getNeonErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("handles nullish and string inputs", () => {
    expect(getNeonErrorMessage(null)).toBe("Unknown Neon error");
    expect(getNeonErrorMessage("plain string error")).toBe(
      "plain string error",
    );
  });
});

describe("isRetentionWindowError", () => {
  it("detects the retention-window error", () => {
    expect(isRetentionWindowError(RETENTION_ERROR)).toBe(true);
  });

  it("detects it even when only the message string is present", () => {
    expect(
      isRetentionWindowError(
        new Error(
          'timestamp is before retention window; retention_window:"6h"',
        ),
      ),
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isRetentionWindowError(new Error("branch is locked"))).toBe(false);
    expect(isRetentionWindowError(null)).toBe(false);
  });
});

describe("getRetentionWindowFromError", () => {
  it("formats a Go-style duration into human-readable text", () => {
    expect(getRetentionWindowFromError(RETENTION_ERROR)).toBe("6 hours");
  });

  it("formats compound durations and singular units", () => {
    expect(
      getRetentionWindowFromError(
        new Error('retention window exceeded; retention_window:"1h30m1s"'),
      ),
    ).toBe("1 hour 30 minutes 1 second");
  });

  it("returns null when there is no retention window in the message", () => {
    expect(getRetentionWindowFromError(new Error("some other error"))).toBe(
      null,
    );
  });
});
