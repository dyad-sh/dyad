/**
 * OpenClaw Cost Engine IPC Handlers
 *
 * Exposes cost tracking, budget management, and cost summaries
 * to the renderer process.
 */

import { ipcMain } from "electron";
import {
  getOpenClawCostEngine,
  type CostBudget,
  type TaskModule,
  type TaskModelRoute,
} from "@/lib/openclaw_cost_engine";

export function registerOpenClawCostHandlers(): void {
  ipcMain.handle("openclaw:cost:summary", async () => {
    const engine = getOpenClawCostEngine();
    return engine.getSummary();
  });

  ipcMain.handle("openclaw:cost:records", async (_, params: { limit?: number }) => {
    const engine = getOpenClawCostEngine();
    return engine.getRecords(params?.limit ?? 50);
  });

  ipcMain.handle("openclaw:cost:budget:get", async () => {
    const engine = getOpenClawCostEngine();
    return engine.getBudget();
  });

  ipcMain.handle("openclaw:cost:budget:set", async (_, params: Partial<CostBudget>) => {
    const engine = getOpenClawCostEngine();
    engine.setBudget(params);
    return engine.getBudget();
  });

  ipcMain.handle(
    "openclaw:cost:estimate",
    async (_, params: { model: string; inputTokens: number; outputTokens?: number }) => {
      const engine = getOpenClawCostEngine();
      return engine.estimateCost(params.model, params.inputTokens, params.outputTokens);
    },
  );

  ipcMain.handle("openclaw:cost:check-budget", async (_, params: { estimatedCostUsd: number }) => {
    const engine = getOpenClawCostEngine();
    return engine.checkBudget(params.estimatedCostUsd);
  });

  // ── Task-to-Model Routing ──

  ipcMain.handle("openclaw:cost:task-routing:get", async () => {
    const engine = getOpenClawCostEngine();
    return engine.getTaskRouting();
  });

  ipcMain.handle(
    "openclaw:cost:task-routing:set",
    async (_, params: Partial<Record<TaskModule, TaskModelRoute>>) => {
      const engine = getOpenClawCostEngine();
      engine.setTaskRouting(params);
      return engine.getTaskRouting();
    },
  );

  ipcMain.handle("openclaw:cost:task-routing:reset", async () => {
    const engine = getOpenClawCostEngine();
    engine.resetTaskRouting();
    return engine.getTaskRouting();
  });
}
