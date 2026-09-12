import { describe, expect, it } from "vitest";
import { normalizeCliResultUsage } from "./usage_normalization";

// Captured from Claude Code 2.1.260 (`claude -p --output-format stream-json`).
const capturedResult = {
  total_cost_usd: 0.0625072,
  usage: {
    input_tokens: 4,
    cache_creation_input_tokens: 13087,
    cache_read_input_tokens: 12371,
    output_tokens: 671,
    cache_creation: {
      ephemeral_1h_input_tokens: 13087,
      ephemeral_5m_input_tokens: 0,
    },
  },
  modelUsage: {
    "claude-haiku-4-5-20251001": {
      inputTokens: 907,
      outputTokens: 12,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUSD: 0.000967,
      canonicalModel: "claude-haiku-4-5",
      costBasis: "list",
    },
    "claude-sonnet-5": {
      inputTokens: 4,
      outputTokens: 671,
      cacheReadInputTokens: 12371,
      cacheCreationInputTokens: 13087,
      costUSD: 0.0615402,
      canonicalModel: "claude-sonnet-5",
      costBasis: "list",
    },
  },
};

describe("normalizeCliResultUsage", () => {
  it("normalizes each model once from modelUsage (never the aggregate)", () => {
    const usage = normalizeCliResultUsage(capturedResult, {
      primaryModel: "claude-sonnet-5",
    });
    expect(usage).not.toBeNull();
    expect(usage!.backendReportedCostUsd).toBeCloseTo(0.0625072, 9);
    expect(usage!.perModel).toHaveLength(2);
    const sonnet = usage!.perModel.find((m) => m.model === "claude-sonnet-5")!;
    expect(sonnet).toMatchObject({
      canonicalModel: "claude-sonnet-5",
      inputTokens: 4,
      cacheReadTokens: 12371,
      cacheWriteTokens: 13087,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 13087,
      outputTokens: 671,
    });
    const haiku = usage!.perModel.find(
      (m) => m.model === "claude-haiku-4-5-20251001",
    )!;
    expect(haiku).toMatchObject({
      canonicalModel: "claude-haiku-4-5",
      inputTokens: 907,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 12,
    });
    // The auxiliary model never inherits the primary model's cache split.
    expect(haiku.cacheWrite1hTokens).toBeUndefined();
    const total = usage!.perModel.reduce(
      (sum, m) =>
        sum +
        m.inputTokens +
        m.cacheReadTokens +
        m.cacheWriteTokens +
        m.outputTokens,
      0,
    );
    expect(total).toBe(4 + 12371 + 13087 + 671 + 907 + 12);
  });

  it("leaves the cache split undefined when the aggregate does not match", () => {
    const usage = normalizeCliResultUsage(
      {
        ...capturedResult,
        usage: {
          ...capturedResult.usage,
          cache_creation: {
            ephemeral_1h_input_tokens: 1,
            ephemeral_5m_input_tokens: 1,
          },
        },
      },
      { primaryModel: "claude-sonnet-5" },
    );
    const sonnet = usage!.perModel.find((m) => m.model === "claude-sonnet-5")!;
    expect(sonnet.cacheWrite5mTokens).toBeUndefined();
    expect(sonnet.cacheWrite1hTokens).toBeUndefined();
    expect(sonnet.cacheWriteTokens).toBe(13087);
  });

  it("returns null when the CLI reported no model usage", () => {
    expect(normalizeCliResultUsage({}, { primaryModel: null })).toBeNull();
    expect(
      normalizeCliResultUsage({ modelUsage: {} }, { primaryModel: null }),
    ).toBeNull();
  });

  it("clamps malformed counts to zero instead of inventing tokens", () => {
    const usage = normalizeCliResultUsage(
      {
        modelUsage: {
          "claude-sonnet-5": {
            inputTokens: -5,
            outputTokens: Number.NaN,
            cacheReadInputTokens: 2.6,
          },
        },
      },
      { primaryModel: null },
    );
    expect(usage!.perModel[0]).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 3,
      cacheWriteTokens: 0,
    });
    expect(usage!.backendReportedCostUsd).toBeNull();
  });
});
