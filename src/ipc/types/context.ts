import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Context Schemas
// =============================================================================

export const GlobPathSchema = z.object({
  globPath: z.string(),
});

export type GlobPath = z.infer<typeof GlobPathSchema>;

export const ContextPathResultSchema = GlobPathSchema.extend({
  files: z.number(),
  tokens: z.number(),
});

export type ContextPathResult = z.infer<typeof ContextPathResultSchema>;

export const ContextPathResultsSchema = z.object({
  contextPaths: z.array(ContextPathResultSchema),
  smartContextAutoIncludes: z.array(ContextPathResultSchema),
  excludePaths: z.array(ContextPathResultSchema),
});

export type ContextPathResults = z.infer<typeof ContextPathResultsSchema>;

export const AppChatContextSchema = z.object({
  contextPaths: z.array(GlobPathSchema),
  smartContextAutoIncludes: z.array(GlobPathSchema),
  excludePaths: z.array(GlobPathSchema).optional(),
});

export type AppChatContext = z.infer<typeof AppChatContextSchema>;

export const GetContextPathsParamsSchema = z.object({
  appId: z.number(),
});

export const SetContextPathsParamsSchema = z.object({
  appId: z.number(),
  chatContext: AppChatContextSchema,
});

// =============================================================================
// Context Contracts
// =============================================================================

export const contextContracts = {
  getContextPaths: defineContract({
    channel: "get-context-paths",
    input: GetContextPathsParamsSchema,
    output: ContextPathResultsSchema,
  }),

  setContextPaths: defineContract({
    channel: "set-context-paths",
    input: SetContextPathsParamsSchema,
    output: z.void(),
  }),
} as const;

// =============================================================================
// Context Client
// =============================================================================

export const contextClient = createClient(contextContracts);
