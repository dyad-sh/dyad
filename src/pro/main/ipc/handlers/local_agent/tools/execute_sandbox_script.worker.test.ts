import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isSandboxSupportedPlatform } from "@/ipc/utils/sandbox/execution";
import { buildSandboxWorkerBundle } from "@/ipc/utils/sandbox/testing/sandbox_worker_bundle";
import { executeSandboxScriptTool } from "./execute_sandbox_script";
import type { AgentContext } from "./types";

vi.mock("@/ipc/handlers/app_blueprint_handlers", () => ({
  getAppBlueprintForChat: vi.fn(),
  setAppBlueprintForChat: vi.fn(),
  deleteAppBlueprintForChat: vi.fn(),
}));

vi.mock("@/ipc/utils/telemetry", () => ({
  sendTelemetryEvent: vi.fn(),
}));

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({
    enableSandboxScriptExecution: true,
  })),
}));

/**
 * Runs the tool against the real runner and the built worker bundle. The
 * interpreter executes synchronously between host calls, so a CPU-bound
 * script on the calling thread would stall this process's event loop for
 * the whole run; on a worker thread the loop keeps turning.
 */
const COUNT_SCRIPT = [
  "function main() {",
  "  let i = 0;",
  "  while (i < 20000000) {",
  "    i = i + 1;",
  "  }",
  "  return i;",
  "}",
  "main();",
].join("\n");

function createContext(appPath: string): AgentContext {
  return {
    event: {} as any,
    appId: 456,
    appPath,
    referencedApps: new Map(),
    chatId: 123,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    neonProjectId: null,
    neonActiveBranchId: null,
    frameworkType: null,
    messageId: 1,
    isSharedModulesChanged: false,
    sharedServerModulePaths: [],
    pendingFunctionDeploys: [],
    isDyadPro: false,
    todos: [],
    dyadRequestId: "test-request",
    fileEditTracker: {},
    testingEnabled: true,
    testRunAttempts: new Map(),
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    requireConsent: vi.fn().mockResolvedValue(true),
    appendUserMessage: vi.fn(),
    onUpdateTodos: vi.fn(),
  };
}

describe.skipIf(!isSandboxSupportedPlatform())(
  "execute_sandbox_script on the worker thread",
  () => {
    let appPath: string;
    let previousOverride: string | undefined;

    beforeAll(async () => {
      previousOverride = process.env.DYAD_SANDBOX_WORKER_PATH;
      process.env.DYAD_SANDBOX_WORKER_PATH = await buildSandboxWorkerBundle(
        "sandbox-worker-tool-test",
      );
      appPath = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-sandbox-tool-"));
    }, 120_000);

    afterAll(async () => {
      if (previousOverride === undefined) {
        delete process.env.DYAD_SANDBOX_WORKER_PATH;
      } else {
        process.env.DYAD_SANDBOX_WORKER_PATH = previousOverride;
      }
      if (appPath) await fs.rm(appPath, { recursive: true, force: true });
    });

    it("keeps the calling thread's event loop free while a script is busy", async () => {
      let maxGapMs = 0;
      let lastTick = Date.now();
      const ticker = setInterval(() => {
        const now = Date.now();
        maxGapMs = Math.max(maxGapMs, now - lastTick);
        lastTick = now;
      }, 20);

      try {
        const result = JSON.parse(
          await executeSandboxScriptTool.execute(
            { script: COUNT_SCRIPT },
            createContext(appPath),
          ),
        ) as { value: string; executionMs: number };
        // A blocked loop never runs the ticker, so the gap also has to be
        // measured from the last tick to the moment the script returned.
        maxGapMs = Math.max(maxGapMs, Date.now() - lastTick);

        expect(result.value).toBe("20000000");
        // The script has to run long enough for a blocked loop to show up as
        // a gap; otherwise the responsiveness check below proves nothing.
        expect(result.executionMs).toBeGreaterThan(1_000);
        expect(maxGapMs).toBeLessThan(500);
      } finally {
        clearInterval(ticker);
      }
    }, 60_000);
  },
);
