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
import { readSettings } from "@/main/settings";
import {
  TEST_SPEC_DIR,
  type RunAppTestsResult,
  type TestResult,
} from "@/ipc/types/tests";
import { normalizeFailureSignature } from "./test_failure_signature";
import {
  MAX_ATTEMPTS,
  MAX_RUNS_PER_TURN,
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
  truncateError,
} from "./run_tests_utils";

const runTestsSchema = z.object({
  testFile: z
    .string()
    .min(1)
    .describe(
      "Relative path of the single spec to run, e.g. 'e2e-tests/checkout.spec.ts'. Required — always target the one spec you're working on (usually the one you just wrote or edited). Use the exact path of a spec that exists under e2e-tests/; if it doesn't match, the tool lists the real specs so you can retry.",
    ),
  grep: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Regex passed to Playwright's --grep to run just a subset, e.g. 'check out' or 'user can (sign up|log in)'. Playwright matches against the full hierarchical title (describe blocks plus test title). Omit by default to run the whole file; only pass it to iterate on one slow/failing test or a few related ones.",
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
      ? `Specs that exist under ${TEST_SPEC_DIR}/:\n${specs.map((s) => `- ${s}`).join("\n")}`
      : `There are no spec files under ${TEST_SPEC_DIR}/ yet — write one first, then run it.`;
  const didYouMean =
    byBase.length > 0
      ? `\n\nClosest match by filename: ${byBase.map((s) => `\`${s}\``).join(", ")} — if that's what you meant, call run_tests again with that exact path.`
      : "";
  const body = `No spec matches \`${requested}\`, so I did NOT start a run — no test environment was set up and this did NOT count as a fix attempt. This is NOT an infrastructure failure; the path just doesn't point at a spec.\n\n${specList}${didYouMean}\n\nCall run_tests again with an exact path from the list above. If the spec you meant isn't listed, it hasn't been written under ${TEST_SPEC_DIR}/ yet.`;
  completeWarning(ctx, `No test file matches "${requested}"`, body);
  return { error: body };
}

function caseTargetKey(
  testFile: string,
  test: { title: string; line?: number },
) {
  return test.line != null
    ? `${testFile}:${test.line}`
    : `${testFile}::${test.title}`;
}

function targetKeyFromKnownCases(
  testFile: string,
  grep: string,
  cases: { title: string; line?: number }[],
): string | null {
  let regex: RegExp;
  try {
    regex = new RegExp(grep);
  } catch {
    return null;
  }
  const matchingKeys = cases
    .filter((c) => regex.test(c.title))
    .map((c) => caseTargetKey(testFile, c))
    .sort();
  return matchingKeys.length > 0 ? matchingKeys.join("\n") : null;
}

function targetKeyFromRunResult(
  testFile: string,
  res: RunAppTestsResult,
): string | null {
  const matchingKeys = res.results
    .flatMap((r) => r.tests ?? [])
    .map((t) => caseTargetKey(testFile, t))
    .sort();
  return matchingKeys.length > 0 ? matchingKeys.join("\n") : null;
}

/**
 * Validate the `grep` regex. We deliberately do NOT reject zero static matches:
 * Playwright applies --grep to the full hierarchical title (describe blocks
 * plus test title), while our lightweight parser only knows leaf test() names.
 */
async function validateGrep(
  ctx: AgentContext,
  testFile: string,
  grep: string,
): Promise<{ ok: true; targetKey: string | null } | { error: string }> {
  if (process.platform === "win32" && grep.includes("%")) {
    const body = `\`${grep}\` can't be used as a grep pattern on Windows because cmd.exe expands \`%\` characters. I did NOT start a run, and this did NOT count as a fix attempt.\n\nUse a pattern without \`%\`, or omit \`grep\` to run the whole file.`;
    completeWarning(ctx, "Unsupported Windows grep pattern", body);
    return { error: body };
  }
  if (process.platform === "win32" && /[\r\n]/.test(grep)) {
    const body = `Newline characters can't be used in a grep pattern on Windows because cmd.exe treats them as command separators. I did NOT start a run, and this did NOT count as a fix attempt.\n\nUse a single-line pattern, or omit \`grep\` to run the whole file.`;
    completeWarning(ctx, "Unsupported Windows grep pattern", body);
    return { error: body };
  }

  let _regex: RegExp;
  try {
    _regex = new RegExp(grep);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const body = `\`${grep}\` isn't a valid regular expression (${message}), so I did NOT start a run — this did NOT count as a fix attempt.\n\nPass a valid regex for \`grep\` (it's matched against test titles, like Playwright's --grep), or omit it to run the whole file.`;
    completeWarning(ctx, "Invalid grep pattern", body);
    return { error: body };
  }

  const cases = await readSpecTestCases(ctx.appPath, testFile);
  return {
    ok: true,
    targetKey: targetKeyFromKnownCases(testFile, grep, cases),
  };
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

/** Refuse before starting more actual Playwright runs than one turn should own. */
function guardTurnRunLimit(ctx: AgentContext): string | null {
  if ((ctx.testRunCount ?? 0) < MAX_RUNS_PER_TURN) return null;
  const body = `Turn-level test run limit reached: you have already started ${MAX_RUNS_PER_TURN} Playwright runs this turn. Stop now and summarize what passed, what still fails, and what you recommend next.`;
  completeWarning(ctx, "Test run limit reached", body);
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

/** Key for `passedAtEditCount`: canonical selected tests, or "" = whole file. */
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
  runTargetKey: string,
): string | null {
  // flakeCheck bypasses this guard only while the spec's one free flake rerun
  // is unspent. Once used, a green spec can't be rerun by re-sending the flag —
  // passes reset the attempt counter, so this would otherwise allow unlimited
  // full isolated runs of an already-passing spec.
  const flakeRerunAvailable = args.flakeCheck && !state.flakeCheckUsed;
  if (flakeRerunAvailable || !state.passedAtEditCount) return null;
  const passed = state.passedAtEditCount;
  const wholeFilePassed = passed[WHOLE_FILE] === currentEditCount;
  const targetPassed = passed[runTargetKey] === currentEditCount;
  if (!wholeFilePassed && !targetPassed) return null;

  const what = wholeFilePassed
    ? `The whole spec already passed`
    : `/${args.grep}/ already passed`;
  const flakeNote = state.flakeCheckUsed
    ? "You have already used this spec's one flakeCheck rerun."
    : "(If you suspect the pass is flaky, you may rerun once with flakeCheck: true.)";
  const body = `${what} with the current code — you haven't made any changes (file edits, dependencies, SQL, …) since, so rerunning would produce the same result. Do NOT run it again. Stop and summarize the outcome for the user. ${flakeNote} This did NOT count as a fix attempt.`;
  completeWarning(ctx, "Tests already passed — no rerun needed", body);
  return body;
}

/**
 * Require a change (any app-mutating tool call) between runs. Skipped on the first run, on the (still
 * unspent) flakeCheck rerun, after infra failures (which leave
 * fileEditCountAtLastRun unset), and when the target changed (a different
 * grep pattern, or a subset ↔ whole file) — running different tests can produce
 * a different result without an edit.
 */
function guardChangedSinceLastRun(
  ctx: AgentContext,
  args: RunTestsArgs,
  state: TestRunAttemptState,
  currentEditCount: number,
  runTargetKey: string,
): string | null {
  if (
    (args.flakeCheck && !state.flakeCheckUsed) ||
    state.attempts === 0 ||
    state.fileEditCountAtLastRun === undefined ||
    currentEditCount !== state.fileEditCountAtLastRun ||
    runTargetKey !== state.lastRunTargetKey
  ) {
    return null;
  }
  const flakeHint = state.flakeCheckUsed
    ? "You have already used this spec's one flakeCheck rerun."
    : "Or, if you suspect the failure is flaky, pass flakeCheck: true (allowed once).";
  const body = `You haven't made any changes (file edits, dependencies, SQL, …) since the last run of this spec, so rerunning would produce the same result. Make a fix first. ${flakeHint} This did NOT count as a fix attempt.`;
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
  grep?: string,
): Promise<RunAppTestsResult> {
  const label = grep ? `${testFile} › /${grep}/` : testFile;
  ctx.onXmlStream(
    `<dyad-status title="${escapeXmlAttr(`Running ${label}`)}"></dyad-status>`,
  );
  // Honor the headed/parallel modes the user picked in the Tests panel (both
  // persisted in user settings, default headless + serial). A narrowed (grep)
  // run usually targets one/few tests, so only opt into parallel for whole-file
  // runs — mirrors the panel's `parallel && !isSingleTest` guard.
  const settings = readSettings();
  return runAppTestsWithIsolation({
    event: ctx.event,
    appId: ctx.appId,
    testFile,
    grep,
    source: "agent",
    headed: settings.testHeaded ?? false,
    parallel: (settings.testParallel ?? false) && !grep,
    externalSignal: ctx.abortSignal,
    timeoutMs: RUN_TIMEOUT_MS,
  });
}

/** Spec exists but nothing executed — empty file or every test() skipped. */
function reportNoRunnableTests(
  ctx: AgentContext,
  testFile: string,
  grep?: string,
): string {
  if (grep) {
    const body = `The tests matching \`${grep}\` in \`${testFile}\` executed nothing — they're skipped (\`test.skip\`/\`test.fixme\`), or the pattern only matched a \`describe\` block with no runnable test. This did NOT count as a fix attempt and is NOT an infrastructure failure. Un-skip the test (or widen the pattern), then run again.`;
    completeWarning(ctx, `/${grep}/ didn't run`, body);
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
  runTargetKey: string;
  grep?: string;
}): string {
  const {
    ctx,
    testFile,
    state,
    outcome,
    res,
    currentEditCount,
    runTargetKey,
    grep,
  } = params;
  // Only a WHOLE-FILE pass grants a fresh fix budget — everything in the spec
  // is green, so prior attempts are moot. A grep-narrowed pass proves only that
  // subset and must NOT reset the counter: otherwise alternating a known-green
  // pattern with a failing one would launder unlimited attempts past the cap.
  // Either way the state is kept so an unchanged rerun of what just passed can
  // be refused instead of looping.
  if (!grep) {
    state.attempts = 0;
    delete state.lastFailureSignature;
  }
  delete state.fileEditCountAtLastRun;
  delete state.lastRunTargetKey;
  // Record BOTH keys for a grep pass. When the pattern matched through a
  // describe title, our leaf-title parser can't canonicalize it, so preflight
  // computes the raw `grep:<pattern>` key while the report yields joined
  // `file:line` keys. Storing only the latter would make the next identical
  // call miss this pass and rerun the same green tests.
  const passedTargetKeys = grep
    ? [
        ...new Set([targetKeyFromRunResult(testFile, res), runTargetKey]),
      ].filter((k): k is string => k != null)
    : [WHOLE_FILE];
  state.passedAtEditCount = {
    ...state.passedAtEditCount,
    ...Object.fromEntries(passedTargetKeys.map((k) => [k, currentEditCount])),
  };
  const skippedNote =
    outcome.skipped > 0 ? `, ${outcome.skipped} deliberately skipped` : "";
  const summary = grep
    ? `The tests matching /${grep}/ passed (${outcome.passed} passed${skippedNote}) — do NOT run them again unless you change files. Only that subset ran (not the rest of ${testFile}).`
    : `All runnable tests passed (${outcome.passed} passed${skippedNote}). This spec is verified — do NOT run it again unless you change files.`;
  const body = `${summary} ${isolationLine(res)}`;
  const title = grep
    ? `Tests passed: ${testFile} › /${grep}/`
    : `Tests passed: ${testFile}`;
  completeStatus(ctx, title, body);
  return body;
}

/**
 * Attach the failure screenshot as an image (tool results are text-only, so it
 * goes as a follow-up user message) and return the artifact-paths section.
 */
async function attachFailureArtifacts(
  ctx: AgentContext,
  results: TestResult[],
): Promise<string> {
  const shot = findFirstScreenshot(results);
  if (!shot) return "";

  const rel = path.isAbsolute(shot.screenshotPath)
    ? path.relative(ctx.appPath, shot.screenshotPath)
    : shot.screenshotPath;
  const errorContext = path.join(path.dirname(rel), "error-context.md");
  const dataUrl = await readTestScreenshotDataUrl(
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
  // Only promise the image when it was actually attached — the read can fail
  // (missing/oversized/escaping file), and the model would otherwise burn a
  // turn looking for an attachment that never arrives.
  const screenshotLine = dataUrl
    ? `\n- Screenshot: ${rel} (attached to the next message as an image)`
    : `\n- Screenshot: ${rel} (could NOT be attached as an image — rely on the page snapshot instead)`;
  return `\nArtifacts from THIS run (other test-results directories are stale — do not read them):\n- Page snapshot: ${errorContext}  ← read this first with read_file; it shows what was actually on the page${screenshotLine}`;
}

async function reportFailure(params: {
  ctx: AgentContext;
  key: string;
  testFile: string;
  grep?: string;
  state: TestRunAttemptState;
  res: RunAppTestsResult;
  outcome: Classification;
  isFreeFlakeRun: boolean;
  currentEditCount: number;
  runTargetKey: string;
}): Promise<string> {
  const { ctx, key, testFile, grep, state, res, outcome, isFreeFlakeRun } =
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
  state.lastRunTargetKey = params.runTargetKey;
  const remaining = Math.max(0, MAX_ATTEMPTS - state.attempts);

  const artifactLines = await attachFailureArtifacts(ctx, res.results);
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

  const skippedNote =
    outcome.skipped > 0 ? `, ${outcome.skipped} deliberately skipped` : "";
  const body = [
    `Test run FAILED (attempt ${state.attempts} of ${MAX_ATTEMPTS} for ${key}). ${outcome.passed} passed, ${outcome.failed} failed${skippedNote}.`,
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
    `Tests failed: ${grep ? `${testFile} › /${grep}/` : testFile}`,
    body,
  );
  return body;
}

export const runTestsTool: ToolDefinition<RunTestsArgs> = {
  name: "run_tests",
  description: `Run the app's Playwright end-to-end tests and get the results back, so you can verify a test you just wrote or edited and iterate until it passes.

- Pass \`testFile\` (e.g. "e2e-tests/checkout.spec.ts") to run one spec — it's required, so always target the single spec you're working on. Use the exact path of a spec that exists under e2e-tests/ (the one you just wrote/edited) — don't guess. If the path doesn't match a real spec, the tool won't run anything and will reply with the list of specs that DO exist, so you can retry with a correct path.
- Unless you just wrote or edited the spec this turn, READ it with read_file before running it — you need its current content to know the test() titles (for grep) and to interpret failures against what the test actually does.
- By default the whole file runs, so a pass means every test in the spec passes.
- Run the whole file by default. Only add \`grep\` (a regex passed to Playwright's --grep, matched against full hierarchical test titles) when you have a specific reason to narrow the run — e.g. one test keeps failing while the spec's other tests already passed and rerunning them all is slow. A narrowed pass only verifies the tests it matched, not the rest of the file. If the pattern matches no runnable test, the tool reports that nothing executed.
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
    args.grep
      ? `Run test: ${args.testFile} › /${args.grep}/`
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

    // Mutation count, not just file edits: a fix made via delete_file,
    // add_dependency, execute_sql, etc. must also unblock the guards below.
    const currentEditCount = ctx.mutationCount ?? 0;
    let runTargetKey = WHOLE_FILE;
    if (args.grep) {
      const validated = await validateGrep(ctx, testFile, args.grep);
      if ("error" in validated) return validated.error;
      runTargetKey = validated.targetKey ?? `grep:${args.grep}`;
    }
    const blocked =
      guardAttemptLimit(ctx, key, state) ??
      guardTurnRunLimit(ctx) ??
      guardDevServerRunning(ctx) ??
      guardAlreadyPassed(ctx, args, state, currentEditCount, runTargetKey) ??
      guardChangedSinceLastRun(
        ctx,
        args,
        state,
        currentEditCount,
        runTargetKey,
      );
    if (blocked) return blocked;

    const isFreeFlakeRun = consumeFreeFlakeCheck(args, state);

    let res: RunAppTestsResult;
    try {
      ctx.testRunCount = (ctx.testRunCount ?? 0) + 1;
      res = await runSpec(ctx, testFile, args.grep);
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
    // A structured non-run (infra failure, nothing executed) is not a real
    // flake rerun either — hand the free rerun back, matching the thrown-error
    // path above. The infra reply promises "call run_tests again", and without
    // the refund that retry would be refused by the guards (flake rerun spent,
    // no files changed), dead-ending the agent.
    if (
      isFreeFlakeRun &&
      (outcome.kind === "infra" || outcome.kind === "no-tests")
    ) {
      state.flakeCheckUsed = false;
    }

    switch (outcome.kind) {
      case "no-tests":
        return reportNoRunnableTests(ctx, testFile, args.grep);
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
          runTargetKey,
          grep: args.grep,
        });
      case "failed":
        return reportFailure({
          ctx,
          key,
          testFile,
          grep: args.grep,
          state,
          res,
          outcome,
          isFreeFlakeRun,
          currentEditCount,
          runTargetKey,
        });
    }
  },
};
