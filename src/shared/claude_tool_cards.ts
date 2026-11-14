import { z } from "zod";

// Persist presentation data, never action tags or raw tool transcripts.
// The first seven kinds come from the retired prototype and stay readable for
// saved chats; the rest are produced by the native Claude Code harness.
export const claudeToolCardSchema = z.object({
  kind: z.enum([
    "read",
    "list",
    "write",
    "edit",
    "logs",
    "packages",
    "status",
    "shell",
    "search",
    "web",
    "task",
    "tool",
  ]),
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
  /** Native tool name as Claude Code reported it (e.g. "Bash", "Grep"). */
  tool: z.string().optional(),
  /** Shell command, search pattern, web query/URL or subagent prompt. */
  subject: z.string().optional(),
  /** Steps a subagent took, newest last. */
  steps: z.array(z.string()).optional(),
});
export type ClaudeToolCard = z.infer<typeof claudeToolCardSchema>;
