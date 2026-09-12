/**
 * Convert the CLI's `result` usage payload into normalized per-model token
 * categories. Pure module (no Electron/DB) so it can be unit-tested against
 * captured CLI output.
 *
 * Source of truth is `modelUsage` (per model). The aggregate `usage` object
 * only covers the primary model and is used solely to split that model's
 * cache writes into the 5-minute / 1-hour buckets when available. Nothing is
 * summed from both, so cached tokens are never counted twice.
 */
import {
  canonicalizeClaudeModelId,
  type ClaudeCodeModelUsage,
} from "@/shared/claude_code_pricing";
import type { ChatBackendTurnUsage } from "@/chat_backend/backend";
import type { CliModelUsageEntry, CliUsage } from "./stream_json_protocol";

export interface ClaudeResultUsageSource {
  usage?: CliUsage | null;
  modelUsage?: Record<string, CliModelUsageEntry> | null;
  total_cost_usd?: number | null;
}

function nonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.round(value);
}

/**
 * Returns null when the CLI reported no usable usage at all (for example a
 * crash before the result event). Zero-token turns with an explicit
 * `modelUsage` map are still returned so the engine sees an explicit record.
 */
export function normalizeCliResultUsage(
  source: ClaudeResultUsageSource,
  { primaryModel }: { primaryModel: string | null },
): ChatBackendTurnUsage | null {
  const modelUsage = source.modelUsage;
  if (!modelUsage || Object.keys(modelUsage).length === 0) {
    return null;
  }
  const primaryCanonical = primaryModel
    ? canonicalizeClaudeModelId(primaryModel)
    : null;
  const aggregate = source.usage ?? null;
  const perModel: ClaudeCodeModelUsage[] = Object.entries(modelUsage).map(
    ([model, entry]) => {
      const canonicalModel = canonicalizeClaudeModelId(
        entry.canonicalModel ?? model,
      );
      const cacheWriteTokens = nonNegativeInt(entry.cacheCreationInputTokens);
      const usage: ClaudeCodeModelUsage = {
        model,
        canonicalModel,
        inputTokens: nonNegativeInt(entry.inputTokens),
        cacheReadTokens: nonNegativeInt(entry.cacheReadInputTokens),
        cacheWriteTokens,
        outputTokens: nonNegativeInt(entry.outputTokens),
      };
      // The aggregate usage block describes the primary model only. Use its
      // 5m/1h split when it accounts for exactly this model's cache writes.
      if (
        aggregate?.cache_creation &&
        primaryCanonical !== null &&
        canonicalModel === primaryCanonical
      ) {
        const fiveMinute = nonNegativeInt(
          aggregate.cache_creation.ephemeral_5m_input_tokens,
        );
        const oneHour = nonNegativeInt(
          aggregate.cache_creation.ephemeral_1h_input_tokens,
        );
        if (fiveMinute + oneHour === cacheWriteTokens) {
          usage.cacheWrite5mTokens = fiveMinute;
          usage.cacheWrite1hTokens = oneHour;
        }
      }
      return usage;
    },
  );
  return {
    perModel,
    backendReportedCostUsd:
      typeof source.total_cost_usd === "number" &&
      Number.isFinite(source.total_cost_usd)
        ? source.total_cost_usd
        : null,
  };
}
