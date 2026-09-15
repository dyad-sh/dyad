import { describe, expect, it } from "vitest";
import { normalizeClaudeUsage } from "./usage";

describe("subscription accounting", () => {
  it("includes auxiliary calls once and maps only a matching TTL breakdown", () => {
    const result = normalizeClaudeUsage({
      modelUsage: {
        main: {
          inputTokens: 2,
          outputTokens: 9,
          cacheReadInputTokens: 2800,
          cacheCreationInputTokens: 2407,
        },
        auxiliary: {
          inputTokens: 904,
          outputTokens: 10,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      },
      usage: {
        input_tokens: 2,
        output_tokens: 9,
        cache_read_input_tokens: 2800,
        cache_creation_input_tokens: 2407,
        cache_creation: {
          ephemeral_5m_input_tokens: 0,
          ephemeral_1h_input_tokens: 2407,
        },
      },
    });
    expect(result).toHaveLength(2);
    expect(result[0].cacheWrite1hInputTokens).toBe(2407);
    expect(result[0].cacheWriteUnclassifiedInputTokens).toBe(0);
    expect(result[1].uncachedInputTokens).toBe(904);
  });
  it("does not invent TTL allocation for mixed models or missing usage", () => {
    expect(
      normalizeClaudeUsage({
        modelUsage: {
          main: {
            inputTokens: 1,
            outputTokens: 2,
            cacheReadInputTokens: 3,
            cacheCreationInputTokens: 4,
          },
        },
      })[0].cacheWriteUnclassifiedInputTokens,
    ).toBe(4);
    expect(() => normalizeClaudeUsage({})).toThrow();
    expect(() => normalizeClaudeUsage({ modelUsage: {} })).toThrow();
  });
});
