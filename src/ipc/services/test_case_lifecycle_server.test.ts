// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { ServerResponse } from "node:http";
import { TestRunTiming, measureTestRunStep } from "./test_run_timing";
import { prepareTestCaseTimingReporter } from "./test_case_timing_reporter";
import { sendTelemetryEvent } from "../utils/telemetry";
import {
  startTestCaseLifecycleServer,
  TEST_CASE_ENDPOINT_ENV,
  TEST_CASE_TOKEN_ENV,
} from "./test_case_lifecycle_server";

vi.mock("electron-log/main", () => ({
  default: { scope: () => ({ info: vi.fn() }) },
}));

import { ensurePreviewShim } from "../utils/playwright_bootstrap";
import { retryTestDatabaseCleanup } from "../utils/test_database_cleanup_retry";

const { timingInfo } = vi.hoisted(() => ({ timingInfo: vi.fn() }));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ warn: vi.fn(), info: timingInfo }) },
}));
vi.mock("../utils/telemetry", () => ({ sendTelemetryEvent: vi.fn() }));

const servers: Awaited<ReturnType<typeof startTestCaseLifecycleServer>>[] = [];
const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) await server.close();
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

async function setup(onSlowShutdown?: () => void, timing?: TestRunTiming) {
  const lifecycle = {
    beforeEach: vi.fn(async (_signal?: AbortSignal) => ({
      DYAD_TEST_USER_EMAIL: "new@dyad.test",
    })),
    afterEach: vi.fn(async (_signal?: AbortSignal) => {}),
  };
  const server = await startTestCaseLifecycleServer(lifecycle, {
    onSlowShutdown,
    timing,
  });
  servers.push(server);
  const request = (route: string, headers: Record<string, string> = {}) =>
    fetch(`${server.env[TEST_CASE_ENDPOINT_ENV]}/${route}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.env[TEST_CASE_TOKEN_ENV]}`,
        ...headers,
      },
    });
  return { lifecycle, server, request };
}

describe("test case lifecycle bridge", () => {
  it("correlates HTTP hooks and abandoned-case cleanup with their owning run", async () => {
    vi.mocked(sendTelemetryEvent).mockClear();
    timingInfo.mockClear();
    const timing = new TestRunTiming({ appId: 1, runId: 25, source: "panel" });
    const { request, server } = await setup(undefined, timing);
    expect((await request("before/first")).status).toBe(200);
    expect((await request("before/retry")).status).toBe(200);
    await server.close();
    expect(sendTelemetryEvent).not.toHaveBeenCalled();
    timing.finish();
    expect(
      timingInfo.mock.calls.filter(
        ([event]) => event === "e2e_test_case_completed",
      ),
    ).toEqual(
      ["first", "retry"].map((caseId) => [
        "e2e_test_case_completed",
        expect.objectContaining({
          case_id: caseId,
          run_id: 25,
          timing_incomplete: true,
          status: "incomplete",
          steps: [
            expect.objectContaining({
              step: "case_setup",
              status: "completed",
            }),
            expect.objectContaining({
              step: "case_cleanup",
              status: "completed",
            }),
          ],
        }),
      ]),
    );
    expect(vi.mocked(sendTelemetryEvent).mock.calls).toEqual([
      [
        "e2e_test_run_completed",
        expect.objectContaining({
          run_id: 25,
          run_steps: [],
          testcases: ["first", "retry"].map((case_id) =>
            expect.objectContaining({
              case_id,
              timing_incomplete: true,
              steps: [
                { step: "setup", duration_ms: null },
                { step: "execution", duration_ms: null },
                { step: "cleanup", duration_ms: null },
              ],
            }),
          ),
        }),
      ],
    ]);
  });

  it("continues to the next case when a transient cleanup failure recovers", async () => {
    const { lifecycle, server, request } = await setup();
    const cleanup = vi
      .fn()
      .mockRejectedValueOnce(
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("socket hang up"), {
            code: "ECONNRESET",
          }),
        }),
      )
      .mockResolvedValue(undefined);
    lifecycle.afterEach.mockImplementation((signal) =>
      retryTestDatabaseCleanup(cleanup, "Delete test user", signal),
    );

    for (const caseId of ["first", "second"]) {
      expect((await request(`before/${caseId}`)).status).toBe(200);
      expect((await request(`after/${caseId}`)).status).toBe(200);
    }
    expect(server.failure).toBeUndefined();
    expect(lifecycle.beforeEach).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenCalledTimes(3);
    await server.close();
    expect(server.failure).toBeUndefined();
  });

  it.each([false, true])(
    "ignores shutdown cancellation but retains final cleanup failures (cleanup fails: %s)",
    async (cleanupFails) => {
      const { lifecycle, server, request } = await setup();
      const cleanupError = new Error("final cleanup failed");
      if (cleanupFails) lifecycle.afterEach.mockRejectedValueOnce(cleanupError);
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      lifecycle.beforeEach.mockImplementationOnce(
        (signal) =>
          new Promise((_, reject) => {
            signal!.addEventListener("abort", () => reject(signal!.reason), {
              once: true,
            });
            started();
          }),
      );
      const pendingRequest = request("before/one").catch(() => undefined);
      await ready;
      await server.close();
      await pendingRequest;
      expect(server.failure).toBe(cleanupFails ? cleanupError : undefined);
      expect(lifecycle.afterEach).toHaveBeenCalledTimes(1);
    },
  );

  it("surfaces a provider that ignores cancellation while retaining the drain barrier", async () => {
    const warning = vi.fn();
    const { lifecycle, server, request } = await setup(warning);
    let started!: () => void;
    let finish!: (value: { DYAD_TEST_USER_EMAIL: string }) => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    lifecycle.beforeEach.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
          started();
        }),
    );
    const pendingRequest = request("before/one").catch(() => undefined);
    await ready;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let drained = false;
    const closed = server.close().then(() => {
      drained = true;
    });
    try {
      await vi.advanceTimersByTimeAsync(10_000);
      expect(warning).toHaveBeenCalledTimes(1);
      expect(drained).toBe(false);
      expect(lifecycle.afterEach).not.toHaveBeenCalled();
    } finally {
      finish({ DYAD_TEST_USER_EMAIL: "late@dyad.test" });
      await closed;
      await pendingRequest;
    }
    expect(server.failure).toBeUndefined();
    expect(lifecycle.afterEach).toHaveBeenCalledTimes(1);
  });

  it("keeps the queue usable when sending a response throws", async () => {
    const { lifecycle, server, request } = await setup();
    const original = ServerResponse.prototype.writeHead;
    const writeHead = vi
      .spyOn(ServerResponse.prototype, "writeHead")
      .mockImplementationOnce(function (
        this: ServerResponse,
        ...args: Parameters<typeof original>
      ) {
        original.apply(this, args);
        throw new Error("response failed");
      });
    await request("before/one").catch(() => undefined);
    writeHead.mockRestore();
    expect((await request("before/two")).status).toBe(500);
    await server.close();
    expect(server.failure?.message).toBe("response failed");
    expect(lifecycle.beforeEach).toHaveBeenCalledTimes(1);
    expect(lifecycle.afterEach).toHaveBeenCalledTimes(1);
  });
  it("requires the run token and rejects browser-origin requests", async () => {
    const { lifecycle, request } = await setup();
    expect(
      (await request("before/one", { Authorization: "Bearer wrong" })).status,
    ).toBe(403);
    expect(
      (await request("before/one", { Origin: "https://app.example" })).status,
    ).toBe(403);
    expect((await request("invalid/one")).status).toBe(404);
    expect(lifecycle.beforeEach).not.toHaveBeenCalled();
  });

  it("cleans up an abandoned attempt and ignores its stale teardown", async () => {
    const { lifecycle, request } = await setup();
    expect(await (await request("before/one")).json()).toEqual({
      DYAD_TEST_USER_EMAIL: "new@dyad.test",
    });
    await request("before/two");
    expect(lifecycle.afterEach).toHaveBeenCalledTimes(1);
    await request("after/one");
    expect(lifecycle.afterEach).toHaveBeenCalledTimes(1);
    await request("after/two");
    expect(lifecycle.afterEach).toHaveBeenCalledTimes(2);
  });

  it("blocks later cases after failed cleanup and retries cleanup on close", async () => {
    const { lifecycle, server, request } = await setup();
    await request("before/one");
    lifecycle.afterEach.mockRejectedValueOnce(new Error("cleanup unavailable"));
    expect((await request("after/one")).status).toBe(500);
    expect((await request("before/two")).status).toBe(500);
    expect(lifecycle.beforeEach).toHaveBeenCalledTimes(1);
    expect(server.failure?.message).toBe("cleanup unavailable");
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    expect(lifecycle.afterEach).toHaveBeenCalledTimes(2);
  });

  it("drains in-flight provisioning before cleaning up a killed worker", async () => {
    const { lifecycle, server, request } = await setup();
    let finish!: (value: { DYAD_TEST_USER_EMAIL: string }) => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    lifecycle.beforeEach.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const pendingRequest = request("before/one").catch(() => undefined);
    await startedPromise;
    const closed = server.close();
    expect(lifecycle.afterEach).not.toHaveBeenCalled();
    finish({ DYAD_TEST_USER_EMAIL: "created@dyad.test" });
    await closed;
    await pendingRequest;
    servers.splice(servers.indexOf(server), 1);
    expect(lifecycle.afterEach).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "runs the generated auto fixture across files and retries (default creation rejected: %s)",
    async (creationRejected) => {
      vi.mocked(sendTelemetryEvent).mockClear();
      timingInfo.mockClear();
      const timing = new TestRunTiming({
        appId: 1,
        runId: 26,
        source: "panel",
      });
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "dyad-case-fixture-"),
      );
      directories.push(directory);
      const logFile = path.join(directory, "events.jsonl");
      const record = (event: string) =>
        fs.appendFileSync(logFile, JSON.stringify(event) + "\n");
      let id = 0;
      const server = await startTestCaseLifecycleServer(
        {
          beforeEach: async (_signal, caseTiming) =>
            measureTestRunStep(
              caseTiming,
              "supabase_user_create",
              async (): Promise<Record<string, string>> => {
                id += 1;
                record(`create-${id}`);
                if (creationRejected && id > 1) return {};
                return {
                  DYAD_TEST_USER_EMAIL: String(id),
                  DYAD_TEST_USER_PASSWORD: `password-${id}`,
                };
              },
            ),
          afterEach: async (_signal, caseTiming) =>
            measureTestRunStep(
              caseTiming,
              "supabase_user_cleanup",
              async () => {
                record(`cleanup-${id}`);
              },
            ),
        },
        { timing },
      );
      servers.push(server);
      fs.symlinkSync(
        path.resolve("node_modules"),
        path.join(directory, "node_modules"),
        "junction",
      );
      fs.mkdirSync(path.join(directory, "e2e-tests"));
      ensurePreviewShim(directory);
      fs.writeFileSync(
        path.join(directory, "playwright.config.cjs"),
        `module.exports = { testDir: './e2e-tests', workers: 1, retries: 1 };`,
      );
      const helpers = `
import { test, expect } from '@playwright/test';
import { appendFileSync } from 'node:fs';
const record = (phase) => appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(phase + '-' + (process.env.DYAD_TEST_USER_EMAIL ?? 'custom')) + '\\n');
test.beforeEach(({}, info) => {
  expect(process.env.SUPABASE_SECRET_KEY).toBe('fixture-only-test-key');
  if (${creationRejected} && info.title !== 'first') {
    expect(process.env.DYAD_TEST_USER_EMAIL).toBeUndefined();
    expect(process.env.DYAD_TEST_USER_PASSWORD).toBeUndefined();
  } else {
    expect(process.env.DYAD_TEST_USER_PASSWORD).toBe('password-' + process.env.DYAD_TEST_USER_EMAIL);
  }
  record('before');
});
test.afterEach(() => record('after'));
`;
      fs.writeFileSync(
        path.join(directory, "e2e-tests/a.spec.ts"),
        `${helpers}
test('first', () => record('test'));
test('retry', ({}, info) => { record('test'); expect(info.retry).toBe(1); });
`,
      );
      fs.writeFileSync(
        path.join(directory, "e2e-tests/b.spec.ts"),
        `${helpers}
test('next file', () => record('test'));
`,
      );
      const caseTimings = prepareTestCaseTimingReporter(
        directory,
        directory,
        timing,
      );
      const require = createRequire(import.meta.url);
      const cli = path.join(
        path.dirname(require.resolve("@playwright/test/package.json")),
        "cli.js",
      );
      const result = await new Promise<{ code: number | null; output: string }>(
        (resolve, reject) => {
          const child = spawn(
            process.execPath,
            [cli, "test", `--reporter=${caseTimings.reporter}`],
            {
              cwd: directory,
              env: {
                ...process.env,
                ...server.env,
                ...caseTimings.env,
                CI: "true",
                DYAD_TEST_USER_EMAIL: "stale@dyad.test",
                DYAD_TEST_USER_PASSWORD: "stale-password",
                SUPABASE_SECRET_KEY: "fixture-only-test-key",
              },
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          let output = "";
          child.stdout.on("data", (chunk) => {
            output += String(chunk);
          });
          child.stderr.on("data", (chunk) => {
            output += String(chunk);
          });
          child.once("error", reject);
          child.once("close", (code) => resolve({ code, output }));
        },
      );
      expect(result.code, result.output).toBe(0);
      caseTimings.collect();
      await server.close();
      timing.finish();
      expect(sendTelemetryEvent).toHaveBeenCalledTimes(1);
      const caseEvents = timingInfo.mock.calls
        .filter(([name]) => name === "e2e_test_case_completed")
        .map(([, properties]) => properties!);
      expect(caseEvents).toHaveLength(4);
      expect(new Set(caseEvents.map((event) => event.case_id)).size).toBe(4);
      expect(caseEvents.map((event) => event.status)).toEqual([
        "completed",
        "failed",
        "completed",
        "completed",
      ]);
      expect(caseEvents.map((event) => event.retry)).toEqual([0, 0, 1, 0]);
      for (const event of caseEvents) {
        expect(event).toMatchObject({
          timing_incomplete: false,
          setup_ms: expect.any(Number),
          execution_ms: expect.any(Number),
          cleanup_ms: expect.any(Number),
          steps: [
            expect.objectContaining({ step: "supabase_user_create" }),
            expect.objectContaining({ step: "case_setup" }),
            expect.objectContaining({ step: "supabase_user_cleanup" }),
            expect.objectContaining({ step: "case_cleanup" }),
          ],
        });
      }
      const payload = JSON.stringify(caseEvents);
      expect(payload).not.toContain("password-");
      expect(payload).not.toContain("a.spec.ts");
      expect(payload).not.toContain(directory);
      expect(server.failure).toBeUndefined();
      expect(id).toBe(4);
      expect(
        fs
          .readFileSync(logFile, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line)),
      ).toEqual(
        [1, 2, 3, 4].flatMap((caseId) =>
          ["create", "before", "test", "after", "cleanup"].map(
            (phase) =>
              `${phase}-${creationRejected && caseId > 1 && !["create", "cleanup"].includes(phase) ? "custom" : caseId}`,
          ),
        ),
      );
    },
    30_000,
  );
});
