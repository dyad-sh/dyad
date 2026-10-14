import log from "electron-log";
import type { LanguageModelV3Usage } from "@ai-sdk/provider";
import {
  finishExternalModelUsageBatch,
  interruptExternalModelUsage,
} from "../external_model_usage";
import { normalizeClaudeUsage } from "./usage";
import { claudeUsageDelta, type ClaudeUsageBaseline } from "./usage_checkpoint";

export interface ClaudeUsageCheckpoint {
  previous: ClaudeUsageBaseline;
  save: (baseline: ClaudeUsageBaseline) => Promise<void>;
}

const logger = log.scope("claude_code_usage");

/** Bill per-model turn deltas, including auxiliary calls, never session totals.
 * Never rejects for checkpoint or normalization failures: the turn has already
 * finished, and accounting problems must not surface as a failed response. */
export async function reportClaudeUsage(
  id: string | undefined,
  result: unknown,
  checkpoint?: ClaudeUsageCheckpoint,
) {
  let delta;
  try {
    delta = claudeUsageDelta(result, checkpoint?.previous ?? {});
  } catch {
    // Missing or inconsistent counters: without a trustworthy baseline the
    // session must not resume, so leave it un-checkpointed.
    interruptExternalModelUsage(id);
    return;
  }
  let models;
  try {
    // Models used only in earlier turns have an all-zero delta; skip them so
    // they neither post empty reports nor take the primary billing id.
    models = normalizeClaudeUsage(delta.result).filter(
      (model) =>
        model.uncachedInputTokens +
          model.cacheReadInputTokens +
          model.cacheWrite5mInputTokens +
          model.cacheWrite1hInputTokens +
          model.cacheWriteUnclassifiedInputTokens +
          model.outputTokens >
        0,
    );
  } catch {
    // The counters are consistent, so still checkpoint them below: an
    // unbillable turn must not discard the resumable session.
    models = undefined;
  }
  if (checkpoint) {
    try {
      // Advance before the single debit attempt, even if that attempt fails.
      // A resumed turn must never replay tokens from an earlier turn.
      await checkpoint.save(delta.baseline);
    } catch {
      // The session stays un-checkpointed and will start fresh next turn.
      logger.warn("Claude Code usage checkpoint failed; not reporting usage");
      interruptExternalModelUsage(id);
      return;
    }
  }
  if (!models) {
    interruptExternalModelUsage(id);
    return;
  }
  await finishExternalModelUsageBatch(
    id,
    models.map((model) => {
      const cacheWrite =
        model.cacheWrite5mInputTokens +
        model.cacheWrite1hInputTokens +
        model.cacheWriteUnclassifiedInputTokens;
      const usage: LanguageModelV3Usage = {
        inputTokens: {
          total:
            model.uncachedInputTokens + model.cacheReadInputTokens + cacheWrite,
          noCache: model.uncachedInputTokens,
          cacheRead: model.cacheReadInputTokens,
          cacheWrite,
        },
        outputTokens: {
          total: model.outputTokens,
          text: undefined,
          reasoning: undefined,
        },
      };
      if (id) {
        logger.debug("Claude Code billing usage", {
          billingEventId: id,
          modelId: model.actualModelId,
          modelProvider: "anthropic",
          connection: "subscription",
          totalTokens:
            model.uncachedInputTokens +
            model.cacheReadInputTokens +
            cacheWrite +
            model.outputTokens,
          cachedInputTokens: model.cacheReadInputTokens,
          uncachedInputTokens: model.uncachedInputTokens + cacheWrite,
          outputTokens: model.outputTokens,
        });
      }
      return { model: model.actualModelId, usage };
    }),
  );
}
