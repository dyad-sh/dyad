import path from "node:path";
import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  FileEditTracker,
  TestRunAttemptState,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import {
  runAppTestsWithIsolation,
  getRunningTestBaseUrl,
  normalizeRunTestFile,
} from "@/ipc/handlers/tests_handlers";
import { readTestScreenshotDataUrl } from "@/ipc/utils/test_screenshot";
import { PLAYWRIGHT_REPORT_ERROR_FILE } from "@/ipc/utils/playwright_report";
import type { RunAppTestsResult, TestResult } from "@/ipc/types/tests";
import { normalizeFailureSignature } from "./test_failure_signature";

/** Fix attempts allowed per spec per turn before the tool refuses to rerun. */
const MAX_ATTEMPTS = 4;
/** Hard wall-clock cap so one run can't stall the whole agent turn. */
const RUN_TIMEOUT_MS = 10 * 60_000;
/** Cap on the error text echoed back to the model (matches askAiToFix). */
const MAX_ERROR_CHARS = 4000;

const runTestsSchema = z.object({
  testFile: z
    .string()
    .optional()
    .describe(
      "Relative path of the spec to run, e.g. 'tests/checkout.spec.ts'. Omit to run the whole tests/ suite. During a fix loop, always target the single spec you're working on.",
    ),
  testLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "With testFile: run only the test whose test() call is at this 1-based line.",
    ),
  flakeCheck: z
    .boolean()
    .optional()
    .describe(
      "Set true to rerun WITHOUT having changed any files, to confirm a suspected flaky failure. Allowed once per spec and does not count against the fix-attempt limit.",
    ),
});

type RunTestsArgs = z.infer<typeof runTestsSchema>;

function suiteKey(testFile: string | undefined): string {
  if (!testFile) return "__suite__";
  return normalizeRunTestFile(testFile) ?? testFile;
}

/** Total file edits so far this turn — the require-a-change guard's signal. */
function sumFileEdits(tracker: FileEditTracker): number {
  let total = 0;
  for (const counts of Object.values(tracker)) {
    total += (counts.write_file ?? 0) + (counts.search_replace ?? 0);
  }
  return total;
}

interface Classification {
  kind: "passed" | "failed" | "infra";
  passed: number;
  failed: number;
  /**
   * True when every non-passing test was an "inconclusive" result — a
   * selector/timeout/strict-mode/navigation error rather than a plain
   * assertion. These are still real failures the agent should fix (usually a
   * locator or timing bug in the test), but the hint nudges it to also consider
   * that the page may not have loaded.
   */
  allInconclusive: boolean;
  message?: string;
}

/**
 * A test that RAN and didn't pass — both "failed" (assertion) and
 * "inconclusive" (selector/timeout/strict-mode, which Playwright's error
 * heuristic flags as infra-ish) count. Only a whole-run failure that produced
 * NO report — surfaced separately as `infraError` — is a true environment
 * problem; anything with a per-test verdict is a fixable test result.
 */
function isFailingStatus(status: string): boolean {
  return status === "failed" || status === "inconclusive";
}

function classify(res: RunAppTestsResult): Classification {
  const runnerError = res.results.find(
    (r) => r.file === PLAYWRIGHT_REPORT_ERROR_FILE,
  );
  if (res.infraError || runnerError) {
    return {
      kind: "infra",
      passed: 0,
      failed: 0,
      allInconclusive: false,
      message: res.infraError?.message ?? runnerError?.error,
    };
  }
  if (res.results.length === 0) {
    return {
      kind: "infra",
      passed: 0,
      failed: 0,
      allInconclusive: false,
      message:
        "No tests were found for that target — the file may be empty, or the path/line may not point at a test.",
    };
  }
  const passed = res.results.filter((r) => r.status === "passed").length;
  const assertionFailures = res.results.filter(
    (r) => r.status === "failed",
  ).length;
  const inconclusive = res.results.filter(
    (r) => r.status === "inconclusive",
  ).length;
  const failed = assertionFailures + inconclusive;
  if (failed > 0) {
    return {
      kind: "failed",
      passed,
      failed,
      allInconclusive: assertionFailures === 0,
    };
  }
  return { kind: "passed", passed, failed: 0, allInconclusive: false };
}

/** First failure screenshot in the report, with its owning spec file. */
function findFirstScreenshot(
  results: TestResult[],
): { file: string; screenshotPath: string } | null {
  for (const r of results) {
    if (r.screenshotPath) {
      return { file: r.file, screenshotPath: r.screenshotPath };
    }
    for (const t of r.tests ?? []) {
      if (t.screenshotPath) {
        return { file: r.file, screenshotPath: t.screenshotPath };
      }
    }
  }
  return null;
}

function truncateError(error: string): string {
  const trimmed = error.trim();
  return trimmed.length > MAX_ERROR_CHARS
    ? `…(truncated)\n${trimmed.slice(-MAX_ERROR_CHARS)}`
    : trimmed;
}

function isolationLine(res: RunAppTestsResult): string {
  const mode = res.isolation?.mode ?? "none";
  if (mode === "none") {
    return "Database isolation: none (tests ran against the app's current database).";
  }
  return `Database isolation: ${mode} (your real data was not touched).`;
}

function completeWarning(ctx: AgentContext, title: string, body: string): void {
  ctx.onXmlComplete(
    `<dyad-output type="warning" message="${escapeXmlAttr(title)}">\n${escapeXmlContent(body)}\n</dyad-output>`,
  );
}

function completeStatus(ctx: AgentContext, title: string, body: string): void {
  ctx.onXmlComplete(
    `<dyad-status title="${escapeXmlAttr(title)}">\n${escapeXmlContent(body)}\n</dyad-status>`,
  );
}

export const runTestsTool: ToolDefinition<RunTestsArgs> = {
  name: "run_tests",
  description: `Run the app's Playwright end-to-end tests and get the results back, so you can verify a test you just wrote or edited and iterate until it passes.

- Pass \`testFile\` (e.g. "tests/checkout.spec.ts") to run one spec; omit it to run the whole tests/ suite.
- Requires the app's dev server to be running (the user starts it with the Run button in the preview panel).
- On failure you get the error text plus the paths of Playwright's artifacts (error-context.md page snapshot, screenshot) — read error-context.md with read_file to see the page state, then fix and rerun.
- You get ${MAX_ATTEMPTS} fix attempts per spec per turn. When the limit is reached, stop and summarize the situation for the user.
- If you suspect a failure is flaky, rerun once with \`flakeCheck: true\` (does not count against the limit).`,
  inputSchema: runTestsSchema,
  defaultConsent: "always",
  // Isolation swaps the app's env file and restarts the dev server, so this
  // must be excluded from read-only / plan modes.
  modifiesState: true,
  isEnabled: (ctx) => ctx.testingEnabled,

  getConsentPreview: (args) =>
    args.testFile
      ? `Run test: ${args.testFile}${args.testLine ? `:${args.testLine}` : ""}`
      : "Run all tests",

  execute: async (args, ctx: AgentContext) => {
    const key = suiteKey(args.testFile);
    const label = args.testFile
      ? `${args.testFile}${args.testLine ? `:${args.testLine}` : ""}`
      : "all tests";
    const state: TestRunAttemptState = ctx.testRunAttempts.get(key) ?? {
      attempts: 0,
    };
    ctx.testRunAttempts.set(key, state);

    // 1. Attempt cap — refuse without running.
    if (state.attempts >= MAX_ATTEMPTS) {
      const body = `Attempt limit reached: you have already made ${MAX_ATTEMPTS} fix attempts for ${key} this turn. Do NOT run tests again or keep editing this spec. Stop now and summarize for the user: what the test covers, what still fails, what you tried, and what you recommend they do next.`;
      completeWarning(ctx, "Test attempt limit reached", body);
      return body;
    }

    // 2. Dev server must be running (does not count as an attempt).
    if (!getRunningTestBaseUrl(ctx.appId)) {
      const body =
        "The app's dev server isn't running, so the tests can't execute. Ask the user to start the app with the Run button in the preview panel, then call run_tests again. This did NOT count as a fix attempt.";
      completeWarning(ctx, "App isn't running", body);
      return body;
    }

    // 3. Require a change between runs (skipped on the first run for this spec,
    //    on flakeCheck, and after infra failures where fileEditCountAtLastRun
    //    is left unset).
    const currentEditCount = sumFileEdits(ctx.fileEditTracker);
    if (
      !args.flakeCheck &&
      state.attempts > 0 &&
      state.fileEditCountAtLastRun !== undefined &&
      currentEditCount === state.fileEditCountAtLastRun
    ) {
      const body =
        "You haven't modified any files since the last run of this spec, so rerunning would produce the same result. Make a fix first — or, if you suspect the failure is flaky, pass flakeCheck: true (allowed once). This did NOT count as a fix attempt.";
      completeWarning(ctx, "No changes since last run", body);
      return body;
    }

    // 4. Flake-check accounting: the first flakeCheck rerun per spec is free.
    const isFreeFlakeRun = Boolean(args.flakeCheck) && !state.flakeCheckUsed;
    if (args.flakeCheck && !state.flakeCheckUsed) {
      state.flakeCheckUsed = true;
    }

    // 5. Run.
    const title = `Running ${label}`;
    ctx.onXmlStream(
      `<dyad-status title="${escapeXmlAttr(title)}"></dyad-status>`,
    );
    const res = await runAppTestsWithIsolation({
      event: ctx.event,
      appId: ctx.appId,
      testFile: args.testFile,
      testLine: args.testLine,
      source: "agent",
      externalSignal: ctx.abortSignal,
      timeoutMs: RUN_TIMEOUT_MS,
    });

    const c = classify(res);

    // 6a. Infrastructure problem — uncounted; leave fileEditCountAtLastRun as-is
    // so the next real run isn't blocked by the require-a-change guard.
    if (c.kind === "infra") {
      const body = `Test run could not complete — this is an infrastructure problem, NOT a test failure, and did NOT count as a fix attempt.\n\n${c.message ?? "Unknown error."}\n\nFix the environment (or ask the user), then call run_tests again.`;
      completeWarning(ctx, "Test run couldn't complete", body);
      return body;
    }

    // 6b. Success — clear this spec's attempt state.
    if (c.kind === "passed") {
      ctx.testRunAttempts.delete(key);
      const body = `All tests passed (${c.passed} passed). ${isolationLine(res)}`;
      completeStatus(ctx, `Tests passed: ${label}`, body);
      return body;
    }

    // 6c. Failure.
    const signature = normalizeFailureSignature(res.results);
    const unchanged =
      state.lastFailureSignature !== undefined &&
      signature === state.lastFailureSignature;
    if (!isFreeFlakeRun) {
      state.attempts += 1;
    }
    state.lastFailureSignature = signature;
    state.fileEditCountAtLastRun = currentEditCount;

    const remaining = Math.max(0, MAX_ATTEMPTS - state.attempts);

    // Attach the failure screenshot as an image (tool results are text-only, so
    // this goes as a follow-up user message).
    const shot = findFirstScreenshot(res.results);
    let artifactLines = "";
    if (shot) {
      const rel = path.isAbsolute(shot.screenshotPath)
        ? path.relative(ctx.appPath, shot.screenshotPath)
        : shot.screenshotPath;
      const dir = path.dirname(rel);
      const errorContext = path.join(dir, "error-context.md");
      artifactLines = `\nArtifacts from THIS run (other test-results directories are stale — do not read them):\n- Page snapshot: ${errorContext}  ← read this first with read_file; it shows what was actually on the page\n- Screenshot: ${rel} (attached to the next message as an image)`;
      const dataUrl = readTestScreenshotDataUrl(
        ctx.appPath,
        shot.screenshotPath,
      );
      if (dataUrl) {
        ctx.appendUserMessage([
          {
            type: "text",
            text: `Failure screenshot for ${shot.file} — the UI state at the moment the test failed:`,
          },
          { type: "image-url", url: dataUrl },
        ]);
      }
    }

    // List the failing tests.
    const failedList: string[] = [];
    for (const r of res.results) {
      if (!isFailingStatus(r.status)) continue;
      const failingTests = (r.tests ?? []).filter((t) =>
        isFailingStatus(t.status),
      );
      if (failingTests.length > 0) {
        for (const t of failingTests) {
          failedList.push(`FAILED ${r.file} > "${t.title}"`);
        }
      } else {
        failedList.push(`FAILED ${r.file}`);
      }
    }

    const firstError =
      res.results.find((r) => isFailingStatus(r.status) && r.error)?.error ??
      res.results
        .flatMap((r) => r.tests ?? [])
        .find((t) => isFailingStatus(t.status) && t.error)?.error ??
      "";

    const noProgressNote = unchanged
      ? "\nNOTE: your last change did NOT alter the failure — the same tests are failing with the same error. Re-read the test and the app code and try a DIFFERENT approach instead of a small variation.\n"
      : "";

    // When every failure is a selector/timeout/strict-mode error (rather than a
    // plain assertion), point the agent at the usual cause without pre-judging.
    const inconclusiveHint = c.allInconclusive
      ? "\nThese are locator/timeout/strict-mode errors (e.g. a selector that matched nothing, matched a hidden element, or matched more than one element). That is almost always a LOCATOR bug in the test — make the selector more precise (exact text/role, filter to the visible element, scope to a container). Only if error-context.md shows the page never rendered is it the app or environment.\n"
      : "";

    const nextStep =
      remaining > 0
        ? `Next: read error-context.md, decide whether the TEST or the APP is wrong, make one targeted fix, then call run_tests again. ${remaining} attempt(s) remain for this spec this turn.`
        : `You have now used all ${MAX_ATTEMPTS} attempts for this spec. Stop and summarize the situation for the user.`;

    const body = [
      `Test run FAILED (attempt ${state.attempts} of ${MAX_ATTEMPTS} for ${key}). ${c.passed} passed, ${c.failed} failed.`,
      noProgressNote,
      inconclusiveHint,
      failedList.join("\n"),
      firstError
        ? `\nError (truncated to last ${MAX_ERROR_CHARS} chars):\n\`\`\`\n${truncateError(firstError)}\n\`\`\``
        : "",
      artifactLines,
      `\n${isolationLine(res)}`,
      `\n${nextStep}`,
    ]
      .filter(Boolean)
      .join("\n");

    completeStatus(ctx, `Tests failed: ${label}`, body);
    return body;
  },
};
