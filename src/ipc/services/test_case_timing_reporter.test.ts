// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareTestCaseTimingReporter } from "./test_case_timing_reporter";
import { TestRunTiming } from "./test_run_timing";
import { sendTelemetryEvent } from "../utils/telemetry";

const { info } = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ info }) },
}));
vi.mock("../utils/telemetry", () => ({ sendTelemetryEvent: vi.fn() }));
const directories: string[] = [];
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of directories.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

function setup() {
  // The CLI reporter option must also work under parent paths containing commas.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dyad,case-timing-"));
  directories.push(directory);
  const artifacts = path.join(directory, "test-results", "invocation");
  fs.mkdirSync(artifacts, { recursive: true });
  const timing = new TestRunTiming({ appId: 1, runId: 1, source: "panel" });
  const recording = prepareTestCaseTimingReporter(directory, artifacts, timing);
  return { directory, artifacts, timing, recording };
}
function caseEvents() {
  expect(sendTelemetryEvent).toHaveBeenCalledTimes(1);
  return info.mock.calls
    .filter(([name]) => name === "e2e_test_case_completed")
    .map(([, properties]) => properties!);
}

it("keeps parallel attempts separate and includes time in fixtures with custom timeouts", () => {
  const { recording, artifacts, timing } = setup();
  for (const [key, value] of Object.entries(recording.env))
    vi.stubEnv(key, value);
  const Reporter = createRequire(import.meta.url)(
    path.join(artifacts, "dyad-timing-reporter.cjs"),
  );
  const reporter = new Reporter();
  const first = { id: "private-path-and-title", repeatEachIndex: 0 };
  const second = { id: "another-private-test", repeatEachIndex: 0 };
  const result = { retry: 0, status: "passed", duration: 20 };
  const retry = { retry: 1, status: "failed", duration: 10 };
  reporter.onTestBegin(first, result);
  reporter.onTestBegin(second, retry);
  reporter.onStepEnd(first, result, {
    category: "hook",
    title: "Before Hooks",
    startTime: new Date(100),
    duration: 1000,
  });
  reporter.onStepEnd(second, retry, {
    category: "hook",
    title: "Before Hooks",
    startTime: new Date(200),
    duration: 50,
  });
  // Nested hooks must not overwrite the inclusive top-level phase.
  reporter.onStepEnd(first, result, {
    parent: {},
    category: "hook",
    title: "Before Hooks",
    startTime: new Date(100),
    duration: 1,
  });
  reporter.onStepEnd(first, result, {
    category: "hook",
    title: "After Hooks",
    startTime: new Date(1300),
    duration: 300,
  });
  reporter.onStepEnd(second, retry, {
    category: "hook",
    title: "After Hooks",
    startTime: new Date(275),
    duration: 10,
  });
  reporter.onTestEnd(second, retry);
  reporter.onTestEnd(first, result);
  recording.collect();
  recording.collect();
  timing.finish();
  expect(caseEvents()).toEqual([
    expect.objectContaining({
      retry: 0,
      status: "completed",
      duration_ms: 1500,
      setup_ms: 1000,
      execution_ms: 200,
      cleanup_ms: 300,
    }),
    expect.objectContaining({
      retry: 1,
      status: "failed",
      duration_ms: 85,
      setup_ms: 50,
      execution_ms: 25,
      cleanup_ms: 10,
    }),
  ]);
  const payload = JSON.stringify(vi.mocked(sendTelemetryEvent).mock.calls);
  expect(payload).not.toContain(first.id);
  expect(payload).not.toContain(second.id);
});

it("retains interrupted attempts and validates telemetry read from runner output", () => {
  const { recording, artifacts, timing } = setup();
  const caseId = "a".repeat(64);
  const output = path.join(artifacts, "case-timings.jsonl");
  fs.writeFileSync(
    output,
    [
      JSON.stringify({
        kind: "started",
        case_id: caseId,
        retry: 0,
        title: "private",
      }),
      JSON.stringify({
        kind: "completed",
        case_id: caseId,
        retry: 0,
        status: "secret",
        duration_ms: 2,
      }),
      '{"kind":"completed"',
    ].join("\r\n"),
  );
  recording.collect();
  timing.finish("cancelled");
  expect(caseEvents()).toEqual([
    expect.objectContaining({
      case_id: caseId,
      status: "cancelled",
      timing_incomplete: true,
      execution_ms: null,
    }),
  ]);
  expect(JSON.stringify(caseEvents())).not.toContain("private");
  expect(JSON.stringify(caseEvents())).not.toContain("secret");
});

it("reports real parallel tests without a database fixture, including skips and failures", async () => {
  const { directory, recording, timing } = setup();
  fs.symlinkSync(
    path.resolve("node_modules"),
    path.join(directory, "node_modules"),
    "junction",
  );
  fs.mkdirSync(path.join(directory, "e2e-tests"));
  fs.writeFileSync(
    path.join(directory, "playwright.config.cjs"),
    `module.exports = { testDir: './e2e-tests', fullyParallel: true, workers: 2 };`,
  );
  fs.writeFileSync(
    path.join(directory, "e2e-tests/parallel.spec.ts"),
    `
import { test, expect } from '@playwright/test';
test.beforeEach(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
test.afterEach(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
test('private passing title', async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
test('private failing title', async () => { await new Promise(resolve => setTimeout(resolve, 80)); expect(1).toBe(2); });
test.skip('private skipped title', () => {});
`,
  );
  const cli = path.join(
    path.dirname(
      createRequire(import.meta.url).resolve("@playwright/test/package.json"),
    ),
    "cli.js",
  );
  const result = await new Promise<{ code: number | null; output: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          cli,
          "test",
          `--reporter=${recording.reporter}`,
          `--output=${path.join(directory, "test-results", "artifacts")}`,
        ],
        {
          cwd: directory,
          env: { ...process.env, ...recording.env, CI: "true" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        output += String(chunk);
      });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, output }));
    },
  );
  expect(result.code, result.output).toBe(1);
  recording.collect();
  timing.finish();
  const cases = caseEvents();
  expect(cases, result.output).toHaveLength(3);
  expect(new Set(cases.map((event) => event.case_id)).size).toBe(3);
  expect(cases.map((event) => event.status).sort()).toEqual([
    "completed",
    "failed",
    "skipped",
  ]);
  for (const event of cases.filter((event) => event.status !== "skipped")) {
    expect(event.timing_incomplete).toBe(false);
    expect(event.setup_ms).toBeGreaterThanOrEqual(15);
    expect(event.execution_ms).toBeGreaterThanOrEqual(30);
    expect(event.cleanup_ms).toBeGreaterThanOrEqual(20);
  }
  expect(JSON.stringify(cases)).not.toContain("private");
}, 30_000);
