import { describe, expect, it } from "vitest";
import {
  calculateClaudeCodeModelCharge,
  calculateClaudeCodeTurnCharge,
  calculateListPriceUsd,
  canonicalizeClaudeModelId,
  CLAUDE_CODE_DYAD_CHARGE_RATIO,
  CLAUDE_CODE_LOCAL_PRICING_CATALOG,
  CLAUDE_CODE_UNKNOWN_MODEL_USD_PER_MILLION_TOKENS,
  formatUsd,
  getTotalBillableTokens,
  lookupClaudeCodeModelPricing,
} from "./claude_code_pricing";

describe("claude_code_pricing", () => {
  it("canonicalizes dated snapshot ids", () => {
    expect(canonicalizeClaudeModelId("claude-haiku-4-5-20251001")).toBe(
      "claude-haiku-4-5",
    );
    expect(canonicalizeClaudeModelId("claude-sonnet-5")).toBe(
      "claude-sonnet-5",
    );
    expect(lookupClaudeCodeModelPricing("claude-haiku-4-5-20251001")).toBe(
      CLAUDE_CODE_LOCAL_PRICING_CATALOG["claude-haiku-4-5"],
    );
  });

  it("charges 25% of list price for a known model, per token category", () => {
    // claude-sonnet-5: $2 in, $10 out, $0.20 cache read, $4 cache write (1h).
    const charge = calculateClaudeCodeModelCharge({
      model: "claude-sonnet-5",
      canonicalModel: "claude-sonnet-5",
      inputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(charge.basis).toEqual({
      kind: "catalog",
      catalogVersion: expect.any(String),
    });
    expect(charge.listPriceUsd).toBeCloseTo(2 + 0.2 + 4 + 10, 6);
    expect(charge.dyadChargeUsd).toBeCloseTo(
      (2 + 0.2 + 4 + 10) * CLAUDE_CODE_DYAD_CHARGE_RATIO,
      6,
    );
    expect(charge.billableTokens).toBe(4_000_000);
  });

  it("prices cache writes at the 5-minute rate when the split says so", () => {
    const pricing = lookupClaudeCodeModelPricing("claude-sonnet-5")!;
    const list = calculateListPriceUsd(
      {
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 1_000_000,
        cacheWrite5mTokens: 1_000_000,
        cacheWrite1hTokens: 0,
        outputTokens: 0,
      },
      pricing,
    );
    expect(list).toBeCloseTo(2.5, 6);
  });

  it("defaults unsplit cache writes to the 1-hour rate Claude Code uses", () => {
    const pricing = lookupClaudeCodeModelPricing("claude-sonnet-5")!;
    const list = calculateListPriceUsd(
      {
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 1_000_000,
        outputTokens: 0,
      },
      pricing,
    );
    expect(list).toBeCloseTo(4, 6);
  });

  it("rejects a cache split that disagrees with the total", () => {
    const pricing = lookupClaudeCodeModelPricing("claude-sonnet-5")!;
    expect(() =>
      calculateListPriceUsd(
        {
          inputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 10,
          cacheWrite5mTokens: 3,
          cacheWrite1hTokens: 3,
          outputTokens: 0,
        },
        pricing,
      ),
    ).toThrow(/does not match/);
  });

  it("applies the flat unknown-model rate without the 25% multiplier", () => {
    const charge = calculateClaudeCodeModelCharge({
      model: "claude-future-9",
      canonicalModel: "claude-future-9",
      inputTokens: 500_000,
      cacheReadTokens: 250_000,
      cacheWriteTokens: 150_000,
      outputTokens: 100_000,
    });
    expect(charge.basis).toEqual({ kind: "unknown-model-flat-rate" });
    expect(charge.listPriceUsd).toBe(0);
    expect(charge.billableTokens).toBe(1_000_000);
    expect(charge.dyadChargeUsd).toBeCloseTo(
      CLAUDE_CODE_UNKNOWN_MODEL_USD_PER_MILLION_TOKENS,
      9,
    );
  });

  it("uses a special cache-read rate for Claude Fable 5.1", () => {
    const pricing = lookupClaudeCodeModelPricing("claude-fable-5-1")!;
    expect(pricing.cacheReadUsdPerMillion).toBe(0.25);
    expect(pricing.inputUsdPerMillion).toBe(10);
  });

  it("prices mixed known and unknown models independently and sums them", () => {
    const turn = calculateClaudeCodeTurnCharge([
      {
        model: "claude-sonnet-5",
        canonicalModel: "claude-sonnet-5",
        inputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
      },
      {
        model: "claude-haiku-4-5-20251001",
        canonicalModel: "claude-haiku-4-5",
        inputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
      },
      {
        model: "mystery-model",
        canonicalModel: "mystery-model",
        inputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
      },
    ]);
    expect(turn.perModel.map((entry) => entry.basis.kind)).toEqual([
      "catalog",
      "catalog",
      "unknown-model-flat-rate",
    ]);
    expect(turn.listPriceUsd).toBeCloseTo(2 + 1, 6);
    expect(turn.dyadChargeUsd).toBeCloseTo(0.5 + 0.25 + 0.1, 6);
    expect(turn.billableTokens).toBe(3_000_000);
  });

  it("counts every token category exactly once", () => {
    expect(
      getTotalBillableTokens({
        inputTokens: 1,
        cacheReadTokens: 2,
        cacheWriteTokens: 3,
        cacheWrite5mTokens: 1,
        cacheWrite1hTokens: 2,
        outputTokens: 4,
      }),
    ).toBe(10);
  });

  it("rejects negative or fractional token counts", () => {
    expect(() =>
      calculateClaudeCodeModelCharge({
        model: "claude-sonnet-5",
        canonicalModel: "claude-sonnet-5",
        inputTokens: -1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
      }),
    ).toThrow(/Invalid token count/);
  });

  it("formats sub-cent charges without collapsing them to zero", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0031)).toBe("$0.0031");
    expect(formatUsd(1.234)).toBe("$1.23");
  });
});
