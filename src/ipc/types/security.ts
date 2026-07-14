import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Security Schemas
// =============================================================================

export const SecurityFindingSchema = z.object({
  title: z.string(),
  level: z.enum(["critical", "high", "medium", "low"]),
  description: z.string(),
});

export type SecurityFinding = z.infer<typeof SecurityFindingSchema>;

export const SecurityReviewFindingSchema = SecurityFindingSchema.extend({
  fixChatId: z.number().optional(),
});

export type SecurityReviewFinding = z.infer<typeof SecurityReviewFindingSchema>;

export const SecurityReviewResultSchema = z.object({
  findings: z.array(SecurityReviewFindingSchema),
  timestamp: z.string(),
  chatId: z.number(),
});

export type SecurityReviewResult = z.infer<typeof SecurityReviewResultSchema>;

// =============================================================================
// Security Contracts
// =============================================================================

export const GetOrCreateSecurityFixChatInputSchema = z.object({
  appId: z.number(),
  reviewChatId: z.number(),
  findings: z.array(SecurityFindingSchema).min(1),
});

export type GetOrCreateSecurityFixChatInput = z.infer<
  typeof GetOrCreateSecurityFixChatInputSchema
>;

export const securityContracts = {
  getLatestSecurityReview: defineContract({
    channel: "get-latest-security-review",
    input: z.number(), // appId
    output: SecurityReviewResultSchema,
  }),
  getOrCreateSecurityFixChat: defineContract({
    channel: "get-or-create-security-fix-chat",
    input: GetOrCreateSecurityFixChatInputSchema,
    output: z.object({
      chatId: z.number(),
      created: z.boolean(),
    }),
  }),
} as const;

// =============================================================================
// Security Client
// =============================================================================

export const securityClient = createClient(securityContracts);
