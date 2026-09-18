import { describe, expect, it, vi } from "vitest";

import {
  BUILD_MODE_TOOL_NAMES,
  shouldIncludeTool,
  buildAgentToolSet,
  estimateAgentToolTokens,
  estimateBuildModeToolTokens,
  TOOL_DEFINITIONS,
} from "./tool_definitions";

describe("Build mode tool profile", () => {
  it("is an exact, engine-free, non-sub-agent allowlist", () => {
    expect(BUILD_MODE_TOOL_NAMES).toEqual([
      "write_file",
      "search_replace",
      "copy_file",
      "delete_file",
      "rename_file",
      "add_dependency",
      "execute_sql",
      "read_file",
      "list_files",
      "grep",
      "get_supabase_project_info",
      "get_neon_project_info",
      "get_database_table_schema",
      "set_chat_summary",
      "add_integration",
      "enable_nitro",
      "restart_app",
      "reinstall_and_restart_app",
      "update_todos",
      "read_guide",
      "planning_questionnaire",
      "write_app_blueprint",
    ]);

    const definitions = new Map(
      TOOL_DEFINITIONS.map((definition) => [definition.name, definition]),
    );
    for (const name of BUILD_MODE_TOOL_NAMES) {
      const definition = definitions.get(name);
      expect(
        definition,
        `${name} must exist in TOOL_DEFINITIONS`,
      ).toBeDefined();
      expect(definition?.usesEngineEndpoint, name).not.toBe(true);
      expect(definition?.subagentOnly, name).not.toBe(true);
    }
  });

  it("accounts for serialized Build tool declarations", async () => {
    const baseOptions = {
      enableAppBlueprint: false,
      isDyadPro: false,
      frameworkType: "vite" as const,
      supabaseProjectId: null,
      neonProjectId: null,
      neonActiveBranchId: null,
    };

    const withoutBlueprint = await estimateBuildModeToolTokens(baseOptions);
    const withBlueprint = await estimateBuildModeToolTokens({
      ...baseOptions,
      enableAppBlueprint: true,
    });

    expect(withoutBlueprint).toBeGreaterThan(1_000);
    expect(withBlueprint).toBeGreaterThan(withoutBlueprint);
  });

  it("accounts for tool declarations in every agent-backed mode", async () => {
    const baseOptions = {
      enableAppBlueprint: false,
      isDyadPro: false,
      frameworkType: "vite" as const,
      supabaseProjectId: null,
      neonProjectId: null,
      neonActiveBranchId: null,
    };

    await expect(
      estimateAgentToolTokens({ ...baseOptions, readOnly: true }),
    ).resolves.toBeGreaterThan(0);
    await expect(
      estimateAgentToolTokens({ ...baseOptions, planModeOnly: true }),
    ).resolves.toBeGreaterThan(0);
    await expect(estimateAgentToolTokens(baseOptions)).resolves.toBeGreaterThan(
      0,
    );
  });

  it("accounts for connected MCP tool declarations in Agent mode", async () => {
    const baseOptions = {
      enableAppBlueprint: false,
      isDyadPro: false,
      frameworkType: "vite" as const,
      supabaseProjectId: null,
      neonProjectId: null,
      neonActiveBranchId: null,
    };
    const withoutMcp = await estimateAgentToolTokens(baseOptions);
    const withMcp = await estimateAgentToolTokens({
      ...baseOptions,
      mcpToolDefs: [
        {
          jsName: "test_server__large_tool",
          toolKey: "test-server__large-tool",
          serverId: 1,
          serverName: "test-server",
          toolName: "large-tool",
          description: "A connected MCP tool with a declaration to count.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
            },
            required: ["query"],
          },
        },
      ],
    });

    expect(withMcp).toBeGreaterThan(withoutMcp);
  });

  it("uses runtime provider-tool availability when estimating declarations", async () => {
    const baseOptions = {
      enableAppBlueprint: false,
      isDyadPro: false,
      frameworkType: "vite" as const,
      supabaseProjectId: "supabase-project",
      supabaseProviderToolsAvailable: true,
      neonProjectId: "neon-project",
      neonActiveBranchId: "neon-branch",
    };

    const linkedNeonUnavailable = await estimateAgentToolTokens({
      ...baseOptions,
      neonProviderToolsAvailable: false,
    });
    const linkedNeonAvailable = await estimateAgentToolTokens({
      ...baseOptions,
      neonProviderToolsAvailable: true,
    });

    expect(linkedNeonAvailable).toBeGreaterThan(linkedNeonUnavailable);
  });
});

describe("discovery versus invocation availability", () => {
  it("keeps operationally unavailable pre-commit calls invocable but enforces read-only boundaries", () => {
    const tool = TOOL_DEFINITIONS.find(
      (tool) => tool.name === "run_pre_commit",
    )!;
    const ctx = {
      preCommitHookAvailable: false,
      isDyadPro: true,
    } as import("./tools/types").AgentContext;
    expect(shouldIncludeTool(tool, ctx)).toBe(false);
    expect(shouldIncludeTool(tool, ctx, {}, "invocation")).toBe(true);
    expect(shouldIncludeTool(tool, ctx, { readOnly: true }, "invocation")).toBe(
      false,
    );
  });
  it("runs an already-offered pre-commit tool through the shared guard after discovery changes", async () => {
    const ctx = {
      appId: 987656,
      appPath: "/tmp/unused-pre-commit",
      chatId: 1,
      isDyadPro: false,
      preCommitHookAvailable: true,
      preCommitRunCount: 100,
      onXmlComplete: vi.fn(),
      onXmlStream: vi.fn(),
      requireConsent: vi.fn(async () => true),
      referencedApps: new Map(),
      abortSignal: new AbortController().signal,
    } as unknown as import("./tools/types").AgentContext;
    const tools = buildAgentToolSet(ctx, { enableAppBlueprint: false });
    expect(tools.run_pre_commit).toBeDefined();
    ctx.preCommitHookAvailable = false;
    const result = await tools.run_pre_commit.execute({});
    expect(JSON.stringify(result)).toContain("already run");
    expect(ctx.onXmlComplete).toHaveBeenCalled();
  });
  it("does not turn search routing preferences into authorization while retaining Pro checks", () => {
    const tool = TOOL_DEFINITIONS.find((tool) => tool.name === "code_search")!;
    const ctx = {
      canUseExplorerSubagent: true,
      isDyadPro: true,
    } as import("./tools/types").AgentContext;
    expect(shouldIncludeTool(tool, ctx)).toBe(false);
    expect(shouldIncludeTool(tool, ctx, {}, "invocation")).toBe(true);
    expect(
      shouldIncludeTool(tool, { ...ctx, isDyadPro: false }, {}, "invocation"),
    ).toBe(false);
  });
});

describe("shell tool registration", () => {
  it("excludes shell from Build, Ask, Plan, Free turns and children", async () => {
    const { shouldIncludeTool } = await import("./tool_definitions");
    const tool = TOOL_DEFINITIONS.find((entry) => entry.name === "run_shell")!;
    const ctx = {
      isDyadPro: true,
      inferenceSettings: { enableShellTool: true },
    } as import("./tools/types").AgentContext;
    expect(shouldIncludeTool(tool, ctx)).toBe(true);
    for (const options of [
      { toolProfile: "build" as const },
      { readOnly: true },
      { planModeOnly: true },
      { freeModelMode: true },
    ]) {
      expect(shouldIncludeTool(tool, ctx, options)).toBe(false);
    }
    expect(
      shouldIncludeTool(tool, {
        ...ctx,
        mutationActivityOwner: {
          appId: 1,
          chatId: 1,
          turnId: "turn",
          actorRunId: "child",
          persona: "implementer",
        },
      }),
    ).toBe(false);
  });
});
