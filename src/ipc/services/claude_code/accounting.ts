import type { LanguageModelV3Usage } from "@ai-sdk/provider";
import {
  finishExternalModelUsageBatch,
  interruptExternalModelUsage,
} from "../external_model_usage";
import { normalizeClaudeUsage } from "./usage";

/** CLI modelUsage is disjoint, includes auxiliary calls, and is never added to aggregate usage. */
export async function reportClaudeUsage(
  id: string | undefined,
  result: unknown,
) {
  let models;
  try {
    models = normalizeClaudeUsage(result);
  } catch {
    interruptExternalModelUsage(id);
    return { status: id ? "unavailable" : "unbilled", models: [] };
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
      return { model: model.actualModelId, usage };
    }),
  );
  // This is an attempt, not a settlement receipt. The engine owns actual spend.
  return { status: id ? "attempted" : "unbilled", models };
}
