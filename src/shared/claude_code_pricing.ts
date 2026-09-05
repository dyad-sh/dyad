/**
 * Pricing rules for subscription-backed (Claude Code) execution.
 *
 * Renderer-safe pure module. The Dyad Engine is the authoritative biller: the
 * client reports normalized token counts (see `ClaudeCodeUsageEvent`) and the
 * engine calculates and debits the charge. The functions here compute the
 * same rule locally so the app can (a) disclose the estimated charge in the
 * usage UI and (b) reject silently-zero usage before it is reported.
 *
 * Rule (documented in docs/claude-code-integration.md):
 *
 * - Known model (present in the local catalog below or the remote catalog the
 *   engine maintains): Dyad charge = 25% of the API list-price cost of the
 *   measured tokens, each token category priced at its own catalog rate
 *   (uncached input, cache reads, cache writes, output).
 * - Unknown model: Dyad charge = total billable tokens × $0.10 / 1,000,000,
 *   flat across all token categories and NOT additionally multiplied by 25%.
 *
 * Every token is counted exactly once: the CLI's `input_tokens` already
 * excludes cached tokens, and cache reads/writes are reported in their own
 * fields, so categories are summed without overlap.
 */

/** Bump whenever a rate in `CLAUDE_CODE_LOCAL_PRICING_CATALOG` changes. */
export const CLAUDE_CODE_PRICING_CATALOG_VERSION = "2026-06-24.1";

export const CLAUDE_CODE_DYAD_CHARGE_RATIO = 0.25;

/** Flat rate for models unknown to every catalog: $0.10 per million tokens. */
export const CLAUDE_CODE_UNKNOWN_MODEL_USD_PER_MILLION_TOKENS = 0.1;

export const CLAUDE_CODE_PRICING_RULE_SUMMARY =
  "Subscription usage: your Claude subscription covers the model. Dyad charges 25% of the API list price for the measured tokens on known models, or a flat $0.10 per 1M tokens on models missing from the pricing catalog.";

export interface ClaudeCodeModelPricing {
  /** USD per one million uncached input tokens. */
  inputUsdPerMillion: number;
  /** USD per one million output tokens (thinking tokens are output tokens). */
  outputUsdPerMillion: number;
  /** USD per one million cache-read input tokens. */
  cacheReadUsdPerMillion: number;
  /** USD per one million 5-minute cache-write tokens. */
  cacheWrite5mUsdPerMillion: number;
  /** USD per one million 1-hour cache-write tokens. */
  cacheWrite1hUsdPerMillion: number;
}

function anthropicListPrice(
  inputUsdPerMillion: number,
  outputUsdPerMillion: number,
  overrides: Partial<ClaudeCodeModelPricing> = {},
): ClaudeCodeModelPricing {
  return {
    inputUsdPerMillion,
    outputUsdPerMillion,
    cacheReadUsdPerMillion: inputUsdPerMillion * 0.1,
    cacheWrite5mUsdPerMillion: inputUsdPerMillion * 1.25,
    cacheWrite1hUsdPerMillion: inputUsdPerMillion * 2,
    ...overrides,
  };
}

/**
 * Anthropic first-party API list prices, keyed by canonical model id. Dated
 * snapshot ids (for example `claude-haiku-4-5-20251001`) normalize to their
 * canonical id before lookup.
 */
export const CLAUDE_CODE_LOCAL_PRICING_CATALOG: Readonly<
  Record<string, ClaudeCodeModelPricing>
> = {
  "claude-fable-5-1": anthropicListPrice(10, 50, {
    cacheReadUsdPerMillion: 0.25,
  }),
  "claude-fable-5": anthropicListPrice(10, 50),
  "claude-opus-5": anthropicListPrice(5, 25),
  "claude-opus-4-8": anthropicListPrice(5, 25),
  "claude-opus-4-7": anthropicListPrice(5, 25),
  "claude-opus-4-6": anthropicListPrice(5, 25),
  "claude-opus-4-5": anthropicListPrice(5, 25),
  "claude-sonnet-5": anthropicListPrice(2, 10),
  "claude-sonnet-4-6": anthropicListPrice(3, 15),
  "claude-sonnet-4-5": anthropicListPrice(3, 15),
  "claude-haiku-4-5": anthropicListPrice(1, 5),
};

/** Strip a trailing `-YYYYMMDD` snapshot suffix. */
export function canonicalizeClaudeModelId(modelId: string): string {
  return modelId.trim().replace(/-\d{8}$/, "");
}

export interface ClaudeCodeTokenUsage {
  /** Uncached input tokens. */
  inputTokens: number;
  /** Input tokens served from the prompt cache. */
  cacheReadTokens: number;
  /**
   * Input tokens written to the prompt cache. When the CLI reports the
   * 5-minute / 1-hour split, `cacheWrite5mTokens` + `cacheWrite1hTokens`
   * equals this value; otherwise the split is unknown and cache writes are
   * priced at the 1-hour rate Claude Code uses by default.
   */
  cacheWriteTokens: number;
  cacheWrite5mTokens?: number;
  cacheWrite1hTokens?: number;
  /** Output tokens, including thinking tokens. */
  outputTokens: number;
}

export interface ClaudeCodeModelUsage extends ClaudeCodeTokenUsage {
  /** Model id exactly as reported by the CLI. */
  model: string;
  /** Canonical model id used for pricing lookup. */
  canonicalModel: string;
}

export function getTotalBillableTokens(usage: ClaudeCodeTokenUsage): number {
  return (
    usage.inputTokens +
    usage.cacheReadTokens +
    usage.cacheWriteTokens +
    usage.outputTokens
  );
}

export type ClaudeCodePricingBasis =
  | { kind: "catalog"; catalogVersion: string }
  | { kind: "unknown-model-flat-rate" };

export interface ClaudeCodeModelCharge {
  model: string;
  canonicalModel: string;
  basis: ClaudeCodePricingBasis;
  /** API list-price cost of the measured tokens (0 for unknown models). */
  listPriceUsd: number;
  dyadChargeUsd: number;
  billableTokens: number;
}

export interface ClaudeCodeTurnCharge {
  perModel: ClaudeCodeModelCharge[];
  listPriceUsd: number;
  dyadChargeUsd: number;
  billableTokens: number;
  catalogVersion: string;
}

export function lookupClaudeCodeModelPricing(
  model: string,
  catalog: Readonly<
    Record<string, ClaudeCodeModelPricing>
  > = CLAUDE_CODE_LOCAL_PRICING_CATALOG,
): ClaudeCodeModelPricing | null {
  return catalog[canonicalizeClaudeModelId(model)] ?? null;
}

function roundUsd(value: number): number {
  // Keep sub-cent precision (micro-dollars) so small turns do not vanish.
  return Math.round(value * 1_000_000) / 1_000_000;
}

function assertNonNegativeCounts(usage: ClaudeCodeTokenUsage): void {
  for (const [key, value] of Object.entries(usage)) {
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) || value < 0 || !Number.isInteger(value))
    ) {
      throw new Error(`Invalid token count for ${key}: ${value}`);
    }
  }
}

export function calculateListPriceUsd(
  usage: ClaudeCodeTokenUsage,
  pricing: ClaudeCodeModelPricing,
): number {
  assertNonNegativeCounts(usage);
  const split =
    usage.cacheWrite5mTokens !== undefined ||
    usage.cacheWrite1hTokens !== undefined;
  const cacheWrite5m = split ? (usage.cacheWrite5mTokens ?? 0) : 0;
  const cacheWrite1h = split
    ? (usage.cacheWrite1hTokens ?? 0)
    : usage.cacheWriteTokens;
  if (split && cacheWrite5m + cacheWrite1h !== usage.cacheWriteTokens) {
    throw new Error(
      `Cache write split (${cacheWrite5m} + ${cacheWrite1h}) does not match cacheWriteTokens (${usage.cacheWriteTokens})`,
    );
  }
  const perMillion = 1_000_000;
  return (
    (usage.inputTokens * pricing.inputUsdPerMillion +
      usage.cacheReadTokens * pricing.cacheReadUsdPerMillion +
      cacheWrite5m * pricing.cacheWrite5mUsdPerMillion +
      cacheWrite1h * pricing.cacheWrite1hUsdPerMillion +
      usage.outputTokens * pricing.outputUsdPerMillion) /
    perMillion
  );
}

export function calculateClaudeCodeModelCharge(
  usage: ClaudeCodeModelUsage,
  options: {
    catalog?: Readonly<Record<string, ClaudeCodeModelPricing>>;
    catalogVersion?: string;
  } = {},
): ClaudeCodeModelCharge {
  const catalog = options.catalog ?? CLAUDE_CODE_LOCAL_PRICING_CATALOG;
  const catalogVersion =
    options.catalogVersion ?? CLAUDE_CODE_PRICING_CATALOG_VERSION;
  const pricing = lookupClaudeCodeModelPricing(usage.canonicalModel, catalog);
  const billableTokens = getTotalBillableTokens(usage);
  if (!pricing) {
    assertNonNegativeCounts(usage);
    return {
      model: usage.model,
      canonicalModel: usage.canonicalModel,
      basis: { kind: "unknown-model-flat-rate" },
      listPriceUsd: 0,
      dyadChargeUsd: roundUsd(
        (billableTokens * CLAUDE_CODE_UNKNOWN_MODEL_USD_PER_MILLION_TOKENS) /
          1_000_000,
      ),
      billableTokens,
    };
  }
  const listPriceUsd = calculateListPriceUsd(usage, pricing);
  return {
    model: usage.model,
    canonicalModel: usage.canonicalModel,
    basis: { kind: "catalog", catalogVersion },
    listPriceUsd: roundUsd(listPriceUsd),
    dyadChargeUsd: roundUsd(listPriceUsd * CLAUDE_CODE_DYAD_CHARGE_RATIO),
    billableTokens,
  };
}

/**
 * Price every model used by a turn (the primary model plus any auxiliary
 * calls such as the CLI's fast summarization model or subagents). Each model's
 * usage is priced independently so a turn that mixes a known and an unknown
 * model applies the right rule per model.
 */
export function calculateClaudeCodeTurnCharge(
  perModelUsage: readonly ClaudeCodeModelUsage[],
  options: {
    catalog?: Readonly<Record<string, ClaudeCodeModelPricing>>;
    catalogVersion?: string;
  } = {},
): ClaudeCodeTurnCharge {
  const perModel = perModelUsage.map((usage) =>
    calculateClaudeCodeModelCharge(usage, options),
  );
  return {
    perModel,
    listPriceUsd: roundUsd(
      perModel.reduce((sum, charge) => sum + charge.listPriceUsd, 0),
    ),
    dyadChargeUsd: roundUsd(
      perModel.reduce((sum, charge) => sum + charge.dyadChargeUsd, 0),
    ),
    billableTokens: perModel.reduce(
      (sum, charge) => sum + charge.billableTokens,
      0,
    ),
    catalogVersion:
      options.catalogVersion ?? CLAUDE_CODE_PRICING_CATALOG_VERSION,
  };
}

export function formatUsd(value: number): string {
  if (value === 0) {
    return "$0.00";
  }
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }
  return `$${value.toFixed(2)}`;
}
