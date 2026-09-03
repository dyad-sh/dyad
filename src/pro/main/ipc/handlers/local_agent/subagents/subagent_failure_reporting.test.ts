import { expect, it } from "vitest";

import type { SubagentActivity, SubagentThreadSummary } from "@/ipc/types";
import {
  buildImplementerFailureReport,
  projectSubagentFailureText,
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
  expect(report.telemetryMessage).toContain("Model request failed");
});

it("uses a useful fallback when no errors or activities were stored", () => {
  const report = buildImplementerFailureReport([failedThread()]);

  expect(report.displayMessage).toContain(
    "Fix authentication (failed): No additional failure details were recorded.",
  );
  expect(report.telemetryMessage).toContain("no stored failure detail");
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
  expect(report.telemetryMessage).toBeNull();
  expect(
    projectSubagentFailureText("Ordinary provider failure")?.telemetrySafe,
  ).toBe(true);
});
