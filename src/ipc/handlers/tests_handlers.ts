import fs from "node:fs";
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
import type { RunAppTestsResult, TestResult } from "../types/tests";
import { runningApps } from "../utils/process_manager";
import { safeSend } from "../utils/safe_sender";
import { spawnStreaming } from "../utils/spawn_streaming";
import {
  ensurePlaywrightBootstrap,
  TEST_BASE_URL_ENV,
  TEST_RESULTS_JSON,
} from "../utils/playwright_bootstrap";
import { parsePlaywrightReport } from "../utils/playwright_report";
import { sendTelemetryEvent } from "../utils/telemetry";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("tests_handlers");

// A test file must look exactly like the spec paths `listAppTests` produces:
// relative, under `tests/`, ending in a spec extension, with no traversal or
// leading dash. This stops a compromised renderer from passing a flag-like
// value (e.g. `--config=…`) that Playwright would interpret as a CLI option.
const TEST_FILE_PATTERN = /^tests\/(?!.*\.\.)[\w\-./]+\.spec\.(ts|tsx|js|jsx)$/;

// Abort controllers for in-flight runs, keyed by appId, so the Stop button can
// cancel an in-progress bootstrap or test run.
const testRunControllers = new Map<number, AbortController>();

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
    const specs = matches
      .sort((a, b) => a.localeCompare(b))
      .map((file) => ({ file }));
    return { specs };
  });

  createTypedHandler(testsContracts.stopAppTests, async (_event, params) => {
    const controller = testRunControllers.get(params.appId);
    if (controller) {
      controller.abort();
    }
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
      let realPath: string;
      try {
        realPath = fs.realpathSync(resolved);
      } catch (error) {
        logger.warn(`Failed to resolve screenshot path ${resolved}: ${error}`);
        return { dataUrl: null };
      }
      const rel = path.relative(appPath, realPath);
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
      const { appId, testFile } = params;
      const app = await getApp(appId);
      const appPath = getDyadAppPath(app.path);

      // Reject anything that doesn't look like one of our spec paths before it
      // reaches the Playwright CLI (the Zod schema only checks it's a string).
      if (testFile !== undefined && !TEST_FILE_PATTERN.test(testFile)) {
        return {
          appId,
          results: [],
          infraError: {
            message: `Invalid test file: ${testFile}`,
          },
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

      // Cancel any prior run for this app, then start a fresh controller.
      testRunControllers.get(appId)?.abort();
      const controller = new AbortController();
      testRunControllers.set(appId, controller);

      try {
        // 1. Lazy bootstrap (install Playwright + browser, write config), streamed.
        let installed = false;
        try {
          const result = await ensurePlaywrightBootstrap({
            appPath,
            signal: controller.signal,
            onOutput: (chunk) => emitOutput(event, appId, chunk, "setup"),
          });
          installed = result.installed;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.error(`Playwright bootstrap failed: ${message}`);
          return { appId, results: [], infraError: { message } };
        }

        if (controller.signal.aborted) {
          return {
            appId,
            results: [],
            infraError: { message: "Test run stopped." },
          };
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
        // interpreted as a shell command.
        const args = ["playwright", "test"];
        if (testFile) {
          args.push(testFile);
        }
        args.push("--reporter=list,json");

        const run = await spawnStreaming({
          command: "npx",
          args,
          cwd: appPath,
          env: {
            ...process.env,
            [TEST_BASE_URL_ENV]: baseUrl,
            PLAYWRIGHT_JSON_OUTPUT_NAME: TEST_RESULTS_JSON,
            // Non-interactive: never try to open/serve an HTML report.
            CI: "true",
          },
          signal: controller.signal,
          onOutput: (chunk) => emitOutput(event, appId, chunk, "running"),
        });

        if (run.aborted) {
          return {
            appId,
            results: [],
            infraError: { message: "Test run stopped." },
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
        });

        return { appId, results };
      } finally {
        if (testRunControllers.get(appId) === controller) {
          testRunControllers.delete(appId);
        }
      }
    },
  );

  logger.debug("Registered tests IPC handlers");
}
