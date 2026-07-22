import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "./types";
import type { RunAppTestsResult } from "@/ipc/types/tests";

vi.mock("@/ipc/handlers/tests_handlers", () => ({
  runAppTestsWithIsolation: vi.fn(),
  getRunningTestBaseUrl: vi.fn(),
  // Identity so keys are stable in tests.
  normalizeRunTestFile: (f: string) => f,
  listSpecFiles: vi.fn(),
  readSpecTestCases: vi.fn(),
}));
vi.mock("@/ipc/utils/test_screenshot", () => ({
  readTestScreenshotDataUrl: vi.fn(),
}));
vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({})),
}));

import {
  runAppTestsWithIsolation,
  getRunningTestBaseUrl,
  listSpecFiles,
  readSpecTestCases,
} from "@/ipc/handlers/tests_handlers";
import { readTestScreenshotDataUrl } from "@/ipc/utils/test_screenshot";
import { readSettings } from "@/main/settings";
import { runTestsTool } from "./run_tests";

const runner = vi.mocked(runAppTestsWithIsolation);
const baseUrl = vi.mocked(getRunningTestBaseUrl);
const screenshot = vi.mocked(readTestScreenshotDataUrl);
const specLister = vi.mocked(listSpecFiles);
const caseLister = vi.mocked(readSpecTestCases);
const settingsReader = vi.mocked(readSettings);

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

/** All user-facing XML the tool emitted (dyad-status/dyad-output titles + bodies). */
function emittedXml(ctx: AgentContext): string {
  return [
    ...vi.mocked(ctx.onXmlStream).mock.calls,
    ...vi.mocked(ctx.onXmlComplete).mock.calls,
  ]
    .map((c) => String(c[0]))
    .join("\n");
}

const passedResult: RunAppTestsResult = {
  appId: 1,
  results: [{ file: "e2e-tests/a.spec.ts", status: "passed" }],
  isolation: { mode: "neon-branch" },
};

function failResult(error: string, screenshotPath?: string): RunAppTestsResult {
  return {
    appId: 1,
    results: [
      {
        file: "e2e-tests/a.spec.ts",
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
        file: "e2e-tests/a.spec.ts",
        status: "inconclusive",
        error,
        tests: [{ title: "does a thing", status: "inconclusive", error }],
      },
    ],
    isolation: { mode: "neon-branch" },
  };
}

/** Bump the mutation count so the require-a-change guard sees a new change. */
function addEdit(ctx: AgentContext, _file: string) {
  ctx.mutationCount = (ctx.mutationCount ?? 0) + 1;
}

describe("runTestsTool", () => {
  beforeEach(() => {
    runner.mockReset();
    baseUrl.mockReset();
    screenshot.mockReset();
    specLister.mockReset();
    caseLister.mockReset();
    baseUrl.mockReturnValue("http://localhost:3000");
    screenshot.mockResolvedValue(null);
    // The spec the tests target exists on disk, so pre-flight resolution lets
    // the run proceed. Individual tests override this to exercise mismatches.
    specLister.mockResolvedValue(["e2e-tests/a.spec.ts"]);
    caseLister.mockResolvedValue([{ title: "does a thing", line: 3 }]);
    // Default: headless + serial (the Tests panel's unset defaults).
    settingsReader.mockReturnValue({} as ReturnType<typeof readSettings>);
  });

  it("is gated on testingEnabled", () => {
    expect(
      runTestsTool.isEnabled?.({ testingEnabled: true } as AgentContext),
    ).toBe(true);
    expect(
      runTestsTool.isEnabled?.({ testingEnabled: false } as AgentContext),
    ).toBe(false);
  });

  it("defaults to headless + serial when no Tests-panel mode is set", async () => {
    runner.mockResolvedValue(passedResult);
    await runTestsTool.execute({ testFile: "e2e-tests/a.spec.ts" }, makeCtx());
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({ headed: false, parallel: false }),
    );
  });

  it("forwards the Tests-panel headed/parallel modes to the runner", async () => {
    settingsReader.mockReturnValue({
      testHeaded: true,
      testParallel: true,
    } as ReturnType<typeof readSettings>);
    runner.mockResolvedValue(passedResult);
    await runTestsTool.execute({ testFile: "e2e-tests/a.spec.ts" }, makeCtx());
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({ headed: true, parallel: true }),
    );
  });

  it("never parallelizes a grep-narrowed run even when parallel is on", async () => {
    settingsReader.mockReturnValue({
      testParallel: true,
    } as ReturnType<typeof readSettings>);
    runner.mockResolvedValue(passedResult);
    await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", grep: "does a thing" },
      makeCtx(),
    );
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({ parallel: false }),
    );
  });

  it("returns an infra message (uncounted) when the dev server isn't running", async () => {
    baseUrl.mockReturnValue(null);
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts" },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("dev server isn't running");
    expect(out).toContain("did NOT count");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts ?? 0).toBe(
      0,
    );
  });

  it("reports success and resets the fix budget", async () => {
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    await runTestsTool.execute({ testFile: "e2e-tests/a.spec.ts" }, ctx);
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(1);
    addEdit(ctx, "e2e-tests/a.spec.ts");
    runner.mockResolvedValue(passedResult);
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts" },
      ctx,
    );
    expect(out).toContain("All runnable tests passed");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(0);
  });

  it("refuses an unchanged rerun after a whole-file pass (targeted or not)", async () => {
    runner.mockResolvedValue(passedResult);
    const ctx = makeCtx();
    await runTestsTool.execute({ testFile: "e2e-tests/a.spec.ts" }, ctx);
    runner.mockClear();
    const wholeAgain = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts" },
      ctx,
    );
    const targeted = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", grep: "does a thing" },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(wholeAgain).toContain("already passed");
    expect(wholeAgain).toContain("Do NOT run it again");
    expect(targeted).toContain("already passed");
  });

  it("refuses to loop over already-passed targets, but still allows the whole-file run", async () => {
    // The alternating loop: test A passes, test B passes, then the model tries
    // A again, then B again — with no edits in between. Both reruns must be
    // refused. The whole-file run isn't required, but is still allowed if the
    // agent chooses to re-verify the rest of the spec.
    caseLister.mockResolvedValue([
      { title: "test A", line: 3 },
      { title: "test B", line: 12 },
    ]);
    runner.mockResolvedValue(passedResult);
    const ctx = makeCtx();
    await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", grep: "test A" },
      ctx,
    );
    await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", grep: "test B" },
      ctx,
    );
    runner.mockClear();
    const rerunA = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", grep: "test A" },
      ctx,
    );
    const rerunB = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", grep: "test B" },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(rerunA).toContain("/test A/ already passed");
    expect(rerunB).toContain("/test B/ already passed");
    expect(rerunA).toContain("Do NOT run it again");
    // A targeted pass no longer requires re-running the whole file, but it's
    // still allowed if the agent wants to verify the rest of the spec.
    await runTestsTool.execute({ testFile: "e2e-tests/a.spec.ts" }, ctx);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("refuses differently-spelled grep patterns that target the same passed test", async () => {
    caseLister.mockResolvedValue([{ title: "does a thing", line: 3 }]);
    runner.mockResolvedValue(passedResult);
    const ctx = makeCtx();
    await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", grep: "does.*thing" },
      ctx,
    );
    runner.mockClear();

    const rerun = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", grep: "does a thing" },
      ctx,
    );

    expect(runner).not.toHaveBeenCalled();
    expect(rerun).toContain("/does a thing/ already passed");
  });

  it("allows rerunning a passed target after a file edit or with flakeCheck", async () => {
    runner.mockResolvedValue(passedResult);
    const ctx = makeCtx();
    await runTestsTool.execute({ testFile: "e2e-tests/a.spec.ts" }, ctx);
    runner.mockClear();
    const flake = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", flakeCheck: true },
      ctx,
    );
    expect(flake).toContain("All runnable tests passed");
    addEdit(ctx, "e2e-tests/a.spec.ts");
    const afterEdit = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts" },
      ctx,
    );
    expect(afterEdit).toContain("All runnable tests passed");
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("counts a failure and attaches the screenshot", async () => {
    runner.mockResolvedValue(
      failResult("boom", "/app/test-results/a/test-failed-1.png"),
    );
    screenshot.mockResolvedValue("data:image/png;base64,ABC");
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts" },
      ctx,
    );
    expect(out).toContain("Test run FAILED (attempt 1 of 4");
    expect(out).toContain("test-results/a/error-context.md");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(1);
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
    await runTestsTool.execute({ testFile: "e2e-tests/a.spec.ts" }, ctx);
    addEdit(ctx, "e2e-tests/a.spec.ts"); // pass the require-a-change guard
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts" },
      ctx,
    );
    expect(out).toContain("did NOT alter the failure");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(2);
  });

  it("refuses to rerun when no files changed since the last run", async () => {
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    await runTestsTool.execute({ testFile: "e2e-tests/a.spec.ts" }, ctx);
    runner.mockClear();
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts" },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("haven't made any changes");
    // Still only the one counted attempt.
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(1);
  });

  it("allows one free flakeCheck rerun without a change and without counting", async () => {
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    await runTestsTool.execute({ testFile: "e2e-tests/a.spec.ts" }, ctx);
    runner.mockClear();
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", flakeCheck: true },
      ctx,
    );
    expect(runner).toHaveBeenCalledTimes(1);
    expect(out).toContain("Test run FAILED");
    // Free flake run does not increment the counter.
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(1);
  });

  it("refuses a second flakeCheck rerun of a green spec", async () => {
    // Passes reset the attempt counter, so without this guard a model could
    // loop full isolated runs of an already-passing spec forever by re-sending
    // flakeCheck: true.
    runner.mockResolvedValue(passedResult);
    const ctx = makeCtx();
    await runTestsTool.execute({ testFile: "e2e-tests/a.spec.ts" }, ctx);
    await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", flakeCheck: true },
      ctx,
    );
    runner.mockClear();
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", flakeCheck: true },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("already passed");
    expect(out).toContain("already used this spec's one flakeCheck rerun");
  });

  it("refuses a second flakeCheck without changes on a failing spec", async () => {
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    await runTestsTool.execute({ testFile: "e2e-tests/a.spec.ts" }, ctx);
    await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", flakeCheck: true },
      ctx,
    );
    runner.mockClear();
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", flakeCheck: true },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("haven't made any changes");
    expect(out).toContain("already used this spec's one flakeCheck rerun");
    // Only the first (non-flake) failure counted.
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(1);
  });

  it("refuses without running once the attempt cap is reached", async () => {
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    for (let i = 0; i < 4; i++) {
      addEdit(ctx, "e2e-tests/a.spec.ts");
      await runTestsTool.execute({ testFile: "e2e-tests/a.spec.ts" }, ctx);
    }
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(4);
    runner.mockClear();
    addEdit(ctx, "e2e-tests/a.spec.ts");
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts" },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("Attempt limit reached");
  });

  it("refuses without running once the turn-level run cap is reached", async () => {
    const ctx = makeCtx();
    ctx.testRunCount = 10;
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts" },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("Turn-level test run limit reached");
  });

  it("treats a whole-run infra error (no report) as uncounted", async () => {
    runner.mockResolvedValue(infraResult);
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts" },
      ctx,
    );
    expect(out).toContain("infrastructure problem");
    expect(out).toContain("did NOT count");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts ?? 0).toBe(
      0,
    );
  });

  it("pre-flights a guessed path: doesn't run, returns the real spec list", async () => {
    // The agent guessed a spec that doesn't exist. Rather than spin up the
    // isolated test environment and hit Playwright's opaque "No tests found",
    // the tool short-circuits with the specs that DO exist so it can retry —
    // and never frames it as an unfixable infrastructure problem.
    specLister.mockResolvedValue([
      "e2e-tests/auth-entry.spec.ts",
      "e2e-tests/home.spec.ts",
    ]);
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/authentication.spec.ts" },
      ctx,
    );
    // Never started a run.
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("No spec matches");
    expect(out).toContain("e2e-tests/auth-entry.spec.ts");
    expect(out).toContain("e2e-tests/home.spec.ts");
    expect(out).not.toContain("infrastructure problem");
    expect(out).toContain("did NOT count");
    // The specific reason is surfaced to the USER as the warning title.
    expect(emittedXml(ctx)).toContain(
      "No test file matches &quot;e2e-tests/authentication.spec.ts&quot;",
    );
    expect(
      ctx.testRunAttempts.get("e2e-tests/authentication.spec.ts")?.attempts ??
        0,
    ).toBe(0);
  });

  it("never auto-runs a near-miss: suggests the closest match, doesn't execute", async () => {
    // The agent has the right filename but a wrong path (here: no `e2e-tests/`
    // prefix). We do NOT silently run a spec the agent didn't name — we point
    // at the closest match as a suggestion and let it retry with the exact path.
    specLister.mockResolvedValue(["e2e-tests/auth-entry.spec.ts"]);
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "auth-entry.spec.ts" },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("Closest match");
    expect(out).toContain("e2e-tests/auth-entry.spec.ts");
    expect(emittedXml(ctx)).toContain(
      "No test file matches &quot;auth-entry.spec.ts&quot;",
    );
  });

  it("always runs the whole file (never passes a line target)", async () => {
    specLister.mockResolvedValue(["e2e-tests/auth-entry.spec.ts"]);
    runner.mockResolvedValue({
      appId: 1,
      results: [{ file: "e2e-tests/auth-entry.spec.ts", status: "passed" }],
      isolation: { mode: "neon-branch" },
    });
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/auth-entry.spec.ts" },
      ctx,
    );
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0]).toMatchObject({
      testFile: "e2e-tests/auth-entry.spec.ts",
    });
    expect(runner.mock.calls[0][0].testLine).toBeUndefined();
    expect(out).toContain("All runnable tests passed");
  });

  it("narrows the run to a subset via grep (never a line target)", async () => {
    caseLister.mockResolvedValue([
      { title: "does a thing", line: 3 },
      { title: "does another thing", line: 12 },
    ]);
    runner.mockResolvedValue(passedResult);
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", grep: "does another thing" },
      ctx,
    );
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0]).toMatchObject({
      testFile: "e2e-tests/a.spec.ts",
      grep: "does another thing",
    });
    // The agent targets by pattern, never by line.
    expect(runner.mock.calls[0][0].testLine).toBeUndefined();
    // A narrowed pass must not read as a whole-file pass.
    expect(out).toContain("matching /does another thing/ passed");
    expect(out).toContain("Only that subset ran");
  });

  it("allows a grep that matches several tests", async () => {
    // Unlike exact-title targeting, a pattern is meant to match a group — a
    // multi-match run is legitimate, not ambiguous.
    caseLister.mockResolvedValue([
      { title: "user can sign up", line: 3 },
      { title: "user can log in", line: 12 },
      { title: "guest sees a paywall", line: 20 },
    ]);
    runner.mockResolvedValue(passedResult);
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", grep: "user can" },
      ctx,
    );
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0]).toMatchObject({ grep: "user can" });
    expect(out).toContain("matching /user can/ passed");
  });

  it("lets Playwright handle grep patterns that don't match parsed leaf titles", async () => {
    caseLister.mockResolvedValue([
      { title: "does a thing", line: 3 },
      { title: "user can sign up", line: 12 },
    ]);
    runner.mockResolvedValue({ appId: 1, results: [] });
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", grep: "user signs up" },
      ctx,
    );
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({ grep: "user signs up" }),
    );
    expect(out).toContain("executed nothing");
    expect(out).toContain("did NOT count");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts ?? 0).toBe(
      0,
    );
  });

  it("refuses an invalid grep regex without running", async () => {
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", grep: "user can (sign up" },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(out).toContain("isn't a valid regular expression");
    expect(out).toContain("did NOT count");
    expect(emittedXml(ctx)).toContain("Invalid grep pattern");
  });

  it("refuses grep patterns containing percent signs on Windows", async () => {
    const platformSpy = vi
      .spyOn(process, "platform", "get")
      .mockReturnValue("win32");
    try {
      const ctx = makeCtx();
      const out = await runTestsTool.execute(
        { testFile: "e2e-tests/a.spec.ts", grep: "100% complete" },
        ctx,
      );
      expect(runner).not.toHaveBeenCalled();
      expect(out).toContain("cmd.exe expands `%` characters");
      expect(out).toContain("did NOT count");
      expect(emittedXml(ctx)).toContain("Unsupported Windows grep pattern");
    } finally {
      platformSpy.mockRestore();
    }
  });

  it("refuses grep patterns containing newlines on Windows", async () => {
    const platformSpy = vi
      .spyOn(process, "platform", "get")
      .mockReturnValue("win32");
    try {
      const ctx = makeCtx();
      const out = await runTestsTool.execute(
        { testFile: "e2e-tests/a.spec.ts", grep: "first\r\nsecond" },
        ctx,
      );
      expect(runner).not.toHaveBeenCalled();
      expect(out).toContain("cmd.exe treats them as command separators");
      expect(out).toContain("did NOT count");
      expect(emittedXml(ctx)).toContain("Unsupported Windows grep pattern");
    } finally {
      platformSpy.mockRestore();
    }
  });

  it("lets a target change bypass the require-a-change guard", async () => {
    // Whole-file run fails; without any edit, narrowing to a subset with grep is
    // a different run and must not be blocked as a pointless rerun.
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    await runTestsTool.execute({ testFile: "e2e-tests/a.spec.ts" }, ctx);
    runner.mockClear();
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", grep: "does a thing" },
      ctx,
    );
    expect(runner).toHaveBeenCalledTimes(1);
    expect(out).toContain("Test run FAILED");
    // But rerunning the SAME target without an edit is still blocked.
    runner.mockClear();
    const blocked = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", grep: "does a thing" },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(blocked).toContain("haven't made any changes");
  });

  it("explains a grep-narrowed run that executed nothing as skipped (uncounted)", async () => {
    // The pattern matched a test (so it exists) but Playwright ran nothing —
    // the test is test.skip/test.fixme.
    runner.mockResolvedValue({ appId: 1, results: [] });
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", grep: "does a thing" },
      ctx,
    );
    expect(out).toContain("executed nothing");
    expect(out).toContain("test.skip");
    expect(out).toContain("did NOT count");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts ?? 0).toBe(
      0,
    );
  });

  it("explains a spec that ran but has no runnable tests (uncounted, not infra)", async () => {
    // The spec exists (pre-flight resolved it) but Playwright ran nothing —
    // empty file or every test skipped. Actionable, not an infra dead-end.
    specLister.mockResolvedValue(["e2e-tests/a.spec.ts"]);
    runner.mockResolvedValue({ appId: 1, results: [] });
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts" },
      ctx,
    );
    expect(out).toContain("ran but nothing executed");
    expect(out).not.toContain("infrastructure problem");
    expect(out).toContain("did NOT count");
    // Reason surfaced to the user in the warning title.
    expect(emittedXml(ctx)).toContain("has no runnable test");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts ?? 0).toBe(
      0,
    );
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
      { testFile: "e2e-tests/a.spec.ts" },
      ctx,
    );
    expect(out).toContain("Test run FAILED");
    expect(out).not.toContain("infrastructure problem");
    expect(out).toContain("locator/timeout/strict-mode");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(1);
  });

  it("truncates long error output", async () => {
    const longError = "x".repeat(9000);
    runner.mockResolvedValue(failResult(longError));
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts" },
      ctx,
    );
    expect(out).toContain("(truncated)");
    expect(out.length).toBeLessThan(longError.length);
  });

  it("keeps the fix budget after a grep-narrowed pass (no attempt laundering)", async () => {
    // Only a whole-file pass resets the counter. If a narrowed pass did too,
    // alternating a known-green pattern with a failing one would launder
    // unlimited attempts past the per-spec cap.
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    await runTestsTool.execute({ testFile: "e2e-tests/a.spec.ts" }, ctx);
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(1);
    addEdit(ctx, "e2e-tests/a.spec.ts");
    runner.mockResolvedValue(passedResult);
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", grep: "does a thing" },
      ctx,
    );
    expect(out).toContain("matching /does a thing/ passed");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts).toBe(1);
  });

  it("treats an all-skipped spec (errorless inconclusive) as no runnable tests (uncounted)", async () => {
    // `test.skip`/`test.fixme` specs parse as errorless "inconclusive"
    // verdicts; they should ask the agent to un-skip, not burn a fix attempt
    // on locator-failure guidance.
    runner.mockResolvedValue({
      appId: 1,
      results: [
        {
          file: "e2e-tests/a.spec.ts",
          status: "inconclusive",
          tests: [{ title: "does a thing", status: "inconclusive" }],
        },
      ],
      isolation: { mode: "neon-branch" },
    });
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts" },
      ctx,
    );
    expect(out).toContain("skipped");
    expect(out).toContain("did NOT count");
    expect(out).not.toContain("Test run FAILED");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts ?? 0).toBe(
      0,
    );
  });

  it("survives a thrown runner error: uncounted, and the free flakeCheck is restored", async () => {
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    await runTestsTool.execute({ testFile: "e2e-tests/a.spec.ts" }, ctx);
    runner.mockRejectedValue(new Error("db exploded"));
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", flakeCheck: true },
      ctx,
    );
    expect(out).toContain("did NOT count");
    expect(out).toContain("db exploded");
    const state = ctx.testRunAttempts.get("e2e-tests/a.spec.ts")!;
    expect(state.attempts).toBe(1);
    // The throw happened after the free flake rerun was consumed — it must be
    // handed back so the model can still use it once the environment is fixed.
    expect(state.flakeCheckUsed).toBeFalsy();
  });

  it("restores the free flakeCheck after a structured (resolved) infra failure", async () => {
    // Infra failures overwhelmingly arrive as RESOLVED infraError results, not
    // throws. The infra reply promises "call run_tests again" — without the
    // refund that retry would be refused (flake rerun spent, no changes made).
    runner.mockResolvedValue(failResult("boom"));
    const ctx = makeCtx();
    await runTestsTool.execute({ testFile: "e2e-tests/a.spec.ts" }, ctx);
    runner.mockResolvedValue(infraResult);
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", flakeCheck: true },
      ctx,
    );
    expect(out).toContain("infrastructure problem");
    expect(out).toContain("did NOT count");
    const state = ctx.testRunAttempts.get("e2e-tests/a.spec.ts")!;
    expect(state.attempts).toBe(1);
    expect(state.flakeCheckUsed).toBeFalsy();
    // And the promised retry actually runs.
    runner.mockResolvedValue(passedResult);
    await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts", flakeCheck: true },
      ctx,
    );
    expect(runner).toHaveBeenCalledTimes(3);
  });

  it("reports a spec with passing tests plus a skipped test as passing", async () => {
    // A deliberately skipped test (errorless inconclusive) must never read as
    // a failure: the spec would be reported FAILED every run, never record its
    // pass, and drain the whole fix budget on a non-failure.
    runner.mockResolvedValue({
      appId: 1,
      results: [
        {
          file: "e2e-tests/a.spec.ts",
          status: "inconclusive",
          tests: [
            { title: "does a thing", status: "passed" },
            { title: "does another thing", status: "passed" },
            { title: "not ready yet", status: "inconclusive" },
          ],
        },
      ],
      isolation: { mode: "neon-branch" },
    });
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts" },
      ctx,
    );
    expect(out).toContain("All runnable tests passed");
    expect(out).toContain("2 passed, 1 deliberately skipped");
    expect(out).not.toContain("Test run FAILED");
    expect(ctx.testRunAttempts.get("e2e-tests/a.spec.ts")?.attempts ?? 0).toBe(
      0,
    );
    // The pass was recorded: an unchanged rerun is refused.
    runner.mockClear();
    const rerun = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts" },
      ctx,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(rerun).toContain("already passed");
  });

  it("does not list a skipped test as FAILED alongside real failures", async () => {
    runner.mockResolvedValue({
      appId: 1,
      results: [
        {
          file: "e2e-tests/a.spec.ts",
          status: "failed",
          error: "boom",
          tests: [
            { title: "does a thing", status: "passed" },
            { title: "breaks", status: "failed", error: "boom" },
            { title: "not ready yet", status: "inconclusive" },
          ],
        },
      ],
      isolation: { mode: "neon-branch" },
    });
    const ctx = makeCtx();
    const out = await runTestsTool.execute(
      { testFile: "e2e-tests/a.spec.ts" },
      ctx,
    );
    expect(out).toContain("1 passed, 1 failed, 1 deliberately skipped");
    expect(out).toContain('FAILED e2e-tests/a.spec.ts > "breaks"');
    expect(out).not.toContain('FAILED e2e-tests/a.spec.ts > "not ready yet"');
  });
});
