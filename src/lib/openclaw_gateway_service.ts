/**
 * OpenClaw Gateway Service
 * Local WebSocket gateway that connects JoyCreate to AI providers
 * and integrates with n8n workflows and autonomous agent systems
 */

import { EventEmitter } from "node:events";
import { app } from "electron";
import * as path from "node:path";
import * as fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";
import log from "electron-log";
import WebSocket, { WebSocketServer } from "ws";
import http from "node:http";

import type {
  OpenClawConfig,
  OpenClawGatewayState,
  OpenClawGatewayStatus,
  OpenClawMessage,
  OpenClawMessageType,
  OpenClawChatRequest,
  OpenClawChatResponse,
  OpenClawChatMessage,
  OpenClawStreamChunk,
  OpenClawAIProvider,
  OpenClawAgentTask,
  OpenClawAgentTaskResult,
  OpenClawEvent,
  OpenClawEventType,
  OpenClawCapability,
  ClaudeCodeConfig,
  ClaudeCodeTask,
  ClaudeCodeResult,
} from "@/types/openclaw_types";

import {
  DEFAULT_OPENCLAW_CONFIG,
  DEFAULT_CLAUDE_CODE_CONFIG,
} from "@/types/openclaw_types";

const logger = log.scope("openclaw_gateway");

// =============================================================================
// GATEWAY SERVICE
// =============================================================================

export class OpenClawGatewayService extends EventEmitter {
  private static instance: OpenClawGatewayService;
  
  private config: OpenClawConfig;
  private claudeCodeConfig: ClaudeCodeConfig;
  private state: OpenClawGatewayState;
  private server: WebSocketServer | null = null;
  private httpServer: http.Server | null = null;
  private clients: Map<string, WebSocket> = new Map();
  private pendingRequests: Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private providerHealthCache: Map<string, { healthy: boolean; lastCheck: number }> = new Map();
  
  private constructor() {
    super();
    this.config = { ...DEFAULT_OPENCLAW_CONFIG };
    this.claudeCodeConfig = { ...DEFAULT_CLAUDE_CODE_CONFIG };
    this.state = {
      status: "disconnected",
      reconnectAttempts: 0,
      activePlugins: [],
      connectedClients: 0,
    };
  }
  
  static getInstance(): OpenClawGatewayService {
    if (!OpenClawGatewayService.instance) {
      OpenClawGatewayService.instance = new OpenClawGatewayService();
    }
    return OpenClawGatewayService.instance;
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(): Promise<void> {
    logger.info("Initializing OpenClaw Gateway Service...");
    
    await this.loadConfig();
    
    if (this.config.gateway.enabled) {
      await this.startGateway();
    }
    
    // Check provider health
    await this.checkProviderHealth();
    
    logger.info("OpenClaw Gateway Service initialized");
  }
  
  async shutdown(): Promise<void> {
    logger.info("Shutting down OpenClaw Gateway Service...");
    
    await this.stopGateway();
    await this.saveConfig();
    
    this.removeAllListeners();
    logger.info("OpenClaw Gateway Service shut down");
  }
  
  // ===========================================================================
  // CONFIG MANAGEMENT
  // ===========================================================================
  
  private getConfigPath(): string {
    return path.join(app.getPath("userData"), "OpenClaw", "OpenClaw.json");
  }
  
  private getClaudeCodeConfigPath(): string {
    return path.join(app.getPath("userData"), "OpenClaw", "claude-code.json");
  }
  
  async loadConfig(): Promise<void> {
    try {
      const configPath = this.getConfigPath();
      if (await fs.pathExists(configPath)) {
        const saved = await fs.readJson(configPath);
        this.config = { ...DEFAULT_OPENCLAW_CONFIG, ...saved };
      }
      
      const claudeCodePath = this.getClaudeCodeConfigPath();
      if (await fs.pathExists(claudeCodePath)) {
        const saved = await fs.readJson(claudeCodePath);
        this.claudeCodeConfig = { ...DEFAULT_CLAUDE_CODE_CONFIG, ...saved };
      }
      
      logger.info("Configuration loaded");
    } catch (error) {
      logger.error("Failed to load config:", error);
    }
  }
  
  async saveConfig(): Promise<void> {
    try {
      const configDir = path.dirname(this.getConfigPath());
      await fs.ensureDir(configDir);
      
      await fs.writeJson(this.getConfigPath(), this.config, { spaces: 2 });
      await fs.writeJson(this.getClaudeCodeConfigPath(), this.claudeCodeConfig, { spaces: 2 });
      
      logger.info("Configuration saved");
    } catch (error) {
      logger.error("Failed to save config:", error);
    }
  }
  
  getConfig(): OpenClawConfig {
    return { ...this.config };
  }
  
  async updateConfig(updates: Partial<OpenClawConfig>): Promise<void> {
    this.config = { ...this.config, ...updates };
    await this.saveConfig();
    this.emitEvent("gateway:connected", { config: this.config });
  }
  
  getClaudeCodeConfig(): ClaudeCodeConfig {
    return { ...this.claudeCodeConfig };
  }
  
  async updateClaudeCodeConfig(updates: Partial<ClaudeCodeConfig>): Promise<void> {
    this.claudeCodeConfig = { ...this.claudeCodeConfig, ...updates };
    await this.saveConfig();
  }
  
  // ===========================================================================
  // GATEWAY MANAGEMENT
  // ===========================================================================
  
  async startGateway(): Promise<void> {
    if (this.server) {
      logger.warn("Gateway already running");
      return;
    }
    
    try {
      this.updateStatus("connecting");
      
      const { host, port } = this.config.gateway;
      
      // Create HTTP server for health checks
      this.httpServer = http.createServer((req, res) => {
        if (req.url === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(this.getGatewayState()));
        } else if (req.url === "/status") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            status: this.state.status,
            providers: this.getProviderStatus(),
          }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      
      // Create WebSocket server
      this.server = new WebSocketServer({ server: this.httpServer });
      
      this.server.on("connection", (ws, req) => {
        this.handleNewConnection(ws, req);
      });
      
      this.server.on("error", (error) => {
        logger.error("WebSocket server error:", error);
        this.updateStatus("error", error.message);
      });
      
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.listen(port, host, () => {
          logger.info(`Gateway running on ws://${host}:${port}`);
          resolve();
        });
        this.httpServer!.on("error", reject);
      });
      
      this.updateStatus("connected");
      this.state.connectedAt = Date.now();
      this.state.version = "1.0.0";
      
      // Start heartbeat
      this.startHeartbeat();
      
      this.emitEvent("gateway:connected", {
        host,
        port,
        url: `ws://${host}:${port}`,
      });
      
    } catch (error: any) {
      logger.error("Failed to start gateway:", error);
      this.updateStatus("error", error.message);
      throw error;
    }
  }
  
  async stopGateway(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    
    // Close all client connections
    for (const [id, ws] of this.clients) {
      try {
        ws.close(1000, "Gateway shutting down");
      } catch {
        // Ignore
      }
    }
    this.clients.clear();
    
    // Close servers
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
    
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }
    
    this.updateStatus("disconnected");
    this.emitEvent("gateway:disconnected", {});
  }
  
  private handleNewConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const clientId = uuidv4();
    const origin = req.headers.origin || "unknown";
    
    // Check security
    if (!this.isOriginAllowed(origin)) {
      logger.warn(`Rejected connection from disallowed origin: ${origin}`);
      ws.close(4003, "Origin not allowed");
      return;
    }
    
    logger.info(`New client connected: ${clientId}`);
    this.clients.set(clientId, ws);
    this.state.connectedClients = this.clients.size;
    
    ws.on("message", async (data) => {
      try {
        const message: OpenClawMessage = JSON.parse(data.toString());
        await this.handleMessage(clientId, message);
      } catch (error) {
        logger.error("Failed to parse message:", error);
        this.sendError(ws, "Invalid message format");
      }
    });
    
    ws.on("close", () => {
      logger.info(`Client disconnected: ${clientId}`);
      this.clients.delete(clientId);
      this.state.connectedClients = this.clients.size;
    });
    
    ws.on("error", (error) => {
      logger.error(`Client error (${clientId}):`, error);
    });
    
    // Send welcome message
    this.sendToClient(clientId, {
      id: uuidv4(),
      type: "control",
      from: { type: "system", id: "gateway" },
      payload: {
        action: "welcome",
        clientId,
        providers: Object.keys(this.config.aiProviders).filter(
          (k) => this.config.aiProviders[k].enabled
        ),
      },
      timestamp: Date.now(),
    });
  }
  
  private isOriginAllowed(origin: string): boolean {
    if (!this.config.security.allowRemoteConnections && origin !== "unknown") {
      const allowedPatterns = this.config.security.allowedOrigins;
      return allowedPatterns.some((pattern) => {
        const regex = new RegExp(pattern.replace("*", ".*"));
        return regex.test(origin);
      });
    }
    return true;
  }
  
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.state.lastHeartbeat = Date.now();
      
      // Broadcast heartbeat to all clients
      for (const [id] of this.clients) {
        this.sendToClient(id, {
          id: uuidv4(),
          type: "heartbeat",
          from: { type: "system", id: "gateway" },
          payload: { timestamp: Date.now() },
          timestamp: Date.now(),
        });
      }
      
      // Check provider health periodically
      this.checkProviderHealth().catch((e) => logger.error("Health check failed:", e));
    }, this.config.gateway.heartbeatInterval);
  }
  
  // ===========================================================================
  // MESSAGE HANDLING
  // ===========================================================================
  
  private async handleMessage(clientId: string, message: OpenClawMessage): Promise<void> {
    logger.debug(`Received message from ${clientId}:`, message.type);
    
    try {
      switch (message.type) {
        case "chat":
          await this.handleChatMessage(clientId, message);
          break;
        case "completion":
          await this.handleCompletionMessage(clientId, message);
          break;
        case "agent-task":
          await this.handleAgentTask(clientId, message);
          break;
        case "tool-call":
          await this.handleToolCall(clientId, message);
          break;
        case "control":
          await this.handleControlMessage(clientId, message);
          break;
        case "heartbeat":
          // Just acknowledge
          break;
        default:
          logger.warn(`Unknown message type: ${message.type}`);
      }
      
      this.emitEvent("message:received", { clientId, message });
    } catch (error: any) {
      logger.error("Message handling error:", error);
      this.sendError(this.clients.get(clientId)!, error.message, message.id);
    }
  }
  
  private async handleChatMessage(clientId: string, message: OpenClawMessage): Promise<void> {
    const request = message.payload as OpenClawChatRequest;
    const provider = await this.selectProvider(request.capabilities);
    
    if (!provider) {
      throw new Error("No suitable provider available");
    }
    
    this.emitEvent("provider:switched", { provider: provider.name });
    
    const startTime = Date.now();
    let response: OpenClawChatResponse;
    
    try {
      if (request.stream) {
        // Handle streaming
        await this.streamChat(clientId, message.id, provider, request);
        return;
      }
      
      response = await this.executeChat(provider, request);
      response.latencyMs = Date.now() - startTime;
      response.localProcessed = provider.type === "ollama" || provider.type === "lmstudio";
      
    } catch (error: any) {
      // Try fallback provider
      if (this.config.fallbackProvider && provider.name !== this.config.fallbackProvider) {
        const fallback = this.config.aiProviders[this.config.fallbackProvider];
        if (fallback?.enabled) {
          logger.info(`Falling back to ${fallback.name}`);
          response = await this.executeChat(fallback, request);
          response.latencyMs = Date.now() - startTime;
          response.localProcessed = false;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    
    this.sendToClient(clientId, {
      id: uuidv4(),
      type: "chat",
      from: { type: "assistant", id: provider.name },
      to: { type: "provider", id: clientId },
      payload: response,
      timestamp: Date.now(),
      replyTo: message.id,
      metadata: {
        provider: response.provider,
        model: response.model,
        tokensUsed: response.usage.totalTokens,
        latencyMs: response.latencyMs,
        localProcessed: response.localProcessed,
      },
    });
  }
  
  private async executeChat(provider: OpenClawAIProvider, request: OpenClawChatRequest): Promise<OpenClawChatResponse> {
    switch (provider.type) {
      case "ollama":
        return this.executeChatOllama(provider, request);
      case "anthropic":
        return this.executeChatAnthropic(provider, request);
      case "lmstudio":
        return this.executeChatLMStudio(provider, request);
      case "claude-code":
        return this.executeChatClaudeCode(provider, request);
      default:
        throw new Error(`Unsupported provider type: ${provider.type}`);
    }
  }
  
  private async executeChatOllama(provider: OpenClawAIProvider, request: OpenClawChatRequest): Promise<OpenClawChatResponse> {
    const baseURL = provider.baseURL || "http://localhost:11434";
    
    const response = await fetch(`${baseURL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model || provider.model,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        options: {
          temperature: request.temperature ?? provider.temperature ?? 0.7,
          num_predict: request.maxTokens ?? provider.maxTokens,
        },
        stream: false,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      id: uuidv4(),
      message: {
        role: "assistant",
        content: data.message.content,
      },
      finishReason: data.done ? "stop" : "length",
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
      provider: provider.name,
      model: provider.model,
      latencyMs: 0,
      localProcessed: true,
    };
  }
  
  private async executeChatAnthropic(provider: OpenClawAIProvider, request: OpenClawChatRequest): Promise<OpenClawChatResponse> {
    if (!provider.apiKey) {
      throw new Error("Anthropic API key not configured");
    }
    
    const messages = request.messages.filter((m) => m.role !== "system");
    const systemPrompt = request.messages.find((m) => m.role === "system")?.content || request.systemPrompt;
    
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: request.model || provider.model,
        max_tokens: request.maxTokens || provider.maxTokens || 4096,
        system: systemPrompt,
        messages: messages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
        temperature: request.temperature ?? provider.temperature ?? 0.7,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Anthropic error: ${error.error?.message || response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      id: data.id,
      message: {
        role: "assistant",
        content: data.content[0].text,
      },
      finishReason: data.stop_reason === "end_turn" ? "stop" : data.stop_reason,
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      provider: provider.name,
      model: data.model,
      latencyMs: 0,
      localProcessed: false,
    };
  }
  
  private async executeChatLMStudio(provider: OpenClawAIProvider, request: OpenClawChatRequest): Promise<OpenClawChatResponse> {
    const baseURL = provider.baseURL || "http://localhost:1234";
    
    const response = await fetch(`${baseURL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model || provider.model,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        temperature: request.temperature ?? provider.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? provider.maxTokens,
        stream: false,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`LM Studio error: ${response.statusText}`);
    }
    
    const data = await response.json();
    const choice = data.choices[0];
    
    return {
      id: data.id,
      message: {
        role: "assistant",
        content: choice.message.content,
      },
      finishReason: choice.finish_reason === "stop" ? "stop" : "length",
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
      provider: provider.name,
      model: data.model,
      latencyMs: 0,
      localProcessed: true,
    };
  }
  
  private async executeChatClaudeCode(provider: OpenClawAIProvider, request: OpenClawChatRequest): Promise<OpenClawChatResponse> {
    // Claude Code is essentially Anthropic with additional agentic capabilities
    // For now, route through Anthropic with special system prompt
    const agenticSystemPrompt = `You are Claude Code, an AI coding assistant with file operation capabilities.
When the user asks you to perform file operations, analyze code, or make changes:
1. Think through the task step by step
2. Identify what files need to be read, created, or modified
3. Provide the changes in a structured format

${request.systemPrompt || ""}`;
    
    const modifiedRequest = {
      ...request,
      systemPrompt: agenticSystemPrompt,
    };
    
    return this.executeChatAnthropic(provider, modifiedRequest);
  }
  
  private async streamChat(
    clientId: string,
    requestId: string,
    provider: OpenClawAIProvider,
    request: OpenClawChatRequest
  ): Promise<void> {
    // Streaming implementation depends on provider
    // For brevity, using Ollama streaming as example
    const baseURL = provider.baseURL || "http://localhost:11434";
    
    const response = await fetch(`${baseURL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model || provider.model,
        messages: request.messages,
        stream: true,
      }),
    });
    
    if (!response.ok || !response.body) {
      throw new Error("Failed to start stream");
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter(Boolean);
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            
            const streamChunk: OpenClawStreamChunk = {
              id: uuidv4(),
              delta: data.message?.content || "",
              finishReason: data.done ? "stop" : undefined,
            };
            
            this.sendToClient(clientId, {
              id: uuidv4(),
              type: "chat",
              from: { type: "assistant", id: provider.name },
              payload: { stream: true, chunk: streamChunk },
              timestamp: Date.now(),
              replyTo: requestId,
            });
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
  
  private async handleCompletionMessage(clientId: string, message: OpenClawMessage): Promise<void> {
    // Simple text completion - route to chat with appropriate formatting
    const { prompt, ...options } = message.payload as { prompt: string } & Partial<OpenClawChatRequest>;
    
    const chatRequest: OpenClawChatRequest = {
      messages: [{ role: "user", content: prompt }],
      ...options,
    };
    
    const chatMessage: OpenClawMessage = {
      ...message,
      type: "chat",
      payload: chatRequest,
    };
    
    await this.handleChatMessage(clientId, chatMessage);
  }
  
  private async handleAgentTask(clientId: string, message: OpenClawMessage): Promise<void> {
    const task = message.payload as OpenClawAgentTask;
    
    this.emitEvent("agent:task:started", { taskId: task.id, task });
    
    // Determine provider based on task
    const capabilities: OpenClawCapability[] = ["agentic", "reasoning"];
    if (task.type === "build" || task.type === "analyze") {
      capabilities.push("code");
    }
    
    const provider = task.preferLocal
      ? this.config.aiProviders.ollama
      : await this.selectProvider(capabilities);
    
    if (!provider) {
      throw new Error("No suitable provider for agent task");
    }
    
    const result: OpenClawAgentTaskResult = {
      taskId: task.id,
      status: "completed",
      iterations: 1,
      tokensUsed: 0,
      providersUsed: [provider.name],
    };
    
    try {
      // Execute agent task as chat with structured prompts
      const systemPrompt = `You are an autonomous AI agent. Your task type is: ${task.type}
      
Objective: ${task.objective}

${task.context ? `Context: ${task.context}` : ""}

${task.constraints?.length ? `Constraints:\n${task.constraints.map((c) => `- ${c}`).join("\n")}` : ""}

Think through this step by step and provide a structured response with your reasoning and results.`;
      
      const response = await this.executeChat(provider, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: task.objective },
        ],
        maxTokens: provider.maxTokens,
        temperature: 0.5,
      });
      
      result.result = response.message.content;
      result.tokensUsed = response.usage.totalTokens;
      
    } catch (error: any) {
      result.status = "failed";
      result.error = error.message;
    }
    
    this.emitEvent("agent:task:completed", result);
    
    this.sendToClient(clientId, {
      id: uuidv4(),
      type: "agent-task",
      from: { type: "agent", id: "autonomous" },
      payload: result,
      timestamp: Date.now(),
      replyTo: message.id,
    });
  }
  
  private async handleToolCall(clientId: string, message: OpenClawMessage): Promise<void> {
    this.emitEvent("tool:invoked", message.payload);
    
    // Tool calls are forwarded to registered handlers
    this.emit("tool:call", {
      clientId,
      message,
    });
  }
  
  private async handleControlMessage(clientId: string, message: OpenClawMessage): Promise<void> {
    const { action, ...params } = message.payload as { action: string } & Record<string, unknown>;
    
    switch (action) {
      case "get-status":
        this.sendToClient(clientId, {
          id: uuidv4(),
          type: "control",
          from: { type: "system", id: "gateway" },
          payload: { action: "status", state: this.getGatewayState() },
          timestamp: Date.now(),
          replyTo: message.id,
        });
        break;
        
      case "list-providers":
        this.sendToClient(clientId, {
          id: uuidv4(),
          type: "control",
          from: { type: "system", id: "gateway" },
          payload: {
            action: "providers",
            providers: Object.entries(this.config.aiProviders).map(([id, p]) => ({
              id,
              ...p,
              apiKey: p.apiKey ? "***" : undefined,
            })),
          },
          timestamp: Date.now(),
          replyTo: message.id,
        });
        break;
        
      case "switch-provider":
        if (params.provider && typeof params.provider === "string") {
          this.config.defaultProvider = params.provider;
          await this.saveConfig();
        }
        break;
    }
  }
  
  // ===========================================================================
  // PROVIDER MANAGEMENT
  // ===========================================================================
  
  private async selectProvider(requiredCapabilities?: OpenClawCapability[]): Promise<OpenClawAIProvider | null> {
    const { mode, preferLocal, useCloudForComplex } = this.config.routing;
    
    // Get enabled providers sorted by priority
    const providers = Object.values(this.config.aiProviders)
      .filter((p) => p.enabled)
      .sort((a, b) => a.priority - b.priority);
    
    if (providers.length === 0) {
      return null;
    }
    
    // Filter by required capabilities
    let candidates = providers;
    if (requiredCapabilities?.length) {
      candidates = providers.filter((p) =>
        requiredCapabilities.every((cap) => p.capabilities.includes(cap))
      );
    }
    
    if (candidates.length === 0) {
      // Fall back to any enabled provider
      candidates = providers;
    }
    
    // Smart routing
    if (mode === "smart") {
      // Check if task requires cloud capabilities
      const needsCloud = requiredCapabilities?.some((c) =>
        ["vision", "function-calling", "agentic"].includes(c)
      );
      
      if (needsCloud && useCloudForComplex) {
        // Prefer cloud providers
        const cloud = candidates.find((p) => !p.capabilities.includes("local-only"));
        if (cloud) return cloud;
      }
      
      if (preferLocal) {
        // Prefer local providers
        const local = candidates.find((p) =>
          p.type === "ollama" || p.type === "lmstudio"
        );
        if (local && await this.isProviderHealthy(local)) {
          return local;
        }
      }
    }
    
    // Return first healthy candidate
    for (const provider of candidates) {
      if (await this.isProviderHealthy(provider)) {
        return provider;
      }
    }
    
    return candidates[0]; // Last resort
  }
  
  private async isProviderHealthy(provider: OpenClawAIProvider): Promise<boolean> {
    const cached = this.providerHealthCache.get(provider.name);
    if (cached && Date.now() - cached.lastCheck < 30000) {
      return cached.healthy;
    }
    
    try {
      let healthy = false;
      
      switch (provider.type) {
        case "ollama": {
          const response = await fetch(`${provider.baseURL || "http://localhost:11434"}/api/tags`, {
            method: "GET",
            signal: AbortSignal.timeout(2000),
          });
          healthy = response.ok;
          break;
        }
        case "lmstudio": {
          const response = await fetch(`${provider.baseURL || "http://localhost:1234"}/v1/models`, {
            method: "GET",
            signal: AbortSignal.timeout(2000),
          });
          healthy = response.ok;
          break;
        }
        case "anthropic":
        case "claude-code":
          healthy = !!provider.apiKey;
          break;
        default:
          healthy = true;
      }
      
      this.providerHealthCache.set(provider.name, { healthy, lastCheck: Date.now() });
      return healthy;
    } catch {
      this.providerHealthCache.set(provider.name, { healthy: false, lastCheck: Date.now() });
      return false;
    }
  }
  
  async checkProviderHealth(): Promise<Record<string, boolean>> {
    const health: Record<string, boolean> = {};
    
    for (const [name, provider] of Object.entries(this.config.aiProviders)) {
      if (provider.enabled) {
        health[name] = await this.isProviderHealthy(provider);
      }
    }
    
    return health;
  }
  
  getProviderStatus(): Array<{ name: string; enabled: boolean; healthy: boolean; type: string }> {
    return Object.entries(this.config.aiProviders).map(([name, p]) => ({
      name,
      enabled: p.enabled,
      healthy: this.providerHealthCache.get(name)?.healthy ?? false,
      type: p.type,
    }));
  }
  
  async configureProvider(name: string, updates: Partial<OpenClawAIProvider>): Promise<void> {
    if (!this.config.aiProviders[name]) {
      this.config.aiProviders[name] = {
        ...updates,
        name: updates.name || name,
        type: updates.type || "custom",
        model: updates.model || "",
        enabled: updates.enabled ?? true,
        priority: updates.priority ?? 10,
        capabilities: updates.capabilities || ["chat"],
      } as OpenClawAIProvider;
    } else {
      this.config.aiProviders[name] = {
        ...this.config.aiProviders[name],
        ...updates,
      };
    }
    
    await this.saveConfig();
    
    // Re-check health
    await this.isProviderHealthy(this.config.aiProviders[name]);
  }
  
  async removeProvider(name: string): Promise<void> {
    delete this.config.aiProviders[name];
    await this.saveConfig();
  }
  
  // ===========================================================================
  // CLAUDE CODE INTEGRATION
  // ===========================================================================
  
  async executeClaudeCodeTask(task: ClaudeCodeTask): Promise<ClaudeCodeResult> {
    if (!this.claudeCodeConfig.enabled) {
      throw new Error("Claude Code is not enabled");
    }
    
    const provider = this.config.aiProviders["claude-code"] || this.config.aiProviders.anthropic;
    if (!provider?.enabled) {
      throw new Error("No Claude/Anthropic provider configured");
    }
    
    this.emitEvent("claude-code:task:started", { taskId: task.id, task });
    
    const result: ClaudeCodeResult = {
      taskId: task.id,
      success: false,
      changes: [],
    };
    
    try {
      // Build system prompt for file operations
      const systemPrompt = `You are Claude Code, an AI assistant specialized in code operations.
Your workspace path is: ${this.claudeCodeConfig.workspacePath || "not set"}

You can perform these operations: ${this.claudeCodeConfig.allowedOperations.join(", ")}

When asked to make code changes:
1. Analyze the request
2. Provide changes in this JSON format:
{
  "changes": [
    {"type": "create|modify|delete", "path": "relative/path", "content": "new content", "diff": "unified diff if modify"}
  ],
  "explanation": "what you did and why"
}

${this.claudeCodeConfig.sandboxMode ? "SANDBOX MODE: Changes will be previewed but not applied automatically." : ""}`;
      
      const response = await this.executeChat(provider, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: task.description },
        ],
        temperature: 0.3,
        maxTokens: 4096,
      });
      
      // Parse response for structured output
      const content = response.message.content;
      try {
        const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          result.changes = parsed.changes;
          result.output = parsed.explanation;
        } else {
          result.output = content;
        }
        result.success = true;
      } catch {
        result.output = content;
        result.success = true;
      }
      
    } catch (error: any) {
      result.error = error.message;
    }
    
    this.emitEvent("claude-code:task:completed", result);
    
    return result;
  }
  
  // ===========================================================================
  // N8N INTEGRATION
  // ===========================================================================
  
  async triggerN8nWorkflow(workflowId: string, data: unknown): Promise<void> {
    this.emitEvent("n8n:workflow:triggered", { workflowId, data });
    
    // This would integrate with the n8n handlers
    // For now, emit event that n8n handlers can listen to
    this.emit("n8n:trigger", { workflowId, data });
  }
  
  // ===========================================================================
  // HELPERS
  // ===========================================================================
  
  private updateStatus(status: OpenClawGatewayStatus, error?: string): void {
    this.state.status = status;
    this.state.error = error;
    this.emit("status:changed", { status, error });
  }
  
  private sendToClient(clientId: string, message: OpenClawMessage): void {
    const ws = this.clients.get(clientId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      this.emitEvent("message:sent", { clientId, message });
    }
  }
  
  private sendError(ws: WebSocket, error: string, replyTo?: string): void {
    const message: OpenClawMessage = {
      id: uuidv4(),
      type: "error",
      from: { type: "system", id: "gateway" },
      payload: { error },
      timestamp: Date.now(),
      replyTo,
    };
    
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
  
  private emitEvent(type: OpenClawEventType, data: unknown): void {
    const event: OpenClawEvent = {
      type,
      timestamp: Date.now(),
      data,
    };
    
    this.emit("event", event);
  }
  
  getGatewayState(): OpenClawGatewayState {
    return { ...this.state };
  }
  
  // ===========================================================================
  // PUBLIC API FOR IPC
  // ===========================================================================
  
  async chat(request: OpenClawChatRequest): Promise<OpenClawChatResponse> {
    const provider = await this.selectProvider(request.capabilities);
    if (!provider) {
      throw new Error("No suitable provider available");
    }
    
    const startTime = Date.now();
    const response = await this.executeChat(provider, request);
    response.latencyMs = Date.now() - startTime;
    response.localProcessed = provider.type === "ollama" || provider.type === "lmstudio";
    
    return response;
  }
  
  async executeAgentTask(task: OpenClawAgentTask): Promise<OpenClawAgentTaskResult> {
    const provider = task.preferLocal
      ? this.config.aiProviders.ollama
      : await this.selectProvider(["agentic", "reasoning"]);
    
    if (!provider) {
      throw new Error("No suitable provider for agent task");
    }
    
    this.emitEvent("agent:task:started", { taskId: task.id, task });
    
    const result: OpenClawAgentTaskResult = {
      taskId: task.id,
      status: "completed",
      iterations: 1,
      tokensUsed: 0,
      providersUsed: [provider.name],
    };
    
    try {
      const systemPrompt = `You are an autonomous AI agent performing a ${task.type} task.
Objective: ${task.objective}
${task.context ? `Context: ${task.context}` : ""}
${task.constraints?.length ? `Constraints: ${task.constraints.join(", ")}` : ""}`;
      
      const response = await this.executeChat(provider, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: task.objective },
        ],
        temperature: 0.5,
      });
      
      result.result = response.message.content;
      result.tokensUsed = response.usage.totalTokens;
      
    } catch (error: any) {
      result.status = "failed";
      result.error = error.message;
    }
    
    this.emitEvent("agent:task:completed", result);
    return result;
  }
}

// Singleton export
export function getOpenClawGateway(): OpenClawGatewayService {
  return OpenClawGatewayService.getInstance();
}
