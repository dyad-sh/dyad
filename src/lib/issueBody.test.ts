import { describe, expect, it } from "vitest";
import {
  buildBugReportBody,
  buildBugReportFallbackBody,
  buildSessionReportBody,
  buildSessionReportFallbackBody,
  formatScreenshotStatusLine,
} from "./issueBody";
import { type SystemDebugInfo } from "@/ipc/types";
import { type UserBudgetInfo } from "@/ipc/types/system";

const debugInfo: SystemDebugInfo = {
  nodeVersion: "20.0.0",
  pnpmVersion: "9.0.0",
  nodePath: "/usr/bin/node",
  telemetryId: "telemetry-id",
  telemetryConsent: "opted_in",
  telemetryUrl: "https://example.test",
  dyadVersion: "1.2.3",
  platform: "linux",
  architecture: "x64",
  logs: "some logs",
  updaterLogs: null,
  selectedLanguageModel: "auto",
};

const userBudget: UserBudgetInfo = {
  usedCredits: 1,
  totalCredits: 10,
  budgetResetDate: new Date(0),
  redactedUserId: "user-abc",
  isTrial: false,
};

const common = {
  debugInfo,
  settings: null,
  selectedModel: null,
  userBudget,
};

describe("formatScreenshotStatusLine", () => {
  it("uses a stable prefix so published issues can be counted", () => {
    expect(formatScreenshotStatusLine({ status: "captured" })).toContain(
      "Screenshot status: captured",
    );
    expect(formatScreenshotStatusLine({ status: "declined" })).toBe(
      "Screenshot status: declined",
    );
    expect(formatScreenshotStatusLine({ status: "capture-failed" })).toBe(
      "Screenshot status: capture-failed",
    );
  });

  it("tells a maintainer to ask for a screenshot the reporter already has", () => {
    expect(formatScreenshotStatusLine({ status: "captured" })).toContain(
      "ask them to paste it",
    );
  });

  it("includes the failure reason when capture failed", () => {
    expect(
      formatScreenshotStatusLine({
        status: "capture-failed",
        reason: "No focused window to capture",
      }),
    ).toBe("Screenshot status: capture-failed (No focused window to capture)");
  });
});

describe("buildBugReportBody", () => {
  it("records the screenshot status under the screenshot section", () => {
    const body = buildBugReportBody({
      ...common,
      screenshot: { status: "captured" },
    });
    expect(body).toContain(
      "## Screenshot (recommended)\n<!-- Screenshot of the bug -->\nScreenshot status: captured",
    );
  });

  it.each(["captured", "declined", "capture-failed"] as const)(
    "records %s",
    (status) => {
      const body = buildBugReportBody({ ...common, screenshot: { status } });
      expect(body).toContain(`Screenshot status: ${status}`);
    },
  );

  it("keeps the existing report sections", () => {
    const body = buildBugReportBody({
      ...common,
      screenshot: { status: "declined" },
    });
    expect(body).toContain("## Bug Description (required)");
    expect(body).toContain("## System Information");
    expect(body).toContain("- Dyad Version: 1.2.3");
    expect(body).toContain("## Settings");
    expect(body).toContain("## Logs");
  });
});

describe("buildSessionReportBody", () => {
  it("records the screenshot status", () => {
    const body = buildSessionReportBody({
      ...common,
      sessionId: "v2:abc",
      screenshot: { status: "captured" },
    });
    expect(body).toContain("Screenshot status: captured");
  });

  it("keeps the session ID that makes the report actionable", () => {
    const body = buildSessionReportBody({
      ...common,
      sessionId: "v2:abc",
      screenshot: { status: "declined" },
    });
    expect(body).toContain("Session ID: v2:abc");
    expect(body).toContain("Session Schema: v2.0");
    expect(body).toContain("Pro User ID: user-abc");
  });
});

describe("buildBugReportFallbackBody", () => {
  it("still carries the screenshot status", () => {
    const body = buildBugReportFallbackBody({
      screenshot: { status: "captured" },
    });
    expect(body).toContain("Screenshot status: captured");
    expect(body).toContain("## Bug Description (required)");
  });
});

describe("buildSessionReportFallbackBody", () => {
  it("still carries the session ID and screenshot status", () => {
    const body = buildSessionReportFallbackBody({
      userBudget,
      sessionId: "v2:abc",
      screenshot: { status: "capture-failed", reason: "boom" },
    });
    expect(body).toContain("Session ID: v2:abc");
    expect(body).toContain("Screenshot status: capture-failed (boom)");
  });
});
