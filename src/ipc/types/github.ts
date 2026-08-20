import { z } from "zod";
import {
  defineContract,
  defineEvent,
  createClient,
  createEventClient,
} from "../contracts/core";
import { AppSchema } from "./app";

// =============================================================================
// GitHub Schemas
// =============================================================================

export const GitHubRepoSchema = z.object({
  name: z.string(),
  full_name: z.string(),
  private: z.boolean(),
});

export type GithubRepository = z.infer<typeof GitHubRepoSchema>;

export const GitHubBranchSchema = z.object({
  name: z.string(),
  commit: z.object({ sha: z.string() }),
});

export const GitHubCollaboratorSchema = z.object({
  login: z.string(),
  avatar_url: z.string(),
  permissions: z.any().optional(),
});

export const GitBranchAppIdParamsSchema = z.object({
  appId: z.number(),
});

export const GitBranchParamsSchema = z.object({
  appId: z.number(),
  branch: z.string(),
});

export const CreateGitBranchParamsSchema = z.object({
  appId: z.number(),
  branch: z.string(),
  from: z.string().optional(),
});

export const RenameGitBranchParamsSchema = z.object({
  appId: z.number(),
  oldBranch: z.string(),
  newBranch: z.string(),
});

export const ListRemoteGitBranchesParamsSchema = z.object({
  appId: z.number(),
  remote: z.string().optional(),
});

export const CommitChangesParamsSchema = z.object({
  appId: z.number(),
  message: z.string(),
  operationId: z.string().min(1).max(256),
  filesToStage: z.array(z.string()).optional(),
});

export const CancelCommitParamsSchema = CommitChangesParamsSchema.pick({
  appId: true,
  operationId: true,
});

export const CommitProgressSchema = z.object({
  appId: z.number(),
  operationId: z.string().min(1).max(256),
  phase: z.enum(["staging", "pre-commit", "commit-msg", "committing"]),
});

export const UncommittedFileSchema = z.object({
  path: z.string(),
  status: z.enum(["added", "modified", "deleted", "renamed"]),
  // For renamed files, the original path at HEAD (so the "before" side of the
  // diff / line stats can still be located). Absent for non-renames.
  oldPath: z.string().optional(),
  // Number of added / deleted lines relative to HEAD (git diff --numstat
  // semantics). Line counts are always non-negative integers. Default to 0 so
  // older producers / mocks remain valid.
  additions: z.number().int().nonnegative().default(0),
  deletions: z.number().int().nonnegative().default(0),
});

export const GetUncommittedFileDiffParamsSchema = z.object({
  appId: z.number(),
  filePath: z.string(),
});

export const UncommittedFileDiffSchema = z.object({
  path: z.string(),
  // Contents of the file at HEAD ("" when the file is newly added) and in the
  // current working tree ("" when the file is deleted).
  oldContent: z.string(),
  newContent: z.string(),
});

export const LocalBranchesResultSchema = z.object({
  branches: z.array(z.string()),
  current: z.string().nullable(),
});

export const RepoAvailabilitySchema = z.object({
  available: z.boolean(),
  error: z.string().optional(),
});

export const CloneRepoParamsSchema = z.object({
  url: z.string(),
  appName: z.string().optional(),
  installCommand: z.string().optional(),
  startCommand: z.string().optional(),
  optimizeForDyad: z.boolean().optional(),
});

export const CloneRepoResultSchema = z.union([
  z.object({
    app: AppSchema,
    hasAiRules: z.boolean(),
    autoUpgradeWarning: z.boolean().optional(),
  }),
  z.object({
    error: z.string(),
  }),
]);

// =============================================================================
// GitHub Contracts
// =============================================================================

// Note: the GitHub device flow (start/cancel + state updates) goes through
// the connection-flow contracts (`connection_flow.ts`) — it is driven by the
// flowId-correlated state machine shared with Supabase/Neon.
export const githubContracts = {
  listRepos: defineContract({
    channel: "github:list-repos",
    input: z.void(),
    output: z.array(GitHubRepoSchema),
  }),

  getRepoBranches: defineContract({
    channel: "github:get-repo-branches",
    input: z.object({ owner: z.string(), repo: z.string() }),
    output: z.array(GitHubBranchSchema),
  }),

  isRepoAvailable: defineContract({
    channel: "github:is-repo-available",
    input: z.object({ org: z.string(), repo: z.string() }),
    output: RepoAvailabilitySchema,
  }),

  listLocalBranches: defineContract({
    channel: "github:list-local-branches",
    input: GitBranchAppIdParamsSchema,
    output: LocalBranchesResultSchema,
  }),

  listRemoteBranches: defineContract({
    channel: "github:list-remote-branches",
    input: ListRemoteGitBranchesParamsSchema,
    output: z.array(z.string()),
  }),

  listCollaborators: defineContract({
    channel: "github:list-collaborators",
    input: z.object({ appId: z.number() }),
    output: z.array(GitHubCollaboratorSchema),
  }),

  inviteCollaborator: defineContract({
    channel: "github:invite-collaborator",
    input: z.object({ appId: z.number(), username: z.string() }),
    output: z.void(),
  }),

  removeCollaborator: defineContract({
    channel: "github:remove-collaborator",
    input: z.object({ appId: z.number(), username: z.string() }),
    output: z.void(),
  }),

  cloneRepoFromUrl: defineContract({
    channel: "github:clone-repo-from-url",
    input: CloneRepoParamsSchema,
    output: CloneRepoResultSchema,
  }),
} as const;

// Git contracts (non-GitHub specific)
export const gitContracts = {
  getUncommittedFiles: defineContract({
    channel: "git:get-uncommitted-files",
    input: GitBranchAppIdParamsSchema,
    output: z.array(UncommittedFileSchema),
  }),

  getUncommittedFileDiff: defineContract({
    channel: "git:get-uncommitted-file-diff",
    input: GetUncommittedFileDiffParamsSchema,
    output: UncommittedFileDiffSchema,
  }),

  commitChanges: defineContract({
    channel: "git:commit-changes",
    input: CommitChangesParamsSchema,
    output: z.string(), // Returns commit hash
    invalidates: (input) => [{ family: "versions", appId: input.appId }],
  }),

  cancelCommit: defineContract({
    channel: "git:cancel-commit",
    input: CancelCommitParamsSchema,
    output: z.void(),
  }),

  discardChanges: defineContract({
    channel: "git:discard-changes",
    input: GitBranchAppIdParamsSchema,
    output: z.void(),
    invalidates: (input) => [{ family: "versions", appId: input.appId }],
  }),
} as const;

export const gitEvents = {
  commitProgress: defineEvent({
    channel: "git:commit-progress",
    payload: CommitProgressSchema,
  }),
} as const;

// =============================================================================
// GitHub Clients
// =============================================================================

export const githubClient = createClient(githubContracts);
export const gitClient = createClient(gitContracts);
export const gitEventClient = createEventClient(gitEvents);

// =============================================================================
// Type Exports
// =============================================================================

export type GitBranchAppIdParams = z.infer<typeof GitBranchAppIdParamsSchema>;
export type GitBranchParams = z.infer<typeof GitBranchParamsSchema>;
export type CreateGitBranchParams = z.infer<typeof CreateGitBranchParamsSchema>;
export type RenameGitBranchParams = z.infer<typeof RenameGitBranchParamsSchema>;
export type ListRemoteGitBranchesParams = z.infer<
  typeof ListRemoteGitBranchesParamsSchema
>;
export type CommitChangesParams = z.infer<typeof CommitChangesParamsSchema>;
export type CancelCommitParams = z.infer<typeof CancelCommitParamsSchema>;
export type CommitProgress = z.infer<typeof CommitProgressSchema>;
export type CommitProgressPhase = CommitProgress["phase"];
export type UncommittedFile = z.infer<typeof UncommittedFileSchema>;
export type UncommittedFileStatus = UncommittedFile["status"];
export type GetUncommittedFileDiffParams = z.infer<
  typeof GetUncommittedFileDiffParamsSchema
>;
export type UncommittedFileDiff = z.infer<typeof UncommittedFileDiffSchema>;
export type CloneRepoParams = z.infer<typeof CloneRepoParamsSchema>;
export type CloneRepoResult = z.infer<typeof CloneRepoResultSchema>;
