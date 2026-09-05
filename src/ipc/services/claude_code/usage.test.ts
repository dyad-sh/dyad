import { describe, expect, it } from "vitest";
import {
  normalizeClaudeUsage,
  referencePricePicoUsd,
  type TokenCategories,
} from "./usage";

const tokens: TokenCategories = {
  uncachedInputTokens: 100,
  cacheReadInputTokens: 20,
  cacheWrite5mInputTokens: 30,
  cacheWrite1hInputTokens: 40,
  cacheWriteUnclassifiedInputTokens: 0,
  outputTokens: 10,
};
describe("subscription accounting", () => {
  it("prices each known category at 25%, without overlapping cache counts", () => {
    expect(
      referencePricePicoUsd(tokens, {
        uncachedInputTokens: 3_000_000,
        cacheReadInputTokens: 300_000,
        cacheWrite5mInputTokens: 3_750_000,
        cacheWrite1hInputTokens: 6_000_000,
        outputTokens: 15_000_000,
      }),
    ).toBe(202125000n);
  });
  it("uses the flat unknown-model rate without another 25% multiplier", () => {
    expect(referencePricePicoUsd(tokens, "unknown")).toBe(20_000_000n);
  });
  it("refuses incomplete known pricing and invalid counts", () => {
    expect(() => referencePricePicoUsd(tokens, {})).toThrow(
      "Incomplete pricing",
    );
    expect(() =>
      referencePricePicoUsd({ ...tokens, outputTokens: -1 }, "unknown"),
    ).toThrow();
  });
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
