import { describe, expect, it, vi } from "vitest";

// getAgentToolConsent (used by shouldIncludeTool) reads settings; stub it so
// tools fall back to their defaultConsent rather than "never".
vi.mock("@/main/settings", () => ({
  readSettings: () => ({}),
  writeSettings: () => {},
}));

import { TOOL_DEFINITIONS, shouldIncludeTool } from "./tool_definitions";
import type { AgentContext } from "./tools/types";

const proCtx = { isDyadPro: true } as unknown as AgentContext;

function includedToolNames(
  options: Parameters<typeof shouldIncludeTool>[2],
): Set<string> {
  return new Set(
    TOOL_DEFINITIONS.filter((tool) =>
      shouldIncludeTool(tool, proCtx, options),
    ).map((tool) => tool.name),
  );
}

describe("design mode tool gating", () => {
  it("includes design-specific tools and excludes code-editing tools", () => {
    const names = includedToolNames({ designModeOnly: true });

    // Design-specific tools are available.
    expect(names.has("write_design_spec")).toBe(true);
    expect(names.has("generate_image")).toBe(true);
    expect(names.has("planning_questionnaire")).toBe(true);

    // Read-only exploration stays available.
    expect(names.has("read_file")).toBe(true);
    expect(names.has("list_files")).toBe(true);

    // No code-editing / state-mutating tools.
    expect(names.has("write_file")).toBe(false);
    expect(names.has("search_replace")).toBe(false);
    expect(names.has("delete_file")).toBe(false);

    // Plan-only tools do not leak into design mode.
    expect(names.has("write_plan")).toBe(false);
    expect(names.has("exit_plan")).toBe(false);
  });

  it("excludes write_design_spec outside of design mode", () => {
    expect(
      includedToolNames({ planModeOnly: true }).has("write_design_spec"),
    ).toBe(false);
    expect(includedToolNames({}).has("write_design_spec")).toBe(false);
  });
});
