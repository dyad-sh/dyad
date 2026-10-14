import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { TestRunTiming } from "./test_run_timing";

// Shared by the reporter and generated fixture. Neither titles nor paths are
// sent to telemetry; retries and separate preview invocations get distinct IDs.
export const TEST_CASE_TIMING_ID_EXPRESSION = `createHash("sha256").update(JSON.stringify([
  process.env.DYAD_TEST_TIMING_INVOCATION,
  testInfo.testId, testInfo.retry, testInfo.repeatEachIndex,
])).digest("hex")`;

export function buildTestCaseTimingReporter(): string {
  return `const { appendFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const output = process.env.DYAD_TEST_TIMING_OUTPUT;
function identity(test, result) {
  const testInfo = { testId: test.id, retry: result.retry, repeatEachIndex: test.repeatEachIndex };
  return { case_id: ${TEST_CASE_TIMING_ID_EXPRESSION}, retry: result.retry };
}
function write(record) {
  try { if (output) appendFileSync(output, JSON.stringify(record) + "\\n"); } catch {}
}
module.exports = class {
  attempts = new WeakMap();
  printsToStdio() { return false; }
  onTestBegin(test, result) {
    this.attempts.set(result, { started: performance.now(), before: null, after: null });
    write({ kind: "started", ...identity(test, result) });
  }
  onStepEnd(test, result, step) {
    if (step.parent || step.category !== "hook") return;
    const attempt = this.attempts.get(result);
    if (!attempt) return;
    const phase = { start: step.startTime.getTime(), duration: step.duration };
    if (step.title === "Before Hooks") attempt.before = phase;
    if (step.title === "After Hooks") attempt.after = phase;
  }
  onTestEnd(test, result) {
    const attempt = this.attempts.get(result);
    if (!attempt) return;
    const { before, after } = attempt;
    const skipped = result.status === "skipped" && !before && !after;
    // Playwright's result.duration excludes fixtures with their own timeout.
    // Hook spans include those fixtures, including database provisioning.
    const setup = before ? before.duration : skipped ? 0 : null;
    const execution = before && after
      ? Math.max(0, after.start - before.start - before.duration)
      : skipped ? 0 : null;
    const cleanup = after ? after.duration : skipped ? 0 : null;
    const status = { passed: "completed", timedOut: "timed_out", interrupted: "cancelled" }[result.status] || result.status;
    write({ kind: "completed", ...identity(test, result), status,
      duration_ms: before && after ? Math.max(0, after.start + after.duration - before.start)
        : skipped ? 0 : Math.round(performance.now() - attempt.started),
      setup_ms: setup, execution_ms: execution, cleanup_ms: cleanup });
    this.attempts.delete(result);
  }
};
`;
}

const duration = z.number().finite().nonnegative();
const identity = z.object({
  case_id: z.string().regex(/^[a-f0-9]{64}$/),
  retry: z.number().int().nonnegative(),
});
const recordSchema = z.discriminatedUnion("kind", [
  identity.extend({ kind: z.literal("started") }),
  identity.extend({
    kind: z.literal("completed"),
    status: z.enum([
      "completed",
      "failed",
      "timed_out",
      "cancelled",
      "skipped",
    ]),
    duration_ms: duration,
    setup_ms: duration.nullable(),
    execution_ms: duration.nullable(),
    cleanup_ms: duration.nullable(),
  }),
]);

/** A reporter per Playwright invocation, including non-isolated/parallel runs. */
export function prepareTestCaseTimingReporter(
  appPath: string,
  artifactsDir: string,
  timing?: TestRunTiming,
) {
  if (!timing) return { reporter: "list,json", env: {}, collect() {} };
  const reporterPath = path.join(artifactsDir, "dyad-timing-reporter.cjs");
  const outputPath = path.join(artifactsDir, "case-timings.jsonl");
  try {
    fs.writeFileSync(reporterPath, buildTestCaseTimingReporter());
  } catch {
    // Observability cannot prevent a test from running.
    return { reporter: "list,json", env: {}, collect() {} };
  }
  // Use the generated relative path: absolute parent paths can contain commas,
  // which Playwright interprets as reporter separators, including on Windows.
  const relativeReporter =
    "./" + path.relative(appPath, reporterPath).split(path.sep).join("/");
  return {
    reporter: `list,json,${relativeReporter}`,
    env: {
      DYAD_TEST_TIMING_OUTPUT: outputPath,
      DYAD_TEST_TIMING_INVOCATION: randomUUID(),
    },
    collect() {
      try {
        for (const line of fs.readFileSync(outputPath, "utf8").split(/\r?\n/)) {
          try {
            const parsed = recordSchema.safeParse(JSON.parse(line));
            if (!parsed.success) continue;
            const { kind, ...record } = parsed.data;
            timing.recordCaseStarted(record.case_id, record.retry);
            if (kind === "completed" && "status" in record)
              timing.recordCaseResult(record);
          } catch {
            // A killed runner may leave its final line incomplete.
          }
        }
      } catch {
        // Missing output after a spawn failure is expected.
      }
    },
  };
}
