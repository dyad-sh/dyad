import { beforeEach, describe, expect, it, vi } from "vitest";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { executeSandboxScriptInProcess } from "@/ipc/utils/sandbox/execution";
import { runSandboxScript } from "@/ipc/utils/sandbox/runner";
import {
  assertAllowedGuestPath,
  buildSandboxCapabilitiesWithObserver,
} from "@/ipc/utils/sandbox/capabilities";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";
import { readSettings } from "@/main/settings";
import {
  buildExecuteSandboxScriptDescription,
  executeSandboxScriptTool,
  isSandboxScriptExecutionEnabled,
} from "./execute_sandbox_script";
import { writeFileTool } from "./write_file";
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
  assertAllowedGuestPath: vi.fn(),
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
    sharedServerModulePaths: [],
    pendingFunctionDeploys: [],
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
    vi.mocked(assertAllowedGuestPath).mockImplementation(() => undefined);
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

  it("is marked as state-modifying because sandbox scripts can call write_file", () => {
    expect(executeSandboxScriptTool.modifiesState).toBe(true);
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

  it("injects write_file as a main-thread host capability", async () => {
    vi.mocked(buildSandboxCapabilitiesWithObserver).mockReturnValue({
      read_file: vi.fn(),
    } as any);
    vi.mocked(executeSandboxScriptInProcess).mockResolvedValue({
      value: "done",
      truncated: false,
      executionMs: 3,
    });
    const writeSpy = vi
      .spyOn(writeFileTool, "execute")
      .mockResolvedValue("Successfully wrote src/out.txt");

    try {
      const ctx = createMockContext();
      await executeSandboxScriptTool.execute(
        {
          script: 'write_file("src/out.txt", "hello");',
          execution_thread: "main",
        },
        ctx,
      );

      const capabilities = vi.mocked(executeSandboxScriptInProcess).mock
        .calls[0][0].capabilities;
      const writeFile = capabilities?.write_file;
      expect(writeFile).toEqual(expect.any(Function));

      vi.mocked(ctx.onXmlComplete).mockClear();
      const result = await writeFile?.("src/out.txt", "hello", "Create output");

      expect(assertAllowedGuestPath).toHaveBeenCalledWith("src/out.txt");
      expect(result).toBe("Successfully wrote src/out.txt");
      expect(ctx.requireConsent).toHaveBeenCalledWith({
        toolName: "write_file",
        toolDescription: writeFileTool.description,
        inputPreview: "Write to src/out.txt",
        metadata: null,
      });
      expect(ctx.fileEditTracker["src/out.txt"]).toEqual({
        write_file: 1,
        search_replace: 0,
      });
      expect(writeSpy).toHaveBeenCalledWith(
        {
          path: "src/out.txt",
          content: "hello",
          description: "Create output",
        },
        ctx,
      );
      expect(ctx.onXmlComplete).toHaveBeenCalledWith(
        expect.stringContaining('<dyad-write path="src/out.txt"'),
      );
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("rejects attachment paths passed to the write_file host capability", async () => {
    vi.mocked(executeSandboxScriptInProcess).mockResolvedValue({
      value: "done",
      truncated: false,
      executionMs: 3,
    });

    await executeSandboxScriptTool.execute(
      {
        script: 'write_file("attachments:file.txt", "hello");',
        execution_thread: "main",
      },
      createMockContext(),
    );

    const capabilities = vi.mocked(executeSandboxScriptInProcess).mock
      .calls[0][0].capabilities;
    const writeFile = capabilities?.write_file;

    await expect(
      writeFile?.("attachments:file.txt", "hello"),
    ).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
    });
    expect(assertAllowedGuestPath).not.toHaveBeenCalled();
  });

  it("wraps invalid write_file host arguments as validation errors", async () => {
    vi.mocked(executeSandboxScriptInProcess).mockResolvedValue({
      value: "done",
      truncated: false,
      executionMs: 3,
    });

    await executeSandboxScriptTool.execute(
      { script: 'write_file("src/out.txt");', execution_thread: "main" },
      createMockContext(),
    );

    const capabilities = vi.mocked(executeSandboxScriptInProcess).mock
      .calls[0][0].capabilities;
    const writeFile = capabilities?.write_file;

    await expect(writeFile?.("src/out.txt")).rejects.toMatchObject({
      kind: DyadErrorKind.Validation,
    });
  });

  it("propagates sandbox path guard failures for write_file host paths", async () => {
    vi.mocked(assertAllowedGuestPath).mockImplementation(() => {
      throw new DyadError(
        "Sandbox scripts cannot access protected path: .env",
        DyadErrorKind.Precondition,
      );
    });
    vi.mocked(executeSandboxScriptInProcess).mockResolvedValue({
      value: "done",
      truncated: false,
      executionMs: 3,
    });

    await executeSandboxScriptTool.execute(
      { script: 'write_file(".env", "SECRET=x");', execution_thread: "main" },
      createMockContext(),
    );

    const capabilities = vi.mocked(executeSandboxScriptInProcess).mock
      .calls[0][0].capabilities;
    const writeFile = capabilities?.write_file;

    await expect(writeFile?.(".env", "SECRET=x")).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
    });
    expect(assertAllowedGuestPath).toHaveBeenCalledWith(".env");
  });

  it("omits the write_file host capability when the tool permission is disabled", async () => {
    vi.mocked(readSettings).mockReturnValue({
      enableSandboxScriptExecution: true,
      agentToolConsents: { write_file: "never" },
    } as unknown as ReturnType<typeof readSettings>);
    vi.mocked(executeSandboxScriptInProcess).mockResolvedValue({
      value: "done",
      truncated: false,
      executionMs: 3,
    });

    await executeSandboxScriptTool.execute(
      {
        script: 'write_file("src/out.txt", "hello");',
        execution_thread: "main",
      },
      createMockContext(),
    );

    const capabilities = vi.mocked(executeSandboxScriptInProcess).mock
      .calls[0][0].capabilities;
    expect(capabilities).not.toHaveProperty("write_file");
  });

  it("throws a precondition error if write_file permission is disabled after capability injection", async () => {
    vi.mocked(executeSandboxScriptInProcess).mockResolvedValue({
      value: "done",
      truncated: false,
      executionMs: 3,
    });

    await executeSandboxScriptTool.execute(
      {
        script: 'write_file("src/out.txt", "hello");',
        execution_thread: "main",
      },
      createMockContext(),
    );

    const capabilities = vi.mocked(executeSandboxScriptInProcess).mock
      .calls[0][0].capabilities;
    const writeFile = capabilities?.write_file;
    vi.mocked(readSettings).mockReturnValue({
      enableSandboxScriptExecution: true,
      agentToolConsents: { write_file: "never" },
    } as unknown as ReturnType<typeof readSettings>);

    await expect(writeFile?.("src/out.txt", "hello")).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
    });
  });

  it("throws a user-cancelled error when write_file host consent is denied", async () => {
    vi.mocked(executeSandboxScriptInProcess).mockResolvedValue({
      value: "done",
      truncated: false,
      executionMs: 3,
    });
    const ctx = createMockContext();
    vi.mocked(ctx.requireConsent).mockResolvedValue(false);

    await executeSandboxScriptTool.execute(
      {
        script: 'write_file("src/out.txt", "hello");',
        execution_thread: "main",
      },
      ctx,
    );

    const capabilities = vi.mocked(executeSandboxScriptInProcess).mock
      .calls[0][0].capabilities;
    const writeFile = capabilities?.write_file;

    await expect(writeFile?.("src/out.txt", "hello")).rejects.toMatchObject({
      kind: DyadErrorKind.UserCancelled,
    });
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

  it("omits write_file declarations when write_file permission is disabled", async () => {
    vi.mocked(readSettings).mockReturnValue({
      enableSandboxScriptExecution: true,
      agentToolConsents: { write_file: "never" },
    } as unknown as ReturnType<typeof readSettings>);

    const desc = await buildExecuteSandboxScriptDescription([]);

    expect(desc).not.toContain("declare function write_file");
    expect(desc).not.toContain("write generated content to files");
    expect(desc).not.toContain("write_file accepts app-relative paths");
  });

  it("omits get_mcp_tool_schema wording when that tool is not registered", async () => {
    const desc = await buildExecuteSandboxScriptDescription(
      [def("Sentry", "get_issue"), def("Linear", "create_issue")],
      { useSearch: true, hasGetSchemaTool: false },
    );

    // Names are still listed, and search is still offered.
    expect(desc).toContain("Sentry__get_issue");
    expect(desc).toContain("search_mcp_tools");
    // But the model must not be told to call the filtered-out tool.
    expect(desc).not.toContain("get_mcp_tool_schema");
  });
});
