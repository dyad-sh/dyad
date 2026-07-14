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
  TEST_SPEC_EXT_ALTERNATION,
  TEST_SPEC_GLOB,
  testsContracts,
} from "../types/tests";
import type {
  RunAppTestsResult,
  TestCase,
  TestResult,
  TestsRunStatePayload,
} from "../types/tests";
import { runningApps } from "../utils/process_manager";
import { isLockHeld, withLock } from "../utils/lock_utils";
import { safeSend } from "../utils/safe_sender";
import { spawnStreaming } from "../utils/spawn_streaming";
import {
  ensurePlaywrightBootstrap,
  TEST_BASE_URL_ENV,
  TEST_RESULTS_JSON,
} from "../utils/playwright_bootstrap";
import {
  parsePlaywrightReport,
  PLAYWRIGHT_REPORT_ERROR_FILE,
} from "../utils/playwright_report";
import { parseTestCases } from "../utils/parse_test_cases";
import { getPackageManagerCommandEnv } from "../utils/socket_firewall";
import { sendTelemetryEvent } from "../utils/telemetry";
import {
  prepareIsolatedTestDatabase,
  type PreparedIsolation,
} from "../services/isolated_test_db";
import { readTestScreenshotDataUrl } from "../utils/test_screenshot";
import { readSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("tests_handlers");

// A test file must look like the spec paths `listAppTests` produces: relative,
// under `tests/`, ending in a spec extension, with no traversal or leading
// dash. This stops a compromised renderer from passing a flag-like value
// (e.g. `--config=…`) that Playwright would interpret as a CLI option. The
// allowed characters must cover everything the listing glob can surface
// (spaces, `@`, parentheses, non-ASCII letters), so the guards are negative:
// no `..`, no segment starting with `-`, and no backslash, colon (reserved for
// the `file:line` selector), or control characters.
const TEST_FILE_PATTERN = new RegExp(
  `^tests/(?!.*\\.\\.)(?!(?:-|.*/-))[^\\\\:\\x00-\\x1f]+\\.spec\\.(${TEST_SPEC_EXT_ALTERNATION})$`,
);

export function normalizeRunTestFile(testFile: string): string | null {
  const normalized = path.posix.normalize(testFile.replace(/\\/g, "/"));
  return TEST_FILE_PATTERN.test(normalized) ? normalized : null;
}

function isNoTestsFoundOutput(output: string): boolean {
  return /\bno tests found\b/i.test(output);
}

/**
 * The relative paths of every spec under the app's `tests/` folder, sorted.
 * Shared by the Tests panel listing and the agent's run_tests tool (so a
 * mistyped target can be answered with the paths that actually exist).
 */
export async function listSpecFiles(appPath: string): Promise<string[]> {
  const testsDir = path.join(appPath, "tests");
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
}
const testRunControllers = new Map<number, TestRun>();

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
  chunk: string,
  phase: "setup" | "running",
): void {
  safeSend(event.sender, "tests:output", { appId, chunk, phase });
}

function emitRunState(
  event: IpcMainInvokeEvent,
  payload: TestsRunStatePayload,
): void {
  safeSend(event.sender, "tests:run-state", payload);
}

export interface RunAppTestsCoreOptions {
  appId: number;
  /** When set, runs a single spec file (relative path); otherwise runs all. */
  testFile?: string;
  /**
   * When set (with testFile), runs only the test at this 1-based line via
   * Playwright's `file:line` selector.
   */
  testLine?: number;
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
 * Bootstrap Playwright (if needed), run the tests against the running dev
 * server's proxy URL, and parse the JSON report. Backs the `tests:run` IPC
 * handler (the UI "Run" button).
 */
export async function runAppTestsCore({
  appId,
  testFile,
  testLine,
  headed,
  parallel,
  signal,
  timeoutMs,
  onOutput,
  testEnv,
}: RunAppTestsCoreOptions): Promise<RunAppTestsResult> {
  const app = await getApp(appId);
  const appPath = getDyadAppPath(app.path);
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
  const baseUrl = getRunningTestBaseUrl(appId);
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
  let installed = false;
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
  const args = ["playwright", "test"];
  if (normalizedTestFile) {
    const target =
      testLine && Number.isInteger(testLine) && testLine > 0
        ? `${normalizedTestFile}:${testLine}`
        : normalizedTestFile;
    args.push(target);
  } else {
    // Existing user configs can point at a different testDir. Dyad's panel only
    // lists specs under tests/, so an all-run must target that directory
    // explicitly instead of executing every spec the user's config knows about.
    args.push("tests/");
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

  // Register this run's controller SYNCHRONOUSLY — before awaiting the prior
  // run's teardown — so a concurrent invocation sees THIS run as its prior
  // and chains behind it. If we awaited before registering, two rapid Run
  // clicks could both capture the same old run as `prior`, both wait for it,
  // then both start isolation setup at once and double-swap the env file.
  const prior = testRunControllers.get(appId);
  prior?.controller.abort();

  const controller = new AbortController();
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  testRunControllers.set(appId, { controller, done });

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

  const emit = (chunk: string, phase: "setup" | "running") =>
    emitOutput(event, appId, chunk, phase);

  let finalResult: RunAppTestsResult = { appId, results: [] };
  try {
    // Wait for the prior run's full lifecycle (prepare → run → teardown) to
    // finish before swapping env. Otherwise a Stop-then-Run could race the
    // prior run's teardown (env restore + branch delete) against this run's
    // env snapshot/swap, causing tests to execute against the real database.
    if (prior) {
      await prior.done.catch(() => {});
    }

    // Emit "started" only after the prior lifecycle has fully drained: the
    // prior run's `finally` emits its "finished" event during teardown, and
    // announcing this run first would let that stale "finished" flip the
    // panel back to idle while this run is still executing.
    emitRunState(event, {
      appId,
      source,
      state: "started",
      testFile: normalizedTestFile ?? undefined,
      testLine,
    });

    // Hold the per-app lock across the whole isolation lifecycle (prepare →
    // run → teardown). Startup reconciliation (reconcileOrphanTestBranches /
    // reconcileOrphanTestUsers) takes the same lock, so a rapid Run right
    // after launch can't interleave its env swap + dev-server restart with
    // an in-flight reconciliation and end up running against the real DB.
    if (isLockHeld(appId)) {
      logger.info(
        `Test run for app ${appId} is waiting for another app operation to finish before isolation setup`,
      );
      emit(
        "Waiting for a previous test cleanup or app operation to finish…\n",
        "setup",
      );
    }
    finalResult = await withLock(appId, async () => {
      let prepared: PreparedIsolation | undefined;
      try {
        const app = await getApp(appId);

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

        const runtimeMode = readSettings().runtimeMode2 ?? "host";

        // Set up isolation so the run never mutates the user's real data:
        // Neon apps get a throwaway copy-on-write branch, Supabase apps get
        // a throwaway RLS-scoped test user, and no-DB apps run as-is.
        prepared = await prepareIsolatedTestDatabase({
          app,
          event,
          emit,
          runtimeMode,
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

        const result = await runAppTestsCore({
          appId,
          testFile: normalizedTestFile ?? undefined,
          testLine,
          headed,
          parallel,
          signal: controller.signal,
          timeoutMs,
          onOutput: emit,
          testEnv: prepared.testCredentials,
        });
        return { ...result, isolation: prepared.isolation };
      } finally {
        // Always restore the app to its real database, even on the
        // infraError early-return, abort, or throw. `teardown` is safe to
        // call exactly once; on the infraError path it's a NOOP (isolation
        // already restored).
        if (prepared) {
          try {
            await prepared.teardown();
          } catch (error) {
            logger.error(
              `Failed to tear down isolated test environment for app ${appId}: ${error}`,
            );
          }
        }
      }
    });
    return finalResult;
  } catch (error) {
    // Surface an unexpected failure as an infra error on the run-state event so
    // the panel leaves its spinner state, then rethrow for the caller.
    finalResult = {
      appId,
      results: [],
      infraError: {
        message: error instanceof Error ? error.message : String(error),
      },
    };
    throw error;
  } finally {
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
    emitRunState(event, {
      appId,
      source,
      state: "finished",
      testFile: normalizedTestFile ?? undefined,
      testLine,
      results: finalResult.results,
      infraError: finalResult.infraError,
      isolation: finalResult.isolation,
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
      return { dataUrl: readTestScreenshotDataUrl(appPath, params.path) };
    },
  );

  createTypedHandler(
    testsContracts.runAppTests,
    async (event, params): Promise<RunAppTestsResult> => {
      return runAppTestsWithIsolation({ event, source: "panel", ...params });
    },
  );

  logger.debug("Registered tests IPC handlers");
}
