import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMcpCapabilityMap,
  buildMcpTypeDefsBlock,
  buildMcpToolNameInventory,
  resolveMcpToolDefs,
  estimateMcpInlineTokens,
  getMcpInlineTokenThreshold,
  MCP_INLINE_TOKEN_THRESHOLD,
  type McpToolDef,
} from "./mcp_type_defs";
import { mcpManager } from "@/ipc/utils/mcp_manager";
import { requireMcpToolConsent } from "@/ipc/utils/mcp_consent";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { AgentContext } from "./types";
import { MCP_RESULT_MAX_BYTES } from "@/ipc/utils/mcp_result_sanitizer";

vi.mock("@/ipc/utils/mcp_manager", () => ({
  mcpManager: {
    getClient: vi.fn(),
  },
}));

vi.mock("@/ipc/utils/mcp_consent", () => ({
  requireMcpToolConsent: vi.fn(),
}));

const mockState = vi.hoisted(() => ({
  settings: { autoApproveSafeMcpTools: true },
}));

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => mockState.settings),
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
    expect(block).toMatchInlineSnapshot(`
      "type McpResult = {
        content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
          | { type: "resource"; resource: unknown }
        >;
        isError?: boolean;
      };

      // ---- Server: test_server ----
      /** Greet someone */
      declare function test_server__hello(args: {
        name: string;
      } & Record<string, unknown>): Promise<McpResult>;
      "
    `);
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

describe("buildMcpToolNameInventory", () => {
  it("returns an empty string when defs are empty", () => {
    expect(buildMcpToolNameInventory([])).toBe("");
  });

  it("lists jsNames grouped by server, no descriptions or schemas", () => {
    const block = buildMcpToolNameInventory([
      def({
        jsName: "github__search_repositories",
        serverName: "github",
        description: "Find repositories by name/description/topic",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      }),
      def({ jsName: "github__list_commits", serverName: "github" }),
      def({ jsName: "linear__list_issues", serverName: "linear" }),
    ]);
    expect(block).toMatchInlineSnapshot(`
      "// github
      - github__search_repositories
      - github__list_commits
      // linear
      - linear__list_issues"
    `);
    expect(block).not.toContain("declare function");
    expect(block).not.toContain("Find repositories");
    expect(block).not.toContain("query");
  });
});

describe("resolveMcpToolDefs", () => {
  const defs = [
    def({ jsName: "github__create_issue", toolName: "create_issue" }),
    def({ jsName: "slack__send_message", toolName: "send_message" }),
  ];

  it("resolves by jsName and by raw toolName", () => {
    const { found, missing } = resolveMcpToolDefs(defs, [
      "github__create_issue",
      "send_message",
    ]);
    expect(found.map((d) => d.jsName)).toEqual([
      "github__create_issue",
      "slack__send_message",
    ]);
    expect(missing).toEqual([]);
  });

  it("collapses duplicates and collects unmatched names", () => {
    const { found, missing } = resolveMcpToolDefs(defs, [
      "github__create_issue",
      "create_issue",
      "nope",
    ]);
    expect(found.map((d) => d.jsName)).toEqual(["github__create_issue"]);
    expect(missing).toEqual(["nope"]);
  });

  it("returns all matches when a raw toolName is shared across servers", () => {
    const collidingDefs = [
      def({ jsName: "github__create_issue", toolName: "create_issue" }),
      def({ jsName: "linear__create_issue", toolName: "create_issue" }),
    ];
    const { found, missing } = resolveMcpToolDefs(collidingDefs, [
      "create_issue",
    ]);
    expect(found.map((d) => d.jsName)).toEqual([
      "github__create_issue",
      "linear__create_issue",
    ]);
    expect(missing).toEqual([]);
  });

  it("resolves a jsName to exactly its def even when the toolName collides", () => {
    const collidingDefs = [
      def({ jsName: "github__create_issue", toolName: "create_issue" }),
      def({ jsName: "linear__create_issue", toolName: "create_issue" }),
    ];
    const { found } = resolveMcpToolDefs(collidingDefs, [
      "linear__create_issue",
    ]);
    expect(found.map((d) => d.jsName)).toEqual(["linear__create_issue"]);
  });
});

describe("estimateMcpInlineTokens", () => {
  it("is 0 for an empty catalog and grows with more tools", () => {
    expect(estimateMcpInlineTokens([])).toBe(0);
    const one = estimateMcpInlineTokens([
      def({ jsName: "a__one", inputSchema: { type: "object" } }),
    ]);
    const many = estimateMcpInlineTokens(
      Array.from({ length: 10 }, (_, i) =>
        def({ jsName: `a__t${i}`, inputSchema: { type: "object" } }),
      ),
    );
    expect(one).toBeGreaterThan(0);
    expect(many).toBeGreaterThan(one);
  });
});

describe("getMcpInlineTokenThreshold", () => {
  const KEY = "DYAD_MCP_INLINE_TOKEN_THRESHOLD";
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it("defaults to MCP_INLINE_TOKEN_THRESHOLD", () => {
    delete process.env[KEY];
    expect(getMcpInlineTokenThreshold()).toBe(MCP_INLINE_TOKEN_THRESHOLD);
  });

  it("honors a valid env override (including 0)", () => {
    process.env[KEY] = "0";
    expect(getMcpInlineTokenThreshold()).toBe(0);
    process.env[KEY] = "500";
    expect(getMcpInlineTokenThreshold()).toBe(500);
  });

  it("falls back to the default for invalid values", () => {
    process.env[KEY] = "not-a-number";
    expect(getMcpInlineTokenThreshold()).toBe(MCP_INLINE_TOKEN_THRESHOLD);
    process.env[KEY] = "-5";
    expect(getMcpInlineTokenThreshold()).toBe(MCP_INLINE_TOKEN_THRESHOLD);
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
    sharedServerModulePaths: [],
    pendingFunctionDeploys: [],
    isDyadPro: false,
    todos: [],
    dyadRequestId: "spec",
    fileEditTracker: {},
    testingEnabled: true,
    testRunAttempts: new Map(),
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
    mockState.settings = { autoApproveSafeMcpTools: true };
  });

  it("invokes the MCP tool and emits tool-call + tool-result XML on success", async () => {
    vi.mocked(requireMcpToolConsent).mockResolvedValue({ approved: true });
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

  it("wraps a plain-string MCP result into the declared McpResult shape", async () => {
    vi.mocked(requireMcpToolConsent).mockResolvedValue({ approved: true });
    const execute = vi.fn().mockResolvedValue("hello world");
    vi.mocked(mcpManager.getClient).mockResolvedValue({
      tools: async () => ({ hello: { execute } }),
    } as any);

    const ctx = createCtx();
    const map = buildMcpCapabilityMap({
      event: {} as any,
      ctx,
      defs: [makeDef()],
    });

    const result = await map.srv__hello({});

    expect(result).toEqual({
      content: [{ type: "text", text: "hello world" }],
    });
    const resultXml = vi
      .mocked(ctx.onXmlComplete)
      .mock.calls.map((c) => c[0])
      .find((x) => x.startsWith("<dyad-mcp-tool-result"));
    expect(resultXml).toContain("hello world");
  });

  it("bounds oversized text and embedded media before returning or emitting the result", async () => {
    vi.mocked(requireMcpToolConsent).mockResolvedValue({ approved: true });
    const hugeText = "z".repeat(MCP_RESULT_MAX_BYTES * 3);
    const hugeImage = "A".repeat(MCP_RESULT_MAX_BYTES * 3);
    const execute = vi.fn().mockResolvedValue({
      content: [
        { type: "image", data: hugeImage, mimeType: "image/png" },
        { type: "text", text: hugeText },
      ],
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

    const result = await map.srv__hello({});
    const serializedResult = JSON.stringify(result);
    expect(Buffer.byteLength(serializedResult, "utf8")).toBeLessThanOrEqual(
      MCP_RESULT_MAX_BYTES,
    );
    expect(serializedResult).not.toContain(hugeText);
    expect(serializedResult).not.toContain(hugeImage);
    expect(serializedResult).toContain("_dyadMcpTruncation");

    const resultXml = vi
      .mocked(ctx.onXmlComplete)
      .mock.calls.map((call) => call[0])
      .find((xml) => xml.startsWith("<dyad-mcp-tool-result"));
    expect(resultXml).toContain("_dyadMcpTruncation");
    expect(resultXml).not.toContain(hugeText);
    expect(resultXml).not.toContain(hugeImage);
  });

  it("throws a DyadError(UserCancelled) and skips execution when consent is denied", async () => {
    vi.mocked(requireMcpToolConsent).mockResolvedValue({ approved: false });
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

  it("does not pass an auto-approve callback during Dyad Free turns", async () => {
    vi.mocked(requireMcpToolConsent).mockResolvedValue({ approved: false });

    const ctx = createCtx();
    ctx.isDyadPro = true;
    ctx.freeModelMode = true;
    const map = buildMcpCapabilityMap({
      event: {} as any,
      ctx,
      defs: [makeDef()],
    });

    await expect(map.srv__hello({})).rejects.toMatchObject({
      kind: DyadErrorKind.UserCancelled,
    });
    expect(requireMcpToolConsent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ autoApprove: undefined }),
    );
  });

  it("throws a DyadError(NotFound) when the live client no longer exposes the tool", async () => {
    vi.mocked(requireMcpToolConsent).mockResolvedValue({ approved: true });
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

  it("emits a failed tool-result and error <dyad-output> and re-throws when the MCP tool execute() fails", async () => {
    vi.mocked(requireMcpToolConsent).mockResolvedValue({ approved: true });
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
    expect(
      xmls.some(
        (x) =>
          x.startsWith("<dyad-mcp-tool-result") &&
          x.includes('is-error="true"'),
      ),
    ).toBe(true);
  });
});

// No test for built-in-name collisions: the `serverNameSanitized__`
// prefix on every toolKey makes a bare match like `read_file`
// unreachable today. The seeded reserved set in `collectMcpToolDefs`
// is defense in depth for future key-format or built-in changes.
