/**
 * OpenClaw Cost Engine — Renderer IPC Client
 */

import type {
  CostBudget,
  CostRecord,
  CostSummary,
  TaskModule,
  TaskModelRoute,
  TaskModelRouting,
} from "@/lib/openclaw_cost_engine";

function getIpc() {
  return (window as any).electron?.ipcRenderer;
}

export const CostClient = {
  getSummary(): Promise<CostSummary> {
    return getIpc().invoke("openclaw:cost:summary");
  },

  getRecords(limit = 50): Promise<CostRecord[]> {
    return getIpc().invoke("openclaw:cost:records", { limit });
  },

  getBudget(): Promise<CostBudget> {
    return getIpc().invoke("openclaw:cost:budget:get");
  },

  setBudget(budget: Partial<CostBudget>): Promise<CostBudget> {
    return getIpc().invoke("openclaw:cost:budget:set", budget);
  },

  estimateCost(
    model: string,
    inputTokens: number,
    outputTokens?: number,
  ): Promise<number> {
    return getIpc().invoke("openclaw:cost:estimate", {
      model,
      inputTokens,
      outputTokens,
    });
  },

  checkBudget(estimatedCostUsd: number): Promise<{
    allowed: boolean;
    reason: string;
    remainingDailyUsd: number;
    remainingMonthlyUsd: number;
  }> {
    return getIpc().invoke("openclaw:cost:check-budget", { estimatedCostUsd });
  },

  // ── Task Routing ──

  getTaskRouting(): Promise<TaskModelRouting> {
    return getIpc().invoke("openclaw:cost:task-routing:get");
  },

  setTaskRouting(updates: Partial<Record<TaskModule, TaskModelRoute>>): Promise<TaskModelRouting> {
    return getIpc().invoke("openclaw:cost:task-routing:set", updates);
  },

  resetTaskRouting(): Promise<TaskModelRouting> {
    return getIpc().invoke("openclaw:cost:task-routing:reset");
  },
};
