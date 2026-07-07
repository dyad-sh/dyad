import { describe, expect, it } from "vitest";
import { formatUpdaterLogsForIssueBody } from "./debugLogFormatting";

describe("formatUpdaterLogsForIssueBody", () => {
  it("keeps the in-session updater error when Squirrel tails exceed the issue body budget", () => {
    const updaterLogs = [
      "Last updater error (this session):\nSystem.Net.WebException: root cause",
      `SquirrelSetup.log (tail):\n${"stack tail\n".repeat(80)}`,
    ].join("\n\n");

    const formatted = formatUpdaterLogsForIssueBody(updaterLogs, 180);

    expect(formatted.length).toBeLessThanOrEqual(180);
    expect(formatted).toContain("Last updater error (this session)");
    expect(formatted).toContain("System.Net.WebException: root cause");
    expect(formatted).toContain("stack tail");
  });

  it("falls back to the most recent tail when no in-session error section exists", () => {
    const updaterLogs = `SquirrelSetup.log (tail):\n${"old\n".repeat(80)}latest`;

    const formatted = formatUpdaterLogsForIssueBody(updaterLogs, 40);

    expect(formatted.length).toBe(40);
    expect(formatted).toContain("latest");
  });
});
