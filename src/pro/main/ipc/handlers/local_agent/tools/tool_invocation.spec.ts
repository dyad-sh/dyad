import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as gitUtils from "@/ipc/utils/git_utils";
import type { AgentContext, ToolDefinition } from "./types";
import { APP_MUTATING_TOOL_NAMES, FILE_EDIT_TOOL_NAMES } from "./types";
import { addIntegrationTool } from "./add_integration";
import {
  FILE_MUTATION_POLICIES,
  shouldTrackToolFileMutation,
  shouldTrackToolMutation,
  requireToolConsentOrThrow,
  trackAppMutation,
} from "./tool_invocation";

function tool(
  name: string,
  shouldTrackMutation?: ToolDefinition["shouldTrackMutation"],
): ToolDefinition {
  return { name, shouldTrackMutation } as ToolDefinition;
}

describe("requireToolConsentOrThrow", () => {
  it("uses the turn-specific tool description in the consent request", async () => {
    const requireConsent = vi.fn().mockResolvedValue(true);
    const definition = {
      name: "dynamic_tool",
      description: "Default description",
      getDescription: (ctx) =>
        ctx.runTypeScriptForWholeProject
          ? "Project-wide description"
          : "Scoped description",
      inputSchema: z.object({}),
      defaultConsent: "ask",
      getConsentPreview: () => "Preview",
      execute: vi.fn(),
    } satisfies ToolDefinition;
    const ctx = {
      ...({} as AgentContext),
      requireConsent,
      runTypeScriptForWholeProject: true,
    };

    await requireToolConsentOrThrow(definition, {}, ctx);

    expect(requireConsent).toHaveBeenCalledWith({
      toolName: "dynamic_tool",
      toolDescription: "Project-wide description",
      inputPreview: "Preview",
      metadata: null,
    });
  });
});

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
        "User completed the neon integration. Git-visible workspace file state could not be determined during setup.",
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

  it("does not inspect Git when pre-commit is unavailable", async () => {
    const execGit = vi.spyOn(gitUtils, "execGit");
    const ctx = {
      appPath: "/tmp/app",
      preCommitHookAvailable: false,
    } as AgentContext;

    expect(
      await shouldTrackToolFileMutation(
        tool("write_file"),
        { path: "src/file.ts" },
        "success",
        ctx,
      ),
    ).toBe(false);
    expect(execGit).not.toHaveBeenCalled();
    execGit.mockRestore();
  });

  it("caches Git visibility for repeated edits to the same path", async () => {
    const execGit = vi.spyOn(gitUtils, "execGit").mockResolvedValue({
      exitCode: 0,
      stdout: " M src/file.ts\0",
      stderr: "",
    } as never);
    const ctx = {
      appPath: "/tmp/app",
      preCommitHookAvailable: true,
    } as AgentContext;
    const definition = tool("write_file");

    await shouldTrackToolFileMutation(
      definition,
      { path: "src/file.ts" },
      "success",
      ctx,
    );
    await shouldTrackToolFileMutation(
      definition,
      { path: "src/file.ts" },
      "success",
      ctx,
    );

    expect(execGit).toHaveBeenCalledTimes(1);
    execGit.mockRestore();
  });

  it("classifies deletes and both sides of renames from actual Git state", () => {
    expect(FILE_MUTATION_POLICIES.delete_file).toBe("path");
    expect(FILE_MUTATION_POLICIES.rename_file).toBe("paths");
  });
});
