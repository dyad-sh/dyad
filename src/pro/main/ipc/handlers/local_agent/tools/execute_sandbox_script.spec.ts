import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeSandboxScriptInProcess } from "@/ipc/utils/sandbox/execution";
import { runSandboxScript } from "@/ipc/utils/sandbox/runner";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";
import { readSettings } from "@/main/settings";
import {
  buildExecuteSandboxScriptDescription,
  executeSandboxScriptTool,
  isSandboxScriptExecutionEnabled,
} from "./execute_sandbox_script";
import type { AgentContext } from "./types";
import type { McpToolDef } from "./mcp_type_defs";

vi.mock("@/ipc/utils/sandbox/execution", () => ({
  isSandboxSupportedPlatform: vi.fn(() => true),
  executeSandboxScriptInProcess: vi.fn(),
}));

vi.mock("@/ipc/utils/sandbox/runner", () => ({
  runSandboxScript: vi.fn(),
}));

vi.mock("@/ipc/utils/sandbox/capabilities", () => ({
  buildSandboxCapabilitiesWithObserver: vi.fn(() => ({})),
}));

vi.mock("@/ipc/utils/telemetry", () => ({
  sendTelemetryEvent: vi.fn(),
}));

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({
    enableSandboxScriptExecution: true,
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
      enableSandboxScriptExecution: true,
    } as ReturnType<typeof readSettings>);
  });

  it("treats an unset sandbox script setting as disabled", () => {
    vi.mocked(readSettings).mockReturnValue({
      enableSandboxScriptExecution: false,
    } as ReturnType<typeof readSettings>);

    expect(isSandboxScriptExecutionEnabled(undefined)).toBe(false);
    expect(isSandboxScriptExecutionEnabled({})).toBe(false);
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
    vi.mocked(executeSandboxScriptInProcess).mockRejectedValue(
      new Error("Unexpected token ?."),
    );

    let thrown: unknown;
    try {
      await executeSandboxScriptTool.execute(
        { script, description: "Read data.csv", execution_thread: "main" },
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
    expect(executeSandboxScriptInProcess).toHaveBeenCalledWith(
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

  it("defaults execution_thread to main and runs in-process", async () => {
    vi.mocked(executeSandboxScriptInProcess).mockResolvedValue({
      value: "42",
      truncated: false,
      executionMs: 5,
    });

    await executeSandboxScriptTool.execute(
      { script: "1 + 1", execution_thread: "main" },
      createMockContext(),
    );

    expect(executeSandboxScriptInProcess).toHaveBeenCalledTimes(1);
    expect(runSandboxScript).not.toHaveBeenCalled();
    expect(sendTelemetryEvent).toHaveBeenCalledWith(
      "sandbox.script.completed",
      expect.objectContaining({ executionThread: "main" }),
    );
  });

  it("with execution_thread: 'worker', invokes runSandboxScript and does not inject MCP capabilities", async () => {
    vi.mocked(runSandboxScript).mockResolvedValue({
      value: "ok",
      truncated: false,
      executionMs: 1,
    });

    const ctx = createMockContext();
    // Pretend MCP is enabled with one tool def — worker path should
    // ignore it entirely.
    ctx.mcpToolsEnabled = true;
    ctx.mcpToolDefs = [
      {
        jsName: "srv__hello",
        toolKey: "srv__hello",
        serverId: 1,
        serverName: "srv",
        toolName: "hello",
        inputSchema: { type: "object" } as any,
      },
    ];

    await executeSandboxScriptTool.execute(
      { script: "1 + 1", execution_thread: "worker" },
      ctx,
    );

    expect(runSandboxScript).toHaveBeenCalledTimes(1);
    expect(executeSandboxScriptInProcess).not.toHaveBeenCalled();
    const runnerCall = vi.mocked(runSandboxScript).mock.calls[0][0];
    // The runner is given only the observer; the MCP capability map is
    // never built or passed on the worker path.
    expect(Object.keys(runnerCall)).not.toContain("capabilities");
    expect(sendTelemetryEvent).toHaveBeenCalledWith(
      "sandbox.script.completed",
      expect.objectContaining({ executionThread: "worker" }),
    );
  });
});

describe("buildExecuteSandboxScriptDescription (search mode)", () => {
  function def(serverName: string, toolName: string): McpToolDef {
    return {
      jsName: `${serverName}__${toolName}`,
      toolKey: `${serverName}__${toolName}`,
      serverId: 1,
      serverName,
      toolName,
      inputSchema: { type: "object" } as any,
    };
  }

  it("lists tool names grouped by server, without inlining signatures", async () => {
    const desc = await buildExecuteSandboxScriptDescription(
      [
        def("Sentry", "get_issue"),
        def("Sentry", "list_issues"),
        def("Linear", "create_issue"),
      ],
      { useSearch: true },
    );

    // Names are listed up front so the model sees what exists.
    expect(desc).toContain("Sentry__get_issue");
    expect(desc).toContain("Sentry__list_issues");
    expect(desc).toContain("Linear__create_issue");
    // Both discovery tools are referenced.
    expect(desc).toContain("get_mcp_tool_schema");
    expect(desc).toContain("search_mcp_tools");
    // Search mode must NOT inline the per-tool MCP signatures (the whole
    // point is to keep schemas out of context until requested).
    expect(desc).not.toContain("declare function Sentry__get_issue");
  });
});
