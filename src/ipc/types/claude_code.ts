import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

export const ClaudeCodeAuthStateSchema = z.enum([
  "authenticated",
  "unauthenticated",
  "unknown",
]);

export type ClaudeCodeAuthState = z.infer<typeof ClaudeCodeAuthStateSchema>;

export const ClaudeCodeStatusSchema = z.object({
  installed: z.boolean(),
  executablePath: z.string().nullable(),
  version: z.string().nullable(),
  versionSupported: z.boolean(),
  minimumVersion: z.string(),
  testedVersion: z.string(),
  auth: z.object({
    state: ClaudeCodeAuthStateSchema,
    method: z.string().nullable(),
    subscriptionType: z.string().nullable(),
    email: z.string().nullable(),
    detail: z.string().nullable(),
  }),
  /** Whether the user has acknowledged the separate Dyad charge. */
  chargeAcknowledged: z.boolean(),
  /** Whether usage can be billed (a Dyad Pro key is configured). */
  billingReady: z.boolean(),
  billingBlockedReason: z.string().nullable(),
  /** Human-readable next step when the backend cannot run yet. */
  setupGuidance: z.string().nullable(),
  /** True when every prerequisite is satisfied. */
  ready: z.boolean(),
  models: z.array(
    z.object({
      name: z.string(),
      displayName: z.string(),
      description: z.string(),
    }),
  ),
});

export type ClaudeCodeStatus = z.infer<typeof ClaudeCodeStatusSchema>;

export const ClaudeCodeUsageReportStatusSchema = z.enum([
  "pending",
  "reported",
  "rejected",
]);

export const ClaudeCodeUsageSummaryEventSchema = z.object({
  id: z.string(),
  chatId: z.number().nullable(),
  messageId: z.number().nullable(),
  appId: z.number().nullable(),
  status: ClaudeCodeUsageReportStatusSchema,
  attempts: z.number(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  reportedAt: z.string().nullable(),
  turnStatus: z.string(),
  models: z.array(
    z.object({
      model: z.string(),
      canonicalModel: z.string(),
      inputTokens: z.number(),
      cacheReadTokens: z.number(),
      cacheWriteTokens: z.number(),
      outputTokens: z.number(),
      pricingBasis: z.enum(["catalog", "unknown-model-flat-rate"]),
      listPriceUsd: z.number(),
      estimatedDyadChargeUsd: z.number(),
    }),
  ),
  billableTokens: z.number(),
  listPriceUsd: z.number(),
  estimatedDyadChargeUsd: z.number(),
  /** Charge the engine confirmed, when the report was acknowledged. */
  chargedUsd: z.number().nullable(),
});

export type ClaudeCodeUsageSummaryEvent = z.infer<
  typeof ClaudeCodeUsageSummaryEventSchema
>;

export const ClaudeCodeUsageSummarySchema = z.object({
  pricingRule: z.string(),
  catalogVersion: z.string(),
  dyadChargeRatio: z.number(),
  unknownModelUsdPerMillionTokens: z.number(),
  events: z.array(ClaudeCodeUsageSummaryEventSchema),
  totals: z.object({
    pendingCount: z.number(),
    reportedCount: z.number(),
    rejectedCount: z.number(),
    billableTokens: z.number(),
    listPriceUsd: z.number(),
    estimatedDyadChargeUsd: z.number(),
    confirmedDyadChargeUsd: z.number(),
  }),
});

export type ClaudeCodeUsageSummary = z.infer<
  typeof ClaudeCodeUsageSummarySchema
>;

export const ClaudeCodeRetryUsageReportsResultSchema = z.object({
  attempted: z.number(),
  reported: z.number(),
  pending: z.number(),
  rejected: z.number(),
});

export const claudeCodeContracts = {
  getStatus: defineContract({
    channel: "claude-code:get-status",
    input: z.object({ refresh: z.boolean().optional() }).optional(),
    output: ClaudeCodeStatusSchema,
  }),
  acknowledgeCharge: defineContract({
    channel: "claude-code:acknowledge-charge",
    input: z.void(),
    output: z.void(),
  }),
  getUsageSummary: defineContract({
    channel: "claude-code:get-usage-summary",
    input: z
      .object({ limit: z.number().int().positive().max(200).optional() })
      .optional(),
    output: ClaudeCodeUsageSummarySchema,
  }),
  retryUsageReports: defineContract({
    channel: "claude-code:retry-usage-reports",
    input: z.void(),
    output: ClaudeCodeRetryUsageReportsResultSchema,
  }),
} as const;

export const claudeCodeClient = createClient(claudeCodeContracts);
