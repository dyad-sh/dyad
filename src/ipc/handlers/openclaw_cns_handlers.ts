/**
 * OpenClaw CNS IPC Handlers
 * 
 * IPC handlers for the OpenClaw Central Nervous System.
 * Exposes Ollama, n8n, and unified AI operations to the renderer.
 * 
 * 🦞 EXFOLIATE! EXFOLIATE!
 */

import { ipcMain, BrowserWindow } from "electron";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";

import { getOpenClawCNS, type CNSConfig, type AIRequest } from "@/lib/openclaw_cns";
import { getOpenClawOllamaBridge } from "@/lib/openclaw_ollama_bridge";
import { getOpenClawN8nBridge } from "@/lib/openclaw_n8n_bridge";

const logger = log.scope("openclaw_cns_ipc");

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function notifyRenderer(channel: string, data: unknown): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send(channel, data);
  }
}

// =============================================================================
// REGISTER HANDLERS
// =============================================================================

export function registerOpenClawCNSHandlers(): void {
  logger.info("🦞 Registering OpenClaw CNS IPC handlers");

  // ===========================================================================
  // CNS CORE
  // ===========================================================================

  ipcMain.handle("cns:initialize", async (_event, config?: Partial<CNSConfig>) => {
    try {
      const cns = getOpenClawCNS();
      await cns.initialize(config);
      return { success: true, status: cns.getStatus() };
    } catch (error) {
      logger.error("CNS initialize failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:shutdown", async () => {
    try {
      const cns = getOpenClawCNS();
      await cns.shutdown();
      return { success: true };
    } catch (error) {
      logger.error("CNS shutdown failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:status", async () => {
    try {
      const cns = getOpenClawCNS();
      return cns.getStatus();
    } catch (error) {
      logger.error("CNS status failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:config:get", async () => {
    const cns = getOpenClawCNS();
    return cns.getConfig();
  });

  ipcMain.handle("cns:config:update", async (_event, config: Partial<CNSConfig>) => {
    try {
      const cns = getOpenClawCNS();
      cns.updateConfig(config);
      return { success: true, config: cns.getConfig() };
    } catch (error) {
      logger.error("CNS config update failed:", error);
      throw error;
    }
  });

  // ===========================================================================
  // UNIFIED AI INTERFACE
  // ===========================================================================

  ipcMain.handle("cns:process", async (_event, request: AIRequest) => {
    try {
      const cns = getOpenClawCNS();
      return await cns.process(request);
    } catch (error) {
      logger.error("CNS process failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:chat", async (_event, args: {
    message: string;
    systemPrompt?: string;
    preferLocal?: boolean;
    channel?: string;
  }) => {
    try {
      const cns = getOpenClawCNS();
      const response = await cns.chat(args.message, {
        systemPrompt: args.systemPrompt,
        preferLocal: args.preferLocal,
        channel: args.channel,
      });
      return { success: true, content: response };
    } catch (error) {
      logger.error("CNS chat failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:agent-task", async (_event, args: {
    agentId: string;
    task: string;
    model?: string;
    preferLocal?: boolean;
  }) => {
    try {
      const cns = getOpenClawCNS();
      const response = await cns.agentTask(args.agentId, args.task, {
        model: args.model,
        preferLocal: args.preferLocal,
      });
      return { success: true, content: response };
    } catch (error) {
      logger.error("CNS agent task failed:", error);
      throw error;
    }
  });

  // ===========================================================================
  // OLLAMA BRIDGE
  // ===========================================================================

  ipcMain.handle("cns:ollama:status", async () => {
    try {
      const bridge = getOpenClawOllamaBridge();
      return bridge.getStatus();
    } catch (error) {
      logger.error("Ollama status failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:ollama:health", async () => {
    try {
      const bridge = getOpenClawOllamaBridge();
      return { available: await bridge.checkOllamaHealth() };
    } catch (error) {
      logger.error("Ollama health check failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:ollama:models", async () => {
    try {
      const bridge = getOpenClawOllamaBridge();
      return { models: await bridge.refreshModels() };
    } catch (error) {
      logger.error("Ollama models failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:ollama:inference", async (_event, args: {
    model: string;
    messages?: Array<{ role: string; content: string }>;
    prompt?: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
  }) => {
    try {
      const bridge = getOpenClawOllamaBridge();
      return await bridge.inference({
        model: args.model,
        messages: args.messages as any,
        prompt: args.prompt,
        systemPrompt: args.systemPrompt,
        temperature: args.temperature,
        maxTokens: args.maxTokens,
      });
    } catch (error) {
      logger.error("Ollama inference failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:ollama:embed", async (_event, args: {
    model: string;
    input: string | string[];
  }) => {
    try {
      const bridge = getOpenClawOllamaBridge();
      return await bridge.embed(args.model, args.input);
    } catch (error) {
      logger.error("Ollama embed failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:ollama:recommend-model", async (_event, task: {
    type: string;
    complexity?: number;
    inputLength?: number;
    requiresVision?: boolean;
    preferQuality?: boolean;
    preferSpeed?: boolean;
  }) => {
    try {
      const bridge = getOpenClawOllamaBridge();
      return bridge.recommendModel(task as any);
    } catch (error) {
      logger.error("Ollama recommend model failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:ollama:performance", async (_event, model?: string) => {
    try {
      const bridge = getOpenClawOllamaBridge();
      if (model) {
        return { performance: bridge.getModelPerformance(model) };
      }
      return { performance: bridge.getAllModelPerformance() };
    } catch (error) {
      logger.error("Ollama performance failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:ollama:config:update", async (_event, config: any) => {
    try {
      const bridge = getOpenClawOllamaBridge();
      bridge.updateConfig(config);
      return { success: true, config: bridge.getConfig() };
    } catch (error) {
      logger.error("Ollama config update failed:", error);
      throw error;
    }
  });

  // ===========================================================================
  // N8N BRIDGE
  // ===========================================================================

  ipcMain.handle("cns:n8n:status", async () => {
    try {
      const bridge = getOpenClawN8nBridge();
      return bridge.getStatus();
    } catch (error) {
      logger.error("N8n status failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:n8n:connections", async () => {
    try {
      const bridge = getOpenClawN8nBridge();
      return { connections: bridge.getAllConnections() };
    } catch (error) {
      logger.error("N8n connections failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:n8n:add-connection", async (_event, connection: {
    id: string;
    name: string;
    baseUrl: string;
    apiKey?: string;
  }) => {
    try {
      const bridge = getOpenClawN8nBridge();
      return await bridge.addConnection(connection);
    } catch (error) {
      logger.error("N8n add connection failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:n8n:remove-connection", async (_event, connectionId: string) => {
    try {
      const bridge = getOpenClawN8nBridge();
      await bridge.removeConnection(connectionId);
      return { success: true };
    } catch (error) {
      logger.error("N8n remove connection failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:n8n:test-connection", async (_event, connectionId: string) => {
    try {
      const bridge = getOpenClawN8nBridge();
      const connection = bridge.getConnection(connectionId);
      if (!connection) {
        throw new Error("Connection not found");
      }
      const isValid = await bridge.testConnection(connection);
      return { success: isValid };
    } catch (error) {
      logger.error("N8n test connection failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:n8n:workflows", async (_event, connectionId?: string) => {
    try {
      const bridge = getOpenClawN8nBridge();
      return { workflows: await bridge.listWorkflows(connectionId) };
    } catch (error) {
      logger.error("N8n list workflows failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:n8n:workflow", async (_event, args: {
    workflowId: string;
    connectionId?: string;
  }) => {
    try {
      const bridge = getOpenClawN8nBridge();
      return await bridge.getWorkflow(args.workflowId, args.connectionId);
    } catch (error) {
      logger.error("N8n get workflow failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:n8n:trigger-workflow", async (_event, args: {
    workflowId: string;
    connectionId?: string;
    data?: Record<string, unknown>;
    waitForCompletion?: boolean;
    timeout?: number;
  }) => {
    try {
      const bridge = getOpenClawN8nBridge();
      return await bridge.triggerWorkflow(args);
    } catch (error) {
      logger.error("N8n trigger workflow failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:n8n:register-webhook", async (_event, config: {
    eventPattern: string;
    workflowId: string;
    connectionId: string;
  }) => {
    try {
      const bridge = getOpenClawN8nBridge();
      const id = bridge.registerWebhook(config);
      return { success: true, webhookId: id };
    } catch (error) {
      logger.error("N8n register webhook failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:n8n:unregister-webhook", async (_event, webhookId: string) => {
    try {
      const bridge = getOpenClawN8nBridge();
      bridge.unregisterWebhook(webhookId);
      return { success: true };
    } catch (error) {
      logger.error("N8n unregister webhook failed:", error);
      throw error;
    }
  });

  ipcMain.handle("cns:n8n:config:update", async (_event, config: any) => {
    try {
      const bridge = getOpenClawN8nBridge();
      bridge.updateConfig(config);
      return { success: true, config: bridge.getConfig() };
    } catch (error) {
      logger.error("N8n config update failed:", error);
      throw error;
    }
  });

  // ===========================================================================
  // EVENT FORWARDING
  // ===========================================================================

  setupCNSEventForwarding();

  logger.info("🦞 OpenClaw CNS IPC handlers registered");
}

function setupCNSEventForwarding(): void {
  const cns = getOpenClawCNS();
  const ollamaBridge = getOpenClawOllamaBridge();
  const n8nBridge = getOpenClawN8nBridge();

  // CNS events
  cns.on("initialized", (data) => notifyRenderer("cns:event:initialized", data));
  cns.on("shutdown", () => notifyRenderer("cns:event:shutdown", {}));
  cns.on("request:start", (data) => notifyRenderer("cns:event:request:start", data));
  cns.on("request:complete", (data) => notifyRenderer("cns:event:request:complete", data));
  cns.on("request:error", (data) => notifyRenderer("cns:event:request:error", data));
  cns.on("message:received", (data) => notifyRenderer("cns:event:message:received", data));
  cns.on("agent:completed", (data) => notifyRenderer("cns:event:agent:completed", data));
  cns.on("workflow:triggering", (data) => notifyRenderer("cns:event:workflow:triggering", data));
  cns.on("workflow:failed", (data) => notifyRenderer("cns:event:workflow:failed", data));

  // Ollama events
  ollamaBridge.on("ollama:connected", () => notifyRenderer("cns:event:ollama:connected", {}));
  ollamaBridge.on("ollama:disconnected", () => notifyRenderer("cns:event:ollama:disconnected", {}));
  ollamaBridge.on("inference:start", (data) => notifyRenderer("cns:event:ollama:inference:start", data));
  ollamaBridge.on("inference:complete", (data) => notifyRenderer("cns:event:ollama:inference:complete", data));
  ollamaBridge.on("inference:chunk", (data) => notifyRenderer("cns:event:ollama:inference:chunk", data));
  ollamaBridge.on("inference:error", (data) => notifyRenderer("cns:event:ollama:inference:error", data));
  ollamaBridge.on("models:refreshed", (data) => notifyRenderer("cns:event:ollama:models:refreshed", data));

  // N8n events
  n8nBridge.on("connection:added", (data) => notifyRenderer("cns:event:n8n:connection:added", data));
  n8nBridge.on("connection:removed", (data) => notifyRenderer("cns:event:n8n:connection:removed", data));
  n8nBridge.on("webhook:registered", (data) => notifyRenderer("cns:event:n8n:webhook:registered", data));
  n8nBridge.on("webhook:unregistered", (data) => notifyRenderer("cns:event:n8n:webhook:unregistered", data));
  n8nBridge.on("event:triggered", (data) => notifyRenderer("cns:event:n8n:event:triggered", data));
  n8nBridge.on("event:failed", (data) => notifyRenderer("cns:event:n8n:event:failed", data));
}

export default registerOpenClawCNSHandlers;
