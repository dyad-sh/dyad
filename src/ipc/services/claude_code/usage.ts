import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const modelUsageSchema = z.object({
  inputTokens: count,
  outputTokens: count,
  cacheReadInputTokens: count,
  cacheCreationInputTokens: count,
  canonicalModel: z.string().optional(),
});
export interface TokenCategories {
  uncachedInputTokens: number;
  cacheReadInputTokens: number;
  cacheWrite5mInputTokens: number;
  cacheWrite1hInputTokens: number;
  cacheWriteUnclassifiedInputTokens: number;
  outputTokens: number;
}
export interface ModelUsage extends TokenCategories {
  actualModelId: string;
  reportedCanonicalModelId?: string;
}
export interface UsageEvent {
  schemaVersion: 1;
  eventId: string;
  backend: "claude-code";
  appId: number;
  chatId: number;
  turnId: string;
  sessionId: string;
  reservationId: string;
  pricingSnapshotId: string;
  outcome: "completed" | "cancelled" | "failed";
  coverage: "complete" | "incomplete";
  models: ModelUsage[];
}

/** Result modelUsage is the accounting source (includes auxiliary calls).
 * Top-level usage is used ONLY for a provably matching cache-TTL breakdown. */
export function normalizeClaudeUsage(value: unknown): ModelUsage[] {
  const result = z
    .object({
      modelUsage: z.record(z.string(), modelUsageSchema),
      usage: z
        .object({
          input_tokens: count,
          output_tokens: count,
          cache_read_input_tokens: count,
          cache_creation_input_tokens: count,
          cache_creation: z
            .object({
              ephemeral_5m_input_tokens: count,
              ephemeral_1h_input_tokens: count,
            })
            .optional(),
        })
        .optional(),
    })
    .parse(value);
  const entries = Object.entries(result.modelUsage);
  if (!entries.length)
    throw new Error("Claude Code did not report model usage");
  const matches = entries.filter(
    ([, u]) =>
      result.usage &&
      u.inputTokens === result.usage.input_tokens &&
      u.outputTokens === result.usage.output_tokens &&
      u.cacheReadInputTokens === result.usage.cache_read_input_tokens &&
      u.cacheCreationInputTokens === result.usage.cache_creation_input_tokens,
  );
  return entries.map(([actualModelId, u]) => {
    const ttl =
      matches.length === 1 && matches[0][0] === actualModelId
        ? result.usage?.cache_creation
        : undefined;
    if (
      ttl &&
      ttl.ephemeral_5m_input_tokens + ttl.ephemeral_1h_input_tokens !==
        u.cacheCreationInputTokens
    )
      throw new Error("Inconsistent cache-write usage");
    return {
      actualModelId,
      reportedCanonicalModelId: u.canonicalModel,
      uncachedInputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadInputTokens: u.cacheReadInputTokens,
      cacheWrite5mInputTokens: ttl?.ephemeral_5m_input_tokens ?? 0,
      cacheWrite1hInputTokens: ttl?.ephemeral_1h_input_tokens ?? 0,
      cacheWriteUnclassifiedInputTokens: ttl ? 0 : u.cacheCreationInputTokens,
    };
  });
}

export type PriceRates = Partial<Record<keyof TokenCategories, number>>;
/** Reference pricing for contract tests, not a client-authoritative debit.
 * Rates are integer micro-USD per million tokens; result is pico-USD. */
export function referencePricePicoUsd(
  usage: TokenCategories,
  rates: PriceRates | "unknown",
): bigint {
  let total = 0n;
  for (const key of Object.keys(usage) as (keyof TokenCategories)[]) {
    const tokens = count.parse(usage[key]);
    if (!tokens) continue;
    if (rates === "unknown") total += BigInt(tokens) * 100_000n;
    else {
      const rate = rates[key];
      if (rate === undefined || !Number.isSafeInteger(rate) || rate < 0)
        throw new Error(`Incomplete pricing: ${key}`);
      total += BigInt(tokens) * BigInt(rate);
    }
  }
  return rates === "unknown" ? total : (total + 2n) / 4n;
}
