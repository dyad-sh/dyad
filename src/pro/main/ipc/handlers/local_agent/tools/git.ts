import { z } from "zod";
import { deploySupabaseFunction } from "@/supabase_admin/supabase_management_client";
import {
  extractFunctionNameFromPath,
  isServerFunction,
  isSharedServerModule,
} from "@/supabase_admin/supabase_utils";
import { queueCloudSandboxSnapshotSync } from "@/ipc/utils/cloud_sandbox_provider";
import {
  getAgentGitCommit,
  getAgentGitDiff,
  getAgentGitFile,
  getAgentGitLog,
  getAgentGitStatus,
  restoreAgentGitFile,
} from "@/ipc/utils/git_utils";
import { assertMutationPathAllowed, safeJoin } from "@/ipc/utils/path_utils";
import { getFileWriteKey, withLock } from "@/ipc/utils/lock_utils";
import { AgentContext, escapeXmlAttr, ToolDefinition } from "./types";

const revisionSchema = z
  .string()
  .min(1)
  .max(256)
  .refine(
    (revision) =>
      !revision.startsWith("-") &&
      !revision.includes("..") &&
      !/[\0\r\n]/.test(revision),
    {
      message:
        "Git options, revision ranges, and control characters are not allowed",
    },
  )
  .describe(
    "A commit hash, branch, or tag; Git options and ranges are rejected",
  );

const pathSchema = z
  .string()
  .min(1)
  .max(4096)
  .describe("A literal path relative to the app root");

function gitXml(
  operation: string,
  args: {
    revision?: string;
    path?: string;
    scope?: string;
    maxCount?: number;
  },
): string {
  const attributes = [`operation="${escapeXmlAttr(operation)}"`];
  if (args.revision) {
    attributes.push(`revision="${escapeXmlAttr(args.revision)}"`);
  }
  if (args.path) {
    attributes.push(`path="${escapeXmlAttr(args.path)}"`);
  }
  if (args.scope) {
    attributes.push(`scope="${escapeXmlAttr(args.scope)}"`);
  }
  if (args.maxCount != null) {
    attributes.push(`max_count="${escapeXmlAttr(String(args.maxCount))}"`);
  }
  return `<dyad-git ${attributes.join(" ")}></dyad-git>`;
}

const gitStatusSchema = z.object({});

export const gitStatusTool: ToolDefinition<z.infer<typeof gitStatusSchema>> = {
  name: "git_status",
  description:
    "Inspect the current app's Git working tree. Returns the current branch or detached HEAD, HEAD commit, bounded staged, unstaged, untracked, and conflicted paths, and whether paths were truncated.",
  inputSchema: gitStatusSchema,
  defaultConsent: "always",
  buildXml: () => gitXml("status", {}),
  execute: async (_args, ctx) => {
    const status = await getAgentGitStatus({ path: ctx.appPath });
    return JSON.stringify(status, null, 2);
  },
};

const gitDiffSchema = z.object({
  scope: z
    .enum(["unstaged", "staged", "all"])
    .optional()
    .describe(
      "unstaged compares index to working tree; staged compares HEAD to index; all compares HEAD to working tree (default: all)",
    ),
  path: pathSchema.optional(),
  context_lines: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .describe("Unchanged context lines around each change (default: 3)"),
});

export const gitDiffTool: ToolDefinition<z.infer<typeof gitDiffSchema>> = {
  name: "git_diff",
  description:
    "Show a bounded unified diff for tracked files in the current app. Untracked files are reported by git_status. Sensitive dotenv and Dyad-managed patches are omitted.",
  inputSchema: gitDiffSchema,
  defaultConsent: "always",
  getConsentPreview: (args) =>
    `Inspect ${args.scope ?? "all"} Git changes${args.path ? ` for ${args.path}` : ""}`,
  buildXml: (args) =>
    gitXml("diff", {
      scope: args.scope ?? "all",
      path: args.path,
    }),
  execute: async (args, ctx) => {
    const result = await getAgentGitDiff({
      path: ctx.appPath,
      scope: args.scope,
      filePath: args.path,
      contextLines: args.context_lines,
    });
    return result.content || "No matching tracked changes.";
  },
};

const gitLogSchema = z.object({
  revision: revisionSchema.optional(),
  max_count: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum commits to return (default: 20, max: 100)"),
  path: pathSchema.optional(),
});

export const gitLogTool: ToolDefinition<z.infer<typeof gitLogSchema>> = {
  name: "git_log",
  description:
    "List recent commits in the current app, newest first, with canonical hashes, author details, timestamps, and messages. Optionally start at a revision or filter to a path.",
  inputSchema: gitLogSchema,
  defaultConsent: "always",
  getConsentPreview: (args) =>
    `Inspect Git history from ${args.revision ?? "HEAD"}${args.path ? ` for ${args.path}` : ""}`,
  buildXml: (args) =>
    gitXml("log", {
      revision: args.revision ?? "HEAD",
      path: args.path,
      maxCount: args.max_count ?? 20,
    }),
  execute: async (args, ctx) => {
    const result = await getAgentGitLog({
      path: ctx.appPath,
      revision: args.revision,
      maxCount: args.max_count,
      filePath: args.path,
    });
    return result.content || "No matching commits.";
  },
};

const gitShowCommitSchema = z.object({
  revision: revisionSchema,
  path: pathSchema.optional(),
});

export const gitShowCommitTool: ToolDefinition<
  z.infer<typeof gitShowCommitSchema>
> = {
  name: "git_show_commit",
  description:
    "Show metadata and a bounded first-parent patch for one commit in the current app. Optionally limit the patch to one path. Sensitive dotenv and Dyad-managed patches are omitted.",
  inputSchema: gitShowCommitSchema,
  defaultConsent: "always",
  getConsentPreview: (args) =>
    `Inspect commit ${args.revision}${args.path ? ` for ${args.path}` : ""}`,
  buildXml: (args) =>
    gitXml("show_commit", {
      revision: args.revision,
      path: args.path,
    }),
  execute: async (args, ctx) => {
    const result = await getAgentGitCommit({
      path: ctx.appPath,
      revision: args.revision,
      filePath: args.path,
    });
    return result.content;
  },
};

const gitShowFileSchema = z
  .object({
    revision: revisionSchema,
    path: pathSchema,
    start_line_one_indexed: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("One-indexed first line to return (inclusive)"),
    end_line_one_indexed_inclusive: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("One-indexed final line to return (inclusive)"),
  })
  .refine(
    (args) =>
      args.start_line_one_indexed == null ||
      args.end_line_one_indexed_inclusive == null ||
      args.start_line_one_indexed <= args.end_line_one_indexed_inclusive,
    {
      message:
        "start_line_one_indexed must be <= end_line_one_indexed_inclusive",
    },
  );

export const gitShowFileTool: ToolDefinition<
  z.infer<typeof gitShowFileSchema>
> = {
  name: "git_show_file",
  description:
    "Read a UTF-8 file as it existed at a Git revision in the current app. Supports bounded line ranges and redacts dotenv values. Binary files cannot be displayed.",
  inputSchema: gitShowFileSchema,
  defaultConsent: "always",
  getConsentPreview: (args) => `Read ${args.path} at ${args.revision}`,
  buildXml: (args) =>
    gitXml("show_file", {
      revision: args.revision,
      path: args.path,
    }),
  execute: async (args, ctx) => {
    const result = await getAgentGitFile({
      path: ctx.appPath,
      revision: args.revision,
      filePath: args.path,
      startLine: args.start_line_one_indexed,
      endLineInclusive: args.end_line_one_indexed_inclusive,
    });
    return result.content;
  },
};

const gitRestoreFileSchema = z.object({
  revision: revisionSchema,
  path: pathSchema,
});

export const gitRestoreFileTool: ToolDefinition<
  z.infer<typeof gitRestoreFileSchema>
> = {
  name: "git_restore_file",
  description:
    "Restore one regular file from a Git revision into the current app's working tree without changing the index. Existing working-tree content is overwritten; symlinks are rejected.",
  inputSchema: gitRestoreFileSchema,
  defaultConsent: "always",
  modifiesState: true,
  getConsentPreview: (args) =>
    `Restore ${args.path} from ${args.revision} without staging it`,
  buildXml: (args) =>
    gitXml("restore_file", {
      revision: args.revision,
      path: args.path,
    }),
  execute: async (args, ctx: AgentContext) => {
    const operationPath = await assertMutationPathAllowed({
      appPath: ctx.appPath,
      relativePath: args.path,
      followFinalSymlink: false,
    });
    const fullPath = safeJoin(ctx.appPath, operationPath);

    await withLock(getFileWriteKey(fullPath), async () => {
      await restoreAgentGitFile({
        path: ctx.appPath,
        revision: args.revision,
        filePath: operationPath,
      });
    });
    ctx.workspaceMutated = true;

    const successMessage = `Restored ${operationPath} from ${args.revision} without changing the index.`;

    if (isSharedServerModule(operationPath)) {
      ctx.isSharedModulesChanged = true;
      ctx.sharedServerModulePaths.push(operationPath);
    }
    queueCloudSandboxSnapshotSync({
      appId: ctx.appId,
      changedPaths: [operationPath],
    });

    if (ctx.supabaseProjectId && isServerFunction(operationPath)) {
      let functionName: string;
      try {
        functionName = extractFunctionNameFromPath(operationPath);
      } catch {
        return successMessage;
      }
      if (ctx.isSharedModulesChanged) {
        ctx.pendingFunctionDeploys.push(functionName);
      } else {
        try {
          await deploySupabaseFunction({
            supabaseProjectId: ctx.supabaseProjectId,
            functionName,
            appPath: ctx.appPath,
            organizationSlug: ctx.supabaseOrganizationSlug ?? null,
          });
        } catch (error) {
          return `${successMessage} Failed to deploy Supabase function: ${error}`;
        }
      }
    }

    return successMessage;
  },
};
