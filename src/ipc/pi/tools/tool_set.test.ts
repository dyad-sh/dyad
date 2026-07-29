// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

// Keep consent lookups deterministic regardless of on-disk settings: every
// tool's stored consent resolves to its declared default (never "never"), so
// tool-set membership is decided purely by chat-mode gating.
vi.mock("@/main/settings", () => ({
  readSettings: () => ({
    agentToolConsents: {},
    autoApproveNonSchemaSql: false,
  }),
  writeSettings: () => {},
}));

import type { AgentContext } from "./dyad/types";
import { buildPiToolSet, chatModeToToolOptions } from "./tool_set";

function gatingContext(overrides: Partial<AgentContext> = {}): AgentContext {
  // Only the fields read by shouldIncludeTool / tool.isEnabled matter here.
  return {
    appId: 1,
    appPath: "/tmp/app",
    chatId: 1,
    messageId: 1,
    referencedApps: new Map(),
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    neonProjectId: null,
    neonActiveBranchId: null,
    frameworkType: null,
    isSharedModulesChanged: false,
    sharedServerModulePaths: [],
    pendingFunctionDeploys: [],
    todos: [],
    dyadRequestId: "req-1",
    toolConsents: {},
    autoApproveNonSchemaSql: false,
    fileEditTracker: {},
    testingEnabled: false,
    testRunAttempts: new Map(),
    onXmlStream: () => {},
    onXmlComplete: () => {},
    requireConsent: async () => true,
    appendUserMessage: () => {},
    onUpdateTodos: () => {},
    ...overrides,
  } as unknown as AgentContext;
}

const noopFactory = () => gatingContext();

function toolNames(chatMode: "local-agent" | "ask" | "plan"): string[] {
  return buildPiToolSet({
    chatMode,
    gatingContext: gatingContext(),
    contextFactory: noopFactory,
  })
    .map((t) => t.name)
    .sort();
}

describe("chatModeToToolOptions", () => {
  it("maps ask -> readOnly", () => {
    expect(chatModeToToolOptions("ask")).toEqual({ readOnly: true });
  });

  it("maps plan -> planModeOnly", () => {
    expect(chatModeToToolOptions("plan")).toEqual({ planModeOnly: true });
  });

  it("maps local-agent -> full set (no restrictions)", () => {
    expect(chatModeToToolOptions("local-agent")).toEqual({});
  });
});

describe("buildPiToolSet", () => {
  it("agent mode includes state-modifying tools", () => {
    const names = toolNames("local-agent");
    // write_file is unconditionally available; execute_sql is gated behind a
    // configured DB integration (isEnabled), so it is intentionally absent here.
    expect(names).toContain("write_file");
    expect(names).toContain("bash");
    expect(names).toContain("delete_file");
    expect(names.length).toBeGreaterThan(0);
  });

  it("ask mode excludes state-modifying tools but keeps read-only ones", () => {
    const names = toolNames("ask");
    expect(names).not.toContain("write_file");
    expect(names).not.toContain("bash");
    expect(names).not.toContain("execute_sql");
    expect(names).not.toContain("set_chat_summary");
    expect(names).toContain("read_file");
  });

  it("only exposes web tools when web access is enabled and configured", () => {
    const disabled = buildPiToolSet({
      chatMode: "ask",
      gatingContext: gatingContext(),
      contextFactory: noopFactory,
    }).map((tool) => tool.name);
    const fetchOnly = buildPiToolSet({
      chatMode: "ask",
      gatingContext: gatingContext({ webAccessEnabled: true }),
      contextFactory: noopFactory,
    }).map((tool) => tool.name);
    const configured = buildPiToolSet({
      chatMode: "ask",
      gatingContext: gatingContext({
        webAccessEnabled: true,
        webSearchConfig: { provider: "auto", exaApiKey: "test-key" },
      }),
      contextFactory: noopFactory,
    }).map((tool) => tool.name);

    expect(disabled).not.toContain("fetch_content");
    expect(disabled).not.toContain("web_search");
    expect(fetchOnly).toContain("fetch_content");
    expect(fetchOnly).not.toContain("web_search");
    expect(configured).toContain("fetch_content");
    expect(configured).toContain("web_search");
  });

  it("plan mode includes planning tools and excludes plain write tools", () => {
    const names = toolNames("plan");
    expect(names).toContain("write_plan");
    expect(names).toContain("exit_plan");
    expect(names).not.toContain("write_file");
    expect(names).not.toContain("bash");
  });

  it("plan-mode-only tools are absent from agent mode", () => {
    const names = toolNames("local-agent");
    expect(names).not.toContain("write_plan");
    expect(names).not.toContain("exit_plan");
  });

  it("every adapted tool exposes a typebox parameters schema", () => {
    const tools = buildPiToolSet({
      chatMode: "local-agent",
      gatingContext: gatingContext(),
      contextFactory: noopFactory,
    });
    for (const tool of tools) {
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.description).toBe("string");
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("hides mutating tools while an app blueprint is pending", () => {
    const names = buildPiToolSet({
      chatMode: "local-agent",
      gatingContext: gatingContext({ enableAppBlueprint: true }),
      contextFactory: noopFactory,
      optionOverrides: {
        enableAppBlueprint: true,
        appBlueprintPending: true,
      },
    }).map((tool) => tool.name);

    expect(names).toContain("write_app_blueprint");
    expect(names).toContain("planning_questionnaire");
    expect(names).toContain("read_file");
    expect(names).not.toContain("write_file");
    expect(names).not.toContain("bash");
    expect(names).not.toContain("delete_file");
    expect(names).not.toContain("set_chat_summary");
  });

  it("keeps app blueprint attachments optional in the provider schema", () => {
    const tools = buildPiToolSet({
      chatMode: "local-agent",
      gatingContext: gatingContext({ enableAppBlueprint: true }),
      contextFactory: noopFactory,
      optionOverrides: { enableAppBlueprint: true },
    });
    const blueprint = tools.find((tool) => tool.name === "write_app_blueprint");

    expect(blueprint).toBeDefined();
    expect(
      (blueprint!.parameters as { required?: string[] }).required,
    ).not.toContain("attachments");
  });
});
