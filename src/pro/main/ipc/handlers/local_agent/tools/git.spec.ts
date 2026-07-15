import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const { mockDeploySupabaseFunction, mockRestoreAgentGitFile } = vi.hoisted(
  () => ({
    mockDeploySupabaseFunction: vi.fn(),
    mockRestoreAgentGitFile: vi.fn(async () => ({
      oid: "a".repeat(40),
      mode: "100644",
      path: "file.txt",
    })),
  }),
);

vi.mock("@/ipc/utils/git_utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/utils/git_utils")>()),
  restoreAgentGitFile: mockRestoreAgentGitFile,
}));

vi.mock(
  "@/supabase_admin/supabase_management_client",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/supabase_admin/supabase_management_client")
    >()),
    deploySupabaseFunction: mockDeploySupabaseFunction,
  }),
);

vi.mock("@/ipc/utils/cloud_sandbox_provider", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/ipc/utils/cloud_sandbox_provider")
  >()),
  queueCloudSandboxSnapshotSync: vi.fn(),
}));

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({ agentToolConsents: {} })),
  writeSettings: vi.fn(),
}));

vi.mock("@/ipc/handlers/app_blueprint_handlers", () => ({
  getAppBlueprintForChat: vi.fn(() => null),
  setAppBlueprintForChat: vi.fn(),
  deleteAppBlueprintForChat: vi.fn(),
  updateAppBlueprintVisuals: vi.fn(),
  registerAppBlueprintHandlers: vi.fn(),
}));

import {
  gitDiffTool,
  gitLogTool,
  gitRestoreFileTool,
  gitShowCommitTool,
  gitShowFileTool,
  gitStatusTool,
} from "./git";
import type { AgentContext } from "./types";
import {
  buildAgentToolSet,
  getDefaultConsent,
  shouldIncludeTool,
} from "../tool_definitions";

describe("local-agent Git tool definitions", () => {
  it("marks only restore as state-changing", () => {
    expect(gitStatusTool.modifiesState).toBeFalsy();
    expect(gitDiffTool.modifiesState).toBeFalsy();
    expect(gitLogTool.modifiesState).toBeFalsy();
    expect(gitShowCommitTool.modifiesState).toBeFalsy();
    expect(gitShowFileTool.modifiesState).toBeFalsy();
    expect(gitRestoreFileTool.modifiesState).toBe(true);
  });

  it("includes read tools in normal, ask, and plan modes but gates restore", () => {
    const ctx = { chatId: 1 } as AgentContext;
    const readTools = [
      gitStatusTool,
      gitDiffTool,
      gitLogTool,
      gitShowCommitTool,
      gitShowFileTool,
    ];
    for (const tool of readTools) {
      expect(shouldIncludeTool(tool, ctx)).toBe(true);
      expect(shouldIncludeTool(tool, ctx, { readOnly: true })).toBe(true);
      expect(shouldIncludeTool(tool, ctx, { planModeOnly: true })).toBe(true);
    }
    expect(shouldIncludeTool(gitRestoreFileTool, ctx)).toBe(true);
    expect(shouldIncludeTool(gitRestoreFileTool, ctx, { readOnly: true })).toBe(
      false,
    );
    expect(
      shouldIncludeTool(gitRestoreFileTool, ctx, { planModeOnly: true }),
    ).toBe(false);
    expect(getDefaultConsent("git_restore_file")).toBe("always");
  });

  it("applies the app-blueprint gate before restoring", async () => {
    const ctx = {
      chatId: 1,
      requireConsent: vi.fn(),
      onXmlComplete: vi.fn(),
    } as unknown as AgentContext;
    const toolSet = buildAgentToolSet(ctx, { enableAppBlueprint: true });

    await expect(
      toolSet.git_restore_file.execute?.(
        { revision: "HEAD", path: "file.txt" },
        {} as never,
      ),
    ).rejects.toThrow("App blueprint must be created and approved");
    expect(ctx.requireConsent).not.toHaveBeenCalled();
  });

  it("records a successful mutation and skips reserved Supabase deployment", async () => {
    const appPath = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "git-tool-"),
    );
    const ctx = {
      appId: 1,
      appPath,
      supabaseProjectId: "project-id",
      supabaseOrganizationSlug: null,
      isSharedModulesChanged: false,
      sharedServerModulePaths: [],
      pendingFunctionDeploys: [],
    } as unknown as AgentContext;
    try {
      const result = await gitRestoreFileTool.execute(
        {
          revision: "HEAD",
          path: "supabase/functions/_private/file.ts",
        },
        ctx,
      );

      expect(result).toContain("Restored supabase/functions/_private/file.ts");
      expect(ctx.workspaceMutated).toBe(true);
      expect(mockRestoreAgentGitFile).toHaveBeenCalled();
      expect(mockDeploySupabaseFunction).not.toHaveBeenCalled();
    } finally {
      await fs.promises.rm(appPath, { recursive: true, force: true });
    }
  });

  it("rejects Git options and invalid historical line ranges", () => {
    expect(
      gitShowCommitTool.inputSchema.safeParse({ revision: "--help" }).success,
    ).toBe(false);
    expect(
      gitShowFileTool.inputSchema.safeParse({
        revision: "HEAD",
        path: "src/main.ts",
        start_line_one_indexed: 10,
        end_line_one_indexed_inclusive: 5,
      }).success,
    ).toBe(false);
  });

  it("renders escaped, compact tool cards", () => {
    expect(
      gitShowFileTool.buildXml!(
        {
          revision: "HEAD",
          path: 'src/a&b".ts',
        },
        {} as never,
      ),
    ).toBe(
      '<dyad-git operation="show_file" revision="HEAD" path="src/a&amp;b&quot;.ts"></dyad-git>',
    );
  });
});
