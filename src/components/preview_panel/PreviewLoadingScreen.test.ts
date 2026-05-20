import { describe, expect, it } from "vitest";
import type { ConsoleEntry } from "@/ipc/types";
import {
  getPreviewLoadingSessionStartedAt,
  sanitizePreviewErrorForPrompt,
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
        fallbackStartedAt: 50,
      }),
    ).toBe(200);
  });

  it("falls back to the visible timestamp before a startup log exists", () => {
    expect(
      getPreviewLoadingSessionStartedAt({
        consoleEntries: [entry("Preparing package manager...", 120)],
        fallbackStartedAt: 75,
      }),
    ).toBe(75);
  });

  it("removes control characters and caps error excerpts sent to AI", () => {
    const message = `\u001b[31merror\u001b[0m\u0000${"x".repeat(2_100)}`;
    const sanitized = sanitizePreviewErrorForPrompt(message);

    expect(sanitized).not.toContain("\u001b");
    expect(sanitized).not.toContain("\u0000");
    expect(sanitized).toContain("[truncated]");
    expect(sanitized.length).toBeLessThan(message.length);
  });
});
