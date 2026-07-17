import { describe, expect, it } from "vitest";
import type { AgentContext, ToolDefinition } from "./types";
import { shouldTrackToolMutation } from "./tool_invocation";

function tool(
  name: string,
  shouldTrackMutation?: ToolDefinition["shouldTrackMutation"],
): ToolDefinition {
  return { name, shouldTrackMutation } as ToolDefinition;
}

describe("shouldTrackToolMutation", () => {
  const ctx = {} as AgentContext;

  it("does not count app-mutating tools without an explicit success predicate", () => {
    expect(
      shouldTrackToolMutation(
        tool("enable_nitro"),
        {},
        "Setup failed without throwing",
        ctx,
      ),
    ).toBe(false);
  });

  it("uses the tool's result-aware predicate", () => {
    const definition = tool("enable_nitro", (_args, result) =>
      result.startsWith("success"),
    );

    expect(shouldTrackToolMutation(definition, {}, "failed", ctx)).toBe(false);
    expect(shouldTrackToolMutation(definition, {}, "success", ctx)).toBe(true);
  });

  it("keeps successful file edits tracked by default", () => {
    expect(
      shouldTrackToolMutation(tool("write_file"), {}, "success", ctx),
    ).toBe(true);
  });
});
