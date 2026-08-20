import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { glob } from "glob";
import log from "electron-log";
import { BrowserWindow } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { resolveRemoteDebuggingEndpoint } from "@/main/remote_debugging";
import {
  beginPreviewAutomation,
  waitForPreviewView,
} from "@/main/preview_web_contents_view";
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
  TestCaseResult,
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
  configSetsTimeout,
  ensurePlaywrightBootstrap,
  DYAD_CONFIG_FILENAME,
  PREVIEW_CDP_ENDPOINT_ENV,
  SLOW_MO_DELAY_MS,
  SLOW_MO_TEST_TIMEOUT_MS,
  TEST_BASE_URL_ENV,
  TEST_RESULTS_JSON,
  TEST_SLOW_MO_ENV,
} from "../utils/playwright_bootstrap";
import {
  aggregateTestResults,
  parsePlaywrightReport,
  PLAYWRIGHT_REPORT_ERROR_FILE,
} from "../utils/playwright_report";
import {
  exactDiscoveredTitleGrep,
  parsePreviewTestDiscovery,
  type DiscoveredPreviewTest,
} from "../utils/playwright_discovery";
import { parseTestCases } from "../utils/parse_test_cases";
import { getPackageManagerCommandEnv } from "../utils/socket_firewall";
import { queueCloudSandboxSnapshotSync } from "../utils/cloud_sandbox_provider";
import { sendTelemetryEvent } from "../utils/telemetry";
import {
  prepareIsolatedTestDatabase,
  type PreparedIsolation,
} from "../services/isolated_test_db";
import { readTestScreenshotDataUrl } from "../utils/test_screenshot";
import { isRecordingActive } from "../services/recording_registry";
import { readSettings } from "@/main/settings";
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
  /**
   * When true, Playwright pauses `SLOW_MO_DELAY_MS` between actions so the user
   * can follow the run. Carried by an env var (Playwright has no CLI flag for
   * it) that the generated config and the preview fixture shim both read, so it
   * applies whether the run drives its own browser or the preview panel.
   */
  slowMo?: boolean;
  /**
   * Called when a preview run turns out not to be one after all (the shim
   * couldn't be routed), so the caller can hand the preview view back instead
   * of holding it frozen for a run happening in another window.
   */
  onPreviewFallback?: () => void;
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
  /**
   * Experimental: CDP endpoint of this Dyad instance. When set, the generated
   * fixture shim connects to it and drives the page already loaded in the
   * preview panel's native view instead of launching a browser, so the user
   * watches the run in place. Tests run sequentially in separate processes and
   * fresh native views; `headed` has no additional meaning.
   */
  previewCdpEndpoint?: string;
  /** Replaces the native preview with a fresh session before/after tests. */
  rotatePreviewView?: (timeoutMs?: number) => Promise<void>;
}

function appendRequestedTestTarget(
  args: string[],
  normalizedTestFile: string | undefined,
  testLine: number | undefined,
): void {
  if (normalizedTestFile) {
    const escapedFile = escapeRegExpForSelector(normalizedTestFile);
    args.push(
      testLine && Number.isInteger(testLine) && testLine > 0
        ? `${escapedFile}:${testLine}`
        : escapedFile,
    );
  } else {
    args.push(`${E2E_TEST_DIR}/`);
  }
}

function aggregatePreviewCases(
  casesByFile: Map<string, TestCaseResult[]>,
): TestResult[] {
  return [...casesByFile.entries()]
    .map(([file, tests]) => {
      tests.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
      return aggregateTestResults(file, tests);
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

function timeoutInfraError(timeoutMs: number | undefined): {
  message: string;
} {
  return {
    message: `The test run exceeded the ${Math.round((timeoutMs ?? 0) / 60000)}-minute limit and was stopped before it could finish.`,
  };
}

async function runPreviewTestBatch({
  appId,
  appPath,
  baseUrl,
  normalizedTestFile,
  testLine,
  grep,
  slowMo,
  signal,
  timeoutMs,
  emit,
  testEnv,
  previewEndpoint,
  rotatePreviewView,
  installed,
}: {
  appId: number;
  appPath: string;
  baseUrl: string;
  normalizedTestFile: string | undefined;
  testLine: number | undefined;
  grep: string | undefined;
  slowMo: boolean | undefined;
  signal: AbortSignal | undefined;
  timeoutMs: number | undefined;
  emit: (chunk: string, phase: "setup" | "running") => void;
  testEnv: Record<string, string> | undefined;
  previewEndpoint: string;
  rotatePreviewView: ((timeoutMs?: number) => Promise<void>) | undefined;
  installed: boolean;
}): Promise<RunAppTestsResult> {
  const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
  const casesByFile = new Map<string, TestCaseResult[]>();
  const resultsRoot = path.join(appPath, "test-results");
  fs.mkdirSync(resultsRoot, { recursive: true });
  for (const entry of fs.readdirSync(resultsRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith("dyad-preview-")) {
      try {
        fs.rmSync(path.join(resultsRoot, entry.name), {
          recursive: true,
          force: true,
        });
      } catch (error) {
        logger.warn(`Failed to remove stale preview test artifacts: ${error}`);
      }
    }
  }
  const batchDir = path.join(resultsRoot, `dyad-preview-${randomUUID()}`);
  fs.mkdirSync(batchDir, { recursive: true });

  const remainingTimeout = (): number | undefined => {
    if (deadline === undefined) return undefined;
    return Math.max(0, deadline - Date.now());
  };
  const runnerEnv = (reportPath: string) =>
    getPackageManagerCommandEnv({
      ...process.env,
      ...testEnv,
      [TEST_BASE_URL_ENV]: baseUrl,
      [PREVIEW_CDP_ENDPOINT_ENV]: previewEndpoint,
      PLAYWRIGHT_NO_COPY_PROMPT: "1",
      ...(slowMo ? { [TEST_SLOW_MO_ENV]: String(SLOW_MO_DELAY_MS) } : {}),
      PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
      CI: "true",
    });

  let result: RunAppTestsResult = { appId, results: [] };
  try {
    const discoveryReportPath = path.join(batchDir, "discovery.json");
    const discoveryArgs = [
      "playwright",
      "test",
      "--config",
      DYAD_CONFIG_FILENAME,
    ];
    appendRequestedTestTarget(discoveryArgs, normalizedTestFile, testLine);
    if (grep) discoveryArgs.push("-g", grep);
    discoveryArgs.push("--list", "--reporter=json", "--trace=off");

    const discoveryTimeout = remainingTimeout();
    if (discoveryTimeout === 0) {
      result.infraError = timeoutInfraError(timeoutMs);
      return result;
    }

    let discoveryRun;
    try {
      discoveryRun = await spawnStreaming({
        command: "npx",
        args: discoveryArgs,
        cwd: appPath,
        env: runnerEnv(discoveryReportPath),
        signal,
        timeoutMs: discoveryTimeout,
        onOutput: (chunk) => emit(chunk, "setup"),
      });
    } catch (error) {
      result.infraError = {
        message: error instanceof Error ? error.message : String(error),
      };
      return result;
    }

    if (discoveryRun.aborted) {
      result.infraError = { message: "Test run stopped." };
      return result;
    }
    if (discoveryRun.timedOut) {
      result.infraError = timeoutInfraError(timeoutMs);
      return result;
    }
    if (!fs.existsSync(discoveryReportPath)) {
      const tail = discoveryRun.stderr.trim() || discoveryRun.stdout.trim();
      result.infraError = {
        message:
          tail.slice(-1500) ||
          "Playwright couldn't discover the tests. Check the output for details.",
      };
      return result;
    }

    let discovered: DiscoveredPreviewTest[];
    try {
      const discovery = parsePreviewTestDiscovery(
        JSON.parse(fs.readFileSync(discoveryReportPath, "utf8")),
        appPath,
      );
      if (discovery.errors.length > 0) {
        result.infraError = { message: discovery.errors.join("\n") };
        return result;
      }
      discovered = discovery.tests;
    } catch (error) {
      result.infraError = {
        message: `Failed to parse Playwright test discovery: ${error instanceof Error ? error.message : String(error)}`,
      };
      return result;
    }

    if (discovered.length === 0) {
      if (testLine) {
        result.infraError = {
          message: `No test was found at line ${testLine} — it may have moved. Try running the whole file.`,
        };
      }
      return result;
    }

    const runnable = discovered.filter((test) => !test.skipped);
    for (const skipped of discovered.filter((test) => test.skipped)) {
      const cases = casesByFile.get(skipped.file) ?? [];
      cases.push({
        title: skipped.title,
        line: skipped.line,
        status: "inconclusive",
      });
      casesByFile.set(skipped.file, cases);
    }

    for (let index = 0; index < runnable.length; index += 1) {
      const target = runnable[index];
      emit(
        `\nRunning preview test ${index + 1}/${runnable.length}: ${target.fullTitle}\n`,
        "running",
      );

      const rotationTimeout = remainingTimeout();
      if (rotationTimeout === 0) {
        result.infraError = timeoutInfraError(timeoutMs);
        break;
      }
      try {
        await rotatePreviewView?.(rotationTimeout);
      } catch (error) {
        result.infraError = {
          message: `Couldn't prepare a fresh preview for ${target.fullTitle}: ${error instanceof Error ? error.message : String(error)}`,
        };
        break;
      }

      const invocationTimeout = remainingTimeout();
      if (invocationTimeout === 0) {
        result.infraError = timeoutInfraError(timeoutMs);
        break;
      }

      const invocationDir = path.join(
        batchDir,
        String(index + 1).padStart(4, "0"),
      );
      const reportPath = path.join(invocationDir, "results.json");
      const artifactsPath = path.join(invocationDir, "artifacts");
      fs.mkdirSync(invocationDir, { recursive: true });

      const args = ["playwright", "test", "--config", DYAD_CONFIG_FILENAME];
      args.push(
        `${escapeRegExpForSelector(target.file)}:${target.line}`,
        "-g",
        exactDiscoveredTitleGrep(target.file, target.fullTitle),
        "--reporter=list,json",
        "--trace=off",
        "--workers=1",
        `--output=${artifactsPath}`,
      );
      if (slowMo && !configSetsTimeout(appPath)) {
        args.push(`--timeout=${SLOW_MO_TEST_TIMEOUT_MS}`);
      }

      let run;
      try {
        run = await spawnStreaming({
          command: "npx",
          args,
          cwd: appPath,
          env: runnerEnv(reportPath),
          signal,
          timeoutMs: invocationTimeout,
          onOutput: (chunk) => emit(chunk, "running"),
        });
      } catch (error) {
        result.infraError = {
          message: error instanceof Error ? error.message : String(error),
        };
        break;
      }

      if (run.aborted) {
        result.infraError = { message: "Test run stopped." };
        break;
      }
      if (run.timedOut) {
        result.infraError = timeoutInfraError(timeoutMs);
        break;
      }
      if (!fs.existsSync(reportPath)) {
        const tail = run.stderr.trim() || run.stdout.trim();
        result.infraError = {
          message:
            tail.slice(-1500) ||
            `Playwright didn't produce a report for ${target.fullTitle}.`,
        };
        break;
      }

      let parsed: TestResult[];
      try {
        parsed = parsePlaywrightReport(
          JSON.parse(fs.readFileSync(reportPath, "utf8")),
          appPath,
        );
      } catch (error) {
        result.infraError = {
          message: `Failed to parse the report for ${target.fullTitle}: ${error instanceof Error ? error.message : String(error)}`,
        };
        break;
      }

      const reportError = parsed.find(
        (fileResult) => fileResult.file === PLAYWRIGHT_REPORT_ERROR_FILE,
      );
      if (reportError) {
        result.infraError = {
          message:
            reportError.error ||
            `Playwright reported a runner error for ${target.fullTitle}.`,
        };
        break;
      }

      const executedCases = parsed.flatMap((fileResult) =>
        (fileResult.tests ?? []).map((test) => ({
          file: fileResult.file,
          test,
        })),
      );
      if (executedCases.length !== 1) {
        result.infraError = {
          message: `Preview isolation expected exactly one test for ${target.fullTitle}, but Playwright reported ${executedCases.length}.`,
        };
        break;
      }

      const executed = executedCases[0];
      const cases = casesByFile.get(executed.file) ?? [];
      cases.push(executed.test);
      casesByFile.set(executed.file, cases);
    }
  } finally {
    try {
      await rotatePreviewView?.(signal?.aborted ? 1 : remainingTimeout());
    } catch (error) {
      if (!result.infraError) {
        result.infraError = {
          message: `Couldn't restore a clean preview after the test run: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    result.results = aggregatePreviewCases(casesByFile);
  }

  const passed = result.results.filter(
    (entry) => entry.status === "passed",
  ).length;
  const failed = result.results.filter(
    (entry) => entry.status === "failed",
  ).length;
  const inconclusive = result.results.filter(
    (entry) => entry.status === "inconclusive",
  ).length;
  sendTelemetryEvent("e2e_tests_run", {
    total: result.results.length,
    passed,
    failed,
    inconclusive,
    first_run: installed,
    single_file: Boolean(normalizedTestFile),
    parallel: false,
    slow_mo: Boolean(slowMo),
  });

  return result;
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
  grep,
  headed,
  parallel,
  slowMo,
  onPreviewFallback,
  signal,
  timeoutMs,
  onOutput,
  testEnv,
  previewCdpEndpoint,
  rotatePreviewView,
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
  // Cleared below when the shim can't be routed, because from that point on
  // this is an ordinary browser run and every decision keyed on the endpoint
  // (headed, parallel, the env var the shim reads) has to follow.
  let previewEndpoint = previewCdpEndpoint;
  try {
    const result = await ensurePlaywrightBootstrap({
      appPath,
      signal,
      onOutput: (chunk) => emit(chunk, "setup"),
      ensurePreviewShim: !!previewCdpEndpoint,
    });
    installed = result.installed;
    if (previewEndpoint && !result.previewRouted) {
      // The specs import the real @playwright/test and will launch their own
      // browser. Keeping the endpoint would suppress `--headed` and leave the
      // user watching an empty preview while an invisible browser runs — the
      // opposite of the warning bootstrap just printed.
      previewEndpoint = undefined;
      onPreviewFallback?.();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Playwright bootstrap failed: ${message}`);
    return { appId, results: [], infraError: { message } };
  }

  if (signal?.aborted) {
    return { appId, results: [], infraError: { message: "Test run stopped." } };
  }

  if (previewEndpoint) {
    return runPreviewTestBatch({
      appId,
      appPath,
      baseUrl,
      normalizedTestFile: normalizedTestFile ?? undefined,
      testLine,
      grep,
      slowMo,
      signal,
      timeoutMs,
      emit,
      testEnv,
      previewEndpoint,
      rotatePreviewView,
      installed,
    });
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
  appendRequestedTestTarget(args, normalizedTestFile ?? undefined, testLine);
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
  // A preview run is already visible — it drives Dyad's own window — and has no
  // browser of its own to make headed.
  if (headed && !previewEndpoint) {
    args.push("--headed");
  }
  // Override the generated config's serial defaults (`workers: 1`,
  // `fullyParallel: false`) so a file's independent tests run concurrently.
  // `--fully-parallel` is what parallelizes tests *within* a single file.
  // Preview tests each get a fresh page but still drive the same visible panel,
  // so they can only ever be sequential.
  if (parallel && !previewEndpoint) {
    args.push("--fully-parallel", `--workers=${parallelWorkerCount()}`);
  }
  // A trace of the borrowed context records every page in it, Dyad's own
  // windows included. Passed as a flag so it also covers apps whose generated
  // config predates the same setting.
  if (previewEndpoint) {
    args.push("--trace=off");
  }
  // Slow motion spends wall-clock time inside each test, which Playwright bills
  // against its 30s per-test default — so a spec that's green at full speed
  // could time out purely from the toggle. Raise the per-test ceiling so
  // watching a run stays a pace change, not a source of spurious failures.
  // Skipped when the config names a timeout: that one is the user's, and
  // `--timeout` would override it in either direction — including down.
  if (slowMo && !configSetsTimeout(appPath)) {
    args.push(`--timeout=${SLOW_MO_TEST_TIMEOUT_MS}`);
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
        // Only set for preview runs; the generated fixture shim is inert
        // without it, so every other run keeps launching its own browser.
        ...(previewEndpoint
          ? {
              [PREVIEW_CDP_ENDPOINT_ENV]: previewEndpoint,
              // Playwright's "copy prompt" snapshot goes into error-context.md
              // and is taken from the borrowed context's FIRST page — over CDP
              // that's a Dyad window, not the app. Suppress it rather than
              // hand the model a picture of the user's editor.
              PLAYWRIGHT_NO_COPY_PROMPT: "1",
            }
          : {}),
        // Left unset at full speed so the config's `|| 0` fallback applies.
        ...(slowMo ? { [TEST_SLOW_MO_ENV]: String(SLOW_MO_DELAY_MS) } : {}),
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
    slow_mo: Boolean(slowMo),
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
  /** Regex passed to Playwright's `-g` to narrow the run (agent run_tests). */
  grep?: string;
  headed?: boolean;
  parallel?: boolean;
  /** Pauses between actions so the user can follow the run. */
  slowMo?: boolean;
  timeoutMs?: number;
  /** Stamped onto `tests:run-state` so the panel ignores its own runs. */
  source: "panel" | "agent";
  /**
   * Aborts the run when the caller's own lifecycle ends (e.g. the agent turn is
   * cancelled). Wired into the same AbortController the Stop button uses, so
   * either can cancel the run.
   */
  externalSignal?: AbortSignal;
  /**
   * Experimental: run inside the preview panel's native view instead of a
   * separate browser. Requires the `enableTestRunInPreview` experiment (which
   * opens the CDP endpoint at boot) and the preview showing this app. The
   * renderer opens that view for headed panel and agent runs.
   */
  preview?: boolean;
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
  slowMo,
  timeoutMs,
  source,
  externalSignal,
  preview,
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

  // Resolve the preview target before the expensive isolation setup too: a
  // missing experiment flag or window is a dead end, and the user shouldn't pay
  // for a Neon branch to find out.
  let previewWindow: BrowserWindow | undefined;
  let previewCdpEndpoint: string | undefined;
  if (preview) {
    previewWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    if (!previewWindow) {
      return {
        appId,
        results: [],
        infraError: { message: "Couldn't find the window to preview in." },
      };
    }

    const endpoint = await resolveRemoteDebuggingEndpoint();
    if (!endpoint) {
      return {
        appId,
        results: [],
        infraError: {
          message:
            'Running tests in the preview panel needs the "Run tests in preview panel" experiment. Enable it in Settings → Experiments, then restart Dyad.',
        },
      };
    }
    previewCdpEndpoint = endpoint.httpEndpoint;
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
      // Only `cleaning-up` carries this, and only so the UI can name the work
      // accurately: the Neon path restarts the preview, the Supabase path
      // touches nothing the user can see.
      isolation,
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
    preview,
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

  const emit = (chunk: string, phase: "setup" | "running") =>
    emitOutput(event, appId, runId, chunk, phase);

  let finalResult: RunAppTestsResult = { appId, results: [] };
  // Set by isolation teardown below when `.env.local` couldn't be put back. The
  // run may have produced perfectly good results, but the app is still pointed
  // at the temporary branch, so the caller has to be told rather than left to
  // relaunch it against isolated data.
  let envRestoreFailed = false;
  /**
   * Fold a failed `.env.local` restore into a result. Applied on BOTH exits —
   * an unexpected rejection inside the lock must not swallow it, or the run
   * reports an ordinary infrastructure error while the app is still pointed at
   * the temporary branch.
   */
  const withEnvRestoreWarning = (
    result: RunAppTestsResult,
  ): RunAppTestsResult => {
    if (!envRestoreFailed) return result;
    const restoreMessage =
      "Dyad couldn't restore your app's real database settings after the test run. Restore .env.local before running the app again.";
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
    // and env-file swap. (The resolved app is re-fetched inside the lock below,
    // so this call exists only for the ordering barrier.)
    await getApp(appId);

    // Own the runtime/test resources across the whole isolation lifecycle
    // (prepare → run → teardown). Startup reconciliation owns the same
    // resources, so a rapid Run after launch cannot interleave its env swap
    // and dev-server restart with reconciliation and use the real database.
    const testRunResources = [
      readAppResource("app-path"),
      readAppResource("repository-ref"),
      "repository-worktree",
      "provider",
      "runtime",
      "runtime-config",
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

          // Isolation may have restarted the dev server, so only now is the
          // preview guaranteed to be settled on the URL the run will target.
          let previewBaseUrl: string | undefined;
          if (previewWindow && previewCdpEndpoint) {
            previewBaseUrl = getRunningTestBaseUrl(appId) ?? undefined;
            const ready = previewBaseUrl
              ? await waitForPreviewView(previewWindow, {
                  url: previewBaseUrl,
                  // A panel run was just started by someone looking at the
                  // preview, so waiting out a slow mount is worth it. An agent
                  // run falls back instead of failing, and pays this wait on
                  // every call while the user is elsewhere — inside the app lock,
                  // holding up other operations — so it gives up sooner.
                  ...(source === "agent" ? { timeoutMs: 5_000 } : {}),
                })
              : ({ ok: false, reason: "the app isn't running" } as const);

            if (!ready.ok) {
              if (source === "agent") {
                // Nothing opened the native view — the user is looking at
                // another app, another window, or a page with no preview at
                // all. The agent can't put them back, so failing here would
                // fail every run_tests call for as long as they stay there,
                // taking the whole fix loop with it. Run the tests in an
                // ordinary browser instead: less to watch, but a real result.
                emit(
                  `The preview panel isn't showing this app (${ready.reason}); running the tests in a separate browser instead.\n`,
                  "setup",
                );
                previewWindow = undefined;
                previewCdpEndpoint = undefined;
                previewBaseUrl = undefined;
              } else {
                return {
                  appId,
                  results: [],
                  infraError: {
                    message: `The preview panel isn't showing this app (${ready.reason}). Run the tests from the Tests panel with Headed on and stay on the Preview tab, then try again.`,
                  },
                  isolation: prepared.isolation,
                };
              }
            }
          }

          let previewViewClosed = false;
          const automation = previewWindow
            ? beginPreviewAutomation(previewWindow, {
                onViewDestroyed: () => {
                  previewViewClosed = true;
                },
              })
            : null;

          if (previewCdpEndpoint && !automation) {
            // The view went away between the wait above and this call. Running
            // anyway would drive a page nothing is guarding: no destroyed-view
            // notification, and `showPreviewView` would navigate it mid-run.
            return {
              appId,
              results: [],
              infraError: {
                message:
                  "The preview panel closed before the run could start. Open the Preview tab and try again.",
              },
              isolation: prepared.isolation,
            };
          }

          const automationWindow = previewWindow;
          const automationBaseUrl = previewBaseUrl;
          const rotatePreviewView =
            automation && automationWindow && automationBaseUrl
              ? async (remainingMs?: number) => {
                  const rotated = automation.rotate({
                    url: automationBaseUrl,
                  });
                  if (!rotated.ok) {
                    throw new Error(rotated.reason);
                  }
                  const ready = await waitForPreviewView(automationWindow, {
                    url: automationBaseUrl,
                    timeoutMs: Math.max(
                      1,
                      Math.min(remainingMs ?? 15_000, 15_000),
                    ),
                  });
                  if (!ready.ok) {
                    throw new Error(ready.reason);
                  }
                }
              : undefined;

          let result: RunAppTestsResult;
          try {
            result = await runAppTestsCore({
              appId,
              testFile: normalizedTestFile ?? undefined,
              testLine,
              grep,
              headed,
              parallel,
              slowMo,
              signal: controller.signal,
              timeoutMs,
              onOutput: emit,
              testEnv: prepared.testCredentials,
              previewCdpEndpoint,
              rotatePreviewView,
              // The run turned out to need its own browser, so stop holding the
              // preview view frozen (no navigation, no hiding) for it.
              onPreviewFallback: () => automation?.end(),
            });
          } finally {
            automation?.end();
          }

          if (previewViewClosed) {
            // The CDP target vanished mid-run. Losing it usually doesn't abort
            // Playwright: it reports a screenful of "Target closed" test
            // failures and exits with a perfectly parseable report, so gating
            // this on `infraError` let the common case through as a wall of
            // failures the user's app never caused. None of it is a verdict on
            // the app, so it must not read as one — or count against the agent's
            // fix budget.
            result = {
              ...result,
              infraError: {
                message:
                  "The preview was closed while tests were running, so the run was interrupted.",
              },
            };
          }
          return { ...result, isolation: prepared.isolation };
        } finally {
          // Always restore the app to its real database, even on the
          // infraError early-return, abort, or throw. `teardown` is safe to
          // call exactly once; on the infraError path it's a NOOP (isolation
          // already restored).
          if (prepared) {
            try {
              // Announce the teardown before it starts. It restores
              // `.env.local`, restarts the dev server and deletes the temporary
              // branch/user, takes no AbortSignal, and routinely outlasts the
              // process kill by a wide margin (the Neon branch delete retries
              // with backoff). Without this the UI reports "running" for the
              // whole wait. Skipped for `none`, whose teardown is a NOOP that
              // would only flash the label.
              if (prepared.isolation.mode !== "none") {
                emitProgress("cleaning-up", prepared.isolation);
              }
              // Fail closed across the await: a teardown that throws has said
              // nothing about whether the env came back, and "unknown" has to
              // read the same as "no".
              envRestoreFailed = true;
              envRestoreFailed = !(await prepared.teardown()).envRestored;
            } catch (error) {
              logger.error(
                `Failed to tear down isolated test environment for app ${appId}: ${error}`,
              );
            }
          }
        }
      },
    );
    finalResult = withEnvRestoreWarning(finalResult);
    return finalResult;
  } catch (error) {
    // Surface an unexpected failure as an infra error on the run-state event so
    // the panel leaves its spinner state, then rethrow for the caller.
    finalResult = withEnvRestoreWarning({
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
        dataUrl: await readTestScreenshotDataUrl(appPath, params.path),
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
