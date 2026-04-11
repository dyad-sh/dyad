/**
 * Cost Tracking Utility
 *
 * Tiny wrapper around the OpenClaw cost engine for recording AI usage.
 * Designed to be called from onFinish callbacks in streamText / generateText.
 * Best-effort: never throws.
 */

import log from "electron-log";
import { getOpenClawCostEngine } from "@/lib/openclaw_cost_engine";
import type { CostRecord } from "@/lib/openclaw_cost_engine";

const logger = log.scope("cost-track");

/**
 * Record token usage with the cost engine. Safe to call from any AI path.
 * Returns the cost record or null if recording failed.
 */
export function recordAICost(params: {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  taskType: string;
  source: CostRecord["source"];
}): CostRecord | null {
  try {
    if (!params.inputTokens && !params.outputTokens) return null;
    const engine = getOpenClawCostEngine();
    return engine.recordUsage(params);
  } catch (err) {
    logger.warn("Cost recording failed (best-effort):", (err as Error).message);
    return null;
  }
}

/**
 * Check whether an estimated cost is within budget.
 * Returns { allowed: true } if cost engine is unavailable (fail-open).
 */
export function checkAICostBudget(estimatedCostUsd: number): {
  allowed: boolean;
  reason: string;
  remainingDailyUsd: number;
  remainingMonthlyUsd: number;
} {
  try {
    const engine = getOpenClawCostEngine();
    return engine.checkBudget(estimatedCostUsd);
  } catch {
    return {
      allowed: true,
      reason: "Cost engine unavailable, allowing request",
      remainingDailyUsd: Infinity,
      remainingMonthlyUsd: Infinity,
    };
  }
}
