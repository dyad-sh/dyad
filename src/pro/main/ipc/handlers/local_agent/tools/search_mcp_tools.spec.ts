import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchMcpToolsTool } from "./search_mcp_tools";
import type { McpToolDef } from "./mcp_type_defs";
import type { AgentContext } from "./types";

const readSettingsMock = vi.fn();

vi.mock("@/main/settings", () => ({
  readSettings: () => readSettingsMock(),
}));

// Avoid touching the DB if the tool ever falls back to a fresh collection.
vi.mock("./mcp_type_defs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mcp_type_defs")>();
  return { ...actual, collectMcpToolDefs: vi.fn(async () => []) };
});

function def(
  overrides: Partial<McpToolDef> & { toolName: string },
): McpToolDef {
  return {
    jsName: overrides.toolName,
    toolKey: `${overrides.serverName ?? "srv"}__${overrides.toolName}`,
    serverId: 1,
    serverName: "srv",
    description: undefined,
    inputSchema: { type: "object" },
    ...overrides,
  };
}

const TOOLS: McpToolDef[] = [
  def({
    toolName: "create_issue",
    serverName: "github",
    description: "Create a new issue in a repository",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
    },
  }),
  def({
    toolName: "send_message",
    serverName: "slack",
    description: "Post a message to a channel",
  }),
  def({
    toolName: "list_repositories",
    serverName: "github",
    description: "List repositories",
  }),
];

function makeCtx(defs: McpToolDef[] | undefined): AgentContext {
  return {
    mcpToolsEnabled: true,
    mcpToolDefs: defs,
    onXmlComplete: vi.fn(),
    onXmlStream: vi.fn(),
  } as unknown as AgentContext;
}

beforeEach(() => {
  readSettingsMock.mockReturnValue({
    enableMcpToolSearch: true,
    enableSandboxScriptExecution: true,
  });
});

describe("searchMcpToolsTool.isEnabled", () => {
  const baseCtx = { mcpToolsEnabled: true } as unknown as AgentContext;

  it("is enabled when sandbox + experiment + mcpToolsEnabled are all on", () => {
    expect(searchMcpToolsTool.isEnabled?.(baseCtx)).toBe(true);
  });

  it("is disabled when the experiment flag is off", () => {
    readSettingsMock.mockReturnValue({
      enableMcpToolSearch: false,
      enableSandboxScriptExecution: true,
    });
    expect(searchMcpToolsTool.isEnabled?.(baseCtx)).toBe(false);
  });

  it("is disabled when sandbox script execution is off", () => {
    readSettingsMock.mockReturnValue({
      enableMcpToolSearch: true,
      enableSandboxScriptExecution: false,
    });
    expect(searchMcpToolsTool.isEnabled?.(baseCtx)).toBe(false);
  });

  it("is disabled when MCP-in-sandbox is not active for the turn", () => {
    expect(
      searchMcpToolsTool.isEnabled?.({
        mcpToolsEnabled: false,
      } as unknown as AgentContext),
    ).toBe(false);
  });
});

describe("searchMcpToolsTool.execute", () => {
  it("returns TypeScript declarations for the best match", async () => {
    const ctx = makeCtx(TOOLS);
    const result = await searchMcpToolsTool.execute(
      { query: "create github issue" },
      ctx,
    );
    expect(result).toContain("declare function create_issue");
    expect(result).not.toContain("declare function send_message");
    expect(ctx.onXmlComplete).toHaveBeenCalledOnce();
  });

  it("filters to a single server when `server` is given", async () => {
    const ctx = makeCtx(TOOLS);
    const result = await searchMcpToolsTool.execute(
      { query: "list", server: "github" },
      ctx,
    );
    expect(result).toContain("declare function list_repositories");
    expect(result).not.toContain("send_message");
  });

  it("reports available servers when the server name is unknown", async () => {
    const ctx = makeCtx(TOOLS);
    const result = await searchMcpToolsTool.execute(
      { query: "anything", server: "does-not-exist" },
      ctx,
    );
    expect(result).toContain("No MCP server named");
    expect(result).toContain("github");
    expect(result).toContain("slack");
  });

  it("returns a helpful message when nothing matches the query", async () => {
    const ctx = makeCtx(TOOLS);
    const result = await searchMcpToolsTool.execute(
      { query: "zzzznomatch" },
      ctx,
    );
    expect(result).toContain('No MCP tools matched "zzzznomatch"');
  });

  it("includes a refine footer when more tools match than are returned", async () => {
    // Build 8 similar tools so more than MAX_RESULTS (5) match the query.
    const many: McpToolDef[] = Array.from({ length: 8 }, (_, i) =>
      def({
        toolName: `search_thing_${i}`,
        serverName: "srv",
        description: "search for a thing",
      }),
    );
    const ctx = makeCtx(many);
    const result = await searchMcpToolsTool.execute(
      { query: "search thing" },
      ctx,
    );
    expect(result).toMatch(/more tool\(s\) matched/);
  });
});
