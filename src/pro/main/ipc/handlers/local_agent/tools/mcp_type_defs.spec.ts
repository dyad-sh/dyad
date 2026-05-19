import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMcpCapabilityMap,
  buildMcpTypeDefsBlock,
  jsonSchemaToTs,
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

describe("jsonSchemaToTs", () => {
  it("renders primitive types", () => {
    expect(jsonSchemaToTs({ type: "string" })).toBe("string");
    expect(jsonSchemaToTs({ type: "number" })).toBe("number");
    expect(jsonSchemaToTs({ type: "integer" })).toBe("number");
    expect(jsonSchemaToTs({ type: "boolean" })).toBe("boolean");
    expect(jsonSchemaToTs({ type: "null" })).toBe("null");
  });

  it("renders arrays of primitives and arrays of objects", () => {
    expect(jsonSchemaToTs({ type: "array", items: { type: "string" } })).toBe(
      "Array<string>",
    );
    expect(jsonSchemaToTs({ type: "array" })).toBe("Array<unknown>");
    const arrOfObj = jsonSchemaToTs({
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "number" } },
        required: ["id"],
      },
    });
    expect(arrOfObj).toBe("Array<{\n  id: number;\n}>");
  });

  it("renders objects with required and optional properties", () => {
    const out = jsonSchemaToTs({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
      required: ["name"],
    });
    expect(out).toBe("{\n  name: string;\n  age?: number;\n}");
  });

  it("emits JSDoc comments from property descriptions", () => {
    const out = jsonSchemaToTs({
      type: "object",
      properties: {
        url: { type: "string", description: "Target URL" },
      },
      required: ["url"],
    });
    expect(out).toContain("/** Target URL */");
    expect(out).toContain("url: string;");
  });

  it("collapses multi-line property descriptions into a single line", () => {
    const out = jsonSchemaToTs({
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Target URL\n  to fetch\n\n  (must be HTTPS)",
        },
      },
      required: ["url"],
    });
    // Newlines in a JSDoc body break out of the `/** ... */` envelope when
    // rendered, so the property description must be flattened to a single
    // line like the tool-level description is.
    expect(out).toContain("/** Target URL to fetch (must be HTTPS) */");
    expect(out).not.toMatch(/\/\*\*[^*]*\n[^*]*\*\//);
  });

  it("renders enum and const", () => {
    expect(jsonSchemaToTs({ enum: ["red", "blue", "green"] })).toBe(
      '"red" | "blue" | "green"',
    );
    expect(jsonSchemaToTs({ enum: [1, 2, 3] })).toBe("1 | 2 | 3");
    expect(jsonSchemaToTs({ const: "fixed" })).toBe('"fixed"');
    expect(jsonSchemaToTs({ const: 42 })).toBe("42");
  });

  it("renders anyOf / oneOf as unions and allOf as intersection", () => {
    expect(
      jsonSchemaToTs({ anyOf: [{ type: "string" }, { type: "number" }] }),
    ).toBe("string | number");
    expect(
      jsonSchemaToTs({ oneOf: [{ type: "boolean" }, { type: "null" }] }),
    ).toBe("boolean | null");
    expect(
      jsonSchemaToTs({
        allOf: [
          { type: "object", properties: { a: { type: "string" } } },
          { type: "object", properties: { b: { type: "number" } } },
        ],
      }),
    ).toContain(" & ");
  });

  it("renders type-as-array as a union", () => {
    expect(jsonSchemaToTs({ type: ["string", "null"] })).toBe("string | null");
  });

  it("renders additionalProperties as Record", () => {
    expect(jsonSchemaToTs({ type: "object", additionalProperties: true })).toBe(
      "Record<string, unknown>",
    );
    expect(
      jsonSchemaToTs({
        type: "object",
        additionalProperties: { type: "number" },
      }),
    ).toBe("Record<string, number>");
  });

  it("renders empty objects as {}", () => {
    expect(jsonSchemaToTs({ type: "object" })).toBe("{}");
    expect(jsonSchemaToTs({ type: "object", properties: {} })).toBe("{}");
  });

  it("quotes property keys that aren't valid JS identifiers", () => {
    const out = jsonSchemaToTs({
      type: "object",
      properties: { "with-hyphen": { type: "string" } },
      required: ["with-hyphen"],
    });
    expect(out).toContain('"with-hyphen": string;');
  });

  it("returns 'unknown' for missing or malformed schema", () => {
    expect(jsonSchemaToTs(null)).toBe("unknown");
    expect(jsonSchemaToTs(undefined)).toBe("unknown");
    expect(jsonSchemaToTs({ type: "garbage" })).toBe("unknown");
  });
});

describe("buildMcpTypeDefsBlock", () => {
  it("emits a 'no servers enabled' marker when defs are empty", () => {
    const block = buildMcpTypeDefsBlock([]);
    expect(block).toContain("type McpResult");
    expect(block).toContain("No MCP servers enabled");
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
      "declare function test_server__hello(args: {\n  name: string;\n}): Promise<McpResult>;",
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
    const alphaIdx = block.indexOf("// ---- Server: alpha ----");
    const betaIdx = block.indexOf("// ---- Server: beta ----");
    expect(alphaIdx).toBeGreaterThanOrEqual(0);
    expect(betaIdx).toBeGreaterThan(alphaIdx);
    const aOne = block.indexOf("a__one");
    const aTwo = block.indexOf("a__two");
    expect(aOne).toBeGreaterThan(0);
    expect(aTwo).toBeGreaterThan(aOne);
  });

  it("unwraps AI-SDK schema wrappers via the .jsonSchema getter", () => {
    const wrapped = {
      jsonSchema: {
        type: "object",
        properties: { count: { type: "integer" } },
        required: ["count"],
      },
    };
    const block = buildMcpTypeDefsBlock([
      def({ jsName: "wrap__tool", inputSchema: wrapped }),
    ]);
    expect(block).toContain(
      "declare function wrap__tool(args: {\n  count: number;\n}): Promise<McpResult>;",
    );
  });

  it("falls back to {} when input schema is unparseable", () => {
    const block = buildMcpTypeDefsBlock([
      def({ jsName: "broken__tool", inputSchema: 42 as unknown }),
    ]);
    expect(block).toContain("declare function broken__tool(args: {}):");
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
