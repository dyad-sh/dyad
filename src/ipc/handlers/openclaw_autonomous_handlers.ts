/**
 * OpenClaw Autonomous IPC Handlers
 *
 * Expose the autonomous brain to the renderer for planning and executing
 * multi-step tasks across all JoyCreate features.
 */

import { ipcMain } from "electron";
import { getOpenClawAutonomous } from "@/lib/openclaw_autonomous";
import { getActionCatalog } from "@/lib/openclaw_actions";
import type { AutonomousRequest } from "@/types/openclaw_autonomous_types";

export function registerOpenClawAutonomousHandlers() {
  ipcMain.handle(
    "openclaw:autonomous:execute",
    async (_, request: AutonomousRequest) => {
      if (!request?.input) {
        throw new Error("input is required");
      }
      const brain = getOpenClawAutonomous();
      return brain.execute(request);
    },
  );

  ipcMain.handle(
    "openclaw:autonomous:plan",
    async (_, request: AutonomousRequest) => {
      if (!request?.input) {
        throw new Error("input is required");
      }
      const brain = getOpenClawAutonomous();
      return brain.execute({ ...request, planOnly: true });
    },
  );

  ipcMain.handle(
    "openclaw:autonomous:approve",
    async (_, executionId: string) => {
      if (!executionId) {
        throw new Error("executionId is required");
      }
      const brain = getOpenClawAutonomous();
      return brain.approve(executionId);
    },
  );

  ipcMain.handle(
    "openclaw:autonomous:cancel",
    async (_, executionId: string) => {
      if (!executionId) {
        throw new Error("executionId is required");
      }
      const brain = getOpenClawAutonomous();
      return brain.cancel(executionId);
    },
  );

  ipcMain.handle(
    "openclaw:autonomous:get",
    async (_, executionId: string) => {
      if (!executionId) {
        throw new Error("executionId is required");
      }
      const brain = getOpenClawAutonomous();
      const exec = brain.getExecution(executionId);
      if (!exec) {
        throw new Error(`Execution not found: ${executionId}`);
      }
      return exec;
    },
  );

  ipcMain.handle("openclaw:autonomous:list", async () => {
    const brain = getOpenClawAutonomous();
    return brain.listExecutions();
  });

  ipcMain.handle("openclaw:autonomous:status", async () => {
    const brain = getOpenClawAutonomous();
    return brain.getStatus();
  });

  ipcMain.handle("openclaw:autonomous:actions", async () => {
    return getActionCatalog();
  });
}
