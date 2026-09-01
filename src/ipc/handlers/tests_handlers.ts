import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { glob } from "glob";
import log from "electron-log";
import type { IpcMainInvokeEvent } from "electron";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { getDyadAppPath } from "../../paths/paths";
import { createTypedHandler } from "./base";
import {
  E2E_TEST_DIR,
  TEST_SPEC_EXT_ALTERNATION,
  TEST_SPEC_GLOB,
  testsContracts,
} from "../types/tests";
import type {
  MigrateLegacyTestResult,
  RunAppTestsResult,
  TestCase,
  TestIsolation,
  TestResult,
  TestsRunStatePayload,
} from "../types/tests";
import {
  detectLegacyPlaywrightSpecs,
  legacyToE2ePath,
  normalizeLegacyTestFile,
  planLegacyMigration,
} from "../utils/legacy_test_migration";
import { assertMutationPathAllowed, safeJoin } from "../utils/path_utils";
import { gitAdd, gitRemove } from "../utils/git_utils";
import { gitService } from "../services/git_service";
import { runningApps } from "../utils/process_manager";
import {
  appOperationCoordinator,
  readAppResource,
} from "../services/app_operation_coordinator";
import { broadcastToRegisteredWindows } from "@/ipc/utils/window_broadcast";
import { spawnStreaming } from "../utils/spawn_streaming";
import {
  ensurePlaywrightBootstrap,
  DYAD_CONFIG_FILENAME,
  TEST_BASE_URL_ENV,
  TEST_RESULTS_JSON,
} from "../utils/playwright_bootstrap";
import {
  parsePlaywrightReport,
  PLAYWRIGHT_REPORT_ERROR_FILE,
} from "../utils/playwright_report";
import { parseTestCases } from "../utils/parse_test_cases";
import { getPackageManagerCommandEnv } from "../utils/socket_firewall";
import { queueCloudSandboxSnapshotSync } from "../utils/cloud_sandbox_provider";
import { sendTelemetryEvent } from "../utils/telemetry";
import {
  prepareIsolatedTestDatabase,
  type PreparedIsolation,
} from "../services/isolated_test_db";
import { prepareE2eTestDataIsolation } from "../services/e2e_test_data_isolation";
import {
  stopE2eTestProcessesSync,
  trackE2eTestProcess,
} from "../services/e2e_test_process_registry";
import {
  createE2eTestWorkspace,
  retainE2eTestArtifacts,
  rewriteE2eArtifactPath,
  type E2eTestWorkspace,
} from "../services/e2e_test_workspace";
import {
  hasCustomE2eStartCommand,
  startE2eTestRuntime,
  type E2eTestRuntime,
} from "../services/e2e_test_runtime";
import { readTestScreenshotDataUrl } from "../utils/test_screenshot";
import { isRecordingActive } from "../services/recording_registry";
import { readSettings } from "@/main/settings";
import { usesSandboxedE2eTests } from "@/lib/e2eSandbox";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";

const logger = log.scope("tests_handlers");

// A test file must look like the spec paths `listAppTests` produces: relative,
// under `e2e-tests/`, ending in a spec extension, with no traversal or leading
// dash. This stops a compromised renderer from passing a flag-like value
// (e.g. `--config=…`) that Playwright would interpret as a CLI option. The
// allowed characters must cover everything the listing glob can surface
// (spaces, `@`, parentheses, non-ASCII letters), so the guards are negative:
// no `..`, no segment starting with `-`, and no backslash, colon (reserved for
// the `file:line` selector), or control characters.
const TEST_FILE_PATTERN = new RegExp(
  `^${E2E_TEST_DIR}/(?!.*\\.\\.)(?!(?:-|.*/-))[^\\\\:\\x00-\\x1f]+\\.spec\\.(${TEST_SPEC_EXT_ALTERNATION})$`,
);

export function normalizeRunTestFile(testFile: string): string | null {
  const normalized = path.posix.normalize(testFile.replace(/\\/g, "/"));
  return TEST_FILE_PATTERN.test(normalized) ? normalized : null;
}

// Playwright treats each positional test argument as a regular expression
// matched against the full test-file path, so a legitimate filename containing
// regex metacharacters (e.g. `e2e-tests/checkout(legacy).spec.ts` or
// `e2e-tests/item[1].spec.ts`) would otherwise match a different file or none at
// all. Escape the path portion so it matches literally. The `:line` suffix is
// appended outside the escaped portion — Playwright parses it separately.
function escapeRegExpForSelector(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isNoTestsFoundOutput(output: string): boolean {
  return /\bno tests found\b/i.test(output);
}

/**
 * Repoint sandbox-relative artifact paths at the retained copy. `artifactPath`
 * is undefined when retention failed, which drops the paths instead: the
 * sandbox is about to be deleted, so a path into it would only fail to open.
 */
function rewriteResultArtifactPaths(
  results: TestResult[],
  workspacePath: string,
  artifactPath: string | undefined,
  /**
   * Applied to the failure text, which carries spec locations and stack frames
   * rooted at the sandbox — a directory deleted moments after the run.
   */
  rewriteText: (text: string) => string = (text) => text,
): TestResult[] {
  return results.map((result) => ({
    ...result,
    error: result.error === undefined ? undefined : rewriteText(result.error),
    screenshotPath: rewriteE2eArtifactPath(
      result.screenshotPath,
      workspacePath,
      artifactPath,
    ),
    tests: result.tests?.map((test) => ({
      ...test,
      error: test.error === undefined ? undefined : rewriteText(test.error),
      screenshotPath: rewriteE2eArtifactPath(
        test.screenshotPath,
        workspacePath,
        artifactPath,
      ),
    })),
  }));
}

/**
 * The relative paths of every spec under the app's `e2e-tests/` folder, sorted.
 * Shared by the Tests panel listing and the agent's run_tests tool (so a
 * mistyped target can be answered with the paths that actually exist).
 */
export async function listSpecFiles(appPath: string): Promise<string[]> {
  const testsDir = path.join(appPath, E2E_TEST_DIR);
  if (!fs.existsSync(testsDir)) {
    return [];
  }
  const matches = await glob(TEST_SPEC_GLOB, {
    cwd: appPath,
    nodir: true,
    posix: true,
  });
  return matches.sort((a, b) => a.localeCompare(b));
}

/**
 * The individual `test()` cases of one spec, parsed from its current content.
 * Shared by the Tests panel listing and the agent's run_tests tool (so a test
 * name can be resolved to its `file:line` target, or answered with the titles
 * that actually exist). A file that can't be read/parsed yields no cases and
 * is still runnable as a whole.
 */
export async function readSpecTestCases(
  appPath: string,
  testFile: string,
): Promise<TestCase[]> {
  try {
    const content = await fs.promises.readFile(
      path.join(appPath, testFile),
      "utf8",
    );
    return parseTestCases(content);
  } catch (error) {
    logger.warn(`Failed to parse test cases in ${testFile}: ${error}`);
    return [];
  }
}

/**
 * Worker count for a parallel run. Derived from the host's cores (leaving one
 * free), capped so we don't overwhelm the single dev server the tests share.
 */
function parallelWorkerCount(): number {
  const cores = os.cpus()?.length ?? 2;
  return Math.max(1, Math.min(cores - 1, 8));
}

// In-flight runs keyed by appId. `controller` lets the Stop button cancel an
// in-progress bootstrap or test run; `done` resolves once the whole
// prepare → run → teardown lifecycle has finished, so a new run can wait for
// the prior run's teardown (env restore + branch delete) before swapping env
// again instead of racing it.
interface TestRun {
  controller: AbortController;
  done: Promise<void>;
  runId: number;
}
const testRunControllers = new Map<number, TestRun>();
const testRunGenerationByAppId = new Map<number, number>();

/**
 * Whether a test run is in flight for the app. Consulted by the recording
 * handler for mutual exclusion — a recording session and a test run must never
 * run at once (both restart the dev server and share the Neon test-branch slot).
 */
export function isTestRunActive(appId: number): boolean {
  return testRunControllers.has(appId);
}

/** Abort every sandbox/test runner during Electron's synchronous quit phase. */
export function stopAllAppTestsSync(): void {
  for (const run of testRunControllers.values()) {
    run.controller.abort();
  }
  // Aborting is not enough here. The abort listeners route into `killProcess`,
  // which tree-kills asynchronously, and `will-quit` does not await async work.
  // Tree-kill the run-scoped children synchronously too, or a sandbox dev
  // server survives the quit holding its port and its cwd under
  // `<userData>/test-sandboxes`.
  stopE2eTestProcessesSync();
}

export async function endTestsForApp(appId: number): Promise<void> {
  const run = testRunControllers.get(appId);
  if (!run) return;
  run.controller.abort();
  await run.done;
}

async function getApp(appId: number) {
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });
  if (!app) {
    throw new DyadError(
      `App with id ${appId} not found`,
      DyadErrorKind.NotFound,
    );
  }
  return app;
}

/** Resolve the running dev server's proxy URL, or null if not running. */
export function getRunningTestBaseUrl(appId: number): string | null {
  return runningApps.get(appId)?.proxyUrl ?? null;
}

function emitOutput(
  event: IpcMainInvokeEvent,
  appId: number,
  runId: number,
  chunk: string,
  phase: "setup" | "running",
): void {
  broadcastToRegisteredWindows(event.sender, "tests:output", {
    appId,
    runId,
    chunk,
    phase,
  });
}

function emitRunState(
  event: IpcMainInvokeEvent,
  payload: TestsRunStatePayload,
): void {
  broadcastToRegisteredWindows(event.sender, "tests:run-state", payload);
}

export interface RunAppTestsCoreOptions {
  appId: number;
  /** Explicit execution directory for an isolated test workspace. */
  appPath?: string;
  /** Explicit test-server URL. Legacy callers use the normal preview URL. */
  baseUrl?: string;
  /** Bootstrap is performed against the real app before sandbox creation. */
  skipBootstrap?: boolean;
  /**
   * Result of that earlier bootstrap. Threaded in with `skipBootstrap` so the
   * `first_run` telemetry property keeps meaning "Playwright was installed by
   * this run" instead of always reporting false for sandboxed runs.
   */
  bootstrapInstalled?: boolean;
  /** When set, runs a single spec file (relative path); otherwise runs all. */
  testFile?: string;
  /**
   * When set (with testFile), runs only the test at this 1-based line via
   * Playwright's `file:line` selector. Used by the Tests panel's per-test Run.
   */
  testLine?: number;
  /**
   * When set (with testFile), narrows the run to the tests whose title matches
   * this regex via Playwright's `-g`/`--grep`. Used by the agent's run_tests
   * tool to target a subset by name. Mutually exclusive with testLine.
   */
  grep?: string;
  /**
   * When true, runs the browser in headed mode (a visible window). Defaults to
   * headless.
   */
  headed?: boolean;
  /**
   * When true, runs the targeted tests in parallel by overriding the generated
   * config's serial defaults (`--fully-parallel --workers=N`). Lets a single
   * file's independent tests run concurrently against the one dev server.
   */
  parallel?: boolean;
  /** Aborts an in-flight bootstrap or run. */
  signal?: AbortSignal;
  /**
   * Hard wall-clock cap (ms) for the Playwright process. Surfaces as a non-zero
   * exit so it's classified as an infra failure rather than hanging. The panel
   * leaves this unset (relies on Playwright's own per-test timeouts + Stop); the
   * agent tool sets it so one run_tests call can't stall the whole agent turn.
   */
  timeoutMs?: number;
  /** Streams raw bootstrap/runner output as it arrives. */
  onOutput?: (chunk: string, phase: "setup" | "running") => void;
  /**
   * Extra env vars merged into the Playwright runner (e.g. Supabase test-user
   * credentials the generated test signs in with). Never contains privileged
   * keys.
   */
  testEnv?: Record<string, string>;
}

/**
 * Bootstrap Playwright when requested, run against an explicit sandbox server
 * (or the legacy preview URL for direct callers), and parse the JSON report.
 */
export async function runAppTestsCore({
  appId,
  appPath: explicitAppPath,
  baseUrl: explicitBaseUrl,
  skipBootstrap = false,
  bootstrapInstalled = false,
  testFile,
  testLine,
  grep,
  headed,
  parallel,
  signal,
  timeoutMs,
  onOutput,
  testEnv,
}: RunAppTestsCoreOptions): Promise<RunAppTestsResult> {
  const app = await getApp(appId);
  const appPath = explicitAppPath ?? getDyadAppPath(app.path);
  const emit = (chunk: string, phase: "setup" | "running") =>
    onOutput?.(chunk, phase);
  const normalizedTestFile =
    testFile === undefined ? undefined : normalizeRunTestFile(testFile);

  // Reject anything that doesn't look like one of our spec paths before it
  // reaches the Playwright CLI (the Zod schema only checks it's a string).
  if (testFile !== undefined && !normalizedTestFile) {
    return {
      appId,
      results: [],
      infraError: { message: `Invalid test file: ${testFile}` },
    };
  }

  // Gate: the dev server must be running so baseURL resolves.
  const baseUrl = explicitBaseUrl ?? getRunningTestBaseUrl(appId);
  if (!baseUrl) {
    return {
      appId,
      results: [],
      infraError: {
        message:
          "Start the app before running tests — the dev server isn't running.",
      },
    };
  }

  // 1. Lazy bootstrap (install Playwright + browser, write config), streamed.
  // Sandboxed runs bootstrap the real app earlier and pass the outcome in.
  let installed = bootstrapInstalled;
  if (!skipBootstrap) {
    try {
      const result = await ensurePlaywrightBootstrap({
        appPath,
        signal,
        onOutput: (chunk) => emit(chunk, "setup"),
      });
      installed = result.installed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Playwright bootstrap failed: ${message}`);
      return { appId, results: [], infraError: { message } };
    }
  }

  if (signal?.aborted) {
    return { appId, results: [], infraError: { message: "Test run stopped." } };
  }

  // 2. Run the tests. Use list reporter for live stdout + json for parsing.
  const resultsJsonPath = path.join(appPath, TEST_RESULTS_JSON);
  // Clear any stale report so a crash doesn't surface old results.
  try {
    fs.rmSync(resultsJsonPath, { force: true });
  } catch {
    // ignore
  }

  // Pass args as an array (never a shell string) so a test path can't be
  // interpreted as a shell command. A line suffix (`file:line`) targets a
  // single test; the line is validated to be a positive integer at the IPC
  // boundary, so it can't smuggle a flag.
  // Always select Dyad's config by name. Playwright auto-resolves
  // `playwright.config.ts` — the app's own file, which may not exist, may
  // hardcode a baseURL, or may point at a different testDir. Ours is the only
  // one that honors DYAD_TEST_BASE_URL, so it's passed explicitly rather than
  // Dyad taking over the canonical config name.
  const args = ["playwright", "test", "--config", DYAD_CONFIG_FILENAME];
  if (normalizedTestFile) {
    const escapedFile = escapeRegExpForSelector(normalizedTestFile);
    const target =
      testLine && Number.isInteger(testLine) && testLine > 0
        ? `${escapedFile}:${testLine}`
        : escapedFile;
    args.push(target);
  } else {
    // Existing user configs can point at a different testDir. Dyad's panel only
    // lists specs under e2e-tests/, so an all-run must target that directory
    // explicitly instead of executing every spec the user's config knows about.
    args.push(`${E2E_TEST_DIR}/`);
  }
  // `-g <regex>` narrows the run to the tests whose title matches (same as the
  // Playwright CLI). Passed as a separate array arg, never a shell string, so
  // the pattern can't be interpreted as a shell command or smuggle a flag.
  if (grep) {
    args.push("-g", grep);
  }
  args.push("--reporter=list,json");
  // baseURL is passed via the DYAD_TEST_BASE_URL env var, not a CLI flag —
  // `playwright test` has no `--base-url` option.
  // `--headed` opens a visible browser window so the user can watch the run.
  // It overrides the headless default (and the CI=true env set below).
  if (headed) {
    args.push("--headed");
  }
  // Override the generated config's serial defaults (`workers: 1`,
  // `fullyParallel: false`) so a file's independent tests run concurrently.
  // `--fully-parallel` is what parallelizes tests *within* a single file.
  if (parallel) {
    args.push("--fully-parallel", `--workers=${parallelWorkerCount()}`);
  }

  let run;
  try {
    run = await spawnStreaming({
      command: "npx",
      args,
      cwd: appPath,
      env: getPackageManagerCommandEnv({
        ...process.env,
        ...testEnv,
        [TEST_BASE_URL_ENV]: baseUrl,
        PLAYWRIGHT_JSON_OUTPUT_NAME: TEST_RESULTS_JSON,
        // Non-interactive: never try to open/serve an HTML report.
        CI: "true",
      }),
      signal,
      timeoutMs,
      onOutput: (chunk) => emit(chunk, "running"),
      // Quit tree-kills the runner synchronously; the signal path alone would
      // leave a headless browser and the sandbox cwd behind.
      onProcess: trackE2eTestProcess,
    });
  } catch (error) {
    // A spawn failure (e.g. npx missing from PATH) rejects rather than exiting
    // non-zero. Surface it as a structured infra error in the Tests panel
    // instead of letting it bubble up as a generic IPC failure.
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to spawn the test runner: ${message}`);
    return { appId, results: [], infraError: { message } };
  }

  if (run.aborted) {
    return { appId, results: [], infraError: { message: "Test run stopped." } };
  }

  // Classify a timeout BEFORE parsing the report: Playwright may have written
  // a parseable (but incomplete) JSON report before the kill, which would
  // otherwise surface as a clean pass/fail instead of the uncounted
  // infrastructure outcome the agent tool is promised.
  if (run.timedOut) {
    return {
      appId,
      results: [],
      infraError: {
        message: `The test run exceeded the ${Math.round((timeoutMs ?? 0) / 60000)}-minute limit and was stopped before it could finish.`,
      },
    };
  }

  // 3. Parse the JSON report.
  let results: TestResult[] = [];
  let parseOk = false;
  if (fs.existsSync(resultsJsonPath)) {
    try {
      const raw = fs.readFileSync(resultsJsonPath, "utf8");
      results = parsePlaywrightReport(JSON.parse(raw), appPath);
      parseOk = true;
    } catch (error) {
      logger.error(`Failed to parse Playwright report: ${error}`);
    }
  }

  if (!parseOk) {
    // No report produced — Playwright itself failed (missing browser,
    // config error, dev server unreachable). Infra/amber.
    const tail = run.stderr.trim() || run.stdout.trim();
    return {
      appId,
      results,
      infraError: {
        message:
          tail.slice(-1500) ||
          "The test runner didn't produce a report. Check the output for details.",
      },
    };
  }

  if (results.length === 0) {
    // A report parsed but has no results. If Playwright exited cleanly this is
    // a "no tests matched" outcome (e.g. running a single test by line whose
    // selector matched nothing) — not an infra failure, so don't show an amber
    // error. A non-zero exit with an empty report is a real runner failure.
    const tail = run.stderr.trim() || run.stdout.trim();
    if (run.code === 0 || isNoTestsFoundOutput(tail)) {
      // When the user explicitly targeted a single test by line, an empty
      // report means the line no longer points at a test (e.g. it shifted
      // after an edit). Surface that instead of silently returning to idle
      // with no visible change.
      if (testLine && Number.isInteger(testLine) && testLine > 0) {
        return {
          appId,
          results: [],
          infraError: {
            message: `No test was found at line ${testLine} — it may have moved. Try running the whole file.`,
          },
        };
      }
      // A grep that matched no runnable test at runtime: hand back an empty
      // result so the caller can report "no runnable test" rather than an
      // infra dead-end. Playwright owns grep matching because it uses full
      // hierarchical titles.
      return { appId, results: [] };
    }
    return {
      appId,
      results,
      infraError: {
        message:
          tail.slice(-1500) ||
          "The test runner didn't produce a report. Check the output for details.",
      },
    };
  }

  const reportLevelError = results.find(
    (r) => r.file === PLAYWRIGHT_REPORT_ERROR_FILE,
  );
  if (reportLevelError) {
    return {
      appId,
      results,
      infraError: {
        message:
          reportLevelError.error ||
          "Playwright reported a runner-level error. Check the output for details.",
      },
    };
  }

  // 4. Instrumentation (first-run pass-rate + related metrics).
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const inconclusive = results.filter(
    (r) => r.status === "inconclusive",
  ).length;
  sendTelemetryEvent("e2e_tests_run", {
    total: results.length,
    passed,
    failed,
    inconclusive,
    first_run: installed,
    single_file: Boolean(testFile),
    parallel: Boolean(parallel),
  });

  return { appId, results };
}

/**
 * The non-sandboxed path, taken when the sandbox isn't available (Docker/cloud
 * runtime) or the user opted out of it. Keeps the pre-sandbox behavior —
 * bootstrap and run against the normal preview — with the missing runtime
 * isolation disclosed on the result rather than losing E2E testing entirely.
 * Neon apps are the one exception: without a sandbox there is no throwaway
 * branch to point the app at, so the only way to run would be against the
 * user's real database, and this fails closed instead.
 */
async function runTestsAgainstNormalPreview({
  appId,
  disclosure,
  neonRefusal,
  signal,
  emit,
  emitProgress,
  onIsolationCleanupFailed,
  testFile,
  testLine,
  grep,
  headed,
  parallel,
  timeoutMs,
}: {
  appId: number;
  /** Why this run isn't sandboxed, shown on the result's isolation badge. */
  disclosure: string;
  /** Why a Neon app can't run at all here, and what to change. */
  neonRefusal: string;
  signal: AbortSignal;
  emit: (chunk: string, phase: "setup" | "running") => void;
  emitProgress: (
    state: "stopping" | "cleaning-up",
    isolation?: TestIsolation,
  ) => void;
  /**
   * Reports the teardown verdict along with the isolation it belongs to, so the
   * caller's warning can name what actually leaked even when the result it
   * folds the warning into carries no isolation of its own.
   */
  onIsolationCleanupFailed: (failed: boolean, isolation: TestIsolation) => void;
  testFile?: string;
  testLine?: number;
  grep?: string;
  headed?: boolean;
  parallel?: boolean;
  timeoutMs?: number;
}): Promise<RunAppTestsResult> {
  return appOperationCoordinator.run(
    {
      appId,
      operation: "run-app-tests",
      // This path runs Playwright against the user's real working tree and the
      // normal preview, so it claims both — unlike the sandboxed path, which
      // releases the tree after snapshotting and never touches the preview.
      resources: [
        readAppResource("app-path"),
        readAppResource("repository-ref"),
        "repository-worktree",
        "provider",
        "runtime",
        "runtime-config",
        "test-files",
      ],
      allowCompatibleQueueBypass: true,
      refuseWhenRecording: "run tests",
    },
    async () => {
      const app = await getApp(appId);
      // Supabase isolation is provider-side and works in any runtime, so only
      // an app whose isolation depends on the Neon branch swap is refused.
      if (!app.supabaseProjectId && app.neonProjectId) {
        return {
          appId,
          results: [],
          infraError: { message: neonRefusal },
          // NOT `disclosure`: that sentence says the tests ran against the
          // normal preview, and this branch returned before anything ran. A
          // badge asserting an execution that never happened, next to an error
          // saying it didn't, is the wrong-thing copy this work set out to
          // remove.
          isolation: {
            mode: "none" as const,
            reason:
              "No tests ran: Dyad won't run this app's tests against your real database.",
          },
        };
      }

      let prepared: PreparedIsolation | undefined;
      try {
        prepared = await prepareIsolatedTestDatabase({
          app,
          emit,
          // Nothing here depends on the sandbox, and the Neon branch path —
          // the only branch that reads this — was refused above.
          runtimeMode: "host",
          signal,
        });
        // Disclose the missing runtime sandbox, without overwriting a more
        // specific provider reason (e.g. the Supabase publishable-key hint).
        const isolation: TestIsolation = {
          ...prepared.isolation,
          reason: prepared.isolation.reason ?? disclosure,
        };
        if (prepared.infraError) {
          return {
            appId,
            results: [],
            infraError: prepared.infraError,
            isolation,
          };
        }
        const result = await runAppTestsCore({
          appId,
          testFile,
          testLine,
          grep,
          headed,
          parallel,
          signal,
          timeoutMs,
          onOutput: emit,
          testEnv: prepared.testCredentials,
        });
        return { ...result, isolation };
      } finally {
        if (prepared) {
          try {
            if (prepared.isolation.mode !== "none") {
              emitProgress("cleaning-up", prepared.isolation);
            }
            onIsolationCleanupFailed(true, prepared.isolation);
            onIsolationCleanupFailed(
              !(await prepared.teardown()).remoteCleanupCompleted,
              prepared.isolation,
            );
          } catch (error) {
            logger.error(
              `Failed to tear down isolated test environment for app ${appId}: ${error}`,
            );
          }
        }
      }
    },
  );
}

/**
 * Outcome of the sandbox prepare stage. A setup failure is reported as data
 * rather than thrown so the run still resolves to an ordinary `infraError`
 * result — the same classification the non-sandboxed path gives a Playwright
 * bootstrap failure — instead of rejecting the IPC call as an internal
 * exception.
 */
type E2eTestPrepareResult =
  | { installed: boolean; workspace: E2eTestWorkspace; appPath: string }
  | { setupError: string };
// INVARIANT: the two arms are exclusive — a `setupError` never carries a
// workspace. `createE2eTestWorkspace` disposes its own partially-copied tree
// before it throws, which is what makes the caller's early return safe to take
// without a dispose of its own. A future variant that returned both would leak
// a sandbox directory silently, so it must dispose before returning instead.

export interface RunTestsWithIsolationOptions {
  /**
   * The invoking IPC event. Its `sender` is where `tests:output` and
   * `tests:run-state` stream to, and `prepareIsolatedTestDatabase` uses it for
   * its own provider status messages. For the agent tool, pass `ctx.event`.
   */
  event: IpcMainInvokeEvent;
  appId: number;
  testFile?: string;
  testLine?: number;
  /** Regex passed to Playwright's `-g` to narrow the run (agent run_tests). */
  grep?: string;
  headed?: boolean;
  parallel?: boolean;
  timeoutMs?: number;
  /** Stamped onto `tests:run-state` so the panel ignores its own runs. */
  source: "panel" | "agent";
  /**
   * Aborts the run when the caller's own lifecycle ends (e.g. the agent turn is
   * cancelled). Wired into the same AbortController the Stop button uses, so
   * either can cancel the run.
   */
  externalSignal?: AbortSignal;
}

/**
 * Run an app's tests with database isolation, per-app serialization, and Stop
 * support. Wraps `runAppTestsCore` with everything the raw core omits:
 * controller registration in the shared `testRunControllers` map (so the panel
 * Stop button aborts agent-initiated runs too), the per-app lock, isolated
 * test-DB setup + guaranteed teardown, and `tests:output`/`tests:run-state`
 * streaming to the renderer. Backs both the `tests:run` IPC handler (panel Run)
 * and the agent's `run_tests` tool.
 */
export async function runAppTestsWithIsolation({
  event,
  appId,
  testFile,
  testLine,
  grep,
  headed,
  parallel,
  timeoutMs,
  source,
  externalSignal,
}: RunTestsWithIsolationOptions): Promise<RunAppTestsResult> {
  const normalizedTestFile =
    testFile === undefined ? undefined : normalizeRunTestFile(testFile);

  // Reject an invalid target before the expensive isolation setup (Neon
  // branch creation, env swap, double dev-server restart) — the same check
  // in runAppTestsCore would otherwise only fire after all of it.
  if (testFile !== undefined && !normalizedTestFile) {
    return {
      appId,
      results: [],
      infraError: { message: `Invalid test file: ${testFile}` },
    };
  }

  // A recording session holds the same per-app lock and isolation; refuse to
  // run rather than queue invisibly behind it.
  if (isRecordingActive(appId)) {
    return {
      appId,
      results: [],
      infraError: {
        message: "Stop the recording session before running tests.",
      },
    };
  }

  // Register this run's controller SYNCHRONOUSLY — before awaiting the prior
  // run's teardown — so a concurrent invocation sees THIS run as its prior
  // and chains behind it. If we awaited before registering, two rapid Run
  // clicks could both capture the same old run as `prior`, both wait for it,
  // then both start isolation setup at once and double-swap the env file.
  const prior = testRunControllers.get(appId);
  const runId = (testRunGenerationByAppId.get(appId) ?? 0) + 1;
  testRunGenerationByAppId.set(appId, runId);

  const controller = new AbortController();
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  testRunControllers.set(appId, { controller, done, runId });

  // Whether this run took a sandbox. Reported on every run-state event so the
  // cleanup copy can name what is actually being removed — the fallback path
  // never creates a workspace, and claiming otherwise is the same class of
  // inaccurate copy this work set out to remove. Declared before the progress
  // emitter below, which an already-cancelled caller can fire synchronously.
  let sandboxed = false;

  /**
   * Progress-only run-state events for the two waits a Stop cannot skip. Both
   * are emitted only while this controller still owns the app, so a late event
   * from a superseded run cannot affect its replacement. Neither carries
   * results — only `finished` is terminal.
   */
  const emitProgress = (
    state: "stopping" | "cleaning-up",
    isolation?: TestIsolation,
  ) => {
    // Starting a replacement run aborts the prior controller too. Those
    // progress events belong to the superseded run and would otherwise pin
    // the replacement panel run at stopping/cleanup because the panel writes
    // its new setup state before the IPC invocation reaches main.
    if (testRunControllers.get(appId)?.runId !== runId) return;
    emitRunState(event, {
      appId,
      runId,
      source,
      state,
      wasStopped: controller.signal.aborted,
      testFile: normalizedTestFile ?? undefined,
      testLine,
      grep,
      // Only `cleaning-up` carries this so the UI can name the remote provider
      // cleanup accurately. The normal preview is not restarted.
      isolation,
      sandboxed,
    });
  };

  // Announce the kill the moment either Stop path fires. The panel button and
  // the agent turn's cancellation both land on this one controller, so a single
  // listener covers both surfaces. Registered BEFORE the external-signal wiring
  // below, which can abort synchronously when the caller is already cancelled.
  // `started` is published before that wiring, so progress always follows the
  // generation it belongs to in a live renderer.
  controller.signal.addEventListener("abort", () => emitProgress("stopping"), {
    once: true,
  });

  // Publish the new generation before it waits for the prior teardown. A Stop
  // can target this queued run immediately; the renderer must know that its
  // progress belongs to the replacement rather than dropping it behind the
  // prior run's later phase. Output and terminal events carry the same runId,
  // so the prior lifecycle can safely finish after this announcement.
  emitRunState(event, {
    appId,
    runId,
    source,
    state: "started",
    testFile: normalizedTestFile ?? undefined,
    testLine,
    grep,
  });

  // Install and announce the new owner before aborting the prior run. Its
  // abort listener is synchronous, so stale progress can see that ownership
  // moved and stay out of the replacement run's renderer state.
  prior?.controller.abort();

  // Cancelling the caller's lifecycle (e.g. the agent turn) aborts the run,
  // just like the Stop button does via the same controller.
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort);
    }
  }

  /**
   * Set once this run has a sandbox. Everything Playwright prints — spec
   * locations in the list reporter's output, stack frames in failure text — is
   * rooted at the throwaway copy, which is deleted seconds after the run ends.
   * Pointing those back at the real app keeps the output drawer's locations
   * openable, and keeps the agent (whose `read_file` rejects anything outside
   * the app directory) from being sent somewhere it cannot reach.
   *
   * Best-effort on the streamed side: a path split across two chunks survives
   * unrewritten. The parsed results below are rewritten whole.
   */
  let sandboxPathRewrite: { from: string; to: string } | undefined;
  const rewriteSandboxPaths = (text: string) =>
    sandboxPathRewrite
      ? text.replaceAll(sandboxPathRewrite.from, sandboxPathRewrite.to)
      : text;

  const emit = (chunk: string, phase: "setup" | "running") =>
    emitOutput(event, appId, runId, rewriteSandboxPaths(chunk), phase);

  let finalResult: RunAppTestsResult = { appId, results: [] };
  let workspace: E2eTestWorkspace | undefined;
  // The real env is never changed. This only reports a sandbox/provider cleanup
  // failure (for example, a temporary Neon branch left for startup recovery).
  let isolationCleanupFailed = false;
  /**
   * Which provider actually has something left over, recorded where the
   * teardown verdict is. Read in preference to `finalResult.isolation`, which
   * both outer-catch results — the abort and the unexpected failure — build
   * without one, even though the run stage's `finally` has already set the flag
   * by then. Reporting a leaked Supabase auth user as "the isolated test
   * database" is the same wrong-thing copy this work set out to remove.
   */
  let cleanupIsolationMode: TestIsolation["mode"] | undefined;
  /**
   * Fold failed provider cleanup into a result. Applied on both exits so an
   * unexpected rejection cannot hide a temporary branch left for recovery.
   */
  const withIsolationCleanupWarning = (
    result: RunAppTestsResult,
  ): RunAppTestsResult => {
    if (!isolationCleanupFailed) return result;
    // Names what was actually left behind. The Neon path leaks a temporary
    // branch, the Supabase path a temporary auth user in the user's real
    // project — calling that second one "the isolated test database" is the
    // same class of wrong-thing copy this work set out to remove. Both are
    // retried by their own startup sweep (`reconcileOrphanTestBranches`,
    // `reconcileOrphanTestUsers`), so both say so.
    const restoreMessage =
      (cleanupIsolationMode ?? result.isolation?.mode) === "supabase-test-user"
        ? "Dyad couldn't delete the temporary test user it created in your Supabase project. Your app settings were not changed; Dyad will retry the deletion on next startup."
        : "Dyad couldn't finish cleaning up the isolated test database. Your app settings were not changed; Dyad will retry remote cleanup on next startup.";
    return {
      ...result,
      // Appended rather than substituted: an isolation-setup failure explains
      // why the run produced nothing, and replacing it would hide that.
      infraError: {
        message: result.infraError
          ? `${result.infraError.message}\n\n${restoreMessage}`
          : restoreMessage,
      },
    };
  };
  try {
    // Wait for the prior run's full lifecycle (prepare → run → teardown) to
    // finish before swapping env. Otherwise a Stop-then-Run could race the
    // prior run's teardown (env restore + branch delete) against this run's
    // env snapshot/swap, causing tests to execute against the real database.
    if (prior) {
      await prior.done.catch(() => {});
    }

    // The database lookup intentionally happens only after this run registered
    // above. Keeping every await behind registration ensures a rapid second
    // invocation chains behind this run instead of racing its isolation setup
    // and env-file swap.
    const guardApp = await getApp(appId);

    // Decide both refusals BEFORE the workspace stage. `ensurePlaywrightBootstrap`
    // is not read-only — it installs `@playwright/test` into the user's real
    // project, writes Dyad's config, and can download a browser — and the
    // snapshot then copies the whole app plus `node_modules`. Neither may run
    // for a run that is about to be turned away.
    if (!guardApp.testingEnabled) {
      finalResult = {
        appId,
        results: [],
        infraError: {
          message:
            "Testing isn't enabled for this app. Enable it in the Tests panel before running tests.",
        },
      };
      return finalResult;
    }

    // The sandbox is host-only for now, and snapshotting the app plus its
    // node_modules is a real copy on filesystems without reflink support — so
    // the user gets an explicit opt-out. Both routes take the same
    // non-sandboxed path, and both fail closed for Neon rather than running
    // against the user's real database.
    const settings = readSettings();
    const runtimeMode = settings.runtimeMode2 ?? "host";
    const sandboxUnavailable = usesSandboxedE2eTests(settings)
      ? null
      : runtimeMode !== "host"
        ? {
            disclosure: `Tests run against your normal preview because isolated test servers aren't available in ${runtimeMode} runtime yet.`,
            neonRefusal: `Isolated E2E test servers aren't available in ${runtimeMode} runtime yet, and Dyad won't run Neon tests against your real database. Switch to host runtime to run tests for this app.`,
          }
        : {
            disclosure:
              "Tests run against your normal preview because isolated test servers are turned off in Settings.",
            neonRefusal:
              "Isolated test servers are turned off in Settings, and Dyad won't run Neon tests against your real database. Turn them back on to run tests for this app.",
          };
    if (sandboxUnavailable) {
      finalResult = withIsolationCleanupWarning(
        await runTestsAgainstNormalPreview({
          appId,
          ...sandboxUnavailable,
          signal: controller.signal,
          emit,
          emitProgress,
          onIsolationCleanupFailed: (failed, isolation) => {
            isolationCleanupFailed = failed;
            cleanupIsolationMode = isolation.mode;
          },
          testFile: normalizedTestFile ?? undefined,
          testLine,
          grep,
          headed,
          parallel,
          timeoutMs,
        }),
      );
      return finalResult;
    }

    // Bootstrap and snapshot under the real working-tree claim, then release it
    // before Playwright runs so ordinary app editing can continue against the
    // normal preview while this run uses its captured filesystem state.
    const prepareResult = await appOperationCoordinator.run(
      {
        appId,
        operation: "prepare-e2e-test-workspace",
        resources: [
          readAppResource("app-path"),
          readAppResource("repository-ref"),
          "repository-worktree",
          "test-files",
        ],
        // Same as the run stage below: while this waits behind, say, a git
        // operation holding `repository-worktree`, an unrelated operation that
        // only conflicts with this one on `test-files` should still proceed
        // rather than queue behind a test run it has no reason to wait for.
        allowCompatibleQueueBypass: true,
        refuseWhenRecording: "run tests",
      },
      async (): Promise<E2eTestPrepareResult> => {
        const claimedApp = await getApp(appId);
        const realAppPath = getDyadAppPath(claimedApp.path);
        try {
          const { installed } = await ensurePlaywrightBootstrap({
            appPath: realAppPath,
            signal: controller.signal,
            onOutput: (chunk) => emit(chunk, "setup"),
          });
          emit("Copying the app into an isolated test workspace…\n", "setup");
          return {
            installed,
            appPath: realAppPath,
            workspace: await createE2eTestWorkspace({
              appId,
              appPath: realAppPath,
              hasCustomCommands: hasCustomE2eStartCommand(claimedApp),
              signal: controller.signal,
              onProgress: (message) => emit(message, "setup"),
            }),
          };
        } catch (error) {
          // A Stop is not a setup failure — let it reach the outer catch, which
          // turns it into the same "Test run stopped." result the in-run Stop
          // path produces.
          if (controller.signal.aborted) throw error;
          // Everything else here — a Playwright install that can't reach the
          // registry, a browser download that fails, a missing `node_modules`,
          // a full disk — is an environment problem the user acts on, exactly
          // like the bootstrap failure `runAppTestsCore` already reports as an
          // `infraError`. Letting it escape instead would reject the IPC call,
          // record an internal product exception, and (for the agent) throw out
          // of the turn rather than count as a non-attempt infra failure.
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(
            `Isolated E2E test setup failed for app ${appId}: ${message}`,
          );
          return { setupError: message };
        }
      },
    );
    if ("setupError" in prepareResult) {
      finalResult = withIsolationCleanupWarning({
        appId,
        results: [],
        infraError: { message: prepareResult.setupError },
      });
      return finalResult;
    }
    workspace = prepareResult.workspace;
    sandboxPathRewrite = {
      from: workspace.workspacePath,
      to: prepareResult.appPath,
    };
    // Set here, not when the route was chosen: this flag drives the cleanup
    // copy, and a run whose setup failed has no sandbox to claim Dyad is
    // deleting. Recorded once rather than re-read later, because the setting
    // can change while the run is in flight and the copy has to describe what
    // this run actually did.
    sandboxed = true;

    // The live test only owns provider/test inputs. It deliberately does not
    // claim the normal runtime or runtime-config: its process is run-scoped and
    // never registered in runningApps.
    const testRunResources = [
      readAppResource("app-path"),
      "provider",
      "test-files",
    ] as const;
    if (appOperationCoordinator.isBusy(appId, testRunResources)) {
      logger.info(
        `Test run for app ${appId} is waiting for another app operation to finish before isolation setup`,
      );
      emit(
        "Waiting for a previous test cleanup or app operation to finish…\n",
        "setup",
      );
    }
    finalResult = await appOperationCoordinator.run(
      {
        appId,
        operation: "run-app-tests",
        resources: testRunResources,
        allowCompatibleQueueBypass: true,
        // The preflight above avoids registering/cancelling test controllers
        // when a recording already exists, but a session can start during any
        // of the awaits before admission. Refuse atomically here as well so the
        // run never queues behind that session's whole-lifetime claims.
        refuseWhenRecording: "run tests",
      },
      async () => {
        let prepared: PreparedIsolation | undefined;
        let testRuntime: E2eTestRuntime | undefined;
        try {
          const app = await getApp(appId);

          // Re-checked under this claim: the two stages take separate claims,
          // so testing can be turned off between the snapshot and the run.
          if (!app.testingEnabled) {
            return {
              appId,
              results: [],
              infraError: {
                message:
                  "Testing isn't enabled for this app. Enable it in the Tests panel before running tests.",
              },
            };
          }

          // Set up isolation so the run never mutates the user's real data:
          // Neon apps get a throwaway copy-on-write branch, Supabase apps get
          // a throwaway RLS-scoped test user, and no-DB apps run as-is.
          prepared = await prepareE2eTestDataIsolation({
            app,
            workspacePath: workspace!.workspacePath,
            emit,
            signal: controller.signal,
          });

          // Isolation was required but couldn't be set up — dead-end safely
          // rather than run against real data. teardown still runs in `finally`.
          if (prepared.infraError) {
            return {
              appId,
              results: [],
              infraError: prepared.infraError,
              isolation: prepared.isolation,
            };
          }

          emit("Starting the isolated test server…\n", "setup");
          testRuntime = await startE2eTestRuntime({
            workspacePath: workspace!.workspacePath,
            installCommand: app.installCommand,
            startCommand: app.startCommand,
            signal: controller.signal,
            onOutput: (chunk) => emit(chunk, "setup"),
          });

          if (prepared.authorizeRuntimeOrigin) {
            const runtimeOrigin = new URL(testRuntime.baseUrl).origin;
            emit(
              "Authorizing the isolated test server for sign-in…\n",
              "setup",
            );
            try {
              await prepared.authorizeRuntimeOrigin(runtimeOrigin);
            } catch (error) {
              logger.error(
                `Failed to authorize isolated E2E origin ${runtimeOrigin} for app ${appId}: ${error}`,
              );
              return {
                appId,
                results: [],
                infraError: {
                  message:
                    "Dyad couldn't authorize the isolated test server with Neon Auth, so the tests were not run. Check your Neon connection and try again.",
                },
                isolation: prepared.isolation,
              };
            }
          }

          const result = await runAppTestsCore({
            appId,
            appPath: workspace!.workspacePath,
            baseUrl: testRuntime.baseUrl,
            skipBootstrap: true,
            bootstrapInstalled: prepareResult.installed,
            testFile: normalizedTestFile ?? undefined,
            testLine,
            grep,
            headed,
            parallel,
            signal: controller.signal,
            timeoutMs,
            onOutput: emit,
            testEnv: prepared.testCredentials,
          });
          // Best-effort by nature: the run has already produced its results, so
          // a failed copy (a trace file still held by a browser that hasn't
          // fully exited on Windows, a full disk) must cost at most the
          // screenshots — never the whole run. Paths are only rewritten when
          // the artifacts actually made it out of the sandbox; otherwise they
          // are dropped, since the sandbox they point into is deleted moments
          // from now.
          let retained = false;
          try {
            await retainE2eTestArtifacts({
              workspacePath: workspace!.workspacePath,
              artifactPath: workspace!.artifactPath,
              // Only a run-all clears every result in the panel
              // (`applyTestRunStartedAtom`). After a single-file or single-test
              // run, the rows it didn't touch are still on screen with
              // screenshot paths into an earlier run's artifact directory, so
              // that directory must survive this one's prune.
              supersedesAllResults: normalizedTestFile == null,
            });
            retained = true;
          } catch (error) {
            logger.warn(
              `Failed to retain isolated test artifacts for app ${appId}: ${error}`,
            );
          }
          result.results = rewriteResultArtifactPaths(
            result.results,
            workspace!.workspacePath,
            retained ? workspace!.artifactPath : undefined,
            rewriteSandboxPaths,
          );
          return { ...result, isolation: prepared.isolation };
        } finally {
          if (testRuntime) {
            try {
              await testRuntime.stop();
            } catch (error) {
              logger.error(
                `Failed to stop isolated test server for app ${appId}: ${error}`,
              );
            }
          }
          // Always clean up provider isolation, even on an infraError, abort, or
          // throw. The sandbox env can be discarded, but remote branches/users
          // still require their guaranteed teardown.
          if (prepared) {
            try {
              // Announce the teardown before it starts. It removes the
              // temporary branch/user, takes no AbortSignal, and may outlast
              // the process kill because Neon deletion retries with backoff.
              // Skipped for `none`, whose teardown is a NOOP — the sandbox
              // disposal below announces that case instead.
              if (prepared.isolation.mode !== "none") {
                emitProgress("cleaning-up", prepared.isolation);
              }
              cleanupIsolationMode = prepared.isolation.mode;
              isolationCleanupFailed = true;
              // NOT `envRestored`: the sandbox path never rewrites the real
              // `.env.local`, so that flag only reports on a workspace file
              // that is deleted seconds later. A leaked remote branch is the
              // thing this warning actually describes.
              isolationCleanupFailed = !(await prepared.teardown())
                .remoteCleanupCompleted;
            } catch (error) {
              logger.error(
                `Failed to tear down isolated test environment for app ${appId}: ${error}`,
              );
            }
          }
        }
      },
    );
    finalResult = withIsolationCleanupWarning(finalResult);
    return finalResult;
  } catch (error) {
    // A Stop pressed during sandbox setup escapes as a throw — the workspace
    // copy and the test-server start both signal cancellation that way. That's
    // an ordinary user cancellation, not an infrastructure failure: return the
    // same structured result the in-run Stop path produces instead of rejecting
    // the IPC call and recording an internal product exception for it.
    if (controller.signal.aborted) {
      finalResult = withIsolationCleanupWarning({
        appId,
        results: [],
        infraError: { message: "Test run stopped." },
      });
      return finalResult;
    }
    // Surface an unexpected failure as an infra error on the run-state event so
    // the panel leaves its spinner state, then rethrow for the caller.
    finalResult = withIsolationCleanupWarning({
      appId,
      results: [],
      infraError: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
    // Anything reaching here is a test-infrastructure failure (isolation setup,
    // teardown, spawn), not a product exception — classify it so telemetry
    // routes it by kind instead of counting it as unclassified.
    throw isDyadError(error)
      ? error
      : new DyadError(finalResult.infraError!.message, DyadErrorKind.Internal, {
          cause: error,
        });
  } finally {
    if (workspace) {
      // Deleting a cloned node_modules tree is tens of thousands of unlinks —
      // slowest on Windows, where the copy was a real one. The results are
      // already computed but the panel still has Run/Record/Delete disabled
      // until `finished`, so label the wait for every isolation mode instead of
      // leaving it unexplained (the provider teardown above only announces
      // itself when there was provider state to remove).
      emitProgress("cleaning-up", finalResult.isolation);
      try {
        await workspace.dispose();
      } catch (error) {
        logger.error(
          `Failed to remove isolated test workspace for app ${appId}: ${error}`,
        );
      }
    }
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
    emitRunState(event, {
      appId,
      runId,
      source,
      state: "finished",
      testFile: normalizedTestFile ?? undefined,
      testLine,
      grep,
      results: source === "agent" ? finalResult.results : undefined,
      infraError: source === "agent" ? finalResult.infraError : undefined,
      isolation: finalResult.isolation,
      sandboxed,
    });
    // A teardown failure must not skip the cleanup below — leaving the
    // controller registered and `done` unresolved would make every future
    // run for this app wait forever on `prior.done`.
    if (testRunControllers.get(appId)?.controller === controller) {
      testRunControllers.delete(appId);
    }
    // Signal the next queued run that this lifecycle (incl. teardown) is done.
    resolveDone();
  }
}

/**
 * Move a file, falling back to copy+unlink across devices (EXDEV, e.g.
 * different drives on Windows). Mirrors the media-file move handler.
 */
async function moveFileWithFallback(src: string, dst: string): Promise<void> {
  try {
    await fs.promises.rename(src, dst);
  } catch (error: any) {
    if (error?.code !== "EXDEV") {
      throw error;
    }
    await fs.promises.copyFile(src, dst);
    try {
      await fs.promises.unlink(src);
    } catch (unlinkError) {
      // Source delete failed after the copy succeeded — remove the copy so we
      // don't leave a duplicate behind.
      try {
        await fs.promises.unlink(dst);
      } catch {
        // Best-effort cleanup; destination may already be gone.
      }
      throw unlinkError;
    }
  }
}

export function registerTestsHandlers() {
  createTypedHandler(testsContracts.listAppTests, async (_event, params) => {
    const app = await getApp(params.appId);
    const appPath = getDyadAppPath(app.path);
    const matches = await listSpecFiles(appPath);
    const specs = await Promise.all(
      matches.map(async (file) => ({
        file,
        tests: await readSpecTestCases(appPath, file),
      })),
    );
    return { specs };
  });

  createTypedHandler(testsContracts.stopAppTests, async (_event, params) => {
    testRunControllers.get(params.appId)?.controller.abort();
    return { ok: true as const };
  });

  createTypedHandler(
    testsContracts.getTestScreenshot,
    async (_event, params) => {
      const app = await getApp(params.appId);
      const appPath = getDyadAppPath(app.path);
      return {
        dataUrl: await readTestScreenshotDataUrl(
          appPath,
          params.path,
          params.appId,
        ),
      };
    },
  );

  createTypedHandler(
    testsContracts.runAppTests,
    async (event, params): Promise<RunAppTestsResult> => {
      return runAppTestsWithIsolation({ event, source: "panel", ...params });
    },
  );

  createTypedHandler(testsContracts.deleteAppTest, async (_event, params) => {
    const app = await getApp(params.appId);
    const appPath = getDyadAppPath(app.path);
    // Only ever delete something that looks like one of the spec paths
    // `listAppTests` produces — the same guard the runner uses, so a
    // compromised renderer can't turn this into an arbitrary file delete.
    const testFile = normalizeRunTestFile(params.testFile);
    if (!testFile) {
      throw new DyadError(
        `Invalid test file: ${params.testFile}`,
        DyadErrorKind.Validation,
      );
    }

    // Same per-app lock the runs take, so a delete can't remove a spec out
    // from under an in-flight run (or interleave with its env swap).
    //
    // A recording holds `repository`/`test-files` for its whole session, so
    // without the refusal the coordinator would queue the delete behind it — up
    // to the 30-minute cap, with the Tests panel showing nothing but a spinner.
    return await appOperationCoordinator.run(
      {
        appId: params.appId,
        operation: "delete-app-test",
        resources: [readAppResource("app-path"), "repository", "test-files"],
        refuseWhenRecording: "delete a test",
      },
      async () => {
        // Canonical check on top of the pattern match: a symlinked `e2e-tests/`
        // (or a symlinked spec) must not let the delete escape the app folder.
        await assertMutationPathAllowed({
          appPath,
          relativePath: testFile,
          followFinalSymlink: false,
        });
        const fullPath = safeJoin(appPath, testFile);
        // Confirm the spec is actually there before touching git, so a stale row
        // in the panel reports "not found" instead of committing a phantom
        // deletion for a path that was already removed elsewhere.
        try {
          await fs.promises.lstat(fullPath);
        } catch (error: any) {
          if (error?.code === "ENOENT") {
            throw new DyadError(
              `Test file not found: ${testFile}`,
              DyadErrorKind.NotFound,
            );
          }
          throw error;
        }
        // Commit just this deletion, so deleting a test doesn't leave the user
        // with an uncommitted change to review (and the deletion lands in version
        // history, where it can be restored from). `git rm` removes the file from
        // disk and stages that removal in one step: unlinking first would leave a
        // window where an editor or agent write could recreate the path, only for
        // `git rm -f` to delete the new content without a second confirmation.
        // Best-effort by design: a git failure (untracked file, non-repo app)
        // must not report the delete itself as failed. We surface whether it was
        // committed so the UI doesn't promise a recovery path that may not exist.
        const { commitHash, uncommittedReason } =
          await gitService.removeFileAndCommit({
            path: appPath,
            filepath: testFile,
            message: `delete test ${testFile}`,
          });
        if (uncommittedReason === "untracked") {
          // Git removed nothing (untracked spec, or the app isn't a repo), so the
          // file is still on disk and it's on us to delete it.
          try {
            await fs.promises.unlink(fullPath);
          } catch (error: any) {
            if (error?.code !== "ENOENT") {
              throw error;
            }
          }
        }
        queueCloudSandboxSnapshotSync({
          appId: params.appId,
          deletedPaths: [testFile],
        });
        return {
          file: testFile,
          committed: commitHash !== null,
          uncommittedReason,
        };
      },
    );
  });

  createTypedHandler(
    testsContracts.detectLegacyTests,
    async (_event, params) => {
      const app = await getApp(params.appId);
      const appPath = getDyadAppPath(app.path);
      const specs = await detectLegacyPlaywrightSpecs(appPath);
      const files = specs.map((file) => ({
        file,
        targetExists: fs.existsSync(safeJoin(appPath, legacyToE2ePath(file))),
      }));
      return { files };
    },
  );

  createTypedHandler(
    testsContracts.migrateLegacyTests,
    async (_event, params) => {
      const app = await getApp(params.appId);
      const appPath = getDyadAppPath(app.path);
      // Serialize against test runs (same numeric appId lock) so a move can't
      // interleave with a run's env swap / dev-server restart.
      //
      // Same claim conflict as `deleteAppTest`: refuse with a reason rather than
      // queueing the migration behind the recording's `test-files` hold.
      return await appOperationCoordinator.run(
        {
          appId: params.appId,
          operation: "migrate-legacy-tests",
          resources: [readAppResource("app-path"), "repository", "test-files"],
          refuseWhenRecording: "migrate legacy tests",
        },
        async () => {
          const results: MigrateLegacyTestResult[] = [];

          // Validate + normalize the requested specs up front; invalid ones are
          // reported and excluded from the move plan. Deduplicate so the same
          // path submitted twice doesn't produce a spurious second failure.
          const validSpecs: string[] = [];
          const seenSpecs = new Set<string>();
          for (const requested of params.files) {
            const sourceRel = normalizeLegacyTestFile(requested);
            if (!sourceRel) {
              results.push({
                file: requested,
                ok: false,
                error: "Not a valid tests/*.spec.{ts,tsx,js,jsx} path",
              });
              continue;
            }
            if (seenSpecs.has(sourceRel)) {
              continue; // Duplicate request; already accounted for.
            }
            seenSpecs.add(sourceRel);
            validSpecs.push(sourceRel);
          }

          // Only ever move files detection actually classified as legacy
          // Playwright specs, regardless of what the renderer submitted — a
          // valid-looking path alone must not move an unrelated tests/ spec.
          const detected = new Set(await detectLegacyPlaywrightSpecs(appPath));
          const plannableSpecs: string[] = [];
          for (const sourceRel of validSpecs) {
            if (detected.has(sourceRel)) {
              plannableSpecs.push(sourceRel);
            } else {
              results.push({
                file: sourceRel,
                ok: false,
                error: "Not a Playwright spec in tests/",
              });
            }
          }

          // Move one tests/ file into e2e-tests/ (git-aware, never overwriting).
          // Both paths are canonically validated (`assertMutationPathAllowed`) so
          // a symlinked e2e-tests/ can't redirect the write outside the app.
          const moveOne = async (
            sourceRel: string,
          ): Promise<{ ok: boolean; movedTo?: string; error?: string }> => {
            const destRel = legacyToE2ePath(sourceRel);
            try {
              await assertMutationPathAllowed({
                appPath,
                relativePath: sourceRel,
                followFinalSymlink: false,
              });
              await assertMutationPathAllowed({
                appPath,
                relativePath: destRel,
                followFinalSymlink: false,
              });
              const src = safeJoin(appPath, sourceRel);
              const dst = safeJoin(appPath, destRel);
              if (!fs.existsSync(src)) {
                return { ok: false, error: "Source file no longer exists" };
              }
              if (fs.existsSync(dst)) {
                // Never overwrite an existing destination.
                return { ok: false, error: `${destRel} already exists` };
              }
              await fs.promises.mkdir(path.dirname(dst), { recursive: true });
              await moveFileWithFallback(src, dst);
              // Stage the move (add new, remove old) without committing, so the
              // user reviews it through the normal uncommitted-changes flow.
              // Staging is best-effort: the file has already moved on disk, so a
              // git failure (lock contention, untracked source, non-repo app)
              // must not report the move itself as failed.
              try {
                await gitAdd({ path: appPath, filepath: destRel });
              } catch (error) {
                logger.warn(
                  `Moved ${sourceRel} but couldn't git-add ${destRel}: ${error}`,
                );
              }
              try {
                await gitRemove({ path: appPath, filepath: sourceRel });
              } catch (error) {
                // The source may be untracked (never committed); the file is
                // already gone from disk, so staging the new one is enough.
                logger.warn(
                  `Moved ${sourceRel} but couldn't git-remove it (likely untracked): ${error}`,
                );
              }
              return { ok: true, movedTo: destRel };
            } catch (error) {
              logger.warn(`Failed to migrate ${sourceRel}: ${error}`);
              return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          };

          // Plan by connected component: a spec is moved only when its whole
          // import group can move (no shared fixture or dependency left behind,
          // no destination collision). Specs that can't move are reported as
          // blocked rather than migrated into a broken state.
          const plan =
            plannableSpecs.length > 0
              ? await planLegacyMigration(appPath, plannableSpecs)
              : {
                  movableSpecs: [] as string[],
                  supportFiles: [] as string[],
                  blockedSpecs: [] as { file: string; reason: string }[],
                  skippedSupportFiles: [] as string[],
                };

          // Move support files first so a spec never lands beside a fixture that
          // hasn't moved yet.
          const movedSupportFiles: string[] = [];
          const skippedSupportFiles = [...plan.skippedSupportFiles];
          for (const support of plan.supportFiles) {
            const outcome = await moveOne(support);
            if (outcome.ok && outcome.movedTo) {
              movedSupportFiles.push(outcome.movedTo);
            } else {
              skippedSupportFiles.push(support);
            }
          }

          // Move the specs that planned cleanly.
          for (const sourceRel of plan.movableSpecs) {
            const outcome = await moveOne(sourceRel);
            results.push({
              file: sourceRel,
              ok: outcome.ok,
              movedTo: outcome.movedTo,
              error: outcome.error,
            });
          }

          // Report specs that couldn't move without breaking an import.
          for (const blocked of plan.blockedSpecs) {
            results.push({
              file: blocked.file,
              ok: false,
              error: blocked.reason,
            });
          }

          return {
            results,
            movedSupportFiles,
            skippedSupportFiles: [...new Set(skippedSupportFiles)].sort(
              (a, b) => a.localeCompare(b),
            ),
          };
        },
      );
    },
  );

  logger.debug("Registered tests IPC handlers");
}
