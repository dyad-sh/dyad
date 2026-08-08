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

export const SecurityReviewResultSchema = z.object({
  findings: z.array(SecurityFindingSchema),
  timestamp: z.string(),
  chatId: z.number(),
});

export type SecurityReviewResult = z.infer<typeof SecurityReviewResultSchema>;

// =============================================================================
// Security Contracts
// =============================================================================

export const securityContracts = {
  getLatestSecurityReview: defineContract({
    channel: "get-latest-security-review",
    input: z.number(), // appId
    output: SecurityReviewResultSchema,
  }),
} as const;

// =============================================================================
// Security Client
// =============================================================================

export const securityClient = createClient(securityContracts);
