import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("electron", () => ({}));

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
      from: () => Promise.resolve(mockServerRows),
    }),
  },
}));

// `mcpServers` is only used as a Drizzle table reference inside
// `db.select().from(mcpServers)`, and our `from()` mock above ignores the
// argument entirely. An empty object satisfies the runtime contract; we
// type it as `Record<string, never>` to avoid an explicit `any`.
vi.mock("../db/schema", () => ({
  mcpServers: {} as Record<string, never>,
}));

const hubMock = vi.hoisted(() => ({
  getStatus: vi.fn(),
  connect: vi.fn(),
  listTools: vi.fn(),
  callTool: vi.fn(),
}));

vi.mock("../ipc/utils/mcp_hub_manager", () => ({
  mcpHubManager: hubMock,
}));

vi.mock("../ipc/utils/mcp_consent", () => ({
  getStoredConsent: vi.fn().mockResolvedValue("always"),
  requireMcpToolConsent: vi.fn().mockResolvedValue(true),
}));

import { buildMcpToolSet, namespaceToolName } from "../lib/mcp_ai_bridge";

beforeEach(() => {
  mockServerRows.length = 0;
  hubMock.getStatus.mockReset();
  hubMock.connect.mockReset();
  hubMock.listTools.mockReset();
  hubMock.callTool.mockReset();
});

describe("namespaceToolName", () => {
  it("slugifies server + tool with mcp__ prefix", () => {
    expect(namespaceToolName("My Server!", "do.thing")).toBe(
      "mcp__my_server__do_thing",
    );
  });

  it("trims leading/trailing underscores", () => {
    expect(namespaceToolName("__weird__", "tool")).toBe("mcp__weird__tool");
  });
});

describe("buildMcpToolSet", () => {
  it("returns empty toolset when no servers are enabled", async () => {
    const result = await buildMcpToolSet();
    expect(result.summary.totalTools).toBe(0);
    expect(Object.keys(result.tools)).toHaveLength(0);
  });

  it("only includes enabled servers", async () => {
    mockServerRows.push({
      id: 1,
      name: "Disabled",
      transport: "http",
      command: null,
      args: null,
      envJson: null,
      url: "http://x",
      enabled: false,
    });
    const result = await buildMcpToolSet();
    expect(result.summary.totalTools).toBe(0);
  });

  it("namespaces tools and reports per-server counts", async () => {
    mockServerRows.push({
      id: 1,
      name: "GitHub",
      transport: "http",
      command: null,
      args: null,
      envJson: null,
      url: "http://gh",
      enabled: true,
    });
    hubMock.getStatus.mockReturnValue({
      serverId: 1,
      status: "connected",
    });
    hubMock.listTools.mockResolvedValue([
      {
        name: "create_issue",
        description: "Create a GitHub issue",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            body: { type: "string" },
          },
          required: ["title"],
        },
      },
    ]);

    const result = await buildMcpToolSet();
    expect(result.summary.totalTools).toBe(1);
    expect(result.summary.serversIncluded).toEqual([
      { id: 1, name: "GitHub", toolCount: 1 },
    ]);
    expect(Object.keys(result.tools)).toEqual(["mcp__github__create_issue"]);
  });

  it("auto-connects disconnected servers", async () => {
    mockServerRows.push({
      id: 2,
      name: "Slack",
      transport: "http",
      command: null,
      args: null,
      envJson: null,
      url: "http://slack",
      enabled: true,
    });
    hubMock.getStatus.mockReturnValue({
      serverId: 2,
      status: "disconnected",
    });
    hubMock.connect.mockResolvedValue(undefined);
    hubMock.listTools.mockResolvedValue([]);

    await buildMcpToolSet();
    expect(hubMock.connect).toHaveBeenCalledWith(2);
  });

  it("respects skipAutoConnect", async () => {
    mockServerRows.push({
      id: 3,
      name: "Notion",
      transport: "http",
      command: null,
      args: null,
      envJson: null,
      url: "http://notion",
      enabled: true,
    });
    hubMock.getStatus.mockReturnValue({
      serverId: 3,
      status: "disconnected",
    });

    await buildMcpToolSet({ skipAutoConnect: true });
    expect(hubMock.connect).not.toHaveBeenCalled();
  });

  it("captures failed servers in summary instead of throwing", async () => {
    mockServerRows.push({
      id: 4,
      name: "Broken",
      transport: "http",
      command: null,
      args: null,
      envJson: null,
      url: "http://broken",
      enabled: true,
    });
    hubMock.getStatus.mockReturnValue({
      serverId: 4,
      status: "disconnected",
    });
    hubMock.connect.mockRejectedValue(new Error("connect failed"));

    const result = await buildMcpToolSet();
    expect(result.summary.totalTools).toBe(0);
    expect(result.summary.serversFailed).toEqual([
      { id: 4, name: "Broken", error: "connect failed" },
    ]);
  });

  it("filters by serverIds when supplied", async () => {
    mockServerRows.push(
      {
        id: 1,
        name: "A",
        transport: "http",
        command: null,
        args: null,
        envJson: null,
        url: "http://a",
        enabled: true,
      },
      {
        id: 2,
        name: "B",
        transport: "http",
        command: null,
        args: null,
        envJson: null,
        url: "http://b",
        enabled: true,
      },
    );
    hubMock.getStatus.mockReturnValue({
      serverId: 1,
      status: "connected",
    });
    hubMock.listTools.mockResolvedValue([
      { name: "ping", description: "p", inputSchema: { type: "object" } },
    ]);

    const result = await buildMcpToolSet({ serverIds: [1] });
    expect(result.summary.serversIncluded.map((s) => s.id)).toEqual([1]);
  });

  it("respects toolDenyList", async () => {
    mockServerRows.push({
      id: 1,
      name: "GitHub",
      transport: "http",
      command: null,
      args: null,
      envJson: null,
      url: "http://gh",
      enabled: true,
    });
    hubMock.getStatus.mockReturnValue({
      serverId: 1,
      status: "connected",
    });
    hubMock.listTools.mockResolvedValue([
      { name: "create_issue", description: "", inputSchema: {} },
      { name: "delete_repo", description: "", inputSchema: {} },
    ]);

    const result = await buildMcpToolSet({
      toolDenyList: ["mcp__github__delete_repo"],
    });
    expect(Object.keys(result.tools)).toEqual(["mcp__github__create_issue"]);
  });
});
