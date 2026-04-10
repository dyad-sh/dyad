/**
 * OpenClaw Autonomous IPC Client
 * Renderer-side API for autonomous cross-feature orchestration.
 */

import type { IpcRenderer } from "electron";
import type {
  AutonomousExecution,
  AutonomousRequest,
  AutonomousStatus,
  ActionDefinition,
} from "@/types/openclaw_autonomous_types";

let ipcRenderer: IpcRenderer | null = null;

function getIpcRenderer(): IpcRenderer {
  if (!ipcRenderer) {
    ipcRenderer =
      (window as unknown as { electron?: { ipcRenderer: IpcRenderer } }).electron
        ?.ipcRenderer ?? null;
    if (!ipcRenderer) {
      throw new Error("IPC not available - are you running in Electron?");
    }
  }
  return ipcRenderer;
}

export const AutonomousClient = {
  /** Execute a natural language instruction autonomously. */
  async execute(request: AutonomousRequest): Promise<AutonomousExecution> {
    return getIpcRenderer().invoke("openclaw:autonomous:execute", request);
  },

  /** Create a plan but don't execute it. */
  async plan(request: AutonomousRequest): Promise<AutonomousExecution> {
    return getIpcRenderer().invoke("openclaw:autonomous:plan", request);
  },

  /** Approve and run a paused execution. */
  async approve(executionId: string): Promise<AutonomousExecution> {
    return getIpcRenderer().invoke("openclaw:autonomous:approve", executionId);
  },

  /** Cancel a running/paused execution. */
  async cancel(executionId: string): Promise<AutonomousExecution> {
    return getIpcRenderer().invoke("openclaw:autonomous:cancel", executionId);
  },

  /** Get a single execution by ID. */
  async getExecution(executionId: string): Promise<AutonomousExecution> {
    return getIpcRenderer().invoke("openclaw:autonomous:get", executionId);
  },

  /** List all executions (sorted by most recent). */
  async listExecutions(): Promise<AutonomousExecution[]> {
    return getIpcRenderer().invoke("openclaw:autonomous:list");
  },

  /** Get autonomous system status. */
  async getStatus(): Promise<AutonomousStatus> {
    return getIpcRenderer().invoke("openclaw:autonomous:status");
  },

  /** Get the full action catalog. */
  async getActions(): Promise<ActionDefinition[]> {
    return getIpcRenderer().invoke("openclaw:autonomous:actions");
  },
};
