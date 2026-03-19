/**
 * Flywheel Client — Renderer-side IPC client for the Data Flywheel system
 */

import type { IpcRenderer } from "electron";
import type { FlywheelStats, FlywheelRunRecord } from "@/lib/data_flywheel";

class FlywheelClient {
  private static instance: FlywheelClient;
  private ipcRenderer: IpcRenderer;

  private constructor() {
    this.ipcRenderer = (window as any).electron.ipcRenderer as IpcRenderer;
  }

  static getInstance(): FlywheelClient {
    if (!FlywheelClient.instance) {
      FlywheelClient.instance = new FlywheelClient();
    }
    return FlywheelClient.instance;
  }

  /** Rate a message (thumbs up/down) and capture the training pair */
  async rateMessage(
    messageId: number,
    rating: "positive" | "negative",
  ): Promise<void> {
    return this.ipcRenderer.invoke("flywheel:rate-message", {
      messageId,
      rating,
    });
  }

  /** Correct a message and capture the correction as a training pair */
  async correctMessage(
    messageId: number,
    correctedOutput: string,
  ): Promise<void> {
    return this.ipcRenderer.invoke("flywheel:correct-message", {
      messageId,
      correctedOutput,
    });
  }

  /** Get flywheel stats for an agent (or global) */
  async getStats(agentId?: number): Promise<FlywheelStats> {
    return this.ipcRenderer.invoke("flywheel:get-stats", { agentId });
  }

  /** Get flywheel run history */
  async getRuns(agentId?: number, limit?: number): Promise<FlywheelRunRecord[]> {
    return this.ipcRenderer.invoke("flywheel:get-runs", { agentId, limit });
  }

  /** Manually trigger a flywheel training cycle */
  async runCycle(agentId?: number): Promise<FlywheelRunRecord> {
    return this.ipcRenderer.invoke("flywheel:run-cycle", { agentId });
  }

  /** Register n8n flywheel workflow with a schedule */
  async registerN8nWorkflow(
    schedule: "daily" | "weekly",
  ): Promise<{ workflowId: string } | null> {
    return this.ipcRenderer.invoke("flywheel:register-n8n-workflow", {
      schedule,
    });
  }

  /** Remove the n8n flywheel workflow */
  async removeN8nWorkflow(): Promise<void> {
    return this.ipcRenderer.invoke("flywheel:remove-n8n-workflow");
  }
}

export { FlywheelClient };
