import fs from "node:fs";
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
  runAppTestsCore,
} from "./tests_handlers";
import { PREVIEW_CDP_ENDPOINT_ENV } from "../utils/playwright_bootstrap";
import { buildWindowsCommandInvocation } from "../utils/windows_command";

const PROXY_URL = "http://localhost:42101/";
const CDP_ENDPOINT = "http://127.0.0.1:51234";
const APP_PATH = path.join(os.tmpdir(), "dyad-tests-preview", "apps", "my-app");

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
  });

  it("asks the bootstrap to generate the shim", async () => {
    await runAppTestsCore({ appId: 1, previewCdpEndpoint: CDP_ENDPOINT });

    expect(h.ensurePlaywrightBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({ ensurePreviewShim: true }),
    );
  });

  it("drops --headed, which has no meaning without its own browser", async () => {
    await runAppTestsCore({
      appId: 1,
      headed: true,
      previewCdpEndpoint: CDP_ENDPOINT,
    });

    expect(lastSpawn().args).not.toContain("--headed");
  });

  it("keeps Playwright's own recorders off Dyad's windows", async () => {
    await runAppTestsCore({ appId: 1, previewCdpEndpoint: CDP_ENDPOINT });

    const { args, env } = lastSpawn();
    // A trace of the borrowed context records every page in it, Dyad's own
    // included; the copy-prompt snapshot is taken from the context's FIRST
    // page, which over CDP is a Dyad window rather than the app.
    expect(args).toContain("--trace=off");
    expect(env.PLAYWRIGHT_NO_COPY_PROMPT).toBe("1");
  });

  it("stays serial, since tests take turns driving the preview panel", async () => {
    await runAppTestsCore({
      appId: 1,
      parallel: true,
      previewCdpEndpoint: CDP_ENDPOINT,
    });

    const { args } = lastSpawn();
    expect(args).not.toContain("--fully-parallel");
    expect(args.some((arg) => arg.startsWith("--workers="))).toBe(false);
  });

  it("discovers and runs each test in its own fresh preview", async () => {
    const rotatePreviewView = vi.fn(async () => {});
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
        /^--output=.*0001\/artifacts$/.test(arg),
      ),
    ).toBe(true);
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
