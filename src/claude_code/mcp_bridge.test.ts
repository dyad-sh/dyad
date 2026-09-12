import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  installPackages: vi.fn(),
  runTypeScriptCheck: vi.fn(),
  runAppTestsWithIsolation: vi.fn(),
  executeExternalLifecycle: vi.fn(),
  broadcast: vi.fn(),
  getLogs: vi.fn(() => [] as unknown[]),
  coordinatorRun: vi.fn(async (_request: unknown, fn: () => unknown) => fn()),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));
vi.mock("@/ipc/services/app_operation_coordinator", () => ({
  appOperationCoordinator: { run: mocks.coordinatorRun },
  readAppResource: (resource: string) => ({ resource, access: "read" }),
}));
vi.mock("@/ipc/services/app_run_actor_service", () => ({
  appRunActorService: {
    executeExternalLifecycle: mocks.executeExternalLifecycle,
  },
}));
vi.mock("@/ipc/processors/executeAddDependency", () => ({
  installPackages: mocks.installPackages,
  ExecuteAddDependencyError: class ExecuteAddDependencyError extends Error {
    warningMessages = [];
    displaySummary = "failed";
    displayDetails = "details";
    installResults = "";
  },
}));
vi.mock("@/ipc/processors/tsc", () => ({
  runTypeScriptCheck: mocks.runTypeScriptCheck,
}));
vi.mock("@/ipc/handlers/tests_handlers", () => ({
  runAppTestsWithIsolation: mocks.runAppTestsWithIsolation,
}));
vi.mock("@/ipc/utils/window_broadcast", () => ({
  broadcastToRegisteredWindows: mocks.broadcast,
}));
vi.mock("@/lib/log_store", () => ({ getLogs: mocks.getLogs }));
vi.mock("@/main/settings", () => ({ readSettings: () => ({}) }));

import {
  buildDyadMcpConfig,
  getDyadBridgeTools,
  handleDyadMcpMessage,
  type DyadMcpBridgeContext,
} from "./mcp_bridge";

function context(
  overrides: Partial<DyadMcpBridgeContext> = {},
): DyadMcpBridgeContext & { cards: string[]; warnings: string[] } {
  const cards: string[] = [];
  const warnings: string[] = [];
  return {
    event: { sender: { id: 1 } } as unknown as DyadMcpBridgeContext["event"],
    appId: 7,
    appPath: "/tmp/app",
    chatId: 3,
    mode: "agent",
    signal: new AbortController().signal,
    testingEnabled: true,
    onToolCard: (xml) => cards.push(xml),
    onWarning: (message) => warnings.push(message),
    cards,
    warnings,
    ...overrides,
  };
}

describe("mcp_bridge", () => {
  beforeEach(() => {
    mocks.installPackages.mockReset();
    mocks.runTypeScriptCheck.mockReset();
    mocks.runAppTestsWithIsolation.mockReset();
    mocks.executeExternalLifecycle.mockReset();
    mocks.broadcast.mockReset();
    mocks.getLogs.mockReset();
    mocks.getLogs.mockReturnValue([]);
    mocks.coordinatorRun.mockClear();
  });

  it("registers the bridge as an in-process sdk server named dyad", () => {
    expect(buildDyadMcpConfig()).toEqual({
      mcpServers: { dyad: { type: "sdk", name: "dyad" } },
    });
  });

  it("answers initialize and lists mode-appropriate tools with JSON schemas", async () => {
    const init = await handleDyadMcpMessage(
      {
        id: 0,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      },
      context(),
    );
    expect(init).toMatchObject({
      id: 0,
      result: { protocolVersion: "2025-11-25", serverInfo: { name: "dyad" } },
    });
    expect(
      await handleDyadMcpMessage(
        { method: "notifications/initialized" },
        context(),
      ),
    ).toBeNull();

    const agentList = (await handleDyadMcpMessage(
      { id: 1, method: "tools/list" },
      context(),
    )) as { result: { tools: Array<{ name: string; inputSchema: unknown }> } };
    expect(agentList.result.tools.map((tool) => tool.name)).toEqual([
      "add_dependency",
      "run_type_checks",
      "run_tests",
      "read_logs",
      "restart_app",
    ]);
    expect(agentList.result.tools[0].inputSchema).toMatchObject({
      type: "object",
      properties: { packages: { type: "array" } },
      required: ["packages"],
    });

    const askList = (await handleDyadMcpMessage(
      { id: 2, method: "tools/list" },
      context({ mode: "ask" }),
    )) as { result: { tools: Array<{ name: string }> } };
    expect(askList.result.tools.map((tool) => tool.name)).toEqual([
      "run_type_checks",
      "read_logs",
    ]);
    expect(getDyadBridgeTools("plan").map((tool) => tool.name)).toEqual([
      "run_type_checks",
      "read_logs",
    ]);
  });

  it("rejects unknown tools and mutating tools outside Agent mode", async () => {
    expect(
      await handleDyadMcpMessage(
        {
          id: 1,
          method: "tools/call",
          params: { name: "shell", arguments: {} },
        },
        context(),
      ),
    ).toMatchObject({ error: { code: -32602 } });
    // add_dependency is not listed in Ask mode, so a direct call is unknown.
    expect(
      await handleDyadMcpMessage(
        {
          id: 2,
          method: "tools/call",
          params: { name: "add_dependency", arguments: { packages: ["zod"] } },
        },
        context({ mode: "ask" }),
      ),
    ).toMatchObject({ error: { code: -32602 } });
    expect(mocks.installPackages).not.toHaveBeenCalled();
    expect(
      await handleDyadMcpMessage(
        { id: 3, method: "resources/list" },
        context(),
      ),
    ).toMatchObject({ error: { code: -32601 } });
  });

  it("validates add_dependency arguments and refuses non-registry specs", async () => {
    for (const bad of [
      { packages: [] },
      { packages: ["https://evil.example/x.tgz"] },
      { packages: ["file:../x"] },
      { packages: ["zod; rm -rf /"] },
      { packages: "zod" },
      {},
    ]) {
      const response = (await handleDyadMcpMessage(
        {
          id: 4,
          method: "tools/call",
          params: { name: "add_dependency", arguments: bad },
        },
        context(),
      )) as { result: { isError?: boolean; content: Array<{ text: string }> } };
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0].text).toContain("Invalid arguments");
    }
    expect(mocks.installPackages).not.toHaveBeenCalled();
  });

  it("installs registry packages under the app coordinator and emits a card", async () => {
    mocks.installPackages.mockResolvedValue({
      installResults: "added 1 package",
      warningMessages: ["deprecated"],
    });
    const ctx = context();
    const response = (await handleDyadMcpMessage(
      {
        id: 5,
        method: "tools/call",
        params: { name: "add_dependency", arguments: { packages: ["zod@^4"] } },
      },
      ctx,
    )) as { result: { isError?: boolean; content: Array<{ text: string }> } };
    expect(response.result.isError).toBeUndefined();
    expect(response.result.content[0].text).toContain(
      "Successfully installed or updated zod@^4",
    );
    expect(mocks.installPackages).toHaveBeenCalledWith({
      packages: ["zod@^4"],
      appPath: "/tmp/app",
    });
    expect(mocks.coordinatorRun).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 7,
        resources: expect.arrayContaining(["repository-worktree"]),
        refuseWhenRecording: "install dependencies",
      }),
      expect.any(Function),
    );
    expect(ctx.cards[0]).toContain('<dyad-add-dependency packages="zod@^4">');
    expect(ctx.warnings).toEqual(["deprecated"]);
  });

  it("runs type checks through Dyad and reports problems", async () => {
    mocks.runTypeScriptCheck.mockResolvedValue({
      problems: [
        {
          file: "src/a.ts",
          line: 1,
          column: 2,
          message: "boom",
          code: 1234,
          snippet: "",
        },
      ],
    });
    const ctx = context();
    const response = (await handleDyadMcpMessage(
      {
        id: 6,
        method: "tools/call",
        params: { name: "run_type_checks", arguments: {} },
      },
      ctx,
    )) as { result: { content: Array<{ text: string }> } };
    expect(response.result.content[0].text).toContain(
      "src/a.ts:1:2 - TS1234: boom",
    );
    expect(mocks.broadcast).toHaveBeenCalledWith(
      expect.anything(),
      "agent-tool:problems-update",
      expect.objectContaining({ appId: 7 }),
    );
    expect(ctx.cards[0]).toContain("<dyad-status");
  });

  it("refuses run_tests when testing is disabled for the app", async () => {
    const response = (await handleDyadMcpMessage(
      {
        id: 7,
        method: "tools/call",
        params: {
          name: "run_tests",
          arguments: { testFile: "e2e-tests/a.spec.ts" },
        },
      },
      context({ testingEnabled: false }),
    )) as { result: { isError?: boolean; content: Array<{ text: string }> } };
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).toContain("Testing is not enabled");
    expect(mocks.runAppTestsWithIsolation).not.toHaveBeenCalled();
  });

  it("reads logs with filters and returns an explicit empty result", async () => {
    mocks.getLogs.mockReturnValue([
      {
        appId: 7,
        level: "error",
        type: "server",
        message: "boom happened",
        timestamp: Date.now(),
      },
      {
        appId: 7,
        level: "info",
        type: "client",
        message: "fine",
        timestamp: Date.now(),
      },
    ]);
    const response = (await handleDyadMcpMessage(
      {
        id: 8,
        method: "tools/call",
        params: { name: "read_logs", arguments: { level: "error" } },
      },
      context(),
    )) as { result: { content: Array<{ text: string }> } };
    expect(response.result.content[0].text).toContain("boom happened");
    expect(response.result.content[0].text).not.toContain("fine");
    expect(mocks.getLogs).toHaveBeenCalledWith(7);
  });

  it("restarts the preview through the app-run actor and refuses after cancellation", async () => {
    mocks.executeExternalLifecycle.mockResolvedValue(undefined);
    const ok = (await handleDyadMcpMessage(
      {
        id: 9,
        method: "tools/call",
        params: { name: "restart_app", arguments: {} },
      },
      context(),
    )) as { result: { content: Array<{ text: string }> } };
    expect(ok.result.content[0].text).toContain("restarted");
    expect(mocks.executeExternalLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 7, operation: "restart" }),
    );

    const aborted = new AbortController();
    aborted.abort();
    const cancelled = (await handleDyadMcpMessage(
      {
        id: 10,
        method: "tools/call",
        params: { name: "restart_app", arguments: {} },
      },
      context({ signal: aborted.signal }),
    )) as { result: { isError?: boolean } };
    expect(cancelled.result.isError).toBe(true);
  });
});
