import { z } from "zod";

// Only these catalog fields cross IPC; initialization also includes account data.
export const ClaudeCodeModelsSchema = z
  .array(
    z.object({
      value: z.string().min(1).max(256),
      resolvedModel: z.string().min(1).max(256).optional(),
      displayName: z.string().min(1).max(256),
      description: z.string().max(4096),
    }),
  )
  .max(128);

export type ClaudeCodeModel = z.infer<typeof ClaudeCodeModelsSchema>[number];
