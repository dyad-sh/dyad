/**
 * OpenClaw IPC Handlers
 * Registers all IPC handlers for OpenClaw gateway integration
 */

import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from "electron";
import { v4 as uuidv4 } from "uuid";
import log from "electron-log";

import {
  getOpenClawGateway,
  OpenClawGatewayService,
} from "@/lib/openclaw_gateway_service";

import {
  getOpenClawDataPipeline,
  OpenClawDataPipelineService,
} from "@/lib/openclaw_data_pipeline";

import {
  getOpenClawSystemIntegration,
  OpenClawSystemIntegration,
} from "@/lib/openclaw_system_integration";

import { localAIHub } from "@/lib/local_ai_hub";

import type {
  OpenClawConfig,
  OpenClawAIProvider,
  OpenClawChatRequest,
  OpenClawAgentTask,
  ClaudeCodeConfig,
  ClaudeCodeTask,
  OpenClawEvent,
  OpenClawScrapingConfig,
  OpenClawImageGenConfig,
  OpenClawDataPipelineConfig,
  OpenClawDataRequest,
} from "@/types/openclaw_types";

const logger = log.scope("openclaw_handlers");

// Event subscription management
const eventSubscribers = new Map<number, () => void>();

export function registerOpenClawHandlers(): void {
  const gateway = getOpenClawGateway();

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  ipcMain.handle("openclaw:initialize", async () => {
    logger.info("Initializing OpenClaw...");
    await gateway.initialize();
    return { success: true };
  });

  ipcMain.handle("openclaw:shutdown", async () => {
    logger.info("Shutting down OpenClaw...");
    await gateway.shutdown();
    return { success: true };
  });

  // ===========================================================================
  // GATEWAY MANAGEMENT
  // ===========================================================================

  ipcMain.handle("openclaw:gateway:start", async () => {
    await gateway.startGateway();
    return { success: true };
  });

  ipcMain.handle("openclaw:gateway:stop", async () => {
    await gateway.stopGateway();
    return { success: true };
  });

  ipcMain.handle("openclaw:gateway:status", async () => {
    return gateway.getGatewayState();
  });

  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  ipcMain.handle("openclaw:config:get", async () => {
    return gateway.getConfig();
  });

  ipcMain.handle(
    "openclaw:config:update",
    async (_event: IpcMainInvokeEvent, updates: Partial<OpenClawConfig>) => {
      await gateway.updateConfig(updates);
      return { success: true };
    }
  );

  ipcMain.handle("openclaw:claude-code:config:get", async () => {
    return gateway.getClaudeCodeConfig();
  });

  ipcMain.handle(
    "openclaw:claude-code:config:update",
    async (_event: IpcMainInvokeEvent, updates: Partial<ClaudeCodeConfig>) => {
      await gateway.updateClaudeCodeConfig(updates);
      return { success: true };
    }
  );

  // ===========================================================================
  // PROVIDER MANAGEMENT
  // ===========================================================================

  ipcMain.handle("openclaw:provider:list", async () => {
    return gateway.getProviderStatus();
  });

  ipcMain.handle("openclaw:provider:health", async () => {
    return gateway.checkProviderHealth();
  });

  ipcMain.handle(
    "openclaw:provider:configure",
    async (
      _event: IpcMainInvokeEvent,
      params: { name: string; config: Partial<OpenClawAIProvider> }
    ) => {
      await gateway.configureProvider(params.name, params.config);
      return { success: true };
    }
  );

  ipcMain.handle(
    "openclaw:provider:remove",
    async (_event: IpcMainInvokeEvent, name: string) => {
      await gateway.removeProvider(name);
      return { success: true };
    }
  );

  ipcMain.handle(
    "openclaw:provider:set-api-key",
    async (
      _event: IpcMainInvokeEvent,
      params: { provider: string; apiKey: string }
    ) => {
      await gateway.configureProvider(params.provider, {
        apiKey: params.apiKey,
        enabled: true,
      });
      return { success: true };
    }
  );

  // ===========================================================================
  // CHAT & COMPLETION
  // ===========================================================================

  ipcMain.handle(
    "openclaw:chat",
    async (_event: IpcMainInvokeEvent, request: OpenClawChatRequest) => {
      return gateway.chat(request);
    }
  );

  ipcMain.handle(
    "openclaw:chat:stream",
    async (event: IpcMainInvokeEvent, request: OpenClawChatRequest) => {
      const requestId = uuidv4();
      
      // Set up streaming handler
      const streamHandler = (chunk: any) => {
        try {
          const win = BrowserWindow.fromWebContents(event.sender);
          if (win && !win.isDestroyed()) {
            win.webContents.send("openclaw:chat:stream-chunk", {
              requestId,
              chunk,
            });
          }
        } catch {
          // Window closed
        }
      };
      
      gateway.on("chat:stream", streamHandler);
      
      try {
        const response = await gateway.chat({ ...request, stream: true });
        gateway.off("chat:stream", streamHandler);
        return { requestId, response };
      } catch (error) {
        gateway.off("chat:stream", streamHandler);
        throw error;
      }
    }
  );

  // ===========================================================================
  // AGENT TASKS
  // ===========================================================================

  ipcMain.handle(
    "openclaw:agent:execute-task",
    async (_event: IpcMainInvokeEvent, task: OpenClawAgentTask) => {
      if (!task.id) {
        task.id = uuidv4();
      }
      return gateway.executeAgentTask(task);
    }
  );

  ipcMain.handle(
    "openclaw:agent:execute-with-n8n",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        task: OpenClawAgentTask;
        workflowId?: string;
        triggerWorkflow?: boolean;
      }
    ) => {
      const { task, workflowId, triggerWorkflow } = params;
      
      if (!task.id) {
        task.id = uuidv4();
      }
      
      // Execute the agent task
      const result = await gateway.executeAgentTask(task);
      
      // Optionally trigger n8n workflow with results
      if (triggerWorkflow && workflowId) {
        await gateway.triggerN8nWorkflow(workflowId, {
          taskId: task.id,
          taskType: task.type,
          result,
        });
      }
      
      return result;
    }
  );

  // ===========================================================================
  // CLAUDE CODE
  // ===========================================================================

  ipcMain.handle(
    "openclaw:claude-code:execute",
    async (_event: IpcMainInvokeEvent, task: ClaudeCodeTask) => {
      if (!task.id) {
        task.id = uuidv4();
      }
      return gateway.executeClaudeCodeTask(task);
    }
  );

  ipcMain.handle(
    "openclaw:claude-code:batch",
    async (_event: IpcMainInvokeEvent, tasks: ClaudeCodeTask[]) => {
      const results = [];
      for (const task of tasks) {
        if (!task.id) {
          task.id = uuidv4();
        }
        const result = await gateway.executeClaudeCodeTask(task);
        results.push(result);
        
        // Stop on error unless in batch mode
        if (!result.success) {
          break;
        }
      }
      return results;
    }
  );

  // ===========================================================================
  // N8N INTEGRATION
  // ===========================================================================

  ipcMain.handle(
    "openclaw:n8n:trigger-workflow",
    async (
      _event: IpcMainInvokeEvent,
      params: { workflowId: string; data: unknown }
    ) => {
      await gateway.triggerN8nWorkflow(params.workflowId, params.data);
      return { success: true };
    }
  );

  ipcMain.handle(
    "openclaw:n8n:create-agent-workflow",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        name: string;
        agentType: string;
        objective: string;
        triggerType: "webhook" | "schedule" | "manual";
        schedule?: string;
      }
    ) => {
      // Create an n8n workflow that executes OpenClaw agent tasks
      const workflowTemplate = {
        name: params.name,
        nodes: [
          {
            id: "trigger",
            name: params.triggerType === "webhook" ? "Webhook Trigger" : 
                  params.triggerType === "schedule" ? "Schedule Trigger" : "Manual Trigger",
            type: params.triggerType === "webhook" ? "n8n-nodes-base.webhook" :
                  params.triggerType === "schedule" ? "n8n-nodes-base.scheduleTrigger" : 
                  "n8n-nodes-base.manualTrigger",
            position: [0, 0],
            parameters: params.triggerType === "schedule" && params.schedule ? {
              rule: { interval: [{ field: "hours", hoursInterval: parseInt(params.schedule) || 24 }] },
            } : {},
          },
          {
            id: "OpenClaw-agent",
            name: "OpenClaw Agent",
            type: "n8n-nodes-base.httpRequest",
            position: [200, 0],
            parameters: {
              method: "POST",
              url: "http://localhost:5679/api/OpenClaw/agent",
              body: JSON.stringify({
                type: params.agentType,
                objective: params.objective,
                input: "={{$json}}",
              }),
            },
          },
        ],
        connections: {
          trigger: { main: [[{ node: "OpenClaw-agent", type: "main", index: 0 }]] },
        },
      };
      
      // Emit event for n8n handlers to create the workflow
      gateway.emit("n8n:create-workflow", workflowTemplate);
      
      return { success: true, workflow: workflowTemplate };
    }
  );

  // ===========================================================================
  // AUTONOMOUS CREATION INTEGRATION
  // ===========================================================================

  ipcMain.handle(
    "openclaw:autonomous:create-app",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        name: string;
        description: string;
        features: string[];
        techStack?: string[];
        useLocal?: boolean;
      }
    ) => {
      const task: OpenClawAgentTask = {
        id: uuidv4(),
        type: "build",
        objective: `Create a new application called "${params.name}".
        
Description: ${params.description}

Features to implement:
${params.features.map((f, i) => `${i + 1}. ${f}`).join("\n")}

${params.techStack?.length ? `Tech stack: ${params.techStack.join(", ")}` : ""}

Please provide:
1. Project structure
2. Main files and their content
3. Dependencies to install
4. Setup instructions`,
        constraints: [
          "Follow best practices",
          "Include error handling",
          "Add comments for complex logic",
        ],
        preferLocal: params.useLocal ?? true,
      };
      
      return gateway.executeAgentTask(task);
    }
  );

  ipcMain.handle(
    "openclaw:autonomous:refactor-code",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        code: string;
        language: string;
        instructions: string;
        useLocal?: boolean;
      }
    ) => {
      const task: OpenClawAgentTask = {
        id: uuidv4(),
        type: "optimize",
        objective: `Refactor the following ${params.language} code:

\`\`\`${params.language}
${params.code}
\`\`\`

Instructions: ${params.instructions}

Please provide the refactored code with explanations for each change.`,
        preferLocal: params.useLocal ?? true,
      };
      
      return gateway.executeAgentTask(task);
    }
  );

  ipcMain.handle(
    "openclaw:autonomous:analyze-codebase",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        files: Array<{ path: string; content: string }>;
        analysisType: "security" | "performance" | "quality" | "all";
        useLocal?: boolean;
      }
    ) => {
      const fileList = params.files
        .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
        .join("\n\n");
      
      const task: OpenClawAgentTask = {
        id: uuidv4(),
        type: "analyze",
        objective: `Analyze the following codebase for ${params.analysisType === "all" ? "security, performance, and code quality" : params.analysisType} issues:

${fileList}

Please provide:
1. Summary of findings
2. Specific issues with file paths and line numbers
3. Recommendations for improvement
4. Priority rating for each issue`,
        preferLocal: params.useLocal ?? false, // Complex analysis benefits from cloud
      };
      
      return gateway.executeAgentTask(task);
    }
  );

  // ===========================================================================
  // EVENTS
  // ===========================================================================

  ipcMain.handle("openclaw:subscribe", async (event: IpcMainInvokeEvent) => {
    const webContentsId = event.sender.id;

    // Remove existing subscription
    const existingUnsubscribe = eventSubscribers.get(webContentsId);
    if (existingUnsubscribe) {
      existingUnsubscribe();
    }

    // Set up event listener
    const listener = (OpenClawEvent: OpenClawEvent) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed()) {
          win.webContents.send("openclaw:event", OpenClawEvent);
        }
      } catch {
        // Window closed
      }
    };

    gateway.on("event", listener);

    // Store cleanup function
    eventSubscribers.set(webContentsId, () => {
      gateway.off("event", listener);
    });

    return { success: true };
  });

  ipcMain.handle("openclaw:unsubscribe", async (event: IpcMainInvokeEvent) => {
    const webContentsId = event.sender.id;
    const unsubscribe = eventSubscribers.get(webContentsId);

    if (unsubscribe) {
      unsubscribe();
      eventSubscribers.delete(webContentsId);
    }

    return { success: true };
  });

  // ===========================================================================
  // QUICK ACTIONS
  // ===========================================================================

  ipcMain.handle(
    "openclaw:quick:generate-code",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        prompt: string;
        language?: string;
        context?: string;
        useLocal?: boolean;
      }
    ) => {
      const response = await gateway.chat({
        messages: [
          {
            role: "system",
            content: `You are an expert programmer. Generate clean, well-documented code.
${params.language ? `Use ${params.language}.` : ""}
${params.context ? `Context: ${params.context}` : ""}`,
          },
          {
            role: "user",
            content: params.prompt,
          },
        ],
        capabilities: ["code"],
      });

      return {
        code: response.message.content,
        provider: response.provider,
        model: response.model,
        localProcessed: response.localProcessed,
      };
    }
  );

  ipcMain.handle(
    "openclaw:quick:explain-code",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        code: string;
        language?: string;
        detail?: "brief" | "detailed" | "beginner";
      }
    ) => {
      const detailPrompt = {
        brief: "Give a brief explanation.",
        detailed: "Explain in detail including the logic and patterns used.",
        beginner: "Explain as if to a beginner programmer.",
      };

      const response = await gateway.chat({
        messages: [
          {
            role: "system",
            content: "You are an expert programmer who explains code clearly.",
          },
          {
            role: "user",
            content: `Explain this ${params.language || ""} code:

\`\`\`${params.language || ""}
${params.code}
\`\`\`

${detailPrompt[params.detail || "detailed"]}`,
          },
        ],
        capabilities: ["code", "analysis"],
      });

      return {
        explanation: response.message.content,
        provider: response.provider,
        localProcessed: response.localProcessed,
      };
    }
  );

  ipcMain.handle(
    "openclaw:quick:fix-error",
    async (
      _event: IpcMainInvokeEvent,
      params: {
        code: string;
        error: string;
        language?: string;
      }
    ) => {
      const response = await gateway.chat({
        messages: [
          {
            role: "system",
            content: "You are an expert debugger. Fix errors and explain the solution.",
          },
          {
            role: "user",
            content: `Fix this ${params.language || ""} code error:

Code:
\`\`\`${params.language || ""}
${params.code}
\`\`\`

Error:
${params.error}

Provide the fixed code and explain what was wrong.`,
          },
        ],
        capabilities: ["code", "reasoning"],
      });

      return {
        fix: response.message.content,
        provider: response.provider,
        localProcessed: response.localProcessed,
      };
    }
  );

  // ===========================================================================
  // DATA PIPELINE - SCRAPING
  // ===========================================================================

  const dataPipeline = getOpenClawDataPipeline();

  ipcMain.handle("openclaw:data:initialize", async () => {
    logger.info("Initializing OpenClaw Data Pipeline...");
    await dataPipeline.initialize();
    return { success: true, providers: dataPipeline.getAvailableProviders() };
  });

  ipcMain.handle(
    "openclaw:data:scrape",
    async (_event: IpcMainInvokeEvent, config: OpenClawScrapingConfig) => {
      logger.info("Starting AI-enhanced scraping", { urls: config.urls.length });
      return await dataPipeline.scrape(config);
    }
  );

  ipcMain.handle(
    "openclaw:data:scrape:single",
    async (_event: IpcMainInvokeEvent, url: string, options?: Partial<OpenClawScrapingConfig>) => {
      logger.info("Scraping single URL", { url });
      const config: OpenClawScrapingConfig = {
        urls: [url],
        type: "web",
        ...options,
      };
      const results = await dataPipeline.scrape(config);
      return results[0];
    }
  );

  // ===========================================================================
  // DATA PIPELINE - IMAGE GENERATION
  // ===========================================================================

  ipcMain.handle(
    "openclaw:data:image:generate",
    async (_event: IpcMainInvokeEvent, config: OpenClawImageGenConfig) => {
      logger.info("Generating image with AI enhancement", { 
        prompt: config.prompt.slice(0, 50),
        aiEnhancement: config.aiPromptEnhancement?.enabled,
      });
      return await dataPipeline.generateImage(config);
    }
  );

  ipcMain.handle(
    "openclaw:data:image:enhance-prompt",
    async (
      _event: IpcMainInvokeEvent,
      prompt: string,
      options?: { style?: string; preferLocal?: boolean }
    ) => {
      logger.info("Enhancing image prompt with AI", { prompt: prompt.slice(0, 50) });
      
      // Use the gateway for quick prompt enhancement
      const response = await gateway.chat({
        messages: [
          {
            role: "system",
            content: `You are an expert at crafting prompts for AI image generation models like Stable Diffusion.
Enhance the user's prompt to produce higher quality, more detailed images.
${options?.style ? `Apply this style: ${options.style}` : ""}
Add quality enhancing terms like 'highly detailed', '8k', 'professional'.
Keep the enhanced prompt under 200 words. Respond with ONLY the enhanced prompt.`,
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        preferLocal: options?.preferLocal ?? true,
        capabilities: ["creative"],
      });

      return {
        originalPrompt: prompt,
        enhancedPrompt: response.message.content.trim().replace(/^["']|["']$/g, ""),
        provider: response.provider,
        localProcessed: response.localProcessed,
      };
    }
  );

  // ===========================================================================
  // DATA PIPELINE - PIPELINE ORCHESTRATION
  // ===========================================================================

  ipcMain.handle(
    "openclaw:data:pipeline:run",
    async (_event: IpcMainInvokeEvent, config: OpenClawDataPipelineConfig) => {
      logger.info("Running data pipeline", { name: config.name, sources: config.sources.length });
      return await dataPipeline.runPipeline(config);
    }
  );

  ipcMain.handle(
    "openclaw:data:request",
    async (_event: IpcMainInvokeEvent, request: OpenClawDataRequest) => {
      logger.info("Handling unified data request", { type: request.type, requestId: request.requestId });
      return await dataPipeline.handleDataRequest(request);
    }
  );

  // ===========================================================================
  // DATA PIPELINE - JOB MANAGEMENT
  // ===========================================================================

  ipcMain.handle("openclaw:data:jobs:list", async () => {
    return dataPipeline.getActiveJobs();
  });

  ipcMain.handle(
    "openclaw:data:jobs:get",
    async (_event: IpcMainInvokeEvent, jobId: string) => {
      return dataPipeline.getJob(jobId);
    }
  );

  ipcMain.handle(
    "openclaw:data:jobs:cancel",
    async (_event: IpcMainInvokeEvent, jobId: string) => {
      return await dataPipeline.cancelJob(jobId);
    }
  );

  // ===========================================================================
  // DATA PIPELINE - EVENTS
  // ===========================================================================

  ipcMain.handle(
    "openclaw:data:events:subscribe",
    async (event: IpcMainInvokeEvent) => {
      const webContents = event.sender;
      const windowId = webContents.id;

      // Unsubscribe existing listener if any
      if (eventSubscribers.has(windowId)) {
        const unsub = eventSubscribers.get(windowId);
        unsub?.();
      }

      // Create event forwarder for data pipeline events
      const forwardEvent = (eventData: { jobId: string; [key: string]: unknown }) => {
        if (!webContents.isDestroyed()) {
          webContents.send("openclaw:data:event", eventData);
        }
      };

      // Subscribe to data pipeline events
      dataPipeline.on("job:started", forwardEvent);
      dataPipeline.on("job:progress", forwardEvent);
      dataPipeline.on("job:completed", forwardEvent);
      dataPipeline.on("job:failed", forwardEvent);
      dataPipeline.on("job:cancelled", forwardEvent);
      dataPipeline.on("pipeline:started", forwardEvent);
      dataPipeline.on("pipeline:completed", forwardEvent);
      dataPipeline.on("pipeline:failed", forwardEvent);

      // Store cleanup function
      const unsubscribe = () => {
        dataPipeline.off("job:started", forwardEvent);
        dataPipeline.off("job:progress", forwardEvent);
        dataPipeline.off("job:completed", forwardEvent);
        dataPipeline.off("job:failed", forwardEvent);
        dataPipeline.off("job:cancelled", forwardEvent);
        dataPipeline.off("pipeline:started", forwardEvent);
        dataPipeline.off("pipeline:completed", forwardEvent);
        dataPipeline.off("pipeline:failed", forwardEvent);
        eventSubscribers.delete(windowId);
      };

      eventSubscribers.set(windowId, unsubscribe);

      // Cleanup when window closes
      webContents.once("destroyed", () => {
        unsubscribe();
      });

      return { success: true };
    }
  );

  ipcMain.handle(
    "openclaw:data:events:unsubscribe",
    async (event: IpcMainInvokeEvent) => {
      const windowId = event.sender.id;
      const unsub = eventSubscribers.get(windowId);
      if (unsub) {
        unsub();
        return { success: true };
      }
      return { success: false };
    }
  );

  // ===========================================================================
  // SYSTEM INTEGRATION
  // ===========================================================================

  const systemIntegration = getOpenClawSystemIntegration();

  ipcMain.handle("openclaw:system:initialize", async () => {
    logger.info("Initializing OpenClaw system integration...");
    await systemIntegration.initialize();
    
    // Also register LocalAIHub with OpenClaw
    await localAIHub.registerWithOpenClaw();
    
    return { success: true };
  });

  ipcMain.handle("openclaw:system:config:get", async () => {
    return systemIntegration.getConfig();
  });

  ipcMain.handle(
    "openclaw:system:config:update",
    async (_event: IpcMainInvokeEvent, updates: Record<string, unknown>) => {
      systemIntegration.updateConfig(updates as any);
      return { success: true };
    }
  );

  ipcMain.handle("openclaw:system:stats", async () => {
    return systemIntegration.getStats();
  });

  ipcMain.handle(
    "openclaw:system:history",
    async (_event: IpcMainInvokeEvent, limit?: number) => {
      return systemIntegration.getOperationHistory(limit || 100);
    }
  );

  ipcMain.handle(
    "openclaw:system:execute",
    async (_event: IpcMainInvokeEvent, request: {
      type: string;
      source: string;
      prompt?: string;
      messages?: Array<{ role: string; content: string }>;
      systemPrompt?: string;
      capabilities?: string[];
      metadata?: Record<string, unknown>;
    }) => {
      const response = await systemIntegration.execute({
        id: uuidv4(),
        type: request.type as any,
        source: request.source as any,
        prompt: request.prompt,
        messages: request.messages,
        systemPrompt: request.systemPrompt,
        capabilities: request.capabilities as any,
        metadata: request.metadata,
        timestamp: Date.now(),
      });
      return response;
    }
  );

  ipcMain.handle(
    "openclaw:system:chat",
    async (_event: IpcMainInvokeEvent, message: string, options?: {
      systemPrompt?: string;
      preferLocal?: boolean;
    }) => {
      const response = await systemIntegration.chat(message, options);
      return { success: true, content: response };
    }
  );

  ipcMain.handle(
    "openclaw:system:agent-inference",
    async (_event: IpcMainInvokeEvent, agentId: string, prompt: string, options?: {
      systemPrompt?: string;
      model?: string;
      temperature?: number;
    }) => {
      const response = await systemIntegration.agentInference(agentId, prompt, options);
      return { success: true, content: response };
    }
  );

  // ===========================================================================
  // LOCAL AI HUB INTEGRATION
  // ===========================================================================

  ipcMain.handle("openclaw:local-hub:status", async () => {
    return localAIHub.getAllProviderStatus();
  });

  ipcMain.handle(
    "openclaw:local-hub:chat",
    async (_event: IpcMainInvokeEvent, request: {
      prompt: string;
      systemPrompt?: string;
      messages?: Array<{ role: string; content: string }>;
      modelConfig: {
        modelId: string;
        provider?: string;
        options?: Record<string, unknown>;
      };
    }) => {
      // Convert messages to proper type
      const typedMessages = request.messages?.map(m => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      }));
      
      // Use OpenClaw-integrated chat (local first, cloud fallback)
      const response = await localAIHub.OpenClawChat({
        id: uuidv4(),
        prompt: request.prompt,
        systemPrompt: request.systemPrompt,
        messages: typedMessages,
        modelConfig: request.modelConfig as any,
        timestamp: Date.now(),
      });
      return response;
    }
  );

  ipcMain.handle("openclaw:local-hub:combined-stats", async () => {
    return localAIHub.getCombinedStats();
  });

  // ===========================================================================
  // SYSTEM EVENTS SUBSCRIPTION
  // ===========================================================================

  ipcMain.handle(
    "openclaw:system:events:subscribe",
    async (event: IpcMainInvokeEvent) => {
      const webContents = event.sender;
      const windowId = webContents.id;

      // Create event forwarder for system integration events
      const forwardEvent = (eventName: string) => (eventData: unknown) => {
        if (!webContents.isDestroyed()) {
          webContents.send("openclaw:system:event", { type: eventName, data: eventData });
        }
      };

      // Subscribe to system integration events
      const operationCompleted = forwardEvent("operation:completed");
      const operationFailed = forwardEvent("operation:failed");
      const providerSwitched = forwardEvent("provider:switched");
      const providerError = forwardEvent("provider:error");

      systemIntegration.on("operation:completed", operationCompleted);
      systemIntegration.on("operation:failed", operationFailed);
      systemIntegration.on("provider:switched", providerSwitched);
      systemIntegration.on("provider:error", providerError);

      // Store cleanup function with unique key
      const systemKey = windowId + 1000000; // Offset to avoid collision
      const unsubscribe = () => {
        systemIntegration.off("operation:completed", operationCompleted);
        systemIntegration.off("operation:failed", operationFailed);
        systemIntegration.off("provider:switched", providerSwitched);
        systemIntegration.off("provider:error", providerError);
        eventSubscribers.delete(systemKey);
      };

      eventSubscribers.set(systemKey, unsubscribe);

      // Cleanup when window closes
      webContents.once("destroyed", () => {
        unsubscribe();
      });

      return { success: true };
    }
  );

  logger.info("OpenClaw IPC handlers registered");
}
