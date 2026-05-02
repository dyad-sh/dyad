import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================================
// Mocks
// ============================================================================

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
    }),
  },
}));

// Collect ipcMain.handle registrations into a map keyed by channel.
const handlerMap = new Map<string, (...args: any[]) => any>();
const sentMessages: Array<{ channel: string; payload: any }> = [];

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: any[]) => any) => {
      handlerMap.set(channel, fn);
    },
  },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: any) => {
            sentMessages.push({ channel, payload });
          },
        },
      },
    ],
  },
}));

vi.mock("../ipc/utils/test_utils", () => ({
  IS_TEST_BUILD: false,
}));

// Mock the mcpHubManager so handlers can be exercised in isolation.
// Use vi.hoisted so the object exists when the vi.mock factory runs.
const { hubMock } = vi.hoisted(() => ({
  hubMock: {
    getStatus: vi.fn((id: number) => ({
      serverId: id,
      status: "disconnected" as const,
    })),
    getAllStatuses: vi.fn(() => [
      { serverId: 1, status: "connected" as const },
      { serverId: 2, status: "error" as const, error: "boom" },
    ]),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    reconnect: vi.fn(async () => undefined),
    ping: vi.fn(async () => undefined),
    listTools: vi.fn(async () => [
      { name: "alpha", description: "A" },
      { name: "beta", description: "B" },
    ]),
    callTool: vi.fn(async () => ({ ok: true })),
    listResources: vi.fn(async () => [{ uri: "mock://r" }]),
    listResourceTemplates: vi.fn(async () => [{ uriTemplate: "tpl://{x}" }]),
    readResource: vi.fn(async () => ({ contents: [{ text: "hi" }] })),
    listPrompts: vi.fn(async () => [{ name: "greet" }]),
    getPrompt: vi.fn(async () => ({ messages: [] })),
    on: vi.fn(),
  },
}));

vi.mock("../ipc/utils/mcp_hub_manager", () => ({
  mcpHubManager: hubMock,
}));

// Legacy manager (used by update/delete dispose)
vi.mock("../ipc/utils/mcp_manager", () => ({
  mcpManager: {
    dispose: vi.fn(),
    getClient: vi.fn(),
  },
}));

// Mock consent helpers
const getStoredConsentMock = vi.fn(async () => "ask");
const requireMcpToolConsentMock = vi.fn(async () => true);
const resolveConsentMock = vi.fn();

vi.mock("../ipc/utils/mcp_consent", () => ({
  getStoredConsent: (...args: any[]) => getStoredConsentMock(...args),
  requireMcpToolConsent: (...args: any[]) => requireMcpToolConsentMock(...args),
  resolveConsent: (...args: any[]) => resolveConsentMock(...args),
}));

// Mock DB. Default returns no rows; individual tests can override `dbResult`.
let dbResult: any[] = [];
vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(dbResult),
      }),
    }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve([]) }),
  },
}));

// Import AFTER mocks
import { registerMcpHandlers } from "../ipc/handlers/mcp_handlers";

beforeEach(() => {
  handlerMap.clear();
  sentMessages.length = 0;
  hubMock.getStatus.mockClear();
  hubMock.getAllStatuses.mockClear();
  hubMock.connect.mockClear();
  hubMock.disconnect.mockClear();
  hubMock.reconnect.mockClear();
  hubMock.ping.mockClear();
  hubMock.listTools.mockClear();
  hubMock.callTool.mockClear();
  hubMock.listResources.mockClear();
  hubMock.readResource.mockClear();
  hubMock.listPrompts.mockClear();
  hubMock.getPrompt.mockClear();
  getStoredConsentMock.mockReset().mockResolvedValue("ask");
  requireMcpToolConsentMock.mockReset().mockResolvedValue(true);
  dbResult = [];
  registerMcpHandlers();
});

function call(channel: string, ...args: any[]) {
  const fn = handlerMap.get(channel);
  if (!fn) throw new Error(`No handler registered for ${channel}`);
  // safe_handle wraps fn and supplies (event, ...args)
  return fn({ sender: { send: vi.fn() } }, ...args);
}

describe("mcp_handlers", () => {
  it("mcp:get-status delegates to hub manager", async () => {
    const result = await call("mcp:get-status", 42);
    expect(hubMock.getStatus).toHaveBeenCalledWith(42);
    expect(result).toEqual({ serverId: 42, status: "disconnected" });
  });

  it("mcp:get-all-statuses returns the manager array", async () => {
    const result = await call("mcp:get-all-statuses");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ status: "connected" });
  });

  it("mcp:connect / disconnect / reconnect / ping delegate", async () => {
    await call("mcp:connect", 1);
    expect(hubMock.connect).toHaveBeenCalledWith(1);
    await call("mcp:disconnect", 2);
    expect(hubMock.disconnect).toHaveBeenCalledWith(2);
    await call("mcp:reconnect", 3);
    expect(hubMock.reconnect).toHaveBeenCalledWith(3);
    const pong = await call("mcp:ping", 4);
    expect(hubMock.ping).toHaveBeenCalledWith(4);
    expect(pong).toEqual({ ok: true });
  });

  it("mcp:list-tools uses the new manager and merges stored consent", async () => {
    getStoredConsentMock.mockImplementation(async (_id: number, name: string) =>
      name === "alpha" ? "always" : "ask",
    );
    const tools = await call("mcp:list-tools", 99);
    expect(hubMock.listTools).toHaveBeenCalledWith(99);
    expect(tools).toEqual([
      { name: "alpha", description: "A", consent: "always" },
      { name: "beta", description: "B", consent: "ask" },
    ]);
  });

  it("mcp:call-tool throws when consent is denied", async () => {
    getStoredConsentMock.mockResolvedValue("denied");
    await expect(
      call("mcp:call-tool", { serverId: 1, name: "alpha", args: {} }),
    ).rejects.toThrow();
    expect(hubMock.callTool).not.toHaveBeenCalled();
  });

  it("mcp:call-tool runs immediately when consent is 'always'", async () => {
    getStoredConsentMock.mockResolvedValue("always");
    const result = await call("mcp:call-tool", {
      serverId: 1,
      name: "alpha",
      args: { a: 1 },
    });
    expect(hubMock.callTool).toHaveBeenCalledWith(1, "alpha", { a: 1 });
    expect(result).toEqual({ ok: true });
    expect(requireMcpToolConsentMock).not.toHaveBeenCalled();
  });

  it("mcp:call-tool prompts for consent when stored consent is 'ask'", async () => {
    getStoredConsentMock.mockResolvedValue("ask");
    dbResult = [{ id: 1, name: "Mock Server" }];
    requireMcpToolConsentMock.mockResolvedValue(true);
    const result = await call("mcp:call-tool", {
      serverId: 1,
      name: "alpha",
      args: { x: 2 },
    });
    expect(requireMcpToolConsentMock).toHaveBeenCalledTimes(1);
    expect(hubMock.callTool).toHaveBeenCalledWith(1, "alpha", { x: 2 });
    expect(result).toEqual({ ok: true });
  });

  it("mcp:call-tool throws when user denies consent", async () => {
    getStoredConsentMock.mockResolvedValue("ask");
    dbResult = [{ id: 1, name: "Mock Server" }];
    requireMcpToolConsentMock.mockResolvedValue(false);
    await expect(
      call("mcp:call-tool", { serverId: 1, name: "alpha", args: {} }),
    ).rejects.toThrow(/denied/);
    expect(hubMock.callTool).not.toHaveBeenCalled();
  });

  it("mcp:read-resource forwards both serverId and uri to the manager", async () => {
    const result = await call("mcp:read-resource", {
      serverId: 7,
      uri: "mock://x",
    });
    expect(hubMock.readResource).toHaveBeenCalledWith(7, "mock://x");
    expect(result).toEqual({ contents: [{ text: "hi" }] });
  });

  it("mcp:list-resources / list-resource-templates / list-prompts delegate", async () => {
    const r1 = await call("mcp:list-resources", 1);
    expect(r1).toEqual([{ uri: "mock://r" }]);
    const r2 = await call("mcp:list-resource-templates", 1);
    expect(r2).toEqual([{ uriTemplate: "tpl://{x}" }]);
    const r3 = await call("mcp:list-prompts", 1);
    expect(r3).toEqual([{ name: "greet" }]);
  });

  it("mcp:get-prompt forwards args", async () => {
    await call("mcp:get-prompt", {
      serverId: 1,
      name: "greet",
      args: { who: "world" },
    });
    expect(hubMock.getPrompt).toHaveBeenCalledWith(1, "greet", {
      who: "world",
    });
  });
});
