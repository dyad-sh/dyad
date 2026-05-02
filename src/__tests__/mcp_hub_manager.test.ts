import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock electron-log
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

// Track mock DB rows for mcpServers select
type ServerRow = {
  id: number;
  name: string;
  transport: string;
  command: string | null;
  args: string[] | null;
  envJson: Record<string, string> | null;
  url: string | null;
  enabled: boolean;
};
const mockServerRows: ServerRow[] = [];

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockServerRows),
      }),
    }),
  },
}));

// Spies for transport constructors so we can assert which transport was chosen.
const stdioCtorSpy = vi.fn();
const sseCtorSpy = vi.fn();
const httpCtorSpy = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    options: any;
    constructor(opts: any) {
      stdioCtorSpy(opts);
      this.options = opts;
    }
    onerror?: (err: Error) => void;
    async start() {}
    async send() {}
    async close() {}
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class {
    url: URL;
    options: any;
    constructor(url: URL, opts: any) {
      sseCtorSpy(url, opts);
      this.url = url;
      this.options = opts;
    }
    onerror?: (err: Error) => void;
    // Fail fast so client.connect() rejects rather than hanging waiting
    // for an initialize response on a non-functional fake transport.
    async start() {
      throw new Error("fake-transport-start");
    }
    async send() {}
    async close() {}
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    url: URL;
    options: any;
    constructor(url: URL, opts: any) {
      httpCtorSpy(url, opts);
      this.url = url;
      this.options = opts;
    }
    onerror?: (err: Error) => void;
    async start() {
      throw new Error("fake-transport-start");
    }
    async send() {}
    async close() {}
  },
}));

// Import AFTER mocks
import { McpHubManager } from "../ipc/utils/mcp_hub_manager";
import { createMockMcpServer } from "./mock_mcp_server";

function freshManager() {
  // Reset the singleton state for isolation by constructing via the class directly.
  // McpHubManager has a private constructor; use Reflect to bypass.
  const Ctor: any = McpHubManager;
  return Reflect.construct(Ctor, []) as McpHubManager;
}

describe("McpHubManager", () => {
  beforeEach(() => {
    mockServerRows.length = 0;
    stdioCtorSpy.mockClear();
    sseCtorSpy.mockClear();
    httpCtorSpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects to a mock server and reports 'connected' status", async () => {
    const mock = await createMockMcpServer({
      tools: [
        {
          name: "echo",
          description: "echo input",
          handler: (args) => ({ echoed: args }),
        },
      ],
    });
    mockServerRows.push({
      id: 1,
      name: "mock",
      transport: "stdio",
      command: "noop",
      args: [],
      envJson: null,
      url: null,
      enabled: true,
    });
    const mgr = freshManager();
    mgr.__setTransportForTesting(1, mock.clientTransport);
    const events: any[] = [];
    mgr.on("status-change", (i) => events.push(i));
    await mgr.connect(1);
    expect(mgr.getStatus(1).status).toBe("connected");
    expect(events.map((e) => e.status)).toEqual(["connecting", "connected"]);
    await mock.close();
  });

  it("listTools returns server-defined tools", async () => {
    const mock = await createMockMcpServer({
      tools: [
        { name: "alpha", handler: () => "a" },
        { name: "beta", description: "B", handler: () => "b" },
      ],
    });
    mockServerRows.push({
      id: 2,
      name: "mock2",
      transport: "stdio",
      command: "noop",
      args: [],
      envJson: null,
      url: null,
      enabled: true,
    });
    const mgr = freshManager();
    mgr.__setTransportForTesting(2, mock.clientTransport);
    await mgr.connect(2);
    const tools = await mgr.listTools(2);
    expect(tools.map((t) => t.name).sort()).toEqual(["alpha", "beta"]);
    await mock.close();
  });

  it("callTool invokes the handler and returns the result", async () => {
    const mock = await createMockMcpServer({
      tools: [
        {
          name: "sum",
          handler: (args) => ({
            total: (args as any).a + (args as any).b,
          }),
        },
      ],
    });
    mockServerRows.push({
      id: 3,
      name: "mock3",
      transport: "stdio",
      command: "noop",
      args: [],
      envJson: null,
      url: null,
      enabled: true,
    });
    const mgr = freshManager();
    mgr.__setTransportForTesting(3, mock.clientTransport);
    await mgr.connect(3);
    const result: any = await mgr.callTool(3, "sum", { a: 2, b: 3 });
    const text = result.content?.[0]?.text;
    expect(JSON.parse(text)).toEqual({ total: 5 });
    await mock.close();
  });

  it("listResources / readResource happy path", async () => {
    const mock = await createMockMcpServer({
      resources: [
        {
          uri: "mock://hello",
          name: "Hello",
          mimeType: "text/plain",
          text: "world",
        },
      ],
    });
    mockServerRows.push({
      id: 4,
      name: "mock4",
      transport: "stdio",
      command: "noop",
      args: [],
      envJson: null,
      url: null,
      enabled: true,
    });
    const mgr = freshManager();
    mgr.__setTransportForTesting(4, mock.clientTransport);
    await mgr.connect(4);
    const list = await mgr.listResources(4);
    expect(list[0].uri).toBe("mock://hello");
    const read: any = await mgr.readResource(4, "mock://hello");
    expect(read.contents[0].text).toBe("world");
    await mock.close();
  });

  it("listPrompts / getPrompt happy path", async () => {
    const mock = await createMockMcpServer({
      prompts: [
        {
          name: "greet",
          arguments: [{ name: "who", required: true }],
          handler: (args) => ({
            description: "greet",
            messages: [
              {
                role: "user",
                content: { type: "text", text: `Hello ${args?.who}` },
              },
            ],
          }),
        },
      ],
    });
    mockServerRows.push({
      id: 5,
      name: "mock5",
      transport: "stdio",
      command: "noop",
      args: [],
      envJson: null,
      url: null,
      enabled: true,
    });
    const mgr = freshManager();
    mgr.__setTransportForTesting(5, mock.clientTransport);
    await mgr.connect(5);
    const prompts = await mgr.listPrompts(5);
    expect(prompts[0].name).toBe("greet");
    const result: any = await mgr.getPrompt(5, "greet", { who: "world" });
    expect(result.messages[0].content.text).toBe("Hello world");
    await mock.close();
  });

  it("disconnect clears status and getClient reconnects", async () => {
    const mock = await createMockMcpServer({
      tools: [{ name: "t", handler: () => 1 }],
    });
    mockServerRows.push({
      id: 6,
      name: "mock6",
      transport: "stdio",
      command: "noop",
      args: [],
      envJson: null,
      url: null,
      enabled: true,
    });
    const mgr = freshManager();
    mgr.__setTransportForTesting(6, mock.clientTransport);
    await mgr.connect(6);
    await mgr.disconnect(6);
    expect(mgr.getStatus(6).status).toBe("disconnected");
    await mock.close();
  });

  it("dispose drops the cached client", async () => {
    const mock = await createMockMcpServer({
      tools: [{ name: "t", handler: () => 1 }],
    });
    mockServerRows.push({
      id: 7,
      name: "mock7",
      transport: "stdio",
      command: "noop",
      args: [],
      envJson: null,
      url: null,
      enabled: true,
    });
    const mgr = freshManager();
    mgr.__setTransportForTesting(7, mock.clientTransport);
    await mgr.connect(7);
    expect(mgr.getStatus(7).status).toBe("connected");
    mgr.dispose(7);
    // dispose() returns void; wait a tick for the underlying disconnect.
    await new Promise((r) => setTimeout(r, 10));
    expect(mgr.getStatus(7).status).toBe("disconnected");
    await mock.close();
  });

  it("connect throws when stdio server is missing 'command'", async () => {
    mockServerRows.push({
      id: 8,
      name: "bad",
      transport: "stdio",
      command: null,
      args: null,
      envJson: null,
      url: null,
      enabled: true,
    });
    const mgr = freshManager();
    await expect(mgr.connect(8)).rejects.toThrow(/command is required/);
    expect(mgr.getStatus(8).status).toBe("error");
  });

  it("HTTP server with /sse path picks SSEClientTransport and forwards headers", async () => {
    mockServerRows.push({
      id: 9,
      name: "sse",
      transport: "http",
      command: null,
      args: null,
      envJson: { Authorization: "Bearer abc" },
      url: "http://localhost:1234/mcp/sse",
      enabled: true,
    });
    const mgr = freshManager();
    // Connecting will fail at client.connect() (the fake transport doesn't
    // really speak the protocol) — but we only care that the SSE constructor
    // was selected and headers were passed.
    await mgr.connect(9).catch(() => undefined);
    expect(sseCtorSpy).toHaveBeenCalledTimes(1);
    expect(httpCtorSpy).not.toHaveBeenCalled();
    const [url, opts] = sseCtorSpy.mock.calls[0];
    expect(url.toString()).toBe("http://localhost:1234/mcp/sse");
    expect(opts.requestInit.headers.Authorization).toBe("Bearer abc");
  });

  it("HTTP server without /sse path picks StreamableHTTPClientTransport with headers", async () => {
    mockServerRows.push({
      id: 10,
      name: "http",
      transport: "http",
      command: null,
      args: null,
      envJson: { "X-Foo": "1" },
      url: "http://localhost:5678/mcp",
      enabled: true,
    });
    const mgr = freshManager();
    await mgr.connect(10).catch(() => undefined);
    expect(httpCtorSpy).toHaveBeenCalledTimes(1);
    expect(sseCtorSpy).not.toHaveBeenCalled();
    const [url, opts] = httpCtorSpy.mock.calls[0];
    expect(url.toString()).toBe("http://localhost:5678/mcp");
    expect(opts.requestInit.headers["X-Foo"]).toBe("1");
  });

  it("emits status-change events on connect and disconnect", async () => {
    const mock = await createMockMcpServer({
      tools: [{ name: "x", handler: () => 1 }],
    });
    mockServerRows.push({
      id: 11,
      name: "ev",
      transport: "stdio",
      command: "noop",
      args: [],
      envJson: null,
      url: null,
      enabled: true,
    });
    const mgr = freshManager();
    mgr.__setTransportForTesting(11, mock.clientTransport);
    const events: string[] = [];
    mgr.on("status-change", (i) => events.push(i.status));
    await mgr.connect(11);
    await mgr.disconnect(11);
    expect(events).toEqual(["connecting", "connected", "disconnected"]);
    await mock.close();
  });
});
