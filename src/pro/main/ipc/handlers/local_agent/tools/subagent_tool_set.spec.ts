import { describe, expect, it } from "vitest";

// tool_definitions and subagent_tools import each other. Evaluating
// subagent_tools first leaves the registry holding undefined entries, so this
// import must come first — it is load-bearing, not an unused import.
import "../tool_definitions";
import { buildSubagentToolSet } from "./subagent_tools";
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
  it("lets the Implementer verify its own work", () => {
    const names = toolNamesFor("implementer");

    // The reason the filter is a denylist: an agent that can change code must
    // also be able to check it, rather than leaving the root agent to review a
    // diff it cannot compile.
    expect(names.has("write_file")).toBe(true);
    expect(names.has("search_replace")).toBe(true);
    expect(names.has("run_type_checks")).toBe(true);
  });

  it("withholds session state the orchestrator owns", () => {
    const names = toolNamesFor("implementer");

    expect(names.has("update_todos")).toBe(false);
    expect(names.has("set_chat_summary")).toBe(false);
  });

  it("blocks recursion without relying on the denylist", () => {
    // spawn_agent gates on `!ctx.subagentThreadId`, which buildSubagentContext
    // always sets. This must hold even though spawn_agent is absent from
    // SUBAGENT_DENYLIST — if it ever regresses, a sub-agent could fan out.
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
