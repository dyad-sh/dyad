import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Proposal Schemas
// =============================================================================

export const SecurityRiskSchema = z.object({
  type: z.enum(["warning", "danger"]),
  title: z.string(),
  description: z.string(),
});

export const FileChangeSchema = z.object({
  name: z.string(),
  path: z.string(),
  summary: z.string(),
  type: z.enum(["write", "rename", "delete"]),
  isServerFunction: z.boolean(),
});

export const SqlQuerySchema = z.object({
  content: z.string(),
  description: z.string().optional(),
});

export const CodeProposalSchema = z.object({
  type: z.literal("code-proposal"),
  title: z.string(),
  securityRisks: z.array(SecurityRiskSchema),
  filesChanged: z.array(FileChangeSchema),
  packagesAdded: z.array(z.string()),
  sqlQueries: z.array(SqlQuerySchema),
});

export const RestartAppActionSchema = z.object({
  id: z.literal("restart-app"),
});
export const SummarizeInNewChatActionSchema = z.object({
  id: z.literal("summarize-in-new-chat"),
});
export const WriteCodeProperlyActionSchema = z.object({
  id: z.literal("write-code-properly"),
});
export const RefactorFileActionSchema = z.object({
  id: z.literal("refactor-file"),
  path: z.string(),
});
export const RebuildActionSchema = z.object({ id: z.literal("rebuild") });
export const RestartActionSchema = z.object({ id: z.literal("restart") });
export const RefreshActionSchema = z.object({ id: z.literal("refresh") });
export const KeepGoingActionSchema = z.object({ id: z.literal("keep-going") });

export const SuggestedActionSchema = z.union([
  RestartAppActionSchema,
  SummarizeInNewChatActionSchema,
  RefactorFileActionSchema,
  WriteCodeProperlyActionSchema,
  RebuildActionSchema,
  RestartActionSchema,
  RefreshActionSchema,
  KeepGoingActionSchema,
]);

export const ActionProposalSchema = z.object({
  type: z.literal("action-proposal"),
  actions: z.array(SuggestedActionSchema),
});

export const TipProposalSchema = z.object({
  type: z.literal("tip-proposal"),
  title: z.string(),
  description: z.string(),
});

export const ProposalSchema = z.union([
  CodeProposalSchema,
  ActionProposalSchema,
  TipProposalSchema,
]);

export const ProposalResultSchema = z
  .object({
    proposal: ProposalSchema,
    chatId: z.number(),
    messageId: z.number(),
  })
  .nullable();

export type ProposalResult = z.infer<typeof ProposalResultSchema>;

export const ApproveProposalParamsSchema = z.object({
  chatId: z.number(),
  messageId: z.number(),
});

export const ApproveProposalResultSchema = z.object({
  success: z.boolean(),
  commitHash: z.string().optional(),
  error: z.string().optional(),
  extraFiles: z.array(z.string()).optional(),
  extraFilesError: z.string().optional(),
});

export type ApproveProposalResult = z.infer<typeof ApproveProposalResultSchema>;

// =============================================================================
// Proposal Contracts
// =============================================================================

export const proposalContracts = {
  getProposal: defineContract({
    channel: "get-proposal",
    input: z.object({ chatId: z.number() }),
    output: ProposalResultSchema,
  }),

  approveProposal: defineContract({
    channel: "approve-proposal",
    input: ApproveProposalParamsSchema,
    output: ApproveProposalResultSchema,
  }),

  rejectProposal: defineContract({
    channel: "reject-proposal",
    input: ApproveProposalParamsSchema,
    output: z.void(),
  }),
} as const;

// =============================================================================
// Proposal Client
// =============================================================================

export const proposalClient = createClient(proposalContracts);
