import { describe, expect, it, vi } from "vitest";

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({ agentToolConsents: {} })),
  writeSettings: vi.fn(),
}));

// tool_definitions and subagent_tools import each other. Evaluate the registry
// first so buildSubagentToolSet sees fully initialized definitions.
import "../tool_definitions";
import {
  buildSubagentToolSet,
  validateSubagentAllowedToolNames,
} from "./subagent_tools";
import type { AgentContext } from "./types";

// Kept out of subagent_tools.test.ts on purpose: that file mocks the whole
// subagent_manager module, which leaves the tool registry partly uninitialized
// and makes buildAgentToolSet unusable. These assertions need the real registry.
function rootContext(): AgentContext {
  return {
    isDyadPro: true,
    canUseAdvancedSubagentTools: true,
    sharedServerModulePaths: [],
    pendingFunctionDeploys: [],
    referencedApps: new Map(),
    fileEditTracker: { attemptsByFile: new Map() },
  } as unknown as AgentContext;
}

function toolNamesFor(persona: "explorer" | "implementer"): Set<string> {
  return new Set(
    Object.keys(
      buildSubagentToolSet({
        ctx: rootContext(),
        threadId: `${persona}-1`,
        persona,
        taskName: "Work on the auth flow",
        scope: ["src/auth"],
        abortSignal: new AbortController().signal,
      }),
    ),
  );
}

describe("sub-agent tool set", () => {
  it("rejects allowlist names missing from the tool registry", () => {
    expect(() =>
      validateSubagentAllowedToolNames(
        ["read_file", "run_typechecks"],
        [{ name: "read_file" }],
      ),
    ).toThrow(/run_typechecks/);
  });

  it("lets the Implementer verify its own work", () => {
    const names = toolNamesFor("implementer");

    expect(names.has("write_file")).toBe(true);
    expect(names.has("search_replace")).toBe(true);
    expect(names.has("run_type_checks")).toBe(true);
    expect(names.has("run_pre_commit")).toBe(false);
  });

  it("withholds session state the orchestrator owns", () => {
    const names = toolNamesFor("implementer");

    expect(names.has("update_todos")).toBe(false);
    expect(names.has("set_chat_summary")).toBe(false);
    expect(names.has("write_app_blueprint")).toBe(false);
    expect(names.has("add_integration")).toBe(false);
    expect(names.has("add_dependency")).toBe(false);
    expect(names.has("execute_sql")).toBe(false);
    expect(names.has("enable_nitro")).toBe(false);
    expect(names.has("generate_image")).toBe(false);
    expect(names.has("generate_test_assertions")).toBe(false);
    expect(names.has("reinstall_and_restart_app")).toBe(false);
    expect(names.has("execute_sandbox_script")).toBe(false);
    expect(names.has("search_mcp_tools")).toBe(false);
    expect(names.has("get_mcp_tool_schema")).toBe(false);
    expect(names.has("explore_chat_history")).toBe(false);
    expect(names.has("planning_questionnaire")).toBe(false);
  });

  it("blocks recursion", () => {
    expect(toolNamesFor("implementer").has("spawn_agent")).toBe(false);
    expect(toolNamesFor("explorer").has("spawn_agent")).toBe(false);
  });

  it("keeps the Explorer read-only", () => {
    const names = toolNamesFor("explorer");

    expect(names.has("read_file")).toBe(true);
    expect(names.has("write_file")).toBe(false);
    expect(names.has("search_replace")).toBe(false);
  });
});
