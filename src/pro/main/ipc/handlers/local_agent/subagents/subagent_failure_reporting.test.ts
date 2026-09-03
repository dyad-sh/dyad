import { expect, it } from "vitest";

import type { SubagentActivity, SubagentThreadSummary } from "@/ipc/types";
import {
  buildImplementerFailureReport,
  MAX_IMPLEMENTER_FAILURE_REPORT_CHARS,
  projectSubagentFailureText,
  projectSubagentThreadErrorForRenderer,
  type ImplementerJoinSummary,
} from "./subagent_failure_reporting";

function failedThread(
  overrides: Partial<ImplementerJoinSummary> = {},
): ImplementerJoinSummary {
  const now = new Date();
  return {
    id: "implementer-1",
    chatId: 1,
    persona: "implementer",
    taskName: "Fix authentication",
    assignment: "Fix it",
    status: "failed",
    provider: "openai",
    model: "implementer-model",
    reasoningEffort: "high",
    result: null,
    reviewBaseCommit: null,
    reviewTargetCommit: null,
    reviewDiffHash: null,
    sourceMessageId: 10,
    invocationSource: "model",
    remediationSource: null,
    autoFixAt: null,
    error: null,
    inputTokens: 0,
    outputTokens: 0,
    toolCallCount: 0,
    createdAt: now,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
    latestActivity: null,
    ...overrides,
  } satisfies SubagentThreadSummary & {
    latestActivity: SubagentActivity | null;
  };
}

it("reports stored thread error and the latest activity without tool output", () => {
  const report = buildImplementerFailureReport([
    failedThread({
      error: "Model request failed with status 503.",
      latestActivity: {
        id: 3,
        threadId: "implementer-1",
        sequence: 4,
        toolCallId: "call-test",
        toolName: "run_tests",
        status: "error",
        presentationXml: "<dyad-command>very large output</dyad-command>",
        error: "Test command exited with code 1.",
        startedAt: new Date(),
        completedAt: new Date(),
      },
    }),
  ]);

  expect(report.displayMessage).toContain(
    "Fix authentication (failed): Model request failed with status 503.",
  );
  expect(report.displayMessage).toContain(
    "Latest action: run_tests (error): Test command exited with code 1.",
  );
  expect(report.displayMessage).not.toContain("very large output");
  expect(report.telemetryProperties).toEqual({
    failed_implementer_count: 1,
    with_stored_thread_error_count: 1,
    with_latest_activity_count: 1,
    with_latest_activity_error_count: 1,
  });
});

it("uses a useful fallback when no errors or activities were stored", () => {
  const report = buildImplementerFailureReport([failedThread()]);

  expect(report.displayMessage).toContain(
    "Fix authentication (failed): No additional failure details were recorded.",
  );
  expect(report.telemetryProperties).toEqual({
    failed_implementer_count: 1,
    with_stored_thread_error_count: 0,
    with_latest_activity_count: 0,
    with_latest_activity_error_count: 0,
  });
});

it("does not emit failure telemetry for expected terminal statuses", () => {
  expect(
    buildImplementerFailureReport([
      failedThread({
        status: "cancelled",
        error: "The Implementer was cancelled.",
      }),
    ]).telemetryProperties,
  ).toBeNull();
});

it("sanitizes only actual failure thread errors at the renderer boundary", () => {
  const longNotice = `Partial review:\n${"src/example.ts\n".repeat(200)}`;

  expect(projectSubagentThreadErrorForRenderer("partial", longNotice)).toBe(
    longNotice,
  );
  expect(
    projectSubagentThreadErrorForRenderer("failed", longNotice)?.length,
  ).toBeLessThanOrEqual(1_200);
});

it("redacts sensitive diagnostics and excludes them from telemetry", () => {
  const report = buildImplementerFailureReport([
    failedThread({
      error:
        "Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz at /Users/alice/private/app",
    }),
  ]);

  expect(report.displayMessage).not.toContain("ghp_");
  expect(report.displayMessage).not.toContain("alice");
  expect(JSON.stringify(report.telemetryProperties)).not.toContain("ghp_");
  expect(
    projectSubagentFailureText("Ordinary provider failure")?.displayText,
  ).toBe("Ordinary provider failure");
});

it("preserves bounded task names and applies a final aggregate bound", () => {
  const report = buildImplementerFailureReport(
    Array.from({ length: 10 }, (_, index) =>
      failedThread({
        id: `implementer-${index}`,
        taskName: `Fix /api/users endpoint ${index}`,
        error: "x".repeat(2_000),
      }),
    ),
  );

  expect(report.displayMessage).toContain("Fix /api/users endpoint 0");
  expect(report.displayMessage.length).toBeLessThanOrEqual(
    MAX_IMPLEMENTER_FAILURE_REPORT_CHARS,
  );
  expect(report.displayMessage.endsWith("… [truncated]")).toBe(true);
});

it("does not label a completed latest activity as the failure action", () => {
  const report = buildImplementerFailureReport([
    failedThread({
      error: "The next model step failed.",
      latestActivity: {
        id: 3,
        threadId: "implementer-1",
        sequence: 4,
        toolCallId: "call-test",
        toolName: "run_tests",
        status: "completed",
        presentationXml: "<dyad-command />",
        error: null,
        startedAt: new Date(),
        completedAt: new Date(),
      },
    }),
  ]);

  expect(report.displayMessage).toContain("The next model step failed.");
  expect(report.displayMessage).not.toContain("Latest action: run_tests");
});
