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
import {
  readTestErrorContext,
  readTestScreenshotDataUrl,
} from "@/ipc/utils/test_screenshot";
import { usesSandboxedE2eTests } from "@/lib/e2eSandbox";
import { reconcileResultFile } from "@/lib/testResultUtils";
import { readSettings } from "@/main/settings";
import type { RunAppTestsResult, TestResult } from "@/ipc/types/tests";
import { normalizeFailureSignature } from "./test_failure_signature";
import {
  MAX_ATTEMPTS,
  MAX_RUNS_PER_TURN,
  MAX_ERROR_CHARS,
  MAX_DETAILED_FAILURE_FILES,
  RUN_TIMEOUT_MS,
  SLOW_MO_RUN_TIMEOUT_MS,
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

const runTestsSchema = z
  .object({
    testFiles: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe(
        "Exact relative spec paths under e2e-tests/, e.g. ['e2e-tests/signup.spec.ts', 'e2e-tests/checkout.spec.ts']. Omit to run all specs. An empty list is invalid. Paths are normalized and deduplicated; if any spec is missing, nothing runs.",
      ),
    grep: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Regex passed to Playwright's --grep to run just a subset, e.g. 'check out' or 'user can (sign up|log in)'. Playwright matches against the full hierarchical title (describe blocks plus test title). Applies across the selected files, or the whole suite if testFiles is omitted. Omit by default to run whole files; only pass it to iterate on one slow/failing test or a few related ones.",
      ),
    flakeCheck: z
      .boolean()
      .optional()
      .describe(
        "Set true to rerun WITHOUT having changed any files, to confirm a suspected flaky failure. Allowed once per spec and does not count against the fix-attempt limit.",
      ),
  })
  .strict();

type RunTestsArgs = z.infer<typeof runTestsSchema>;

/** Resolve the entire selection before isolation or attempt accounting. */
async function resolveSpecPaths(
  ctx: AgentContext,
  requested?: string[],
): Promise<
  | { testFiles: string[]; specs: string[]; selectionNote: string }
  | { error: string }
> {
  const listedSpecs = await listSpecFiles(ctx.appPath);
  const specs = listedSpecs.filter(
    (file) => normalizeRunTestFile(file) !== null,
  );
  const unsupported = (requested ?? listedSpecs).filter(
    (file) => normalizeRunTestFile(file) === null,
  );
  const selectionNote =
    unsupported.length > 0
      ? `Unsupported spec paths${requested ? "" : " skipped"}: ${unsupported.join(", ")}. Rename these files to supported paths under e2e-tests/ before running them.`
      : "";
  const existing = new Set(specs);
  const files = new Set<string>();
  const missing: string[] = [];
  for (const file of requested ?? specs) {
    const normalized = normalizeRunTestFile(file);
    if (normalized === null || !existing.has(normalized)) missing.push(file);
    else files.add(normalized);
  }
  if (missing.length === 0 && files.size > 0) {
    return { testFiles: [...files], specs, selectionNote };
  }

  const specList =
    specs.length > 0
      ? `Specs that exist under e2e-tests/:\n${specs.map((file) => `- ${file}`).join("\n")}`
      : "There are no spec files under e2e-tests/ yet — write one first, then run them.";
  const suggestions = missing.flatMap((file) => {
    const base = file.replace(/\\/g, "/").split("/").pop();
    return specs.filter((spec) => spec.split("/").pop() === base);
  });
  const body = [
    missing.length > 0
      ? `No spec matches: ${missing.join(", ")}.`
      : "There are no specs to run.",
    "I did NOT start a run — no test environment was set up and this did NOT count as a fix attempt. No part of the batch ran.",
    specList,
    selectionNote,
    suggestions.length > 0
      ? `Closest match by filename: ${[...new Set(suggestions)].join(", ")}`
      : "",
    "Call run_tests again with exact paths from the list above.",
  ]
    .filter(Boolean)
    .join("\n\n");
  completeWarning(
    ctx,
    missing.length === 1
      ? `No test file matches "${missing[0]}"`
      : "No test files matched",
    body,
  );
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
  // The Playwright spawn uses `node.exe` with `shell: false` (see
  // buildPlaywrightCliInvocation in tests_handlers.ts), so `grep` reaches
  // Playwright as a direct argv element — no cmd.exe `"%VAR%"` expansion or
  // CR/LF command separators. Earlier Windows guards that rejected `%` and
  // newlines were written for the old `npx.cmd` → cmd.exe path and are no
  // longer correct; tests_handlers.preview.test.ts pins the `node.exe`
  // invariant so a change back fails loudly.
  let _regex: RegExp;
  try {
    _regex = new RegExp(grep);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const body = `\`${grep}\` isn't a valid regular expression (${message}), so I did NOT start a run — this did NOT count as a fix attempt.\n\nPass a valid regex for \`grep\` (it's matched against test titles, like Playwright's --grep), or omit it to run the whole file.`;
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
  key: string,
  state: TestRunAttemptState,
): string | null {
  if (state.attempts < MAX_ATTEMPTS) return null;
  const body = `Attempt limit reached: you have already made ${MAX_ATTEMPTS} fix attempts for ${key} this turn. Do NOT run tests again or keep editing this spec. Stop now and summarize for the user: what the test covers, what still fails, what you tried, and what you recommend they do next.`;
  return body;
}

/** Refuse before starting more batches than one turn should own. */
function guardTurnRunLimit(ctx: AgentContext): string | null {
  if ((ctx.testRunCount ?? 0) < MAX_RUNS_PER_TURN) return null;
  const body = `Turn-level test run limit reached: you have already started ${MAX_RUNS_PER_TURN} test batches this turn. Stop now and summarize what passed, what still fails, and what you recommend next.`;
  return body;
}

/**
 * The non-sandboxed path runs Playwright against the user's preview, so it
 * needs one. A sandboxed run serves the app itself from its own copy on its own
 * port and never touches the preview. Being down does not count as an attempt.
 */
function guardDevServerRunning(ctx: AgentContext): string | null {
  if (usesSandboxedE2eTests(readSettings())) return null;
  if (getRunningTestBaseUrl(ctx.appId)) return null;
  const body =
    "The app's dev server isn't running, so the tests can't execute. Ask the user to start the app with the Run button in the preview panel, then call run_tests again. This did NOT count as a fix attempt.";
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

async function runSpecs(
  ctx: AgentContext,
  testFiles: string[],
  grep?: string,
): Promise<RunAppTestsResult> {
  const filesLabel = testFiles.join(", ");
  const label = grep ? `${filesLabel} › /${grep}/` : filesLabel;
  ctx.onXmlStream(
    `<dyad-status title="${escapeXmlAttr(`Running ${label}`)}"></dyad-status>`,
  );
  // Honor the modes the user picked in the Tests panel — including slow motion,
  // so a user watching the agent's runs gets the same pace as their own. With
  // the preview experiment enabled, headed mode drives Dyad's native preview
  // view. A preview or narrowed run must stay serial.
  const settings = readSettings();
  const preview =
    (settings.enableTestRunInPreview ?? false) &&
    (settings.testHeaded ?? false);
  const slowMo = settings.testSlowMo ?? false;
  return runAppTestsWithIsolation({
    event: ctx.event,
    appId: ctx.appId,
    testFiles,
    grep,
    source: "agent",
    headed: settings.testHeaded ?? false,
    // Deliberately not gated on `preview`: the runner already drops
    // `--fully-parallel` while the preview endpoint is live, and it clears that
    // endpoint when a preview run falls back to an ordinary browser. Deciding
    // it here instead would leave the fallback — a whole-file run in its own
    // browser — stuck running serially for no reason.
    parallel: (settings.testParallel ?? false) && !grep,
    slowMo,
    preview,
    externalSignal: ctx.abortSignal,
    // A slowed run spends real time between actions, so it gets a budget to
    // match — otherwise the toggle alone would turn a comfortable spec into an
    // infra timeout the agent can't do anything about.
    timeoutMs: slowMo ? SLOW_MO_RUN_TIMEOUT_MS : RUN_TIMEOUT_MS,
  });
}

/** Spec exists but nothing executed — empty file or every test() skipped. */
function reportNoRunnableTests(testFile: string, grep?: string): string {
  if (grep) {
    const body = `The tests matching \`${grep}\` in \`${testFile}\` executed nothing — the pattern matched nothing, or the matches are skipped (\`test.skip\`/\`test.fixme\`), or the pattern only matched a \`describe\` block with no runnable test. This did NOT count as a fix attempt and is NOT an infrastructure failure. Un-skip the test (or widen the pattern), then run again.`;
    return body;
  }
  const body = `\`${testFile}\` ran but nothing executed — the file is empty or every \`test()\` is skipped (\`test.skip\`/\`test.fixme\`). This did NOT count as a fix attempt and is NOT an infrastructure failure. Un-skip it (or add a real \`test()\`), then run again.`;
  return body;
}

/** Uncounted; fileEditCountAtLastRun stays as-is so the next run isn't blocked. */
function reportInfraFailure(
  outcome: Classification,
  resultsSummary = "",
): string {
  const body = [
    `Test run could not complete — this is an infrastructure problem, NOT a test failure, and did NOT count as a fix attempt.`,
    outcome.message ?? "Unknown error.",
    resultsSummary,
    "No file was granted verification. Fix the environment (or ask the user), then call run_tests again. For a timeout, select a smaller batch with testFiles rather than repeating the whole suite.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return body;
}

function reportPassed(params: {
  testFile: string;
  state: TestRunAttemptState;
  outcome: Classification;
  res: RunAppTestsResult;
  currentEditCount: number;
  runTargetKey: string;
  grep?: string;
}): string {
  const {
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
  return summary;
}

/**
 * Attach the failure screenshot as an image (tool results are text-only, so it
 * goes as a follow-up user message) and return the artifact-paths section.
 */
async function attachFailureArtifacts(
  ctx: AgentContext,
  results: TestResult[],
  attachImage = true,
): Promise<string> {
  const shot = findFirstScreenshot(results);
  if (!shot) return "";

  const rel = path.isAbsolute(shot.screenshotPath)
    ? path.relative(ctx.appPath, shot.screenshotPath)
    : shot.screenshotPath;
  // A sandboxed run retains its artifacts under `<userData>/test-artifacts`,
  // outside the app. `read_file` goes through `safeJoin` and rejects anything
  // escaping the app directory, so handing the model a `../../..` path would
  // guarantee its first diagnostic step fails.
  const readableByAgent = !rel.startsWith("..") && !path.isAbsolute(rel);
  const screenshotPath = rel.split(path.sep).join("/");
  if (!attachImage) {
    const artifactPath = readableByAgent ? screenshotPath : shot.screenshotPath;
    const errorContext = path
      .join(path.dirname(artifactPath), "error-context.md")
      .split(path.sep)
      .join("/");
    const scopeNote = readableByAgent
      ? ""
      : " (retained outside the app; read_file cannot open these paths)";
    return `\nArtifacts from THIS run${scopeNote}:\n- Page snapshot: ${errorContext}\n- Screenshot: ${artifactPath} (not attached; batch detail limit)`;
  }
  const [dataUrl, inlineSnapshot] = await Promise.all([
    readTestScreenshotDataUrl(ctx.appPath, shot.screenshotPath, ctx.appId),
    readableByAgent
      ? Promise.resolve(null)
      : readTestErrorContext(ctx.appPath, shot.screenshotPath, ctx.appId),
  ]);
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
  const attachmentNote = dataUrl
    ? "attached to the next message as an image"
    : inlineSnapshot || readableByAgent
      ? "could NOT be attached as an image — rely on the page snapshot instead"
      : "could NOT be attached as an image; use the reported test error to investigate";

  if (readableByAgent) {
    const errorContext = path
      .join(path.dirname(rel), "error-context.md")
      .split(path.sep)
      .join("/");
    return `\nArtifacts from THIS run (other test-results directories are stale — do not read them):\n- Page snapshot: ${errorContext}  ← read this first with read_file; it shows what was actually on the page\n- Screenshot: ${screenshotPath} (${attachmentNote})`;
  }

  // Out-of-app artifacts: inline the snapshot rather than name a path the model
  // cannot open, and don't print the traversal path at all — it's meaningless
  // to the agent and misleading as a location.
  const snapshotSection = inlineSnapshot
    ? `\n- Page snapshot (the page state when the test failed; inlined because this run's artifacts live outside the app and read_file cannot reach them):\n\n${inlineSnapshot}\n`
    : "\n- Page snapshot: unavailable for this run.";
  return `\nArtifacts from THIS run:${snapshotSection}\n- Screenshot: ${attachmentNote}.`;
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
  includeDetails: boolean;
}): Promise<string> {
  const { ctx, key, state, res, outcome, isFreeFlakeRun } = params;

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

  const artifactLines = await attachFailureArtifacts(
    ctx,
    res.results,
    params.includeDetails,
  );
  if (!params.includeDetails) {
    return `${key}: failure attempt ${state.attempts} of ${MAX_ATTEMPTS}; ${remaining} attempt(s) remain. ${remaining === 0 ? "Stop fixing this spec and summarize for the user." : "Read this file's artifacts before making a targeted fix."} Error details omitted to keep the batch report bounded.${artifactLines}`;
  }
  const firstError = firstFailureError(res.results);

  const noProgressNote = unchanged
    ? "\nNOTE: your last change did NOT alter the failure — the same tests are failing with the same error. Re-read the test and the app code and try a DIFFERENT approach instead of a small variation.\n"
    : "";

  const inconclusiveHint = outcome.allInconclusive
    ? "\nThese are locator/timeout/strict-mode errors (e.g. a selector that matched nothing, matched a hidden element, or matched more than one element). That is almost always a LOCATOR bug in the test — make the selector more precise (exact text/role, filter to the visible element, scope to a container). Only if the page snapshot shows the page never rendered is it the app or environment.\n"
    : "";

  const nextStep =
    remaining > 0
      ? `Next: use the page snapshot from the artifacts above, decide whether the TEST or the APP is wrong, make one targeted fix, then call run_tests again. ${remaining} attempt(s) remain for this spec this turn.`
      : `You have now used all ${MAX_ATTEMPTS} attempts for this spec. Stop and summarize the situation for the user.`;

  const skippedNote =
    outcome.skipped > 0 ? `, ${outcome.skipped} deliberately skipped` : "";
  const body = [
    `Test run FAILED (attempt ${state.attempts} of ${MAX_ATTEMPTS} for ${key}). ${outcome.passed} passed, ${outcome.failed} failed${skippedNote}.`,
    noProgressNote,
    inconclusiveHint,
    truncateError(listFailedTests(res.results).join("\n")),
    firstError
      ? `\nError (truncated to last ${MAX_ERROR_CHARS} chars):\n\`\`\`\n${truncateError(firstError)}\n\`\`\``
      : "",
    artifactLines,
    `\n${nextStep}`,
  ]
    .filter(Boolean)
    .join("\n");

  return body;
}

export const runTestsTool: ToolDefinition<RunTestsArgs> = {
  name: "run_tests",
  description: `Run the app's Playwright end-to-end tests in one batch and get per-file results back, so you can verify affected specs and iterate on failures.

- Pass \`testFiles\` (e.g. ["e2e-tests/signup.spec.ts", "e2e-tests/checkout.spec.ts"]) to select exact existing specs. Omit it deliberately to run all specs under e2e-tests/. An empty list or the old testFile argument is invalid. Duplicate paths run once; if any path is missing, the entire batch is refused and the real specs are listed.
- Unless you just wrote or edited a selected spec this turn, READ it with read_file before running it. Prefer batching affected specs over running the whole suite.
- By default each whole file runs. For managed Neon and Supabase apps, database data and auth users are isolated per test case and retry, including across files. Seed each case independently. The batch follows the Tests panel's headed, parallel, and slow-motion preferences; preview and database-isolated runs remain sequential.
- Call \`run_tests\` sequentially for the same app: wait for each call to finish before starting the next. Overlapping calls cancel earlier runs; they do not run in parallel.
- Only add \`grep\` when you have a specific reason to narrow the run. One regex applies to Playwright's full hierarchical test titles across all selected files. Filtered runs stay sequential. A filtered pass verifies only matched tests; a file with no runnable matches is not verified.
- Runs in an isolated copy of the app served on its own port, so the preview does not need to be running. Docker/cloud runtimes and disabled sandboxing require the dev server. Each batch shares one snapshot and clean dependency install; batch affected specs to amortize setup.
- Results name each file and its pass/fail/no-tests outcome. Failures include error text and current artifact paths; read error-context.md with read_file (or the inline snapshot for sandbox artifacts), make a targeted fix, then rerun the relevant files.
- You get ${MAX_ATTEMPTS} failure attempts per spec per turn. A whole-file pass resets only that file's budget; a filtered pass does not. Infrastructure failures and incomplete runs do not consume failure attempts or grant verification.
- If you suspect a failure is flaky, rerun with \`flakeCheck: true\`: once per file, without consuming a failure attempt.
- Never rerun a target that already passed without an app change. If any selected file is blocked by a retry guard, the entire batch is refused with the blocked paths; select eligible files explicitly instead.
- At most ${MAX_RUNS_PER_TURN} batches may start per turn, including infrastructure failures. Each batch has one 10-minute execution deadline, or 20 minutes with slow motion, tripled for per-test database isolation. Refused requests do not consume a run.`,
  inputSchema: runTestsSchema,
  defaultConsent: "always",
  // A run writes Playwright's config/deps into the app and provisions remote
  // test data (a throwaway Neon branch or Supabase user), so this must be
  // excluded from read-only / plan modes.
  modifiesState: true,
  isEnabled: (ctx) => ctx.testingEnabled,

  getConsentPreview: (args) => {
    const selection = args.testFiles?.join(", ") ?? "all specs";
    return args.grep
      ? `Run tests: ${selection} › /${args.grep}/`
      : `Run tests: ${selection}`;
  },

  execute: async (args, ctx: AgentContext) => {
    // Also fail closed for direct callers: a legacy testFile must never be
    // stripped into an empty object and accidentally select the whole suite.
    const parsed = runTestsSchema.safeParse(args);
    if (!parsed.success) {
      const body = `Invalid run_tests arguments: ${parsed.error.message}. Use testFiles with a nonempty list, or omit it to run all specs. Nothing ran.`;
      completeWarning(ctx, "Invalid test selection", body);
      return body;
    }
    const resolved = await resolveSpecPaths(ctx, args.testFiles);
    if ("error" in resolved) return resolved.error;
    const { testFiles, specs, selectionNote } = resolved;
    const withSelectionNote = (body: string) =>
      [selectionNote, body].filter(Boolean).join("\n\n");
    const warn = (title: string, body: string) => {
      const message = withSelectionNote(body);
      completeWarning(ctx, title, message);
      return message;
    };
    const selections = [];
    for (const testFile of testFiles) {
      const key = specKey(testFile);
      let runTargetKey = WHOLE_FILE;
      if (args.grep) {
        const validated = await validateGrep(ctx, testFile, args.grep);
        if ("error" in validated)
          return warn("Invalid grep pattern", validated.error);
        runTargetKey = validated.targetKey ?? `grep:${args.grep}`;
      }
      selections.push({ testFile, key, runTargetKey });
    }
    // Read the shared counters after all asynchronous preflight work. Nothing
    // can interleave admission checks and reservation of this batch's slot.
    const targets = selections.map((selection) => {
      const state: TestRunAttemptState = ctx.testRunAttempts.get(
        selection.key,
      ) ?? { attempts: 0 };
      return { ...selection, state };
    });
    const currentEditCount = ctx.mutationCount ?? 0;
    const refusals = targets.flatMap(
      ({ testFile, key, state, runTargetKey }) => {
        const blocked =
          guardAttemptLimit(key, state) ??
          guardAlreadyPassed(args, state, currentEditCount, runTargetKey) ??
          guardChangedSinceLastRun(args, state, currentEditCount, runTargetKey);
        return blocked ? [`${testFile}: ${blocked}`] : [];
      },
    );
    if (refusals.length > 0) {
      const body = `Batch not started; no files ran. Blocked files:\n\n${refusals.join("\n\n")}\n\nSelect only eligible files for the next call.`;
      return warn("Test batch blocked", body);
    }
    const turnLimit = guardTurnRunLimit(ctx);
    if (turnLimit) return warn("Test run limit reached", turnLimit);
    const devServerBlocked = guardDevServerRunning(ctx);
    if (devServerBlocked) return warn("App isn't running", devServerBlocked);
    if (ctx.abortSignal?.aborted) {
      return warn(
        "Test run couldn't complete",
        reportInfraFailure({
          kind: "infra",
          passed: 0,
          failed: 0,
          skipped: 0,
          allInconclusive: false,
          message: "Test run stopped.",
        }),
      );
    }

    const runs = targets.map((target) => {
      ctx.testRunAttempts.set(target.key, target.state);
      return {
        ...target,
        isFreeFlakeRun: consumeFreeFlakeCheck(args, target.state),
      };
    });
    const refundFlakeChecks = () => {
      for (const run of runs) {
        if (run.isFreeFlakeRun) run.state.flakeCheckUsed = false;
      }
    };

    let res: RunAppTestsResult;
    try {
      ctx.testRunCount = (ctx.testRunCount ?? 0) + 1;
      res = await runSpecs(ctx, testFiles, args.grep);
    } catch (error) {
      refundFlakeChecks();
      const message = error instanceof Error ? error.message : String(error);
      const body = `Test run could not complete — an unexpected error occurred in the test infrastructure, NOT a test failure, and this did NOT count as a fix attempt.\n\n${message}\n\nFix the environment (or ask the user), then call run_tests again.`;
      return warn("Test run couldn't complete", body);
    }
    const resultsByFile = new Map<string, TestResult[]>();
    for (const result of res.results) {
      const file = reconcileResultFile(result.file, specs);
      const results = resultsByFile.get(file) ?? [];
      results.push({ ...result, file });
      resultsByFile.set(file, results);
    }
    // Never grant verification or charge a file for an incomplete batch,
    // including a preview run that returned partial results before cancellation.
    const batchOutcome = classify(res);
    if (batchOutcome.kind === "infra" || ctx.abortSignal?.aborted) {
      refundFlakeChecks();
      const observedResults = testFiles.map((file) => {
        const results = resultsByFile.get(file) ?? [];
        if (results.length === 0)
          return `${file}: no results returned — not verified`;
        // Report observations only; never pass these through the accounting
        // helpers or infer a whole-file pass from an interrupted report.
        const observed = classify({
          appId: res.appId,
          results: results.map(
            ({ incomplete: _incomplete, ...result }) => result,
          ),
        });
        return `${file}: observed ${observed.passed} passed, ${observed.failed} failed, ${observed.skipped} skipped${results.some((result) => result.incomplete) ? " (file incomplete)" : ""} — not verified`;
      });
      return warn(
        "Test run couldn't complete",
        reportInfraFailure(
          ctx.abortSignal?.aborted
            ? { ...batchOutcome, kind: "infra", message: "Test run stopped." }
            : batchOutcome,
          `Results returned before the batch warning:\n${observedResults.join("\n")}`,
        ),
      );
    }

    const agentDetails: string[] = [];
    const summary: string[] = [];
    let failedFiles = 0;
    let unverifiedFiles = 0;
    for (const run of runs) {
      const fileResult = {
        ...res,
        results: resultsByFile.get(run.testFile) ?? [],
      };
      const outcome = classify(fileResult);
      const scope = args.grep ? ` (matching /${args.grep}/ only)` : "";
      if (outcome.kind === "no-tests") {
        if (run.isFreeFlakeRun) run.state.flakeCheckUsed = false;
        unverifiedFiles += 1;
        summary.push(`${run.testFile}: no runnable tests — not verified`);
        agentDetails.push(reportNoRunnableTests(run.testFile, args.grep));
      } else if (outcome.kind === "passed") {
        summary.push(
          `${run.testFile}: passed — ${outcome.passed} passed, ${outcome.skipped} skipped${scope}`,
        );
        agentDetails.push(
          `${run.testFile}: ${reportPassed({ ...run, outcome, res: fileResult, currentEditCount, grep: args.grep })}`,
        );
      } else {
        failedFiles += 1;
        summary.push(
          `${run.testFile}: failed — ${outcome.passed} passed, ${outcome.failed} failed, ${outcome.skipped} skipped${scope}`,
        );
        agentDetails.push(
          await reportFailure({
            ...run,
            ctx,
            outcome,
            res: fileResult,
            currentEditCount,
            grep: args.grep,
            includeDetails: failedFiles <= MAX_DETAILED_FAILURE_FILES,
          }),
        );
      }
    }
    // Show each file once in chat; detailed reports and retry instructions
    // belong only in the model's tool response.
    const body = [summary.join("\n"), isolationLine(res)].join("\n\n");
    const title =
      failedFiles > 0
        ? `Tests failed in ${failedFiles} file(s)`
        : unverifiedFiles > 0
          ? "Test batch finished — some files not verified"
          : args.grep
            ? "Matching tests passed"
            : "Tests passed";
    if (unverifiedFiles > 0 && failedFiles === 0)
      completeWarning(ctx, title, withSelectionNote(body));
    else completeStatus(ctx, title, withSelectionNote(body));
    return withSelectionNote([body, ...agentDetails].join("\n\n"));
  },
};
