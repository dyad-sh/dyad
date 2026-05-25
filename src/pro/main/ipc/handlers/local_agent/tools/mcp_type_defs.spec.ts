import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMcpCapabilityMap,
  buildMcpTypeDefsBlock,
  type McpToolDef,
} from "./mcp_type_defs";
import { mcpManager } from "@/ipc/utils/mcp_manager";
import { requireMcpToolConsent } from "@/ipc/utils/mcp_consent";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { AgentContext } from "./types";

vi.mock("@/ipc/utils/mcp_manager", () => ({
  mcpManager: {
    getClient: vi.fn(),
  },
}));

vi.mock("@/ipc/utils/mcp_consent", () => ({
  requireMcpToolConsent: vi.fn(),
}));

function def(overrides: Partial<McpToolDef> & { jsName: string }): McpToolDef {
  return {
    toolKey: overrides.jsName,
    serverId: 1,
    serverName: "test_server",
    toolName: overrides.jsName,
    description: undefined,
    inputSchema: { type: "object" },
    ...overrides,
  };
}

describe("buildMcpTypeDefsBlock", () => {
  it("returns an empty string when defs are empty", () => {
    expect(buildMcpTypeDefsBlock([])).toBe("");
  });

  it("emits a JSDoc + declare function for each tool", () => {
    const block = buildMcpTypeDefsBlock([
      def({
        jsName: "test_server__hello",
        description: "Greet someone",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      }),
    ]);
    expect(block).toContain("type McpResult");
    expect(block).toContain("// ---- Server: test_server ----");
    expect(block).toContain("/** Greet someone */");
    expect(block).toContain(
      "declare function test_server__hello(args: {\n  name: string;\n} & Record<string, unknown>): Promise<McpResult>;",
    );
  });

  it("collapses multi-line tool descriptions into a single line", () => {
    const block = buildMcpTypeDefsBlock([
      def({
        jsName: "t",
        description: "first line\n  second line\n\n  third line",
        inputSchema: { type: "object" },
      }),
    ]);
    expect(block).toContain("/** first line second line third line */");
  });

  it("groups tools by serverName and preserves order within a server", () => {
    const block = buildMcpTypeDefsBlock([
      def({
        jsName: "a__one",
        serverName: "alpha",
        inputSchema: { type: "object" },
      }),
      def({
        jsName: "b__one",
        serverName: "beta",
        inputSchema: { type: "object" },
      }),
      def({
        jsName: "a__two",
        serverName: "alpha",
        inputSchema: { type: "object" },
      }),
    ]);
    expect(block).toMatchInlineSnapshot(`
      "type McpResult = {
        content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
          | { type: "resource"; resource: unknown }
        >;
        isError?: boolean;
      };

      // ---- Server: alpha ----
      declare function a__one(args: Record<string, unknown>): Promise<McpResult>;

      declare function a__two(args: Record<string, unknown>): Promise<McpResult>;

      // ---- Server: beta ----
      declare function b__one(args: Record<string, unknown>): Promise<McpResult>;
      "
    `);
  });
});

function createCtx(): AgentContext {
  return {
    event: {} as any,
    appId: 1,
    appPath: "/tmp",
    referencedApps: new Map(),
    chatId: 7,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    neonProjectId: null,
    neonActiveBranchId: null,
    frameworkType: null,
    messageId: 1,
    isSharedModulesChanged: false,
    isDyadPro: false,
    todos: [],
    dyadRequestId: "spec",
    fileEditTracker: {},
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    requireConsent: vi.fn().mockResolvedValue(true),
    appendUserMessage: vi.fn(),
    onUpdateTodos: vi.fn(),
  };
}

function makeDef(): McpToolDef {
  return {
    jsName: "srv__hello",
    toolKey: "srv__hello",
    serverId: 42,
    serverName: "srv",
    toolName: "hello",
    description: "Greet",
    inputSchema: { type: "object" },
  };
}

describe("buildMcpCapabilityMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invokes the MCP tool and emits tool-call + tool-result XML on success", async () => {
    vi.mocked(requireMcpToolConsent).mockResolvedValue(true);
    const execute = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "hi" }],
    });
    vi.mocked(mcpManager.getClient).mockResolvedValue({
      tools: async () => ({ hello: { execute } }),
    } as any);

    const ctx = createCtx();
    const map = buildMcpCapabilityMap({
      event: {} as any,
      ctx,
      defs: [makeDef()],
    });

    const result = await map.srv__hello({ name: "World" });

    expect(result).toEqual({ content: [{ type: "text", text: "hi" }] });
    expect(execute).toHaveBeenCalledWith(
      { name: "World" },
      expect.objectContaining({ toolCallId: "mcp-sandbox-srv__hello" }),
    );
    const xmls = vi.mocked(ctx.onXmlComplete).mock.calls.map((c) => c[0]);
    expect(xmls.some((x) => x.startsWith("<dyad-mcp-tool-call"))).toBe(true);
    expect(xmls.some((x) => x.startsWith("<dyad-mcp-tool-result"))).toBe(true);
  });

  it("throws a DyadError(UserCancelled) and skips execution when consent is denied", async () => {
    vi.mocked(requireMcpToolConsent).mockResolvedValue(false);
    const execute = vi.fn();
    vi.mocked(mcpManager.getClient).mockResolvedValue({
      tools: async () => ({ hello: { execute } }),
    } as any);

    const ctx = createCtx();
    const map = buildMcpCapabilityMap({
      event: {} as any,
      ctx,
      defs: [makeDef()],
    });

    let rejection: unknown;
    try {
      await map.srv__hello({});
    } catch (e) {
      rejection = e;
    }
    expect(rejection).toBeInstanceOf(DyadError);
    expect((rejection as DyadError).kind).toBe(DyadErrorKind.UserCancelled);
    expect((rejection as DyadError).message).toBe(
      "User declined running tool srv__hello",
    );
    expect(execute).not.toHaveBeenCalled();
    expect(ctx.onXmlComplete).not.toHaveBeenCalled();
  });

  it("throws a DyadError(NotFound) when the live client no longer exposes the tool", async () => {
    vi.mocked(requireMcpToolConsent).mockResolvedValue(true);
    vi.mocked(mcpManager.getClient).mockResolvedValue({
      tools: async () => ({}),
    } as any);

    const ctx = createCtx();
    const map = buildMcpCapabilityMap({
      event: {} as any,
      ctx,
      defs: [makeDef()],
    });

    let rejection: unknown;
    try {
      await map.srv__hello({});
    } catch (e) {
      rejection = e;
    }
    expect(rejection).toBeInstanceOf(DyadError);
    expect((rejection as DyadError).kind).toBe(DyadErrorKind.NotFound);
    expect((rejection as DyadError).message).toBe(
      "MCP tool srv__hello not found at runtime",
    );
  });

  it("emits an error <dyad-output> and re-throws when the MCP tool execute() fails", async () => {
    vi.mocked(requireMcpToolConsent).mockResolvedValue(true);
    const execute = vi.fn().mockRejectedValue(new Error("upstream boom"));
    vi.mocked(mcpManager.getClient).mockResolvedValue({
      tools: async () => ({ hello: { execute } }),
    } as any);

    const ctx = createCtx();
    const map = buildMcpCapabilityMap({
      event: {} as any,
      ctx,
      defs: [makeDef()],
    });

    await expect(map.srv__hello({})).rejects.toThrow("upstream boom");
    const xmls = vi.mocked(ctx.onXmlComplete).mock.calls.map((c) => c[0]);
    expect(xmls.some((x) => x.startsWith("<dyad-mcp-tool-call"))).toBe(true);
    expect(
      xmls.some(
        (x) =>
          x.startsWith("<dyad-output") &&
          x.includes("MCP tool 'srv__hello' failed"),
      ),
    ).toBe(true);
    expect(xmls.some((x) => x.startsWith("<dyad-mcp-tool-result"))).toBe(false);
  });
});
