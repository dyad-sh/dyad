import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Covers how a preview run reaches the Playwright CLI: which flags are dropped,
 * and the endpoint env var the generated fixture shim keys off. The heavy
 * dependencies (database, child processes, Playwright install) are mocked so
 * this stays a unit test of the argument/env construction.
 */

const h = vi.hoisted(() => ({
  spawnStreaming: vi.fn(),
  ensurePlaywrightBootstrap: vi.fn(async () => ({ installed: false })),
  runningApps: new Map<number, { proxyUrl: string }>(),
  findFirst: vi.fn(async () => ({
    id: 1,
    path: "my-app",
    testingEnabled: true,
  })),
}));

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
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
  getDyadAppPath: (appPath: string) => `/apps/${appPath}`,
}));

import { runAppTestsCore } from "./tests_handlers";
import { PREVIEW_CDP_ENDPOINT_ENV } from "../utils/playwright_bootstrap";

const PROXY_URL = "http://localhost:42101/";
const CDP_ENDPOINT = "http://127.0.0.1:51234";

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
});

describe("preview runs", () => {
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

  it("stays serial, since every test shares the one preview page", async () => {
    await runAppTestsCore({
      appId: 1,
      parallel: true,
      previewCdpEndpoint: CDP_ENDPOINT,
    });

    const { args } = lastSpawn();
    expect(args).not.toContain("--fully-parallel");
    expect(args.some((arg) => arg.startsWith("--workers="))).toBe(false);
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
