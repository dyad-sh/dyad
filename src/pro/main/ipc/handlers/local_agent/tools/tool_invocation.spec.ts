import { describe, expect, it } from "vitest";
import type { AgentContext, ToolDefinition } from "./types";
import { addIntegrationTool } from "./add_integration";
import { shouldTrackToolMutation, trackAppMutation } from "./tool_invocation";

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

    trackAppMutation(ctx, "write_file");
    trackAppMutation(ctx, "execute_sql");

    expect(ctx.mutationCount).toBe(2);
    expect(ctx.fileMutationCount).toBe(1);
  });

  it("counts restored files as workspace-file mutations", () => {
    const ctx = {} as AgentContext;

    trackAppMutation(ctx, "git_restore_file");

    expect(ctx.mutationCount).toBe(1);
    expect(ctx.fileMutationCount).toBe(1);
  });

  it("counts approved generated tests as workspace-file mutations", () => {
    const ctx = {} as AgentContext;

    trackAppMutation(ctx, "generate_test_assertions");

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
  it("counts only Neon setup that adds Nitro to a Vite app", () => {
    const didMutateFile = addIntegrationTool.shouldTrackFileMutation!;

    expect(
      didMutateFile({}, "User completed the neon integration.", {
        frameworkType: "vite",
      } as AgentContext),
    ).toBe(true);
    expect(
      didMutateFile({}, "User completed the supabase integration.", {
        frameworkType: "vite",
      } as AgentContext),
    ).toBe(false);
    expect(
      didMutateFile({}, "User completed the neon integration.", {
        frameworkType: "nextjs",
      } as AgentContext),
    ).toBe(false);

    const ctx = { frameworkType: "vite" } as AgentContext;
    trackAppMutation(
      ctx,
      "add_integration",
      true,
      didMutateFile({}, "User completed the neon integration.", ctx) === true,
    );
    expect(ctx.fileMutationCount).toBe(1);
  });
});
