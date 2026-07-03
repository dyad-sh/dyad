import { describe, expect, it, vi } from "vitest";
import { searchMcpToolsTool } from "./search_mcp_tools";
import type { McpToolDef } from "./mcp_type_defs";
import type { AgentContext } from "./types";

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

describe("searchMcpToolsTool.isEnabled", () => {
  it("is enabled when search mode is available for the turn", () => {
    expect(
      searchMcpToolsTool.isEnabled?.({
        isMcpToolSearchAvailable: true,
      } as unknown as AgentContext),
    ).toBe(true);
  });

  it("is disabled in inline mode (search not available)", () => {
    expect(
      searchMcpToolsTool.isEnabled?.({
        isMcpToolSearchAvailable: false,
      } as unknown as AgentContext),
    ).toBe(false);
    expect(searchMcpToolsTool.isEnabled?.({} as unknown as AgentContext)).toBe(
      false,
    );
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

  it("reports tools unavailable when the handler did not populate defs", async () => {
    const ctx = makeCtx(undefined);
    const result = await searchMcpToolsTool.execute(
      { query: "create github issue" },
      ctx,
    );
    expect(result).toContain("temporarily unavailable");
    expect(result).not.toContain("declare function");
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
