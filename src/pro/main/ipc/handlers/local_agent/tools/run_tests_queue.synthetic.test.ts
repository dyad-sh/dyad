// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "./types";
import type { spawnStreaming } from "@/ipc/utils/spawn_streaming";
import type { prepareIsolatedTestDatabase } from "@/ipc/services/isolated_test_db";

// Exercise real tool calls, spec discovery, queue, resource coordination,
// runner lifecycle and report parsing. Only external boundaries are faked:
// Electron/sqlite, provider isolation and the Playwright subprocess.
const h = vi.hoisted(() => ({
  appPath: "",
  runningApps: new Map<number, { proxyUrl: string }>(),
  spawn: vi.fn<typeof spawnStreaming>(),
  prepare: vi.fn<typeof prepareIsolatedTestDatabase>(),
  broadcast: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: vi.fn(), getAllWindows: () => [] },
  app: {
    getPath: () => h.appPath,
    getAppPath: () => process.cwd(),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));
vi.mock("node-pty", () => ({ spawn: vi.fn() }));
vi.mock("@/db", () => ({
  db: {
    query: {
      apps: {
        findFirst: async () => ({
          id: 991,
          path: "synthetic-app",
          testingEnabled: true,
        }),
      },
    },
  },
}));
vi.mock("@/paths/paths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/paths/paths")>()),
  getDyadAppPath: () => h.appPath,
}));
vi.mock("@/main/settings", () => ({
  readSettings: () => ({ disableSandboxedE2eTests: true }),
}));
vi.mock("@/ipc/utils/window_broadcast", () => ({
  broadcastToRegisteredWindows: h.broadcast,
}));
vi.mock("@/ipc/utils/spawn_streaming", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/utils/spawn_streaming")>()),
  spawnStreaming: h.spawn,
}));
vi.mock("@/ipc/utils/playwright_bootstrap", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/ipc/utils/playwright_bootstrap")
  >()),
  ensurePlaywrightBootstrap: async () => ({ installed: false }),
}));
vi.mock("@/ipc/utils/process_manager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/utils/process_manager")>()),
  runningApps: h.runningApps,
}));
vi.mock("@/ipc/services/isolated_test_db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/services/isolated_test_db")>()),
  prepareIsolatedTestDatabase: h.prepare,
}));

import { runTestsTool } from "./run_tests";
import {
  getAppTestRunQueue,
  stopAppTestsForApp,
} from "@/ipc/services/test_run_queue_service";

const APP_ID = 991;
const SPECS = ["a", "b", "c"].map((name) => `e2e-tests/${name}.spec.ts`);
const ORIGINAL_ENV = "DATABASE_URL=synthetic-original\n";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function makeContext(signal?: AbortSignal): AgentContext {
  return {
    appId: APP_ID,
    appPath: h.appPath,
    event: { sender: {} },
    fileEditTracker: Object.create(null),
    testingEnabled: true,
    testRunAttempts: new Map(),
    abortSignal: signal,
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    appendUserMessage: vi.fn(),
  } as unknown as AgentContext;
}

function emittedXml(ctx: AgentContext): string {
  return [
    ...vi.mocked(ctx.onXmlStream).mock.calls,
    ...vi.mocked(ctx.onXmlComplete).mock.calls,
  ]
    .map(([xml]) => xml)
    .join("\n");
}

describe("synthetic overlapping run_tests calls", () => {
  let processGates: ReturnType<typeof gate>[];
  let cleanupGates: ReturnType<typeof gate>[];
  let calls: Promise<unknown>[];

  beforeEach(() => {
    h.appPath = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-test-queue-"));
    fs.mkdirSync(path.join(h.appPath, "e2e-tests"));
    for (const spec of SPECS) {
      fs.writeFileSync(
        path.join(h.appPath, spec),
        "import { test } from '@playwright/test';\ntest('synthetic case', async () => {});\n",
      );
    }
    fs.writeFileSync(path.join(h.appPath, ".env.local"), ORIGINAL_ENV);
    const playwrightPackage = path.join(
      h.appPath,
      "node_modules/@playwright/test/package.json",
    );
    fs.mkdirSync(path.dirname(playwrightPackage), { recursive: true });
    fs.writeFileSync(playwrightPackage, "{}");
    h.runningApps.set(APP_ID, { proxyUrl: "http://localhost:42101/" });
    h.prepare.mockReset();
    h.spawn.mockReset();
    h.broadcast.mockClear();
    processGates = SPECS.map(gate);
    cleanupGates = SPECS.map(gate);
    calls = [];
  });

  afterEach(async () => {
    // Release held work even if an assertion fails; no live queue or temporary
    // environment should escape the scenario.
    stopAppTestsForApp(APP_ID);
    for (const pending of [...processGates, ...cleanupGates]) pending.release();
    await Promise.allSettled(calls);
    h.runningApps.clear();
    fs.rmSync(h.appPath, { recursive: true, force: true, maxRetries: 3 });
  });

  it.each(["FIFO", "cancel queued B", "A fails"])(
    "%s: retains the active run through environment restoration",
    async (scenario) => {
      const trace: string[] = [];
      const prepared: string[] = [];
      const started: string[] = [];
      const restored: string[] = [];
      const reportPaths: string[] = [];
      const signals: AbortSignal[] = [];
      const settled: number[] = [];
      let environmentsInUse = 0;
      let maxEnvironmentsInUse = 0;
      const envPath = path.join(h.appPath, ".env.local");

      h.prepare.mockImplementation(async ({ signal }) => {
        const spec = getAppTestRunQueue(APP_ID).activeRun!.testFiles![0];
        const index = SPECS.indexOf(spec);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(fs.readFileSync(envPath, "utf8")).toBe(ORIGINAL_ENV);
        environmentsInUse++;
        maxEnvironmentsInUse = Math.max(
          maxEnvironmentsInUse,
          environmentsInUse,
        );
        signals.push(signal!);
        prepared.push(spec);
        fs.writeFileSync(envPath, `DATABASE_URL=synthetic-${index}\n`);
        trace.push(`setup ${spec}`);
        return {
          isolation: { mode: "neon-branch" },
          teardown: async () => {
            trace.push(`cleanup held ${spec}`);
            await cleanupGates[index].promise;
            expect(fs.readFileSync(envPath, "utf8")).toBe(
              `DATABASE_URL=synthetic-${index}\n`,
            );
            fs.writeFileSync(envPath, ORIGINAL_ENV);
            environmentsInUse--;
            restored.push(spec);
            trace.push(`environment restored ${spec}`);
            return { envRestored: true, remoteCleanupCompleted: true };
          },
        };
      });

      h.spawn.mockImplementation(async ({ args, env, signal }) => {
        // Identify the requested spec from the actual escaped Playwright argv.
        const index = SPECS.findIndex((spec) =>
          args?.includes(
            `^${path.resolve(h.appPath, spec).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          ),
        );
        expect(index).toBeGreaterThanOrEqual(0);
        const spec = SPECS[index];
        expect(fs.readFileSync(envPath, "utf8")).toBe(
          `DATABASE_URL=synthetic-${index}\n`,
        );
        started.push(spec);
        trace.push(`running ${spec}`);
        await processGates[index].promise;
        expect(signal?.aborted).toBe(false);
        const failed = scenario === "A fails" && index === 0;
        const reportPath = env!.PLAYWRIGHT_JSON_OUTPUT_NAME!;
        reportPaths.push(reportPath);
        fs.writeFileSync(
          reportPath,
          JSON.stringify({
            suites: [
              {
                title: spec,
                file: path.join(h.appPath, spec),
                specs: [
                  {
                    title: "synthetic case",
                    line: 2,
                    tests: [
                      {
                        status: failed ? "unexpected" : "expected",
                        results: [
                          {
                            status: failed ? "failed" : "passed",
                            duration: 10,
                            ...(failed
                              ? {
                                  error: {
                                    message: "Synthetic assertion failure",
                                  },
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

      const cancelB = new AbortController();
      const contexts = [
        makeContext(),
        makeContext(cancelB.signal),
        makeContext(),
      ];
      const submit = (index: number) => {
        const call = runTestsTool.execute(
          { testFiles: [SPECS[index]] },
          contexts[index],
        );
        calls.push(call);
        void call.then(() => settled.push(index));
        return call;
      };
      submit(0);
      await vi.waitFor(() => expect(started).toEqual([SPECS[0]]));
      submit(1);
      submit(2);
      expect(getAppTestRunQueue(APP_ID).activeRun?.testFiles?.[0]).toBe(
        SPECS[0],
      );
      expect(
        getAppTestRunQueue(APP_ID).queuedRuns.map((run) => run.testFiles?.[0]),
      ).toEqual(SPECS.slice(1));
      expect(emittedXml(contexts[0])).toContain(`Running ${SPECS[0]}`);
      expect(emittedXml(contexts[1])).toBe("");
      expect(emittedXml(contexts[2])).toBe("");
      expect(settled).toEqual([]);
      expect(prepared).toEqual([SPECS[0]]);
      expect(signals[0].aborted).toBe(false);
      trace.push("active A; queued B, C; all three calls pending");

      if (scenario === "cancel queued B") {
        cancelB.abort();
        expect(await calls[1]).toContain("cancelled while queued");
        expect(contexts[1].testRunCount ?? 0).toBe(0);
        expect(contexts[1].testRunAttempts.size).toBe(0);
        expect(emittedXml(contexts[1])).toBe("");
        expect(emittedXml(contexts[2])).toBe("");
        expect(
          getAppTestRunQueue(APP_ID).queuedRuns.map(
            (run) => run.testFiles?.[0],
          ),
        ).toEqual([SPECS[2]]);
        expect(signals[0].aborted).toBe(false);
        trace.push("B cancelled; A unaffected; C now first in queue");
      }

      const executed = scenario === "cancel queued B" ? [0, 2] : [0, 1, 2];
      for (const [position, index] of executed.entries()) {
        const spec = SPECS[index];
        const throughCurrent = executed
          .slice(0, position + 1)
          .map((i) => SPECS[i]);
        await vi.waitFor(() => expect(started).toEqual(throughCurrent));
        processGates[index].release();
        await vi.waitFor(() => expect(trace).toContain(`cleanup held ${spec}`));
        expect(getAppTestRunQueue(APP_ID).activeRun?.testFiles?.[0]).toBe(spec);
        expect(prepared).toEqual(throughCurrent);
        expect(restored).toHaveLength(position);
        expect(settled).not.toContain(index);
        expect(fs.readFileSync(envPath, "utf8")).toBe(
          `DATABASE_URL=synthetic-${index}\n`,
        );
        cleanupGates[index].release();
        const result = await calls[index];
        expect(result).toContain(
          scenario === "A fails" && index === 0
            ? "Synthetic assertion failure"
            : "All runnable tests passed",
        );
        expect(emittedXml(contexts[index])).toContain(spec);
      }

      await Promise.all(calls);
      expect(started).toEqual(executed.map((index) => SPECS[index]));
      expect(restored).toEqual(started);
      expect(signals.every((signal) => !signal.aborted)).toBe(true);
      expect(maxEnvironmentsInUse).toBe(1);
      expect(environmentsInUse).toBe(0);
      expect(fs.readFileSync(envPath, "utf8")).toBe(ORIGINAL_ENV);
      expect(getAppTestRunQueue(APP_ID)).toEqual({
        activeRun: null,
        queuedRuns: [],
      });
      expect(new Set(reportPaths).size).toBe(executed.length);
      expect(reportPaths.every((file) => fs.existsSync(file))).toBe(true);
      console.info(
        `Synthetic run_tests (${scenario}):\n${trace.join("\n")}\nmax simultaneous environments: ${maxEnvironmentsInUse}; queue empty`,
      );
    },
  );
});
