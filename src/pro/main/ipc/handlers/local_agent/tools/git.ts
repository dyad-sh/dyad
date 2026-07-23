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
import {
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
  ToolDefinition,
} from "./types";

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

type GitXmlValue = string | number | boolean | null | undefined;

interface GitXmlAttributes {
  [key: string]: GitXmlValue;
}

function gitXml(
  operation: string,
  args: GitXmlAttributes,
  options: { content?: string; complete?: boolean } = {},
): string {
  const attributes = [`operation="${escapeXmlAttr(operation)}"`];
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined && value !== null && value !== "") {
      attributes.push(
        `${key}="${escapeXmlAttr(typeof value === "string" ? value : String(value))}"`,
      );
    }
  }
  const openingTag = `<dyad-git ${attributes.join(" ")}>`;
  if (options.complete === false) {
    return openingTag;
  }
  return `${openingTag}${options.content ? escapeXmlContent(options.content) : ""}</dyad-git>`;
}

function buildGitPreview(
  operation: string,
  args: GitXmlAttributes,
  isComplete: boolean,
): string | undefined {
  return isComplete ? undefined : gitXml(operation, args, { complete: false });
}

function normalizeGitFilterPath(path: string | undefined): string | undefined {
  return path === "." ? undefined : path;
}

function summarizeDiff(content: string): {
  files: number;
  additions: number;
  deletions: number;
} {
  let files = 0;
  let additions = 0;
  let deletions = 0;
  for (const line of content.split("\n")) {
    if (line.startsWith("diff --git ")) {
      files += 1;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
    }
  }
  return { files, additions, deletions };
}

function countTextLines(content: string): number {
  const withoutTrailingNewline = content.replace(/\r?\n$/, "");
  return withoutTrailingNewline
    ? withoutTrailingNewline.split(/\r?\n/).length
    : 0;
}

function getCommitSubject(content: string): string | undefined {
  const subject = content
    .split("\n")
    .map((line) => line.trim())
    .find(
      (line) =>
        line &&
        !line.startsWith("commit ") &&
        !line.startsWith("Author:") &&
        !line.startsWith("Date:") &&
        !line.startsWith("diff --git ") &&
        !line.startsWith("[") &&
        !line.startsWith("---") &&
        !line.startsWith("+++"),
    );
  return subject?.slice(0, 160);
}

const gitStatusSchema = z.object({
  reason: z
    .string()
    .describe(
      "One sentence explaining why the current Git working-tree state needs to be inspected.",
    ),
});

export const gitStatusTool: ToolDefinition<z.infer<typeof gitStatusSchema>> = {
  name: "git_status",
  description:
    "Inspect the current app's Git working tree. Returns the current branch or detached HEAD, HEAD commit, bounded staged, unstaged, untracked, and conflicted paths, and whether paths were truncated.",
  inputSchema: gitStatusSchema,
  defaultConsent: "always",
  buildXml: (_args, isComplete) => buildGitPreview("status", {}, isComplete),
  execute: async (_args, ctx) => {
    const status = await getAgentGitStatus({ path: ctx.appPath });
    ctx.onXmlComplete(
      gitXml(
        "status",
        {
          branch: status.branch,
          head: status.head,
          detached: status.detached,
          staged_count: status.staged.length,
          unstaged_count: status.unstaged.length,
          changed_count: new Set([...status.staged, ...status.unstaged]).size,
          untracked_count: status.untracked.length,
          conflicted_count: status.conflicted.length,
          truncated: status.truncated,
          detail_format: "status",
        },
        { content: JSON.stringify(status) },
      ),
    );
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
  getConsentPreview: (args) => {
    const filePath = normalizeGitFilterPath(args.path);
    return `Inspect ${args.scope ?? "all"} Git changes${filePath ? ` for ${filePath}` : ""}`;
  },
  buildXml: (args, isComplete) => {
    const filePath = normalizeGitFilterPath(args.path);
    return buildGitPreview(
      "diff",
      {
        scope: args.scope ?? "all",
        path: filePath,
        context_lines: args.context_lines,
      },
      isComplete,
    );
  },
  execute: async (args, ctx) => {
    const filePath = normalizeGitFilterPath(args.path);
    const result = await getAgentGitDiff({
      path: ctx.appPath,
      scope: args.scope,
      filePath,
      contextLines: args.context_lines,
    });
    const content = result.content || "";
    const summary = summarizeDiff(content);
    ctx.onXmlComplete(
      gitXml(
        "diff",
        {
          scope: args.scope ?? "all",
          path: filePath,
          context_lines: args.context_lines ?? 3,
          file_count: summary.files,
          additions: summary.additions,
          deletions: summary.deletions,
          truncated: result.truncated,
          detail_format: "diff",
        },
        { content },
      ),
    );
    return content || "No matching tracked changes.";
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
  getConsentPreview: (args) => {
    const filePath = normalizeGitFilterPath(args.path);
    return `Inspect Git history from ${args.revision ?? "HEAD"}${filePath ? ` for ${filePath}` : ""}`;
  },
  buildXml: (args, isComplete) => {
    const filePath = normalizeGitFilterPath(args.path);
    return buildGitPreview(
      "log",
      {
        revision: args.revision ?? "HEAD",
        path: filePath,
        max_count: args.max_count ?? 20,
      },
      isComplete,
    );
  },
  execute: async (args, ctx) => {
    const filePath = normalizeGitFilterPath(args.path);
    const result = await getAgentGitLog({
      path: ctx.appPath,
      revision: args.revision,
      maxCount: args.max_count,
      filePath,
    });
    const content = result.content || "";
    const resultCount = content
      .split("\n")
      .filter((line) => line.startsWith("commit ")).length;
    ctx.onXmlComplete(
      gitXml(
        "log",
        {
          revision: args.revision ?? "HEAD",
          path: filePath,
          max_count: args.max_count ?? 20,
          result_count: resultCount,
          truncated: result.truncated,
          detail_format: "log",
        },
        { content },
      ),
    );
    return content || "No matching commits.";
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
  getConsentPreview: (args) => {
    const filePath = normalizeGitFilterPath(args.path);
    return `Inspect commit ${args.revision}${filePath ? ` for ${filePath}` : ""}`;
  },
  buildXml: (args, isComplete) => {
    const filePath = normalizeGitFilterPath(args.path);
    return buildGitPreview(
      "show_commit",
      {
        revision: args.revision,
        path: filePath,
      },
      isComplete,
    );
  },
  execute: async (args, ctx) => {
    const filePath = normalizeGitFilterPath(args.path);
    const result = await getAgentGitCommit({
      path: ctx.appPath,
      revision: args.revision,
      filePath,
    });
    const summary = summarizeDiff(result.patch);
    ctx.onXmlComplete(
      gitXml(
        "show_commit",
        {
          revision: args.revision,
          path: filePath,
          subject: getCommitSubject(result.content),
          file_count: summary.files,
          additions: summary.additions,
          deletions: summary.deletions,
          truncated: result.truncated,
          detail_format: "commit",
        },
        { content: result.content },
      ),
    );
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
  buildXml: (args, isComplete) =>
    buildGitPreview(
      "show_file",
      {
        revision: args.revision,
        path: args.path,
        start_line: args.start_line_one_indexed,
        end_line: args.end_line_one_indexed_inclusive,
      },
      isComplete,
    ),
  execute: async (args, ctx) => {
    const result = await getAgentGitFile({
      path: ctx.appPath,
      revision: args.revision,
      filePath: args.path,
      startLine: args.start_line_one_indexed,
      endLineInclusive: args.end_line_one_indexed_inclusive,
    });
    ctx.onXmlComplete(
      gitXml(
        "show_file",
        {
          revision: args.revision,
          path: args.path,
          start_line: args.start_line_one_indexed,
          end_line: args.end_line_one_indexed_inclusive,
          line_count: countTextLines(result.content),
          truncated: result.truncated,
          detail_format: "file",
        },
        { content: result.content },
      ),
    );
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
  buildXml: (args, isComplete) =>
    buildGitPreview(
      "restore_file",
      {
        revision: args.revision,
        path: args.path,
      },
      isComplete,
    ),
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
    ctx.onXmlComplete(
      gitXml("restore_file", {
        revision: args.revision,
        path: operationPath,
        not_staged: true,
      }),
    );

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
