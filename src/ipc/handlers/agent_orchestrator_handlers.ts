/**
 * Agent Orchestrator IPC Handlers
 * Connects the renderer to the autonomous meta-agent orchestration engine
 *
 * Channels:
 * - orchestrator:initialize / shutdown / status
 * - orchestrator:submit-task      (voice/text/NLP → full pipeline)
 * - orchestrator:get / list / cancel / pause / resume
 * - orchestrator:dashboard
 * - orchestrator:config:*
 * - orchestrator:templates
 * - orchestrator:subscribe
 */

import { ipcMain, BrowserWindow } from "electron";
import log from "electron-log";
import { getOrchestratorEngine } from "@/lib/agent_orchestrator_engine";

import type {
  OrchestrationId,
  OrchestrationStatus,
  SubmitTaskRequest,
  ExecutionConfig,
  CommunicationConfig,
  LongTermTaskConfig,
} from "@/types/agent_orchestrator";

const logger = log.scope("orchestrator_handlers");

export function registerAgentOrchestratorHandlers(): void {
  logger.info("Registering Agent Orchestrator IPC handlers");

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  ipcMain.handle("orchestrator:initialize", async () => {
    const engine = getOrchestratorEngine();
    await engine.initialize();
    return { success: true };
  });

  ipcMain.handle("orchestrator:shutdown", async () => {
    const engine = getOrchestratorEngine();
    await engine.shutdown();
    return { success: true };
  });

  ipcMain.handle("orchestrator:status", async () => {
    const engine = getOrchestratorEngine();
    return engine.getSystemStatus();
  });

  // ===========================================================================
  // CORE — SUBMIT TASK
  // ===========================================================================

  ipcMain.handle("orchestrator:submit-task", async (_event, request: SubmitTaskRequest) => {
    const engine = getOrchestratorEngine();
    return engine.submitTask(request);
  });

  // ===========================================================================
  // ORCHESTRATION CRUD
  // ===========================================================================

  ipcMain.handle("orchestrator:get", async (_event, id: string) => {
    const engine = getOrchestratorEngine();
    const orchestration = engine.getOrchestration(id as OrchestrationId);
    if (!orchestration) throw new Error(`Orchestration not found: ${id}`);
    return orchestration;
  });

  ipcMain.handle("orchestrator:list", async (_event, filter?: {
    status?: OrchestrationStatus;
    limit?: number;
  }) => {
    const engine = getOrchestratorEngine();
    return engine.listOrchestrations(filter);
  });

  ipcMain.handle("orchestrator:cancel", async (_event, id: string) => {
    const engine = getOrchestratorEngine();
    await engine.cancelOrchestration(id as OrchestrationId);
    return { success: true };
  });

  ipcMain.handle("orchestrator:pause", async (_event, id: string) => {
    const engine = getOrchestratorEngine();
    await engine.pauseOrchestration(id as OrchestrationId);
    return { success: true };
  });

  ipcMain.handle("orchestrator:resume", async (_event, id: string) => {
    const engine = getOrchestratorEngine();
    await engine.resumeOrchestration(id as OrchestrationId);
    return { success: true };
  });

  // ===========================================================================
  // DASHBOARD
  // ===========================================================================

  ipcMain.handle("orchestrator:dashboard", async () => {
    const engine = getOrchestratorEngine();
    return engine.getDashboard();
  });

  // ===========================================================================
  // META-AGENT
  // ===========================================================================

  ipcMain.handle("orchestrator:meta-agent", async () => {
    const engine = getOrchestratorEngine();
    return engine.getMetaAgent();
  });

  // ===========================================================================
  // TEMPLATES
  // ===========================================================================

  ipcMain.handle("orchestrator:templates", async () => {
    const engine = getOrchestratorEngine();
    return engine.getTemplates();
  });

  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  ipcMain.handle("orchestrator:config:execution:get", async () => {
    const engine = getOrchestratorEngine();
    return engine.getExecutionConfig();
  });

  ipcMain.handle("orchestrator:config:execution:update", async (_event, updates: Partial<ExecutionConfig>) => {
    const engine = getOrchestratorEngine();
    return engine.updateExecutionConfig(updates);
  });

  ipcMain.handle("orchestrator:config:communication:get", async () => {
    const engine = getOrchestratorEngine();
    return engine.getCommunicationConfig();
  });

  ipcMain.handle("orchestrator:config:communication:update", async (_event, updates: Partial<CommunicationConfig>) => {
    const engine = getOrchestratorEngine();
    return engine.updateCommunicationConfig(updates);
  });

  ipcMain.handle("orchestrator:config:longterm:get", async () => {
    const engine = getOrchestratorEngine();
    return engine.getLongTermConfig();
  });

  ipcMain.handle("orchestrator:config:longterm:update", async (_event, updates: Partial<LongTermTaskConfig>) => {
    const engine = getOrchestratorEngine();
    return engine.updateLongTermConfig(updates);
  });

  // ===========================================================================
  // EVENT FORWARDING
  // ===========================================================================

  ipcMain.handle("orchestrator:subscribe", async (event) => {
    const engine = getOrchestratorEngine();

    const forwardEvent = (data: any) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed()) {
          win.webContents.send("orchestrator:event", data);
        }
      } catch {
        // Window closed
      }
    };

    engine.on("event", forwardEvent);
    return { success: true };
  });

  logger.info("Agent Orchestrator IPC handlers registered");
}

export default registerAgentOrchestratorHandlers;
