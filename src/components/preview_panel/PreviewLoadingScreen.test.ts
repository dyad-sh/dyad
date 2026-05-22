import { describe, expect, it } from "vitest";
import type { ConsoleEntry } from "@/ipc/types";
import {
  didPreviewCommandFail,
  getPreviewLoadingSessionStartedAt,
  isWarningMessage,
  sanitizePreviewErrorForPrompt,
  shouldShowPreviewErrorBanner,
} from "./PreviewLoadingScreen";

const entry = (
  message: string,
  timestamp: number,
  level: ConsoleEntry["level"] = "info",
): ConsoleEntry => ({
  appId: 1,
  level,
  message,
  timestamp,
  type: "server",
});

describe("PreviewLoadingScreen helpers", () => {
  it("uses the latest startup log as the loading session boundary", () => {
    const consoleEntries = [
      entry("Connecting to app...", 100),
      entry("old error", 110, "error"),
      entry("Restarting app...", 200),
      entry("new error", 210, "error"),
    ];

    expect(
      getPreviewLoadingSessionStartedAt({
        consoleEntries,
        runStartedAt: 50,
      }),
    ).toBe(200);
  });

  it("falls back to the run timestamp before a startup log exists", () => {
    expect(
      getPreviewLoadingSessionStartedAt({
        consoleEntries: [entry("Preparing package manager...", 120)],
        runStartedAt: 75,
      }),
    ).toBe(75);
  });

  it("ignores startup logs before the current run started", () => {
    expect(
      getPreviewLoadingSessionStartedAt({
        consoleEntries: [
          entry("Connecting to app...", 100),
          entry("old error", 110, "error"),
        ],
        runStartedAt: 200,
      }),
    ).toBe(200);
  });

  describe("isWarningMessage", () => {
    it.each([
      "(node:1234) [DEP0123] DeprecationWarning: Buffer() is deprecated",
      "Deprecation: The `punycode` module is deprecated.",
      "npm warn deprecated inflight@1.0.6",
      "NPM WARN deprecated glob@7.2.3",
    ])("returns true for non-actionable stderr: %s", (message) => {
      expect(isWarningMessage(message)).toBe(true);
    });

    it.each([
      "Error: Cannot find module 'react'",
      "ELIFECYCLE Command failed with exit code 1",
      "Failed to compile",
      "Deprecation without colon suffix",
    ])("returns false for actionable errors: %s", (message) => {
      expect(isWarningMessage(message)).toBe(false);
    });
  });

  it("removes control characters and caps error excerpts sent to AI", () => {
    const message = `\u001b[31merror\u001b[0m\u0000${"x".repeat(2_100)}`;
    const sanitized = sanitizePreviewErrorForPrompt(message);

    expect(sanitized).not.toContain("\u001b");
    expect(sanitized).not.toContain("\u0000");
    expect(sanitized).toContain("[truncated]");
    expect(sanitized.length).toBeLessThan(message.length);
  });

  describe("didPreviewCommandFail", () => {
    it("returns true only for a non-zero exit in the current loading session", () => {
      expect(
        didPreviewCommandFail({
          previewAppExit: { appId: 1, exitCode: 1, timestamp: 200 },
          sessionStartedAt: 100,
          currentAppId: 1,
        }),
      ).toBe(true);

      expect(
        didPreviewCommandFail({
          previewAppExit: { appId: 1, exitCode: 0, timestamp: 200 },
          sessionStartedAt: 100,
          currentAppId: 1,
        }),
      ).toBe(false);

      expect(
        didPreviewCommandFail({
          previewAppExit: { appId: 1, exitCode: 1, timestamp: 50 },
          sessionStartedAt: 100,
          currentAppId: 1,
        }),
      ).toBe(false);

      expect(
        didPreviewCommandFail({
          previewAppExit: { appId: 1, exitCode: null, timestamp: 200 },
          sessionStartedAt: 100,
          currentAppId: 1,
        }),
      ).toBe(false);
    });

    it("returns false when the exit belongs to a different app", () => {
      expect(
        didPreviewCommandFail({
          previewAppExit: { appId: 1, exitCode: 1, timestamp: 200 },
          sessionStartedAt: 100,
          currentAppId: 2,
        }),
      ).toBe(false);
    });
  });

  describe("shouldShowPreviewErrorBanner", () => {
    it("hides the banner when errors are logged before the command exits", () => {
      expect(
        shouldShowPreviewErrorBanner({
          errorMessages: ["Error: still compiling"],
          previewAppExit: null,
          sessionStartedAt: 100,
          currentAppId: 1,
        }),
      ).toBe(false);
    });

    it("hides the banner when the command exits successfully", () => {
      expect(
        shouldShowPreviewErrorBanner({
          errorMessages: ["Error: noisy stderr"],
          previewAppExit: { appId: 1, exitCode: 0, timestamp: 200 },
          sessionStartedAt: 100,
          currentAppId: 1,
        }),
      ).toBe(false);
    });

    it("shows the banner only when the current command exits non-zero with errors", () => {
      expect(
        shouldShowPreviewErrorBanner({
          errorMessages: ["Error: Cannot find module 'react'"],
          previewAppExit: { appId: 1, exitCode: 1, timestamp: 200 },
          sessionStartedAt: 100,
          currentAppId: 1,
        }),
      ).toBe(true);
    });

    it("hides the banner when the exit belongs to a different app", () => {
      expect(
        shouldShowPreviewErrorBanner({
          errorMessages: ["Error: Cannot find module 'react'"],
          previewAppExit: { appId: 1, exitCode: 1, timestamp: 200 },
          sessionStartedAt: 100,
          currentAppId: 2,
        }),
      ).toBe(false);
    });
  });
});
