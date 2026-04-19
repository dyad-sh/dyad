/**
 * A2A Protocol IPC Handlers
 * 
 * Wires the Agent-to-Agent protocol service to the Electron renderer.
 * Covers: registration, discovery, tasks, messaging, network stats.
 */

import { ipcMain } from "electron";
import log from "electron-log";
import { a2aProtocolService } from "@/lib/a2a_protocol_service";

const logger = log.scope("a2a-ipc");

export function registerA2AProtocolHandlers(): void {
  logger.info("Registering A2A protocol IPC handlers");

  // ==========================================================================
  // AGENT REGISTRATION
  // ==========================================================================

  ipcMain.handle("a2a:register-agent", async (_e, params: Record<string, unknown>) => {
    return a2aProtocolService.registerAgent(params as any);
  });

  ipcMain.handle("a2a:update-agent", async (_e, agentId: string, updates: Record<string, unknown>) => {
    return a2aProtocolService.updateAgent(agentId, updates as any);
  });

  ipcMain.handle("a2a:deregister-agent", async (_e, agentId: string) => {
    return a2aProtocolService.deregisterAgent(agentId);
  });

  ipcMain.handle("a2a:get-agent", async (_e, agentId: string) => {
    return a2aProtocolService.getAgent(agentId);
  });

  ipcMain.handle("a2a:get-my-agents", async () => {
    return a2aProtocolService.getMyAgents();
  });

  // ==========================================================================
  // DISCOVERY
  // ==========================================================================

  ipcMain.handle("a2a:search-agents", async (_e, query: Record<string, unknown>) => {
    return a2aProtocolService.searchAgents(query as any);
  });

  ipcMain.handle("a2a:find-by-capability", async (_e, category: string, maxPrice?: string) => {
    return a2aProtocolService.findAgentsByCapability(category as any, maxPrice);
  });

  // ==========================================================================
  // TASKS
  // ==========================================================================

  ipcMain.handle("a2a:create-task", async (_e, requesterId: string, executorId: string, capabilityId: string, input: Record<string, unknown>, options?: Record<string, unknown>) => {
    return a2aProtocolService.createTask(requesterId, executorId, capabilityId, input, options as any);
  });

  ipcMain.handle("a2a:accept-task", async (_e, taskId: string, agreedPrice?: string) => {
    return a2aProtocolService.acceptTask(taskId, agreedPrice);
  });

  ipcMain.handle("a2a:reject-task", async (_e, taskId: string, reason?: string) => {
    return a2aProtocolService.rejectTask(taskId, reason);
  });

  ipcMain.handle("a2a:update-task-progress", async (_e, taskId: string, progress: number, partialOutput?: Record<string, unknown>) => {
    return a2aProtocolService.updateTaskProgress(taskId, progress, partialOutput);
  });

  ipcMain.handle("a2a:complete-task", async (_e, taskId: string, output: Record<string, unknown>, usage?: Record<string, unknown>) => {
    return a2aProtocolService.completeTask(taskId, output, usage as any);
  });

  ipcMain.handle("a2a:fail-task", async (_e, taskId: string, reason: string) => {
    return a2aProtocolService.failTask(taskId, reason);
  });

  ipcMain.handle("a2a:get-tasks", async (_e, filters?: Record<string, unknown>) => {
    return a2aProtocolService.getTasks(filters as any);
  });

  ipcMain.handle("a2a:get-task", async (_e, taskId: string) => {
    return a2aProtocolService.getTask(taskId);
  });

  // ==========================================================================
  // MESSAGING
  // ==========================================================================

  ipcMain.handle("a2a:get-messages", async (_e, agentId: string, limit?: number) => {
    return a2aProtocolService.getMessages(agentId, limit);
  });

  ipcMain.handle("a2a:get-thread-messages", async (_e, threadId: string) => {
    return a2aProtocolService.getThreadMessages(threadId);
  });

  // ==========================================================================
  // NETWORK STATS
  // ==========================================================================

  ipcMain.handle("a2a:get-network-stats", async () => {
    return a2aProtocolService.getNetworkStats();
  });

  logger.info("A2A protocol IPC handlers registered (19 channels)");
}
