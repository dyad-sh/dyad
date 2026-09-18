import { z } from "zod";

export const ClaudeCodeUsageSchema = z.object({
  windows: z.array(
    z.object({
      name: z.enum(["five_hour", "seven_day"]),
      usedPercent: z.number().finite().min(0).max(100),
      resetsAt: z.number().finite().nonnegative(),
    }),
  ),
  updatedAt: z.number().nullable(),
});

export type ClaudeCodeUsage = z.infer<typeof ClaudeCodeUsageSchema>;
