import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const {
  mockDeploySupabaseFunction,
  mockGetAgentGitCommit,
  mockGetAgentGitDiff,
  mockGetAgentGitFile,
  mockGetAgentGitLog,
  mockGetAgentGitStatus,
  mockRestoreAgentGitFile,
} = vi.hoisted(() => ({
  mockDeploySupabaseFunction: vi.fn(),
  mockGetAgentGitCommit: vi.fn(async () => ({
    content:
      "commit abc123\nAuthor: Test <test@example.com>\nDate: 2026-01-01\n\nImprove preview\n\ndiff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n-old\n+new",
    truncated: false,
  })),
  mockGetAgentGitDiff: vi.fn(async () => ({
    content:
      "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n-old\n+new\n+another",
    truncated: false,
  })),
  mockGetAgentGitFile: vi.fn(async () => ({
    content: "line one\nline two\n",
    truncated: false,
  })),
  mockGetAgentGitLog: vi.fn(async () => ({
    content:
      "commit abc123\nAuthor: Test <test@example.com>\nDate: 2026-01-01\n\nFirst\n\ncommit def456\nAuthor: Test <test@example.com>\nDate: 2025-12-31\n\nSecond",
    truncated: false,
  })),
  mockGetAgentGitStatus: vi.fn(async () => ({
    branch: "main",
    head: "a".repeat(40),
    detached: false,
    staged: ["src/a.ts"],
    unstaged: ["src/a.ts", "src/b.ts"],
    untracked: ["src/new.ts"],
    conflicted: [],
    truncated: false,
  })),
  mockRestoreAgentGitFile: vi.fn(async () => ({
    oid: "a".repeat(40),
    mode: "100644",
    path: "file.txt",
  })),
}));

vi.mock("@/ipc/utils/git_utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/utils/git_utils")>()),
  getAgentGitCommit: mockGetAgentGitCommit,
  getAgentGitDiff: mockGetAgentGitDiff,
  getAgentGitFile: mockGetAgentGitFile,
  getAgentGitLog: mockGetAgentGitLog,
  getAgentGitStatus: mockGetAgentGitStatus,
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
      onXmlComplete: vi.fn(),
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
      expect(ctx.onXmlComplete).toHaveBeenCalledWith(
        '<dyad-git operation="restore_file" revision="HEAD" path="supabase/functions/_private/file.ts" not_staged="true"></dyad-git>',
      );
    } finally {
      await fs.promises.rm(appPath, { recursive: true, force: true });
    }
  });

  it("rejects Git options and invalid historical line ranges", () => {
    expect(
      gitShowCommitTool.inputSchema.safeParse({ revision: "--help" }).success,
    ).toBe(false);
    expect(
      gitShowCommitTool.inputSchema.safeParse({ revision: "HEAD\n--help" })
        .success,
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

  it("renders an escaped pending preview but waits for execution to complete it", () => {
    expect(
      gitShowFileTool.buildXml!(
        {
          revision: "HEAD",
          path: 'src/a&b".ts',
        },
        false,
      ),
    ).toBe(
      '<dyad-git operation="show_file" revision="HEAD" path="src/a&amp;b&quot;.ts">',
    );
    expect(
      gitShowFileTool.buildXml!(
        { revision: "HEAD", path: "src/main.ts" },
        true,
      ),
    ).toBeUndefined();
  });

  it("treats a dot path as the whole app for diff, log, and show commit", () => {
    expect(gitDiffTool.buildXml!({ path: "." }, false)).toBe(
      '<dyad-git operation="diff" scope="all">',
    );
    expect(gitLogTool.buildXml!({ path: "." }, false)).toBe(
      '<dyad-git operation="log" revision="HEAD" max_count="20">',
    );
    expect(
      gitShowCommitTool.buildXml!({ revision: "HEAD", path: "." }, false),
    ).toBe('<dyad-git operation="show_commit" revision="HEAD">');
    expect(gitDiffTool.getConsentPreview?.({ path: "." })).toBe(
      "Inspect all Git changes",
    );
    expect(gitLogTool.getConsentPreview?.({ path: "." })).toBe(
      "Inspect Git history from HEAD",
    );
    expect(
      gitShowCommitTool.getConsentPreview?.({ revision: "HEAD", path: "." }),
    ).toBe("Inspect commit HEAD");
  });

  it("emits structured summaries and bounded detail after read tools succeed", async () => {
    const ctx = {
      appPath: "/tmp/app",
      onXmlComplete: vi.fn(),
    } as unknown as AgentContext;

    await gitStatusTool.execute({}, ctx);
    await gitDiffTool.execute({ scope: "all" }, ctx);
    await gitLogTool.execute({ max_count: 2 }, ctx);
    await gitShowCommitTool.execute({ revision: "HEAD" }, ctx);
    await gitShowFileTool.execute(
      {
        revision: "HEAD",
        path: "src/main.ts",
        start_line_one_indexed: 4,
        end_line_one_indexed_inclusive: 5,
      },
      ctx,
    );

    const xml = vi.mocked(ctx.onXmlComplete).mock.calls.map(([value]) => value);
    expect(xml[0]).toContain('changed_count="2"');
    expect(xml[0]).toContain('untracked_count="1"');
    expect(xml[0]).toContain('detail_format="status"');
    expect(xml[1]).toContain('file_count="1" additions="2" deletions="1"');
    expect(xml[1]).toContain("diff --git a/a.ts b/a.ts");
    expect(xml[2]).toContain('result_count="2"');
    expect(xml[3]).toContain('subject="Improve preview"');
    expect(xml[4]).toContain('start_line="4" end_line="5" line_count="2"');
  });
});
