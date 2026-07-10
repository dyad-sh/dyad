import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "./types";
import type { RunAppTestsResult } from "@/ipc/types/tests";

vi.mock("@/ipc/handlers/tests_handlers", () => ({
  runAppTestsWithIsolation: vi.fn(),
  getRunningTestBaseUrl: vi.fn(),
  // Identity so keys are stable in tests.
  normalizeRunTestFile: (f: string) => f,
}));
vi.mock("@/ipc/utils/test_screenshot", () => ({
  readTestScreenshotDataUrl: vi.fn(),
}));

import {
  runAppTestsWithIsolation,
  getRunningTestBaseUrl,
} from "@/ipc/handlers/tests_handlers";
import { readTestScreenshotDataUrl } from "@/ipc/utils/test_screenshot";
import { runTestsTool } from "./run_tests";

const runner = vi.mocked(runAppTestsWithIsolation);
const baseUrl = vi.mocked(getRunningTestBaseUrl);
const screenshot = vi.mocked(readTestScreenshotDataUrl);

function makeCtx(): AgentContext {
  return {
    appId: 1,
    appPath: "/app",
    event: { sender: {} },
    fileEditTracker: Object.create(null),
    testingEnabled: true,
    testRunAttempts: new Map(),
    abortSignal: undefined,
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    appendUserMessage: vi.fn(),
  } as unknown as AgentContext;
}

const passedResult: RunAppTestsResult = {
  appId: 1,
  results: [{ file: "tests/a.spec.ts", status: "passed" }],
  isolation: { mode: "neon-branch" },
};

function failResult(error: string, screenshotPath?: string): RunAppTestsResult {
  return {
    appId: 1,
    results: [
      {
        file: "tests/a.spec.ts",
        status: "failed",
        error,
        tests: [
          { title: "does a thing", status: "failed", error, screenshotPath },
        ],
      },
    ],
    isolation: { mode: "neon-branch" },
  };
}

const infraResult: RunAppTestsResult = {
  appId: 1,
  results: [],
  infraError: { message: "Playwright bootstrap failed" },
};

/** A selector/timeout failure Playwright's heuristic labels "inconclusive". */
function inconclusiveResult(error: string): RunAppTestsResult {
  return {
    appId: 1,
    results: [
      {
        file: "tests/a.spec.ts",
        status: "inconclusive",
        error,
        tests: [{ title: "does a thing", status: "inconclusive", error }],
      },
    ],
    isolation: { mode: "neon-branch" },
  };
}

/** Bump the edit tracker so the require-a-change guard sees a new edit. */
function addEdit(ctx: AgentContext, file: string) {
  const existing = ctx.fileEditTracker[file] ?? {
    write_file: 0,
    search_replace: 0,
  };
  ctx.fileEditTracker[file] = {
    ...existing,
    write_file: existing.write_file + 1,
  };
}

describe("runTestsTool", () => {
  beforeEach(() => {
    runner.mockReset();
    baseUrl.mockReset();
    screenshot.mockReset();
    baseUrl.mockReturnValue("http://localhost:3000");
    screenshot.mockReturnValue(null);
  });

  it("is gated on testingEnabled", () => {
    expect(
      runTestsTool.isEnabled?.({ testingEnabled: true } as AgentContext),
    ).toBe(true);
    expect(
      runTestsTool.isEnabled?.({ testingEnabled: false } as AgentContext),
    ).toBe(false);
  });

  it("returns an infra message (uncounted) when the dev server isn't running", async () => {
    baseUrl.mockReturnValue(null);
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "tests/a.spec.ts" },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("dev server isn't running");
    expect(out).toContain("did NOT count");
    expect(ctx.testRunAttempts.get("tests/a.spec.ts")?.attempts ?? 0).toBe(0);
  });

  it("reports success and clears attempt state", async () => {
    runner.mockResolvedValue(passedResult);
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "tests/a.spec.ts" },
      ctx,
    );
    expect(out).toContain("All tests passed");
    expect(ctx.testRunAttempts.has("tests/a.spec.ts")).toBe(false);
  });

  it("counts a failure and attaches the screenshot", async () => {
    runner.mockResolvedValue(
      failResult("boom", "/app/test-results/a/test-failed-1.png"),
    );
    screenshot.mockReturnValue("data:image/png;base64,ABC");
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "tests/a.spec.ts" },
      ctx,
    );
    expect(out).toContain("Test run FAILED (attempt 1 of 4");
    expect(out).toContain("test-results/a/error-context.md");
    expect(ctx.testRunAttempts.get("tests/a.spec.ts")?.attempts).toBe(1);
    expect(ctx.appendUserMessage).toHaveBeenCalledTimes(1);
    const parts = vi.mocked(ctx.appendUserMessage).mock.calls[0][0];
    expect(parts).toContainEqual({
      type: "image-url",
      url: "data:image/png;base64,ABC",
    });
  });

  it("adds a no-progress note when the failure signature is unchanged", async () => {
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    await runTestsTool.execute({ testFile: "tests/a.spec.ts" }, ctx);
    addEdit(ctx, "tests/a.spec.ts"); // pass the require-a-change guard
    const out = await runTestsTool.execute(
      { testFile: "tests/a.spec.ts" },
      ctx,
    );
    expect(out).toContain("did NOT alter the failure");
    expect(ctx.testRunAttempts.get("tests/a.spec.ts")?.attempts).toBe(2);
  });

  it("refuses to rerun when no files changed since the last run", async () => {
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    await runTestsTool.execute({ testFile: "tests/a.spec.ts" }, ctx);
    runner.mockClear();
    const out = await runTestsTool.execute(
      { testFile: "tests/a.spec.ts" },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("haven't modified any files");
    // Still only the one counted attempt.
    expect(ctx.testRunAttempts.get("tests/a.spec.ts")?.attempts).toBe(1);
  });

  it("allows one free flakeCheck rerun without a change and without counting", async () => {
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    await runTestsTool.execute({ testFile: "tests/a.spec.ts" }, ctx);
    runner.mockClear();
    const out = await runTestsTool.execute(
      { testFile: "tests/a.spec.ts", flakeCheck: true },
      ctx,
    );
    expect(runner).toHaveBeenCalledTimes(1);
    expect(out).toContain("Test run FAILED");
    // Free flake run does not increment the counter.
    expect(ctx.testRunAttempts.get("tests/a.spec.ts")?.attempts).toBe(1);
  });

  it("refuses without running once the attempt cap is reached", async () => {
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    for (let i = 0; i < 4; i++) {
      addEdit(ctx, "tests/a.spec.ts");
      await runTestsTool.execute({ testFile: "tests/a.spec.ts" }, ctx);
    }
    expect(ctx.testRunAttempts.get("tests/a.spec.ts")?.attempts).toBe(4);
    runner.mockClear();
    addEdit(ctx, "tests/a.spec.ts");
    const out = await runTestsTool.execute(
      { testFile: "tests/a.spec.ts" },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("Attempt limit reached");
  });

  it("treats a whole-run infra error (no report) as uncounted", async () => {
    runner.mockResolvedValue(infraResult);
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "tests/a.spec.ts" },
      ctx,
    );
    expect(out).toContain("infrastructure problem");
    expect(out).toContain("did NOT count");
    expect(ctx.testRunAttempts.get("tests/a.spec.ts")?.attempts ?? 0).toBe(0);
  });

  it("treats an inconclusive (selector/timeout) result as a counted failure", async () => {
    // Regression: a strict-mode / hidden-element failure is a test bug the
    // agent should fix, NOT an 'infrastructure problem'.
    runner.mockResolvedValue(
      inconclusiveResult(
        "strict mode violation: locator resolved to 2 elements",
      ),
    );
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "tests/a.spec.ts" },
      ctx,
    );
    expect(out).toContain("Test run FAILED");
    expect(out).not.toContain("infrastructure problem");
    expect(out).toContain("locator/timeout/strict-mode");
    expect(ctx.testRunAttempts.get("tests/a.spec.ts")?.attempts).toBe(1);
  });

  it("truncates long error output", async () => {
    const longError = "x".repeat(9000);
    runner.mockResolvedValue(failResult(longError));
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "tests/a.spec.ts" },
      ctx,
    );
    expect(out).toContain("(truncated)");
    expect(out.length).toBeLessThan(longError.length);
  });
});
