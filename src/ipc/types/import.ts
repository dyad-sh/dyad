import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Import Schemas
// =============================================================================

export const ImportAppParamsSchema = z.object({
  path: z.string(),
  appName: z.string(),
  installCommand: z.string().optional(),
  startCommand: z.string().optional(),
  skipCopy: z.boolean().optional(),
});

export type ImportAppParams = z.infer<typeof ImportAppParamsSchema>;

export const ImportAppResultSchema = z.object({
  appId: z.number(),
  chatId: z.number(),
});

export type ImportAppResult = z.infer<typeof ImportAppResultSchema>;

export const CheckAppNameParamsSchema = z.object({
  appName: z.string(),
  skipCopy: z.boolean().optional(),
});

export const CheckAppNameResultSchema = z.object({
  exists: z.boolean(),
});

export const CheckAiRulesParamsSchema = z.object({
  path: z.string(),
});

export const CheckAiRulesResultSchema = z.object({
  exists: z.boolean(),
});

// =============================================================================
// Import Contracts
// =============================================================================

export const importContracts = {
  importApp: defineContract({
    channel: "import-app",
    input: ImportAppParamsSchema,
    output: ImportAppResultSchema,
  }),

  checkAppName: defineContract({
    channel: "check-app-name",
    input: CheckAppNameParamsSchema,
    output: CheckAppNameResultSchema,
  }),

  checkAiRules: defineContract({
    channel: "check-ai-rules",
    input: CheckAiRulesParamsSchema,
    output: CheckAiRulesResultSchema,
  }),
} as const;

// =============================================================================
// Import Client
// =============================================================================

export const importClient = createClient(importContracts);
