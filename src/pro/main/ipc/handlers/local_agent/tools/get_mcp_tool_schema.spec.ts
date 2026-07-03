import { describe, expect, it, vi } from "vitest";
import { getMcpToolSchemaTool } from "./get_mcp_tool_schema";
import type { McpToolDef } from "./mcp_type_defs";
import type { AgentContext } from "./types";

function def(
  overrides: Partial<McpToolDef> & { toolName: string },
): McpToolDef {
  return {
    jsName: `srv__${overrides.toolName}`,
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
    jsName: "github__create_issue",
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
    jsName: "slack__send_message",
    toolName: "send_message",
    serverName: "slack",
    description: "Post a message to a channel",
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

describe("getMcpToolSchemaTool.isEnabled", () => {
  it("is enabled when search mode is available for the turn", () => {
    expect(
      getMcpToolSchemaTool.isEnabled?.({
        isMcpToolSearchAvailable: true,
      } as unknown as AgentContext),
    ).toBe(true);
  });

  it("is disabled in inline mode (search not available)", () => {
    expect(
      getMcpToolSchemaTool.isEnabled?.({
        isMcpToolSearchAvailable: false,
      } as unknown as AgentContext),
    ).toBe(false);
    expect(
      getMcpToolSchemaTool.isEnabled?.({} as unknown as AgentContext),
    ).toBe(false);
  });
});

describe("getMcpToolSchemaTool.execute", () => {
  it("returns description + full declaration for tools requested by jsName", async () => {
    const ctx = makeCtx(TOOLS);
    const result = await getMcpToolSchemaTool.execute(
      { tools: ["github__create_issue"] },
      ctx,
    );
    expect(result).toContain("declare function github__create_issue");
    expect(result).toContain("Create a new issue in a repository"); // description included
    expect(result).toContain("title");
    expect(result).not.toContain("declare function slack__send_message");
    expect(ctx.onXmlComplete).toHaveBeenCalledOnce();
  });

  it("also resolves tools requested by raw toolName", async () => {
    const ctx = makeCtx(TOOLS);
    const result = await getMcpToolSchemaTool.execute(
      { tools: ["send_message"] },
      ctx,
    );
    expect(result).toContain("declare function slack__send_message");
  });

  it("returns multiple requested tools and notes the ones with no match", async () => {
    const ctx = makeCtx(TOOLS);
    const result = await getMcpToolSchemaTool.execute(
      { tools: ["github__create_issue", "nope"] },
      ctx,
    );
    expect(result).toContain("declare function github__create_issue");
    expect(result).toContain("No match for: nope");
  });

  it("returns a helpful message when no requested tool matches", async () => {
    const ctx = makeCtx(TOOLS);
    const result = await getMcpToolSchemaTool.execute(
      { tools: ["does_not_exist"] },
      ctx,
    );
    expect(result).toContain("No MCP tool matched");
    expect(result).not.toContain("declare function");
  });

  it("reports tools unavailable when the handler did not populate defs", async () => {
    const ctx = makeCtx(undefined);
    const result = await getMcpToolSchemaTool.execute(
      { tools: ["github__create_issue"] },
      ctx,
    );
    expect(result).toContain("temporarily unavailable");
    expect(result).not.toContain("declare function");
  });
});
