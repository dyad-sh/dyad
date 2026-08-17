import { describe, expect, it } from "vitest";
import type { AgentContext, ToolDefinition } from "./types";
import { APP_MUTATING_TOOL_NAMES, FILE_EDIT_TOOL_NAMES } from "./types";
import { addIntegrationTool } from "./add_integration";
import {
  FILE_MUTATION_POLICIES,
  shouldTrackToolMutation,
  trackAppMutation,
} from "./tool_invocation";

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

describe("trackAppMutation", () => {
  it("tracks workspace-file mutations separately from database mutations", () => {
    const ctx = {} as AgentContext;

    trackAppMutation(ctx, "write_file", true, true);
    trackAppMutation(ctx, "execute_sql");

    expect(ctx.mutationCount).toBe(2);
    expect(ctx.fileMutationCount).toBe(1);
  });

  it("counts restored files as workspace-file mutations", () => {
    const ctx = {} as AgentContext;

    trackAppMutation(ctx, "git_restore_file", true, true);

    expect(ctx.mutationCount).toBe(1);
    expect(ctx.fileMutationCount).toBe(1);
  });

  it("counts approved generated tests as workspace-file mutations", () => {
    const ctx = {} as AgentContext;

    trackAppMutation(ctx, "generate_test_assertions", true, true);

    expect(ctx.mutationCount).toBe(1);
    expect(ctx.fileMutationCount).toBe(1);
  });

  it.each(["generate_image"])(
    "does not count %s as a Git-visible file mutation",
    (toolName) => {
      const ctx = {} as AgentContext;

      trackAppMutation(ctx, toolName);

      expect(ctx.mutationCount).toBe(1);
      expect(ctx.fileMutationCount).toBeUndefined();
    },
  );
});

describe("add_integration file mutation tracking", () => {
  it("counts only integration setup that actually changed Git-visible files", () => {
    const didMutateFile = addIntegrationTool.shouldTrackFileMutation!;

    expect(
      didMutateFile(
        {},
        "User completed the neon integration. Git-visible workspace files changed during setup.",
        {} as AgentContext,
      ),
    ).toBe(true);
    expect(
      didMutateFile(
        {},
        "User completed the neon integration. You can now continue.",
        {} as AgentContext,
      ),
    ).toBe(false);
    expect(
      didMutateFile(
        {},
        "User completed the supabase integration.",
        {} as AgentContext,
      ),
    ).toBe(false);

    const ctx = {} as AgentContext;
    trackAppMutation(
      ctx,
      "add_integration",
      true,
      didMutateFile(
        {},
        "Git-visible workspace files changed during setup.",
        ctx,
      ) === true,
    );
    expect(ctx.fileMutationCount).toBe(1);
  });
});

describe("file mutation policy", () => {
  it("classifies every mutation-counted tool in one exhaustive registry", () => {
    expect(Object.keys(FILE_MUTATION_POLICIES).sort()).toEqual(
      [...FILE_EDIT_TOOL_NAMES, ...APP_MUTATING_TOOL_NAMES].sort(),
    );
  });
});
