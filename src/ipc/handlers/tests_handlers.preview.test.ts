// @vitest-environment node
import fs from "node:fs";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers how a preview run reaches the Playwright CLI: which flags are dropped,
 * and the endpoint env var the generated fixture shim keys off. The heavy
 * dependencies (database, child processes, Playwright install) are mocked so
 * most cases stay unit tests of argument/env construction. The symlink cases
 * run the real Playwright CLI with browser-free specs to verify path semantics.
 */

const h = vi.hoisted(() => ({
  spawnStreaming: vi.fn(),
  prepareIsolation: vi.fn(),
  readSettings: vi.fn(),
  createWorkspace: vi.fn(),
  installDependencies: vi.fn(),
  retainArtifacts: vi.fn(),
  startRuntime: vi.fn(),
  broadcast: vi.fn(),
  getDyadAppPath: vi.fn(),
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

vi.mock("@/main/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main/settings")>()),
  readSettings: h.readSettings,
}));

vi.mock("../services/e2e_test_workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/e2e_test_workspace")>()),
  createE2eTestWorkspace: h.createWorkspace,
  installE2eTestWorkspaceDependencies: h.installDependencies,
  retainE2eTestArtifacts: h.retainArtifacts,
}));

vi.mock("../services/e2e_test_runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/e2e_test_runtime")>()),
  startE2eTestRuntime: h.startRuntime,
}));

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

vi.mock("../services/isolated_test_db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/isolated_test_db")>()),
  prepareIsolatedTestDatabase: h.prepareIsolation,
}));

vi.mock("../utils/window_broadcast", () => ({
  broadcastToRegisteredWindows: h.broadcast,
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
  getDyadAppPath: h.getDyadAppPath,
}));

import {
  buildPlaywrightCliInvocation,
  runAppTestsCore as runAppTestsCoreWithoutToken,
  runAppTestsWithIsolation,
  type RunAppTestsCoreOptions,
} from "./tests_handlers";
import {
  PREVIEW_CDP_ENDPOINT_ENV,
  PREVIEW_CDP_TOKEN_ENV,
  DYAD_CONFIG_FILENAME,
} from "../utils/playwright_bootstrap";
import { buildWindowsCommandInvocation } from "../utils/windows_command";
import {
  TEST_CASE_ENDPOINT_ENV,
  TEST_CASE_TOKEN_ENV,
} from "../services/test_case_lifecycle_server";
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
  h.findFirst.mockReset().mockResolvedValue({
    id: 1,
    path: "my-app",
    testingEnabled: true,
  });
  h.readSettings
    .mockReset()
    .mockReturnValue({ disableSandboxedE2eTests: true });
  h.createWorkspace.mockReset().mockResolvedValue({
    workspacePath: APP_PATH,
    artifactPath: path.join(APP_PATH, "retained-artifacts"),
    dispose: vi.fn().mockResolvedValue(undefined),
  });
  h.installDependencies.mockReset().mockResolvedValue(undefined);
  h.retainArtifacts.mockReset().mockResolvedValue(undefined);
  h.startRuntime.mockReset().mockResolvedValue({
    baseUrl: "http://127.0.0.1:49999",
    stop: vi.fn().mockResolvedValue(true),
  });
  h.getDyadAppPath.mockReturnValue(APP_PATH);
  h.prepareIsolation.mockReset();
  h.broadcast.mockReset();
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

describe("selected file batches", () => {
  const selected = ["e2e-tests/a(legacy).spec.ts", "e2e-tests/b.spec.ts"];
  const candidates = [
    ...selected,
    "e2e-tests/b.spec.tsx",
    "e2e-tests/nested/e2e-tests/b.spec.ts",
  ];

  it.each(["batch", "panel", "preview", "sandbox"])(
    "runs real Playwright from a symlinked app directory (%s)",
    async (mode) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-symlink-run-"));
      try {
        const physical = path.join(root, "physical");
        const linked = path.join(root, "linked");
        fs.mkdirSync(path.join(physical, "e2e-tests"), { recursive: true });
        fs.symlinkSync(physical, linked, "junction");
        fs.symlinkSync(
          path.join(process.cwd(), "node_modules"),
          path.join(physical, "node_modules"),
          "junction",
        );
        fs.writeFileSync(
          path.join(physical, DYAD_CONFIG_FILENAME),
          'export default { testDir: "./e2e-tests" };',
        );
        fs.writeFileSync(
          path.join(physical, selected[0]),
          'const { test, expect } = require("@playwright/test");\ntest("works", () => { expect(1).toBe(1); });\ntest.skip("disabled", () => {});\n',
        );
        h.getDyadAppPath.mockReturnValue(
          mode === "sandbox" ? APP_PATH : linked,
        );
        h.spawnStreaming.mockImplementation(async (options) => {
          const { stdout, stderr } = await promisify(execFile)(
            process.execPath,
            options.args,
            {
              cwd: options.cwd,
              env: { ...process.env, ...options.env },
              timeout: 15_000,
            },
          );
          return { code: 0, stdout, stderr, aborted: false, timedOut: false };
        });

        const result = await runAppTestsCore({
          appId: 1,
          ...(mode === "sandbox"
            ? {
                appPath: linked,
                baseUrl: "http://127.0.0.1:49999",
                skipBootstrap: true,
              }
            : {}),
          ...(mode === "panel"
            ? { testFile: selected[0], testLine: 2 }
            : { testFiles: [selected[0]] }),
          ...(mode === "preview"
            ? {
                previewCdpEndpoint: CDP_ENDPOINT,
                rotatePreviewView: vi.fn().mockResolvedValue(undefined),
              }
            : {}),
        });

        expect(result.infraError).toBeUndefined();
        if (mode === "sandbox") {
          expect(h.ensurePlaywrightBootstrap).not.toHaveBeenCalled();
          expect(lastSpawn().env.DYAD_TEST_BASE_URL).toBe(
            "http://127.0.0.1:49999",
          );
        }
        expect(result.results).toHaveLength(1);
        expect(result.results[0].file).toBe(selected[0]);
        expect(result.results[0].incomplete).toBeUndefined();
        expect(result.results[0].tests).toContainEqual(
          expect.objectContaining({ title: "works", status: "passed" }),
        );
        if (mode !== "panel") {
          expect(result.results[0].tests).toHaveLength(2);
          expect(result.results[0].tests).toContainEqual(
            expect.objectContaining({
              title: "disabled",
              status: "inconclusive",
            }),
          );
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
    30_000,
  );

  function mockReports(casesInSecondFile = 1, includeSkipped = false) {
    h.spawnStreaming.mockImplementation(async (options) => {
      const selectors = (options.args as string[]).filter((arg) =>
        arg.startsWith("^"),
      );
      const files = candidates.filter((file) =>
        selectors.some((selector) =>
          new RegExp(selector.replace(/:\d+$/, "")).test(
            path.resolve(options.cwd, file),
          ),
        ),
      );
      const reportFile = options.env.PLAYWRIGHT_JSON_OUTPUT_NAME as string;
      const reportPath = path.resolve(options.cwd, reportFile);
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(
        reportPath,
        JSON.stringify({
          config: { rootDir: path.join(options.cwd, "e2e-tests") },
          suites: files.map((file) => ({
            title: file,
            file: file.slice("e2e-tests/".length),
            specs: [
              ...(includeSkipped && file === selected[0]
                ? [
                    {
                      title: "disabled case",
                      line: 1,
                      tests: [{ expectedStatus: "skipped" }],
                    },
                  ]
                : []),
              ...Array.from(
                { length: file === selected[1] ? casesInSecondFile : 1 },
                (_, index) => ({
                  title: `checks login ${index}`,
                  line: 3 + index * 4,
                  tests: options.args.includes("--list")
                    ? [{ expectedStatus: "passed" }]
                    : [
                        {
                          status: "expected",
                          results: [{ status: "passed", duration: 10 }],
                        },
                      ],
                }),
              ),
            ].filter(
              (spec) =>
                options.args.includes("--list") ||
                !selectors.some((selector) => /:\d+$/.test(selector)) ||
                selectors.some((selector) =>
                  selector.endsWith(`:${spec.line}`),
                ),
            ),
          })),
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
  }

  it("passes exact escaped file selectors to one browser process", async () => {
    mockReports();
    const result = await runAppTestsCore({
      appId: 1,
      testFiles: [...selected, selected[0]],
      grep: "login",
      timeoutMs: 600_000,
    });
    expect(result.results.map((result) => result.file)).toEqual(selected);
    expect(h.spawnStreaming).toHaveBeenCalledTimes(1);
    expect(lastSpawn().args.filter((arg) => arg.startsWith("^"))).toHaveLength(
      2,
    );
    expect(lastSpawn().args).toContain("-g");
    expect(lastSpawn().args).toContain("login");
    expect(h.spawnStreaming.mock.calls[0][0].timeoutMs).toBe(600_000);
  });

  it.each([
    { testFile: selected[0] },
    { testFiles: [selected[0]] },
    { testFile: selected[0], testLine: 3 },
  ])(
    "preserves single-file and panel line selection: %j",
    async (selection) => {
      mockReports();
      const result = await runAppTestsCore({ appId: 1, ...selection });
      expect(result.results.map((result) => result.file)).toEqual([
        selected[0],
      ]);
      const selectors = lastSpawn().args.filter((arg) => arg.startsWith("^"));
      expect(selectors).toHaveLength(1);
      expect(selectors[0].endsWith(":3")).toBe("testLine" in selection);
    },
  );

  it("discovers only selected preview files and executes their cases serially", async () => {
    mockReports();
    const rotatePreviewView = vi.fn().mockResolvedValue(undefined);
    const result = await runAppTestsCore({
      appId: 1,
      testFiles: selected,
      previewCdpEndpoint: CDP_ENDPOINT,
      rotatePreviewView,
      parallel: true,
      grep: "login",
      timeoutMs: 600_000,
    });
    expect(result.results.map((result) => result.file)).toEqual(selected);
    expect(h.spawnStreaming).toHaveBeenCalledTimes(3);
    const [discovery, ...executions] = h.spawnStreaming.mock.calls.map(
      ([options]) => options,
    );
    expect(discovery.args).toContain("--list");
    expect(
      discovery.args.filter((arg: string) => arg.startsWith("^")),
    ).toHaveLength(2);
    expect(discovery.args).toContain("login");
    for (const execution of executions) {
      expect(execution.args).toContain("--workers=1");
      expect(execution.args).not.toContain("--fully-parallel");
      expect(execution.timeoutMs).toBeLessThanOrEqual(discovery.timeoutMs);
    }
    expect(rotatePreviewView).toHaveBeenCalledTimes(3);
  });

  it.each(["cancel", "timeout"])(
    "preserves complete files and marks partially executed preview files after %s",
    async (reason) => {
      mockReports(2);
      const report = h.spawnStreaming.getMockImplementation()!;
      let executions = 0;
      h.spawnStreaming.mockImplementation(async (options) => {
        if (!options.args.includes("--list") && ++executions === 3) {
          return {
            code: 1,
            stdout: "",
            stderr: "",
            aborted: reason === "cancel",
            timedOut: reason === "timeout",
          };
        }
        return report(options);
      });
      const result = await runAppTestsCore({
        appId: 1,
        testFiles: selected,
        previewCdpEndpoint: CDP_ENDPOINT,
        rotatePreviewView: vi.fn().mockResolvedValue(undefined),
        timeoutMs: 600_000,
      });
      expect(result.infraError?.message).toMatch(
        reason === "cancel" ? /stopped/ : /10-minute limit/,
      );
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toMatchObject({
        file: selected[0],
        status: "passed",
      });
      expect(result.results[0].incomplete).toBeUndefined();
      expect(result.results[1]).toMatchObject({
        file: selected[1],
        status: "passed",
        incomplete: true,
      });
      expect(result.results[1].tests).toHaveLength(1);
    },
  );

  it("keeps skipped and executed cases in one preview file result", async () => {
    mockReports(1, true);
    const result = await runAppTestsCore({
      appId: 1,
      testFiles: selected,
      previewCdpEndpoint: CDP_ENDPOINT,
      rotatePreviewView: vi.fn().mockResolvedValue(undefined),
    });

    expect(result.infraError).toBeUndefined();
    expect(result.results.map((result) => result.file)).toEqual(selected);
    expect(result.results[0].tests).toEqual([
      expect.objectContaining({
        title: "disabled case",
        status: "inconclusive",
      }),
      expect.objectContaining({ title: "checks login 0", status: "passed" }),
    ]);
    expect(h.spawnStreaming).toHaveBeenCalledTimes(3);
  });

  it.each([
    { testFiles: [] },
    { testFiles: [selected[0], "../escape.spec.ts"] },
    { testFiles: selected, testFile: selected[0] },
    { testFiles: selected, testLine: 3 },
  ])(
    "refuses malformed selections before bootstrap or isolation: %j",
    async (selection) => {
      const core = await runAppTestsCore({ appId: 1, ...selection });
      const isolated = await runAppTestsWithIsolation({
        appId: 1,
        event: { sender: {} } as any,
        source: "agent",
        ...selection,
      });
      expect(core.infraError).toBeDefined();
      expect(isolated.infraError).toBeDefined();
      expect(h.ensurePlaywrightBootstrap).not.toHaveBeenCalled();
      expect(h.prepareIsolation).not.toHaveBeenCalled();
      expect(h.spawnStreaming).not.toHaveBeenCalled();
    },
  );

  it("owns one batch setup and announces the same selection throughout", async () => {
    mockReports();
    const teardown = vi
      .fn()
      .mockResolvedValue({ envRestored: true, remoteCleanupCompleted: true });
    h.prepareIsolation.mockResolvedValue({
      isolation: { mode: "neon-branch" },
      teardown,
    });
    const result = await runAppTestsWithIsolation({
      appId: 1,
      event: { sender: {} } as any,
      source: "agent",
      testFiles: selected,
    });
    expect(result.results.map((result) => result.file)).toEqual(selected);
    expect(h.prepareIsolation).toHaveBeenCalledTimes(1);
    expect(teardown).toHaveBeenCalledTimes(1);
    const events = h.broadcast.mock.calls
      .filter(([, channel]) => channel === "tests:run-state")
      .map(([, , payload]) => payload);
    expect(events.map((event) => event.state)).toEqual([
      "started",
      "cleaning-up",
      "finished",
    ]);
    for (const event of events) expect(event.testFiles).toEqual(selected);
    expect(new Set(events.map((event) => event.runId)).size).toBe(1);
  });

  it.each(["preview", "sandbox"])(
    "provisions and cleans up each case and retry across selected files (%s)",
    async (route) => {
      h.readSettings.mockReturnValue({
        disableSandboxedE2eTests: route === "preview",
      });
      h.findFirst.mockImplementation(async () => ({
        id: 1,
        path: "my-app",
        testingEnabled: true,
        supabaseProjectId: "project",
      }));
      mockReports();
      const reportSpawn = h.spawnStreaming.getMockImplementation()!;
      const lifecycleCalls: string[] = [];
      let userNumber = 0;
      h.prepareIsolation.mockResolvedValue({
        isolation: { mode: "neon-branch" },
        testCaseLifecycle: {
          beforeEach: vi.fn(async () => {
            lifecycleCalls.push("before");
            return { DYAD_TEST_USER_EMAIL: `user-${++userNumber}@dyad.test` };
          }),
          afterEach: vi.fn(async () => {
            lifecycleCalls.push("after");
          }),
        },
        teardown: vi.fn(async () => {
          lifecycleCalls.push("teardown");
          return { envRestored: true, remoteCleanupCompleted: true };
        }),
      });
      const emails: string[] = [];
      h.spawnStreaming.mockImplementation(async (options) => {
        expect(options.args).toContain("--workers=1");
        expect(options.args).not.toContain("--fully-parallel");
        // Exercise the fixture's protocol for a case, its retry, then another file.
        for (const attempt of ["file-a-case", "file-a-retry", "file-b-case"]) {
          for (const phase of ["before", "after"]) {
            const response = await fetch(
              `${options.env[TEST_CASE_ENDPOINT_ENV]}/${phase}/${attempt}`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${options.env[TEST_CASE_TOKEN_ENV]}`,
                },
              },
            );
            expect(response.status).toBe(200);
            const credentials = await response.json();
            if (phase === "before")
              emails.push(credentials.DYAD_TEST_USER_EMAIL);
          }
        }
        return reportSpawn(options);
      });

      const result = await runAppTestsWithIsolation({
        appId: 1,
        event: { sender: {} } as any,
        source: "agent",
        testFiles: selected,
        parallel: true,
      });

      expect(result.infraError).toBeUndefined();
      expect(result.results.map((result) => result.file)).toEqual(selected);
      expect(h.prepareIsolation).toHaveBeenCalledTimes(1);
      expect(h.prepareIsolation).toHaveBeenCalledWith(
        expect.objectContaining({ perTestCase: true }),
      );
      if (route === "sandbox") {
        expect(h.createWorkspace).toHaveBeenCalledTimes(1);
        expect(h.installDependencies).toHaveBeenCalledTimes(1);
        expect(h.startRuntime).toHaveBeenCalledTimes(1);
        expect(h.prepareIsolation).toHaveBeenCalledWith(
          expect.objectContaining({
            appPathOverride: APP_PATH,
            restartApp: false,
          }),
        );
        expect(h.retainArtifacts).toHaveBeenCalledWith(expect.anything(), {
          replacesEveryResult: false,
        });
      } else {
        expect(h.createWorkspace).not.toHaveBeenCalled();
      }
      expect(h.ensurePlaywrightBootstrap).toHaveBeenCalledWith(
        expect.objectContaining({ isolateTestCases: true }),
      );
      expect(emails).toEqual([
        "user-1@dyad.test",
        "user-2@dyad.test",
        "user-3@dyad.test",
      ]);
      expect(lifecycleCalls).toEqual([
        "before",
        "after",
        "before",
        "after",
        "before",
        "after",
        "teardown",
      ]);
    },
  );

  it.each(["cancel", "timeout"])(
    "cleans up the entire batch after %s",
    async (reason) => {
      const controller = new AbortController();
      const teardown = vi
        .fn()
        .mockResolvedValue({ envRestored: true, remoteCleanupCompleted: true });
      h.prepareIsolation.mockResolvedValue({
        isolation: { mode: "neon-branch" },
        teardown,
      });
      h.spawnStreaming.mockImplementation(async (options) => {
        if (reason === "cancel") controller.abort();
        expect(options.signal.aborted).toBe(reason === "cancel");
        return {
          code: 1,
          stdout: "",
          stderr: "",
          aborted: reason === "cancel",
          timedOut: reason === "timeout",
        };
      });
      const result = await runAppTestsWithIsolation({
        appId: 1,
        event: { sender: {} } as any,
        source: "agent",
        testFiles: selected,
        externalSignal: controller.signal,
        timeoutMs: 600_000,
      });
      expect(result.results).toEqual([]);
      expect(result.infraError?.message).toMatch(
        reason === "cancel" ? /stopped/ : /10-minute limit/,
      );
      expect(h.prepareIsolation).toHaveBeenCalledTimes(1);
      expect(teardown).toHaveBeenCalledTimes(1);
      const finished = h.broadcast.mock.calls.filter(
        ([, channel, payload]) =>
          channel === "tests:run-state" && payload.state === "finished",
      );
      expect(finished).toHaveLength(1);
      expect(finished[0][2].testFiles).toEqual(selected);
    },
  );
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
    const specFile = path.join(options.cwd, "e2e-tests/auth.spec.ts");
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

  it("pins node.exe on win32 so grep never routes through cmd.exe", () => {
    // Regression guard for the agent's run_tests validateGrep, which dropped
    // its Windows `%`/newline preflight guards because the spawn no longer
    // touches cmd.exe. That is safe only while `command` stays `node.exe`: a
    // bare `node` is rewritten to `node.cmd` by resolveWindowsExecutableName,
    // which routes grep back through `cmd.exe /d /s /c` and makes
    // quoteWindowsCmdArg throw on `%`/CR/LF mid-run. Fail here, not there.
    const winInvocation = buildPlaywrightCliInvocation(
      "C:\\app\\node_modules\\@playwright\\test\\cli.js",
      ["test", "-g", "shows 50% off"],
      "win32",
    );
    expect(winInvocation.command).toBe("node.exe");
    // Must NOT be wrapped in a cmd.exe /d /s /c invocation.
    expect(
      buildWindowsCommandInvocation(
        winInvocation.command,
        winInvocation.args,
        "win32",
        "cmd.exe",
      ),
    ).toEqual(winInvocation);

    // Non-Windows platforms use bare `node` (no `.cmd` shim there).
    const nixInvocation = buildPlaywrightCliInvocation(
      "/app/node_modules/@playwright/test/cli.js",
      ["test", "-g", "shows 50% off"],
      "darwin",
    );
    expect(nixInvocation.command).toBe("node");
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
                file: path.join(options.cwd, "e2e-tests/auth.spec.ts"),
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
              file: path.join(options.cwd, "e2e-tests/auth.spec.ts"),
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
  it("routes database-isolated headless runs through the fixture and forces one worker", async () => {
    await runAppTestsCore({ appId: 1, isolateTestCases: true, parallel: true });
    expect(h.ensurePlaywrightBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({
        ensurePreviewShim: false,
        isolateTestCases: true,
      }),
    );
    expect(lastSpawn().args).toContain("--workers=1");
    expect(lastSpawn().args).not.toContain("--fully-parallel");
  });

  it("refuses isolated cases when the app's imports bypass the fixture", async () => {
    h.ensurePlaywrightBootstrap.mockResolvedValueOnce({
      installed: false,
      previewRouted: false,
    });
    const result = await runAppTestsCore({ appId: 1, isolateTestCases: true });
    expect(result.infraError?.message).toContain(
      "Per-test database isolation requires",
    );
    expect(h.spawnStreaming).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "scales explicit run budgets for isolation (%s)",
    async (isolateTestCases) => {
      h.spawnStreaming.mockResolvedValueOnce({
        code: 1,
        stdout: "",
        stderr: "",
        timedOut: true,
      });
      const result = await runAppTestsCore({
        appId: 1,
        isolateTestCases,
        timeoutMs: 600_000,
      });
      expect(h.spawnStreaming).toHaveBeenLastCalledWith(
        expect.objectContaining({
          timeoutMs: isolateTestCases ? 1_800_000 : 600_000,
        }),
      );
      expect(result.infraError?.message).toContain(
        isolateTestCases ? "30-minute" : "10-minute",
      );
    },
  );

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
