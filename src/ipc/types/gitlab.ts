import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";
import { isGitLabInstanceUrl } from "@/shared/gitlab_instance_url";

// =============================================================================
// GitLab Schemas
// =============================================================================

export const GitLabInstanceUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine(isGitLabInstanceUrl, {
    message: "Enter an http:// or https:// address.",
  });

/** What the renderer may know about the connection. Never the token. */
export const GitLabStatusSchema = z.object({
  connected: z.boolean(),
  /** Normalized instance URL, or null when nothing is connected. */
  instanceUrl: z.string().nullable(),
  username: z.string().nullable(),
  /** ISO date the token expires, or null when unknown or never. */
  tokenExpiresAt: z.string().nullable(),
});
export type GitLabStatus = z.infer<typeof GitLabStatusSchema>;

export const SaveGitLabTokenParamsSchema = z.object({
  instanceUrl: GitLabInstanceUrlSchema,
  token: z.string().trim().min(1),
  /** Required for an http address, so the risk is a choice rather than a default. */
  acknowledgedInsecure: z.boolean().default(false),
});

export const GitLabNamespaceSchema = z.object({
  id: z.number(),
  /** `group/subgroup` for a group, the username for a personal namespace. */
  fullPath: z.string(),
  kind: z.enum(["user", "group"]),
  name: z.string(),
});
export type GitLabNamespaceInfo = z.infer<typeof GitLabNamespaceSchema>;

export const GitLabProjectSummarySchema = z.object({
  id: z.number(),
  name: z.string(),
  pathWithNamespace: z.string(),
  visibility: z.string(),
  defaultBranch: z.string().nullable(),
});
export type GitLabProjectSummary = z.infer<typeof GitLabProjectSummarySchema>;

export const GitLabBranchSummarySchema = z.object({
  name: z.string(),
});

export const GitLabProjectAvailabilitySchema = z.object({
  available: z.boolean(),
  error: z.string().optional(),
});

// =============================================================================
// GitLab Contracts
// =============================================================================

// Linking, pushing, pulling and disconnecting go through the github_ops
// machine (see src/github_ops/state.ts), which serves both providers. These
// contracts cover the connection itself and the lookups the link form needs.
export const gitlabContracts = {
  getStatus: defineContract({
    channel: "gitlab:get-status",
    input: z.void(),
    output: GitLabStatusSchema,
  }),

  // DO NOT LOG: carries a personal access token.
  saveToken: defineContract({
    channel: "gitlab:save-token",
    input: SaveGitLabTokenParamsSchema,
    output: GitLabStatusSchema,
    // Every app reads as connected or not through this token, and the
    // provider-status scope reaches the settings and gitlab queries.
    invalidates: () => [
      { family: "apps" },
      { family: "provider-status", provider: "gitlab" },
    ],
  }),

  clearToken: defineContract({
    channel: "gitlab:clear-token",
    input: z.void(),
    output: z.void(),
    invalidates: () => [
      { family: "apps" },
      { family: "provider-status", provider: "gitlab" },
    ],
  }),

  listNamespaces: defineContract({
    channel: "gitlab:list-namespaces",
    input: z.void(),
    output: z.array(GitLabNamespaceSchema),
  }),

  listProjects: defineContract({
    channel: "gitlab:list-projects",
    input: z.void(),
    output: z.array(GitLabProjectSummarySchema),
  }),

  getProjectBranches: defineContract({
    channel: "gitlab:get-project-branches",
    input: z.object({ projectId: z.number().int() }),
    output: z.array(GitLabBranchSummarySchema),
  }),

  isProjectAvailable: defineContract({
    channel: "gitlab:is-project-available",
    input: z.object({ namespaceFullPath: z.string(), path: z.string() }),
    output: GitLabProjectAvailabilitySchema,
  }),
} as const;

// =============================================================================
// GitLab Client
// =============================================================================

export const gitlabClient = createClient(gitlabContracts);

export type SaveGitLabTokenParams = z.infer<typeof SaveGitLabTokenParamsSchema>;
