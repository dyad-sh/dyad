import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { glob } from "glob";
import log from "electron-log";
import { BrowserWindow } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { PreviewCdpBroker } from "@/main/preview_cdp_broker";
import {
  beginPreviewAutomation,
  reservePreviewViewForAutomation,
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
import { windowRegistry } from "@/window_infrastructure/main/window_registry";
import { spawnStreaming } from "../utils/spawn_streaming";
import {
  canResolvePlaywrightRunner,
  configSetsTimeout,
  ensurePlaywrightBootstrap,
  DYAD_CONFIG_FILENAME,
  PREVIEW_CDP_ENDPOINT_ENV,
  PREVIEW_CDP_TOKEN_ENV,
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
import { withoutInheritedDatabaseEnv } from "../utils/sandbox_env";
import { queueCloudSandboxSnapshotSync } from "../utils/cloud_sandbox_provider";
import { sendTelemetryEvent } from "../utils/telemetry";
import {
  prepareIsolatedTestDatabase,
  type IsolationCleanupProvider,
  type PreparedIsolation,
} from "../services/isolated_test_db";
import { prepareE2eTestDataIsolation } from "../services/e2e_test_data_isolation";
import { ENV_FILE_NAME } from "../utils/app_env_var_utils";
import {
  isTestBranchCleanupOnly,
  restoreAppFromTestBranch,
} from "../utils/neon_test_branch";
import {
  stopE2eTestProcessesSync,
  trackE2eTestProcess,
} from "../services/e2e_test_process_registry";
import {
  createE2eTestWorkspace,
  installE2eTestWorkspaceDependencies,
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
import { resolveNodeModulePackageJsonPathSync } from "../../../shared/node_module_resolution";
import {
  refusesUnsandboxedTestRun,
  usesSandboxedE2eTests,
} from "@/lib/e2eSandbox";
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
): TestResult[] {
  return results.map((result) => ({
    ...result,
    screenshotPath: rewriteE2eArtifactPath(
      result.screenshotPath,
      workspacePath,
      artifactPath,
    ),
    tests: result.tests?.map((test) => ({
      ...test,
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

/**
 * How long the cosmetic post-batch rotation gets to load its replacement view.
 * Deliberately independent of the run's own deadline: by then the results are
 * final, so the only thing a shrinking budget can change is whether the user
 * ends up looking at a clean page or the last test's.
 */
const PREVIEW_TEARDOWN_ROTATION_TIMEOUT_MS = 5_000;

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
  // Stamped on any payload about a preview run, whatever its source: the
  // native view belongs to the invoking window, so every window has to be able
  // to tell whether a broadcast is about the view it is showing.
  const emittedPayload = payload.preview
    ? {
        ...payload,
        previewOwnerWindowSessionId: windowRegistry.ensureRegistered(
          event.sender,
        ),
      }
    : payload;
  broadcastToRegisteredWindows(event.sender, "tests:run-state", emittedPayload);
}

export function buildPlaywrightCliInvocation(
  cliPath: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  return {
    // A bare `node` is resolved as `node.cmd` by the shared Windows command
    // builder. Name the real executable so grep values remain direct argv and
    // titles containing `%` or newlines never pass through cmd.exe.
    command: platform === "win32" ? "node.exe" : "node",
    args: [cliPath, ...args],
  };
}

function playwrightCliInvocationForApp(
  appPath: string,
  args: string[],
): { command: string; args: string[] } {
  const packageJsonPath = resolveNodeModulePackageJsonPathSync(appPath, [
    "@playwright",
    "test",
  ]);
  return buildPlaywrightCliInvocation(
    path.join(path.dirname(packageJsonPath), "cli.js"),
    args,
  );
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
  /**
   * Whether that earlier bootstrap routed the preview shim. The shim is a file
   * in the app, so the sandbox gets it the same way it gets everything else —
   * by having been captured — and only the stage that wrote it can say whether
   * the app's specs actually import it.
   */
  bootstrapPreviewRouted?: boolean;
  /**
   * Withhold the database credentials Dyad itself was launched with from the
   * Playwright runner.
   *
   * Set for sandboxed runs, where the workspace's `.env.local` is the only
   * database the run may reach: `dotenv` leaves an already-set variable alone,
   * so an inherited `DATABASE_URL` would beat the isolated one for any spec —
   * or app route the spec exercises — that reads `process.env` directly.
   * Unset for a normal preview run, which is the user's own app against their
   * own environment by definition.
   */
  isolateDatabaseEnv?: boolean;
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
   * Experimental: endpoint of the run-scoped preview CDP broker. When set, the
   * generated fixture shim drives only the page already loaded in the preview
   * panel's native view instead of launching a browser. Tests run sequentially
   * in separate processes and fresh native views; `headed` has no additional
   * meaning.
   */
  previewCdpEndpoint?: string;
  /** Bearer token accepted by the run-scoped preview CDP broker. */
  previewCdpToken?: string;
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
  previewToken,
  rotatePreviewView,
  installed,
  baseEnv,
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
  previewToken: string;
  rotatePreviewView: ((timeoutMs?: number) => Promise<void>) | undefined;
  installed: boolean;
  /** See `isolateDatabaseEnv` on `RunAppTestsCoreOptions`. */
  baseEnv: NodeJS.ProcessEnv;
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
      ...baseEnv,
      ...testEnv,
      [TEST_BASE_URL_ENV]: baseUrl,
      [PREVIEW_CDP_ENDPOINT_ENV]: previewEndpoint,
      [PREVIEW_CDP_TOKEN_ENV]: previewToken,
      PLAYWRIGHT_NO_COPY_PROMPT: "1",
      ...(slowMo ? { [TEST_SLOW_MO_ENV]: String(SLOW_MO_DELAY_MS) } : {}),
      PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
      CI: "true",
    });

  let result: RunAppTestsResult = { appId, results: [] };
  try {
    const discoveryReportPath = path.join(batchDir, "discovery.json");
    const discoveryArgs = ["test", "--config", DYAD_CONFIG_FILENAME];
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
        ...playwrightCliInvocationForApp(appPath, discoveryArgs),
        cwd: appPath,
        env: runnerEnv(discoveryReportPath),
        signal,
        timeoutMs: discoveryTimeout,
        onOutput: (chunk) => emit(chunk, "setup"),
        onProcess: trackE2eTestProcess,
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

      const args = ["test", "--config", DYAD_CONFIG_FILENAME];
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
          ...playwrightCliInvocationForApp(appPath, args),
          cwd: appPath,
          env: runnerEnv(reportPath),
          signal,
          timeoutMs: invocationTimeout,
          onOutput: (chunk) => emit(chunk, "running"),
          onProcess: trackE2eTestProcess,
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
      // Best-effort, and on a fixed budget rather than the batch's leftover
      // time. This rotation is cosmetic — it hands the user a clean page after
      // the run — and every test has already been executed and aggregated by
      // the time it runs. Billing it against the remaining wall clock meant a
      // batch that used most of its budget left the replacement view a few
      // hundred milliseconds to load, and the timeout then reported a fully
      // green run as an infrastructure failure, which an agent reads as
      // inconclusive and spends a fix attempt on.
      await rotatePreviewView?.(
        signal?.aborted ? 1 : PREVIEW_TEARDOWN_ROTATION_TIMEOUT_MS,
      );
    } catch (error) {
      logger.warn(
        `Couldn't restore a clean preview after the test run: ${error instanceof Error ? error.message : String(error)}`,
      );
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
 * Bootstrap Playwright when requested, run against an explicit sandbox server
 * (or the legacy preview URL for direct callers), and parse the JSON report.
 */
export async function runAppTestsCore({
  appId,
  appPath: explicitAppPath,
  baseUrl: explicitBaseUrl,
  skipBootstrap = false,
  bootstrapInstalled = false,
  bootstrapPreviewRouted = false,
  isolateDatabaseEnv = false,
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
  previewCdpToken,
  rotatePreviewView,
}: RunAppTestsCoreOptions): Promise<RunAppTestsResult> {
  const app = await getApp(appId);
  const appPath = explicitAppPath ?? getDyadAppPath(app.path);
  const emit = (chunk: string, phase: "setup" | "running") =>
    onOutput?.(chunk, phase);
  const runnerBaseEnv = isolateDatabaseEnv
    ? withoutInheritedDatabaseEnv()
    : process.env;
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
  // Sandboxed runs bootstrap the REAL app in their prepare stage, before the
  // snapshot, and pass the outcome in — including whether the preview shim was
  // routed, because the snapshot is what carries that shim into the workspace
  // this run executes from.
  let installed = bootstrapInstalled;
  // Cleared below when the shim can't be routed, because from that point on
  // this is an ordinary browser run and every decision keyed on the endpoint
  // (headed, parallel, the env var the shim reads) has to follow.
  let previewEndpoint = previewCdpEndpoint;
  if (skipBootstrap) {
    if (previewEndpoint && !bootstrapPreviewRouted) {
      previewEndpoint = undefined;
      onPreviewFallback?.();
    }
    if (!canResolvePlaywrightRunner(appPath)) {
      // The sandbox is bootstrapped by copy: the real project gets
      // `@playwright/test` and the clean install reproduces it in the
      // workspace. An app with custom commands skips that install entirely, so
      // if its own install command doesn't pull the package in, the runner has
      // nothing to resolve. Reported here as the same actionable precondition
      // the capture, install, and server-start stages produce — left to the CLI
      // it surfaced as a bare resolution error and was recorded as an internal
      // Dyad exception.
      //
      // Resolved the way Node resolves it — walking up through parent
      // `node_modules` — because a monorepo app installs at its workspace root,
      // which hoists the package above the app directory. Checking only the app
      // directory would refuse a sandbox `npx playwright` handles fine.
      return {
        appId,
        results: [],
        infraError: {
          message:
            "The isolated test workspace has no @playwright/test to run. Your app's custom install command needs to install it (for example, add it to package.json) so the sandboxed run can resolve the Playwright runner.",
        },
      };
    }
  } else {
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
  }

  if (signal?.aborted) {
    return { appId, results: [], infraError: { message: "Test run stopped." } };
  }

  if (previewEndpoint && !previewCdpToken) {
    return {
      appId,
      results: [],
      infraError: { message: "Preview automation credentials are missing." },
    };
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
      previewToken: previewCdpToken!,
      rotatePreviewView,
      installed,
      baseEnv: runnerBaseEnv,
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
  const args = ["test", "--config", DYAD_CONFIG_FILENAME];
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
  // Unconditional: a preview run returned above, so from here on this is always
  // an ordinary browser run with a browser of its own to make headed.
  if (headed) {
    args.push("--headed");
  }
  // Override the generated config's serial defaults (`workers: 1`,
  // `fullyParallel: false`) so a file's independent tests run concurrently.
  // `--fully-parallel` is what parallelizes tests *within* a single file.
  // Preview runs, which can only ever be sequential, returned above — so the
  // caller's choice is honored as-is here, including on the fallback path where
  // preview routing was refused and this became an ordinary browser run.
  if (parallel) {
    args.push("--fully-parallel", `--workers=${parallelWorkerCount()}`);
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
      ...playwrightCliInvocationForApp(appPath, args),
      cwd: appPath,
      env: getPackageManagerCommandEnv({
        ...runnerBaseEnv,
        ...testEnv,
        [TEST_BASE_URL_ENV]: baseUrl,
        // PREVIEW_CDP_ENDPOINT_ENV is deliberately not set here. A preview run
        // returned above; leaving the variable unset is what keeps the
        // generated fixture shim inert so this run launches its own browser.
        // Left unset at full speed so the config's `|| 0` fallback applies.
        ...(slowMo ? { [TEST_SLOW_MO_ENV]: String(SLOW_MO_DELAY_MS) } : {}),
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
    // A spawn failure (e.g. Node missing from PATH) rejects rather than exiting
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

/**
 * The non-sandboxed path, taken when the sandbox isn't available (Docker/cloud
 * runtime) or the user opted out of it. Keeps the pre-sandbox behavior —
 * bootstrap and run against the normal preview — with the missing runtime
 * isolation disclosed on the result rather than losing E2E testing entirely.
 * Neon apps are the one exception: without a sandbox there is no throwaway
 * branch to point the app at, so the only way to run would be against the
 * user's real database, and this fails closed instead.
 */
/**
 * Run the tests through the preview panel when a window has been reserved for
 * it, and in an ordinary browser otherwise.
 *
 * Shared by both routes on purpose. The preview panel decides where the
 * browser *renders*; the sandbox decides which server it points AT. Those are
 * orthogonal, so a sandboxed run keeps preview automation — the user watches
 * the run in place, and what they watch is the isolated copy against its
 * throwaway database rather than their real app — and a run that opted out of
 * the sandbox keeps it too. One copy of this, or the two routes drift.
 */
async function runTestsWithPreviewAutomation({
  previewWindow,
  previewBaseUrl,
  requireCurrentUrl,
  source,
  signal,
  emit,
  releasePreviewReservation,
  emitPreviewFallback,
  coreOptions,
}: {
  /** Undefined when the run was never asked to use the preview. */
  previewWindow: BrowserWindow | undefined;
  /** The page the automation drives, and rotates back to between tests. */
  previewBaseUrl: string | undefined;
  /**
   * Whether the view must ALREADY be showing `previewBaseUrl`. True for a run
   * against the normal preview, which the renderer has pointed there. False
   * for a sandboxed run: its server is on a port nothing has navigated to, and
   * `rotate()` loads it before the first test.
   */
  requireCurrentUrl: boolean;
  source: "panel" | "agent";
  signal: AbortSignal;
  emit: (chunk: string, phase: "setup" | "running") => void;
  releasePreviewReservation: () => void;
  emitPreviewFallback: () => void;
  coreOptions: Omit<
    RunAppTestsCoreOptions,
    "previewCdpEndpoint" | "previewCdpToken" | "rotatePreviewView"
  >;
}): Promise<RunAppTestsResult> {
  const appId = coreOptions.appId;
  let window = previewWindow;
  let driveUrl = previewBaseUrl;

  if (window) {
    const ready = driveUrl
      ? await waitForPreviewView(window, {
          ...(requireCurrentUrl ? { url: driveUrl } : {}),
          // A panel run was just started by someone looking at the preview, so
          // waiting out a slow mount is worth it. An agent run falls back
          // instead of failing, and pays this wait on every call while the user
          // is elsewhere — inside the app lock, holding up other operations —
          // so it gives up sooner.
          ...(source === "agent" ? { timeoutMs: 5_000 } : {}),
          signal,
        })
      : ({ ok: false, reason: "the app isn't running" } as const);

    if (!ready.ok) {
      if ("aborted" in ready && ready.aborted) {
        // Stop pressed during the wait. Reporting a preview problem here would
        // blame the panel for the user's own decision.
        return {
          appId,
          results: [],
          infraError: { message: "Test run stopped." },
        };
      }
      if (source === "agent") {
        // Nothing opened the native view — the user is looking at another app,
        // another window, or a page with no preview at all. The agent can't put
        // them back, so failing here would fail every run_tests call for as
        // long as they stay there, taking the whole fix loop with it. Run the
        // tests in an ordinary browser instead: less to watch, but a real
        // result.
        emit(
          `The preview panel isn't showing this app (${ready.reason}); running the tests in a separate browser instead.\n`,
          "setup",
        );
        window = undefined;
        driveUrl = undefined;
        // Nothing is going to drive that view now, so stop holding it.
        releasePreviewReservation();
        // The renderer may already have switched to the native view on the
        // "started" event; without this it stays there, locked, for a run
        // happening in a browser window elsewhere.
        emitPreviewFallback();
      } else {
        return {
          appId,
          results: [],
          infraError: {
            message: `The preview panel isn't showing this app (${ready.reason}). Run the tests from the Tests panel with Headed on and stay on the Preview tab, then try again.`,
          },
        };
      }
    }
  }

  let previewViewClosed = false;
  const automation = window
    ? beginPreviewAutomation(window, {
        onViewDestroyed: () => {
          previewViewClosed = true;
        },
      })
    : null;

  if (window && !automation) {
    // The view went away between the wait above and this call. Running anyway
    // would drive a page nothing is guarding: no destroyed-view notification,
    // and `showPreviewView` would navigate it mid-run.
    return {
      appId,
      results: [],
      infraError: {
        message:
          "The preview panel closed before the run could start. Open the Preview tab and try again.",
      },
    };
  }

  let previewBroker: PreviewCdpBroker | undefined;
  let previewCdpEndpoint: string | undefined;
  let previewCdpToken: string | undefined;
  if (automation) {
    const target = automation.getWebContents();
    if (!target) {
      return {
        appId,
        results: [],
        infraError: {
          message:
            "The preview panel closed before automation could attach. Open the Preview tab and try again.",
        },
      };
    }
    try {
      previewBroker = new PreviewCdpBroker();
      await previewBroker.start();
      await previewBroker.setTarget(target);
      const connection = previewBroker.connectionInfo;
      previewCdpEndpoint = connection.endpoint;
      previewCdpToken = connection.token;
    } catch (error) {
      await previewBroker?.close().catch(() => {});
      automation.end();
      return {
        appId,
        results: [],
        infraError: {
          message: `Couldn't attach automation to the preview: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  }

  const automationWindow = window;
  const automationBaseUrl = driveUrl;
  const rotatePreviewView =
    automation && automationWindow && automationBaseUrl
      ? async (remainingMs?: number) => {
          // Rotation destroys the current WebContentsView. Detach its debugger
          // first so the broker recognizes that loss as an intentional handoff
          // rather than an unexpected target failure that should close the
          // endpoint.
          previewBroker?.releaseTarget();
          const rotated = automation.rotate({ url: automationBaseUrl });
          if (!rotated.ok) {
            throw new Error(rotated.reason);
          }
          const ready = await waitForPreviewView(automationWindow, {
            url: automationBaseUrl,
            timeoutMs: Math.max(1, Math.min(remainingMs ?? 15_000, 15_000)),
            signal,
          });
          if (!ready.ok) {
            throw new Error(ready.reason);
          }
          const replacement = automation.getWebContents();
          if (!replacement) {
            throw new Error("the rotated preview was destroyed");
          }
          await previewBroker?.setTarget(replacement);
        }
      : undefined;

  let result: RunAppTestsResult;
  try {
    result = await runAppTestsCore({
      ...coreOptions,
      previewCdpEndpoint,
      previewCdpToken,
      rotatePreviewView,
      // The run turned out to need its own browser, so stop holding the
      // preview view frozen (no navigation, no hiding) for it.
      onPreviewFallback: () => {
        automation?.end();
        // ...and tell the renderer, or the user is left staring at a native
        // "Test view" with every control locked by the run while the tests
        // actually execute in a separate Playwright window. The only other
        // signal is a warning line in the test output, which is collapsed by
        // default.
        emitPreviewFallback();
      },
    });
  } finally {
    await previewBroker?.close().catch((error) => {
      logger.warn(`Failed to close preview automation broker: ${error}`);
    });
    automation?.end();
  }

  if (previewViewClosed) {
    // The CDP target vanished mid-run. Losing it usually doesn't abort
    // Playwright: it reports a screenful of "Target closed" test failures and
    // exits with a perfectly parseable report, so gating this on `infraError`
    // let the common case through as a wall of failures the user's app never
    // caused. None of it is a verdict on the app, so it must not read as one —
    // or count against the agent's fix budget.
    result = {
      ...result,
      infraError: {
        message:
          "The preview was closed while tests were running, so the run was interrupted.",
      },
    };
  }
  return result;
}

async function runTestsAgainstNormalPreview({
  appId,
  disclosure,
  neonRefusal,
  runtimeMode,
  signal,
  emit,
  emitProgress,
  onIsolationCleanupFailed,
  testFile,
  testLine,
  grep,
  headed,
  parallel,
  slowMo,
  timeoutMs,
  previewWindow,
  source,
  releasePreviewReservation,
  emitPreviewFallback,
}: {
  appId: number;
  /** Why this run isn't sandboxed, shown on the result's isolation badge. */
  disclosure: string;
  /** Why a Neon app can't run at all here, and what to change. */
  neonRefusal: string;
  /** The runtime this app actually runs in, so isolation can enforce its own
   * host-only precondition rather than trusting this caller's guard. */
  runtimeMode: string;
  signal: AbortSignal;
  emit: (chunk: string, phase: "setup" | "running") => void;
  emitProgress: (
    state: "stopping" | "cleaning-up",
    isolation?: TestIsolation,
  ) => void;
  onIsolationCleanupFailed: (
    failed: boolean,
    provider?: IsolationCleanupProvider,
  ) => void;
  testFile?: string;
  testLine?: number;
  grep?: string;
  headed?: boolean;
  parallel?: boolean;
  slowMo?: boolean;
  timeoutMs?: number;
  /**
   * The preview automation wiring, which this route supports exactly as the
   * sandboxed one does: opting out of the sandbox must not silently cost the
   * user the ability to watch their tests run.
   */
  previewWindow: BrowserWindow | undefined;
  source: "panel" | "agent";
  releasePreviewReservation: () => void;
  emitPreviewFallback: () => void;
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
      // The route can wait behind another operation after the preflight read.
      // Honor a Tests-panel disable that happened while it was queued before
      // creating provider-side isolation or starting Playwright.
      if (!app.testingEnabled) {
        return {
          appId,
          results: [],
          infraError: {
            message:
              "Testing isn't enabled for this app. Enable it in the Tests panel before running tests.",
          },
          isolation: { mode: "none" as const, reason: disclosure },
        };
      }
      // Supabase isolation is provider-side and works in any runtime, so only
      // an app whose isolation depends on the Neon branch swap is refused.
      if (refusesUnsandboxedTestRun(app)) {
        return {
          appId,
          results: [],
          infraError: { message: neonRefusal },
          isolation: { mode: "none" as const, reason: disclosure },
        };
      }

      let prepared: PreparedIsolation | undefined;
      try {
        prepared = await prepareIsolatedTestDatabase({
          app,
          emit,
          // The real mode, not a hardcoded "host". Only the Neon branch-swap
          // path reads it, and `refusesUnsandboxedTestRun` already turned those
          // apps away — but that is a non-local invariant, and relaxing it
          // (allowing Neon here, or reordering the provider precedence) would
          // silently run the host-only env swap and `restartAppInPlace` in a
          // Docker or cloud runtime. Passing the truth keeps the precondition
          // enforceable where it is written.
          runtimeMode,
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
        const result = await runTestsWithPreviewAutomation({
          previewWindow,
          // The normal preview's own URL, which the renderer has already
          // pointed the view at — so unlike a sandboxed run, this one waits for
          // it rather than navigating there itself.
          previewBaseUrl: getRunningTestBaseUrl(appId) ?? undefined,
          requireCurrentUrl: true,
          source,
          signal,
          emit,
          releasePreviewReservation,
          emitPreviewFallback,
          coreOptions: {
            appId,
            testFile,
            testLine,
            grep,
            headed,
            parallel,
            slowMo,
            signal,
            timeoutMs,
            onOutput: emit,
            testEnv: prepared.testCredentials,
          },
        });
        return { ...result, isolation };
      } finally {
        if (prepared) {
          try {
            if (prepared.isolation.mode !== "none") {
              emitProgress("cleaning-up", prepared.isolation);
            }
            onIsolationCleanupFailed(true, prepared.cleanupProvider);
            onIsolationCleanupFailed(
              !(await prepared.teardown()).remoteCleanupCompleted,
              prepared.cleanupProvider,
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
/**
 * Whether the sandbox's `.env.local` still matches the live one.
 *
 * The capture stage claims neither `provider` nor `runtime-config`, and the
 * writers that matter here — `setAppEnvVars`, or the user's own editor — change
 * no app-row column at all, so no comparison of the row can see them. Comparing
 * the bytes the sandbox actually holds against the file it was copied from is
 * the check that can, and it does not care which writer moved it.
 *
 * A file missing on both sides matches; one missing on exactly one side does
 * not. An unreadable live file is treated as a mismatch rather than a match:
 * failing the setup costs a retry, and passing it would run the tests against
 * credentials nothing verified.
 */
async function readEnvFile(directory: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(
      path.join(directory, ENV_FILE_NAME),
      "utf8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function sandboxEnvMatchesCapture(
  realAppPath: string,
  workspace: E2eTestWorkspace,
  capturedEnv: string | null,
): Promise<boolean> {
  try {
    const [live, sandbox] = await Promise.all([
      readEnvFile(realAppPath),
      readEnvFile(workspace.workspacePath),
    ]);
    // Against the value read BEFORE the snapshot, not just live-versus-copy.
    // A rewrite that landed between that read and the copy starting leaves both
    // sides holding the same NEW file, so comparing them to each other agrees
    // while the row this run isolates from describes the OLD one — a Supabase
    // test user created in one project while the sandbox app reads another's.
    return live === capturedEnv && sandbox === capturedEnv;
  } catch (error) {
    logger.warn(
      `Couldn't compare the captured environment against the live one: ${error}`,
    );
    return false;
  }
}

/** Shared by both drift checks, so the user reads one explanation. */
const CONFIGURATION_CHANGED_MESSAGE =
  "This app's database or run configuration changed while Dyad was preparing the test sandbox, so the run was stopped before it could use stale settings. Run the tests again.";

/**
 * The app configuration the snapshot was taken under.
 *
 * The prepare stage claims neither `provider` nor `runtime-config`, so a user
 * can disconnect or re-point Neon/Supabase — or edit the install/start commands
 * — while bootstrap and capture run. The sandbox's copied `.env.local` still
 * holds the credentials that were live at capture time, while the run stage's
 * fresh `getApp()` would see the new association and pick isolation for it —
 * including `mode: "none"` for an app that now looks database-less, which is how
 * a run ends up executing lifecycle scripts and specs against real credentials
 * it believed were isolated.
 *
 * The commands travel for the same reason: the prepare stage decides whether to
 * skip the clean install from `hasCustomE2eStartCommand`, and the run stage
 * builds the server command from its own row. Cleared `installCommand` between
 * the two and the workspace has no `node_modules` while the runtime takes the
 * Dyad-managed `npm run dev` branch.
 */
interface CapturedConfiguration {
  neonProjectId: string | null;
  supabaseProjectId: string | null;
  installCommand: string | null;
  startCommand: string | null;
}

type E2eTestPrepareResult =
  | {
      installed: boolean;
      /**
       * Whether the preview shim was routed into the app before the capture.
       * The shim is a file, so the snapshot is what carries it into the
       * workspace the run executes from — the run stage cannot re-derive this
       * for itself.
       */
      previewRouted: boolean;
      workspace: E2eTestWorkspace;
      provider: CapturedConfiguration;
    }
  | { setupError: string };
// INVARIANT: the two arms are exclusive — a `setupError` never carries a
// workspace. `createE2eTestWorkspace` disposes its own partial worktree
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
  // Set when the preview was asked for and refused before the run's output
  // stream exists; reported through `emit` as soon as it does.
  let previewFellBackToBrowser: string | undefined;
  if (preview) {
    previewWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    if (!previewWindow) {
      return {
        appId,
        results: [],
        infraError: { message: "Couldn't find the window to preview in." },
      };
    }
  }

  // Claim the view now, before isolation setup. The run doesn't take real
  // ownership until beginPreviewAutomation() far below, and in between the
  // Tests panel already shows the run as active: the "Tests running…" chip and
  // the exit button both unmount the preview component, whose cleanup would
  // otherwise destroy the very page this run is waiting to attach to.
  let releasePreviewReservation: () => void = () => {};
  if (previewWindow) {
    const reservation = reservePreviewViewForAutomation(previewWindow, appId);
    if (reservation === null) {
      // Another app's run already owns this window's one native view. Both
      // runs proceeding would navigate each other's page out from under them
      // and fail both readiness checks — after each had paid for its own
      // isolation setup. Take the ordinary browser instead: less to watch,
      // but a real result, and the same fallback the missing-view path uses.
      previewWindow = undefined;
      previewFellBackToBrowser =
        "another app's test run is using the preview panel";
    } else {
      releasePreviewReservation = reservation;
    }
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
  // cleanup UI can name what is actually being removed — the fallback path
  // never creates a workspace, and claiming otherwise is the same class of
  // inaccurate copy this work set out to remove. Declared before the progress
  // emitter below, which an already-cancelled caller can fire synchronously.
  let sandboxed = false;

  /**
   * The isolation this run set up, remembered outside the run stage.
   *
   * A Stop pressed while the sandbox server is still coming up throws past the
   * stage that owns `prepared`, so the exit paths below have no result to read
   * the mode off. Without this they fall to the generic "isolated test
   * database" wording — which, for a Supabase app whose test-user delete just
   * failed, names the wrong thing entirely and points the user at a database
   * that was never involved.
   */
  let lastIsolation: TestIsolation | undefined;

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

  // ONE routing decision for the whole run: read here, announced by `started`
  // immediately below, and reused by the branch far down that actually picks a
  // route. The run waits for the prior lifecycle in between, which can take
  // minutes — re-reading Settings after that wait would let a toggle flipped
  // mid-wait send the run one way while the panel has already told the user the
  // other, either promising a multi-minute sandbox setup that never happens or
  // omitting that explanation for a run that does it.
  const routingSettings = readSettings();

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
    // What this run is, not what it requested. A refused preview has already
    // cleared the endpoint and will emit a correlated fallback event below.
    preview: previewWindow !== undefined,
    // The route is decided far below, from this same snapshot — the setup phase
    // is over long before the first progress event could carry it. Without it
    // here, the panel's "installing dependencies can take a few minutes" copy
    // never appears for an agent run, or for any window that mounted after the
    // click, which is exactly the multi-minute apparent hang it exists to
    // explain.
    sandboxed: usesSandboxedE2eTests(routingSettings),
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

  if (previewFellBackToBrowser) {
    emit(
      `The preview panel can't host this run (${previewFellBackToBrowser}); running the tests in a separate browser instead.\n`,
      "setup",
    );
    // The renderer switched to the native view optimistically on click, so it
    // has to be told to switch back before the run starts somewhere else.
    emitRunState(event, {
      appId,
      runId,
      source,
      state: "preview-fallback",
      preview: true,
      testFile: normalizedTestFile ?? undefined,
      testLine,
      grep,
    });
  }

  let finalResult: RunAppTestsResult = { appId, results: [] };
  let workspace: E2eTestWorkspace | undefined;
  // Whether the run-scoped server tree is confirmed gone. A survivor holds the
  // workspace as its cwd, so disposal has to wait for the startup sweep.
  let serverStopped = true;
  // The real env is never changed. This only reports a sandbox/provider cleanup
  // failure (for example, a temporary Neon branch left for startup recovery).
  let isolationCleanupFailed = false;
  // Which provider actually had something to clean up. Read instead of
  // `isolation.mode`: a setup that fails *after* creating the test user reports
  // `mode: "none"`, and naming the leftover from the mode would then call a
  // stranded Supabase user "the isolated test database".
  let isolationCleanupProvider: IsolationCleanupProvider | undefined;
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
    // same class of inaccurate message this work set out to remove. Both are
    // retried by their own startup sweep (`reconcileOrphanTestBranches`,
    // `reconcileOrphanTestUsers`), so both say so.
    const provider =
      isolationCleanupProvider ??
      (result.isolation?.mode === "supabase-test-user"
        ? "supabase-test-user"
        : undefined);
    const restoreMessage =
      provider === "supabase-test-user"
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
    // finish. Otherwise a Stop-then-Run could race the prior run's provider and
    // workspace cleanup against this run's setup.
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
    // snapshot then captures the live repository state. Neither may run for a
    // run that is about to be turned away.
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

    // The sandbox is host-only for now, and the user retains an explicit
    // opt-out. Both routes take the same
    // non-sandboxed path, and both fail closed for Neon rather than running
    // against the user's real database.
    const runtimeMode = routingSettings.runtimeMode2 ?? "host";
    const sandboxUnavailable = usesSandboxedE2eTests(routingSettings)
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
          runtimeMode,
          signal: controller.signal,
          emit,
          emitProgress,
          onIsolationCleanupFailed: (failed, provider) => {
            isolationCleanupFailed = failed;
            isolationCleanupProvider = provider;
          },
          testFile: normalizedTestFile ?? undefined,
          testLine,
          grep,
          headed,
          parallel,
          slowMo,
          timeoutMs,
          previewWindow,
          source,
          releasePreviewReservation,
          emitPreviewFallback: () =>
            emitRunState(event, {
              appId,
              runId,
              source,
              state: "preview-fallback",
              preview: true,
              testFile: normalizedTestFile ?? undefined,
              testLine,
              grep,
            }),
        }),
      );
      return finalResult;
    }

    // A raw test-branch marker means a previous recorder session died with the
    // user's `.env.local` still pointed at its temporary branch. This run would
    // otherwise take that row for its own branch and erase the only record of
    // it. Repaired FIRST, before any of this run's claims are taken, because
    // the repair rewrites the live working tree and restarts nothing —
    // `restoreAppFromTestBranch` takes `app-path`, `provider`, `runtime` and
    // `runtime-config` for itself, which nothing here can hold at this point.
    // A failure needs no handling: `createTempTestBranch` refuses the run
    // rather than destroying the marker, and that refusal is what the user
    // sees.
    if (
      guardApp.neonTestBranchId &&
      !isTestBranchCleanupOnly(guardApp.neonTestBranchId)
    ) {
      emit("Restoring settings a previous test run left behind…\n", "setup");
      try {
        await restoreAppFromTestBranch(guardApp);
      } catch (error) {
        logger.warn(
          `Failed to recover a leaked Neon test branch for app ${appId}: ${error}`,
        );
      }
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
          // Written into the REAL app, before the capture, so the snapshot
          // carries it: a sandboxed preview run executes from the workspace,
          // and the shim has to already be in what was copied.
          const { installed, previewRouted } = await ensurePlaywrightBootstrap({
            appPath: realAppPath,
            signal: controller.signal,
            onOutput: (chunk) => emit(chunk, "setup"),
            ensurePreviewShim: !!previewWindow,
          });
          // Read BEFORE the capture, not after. A disconnect that lands *during*
          // the copy leaves the snapshot holding the old credentials while a
          // post-copy read would record the new association — and the run
          // stage, comparing against that, would agree with itself and start
          // the sandbox on stale live credentials. Taken before, the two can
          // only agree when nothing moved.
          const captured: CapturedConfiguration = {
            neonProjectId: claimedApp.neonProjectId,
            supabaseProjectId: claimedApp.supabaseProjectId,
            installCommand: claimedApp.installCommand,
            startCommand: claimedApp.startCommand,
          };
          // Read alongside the row, before the copy, for the same reason: the
          // credentials the run isolates from and the ones the sandbox will
          // hold have to be the same ones.
          const capturedEnv = await readEnvFile(realAppPath);
          emit("Capturing the app in an isolated Git workspace…\n", "setup");
          const workspace = await createE2eTestWorkspace({
            appId,
            appPath: realAppPath,
            hasCustomCommands: hasCustomE2eStartCommand(claimedApp),
            signal: controller.signal,
          });
          // The copy itself is the ambiguous window: nothing here can say which
          // side of a change its `.env.local` landed on, so a row that moved
          // during it fails setup rather than guessing. Disposal is explicit —
          // the workspace exists now, and the `setupError` arm of the result
          // deliberately never carries one for the caller to clean up.
          try {
            const afterCapture = await getApp(appId);
            if (
              afterCapture.neonProjectId !== captured.neonProjectId ||
              afterCapture.supabaseProjectId !== captured.supabaseProjectId ||
              afterCapture.installCommand !== captured.installCommand ||
              afterCapture.startCommand !== captured.startCommand ||
              // The row is not the whole configuration. `setAppEnvVars` writes
              // `.env.local` without touching any column, and so does a user
              // editing the file directly — so an app whose credentials were
              // re-pointed at a different project during the copy would pass
              // every comparison above while the sandbox holds the old ones.
              // Comparing the copy against the live file is the direct check,
              // and it covers writers this code has never heard of.
              !(await sandboxEnvMatchesCapture(
                realAppPath,
                workspace,
                capturedEnv,
              ))
            ) {
              throw new DyadError(
                CONFIGURATION_CHANGED_MESSAGE,
                DyadErrorKind.Precondition,
              );
            }
          } catch (error) {
            await workspace.dispose().catch((disposeError) => {
              logger.warn(
                `Failed to remove a captured E2E workspace after a setup failure: ${disposeError}`,
              );
            });
            throw error;
          }
          return { installed, previewRouted, workspace, provider: captured };
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
    const capturedProvider = prepareResult.provider;
    // Set here, not when the route was chosen: this flag drives the cleanup
    // UI, and a run whose setup failed has no sandbox to claim Dyad is
    // deleting. Recorded once rather than re-read later, because the setting
    // can change while the run is in flight and the UI has to describe what
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

          // The snapshot's `.env.local` is a copy of whatever was live when the
          // capture ran, and the prepare stage claimed neither `provider` nor
          // `runtime-config` — so a provider disconnected or re-pointed in
          // between would have this stage choose isolation for the NEW
          // association while the sandbox still holds the OLD credentials. The
          // worst shape is a disconnect: isolation resolves to `mode: "none"`
          // and the run proceeds against real credentials it believes are
          // isolated. Dead-end instead; the retry captures a fresh snapshot.
          if (
            app.neonProjectId !== capturedProvider.neonProjectId ||
            app.supabaseProjectId !== capturedProvider.supabaseProjectId ||
            app.installCommand !== capturedProvider.installCommand ||
            app.startCommand !== capturedProvider.startCommand
          ) {
            return {
              appId,
              results: [],
              infraError: { message: CONFIGURATION_CHANGED_MESSAGE },
            };
          }

          // Set up isolation so the run never mutates the user's real data:
          // Neon apps get a throwaway copy-on-write branch, Supabase apps get
          // a throwaway RLS-scoped test user, and no-DB apps run as-is.
          prepared = await prepareE2eTestDataIsolation({
            app,
            workspacePath: workspace!.workspacePath,
            emit,
            runtimeMode,
            signal: controller.signal,
          });
          // Recorded here so a Stop thrown out of the server start below still
          // reaches the exit paths with the mode they need to name the leak.
          lastIsolation = prepared.isolation;
          isolationCleanupProvider = prepared.cleanupProvider;

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

          // Strictly after isolation. `npm ci`/`pnpm install` run the app's
          // lifecycle scripts, and a `postinstall` migration is a normal thing
          // for a generated app to have — installing while the sandbox's copied
          // `.env.local` still held the user's real credentials would point that
          // migration at production data on the way into an "isolated" run.
          //
          // Still outside the repository-worktree claim, which the prepare stage
          // released: the install only writes inside the detached worktree, so
          // the user keeps editing the live app while it runs.
          //
          // Lifecycle scripts are the app's own code, and they run with
          // whatever `.env.local` the sandbox holds. Only the Neon path
          // rewrites that file — to the throwaway branch — so for a Supabase
          // app, or one with no managed database at all, a `postinstall`
          // migration would run against whatever the copied credentials point
          // at, four times over in one agent turn.
          //
          // The credentials are withheld for the duration of the install
          // rather than the scripts disabled. `--ignore-scripts` is not
          // selective: it would also break `prisma generate`, native rebuilds
          // and codegen for every app that merely has a database, turning
          // working runs into a server that cannot start. Taking the database
          // out of the environment leaves the scripts running and denies them
          // only the thing they must not reach.
          const withholdDatabaseEnv = prepared.isolation.mode !== "neon-branch";
          try {
            if (workspace!.dependencyInstallPath) {
              emit(
                "Installing clean dependencies in the test workspace…\n",
                "setup",
              );
              if (withholdDatabaseEnv) {
                emit(
                  "Install scripts run without this app's database credentials, so they can't reach your real data. A script that needs a database will fail here.\n",
                  "setup",
                );
              }
            } else if (withholdDatabaseEnv && hasCustomE2eStartCommand(app)) {
              // A custom app installs through its own command, run verbatim by
              // the runtime as part of `install && start` — so the withholding
              // above cannot wrap it without also hiding the credentials from
              // the server the run is about to start. The preview runs the same
              // command against the same live project, so this is not new
              // exposure, but it is the one case the protection cannot reach.
              emit(
                "Note: your custom install command runs as written, with this app's live database credentials — Dyad can't withhold them from it.\n",
                "setup",
              );
            }
            await installE2eTestWorkspaceDependencies({
              workspace: workspace!,
              signal: controller.signal,
              onOutput: (chunk) => emit(chunk, "setup"),
              withholdDatabaseEnv,
            });
          } catch (error) {
            if (controller.signal.aborted) throw error;
            const message =
              error instanceof Error ? error.message : String(error);
            logger.error(
              `Isolated E2E dependency install failed for app ${appId}: ${message}`,
            );
            return {
              appId,
              results: [],
              infraError: { message },
              isolation: prepared.isolation,
            };
          }

          emit("Starting the isolated test server…\n", "setup");
          try {
            testRuntime = await startE2eTestRuntime({
              workspacePath: workspace!.workspacePath,
              packageManager: workspace!.packageManager,
              installCommand: app.installCommand,
              startCommand: app.startCommand,
              signal: controller.signal,
              onOutput: (chunk) => emit(chunk, "setup"),
            });
          } catch (error) {
            // A Stop is not a setup failure — let it reach the outer catch,
            // which turns it into the same "Test run stopped." result the
            // in-run Stop path produces.
            if (controller.signal.aborted) throw error;
            // Everything else here is the most common user-facing failure of
            // the whole flow: a broken `dev` script, a server that never
            // answers, a custom start command that ignores the port. It is an
            // environment problem the user acts on, and the two neighbouring
            // stages — the workspace capture and the dependency install —
            // already report exactly that shape. Letting it escape instead
            // rejected the IPC call, so the panel recorded `runError.kind:
            // "unknown"` and the agent got "unexpected error in the test
            // infrastructure" rather than the real reason.
            const message =
              error instanceof Error ? error.message : String(error);
            logger.error(
              `Isolated E2E test server failed to start for app ${appId}: ${message}`,
            );
            return {
              appId,
              results: [],
              infraError: { message },
              isolation: prepared.isolation,
            };
          }

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

          // The preview panel renders the browser; the sandbox decides what it
          // points AT. Those are separate concerns, so a sandboxed run keeps
          // preview automation — the user watches the run in place, and what
          // they watch is the isolated copy against its throwaway database
          // rather than their real app. Resolved only now because the URL to
          // drive is this run's own server, which did not exist until the
          // stage above started it.
          const result = await runTestsWithPreviewAutomation({
            previewWindow,
            previewBaseUrl: testRuntime.baseUrl,
            // Nothing has pointed the panel at this run's port, and nothing
            // will until `rotate()` loads it before the first test.
            requireCurrentUrl: false,
            source,
            signal: controller.signal,
            emit,
            releasePreviewReservation,
            emitPreviewFallback: () =>
              emitRunState(event, {
                appId,
                runId,
                source,
                state: "preview-fallback",
                preview: true,
                testFile: normalizedTestFile ?? undefined,
                testLine,
                grep,
              }),
            coreOptions: {
              appId,
              appPath: workspace!.workspacePath,
              baseUrl: testRuntime.baseUrl,
              skipBootstrap: true,
              bootstrapInstalled: prepareResult.installed,
              bootstrapPreviewRouted: prepareResult.previewRouted,
              isolateDatabaseEnv: true,
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
            },
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
            await retainE2eTestArtifacts(workspace!, {
              // A targeted run leaves the untargeted files' rows on screen, and
              // their screenshots live in earlier runs' artifact directories —
              // so the prune has to keep those rather than treat this run's
              // output as a complete replacement.
              replacesEveryResult:
                !normalizedTestFile && testLine === undefined && !grep,
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
          );
          return { ...result, isolation: prepared.isolation };
        } finally {
          if (testRuntime) {
            try {
              // False means a descendant outlived SIGKILL and still holds the
              // workspace as its cwd. Deleting it then leaves a live server
              // serving a deleted tree and holding a port a later run may
              // allocate — and fails outright on Windows. The startup sweep
              // collects it on the next launch instead, once the survivor is
              // gone with the process that spawned it.
              serverStopped = await testRuntime.stop();
            } catch (error) {
              serverStopped = false;
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
    // capture, dependency install, and test-server start all signal
    // cancellation that way. That's
    // an ordinary user cancellation, not an infrastructure failure: return the
    // same structured result the in-run Stop path produces instead of rejecting
    // the IPC call and recording an internal product exception for it.
    if (controller.signal.aborted) {
      finalResult = withIsolationCleanupWarning({
        appId,
        results: [],
        infraError: { message: "Test run stopped." },
        isolation: lastIsolation,
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
      isolation: lastIsolation,
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
    // Before the finished event: the renderer drops the native view as
    // soon as it sees the run go idle, and a still-standing claim would
    // downgrade that teardown into an invisible view nobody owns.
    releasePreviewReservation();
    if (workspace && !serverStopped) {
      // The server tree outlived SIGKILL and still has this directory as its
      // cwd. Deleting it would leave that survivor serving a deleted tree while
      // holding a port a later run may allocate — and fail outright on Windows.
      // The workspace keeps its owner marker, so the next launch's orphan sweep
      // removes it once the survivor is gone with this process.
      logger.warn(
        `Keeping the isolated test workspace for app ${appId}: its server did not stop, so the startup sweep will remove it.`,
      );
    } else if (workspace) {
      // Deleting an installed node_modules tree is tens of thousands of
      // unlinks. The results are
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
