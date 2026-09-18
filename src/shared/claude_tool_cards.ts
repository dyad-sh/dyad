import { z } from "zod";

// Persist presentation data, never action tags or raw tool transcripts.
export const claudeToolCardSchema = z.object({
  kind: z.enum(["read", "list", "write", "edit", "logs", "packages", "status"]),
  state: z.enum(["pending", "finished", "warning", "error", "aborted"]),
  title: z.string().optional(),
  path: z.string().optional(),
  startLine: z.string().optional(),
  endLine: z.string().optional(),
  summary: z.string().optional(),
  body: z.string().default(""),
  count: z.string().optional(),
  packages: z.string().optional(),
  blocks: z
    .array(z.object({ searchContent: z.string(), replaceContent: z.string() }))
    .optional(),
});
export type ClaudeToolCard = z.infer<typeof claudeToolCardSchema>;
