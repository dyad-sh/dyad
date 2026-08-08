import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSandboxScript } from "@/ipc/utils/sandbox/runner";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";
import { readSettings } from "@/main/settings";
import {
  executeSandboxScriptTool,
  isSandboxScriptExecutionEnabled,
} from "./execute_sandbox_script";
import type { AgentContext } from "./types";

vi.mock("@/ipc/utils/sandbox/runner", () => ({
  isSandboxSupportedPlatform: vi.fn(() => true),
  runSandboxScript: vi.fn(),
}));

vi.mock("@/ipc/utils/telemetry", () => ({
  sendTelemetryEvent: vi.fn(),
}));

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({
    experiments: { enableSandboxScriptExecution: true },
  })),
}));

function createMockContext(): AgentContext {
  return {
    event: {} as any,
    appId: 456,
    appPath: "/tmp/app",
    referencedApps: new Map(),
    chatId: 123,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    neonProjectId: null,
    neonActiveBranchId: null,
    frameworkType: null,
    messageId: 1,
    isSharedModulesChanged: false,
    isDyadPro: false,
    todos: [],
    dyadRequestId: "test-request",
    fileEditTracker: {},
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    requireConsent: vi.fn().mockResolvedValue(true),
    appendUserMessage: vi.fn(),
    onUpdateTodos: vi.fn(),
  };
}

describe("executeSandboxScriptTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readSettings).mockReturnValue({
      experiments: { enableSandboxScriptExecution: true },
    } as ReturnType<typeof readSettings>);
  });

  it("treats an unset sandbox script experiment as disabled", () => {
    vi.mocked(readSettings).mockReturnValue({
      experiments: {},
    } as ReturnType<typeof readSettings>);

    expect(isSandboxScriptExecutionEnabled(undefined)).toBe(false);
    expect(isSandboxScriptExecutionEnabled({ experiments: {} })).toBe(false);
    expect(executeSandboxScriptTool.isEnabled?.(createMockContext())).toBe(
      false,
    );
  });

  it("includes the generated script in sandbox failure messages", async () => {
    const script = [
      "async function main() {",
      '  const text = await read_file("attachments:data.csv");',
      "  return text?.split('\\n').length;",
      "}",
      "main();",
    ].join("\n");
    vi.mocked(runSandboxScript).mockRejectedValue(
      new Error("Unexpected token ?."),
    );

    let thrown: unknown;
    try {
      await executeSandboxScriptTool.execute(
        { script, description: "Read data.csv" },
        createMockContext(),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(
      "This script contains unsupported syntax.",
    );
    expect((thrown as Error).message).toContain(`Script:\n${script}`);
    expect((thrown as Error).message).toContain(
      "Original error:\nUnexpected token ?.",
    );
    expect(runSandboxScript).toHaveBeenCalledWith(
      expect.objectContaining({
        appPath: "/tmp/app",
        script,
      }),
    );
    expect(sendTelemetryEvent).toHaveBeenCalledWith(
      "sandbox.script.failed",
      expect.objectContaining({
        appId: 456,
        chatId: 123,
        error: "Unexpected token ?.",
      }),
    );
  });
});
