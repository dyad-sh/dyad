import log from "electron-log";
import { z } from "zod";

const logger = log.scope("claude_code_usage");
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usage = z.object({
  input_tokens: count.optional(),
  output_tokens: count.optional(),
  cache_read_input_tokens: count.optional(),
  cache_creation_input_tokens: count.optional(),
});
const assistant = z.object({
  type: z.literal("assistant"),
  message: z.object({
    id: z.string().optional(),
    model: z.string().optional(),
    usage: usage,
  }),
});
const result = z.object({
  type: z.literal("result"),
  num_turns: count.optional(),
  usage: usage.optional(),
  modelUsage: z
    .record(
      z.string(),
      z.object({
        inputTokens: count,
        outputTokens: count,
        cacheReadInputTokens: count,
        cacheCreationInputTokens: count,
      }),
    )
    .optional(),
});

export interface ClaudeUsageDiagnosticContext {
  chatId: number;
  messageId: number;
  sessionId: string;
  resume: boolean;
  billingEventId: string | undefined;
  requestedModel: string;
}

/** Allowlist counters only: CLI events also contain private text and tool inputs.
 * Message IDs allow repeated assistant events to be deduplicated when comparing
 * a turn's message usage with result usage and modelUsage. No billing changes.
 */
export function logClaudeUsageDiagnostics(
  context: ClaudeUsageDiagnosticContext,
  event: unknown,
) {
  const message = assistant.safeParse(event);
  if (message.success) {
    logger.debug("Claude Code assistant usage", {
      ...context,
      assistantMessageId: message.data.message.id,
      modelId: message.data.message.model,
      usage: message.data.message.usage,
    });
    return;
  }
  const final = result.safeParse(event);
  if (final.success) {
    logger.debug("Claude Code result usage", {
      ...context,
      numTurns: final.data.num_turns,
      usage: final.data.usage,
      modelUsage: final.data.modelUsage,
    });
  }
}
