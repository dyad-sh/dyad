import fs from "node:fs";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers how a preview run reaches the Playwright CLI: which flags are dropped,
 * and the endpoint env var the generated fixture shim keys off. The heavy
 * dependencies (database, child processes, Playwright install) are mocked so
 * this stays a unit test of the argument/env construction.
 */

const h = vi.hoisted(() => ({
  spawnStreaming: vi.fn(),
  // `previewRouted` is what tells the run its specs actually reach the shim;
  // without it every case below would degrade to an ordinary browser run.
  ensurePlaywrightBootstrap: vi.fn(async () => ({
    installed: false,
    previewRouted: true,
  })),
  runningApps: new Map<number, { proxyUrl: string }>(),
  findFirst: vi.fn(async () => ({
    id: 1,
    path: "my-app",
    testingEnabled: true,
  })),
}));

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: vi.fn(), getAllWindows: vi.fn(() => []) },
  app: {
    getPath: vi.fn(() => "/tmp/dyad-tests-preview"),
    getAppPath: vi.fn(() => process.cwd()),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

vi.mock("node-pty", () => ({ spawn: vi.fn() }));

// Real behaviour, spied: the assertions below are about which run a child is
// registered against, which a stub returning nothing could not show.
vi.mock("../services/e2e_test_process_registry", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../services/e2e_test_process_registry")
    >();
  return { ...actual, trackE2eTestProcess: vi.fn(actual.trackE2eTestProcess) };
});

vi.mock("../../db", () => ({
  db: { query: { apps: { findFirst: h.findFirst } } },
}));

vi.mock("../utils/spawn_streaming", () => ({
  spawnStreaming: h.spawnStreaming,
}));

vi.mock("../utils/playwright_bootstrap", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/playwright_bootstrap")>()),
  ensurePlaywrightBootstrap: h.ensurePlaywrightBootstrap,
}));

vi.mock("../utils/process_manager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/process_manager")>()),
  runningApps: h.runningApps,
}));

vi.mock("@/paths/paths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/paths/paths")>()),
  getDyadAppPath: (appPath: string) =>
    path.join(os.tmpdir(), "dyad-tests-preview", "apps", appPath),
}));

import {
  buildPlaywrightCliInvocation,
  runAppTestsCore as runAppTestsCoreWithoutToken,
  type RunAppTestsCoreOptions,
} from "./tests_handlers";
import {
  PREVIEW_CDP_ENDPOINT_ENV,
  PREVIEW_CDP_TOKEN_ENV,
} from "../utils/playwright_bootstrap";
import { buildWindowsCommandInvocation } from "../utils/windows_command";
import { trackE2eTestProcess } from "../services/e2e_test_process_registry";

const PROXY_URL = "http://localhost:42101/";
const CDP_ENDPOINT = "http://127.0.0.1:51234";
const CDP_TOKEN = "test-preview-token";
const APP_PATH = path.join(os.tmpdir(), "dyad-tests-preview", "apps", "my-app");

function runAppTestsCore(options: RunAppTestsCoreOptions) {
  return runAppTestsCoreWithoutToken({
    ...options,
    // Both arrive together in production: `runTestsWithPreviewAutomation`
    // builds the token and the rotation from the same automation handle, and
    // the route now refuses an endpoint without a way to point the view at this
    // run's own server. Tests that care about the rotation still pass their own.
    //
    // The default is a convenience for tests about something ELSE, so it must
    // not be read as the fail-closed contract: that path is exercised directly
    // through `runAppTestsCoreWithoutToken` in "refuses the preview route with
    // no way to point the view at the run".
    ...(options.previewCdpEndpoint
      ? {
          previewCdpToken: CDP_TOKEN,
          rotatePreviewView: options.rotatePreviewView ?? vi.fn(async () => {}),
        }
      : {}),
  });
}

function lastSpawn() {
  return h.spawnStreaming.mock.calls.at(-1)![0] as {
    args: string[];
    env: Record<string, string>;
  };
}

beforeEach(() => {
  h.spawnStreaming.mockReset().mockResolvedValue({
    code: 1,
    stdout: "",
    stderr: "no report",
    aborted: false,
    timedOut: false,
  });
  h.ensurePlaywrightBootstrap.mockClear();
  h.runningApps.clear();
  h.runningApps.set(1, { proxyUrl: PROXY_URL });
  fs.mkdirSync(APP_PATH, { recursive: true });
  const playwrightPackagePath = path.join(
    APP_PATH,
    "node_modules",
    "@playwright",
    "test",
    "package.json",
  );
  fs.mkdirSync(path.dirname(playwrightPackagePath), { recursive: true });
  fs.writeFileSync(playwrightPackagePath, "{}");
});

/**
 * Makes spawnStreaming behave like a real preview batch: the discovery pass
 * writes a one-spec report, and the per-test pass writes a passing result.
 *
 * Without this the default mock writes no report at all, so runPreviewTestBatch
 * returns at its discovery-report check and `lastSpawn()` is the `--list`
 * invocation — which would never carry `--headed` or `--workers=` regardless of
 * the code under test, so an assertion against it proves nothing.
 */
function mockPreviewBatch() {
  h.spawnStreaming.mockImplementation(async (options) => {
    const reportPath = options.env.PLAYWRIGHT_JSON_OUTPUT_NAME as string;
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    const specFile = path.join(APP_PATH, "e2e-tests/auth.spec.ts");
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        suites: [
          {
            title: "e2e-tests/auth.spec.ts",
            file: specFile,
            specs: [
              options.args.includes("--list")
                ? {
                    title: "only",
                    line: 3,
                    tests: [{ expectedStatus: "passed" }],
                  }
                : {
                    title: "only",
                    line: 3,
                    tests: [
                      {
                        status: "expected",
                        results: [{ status: "passed", duration: 10 }],
                      },
                    ],
                  },
            ],
          },
        ],
      }),
    );
    return {
      code: 0,
      stdout: "",
      stderr: "",
      aborted: false,
      timedOut: false,
    };
  });
  return vi
    .fn<(timeoutMs?: number) => Promise<void>>()
    .mockResolvedValue(undefined);
}

describe("preview runs", () => {
  it("keeps exact titles out of the Windows batch-file transport", () => {
    const titleGrep = "^shows 100% progress\non completion$";
    const invocation = buildPlaywrightCliInvocation(
      "C:\\app\\node_modules\\@playwright\\test\\cli.js",
      ["test", "-g", titleGrep],
      "win32",
    );

    expect(invocation.command).toBe("node.exe");
    expect(
      buildWindowsCommandInvocation(
        invocation.command,
        invocation.args,
        "win32",
        "cmd.exe",
      ),
    ).toEqual(invocation);
    expect(invocation.args).toContain(titleGrep);
  });

  it("hands the fixture shim the CDP endpoint", async () => {
    await runAppTestsCore({ appId: 1, previewCdpEndpoint: CDP_ENDPOINT });

    expect(lastSpawn().env[PREVIEW_CDP_ENDPOINT_ENV]).toBe(CDP_ENDPOINT);
    expect(lastSpawn().env[PREVIEW_CDP_TOKEN_ENV]).toBe(CDP_TOKEN);
  });

  it("asks the bootstrap to generate the shim", async () => {
    await runAppTestsCore({ appId: 1, previewCdpEndpoint: CDP_ENDPOINT });

    expect(h.ensurePlaywrightBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({ ensurePreviewShim: true }),
    );
  });

  it("drops --headed, which has no meaning without its own browser", async () => {
    const rotatePreviewView = mockPreviewBatch();

    await runAppTestsCore({
      appId: 1,
      headed: true,
      previewCdpEndpoint: CDP_ENDPOINT,
      rotatePreviewView,
    });

    // Discovery, then the one test. Asserted so this stays a claim about the
    // per-test invocation rather than about the `--list` pass.
    expect(h.spawnStreaming).toHaveBeenCalledTimes(2);
    expect(lastSpawn().args).not.toContain("--headed");
  });

  it("keeps Playwright's own recorders off Dyad's windows", async () => {
    const rotatePreviewView = mockPreviewBatch();

    await runAppTestsCore({
      appId: 1,
      previewCdpEndpoint: CDP_ENDPOINT,
      rotatePreviewView,
    });

    expect(h.spawnStreaming).toHaveBeenCalledTimes(2);
    const { args, env } = lastSpawn();
    // A trace of the borrowed context records every page in it, Dyad's own
    // included; the copy-prompt snapshot is taken from the context's FIRST
    // page, which over CDP is a Dyad window rather than the app.
    expect(args).toContain("--trace=off");
    expect(env.PLAYWRIGHT_NO_COPY_PROMPT).toBe("1");
  });

  it("stays serial, since tests take turns driving the preview panel", async () => {
    const rotatePreviewView = mockPreviewBatch();

    await runAppTestsCore({
      appId: 1,
      parallel: true,
      previewCdpEndpoint: CDP_ENDPOINT,
      rotatePreviewView,
    });

    expect(h.spawnStreaming).toHaveBeenCalledTimes(2);
    const { args } = lastSpawn();
    expect(args).not.toContain("--fully-parallel");
    // Pinned to one worker rather than merely left unset: the per-test
    // invocation states the serial guarantee outright, so `parallel: true`
    // reaching this far cannot widen it.
    expect(args).toContain("--workers=1");
    expect(args.filter((arg) => arg.startsWith("--workers="))).toEqual([
      "--workers=1",
    ]);
  });

  it("discovers and runs each test in its own fresh preview", async () => {
    const rotatePreviewView = vi
      .fn<(timeoutMs?: number) => Promise<void>>()
      .mockResolvedValue(undefined);
    const percentTitle = "shows 100% progress\non completion";
    h.spawnStreaming.mockImplementation(async (options) => {
      const reportPath = options.env.PLAYWRIGHT_JSON_OUTPUT_NAME as string;
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      if (options.args.includes("--list")) {
        fs.writeFileSync(
          reportPath,
          JSON.stringify({
            suites: [
              {
                title: "e2e-tests/auth.spec.ts",
                file: path.join(APP_PATH, "e2e-tests/auth.spec.ts"),
                specs: [
                  {
                    title: percentTitle,
                    line: 3,
                    tests: [{ expectedStatus: "passed" }],
                  },
                  {
                    title: "second",
                    line: 7,
                    tests: [{ expectedStatus: "passed" }],
                  },
                  {
                    title: "disabled",
                    line: 11,
                    tests: [{ expectedStatus: "skipped" }],
                  },
                ],
              },
            ],
          }),
        );
        return {
          code: 0,
          stdout: "",
          stderr: "",
          aborted: false,
          timedOut: false,
        };
      }

      const line = options.args.some((arg: string) => arg.endsWith(":3"))
        ? 3
        : 7;
      const title = line === 3 ? percentTitle : "second";
      const failed = line === 3;
      fs.writeFileSync(
        reportPath,
        JSON.stringify({
          suites: [
            {
              file: path.join(APP_PATH, "e2e-tests/auth.spec.ts"),
              specs: [
                {
                  title,
                  line,
                  tests: [
                    {
                      status: failed ? "unexpected" : "expected",
                      results: [
                        {
                          status: failed ? "failed" : "passed",
                          duration: 10,
                          ...(failed
                            ? {
                                error: { message: "expected true to be false" },
                              }
                            : {}),
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      );
      return {
        code: failed ? 1 : 0,
        stdout: "",
        stderr: "",
        aborted: false,
        timedOut: false,
      };
    });

    const result = await runAppTestsCore({
      appId: 1,
      previewCdpEndpoint: CDP_ENDPOINT,
      rotatePreviewView,
    });

    expect(h.spawnStreaming).toHaveBeenCalledTimes(3);
    expect(rotatePreviewView).toHaveBeenCalledTimes(3);
    expect(result.infraError).toBeUndefined();
    expect(result.results).toEqual([
      expect.objectContaining({
        file: "e2e-tests/auth.spec.ts",
        status: "failed",
        tests: [
          expect.objectContaining({ title: percentTitle, status: "failed" }),
          expect.objectContaining({ title: "second", status: "passed" }),
          expect.objectContaining({
            title: "disabled",
            status: "inconclusive",
          }),
        ],
      }),
    ]);

    const testSpawns = h.spawnStreaming.mock.calls
      .slice(1)
      .map(([options]) => options);
    expect(testSpawns[0].env.PLAYWRIGHT_JSON_OUTPUT_NAME).not.toBe(
      testSpawns[1].env.PLAYWRIGHT_JSON_OUTPUT_NAME,
    );
    expect(testSpawns[0].args).toContain("--workers=1");
    expect(
      testSpawns[0].args.some((arg: string) =>
        arg.includes("shows 100% progress\non completion"),
      ),
    ).toBe(true);
    expect(
      testSpawns[0].args.some((arg: string) =>
        /^--output=.*0001[\\/]artifacts$/.test(arg),
      ),
    ).toBe(true);
  });

  it("registers every preview runner against this run, not globally", async () => {
    // Both facts matter. Registration is what lets quit tree-kill the runner
    // and its browser; the OWNER is what stops another app's concurrent run
    // from settling — and so SIGKILLing — this one's processes during its own
    // cleanup.
    const rotatePreviewView = mockPreviewBatch();
    const signal = new AbortController().signal;

    await runAppTestsCore({
      appId: 1,
      previewCdpEndpoint: CDP_ENDPOINT,
      rotatePreviewView,
      signal,
    });

    expect(h.spawnStreaming).toHaveBeenCalledTimes(2);
    for (const [options] of h.spawnStreaming.mock.calls) {
      const child = new EventEmitter() as unknown as ChildProcess;
      options.onProcess?.(child);
      expect(vi.mocked(trackE2eTestProcess)).toHaveBeenCalledWith(
        child,
        signal,
      );
    }
  });

  it("refuses the preview route with no way to point the view at the run", async () => {
    // Fail-closed. `waitForPreviewView` does not check which page a sandboxed
    // run's view is showing, so the rotation is the only thing aiming it at
    // this run's own server — without one the specs would drive the user's
    // real preview, and the real database, and pass.
    const result = await runAppTestsCoreWithoutToken({
      appId: 1,
      previewCdpEndpoint: CDP_ENDPOINT,
      previewCdpToken: CDP_TOKEN,
    });

    expect(result.infraError?.message).toMatch(/can't point the preview/i);
    expect(h.spawnStreaming).not.toHaveBeenCalled();
  });
});

describe("a preview run the shim couldn't be routed for", () => {
  it("falls back to a visible browser instead of a silent headless run", async () => {
    // The app owns e2e-tests/tsconfig.json, so its specs import the real
    // @playwright/test and launch a browser of their own. Every decision keyed
    // on the endpoint has to follow, or the user watches an empty preview
    // while an invisible browser runs.
    const onPreviewFallback = vi.fn();
    h.ensurePlaywrightBootstrap.mockResolvedValueOnce({
      installed: false,
      previewRouted: false,
    });

    await runAppTestsCore({
      appId: 1,
      headed: true,
      previewCdpEndpoint: CDP_ENDPOINT,
      onPreviewFallback,
    });

    const { args, env } = lastSpawn();
    expect(args).toContain("--headed");
    expect(env[PREVIEW_CDP_ENDPOINT_ENV]).toBeUndefined();
    // And the preview view is handed back, not held frozen for a run that
    // isn't happening there.
    expect(onPreviewFallback).toHaveBeenCalled();
  });

  it("parallelizes as the user asked, since it is an ordinary browser run now", async () => {
    // The preview is the only reason to force serial. Once routing is refused
    // this is a normal browser run, and staying serial would silently ignore
    // Parallel — which the renderer cannot decide for itself, because only
    // main knows whether the app's tsconfig let the run into the preview.
    h.ensurePlaywrightBootstrap.mockResolvedValueOnce({
      installed: false,
      previewRouted: false,
    });

    await runAppTestsCore({
      appId: 1,
      headed: true,
      parallel: true,
      previewCdpEndpoint: CDP_ENDPOINT,
    });

    expect(lastSpawn().args).toContain("--fully-parallel");
  });
});

describe("post-batch preview teardown", () => {
  it("does not turn a green run into an infrastructure failure", async () => {
    // The rotation after the last test is cosmetic — it hands the user a clean
    // page — and by then every result is already aggregated. Reporting its
    // failure as an infraError made a fully passing run read as inconclusive,
    // which costs an agent a fix attempt for nothing.
    const rotatePreviewView = vi
      .fn<(timeoutMs?: number) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("preview view never loaded"));
    mockPreviewBatch();

    const result = await runAppTestsCore({
      appId: 1,
      previewCdpEndpoint: CDP_ENDPOINT,
      rotatePreviewView,
    });

    expect(rotatePreviewView).toHaveBeenCalledTimes(2);
    expect(result.infraError).toBeUndefined();
    expect(result.results).toEqual([
      expect.objectContaining({ file: "e2e-tests/auth.spec.ts" }),
    ]);
  });

  it("gives teardown a fixed budget rather than the run's leftovers", async () => {
    // Billed against the remaining wall clock, a batch that used most of its
    // budget left the replacement view a few hundred milliseconds to load, so
    // the longer the run, the likelier a clean result was overwritten.
    const rotatePreviewView = vi
      .fn<(timeoutMs?: number) => Promise<void>>()
      .mockResolvedValue(undefined);
    mockPreviewBatch();

    await runAppTestsCore({
      appId: 1,
      previewCdpEndpoint: CDP_ENDPOINT,
      rotatePreviewView,
      timeoutMs: 60_000,
    });

    const teardownBudget = rotatePreviewView.mock.calls.at(-1)![0];
    expect(teardownBudget).toBe(5_000);
  });
});

describe("ordinary runs are untouched", () => {
  it("never sets the endpoint env var or requests the shim", async () => {
    await runAppTestsCore({ appId: 1 });

    expect(lastSpawn().env[PREVIEW_CDP_ENDPOINT_ENV]).toBeUndefined();
    expect(h.ensurePlaywrightBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({ ensurePreviewShim: false }),
    );
  });

  it("still honors headed and parallel", async () => {
    await runAppTestsCore({ appId: 1, headed: true, parallel: true });

    const { args } = lastSpawn();
    expect(args).toContain("--headed");
    expect(args).toContain("--fully-parallel");
  });
});
