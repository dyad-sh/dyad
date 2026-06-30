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
import { testsContracts } from "../types/tests";
import type { RunAppTestsResult, TestCase, TestResult } from "../types/tests";
import { runningApps } from "../utils/process_manager";
import { safeSend } from "../utils/safe_sender";
import { spawnStreaming } from "../utils/spawn_streaming";
import {
  ensurePlaywrightBootstrap,
  TEST_BASE_URL_ENV,
  TEST_RESULTS_JSON,
} from "../utils/playwright_bootstrap";
import { parsePlaywrightReport } from "../utils/playwright_report";
import { parseTestCases } from "../utils/parse_test_cases";
import { sendTelemetryEvent } from "../utils/telemetry";
import { prepareIsolatedTestDatabase } from "../services/isolated_test_db";
import { readSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("tests_handlers");

// A test file must look exactly like the spec paths `listAppTests` produces:
// relative, under `tests/`, ending in a spec extension, with no traversal or
// leading dash. This stops a compromised renderer from passing a flag-like
// value (e.g. `--config=…`) that Playwright would interpret as a CLI option.
const TEST_FILE_PATTERN = /^tests\/(?!.*\.\.)[\w\-./]+\.spec\.(ts|tsx|js|jsx)$/;

/**
 * Worker count for a parallel run. Derived from the host's cores (leaving one
 * free), capped so we don't overwhelm the single dev server the tests share.
 */
function parallelWorkerCount(): number {
  const cores = os.cpus()?.length ?? 2;
  return Math.max(2, Math.min(cores - 1, 8));
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
function getRunningBaseUrl(appId: number): string | null {
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
  onOutput,
  testEnv,
}: RunAppTestsCoreOptions): Promise<RunAppTestsResult> {
  const app = await getApp(appId);
  const appPath = getDyadAppPath(app.path);
  const emit = (chunk: string, phase: "setup" | "running") =>
    onOutput?.(chunk, phase);

  // Reject anything that doesn't look like one of our spec paths before it
  // reaches the Playwright CLI (the Zod schema only checks it's a string).
  if (testFile !== undefined && !TEST_FILE_PATTERN.test(testFile)) {
    return {
      appId,
      results: [],
      infraError: { message: `Invalid test file: ${testFile}` },
    };
  }

  // Gate: the dev server must be running so baseURL resolves.
  const baseUrl = getRunningBaseUrl(appId);
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
  if (testFile) {
    const target =
      testLine && Number.isInteger(testLine) && testLine > 0
        ? `${testFile}:${testLine}`
        : testFile;
    args.push(target);
  }
  args.push("--reporter=list,json");
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

  const run = await spawnStreaming({
    command: "npx",
    args,
    cwd: appPath,
    env: {
      ...process.env,
      ...testEnv,
      [TEST_BASE_URL_ENV]: baseUrl,
      PLAYWRIGHT_JSON_OUTPUT_NAME: TEST_RESULTS_JSON,
      // Non-interactive: never try to open/serve an HTML report.
      CI: "true",
    },
    signal,
    onOutput: (chunk) => emit(chunk, "running"),
  });

  if (run.aborted) {
    return { appId, results: [], infraError: { message: "Test run stopped." } };
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

  if (!parseOk || results.length === 0) {
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

export function registerTestsHandlers() {
  createTypedHandler(testsContracts.listAppTests, async (_event, params) => {
    const app = await getApp(params.appId);
    const appPath = getDyadAppPath(app.path);
    const testsDir = path.join(appPath, "tests");
    if (!fs.existsSync(testsDir)) {
      return { specs: [] };
    }
    const matches = await glob("tests/**/*.spec.{ts,tsx,js,jsx}", {
      cwd: appPath,
      nodir: true,
      posix: true,
    });
    const specs = await Promise.all(
      matches
        .sort((a, b) => a.localeCompare(b))
        .map(async (file) => {
          let tests: TestCase[] = [];
          try {
            const content = await fs.promises.readFile(
              path.join(appPath, file),
              "utf8",
            );
            tests = parseTestCases(content);
          } catch (error) {
            // A file we can't read/parse still lists as a runnable whole.
            logger.warn(`Failed to parse test cases in ${file}: ${error}`);
          }
          return { file, tests };
        }),
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

      // Security: only read screenshots that live inside this app's directory
      // and are PNGs, so an arbitrary path can't be slurped into the renderer.
      // Playwright reports absolute paths, but resolve relative ones against the
      // app dir just in case.
      const resolved = path.isAbsolute(params.path)
        ? path.resolve(params.path)
        : path.resolve(appPath, params.path);
      if (path.extname(resolved).toLowerCase() !== ".png") {
        return { dataUrl: null };
      }
      if (!fs.existsSync(resolved)) {
        return { dataUrl: null };
      }
      // Resolve symlinks before the containment check: a symlink inside the app
      // dir could otherwise point outside it (e.g. test-results/x.png ->
      // /etc/passwd) and pass a string-only check while the read escapes.
      // Resolve the app path through realpathSync too: ancestor symlinks (e.g.
      // /var -> /private/var on macOS, or a user-configured apps dir) would
      // otherwise leave a `..` prefix and reject every legitimate screenshot.
      let realAppPath: string;
      let realPath: string;
      try {
        realAppPath = fs.realpathSync(appPath);
        realPath = fs.realpathSync(resolved);
      } catch (error) {
        logger.warn(`Failed to resolve screenshot path ${resolved}: ${error}`);
        return { dataUrl: null };
      }
      const rel = path.relative(realAppPath, realPath);
      const insideApp =
        rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
      if (!insideApp) {
        return { dataUrl: null };
      }
      try {
        const buf = fs.readFileSync(realPath);
        return { dataUrl: `data:image/png;base64,${buf.toString("base64")}` };
      } catch (error) {
        logger.warn(`Failed to read screenshot ${realPath}: ${error}`);
        return { dataUrl: null };
      }
    },
  );

  createTypedHandler(
    testsContracts.runAppTests,
    async (event, params): Promise<RunAppTestsResult> => {
      const { appId, testFile, testLine, headed, parallel } = params;

      // Cancel any prior run for this app and wait for its full lifecycle
      // (prepare → run → teardown) to finish before starting. Otherwise a
      // Stop-then-Run could race the prior run's teardown (env restore +
      // branch delete) against this run's env snapshot/swap, causing tests to
      // execute against the user's real database.
      const prior = testRunControllers.get(appId);
      if (prior) {
        prior.controller.abort();
        await prior.done.catch(() => {});
      }

      const controller = new AbortController();
      let resolveDone!: () => void;
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      testRunControllers.set(appId, { controller, done });

      const emit = (chunk: string, phase: "setup" | "running") =>
        emitOutput(event, appId, chunk, phase);

      try {
        const app = await getApp(appId);
        const runtimeMode = readSettings().runtimeMode2 ?? "host";

        // Set up isolation so the run never mutates the user's real data: Neon
        // apps get a throwaway copy-on-write branch, Supabase apps get a
        // throwaway RLS-scoped test user, and no-DB apps run as-is.
        const prepared = await prepareIsolatedTestDatabase({
          app,
          event,
          emit,
          runtimeMode,
          signal: controller.signal,
        });

        // Isolation was required but couldn't be set up — dead-end safely
        // rather than run against real data.
        if (prepared.infraError) {
          return {
            appId,
            results: [],
            infraError: prepared.infraError,
            isolation: prepared.isolation,
          };
        }

        try {
          const result = await runAppTestsCore({
            appId,
            testFile,
            testLine,
            headed,
            parallel,
            signal: controller.signal,
            onOutput: emit,
            testEnv: prepared.testCredentials,
          });
          return { ...result, isolation: prepared.isolation };
        } finally {
          // Always restore the app to its real database, even on abort/throw.
          await prepared.teardown();
        }
      } finally {
        if (testRunControllers.get(appId)?.controller === controller) {
          testRunControllers.delete(appId);
        }
        // Signal the next queued run that this lifecycle (incl. teardown) is done.
        resolveDone();
      }
    },
  );

  logger.debug("Registered tests IPC handlers");
}
