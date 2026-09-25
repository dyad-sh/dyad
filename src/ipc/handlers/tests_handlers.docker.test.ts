// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Docker mode must run Playwright in the guest, never on the host: the app's
 * `@playwright/test`, its config, and its specs are app-controlled code. These
 * cases pin that the runner goes through the guest runner (with the right
 * image, network, and a minimal environment) and that host mode is unchanged.
 */

const h = vi.hoisted(() => ({
  spawnStreaming: vi.fn(),
  runGuestStreaming: vi.fn(),
  appGuestInput: vi.fn(async (input: Record<string, unknown>) => input),
  prepareIsolation: vi.fn(),
  startCaseServer: vi.fn(),
  readSettings: vi.fn(),
  broadcast: vi.fn(),
  getDyadAppPath: vi.fn(),
  fromWebContents: vi.fn(),
  ensurePlaywrightBootstrap: vi.fn(async () => ({
    installed: false,
    previewRouted: true,
  })),
  runningApps: new Map<number, { proxyUrl: string; mode: string }>(),
  findFirst: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    fromWebContents: h.fromWebContents,
    getAllWindows: vi.fn(() => []),
  },
  app: {
    getPath: vi.fn(() => "/tmp/dyad-tests-docker"),
    getAppPath: vi.fn(() => process.cwd()),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

vi.mock("node-pty", () => ({ spawn: vi.fn() }));

vi.mock("@/main/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/main/settings")>()),
  readSettings: h.readSettings,
}));

vi.mock("../../db", () => ({
  db: { query: { apps: { findFirst: h.findFirst } } },
}));

vi.mock("../utils/spawn_streaming", () => ({
  spawnStreaming: h.spawnStreaming,
}));

vi.mock("../services/docker_runtime/guest_command", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../services/docker_runtime/guest_command")
  >()),
  appGuestInput: h.appGuestInput,
  runGuestStreaming: h.runGuestStreaming,
}));

vi.mock("../services/isolated_test_db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/isolated_test_db")>()),
  prepareIsolatedTestDatabase: h.prepareIsolation,
}));

vi.mock("../services/test_case_lifecycle_server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../services/test_case_lifecycle_server")
  >()),
  startTestCaseLifecycleServer: h.startCaseServer,
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

import { runAppTestsCore, runAppTestsWithIsolation } from "./tests_handlers";
import {
  TEST_BASE_URL_ENV,
  TEST_RESULTS_JSON,
} from "../utils/playwright_bootstrap";
import {
  TEST_CASE_ENDPOINT_ENV,
  TEST_CASE_TOKEN_ENV,
} from "../services/test_case_lifecycle_server";
import { getAppPort } from "../../../shared/ports";

const ROOT = fs.realpathSync(os.tmpdir());
const APP_PATH = path.join(ROOT, "dyad-tests-docker", "apps", "my-app");
const SPEC = "e2e-tests/login.spec.ts";

function writeReport(appPath: string) {
  const reportPath = path.join(appPath, TEST_RESULTS_JSON);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify({
      config: { rootDir: path.join(appPath, "e2e-tests") },
      suites: [
        {
          title: SPEC,
          file: "login.spec.ts",
          specs: [
            {
              title: "logs in",
              line: 3,
              tests: [
                {
                  status: "unexpected",
                  results: [
                    {
                      status: "failed",
                      duration: 10,
                      attachments: [
                        {
                          name: "screenshot",
                          path: path.join(appPath, "test-results/shot.png"),
                        },
                      ],
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
}

function lastGuestInput() {
  return h.runGuestStreaming.mock.calls.at(-1)![0] as {
    appId: number;
    appPath: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    image: string;
    joinNetworkOf?: string;
  };
}

beforeEach(() => {
  fs.rmSync(APP_PATH, { recursive: true, force: true });
  fs.mkdirSync(path.join(APP_PATH, "e2e-tests"), { recursive: true });
  // A stale Local-mode install: Docker mode must never resolve or run it.
  const stalePackage = path.join(
    APP_PATH,
    "node_modules",
    "@playwright",
    "test",
    "package.json",
  );
  fs.mkdirSync(path.dirname(stalePackage), { recursive: true });
  fs.writeFileSync(stalePackage, "{}");

  h.findFirst.mockReset().mockResolvedValue({
    id: 1,
    path: "my-app",
    testingEnabled: true,
  });
  h.readSettings.mockReset().mockReturnValue({ runtimeMode2: "docker" });
  h.getDyadAppPath.mockReset().mockReturnValue(APP_PATH);
  h.prepareIsolation.mockReset().mockResolvedValue({
    isolation: { mode: "none" },
    teardown: vi.fn().mockResolvedValue({ remoteCleanupCompleted: true }),
  });
  h.startCaseServer.mockReset();
  h.broadcast.mockReset();
  h.fromWebContents.mockReset();
  h.ensurePlaywrightBootstrap.mockClear();
  h.appGuestInput.mockClear();
  h.spawnStreaming.mockReset().mockResolvedValue({
    code: 0,
    stdout: "",
    stderr: "",
    aborted: false,
    timedOut: false,
  });
  h.runGuestStreaming.mockReset().mockImplementation(async (input) => {
    writeReport(input.appPath);
    return { code: 1, stdout: "", stderr: "", aborted: false, timedOut: false };
  });
  h.runningApps.clear();
  h.runningApps.set(1, { proxyUrl: "http://localhost:42101/", mode: "docker" });
});

describe("runAppTestsCore in Docker mode", () => {
  it("runs the app's Playwright in the guest, never on the host", async () => {
    const result = await runAppTestsCore({
      appId: 1,
      testFiles: [SPEC],
      headed: true,
      testEnv: { DYAD_TEST_USER_EMAIL: "user@example.com" },
    });

    expect(h.spawnStreaming).not.toHaveBeenCalled();
    expect(h.ensurePlaywrightBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({ docker: { appId: 1 } }),
    );
    expect(h.runGuestStreaming).toHaveBeenCalledTimes(1);
    const input = lastGuestInput();
    expect(input).toMatchObject({
      appId: 1,
      appPath: APP_PATH,
      command: "node",
      image: "playwright",
      joinNetworkOf: "dyad-app-1",
    });
    expect(input.args[0]).toBe(
      path.posix.join(APP_PATH, "node_modules/@playwright/test/cli.js"),
    );
    const selectors = input.args.filter((arg) => arg.startsWith("^"));
    expect(selectors).toHaveLength(1);
    expect(new RegExp(selectors[0]).test(path.join(APP_PATH, SPEC))).toBe(true);
    // The guest has no display.
    expect(input.args).not.toContain("--headed");
    // Only the keys the runner needs: no host PATH, HOME, or provider keys.
    expect(input.env).toEqual({
      CI: "true",
      DYAD_TEST_USER_EMAIL: "user@example.com",
      [TEST_BASE_URL_ENV]: `http://localhost:${getAppPort(1)}`,
      PLAYWRIGHT_JSON_OUTPUT_NAME: TEST_RESULTS_JSON,
    });

    // The guest's report is read on the host as data.
    expect(result.infraError).toBeUndefined();
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      file: SPEC,
      status: "failed",
      screenshotPath: path.join(APP_PATH, "test-results/shot.png"),
    });
  });

  it("defaults to the runtime setting when the caller doesn't say", async () => {
    await runAppTestsCore({ appId: 1 });
    expect(h.runGuestStreaming).toHaveBeenCalledTimes(1);
    expect(h.spawnStreaming).not.toHaveBeenCalled();
  });

  it("refuses preview automation instead of exposing CDP to the guest", async () => {
    const result = await runAppTestsCore({
      appId: 1,
      docker: true,
      previewCdpEndpoint: "http://127.0.0.1:51234",
      previewCdpToken: "token",
      rotatePreviewView: vi.fn(async () => {}),
    });
    expect(result.infraError?.message).toContain(
      "isn't supported in Docker mode",
    );
    expect(h.ensurePlaywrightBootstrap).not.toHaveBeenCalled();
    expect(h.runGuestStreaming).not.toHaveBeenCalled();
    expect(h.spawnStreaming).not.toHaveBeenCalled();
  });

  it("asks for a restart when the dev server is still running on the host", async () => {
    h.runningApps.set(1, { proxyUrl: "http://localhost:42101/", mode: "host" });
    const result = await runAppTestsCore({ appId: 1, docker: true });
    expect(result.infraError?.message).toContain("running outside Docker");
    expect(h.runGuestStreaming).not.toHaveBeenCalled();
  });

  it("keeps host mode on the host runner", async () => {
    h.readSettings.mockReturnValue({ runtimeMode2: "host" });
    await runAppTestsCore({ appId: 1, docker: false, headed: true });
    expect(h.runGuestStreaming).not.toHaveBeenCalled();
    expect(h.ensurePlaywrightBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({ docker: undefined }),
    );
    expect(h.spawnStreaming).toHaveBeenCalledTimes(1);
    const options = h.spawnStreaming.mock.calls[0][0];
    expect(options.args[0]).toBe(
      path.join(APP_PATH, "node_modules", "@playwright", "test", "cli.js"),
    );
    expect(options.args).toContain("--headed");
    expect(options.env[TEST_BASE_URL_ENV]).toBe("http://localhost:42101/");
  });
});

describe("runAppTestsWithIsolation in Docker mode", () => {
  const event = { sender: { id: 7 } } as any;

  it("runs a preview request headless in the guest without touching the preview", async () => {
    const result = await runAppTestsWithIsolation({
      event,
      appId: 1,
      source: "panel",
      headed: true,
      preview: true,
    });
    expect(h.fromWebContents).not.toHaveBeenCalled();
    expect(h.runGuestStreaming).toHaveBeenCalledTimes(1);
    expect(h.spawnStreaming).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(1);
    const states = h.broadcast.mock.calls
      .filter(([, channel]) => channel === "tests:run-state")
      .map(([, , payload]) => payload);
    expect(states[0]).toMatchObject({ state: "started", preview: false });
    expect(states.some((payload) => payload.state === "preview-fallback")).toBe(
      true,
    );
    const output = h.broadcast.mock.calls
      .filter(([, channel]) => channel === "tests:output")
      .map(([, , payload]) => payload.chunk)
      .join("");
    expect(output).toContain("isn't supported in Docker mode");
  });

  it.each([
    { platform: "darwin", reachable: true },
    { platform: "linux", reachable: false },
  ])(
    "routes the per-test lifecycle bridge to the guest ($platform)",
    async ({ platform, reachable }) => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: platform });
      try {
        h.prepareIsolation.mockResolvedValue({
          isolation: { mode: "supabase-test-user" },
          testCaseLifecycle: { beforeEach: vi.fn(), afterEach: vi.fn() },
          teardown: vi.fn().mockResolvedValue({ remoteCleanupCompleted: true }),
        });
        h.startCaseServer.mockImplementation(
          async (_lifecycle, { advertisedHost }) => ({
            env: {
              [TEST_CASE_ENDPOINT_ENV]: `http://${advertisedHost}:5555`,
              [TEST_CASE_TOKEN_ENV]: "case-token",
            },
            failure: undefined,
            close: vi.fn(async () => {}),
          }),
        );
        const result = await runAppTestsWithIsolation({
          event,
          appId: 1,
          source: "agent",
        });
        if (!reachable) {
          expect(result.infraError?.message).toContain(
            "isn't available in Docker mode on this platform",
          );
          expect(h.startCaseServer).not.toHaveBeenCalled();
          expect(h.runGuestStreaming).not.toHaveBeenCalled();
          return;
        }
        expect(h.startCaseServer).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ advertisedHost: "host.docker.internal" }),
        );
        const input = lastGuestInput();
        expect(input.env[TEST_CASE_ENDPOINT_ENV]).toBe(
          "http://host.docker.internal:5555",
        );
        expect(input.env[TEST_CASE_TOKEN_ENV]).toBe("case-token");
        expect(input.args).toContain("--workers=1");
      } finally {
        Object.defineProperty(process, "platform", { value: originalPlatform });
      }
    },
  );
});
