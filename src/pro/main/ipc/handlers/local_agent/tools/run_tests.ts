import path from "node:path";
import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  TestRunAttemptState,
  escapeXmlAttr,
} from "./types";
import {
  runAppTestsWithIsolation,
  getRunningTestBaseUrl,
  normalizeRunTestFile,
  listSpecFiles,
  readSpecTestCases,
} from "@/ipc/handlers/tests_handlers";
import { readTestScreenshotDataUrl } from "@/ipc/utils/test_screenshot";
import type { RunAppTestsResult, TestResult } from "@/ipc/types/tests";
import { normalizeFailureSignature } from "./test_failure_signature";
import {
  MAX_ATTEMPTS,
  MAX_ERROR_CHARS,
  RUN_TIMEOUT_MS,
  Classification,
  classify,
  completeStatus,
  completeWarning,
  findFirstScreenshot,
  firstFailureError,
  isolationLine,
  listFailedTests,
  specKey,
  sumFileEdits,
  truncateError,
} from "./run_tests_utils";

const runTestsSchema = z.object({
  testFile: z
    .string()
    .min(1)
    .describe(
      "Relative path of the single spec to run, e.g. 'tests/checkout.spec.ts'. Required — always target the one spec you're working on (usually the one you just wrote or edited). Use the exact path of a spec that exists under tests/; if it doesn't match, the tool lists the real specs so you can retry.",
    ),
  testName: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Exact title of one test() to run by itself, e.g. 'user can check out'. Omit by default; only pass it to iterate on one slow/failing test. Must match the file's title exactly (read the spec first) — on mismatch the tool lists the real titles.",
    ),
  flakeCheck: z
    .boolean()
    .optional()
    .describe(
      "Set true to rerun WITHOUT having changed any files, to confirm a suspected flaky failure. Allowed once per spec and does not count against the fix-attempt limit.",
    ),
});

type RunTestsArgs = z.infer<typeof runTestsSchema>;

/**
 * Match the requested path against the specs on disk before any expensive
 * work. No exact match → warn with the real spec list; never run a spec the
 * agent didn't name.
 */
async function resolveSpecPath(
  ctx: AgentContext,
  requested: string,
): Promise<{ testFile: string } | { error: string }> {
  const specs = await listSpecFiles(ctx.appPath);
  const normalized = normalizeRunTestFile(requested) ?? requested;
  if (specs.includes(normalized)) {
    return { testFile: normalized };
  }

  const base = normalized.split("/").pop();
  const byBase = base ? specs.filter((s) => s.split("/").pop() === base) : [];
  const specList =
    specs.length > 0
      ? `Specs that exist under tests/:\n${specs.map((s) => `- ${s}`).join("\n")}`
      : "There are no spec files under tests/ yet — write one first, then run it.";
  const didYouMean =
    byBase.length > 0
      ? `\n\nClosest match by filename: ${byBase.map((s) => `\`${s}\``).join(", ")} — if that's what you meant, call run_tests again with that exact path.`
      : "";
  const body = `No spec matches \`${requested}\`, so I did NOT start a run — no test environment was set up and this did NOT count as a fix attempt. This is NOT an infrastructure failure; the path just doesn't point at a spec.\n\n${specList}${didYouMean}\n\nCall run_tests again with an exact path from the list above. If the spec you meant isn't listed, it hasn't been written under tests/ yet.`;
  completeWarning(ctx, `No test file matches "${requested}"`, body);
  return { error: body };
}

/**
 * Resolve a testName to the line of its `test()` call so the run can use
 * Playwright's exact `file:line` selector. No match or an ambiguous match →
 * warn with the titles that exist; never guess which test the agent meant.
 */
async function resolveTestName(
  ctx: AgentContext,
  testFile: string,
  testName: string,
): Promise<{ testLine: number } | { error: string }> {
  const cases = await readSpecTestCases(ctx.appPath, testFile);
  const matches = cases.filter((c) => c.title === testName);
  if (matches.length === 1) {
    return { testLine: matches[0].line };
  }

  if (matches.length > 1) {
    const lines = matches.map((m) => `line ${m.line}`).join(", ");
    const body = `"${testName}" matches ${matches.length} test() calls in \`${testFile}\` (${lines}), so I can't target one by name and did NOT start a run — this did NOT count as a fix attempt.\n\nRename the duplicates so every title in the file is unique, or omit testName to run the whole file.`;
    completeWarning(ctx, `Ambiguous test name in ${testFile}`, body);
    return { error: body };
  }

  const query = testName.toLowerCase();
  const closest = cases.filter(
    (c) =>
      c.title.toLowerCase().includes(query) ||
      query.includes(c.title.toLowerCase()),
  );
  const titleList =
    cases.length > 0
      ? `Tests that exist in \`${testFile}\`:\n${cases.map((c) => `- "${c.title}"`).join("\n")}`
      : `I couldn't find any test() titles in \`${testFile}\` (only string-literal titles can be targeted by name) — read it with read_file to see what it contains.`;
  const didYouMean =
    closest.length > 0
      ? `\n\nClosest match by title: ${closest.map((c) => `"${c.title}"`).join(", ")} — if that's what you meant, call run_tests again with that exact title.`
      : "";
  const body = `No test in \`${testFile}\` is titled "${testName}", so I did NOT start a run — this did NOT count as a fix attempt.\n\n${titleList}${didYouMean}\n\nCall run_tests again with an exact title from the list above, or omit testName to run the whole file.`;
  completeWarning(ctx, `No test matches "${testName}"`, body);
  return { error: body };
}

/** Refuse without running once the per-spec fix-attempt cap is hit. */
function guardAttemptLimit(
  ctx: AgentContext,
  key: string,
  state: TestRunAttemptState,
): string | null {
  if (state.attempts < MAX_ATTEMPTS) return null;
  const body = `Attempt limit reached: you have already made ${MAX_ATTEMPTS} fix attempts for ${key} this turn. Do NOT run tests again or keep editing this spec. Stop now and summarize for the user: what the test covers, what still fails, what you tried, and what you recommend they do next.`;
  completeWarning(ctx, "Test attempt limit reached", body);
  return body;
}

/** Tests need the dev server; being down does not count as an attempt. */
function guardDevServerRunning(ctx: AgentContext): string | null {
  if (getRunningTestBaseUrl(ctx.appId)) return null;
  const body =
    "The app's dev server isn't running, so the tests can't execute. Ask the user to start the app with the Run button in the preview panel, then call run_tests again. This did NOT count as a fix attempt.";
  completeWarning(ctx, "App isn't running", body);
  return body;
}

/** Key for `passedAtEditCount`: the targeted test's title, or "" = whole file. */
const WHOLE_FILE = "";

/**
 * Refuse to rerun a target that already PASSED with no file changes since —
 * the result can't differ. Catches the loop where a model keeps re-running
 * already-green tests (including alternating between two targets, which the
 * last-run guard below can't see). A whole-file pass covers every test in it,
 * so it also blocks targeted reruns; a targeted pass still leaves the
 * whole-file run allowed (the agent may re-verify the rest, but isn't required
 * to).
 */
function guardAlreadyPassed(
  ctx: AgentContext,
  args: RunTestsArgs,
  state: TestRunAttemptState,
  currentEditCount: number,
): string | null {
  // flakeCheck bypasses this guard only while the spec's one free flake rerun
  // is unspent. Once used, a green spec can't be rerun by re-sending the flag —
  // passes reset the attempt counter, so this would otherwise allow unlimited
  // full isolated runs of an already-passing spec.
  const flakeRerunAvailable = args.flakeCheck && !state.flakeCheckUsed;
  if (flakeRerunAvailable || !state.passedAtEditCount) return null;
  const passed = state.passedAtEditCount;
  const wholeFilePassed = passed[WHOLE_FILE] === currentEditCount;
  const targetPassed = passed[args.testName ?? WHOLE_FILE] === currentEditCount;
  if (!wholeFilePassed && !targetPassed) return null;

  const what = wholeFilePassed
    ? `The whole spec already passed`
    : `"${args.testName}" already passed`;
  const flakeNote = state.flakeCheckUsed
    ? "You have already used this spec's one flakeCheck rerun."
    : "(If you suspect the pass is flaky, you may rerun once with flakeCheck: true.)";
  const body = `${what} with the current code — you haven't modified any files since, so rerunning would produce the same result. Do NOT run it again. Stop and summarize the outcome for the user. ${flakeNote} This did NOT count as a fix attempt.`;
  completeWarning(ctx, "Tests already passed — no rerun needed", body);
  return body;
}

/**
 * Require a file change between runs. Skipped on the first run, on the (still
 * unspent) flakeCheck rerun, after infra failures (which leave
 * fileEditCountAtLastRun unset), and when the target changed (a different
 * testName, or one test ↔ whole file) — running different tests can produce a
 * different result without an edit.
 */
function guardChangedSinceLastRun(
  ctx: AgentContext,
  args: RunTestsArgs,
  state: TestRunAttemptState,
  currentEditCount: number,
): string | null {
  if (
    (args.flakeCheck && !state.flakeCheckUsed) ||
    state.attempts === 0 ||
    state.fileEditCountAtLastRun === undefined ||
    currentEditCount !== state.fileEditCountAtLastRun ||
    args.testName !== state.lastRunTestName
  ) {
    return null;
  }
  const flakeHint = state.flakeCheckUsed
    ? "You have already used this spec's one flakeCheck rerun."
    : "Or, if you suspect the failure is flaky, pass flakeCheck: true (allowed once).";
  const body = `You haven't modified any files since the last run of this spec, so rerunning would produce the same result. Make a fix first. ${flakeHint} This did NOT count as a fix attempt.`;
  completeWarning(ctx, "No changes since last run", body);
  return body;
}

/** The first flakeCheck rerun per spec is free (doesn't count as an attempt). */
function consumeFreeFlakeCheck(
  args: RunTestsArgs,
  state: TestRunAttemptState,
): boolean {
  if (!args.flakeCheck || state.flakeCheckUsed) return false;
  state.flakeCheckUsed = true;
  return true;
}

async function runSpec(
  ctx: AgentContext,
  testFile: string,
  target?: { testName: string; testLine: number },
): Promise<RunAppTestsResult> {
  const label = target ? `${testFile} › "${target.testName}"` : testFile;
  ctx.onXmlStream(
    `<dyad-status title="${escapeXmlAttr(`Running ${label}`)}"></dyad-status>`,
  );
  return runAppTestsWithIsolation({
    event: ctx.event,
    appId: ctx.appId,
    testFile,
    testLine: target?.testLine,
    source: "agent",
    externalSignal: ctx.abortSignal,
    timeoutMs: RUN_TIMEOUT_MS,
  });
}

/** Spec exists but nothing executed — empty file or every test() skipped. */
function reportNoRunnableTests(
  ctx: AgentContext,
  testFile: string,
  testName?: string,
): string {
  if (testName) {
    const body = `Targeting "${testName}" in \`${testFile}\` executed nothing — the test is skipped (\`test.skip\`/\`test.fixme\`). This did NOT count as a fix attempt and is NOT an infrastructure failure. Un-skip it, then run again.`;
    completeWarning(ctx, `"${testName}" didn't run`, body);
    return body;
  }
  const body = `\`${testFile}\` ran but nothing executed — the file is empty or every \`test()\` is skipped (\`test.skip\`/\`test.fixme\`). This did NOT count as a fix attempt and is NOT an infrastructure failure. Un-skip it (or add a real \`test()\`), then run again.`;
  completeWarning(ctx, `${testFile} has no runnable test`, body);
  return body;
}

/** Uncounted; fileEditCountAtLastRun stays as-is so the next run isn't blocked. */
function reportInfraFailure(
  ctx: AgentContext,
  outcome: Classification,
): string {
  const body = `Test run could not complete — this is an infrastructure problem, NOT a test failure, and did NOT count as a fix attempt.\n\n${outcome.message ?? "Unknown error."}\n\nFix the environment (or ask the user), then call run_tests again.`;
  completeWarning(ctx, "Test run couldn't complete", body);
  return body;
}

function reportPassed(params: {
  ctx: AgentContext;
  testFile: string;
  state: TestRunAttemptState;
  outcome: Classification;
  res: RunAppTestsResult;
  currentEditCount: number;
  testName?: string;
}): string {
  const { ctx, testFile, state, outcome, res, currentEditCount, testName } =
    params;
  // Only a WHOLE-FILE pass grants a fresh fix budget — everything in the spec
  // is green, so prior attempts are moot. A targeted pass proves only that one
  // test and must NOT reset the counter: otherwise alternating a known-green
  // target with a failing one would launder unlimited attempts past the cap.
  // Either way the state is kept so an unchanged rerun of what just passed can
  // be refused instead of looping.
  if (!testName) {
    state.attempts = 0;
    delete state.lastFailureSignature;
  }
  delete state.fileEditCountAtLastRun;
  delete state.lastRunTestName;
  state.passedAtEditCount = {
    ...state.passedAtEditCount,
    [testName ?? WHOLE_FILE]: currentEditCount,
  };
  const summary = testName
    ? `Targeted test "${testName}" passed — do NOT run it again unless you change files. Only that test ran (not the rest of ${testFile}).`
    : `All tests passed (${outcome.passed} passed). This spec is verified — do NOT run it again unless you change files.`;
  const body = `${summary} ${isolationLine(res)}`;
  const title = testName
    ? `Test passed: ${testFile} › "${testName}"`
    : `Tests passed: ${testFile}`;
  completeStatus(ctx, title, body);
  return body;
}

/**
 * Attach the failure screenshot as an image (tool results are text-only, so it
 * goes as a follow-up user message) and return the artifact-paths section.
 */
function attachFailureArtifacts(
  ctx: AgentContext,
  results: TestResult[],
): string {
  const shot = findFirstScreenshot(results);
  if (!shot) return "";

  const rel = path.isAbsolute(shot.screenshotPath)
    ? path.relative(ctx.appPath, shot.screenshotPath)
    : shot.screenshotPath;
  const errorContext = path.join(path.dirname(rel), "error-context.md");
  const dataUrl = readTestScreenshotDataUrl(ctx.appPath, shot.screenshotPath);
  if (dataUrl) {
    ctx.appendUserMessage([
      {
        type: "text",
        text: `Failure screenshot for ${shot.file} — the UI state at the moment the test failed:`,
      },
      { type: "image-url", url: dataUrl },
    ]);
  }
  // Only promise the image when it was actually attached — the read can fail
  // (missing/oversized/escaping file), and the model would otherwise burn a
  // turn looking for an attachment that never arrives.
  const screenshotLine = dataUrl
    ? `\n- Screenshot: ${rel} (attached to the next message as an image)`
    : `\n- Screenshot: ${rel} (could NOT be attached as an image — rely on the page snapshot instead)`;
  return `\nArtifacts from THIS run (other test-results directories are stale — do not read them):\n- Page snapshot: ${errorContext}  ← read this first with read_file; it shows what was actually on the page${screenshotLine}`;
}

function reportFailure(params: {
  ctx: AgentContext;
  key: string;
  testFile: string;
  testName?: string;
  state: TestRunAttemptState;
  res: RunAppTestsResult;
  outcome: Classification;
  isFreeFlakeRun: boolean;
  currentEditCount: number;
}): string {
  const { ctx, key, testFile, testName, state, res, outcome, isFreeFlakeRun } =
    params;

  const signature = normalizeFailureSignature(res.results);
  const unchanged =
    state.lastFailureSignature !== undefined &&
    signature === state.lastFailureSignature;
  if (!isFreeFlakeRun) {
    state.attempts += 1;
  }
  state.lastFailureSignature = signature;
  state.fileEditCountAtLastRun = params.currentEditCount;
  state.lastRunTestName = testName;
  const remaining = Math.max(0, MAX_ATTEMPTS - state.attempts);

  const artifactLines = attachFailureArtifacts(ctx, res.results);
  const firstError = firstFailureError(res.results);

  const noProgressNote = unchanged
    ? "\nNOTE: your last change did NOT alter the failure — the same tests are failing with the same error. Re-read the test and the app code and try a DIFFERENT approach instead of a small variation.\n"
    : "";

  const inconclusiveHint = outcome.allInconclusive
    ? "\nThese are locator/timeout/strict-mode errors (e.g. a selector that matched nothing, matched a hidden element, or matched more than one element). That is almost always a LOCATOR bug in the test — make the selector more precise (exact text/role, filter to the visible element, scope to a container). Only if error-context.md shows the page never rendered is it the app or environment.\n"
    : "";

  const nextStep =
    remaining > 0
      ? `Next: read error-context.md, decide whether the TEST or the APP is wrong, make one targeted fix, then call run_tests again. ${remaining} attempt(s) remain for this spec this turn.`
      : `You have now used all ${MAX_ATTEMPTS} attempts for this spec. Stop and summarize the situation for the user.`;

  const body = [
    `Test run FAILED (attempt ${state.attempts} of ${MAX_ATTEMPTS} for ${key}). ${outcome.passed} passed, ${outcome.failed} failed.`,
    noProgressNote,
    inconclusiveHint,
    listFailedTests(res.results).join("\n"),
    firstError
      ? `\nError (truncated to last ${MAX_ERROR_CHARS} chars):\n\`\`\`\n${truncateError(firstError)}\n\`\`\``
      : "",
    artifactLines,
    `\n${isolationLine(res)}`,
    `\n${nextStep}`,
  ]
    .filter(Boolean)
    .join("\n");

  completeStatus(
    ctx,
    `Tests failed: ${testName ? `${testFile} › "${testName}"` : testFile}`,
    body,
  );
  return body;
}

export const runTestsTool: ToolDefinition<RunTestsArgs> = {
  name: "run_tests",
  description: `Run the app's Playwright end-to-end tests and get the results back, so you can verify a test you just wrote or edited and iterate until it passes.

- Pass \`testFile\` (e.g. "tests/checkout.spec.ts") to run one spec — it's required, so always target the single spec you're working on. Use the exact path of a spec that exists under tests/ (the one you just wrote/edited) — don't guess. If the path doesn't match a real spec, the tool won't run anything and will reply with the list of specs that DO exist, so you can retry with a correct path.
- Unless you just wrote or edited the spec this turn, READ it with read_file before running it — you need its current content to know the exact test() titles (for testName) and to interpret failures against what the test actually does.
- By default the whole file runs, so a pass means every test in the spec passes.
- Run the whole file by default. Only add \`testName\` (the exact \`test()\` title) when you have a specific reason to narrow the run — e.g. one test keeps failing while the spec's other tests already passed and rerunning them all is slow. A targeted pass only verifies that one test, not the rest of the file. If the title doesn't match, the tool runs nothing and replies with the titles that DO exist.
- Requires the app's dev server to be running (the user starts it with the Run button in the preview panel).
- On failure you get the error text plus the paths of Playwright's artifacts (error-context.md page snapshot, screenshot) — read error-context.md with read_file to see the page state, then fix and rerun.
- You get ${MAX_ATTEMPTS} fix attempts per spec per turn. When the limit is reached, stop and summarize the situation for the user.
- If you suspect a failure is flaky, rerun once with \`flakeCheck: true\` (does not count against the limit).
- Never rerun something that already passed: once a target (or the whole file) is green and you haven't changed any files, the tool refuses the run — move on instead.`,
  inputSchema: runTestsSchema,
  defaultConsent: "always",
  // Isolation swaps the app's env file and restarts the dev server, so this
  // must be excluded from read-only / plan modes.
  modifiesState: true,
  isEnabled: (ctx) => ctx.testingEnabled,

  getConsentPreview: (args) =>
    args.testName
      ? `Run test: ${args.testFile} › "${args.testName}"`
      : `Run test: ${args.testFile}`,

  execute: async (args, ctx: AgentContext) => {
    const resolved = await resolveSpecPath(ctx, args.testFile);
    if ("error" in resolved) return resolved.error;
    const { testFile } = resolved;

    const key = specKey(testFile);
    const state: TestRunAttemptState = ctx.testRunAttempts.get(key) ?? {
      attempts: 0,
    };
    ctx.testRunAttempts.set(key, state);

    const currentEditCount = sumFileEdits(ctx.fileEditTracker);
    const blocked =
      guardAttemptLimit(ctx, key, state) ??
      guardDevServerRunning(ctx) ??
      guardAlreadyPassed(ctx, args, state, currentEditCount) ??
      guardChangedSinceLastRun(ctx, args, state, currentEditCount);
    if (blocked) return blocked;

    let target: { testName: string; testLine: number } | undefined;
    if (args.testName) {
      const resolvedTest = await resolveTestName(ctx, testFile, args.testName);
      if ("error" in resolvedTest) return resolvedTest.error;
      target = { testName: args.testName, testLine: resolvedTest.testLine };
    }

    const isFreeFlakeRun = consumeFreeFlakeCheck(args, state);

    let res: RunAppTestsResult;
    try {
      res = await runSpec(ctx, testFile, target);
    } catch (error) {
      // An unexpected throw (isolation setup, database access, teardown) must
      // not crash the whole agent turn or leave the loop state inconsistent:
      // give back the free flake rerun if this run consumed it, and surface
      // the same uncounted infrastructure outcome as a structured infra error.
      if (isFreeFlakeRun) {
        state.flakeCheckUsed = false;
      }
      const message = error instanceof Error ? error.message : String(error);
      const body = `Test run could not complete — an unexpected error occurred in the test infrastructure, NOT a test failure, and this did NOT count as a fix attempt.\n\n${message}\n\nFix the environment (or ask the user), then call run_tests again.`;
      completeWarning(ctx, "Test run couldn't complete", body);
      return body;
    }
    const outcome = classify(res);

    switch (outcome.kind) {
      case "no-tests":
        return reportNoRunnableTests(ctx, testFile, target?.testName);
      case "infra":
        return reportInfraFailure(ctx, outcome);
      case "passed":
        return reportPassed({
          ctx,
          testFile,
          state,
          outcome,
          res,
          currentEditCount,
          testName: target?.testName,
        });
      case "failed":
        return reportFailure({
          ctx,
          key,
          testFile,
          testName: target?.testName,
          state,
          res,
          outcome,
          isFreeFlakeRun,
          currentEditCount,
        });
    }
  },
};
