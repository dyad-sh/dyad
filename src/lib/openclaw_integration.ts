/**
 * OpenClaw Integration Service
 * 
 * Integrates the OpenClaw Personal AI Assistant as the central nervous system
 * of JoyCreate. OpenClaw provides:
 * - Multi-channel messaging (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, etc.)
 * - AI agent execution with thinking levels
 * - Memory search and retrieval
 * - Plugin management
 * - Gateway daemon control
 * 
 * "EXFOLIATE! EXFOLIATE!" 🦞
 */

import { EventEmitter } from "node:events";
import { spawn, ChildProcess, exec } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "fs-extra";
import log from "electron-log";
import WebSocket from "ws";
import { app } from "electron";

const execAsync = promisify(exec);
const logger = log.scope("openclaw_integration");

// =============================================================================
// TYPES
// =============================================================================

export type OpenClawChannel = 
  | "whatsapp" 
  | "telegram" 
  | "slack" 
  | "discord" 
  | "googlechat" 
  | "signal" 
  | "imessage" 
  | "msteams" 
  | "matrix" 
  | "bluebubbles" 
  | "zalo" 
  | "zalouser" 
  | "webchat"
  | "nostr"
  | "mattermost"
  | "nextcloud-talk"
  | "line"
  | "tlon";

export type OpenClawThinkingLevel = "off" | "minimal" | "low" | "medium" | "high";

export type OpenClawBindMode = "loopback" | "lan" | "tailnet" | "auto" | "custom";

export type OpenClawAuthMode = "token" | "password";

export interface OpenClawGatewayConfig {
  port: number;
  bind: OpenClawBindMode;
  authMode: OpenClawAuthMode;
  token?: string;
  password?: string;
  verbose: boolean;
  tailscale?: "off" | "serve" | "funnel";
}

export interface OpenClawGatewayStatus {
  running: boolean;
  port: number;
  pid?: number;
  version?: string;
  uptime?: number;
  channels: OpenClawChannelStatus[];
  health: OpenClawHealthStatus;
}

export interface OpenClawChannelStatus {
  channel: OpenClawChannel;
  connected: boolean;
  accountId?: string;
  lastActivity?: Date;
}

export interface OpenClawHealthStatus {
  gateway: "healthy" | "degraded" | "unhealthy";
  memory: "ok" | "warning" | "critical";
  models: "available" | "limited" | "unavailable";
  channels: "all_connected" | "partial" | "disconnected";
}

export interface OpenClawAgentRequest {
  message: string;
  to?: string;
  sessionId?: string;
  agentId?: string;
  thinking?: OpenClawThinkingLevel;
  verbose?: boolean;
  channel?: OpenClawChannel;
  replyTo?: string;
  replyChannel?: OpenClawChannel;
  deliver?: boolean;
  timeout?: number;
  local?: boolean;
}

export interface OpenClawAgentResponse {
  success: boolean;
  sessionId: string;
  agentId: string;
  reply: string;
  thinking?: string;
  toolCalls?: OpenClawToolCall[];
  tokens?: {
    input: number;
    output: number;
    thinking?: number;
  };
  duration: number;
  delivered?: boolean;
  deliveryChannel?: OpenClawChannel;
}

export interface OpenClawToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  duration?: number;
}

export interface OpenClawMessageRequest {
  target: string;
  message: string;
  channel?: OpenClawChannel;
  media?: string[];
  replyTo?: string;
}

export interface OpenClawMessageResponse {
  success: boolean;
  messageId?: string;
  channel: OpenClawChannel;
  timestamp: Date;
}

export interface OpenClawBroadcastRequest {
  targets: string[];
  message: string;
  channel?: OpenClawChannel;
  media?: string[];
}

export interface OpenClawMemorySearchRequest {
  query: string;
  sessionId?: string;
  limit?: number;
  filters?: Record<string, unknown>;
}

export interface OpenClawMemoryResult {
  id: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
  timestamp: Date;
}

export interface OpenClawPlugin {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  description?: string;
}

export interface OpenClawIntegrationConfig {
  autoStartGateway: boolean;
  gatewayConfig: OpenClawGatewayConfig;
  defaultChannel: OpenClawChannel;
  defaultThinking: OpenClawThinkingLevel;
  reconnectInterval: number;
  maxReconnectAttempts: number;
}

export interface OpenClawWebSocketMessage {
  type: string;
  id?: string;
  payload?: unknown;
  error?: string;
}

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

export const DEFAULT_OPENCLAW_INTEGRATION_CONFIG: OpenClawIntegrationConfig = {
  autoStartGateway: true,
  gatewayConfig: {
    port: 18790,
    bind: "loopback",
    authMode: "token",
    verbose: false,
  },
  defaultChannel: "whatsapp",
  defaultThinking: "medium",
  reconnectInterval: 5000,
  maxReconnectAttempts: 10,
};

// =============================================================================
// OPENCLAW INTEGRATION SERVICE
// =============================================================================

export class OpenClawIntegrationService extends EventEmitter {
  private static instance: OpenClawIntegrationService | null = null;
  
  private config: OpenClawIntegrationConfig;
  private ws: WebSocket | null = null;
  private gatewayProcess: ChildProcess | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private isConnected = false;
  private gatewayStatus: OpenClawGatewayStatus | null = null;

  private constructor() {
    super();
    this.config = { ...DEFAULT_OPENCLAW_INTEGRATION_CONFIG };
  }

  static getInstance(): OpenClawIntegrationService {
    if (!OpenClawIntegrationService.instance) {
      OpenClawIntegrationService.instance = new OpenClawIntegrationService();
    }
    return OpenClawIntegrationService.instance;
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  async initialize(config?: Partial<OpenClawIntegrationConfig>): Promise<void> {
    logger.info("🦞 Initializing OpenClaw Integration Service...");

    if (config) {
      this.config = { ...this.config, ...config };
    }

    await this.loadConfig();

    // Check if OpenClaw CLI is available
    const cliAvailable = await this.checkCLI();
    if (!cliAvailable) {
      logger.warn("OpenClaw CLI not found. Some features may be limited.");
      this.emit("warning", { message: "OpenClaw CLI not available" });
    }

    // Check gateway status
    const gatewayRunning = await this.checkGatewayStatus();

    if (!gatewayRunning && this.config.autoStartGateway) {
      logger.info("Starting OpenClaw Gateway...");
      await this.startGateway();
    }

    // Connect to gateway WebSocket
    await this.connectToGateway();

    logger.info("🦞 OpenClaw Integration Service initialized - EXFOLIATE!");
  }

  async shutdown(): Promise<void> {
    logger.info("Shutting down OpenClaw Integration Service...");

    this.stopHeartbeat();
    this.clearReconnectTimer();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Note: We don't stop the gateway daemon on shutdown
    // as it may be used by other processes

    this.isConnected = false;
    this.emit("shutdown");
    logger.info("OpenClaw Integration Service shut down");
  }

  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  private async loadConfig(): Promise<void> {
    const configPath = path.join(app.getPath("userData"), "openclaw-integration.json");
    
    try {
      if (await fs.pathExists(configPath)) {
        const saved = await fs.readJson(configPath);
        this.config = { ...this.config, ...saved };
        logger.info("Loaded OpenClaw integration config");
      }
    } catch (error) {
      logger.warn("Failed to load OpenClaw config, using defaults:", error);
    }
  }

  async saveConfig(): Promise<void> {
    const configPath = path.join(app.getPath("userData"), "openclaw-integration.json");
    
    try {
      await fs.writeJson(configPath, this.config, { spaces: 2 });
      logger.info("Saved OpenClaw integration config");
    } catch (error) {
      logger.error("Failed to save OpenClaw config:", error);
      throw error;
    }
  }

  getConfig(): OpenClawIntegrationConfig {
    return { ...this.config };
  }

  async updateConfig(updates: Partial<OpenClawIntegrationConfig>): Promise<void> {
    this.config = { ...this.config, ...updates };
    await this.saveConfig();
    this.emit("config-updated", this.config);
  }

  // ===========================================================================
  // CLI INTERFACE
  // ===========================================================================

  private async checkCLI(): Promise<boolean> {
    try {
      const { stdout } = await execAsync("npx openclaw --version");
      logger.info(`OpenClaw CLI version: ${stdout.trim()}`);
      return true;
    } catch {
      return false;
    }
  }

  private async runCLI(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn("npx", ["openclaw", ...args], {
        shell: true,
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`OpenClaw CLI exited with code ${code}: ${stderr}`));
        }
      });

      proc.on("error", (error) => {
        reject(error);
      });
    });
  }

  // ===========================================================================
  // GATEWAY MANAGEMENT
  // ===========================================================================

  private async checkGatewayStatus(): Promise<boolean> {
    try {
      const output = await this.runCLI(["gateway", "status", "--json"]);
      const status = JSON.parse(output);
      this.gatewayStatus = status;
      return status.running === true;
    } catch {
      return false;
    }
  }

  async startGateway(): Promise<void> {
    logger.info("Starting OpenClaw Gateway daemon...");

    try {
      // Use the daemon install/start commands
      await this.runCLI([
        "gateway",
        "start",
        "--port", this.config.gatewayConfig.port.toString(),
        "--bind", this.config.gatewayConfig.bind,
        ...(this.config.gatewayConfig.verbose ? ["--verbose"] : []),
      ]);

      // Wait for gateway to be ready
      await this.waitForGateway();

      this.emit("gateway-started");
      logger.info("OpenClaw Gateway started successfully");
    } catch (error) {
      logger.error("Failed to start OpenClaw Gateway:", error);
      throw error;
    }
  }

  async stopGateway(): Promise<void> {
    logger.info("Stopping OpenClaw Gateway daemon...");

    try {
      await this.runCLI(["gateway", "stop"]);
      this.gatewayStatus = null;
      this.emit("gateway-stopped");
      logger.info("OpenClaw Gateway stopped");
    } catch (error) {
      logger.error("Failed to stop OpenClaw Gateway:", error);
      throw error;
    }
  }

  async restartGateway(): Promise<void> {
    logger.info("Restarting OpenClaw Gateway...");
    await this.runCLI(["gateway", "restart"]);
    await this.waitForGateway();
    this.emit("gateway-restarted");
  }

  private async waitForGateway(maxAttempts = 30): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      const running = await this.checkGatewayStatus();
      if (running) {
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error("Gateway failed to start within timeout");
  }

  async getGatewayStatus(): Promise<OpenClawGatewayStatus | null> {
    try {
      const output = await this.runCLI(["gateway", "status", "--json"]);
      this.gatewayStatus = JSON.parse(output);
      return this.gatewayStatus;
    } catch (error) {
      logger.warn("Failed to get gateway status:", error);
      return null;
    }
  }

  async getGatewayHealth(): Promise<OpenClawHealthStatus | null> {
    try {
      const output = await this.runCLI(["gateway", "health", "--json"]);
      return JSON.parse(output);
    } catch (error) {
      logger.warn("Failed to get gateway health:", error);
      return null;
    }
  }

  // ===========================================================================
  // WEBSOCKET CONNECTION
  // ===========================================================================

  private async connectToGateway(): Promise<void> {
    const port = this.config.gatewayConfig.port;
    const url = `ws://localhost:${port}`;

    logger.info(`Connecting to OpenClaw Gateway at ${url}...`);

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url, {
          headers: this.config.gatewayConfig.token
            ? { Authorization: `Bearer ${this.config.gatewayConfig.token}` }
            : {},
        });

        this.ws.on("open", () => {
          logger.info("Connected to OpenClaw Gateway WebSocket");
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.emit("connected");
          resolve();
        });

        this.ws.on("message", (data) => {
          this.handleWebSocketMessage(data);
        });

        this.ws.on("close", () => {
          logger.warn("OpenClaw Gateway WebSocket closed");
          this.isConnected = false;
          this.stopHeartbeat();
          this.emit("disconnected");
          this.scheduleReconnect();
        });

        this.ws.on("error", (error) => {
          logger.error("OpenClaw Gateway WebSocket error:", error);
          this.emit("error", error);
          if (!this.isConnected) {
            reject(error);
          }
        });

        // Timeout for initial connection
        setTimeout(() => {
          if (!this.isConnected) {
            reject(new Error("Connection timeout"));
          }
        }, 10000);
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleWebSocketMessage(data: WebSocket.Data): void {
    try {
      const message: OpenClawWebSocketMessage = JSON.parse(data.toString());

      // Handle response to pending request
      if (message.id && this.pendingRequests.has(message.id)) {
        const pending = this.pendingRequests.get(message.id)!;
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);

        if (message.error) {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(message.payload);
        }
        return;
      }

      // Handle events
      switch (message.type) {
        case "agent:thinking":
          this.emit("agent-thinking", message.payload);
          break;
        case "agent:tool_call":
          this.emit("agent-tool-call", message.payload);
          break;
        case "agent:response":
          this.emit("agent-response", message.payload);
          break;
        case "message:received":
          this.emit("message-received", message.payload);
          break;
        case "message:sent":
          this.emit("message-sent", message.payload);
          break;
        case "channel:connected":
          this.emit("channel-connected", message.payload);
          break;
        case "channel:disconnected":
          this.emit("channel-disconnected", message.payload);
          break;
        default:
          this.emit("event", message);
      }
    } catch (error) {
      logger.error("Failed to parse WebSocket message:", error);
    }
  }

  private async sendWebSocketRequest<T>(
    type: string,
    payload?: unknown,
    timeout = 60000
  ): Promise<T> {
    if (!this.ws || !this.isConnected) {
      throw new Error("Not connected to OpenClaw Gateway");
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout for ${type}`));
      }, timeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout: timeoutHandle,
      });

      this.ws!.send(JSON.stringify({ type, id, payload }));
    });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.isConnected) {
        this.ws.ping();
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      logger.error("Max reconnection attempts reached");
      this.emit("reconnect-failed");
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1);

    logger.info(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connectToGateway();
      } catch (error) {
        logger.error("Reconnection failed:", error);
        this.scheduleReconnect();
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ===========================================================================
  // AGENT INTERFACE
  // ===========================================================================

  /**
   * Run an agent turn - the primary way to interact with OpenClaw
   */
  async runAgent(request: OpenClawAgentRequest): Promise<OpenClawAgentResponse> {
    logger.info("Running OpenClaw agent:", { message: request.message.slice(0, 100) });

    const args = ["agent", "--message", request.message];

    if (request.to) args.push("--to", request.to);
    if (request.sessionId) args.push("--session-id", request.sessionId);
    if (request.agentId) args.push("--agent", request.agentId);
    if (request.thinking) args.push("--thinking", request.thinking);
    if (request.verbose !== undefined) args.push("--verbose", request.verbose ? "on" : "off");
    if (request.channel) args.push("--channel", request.channel);
    if (request.replyTo) args.push("--reply-to", request.replyTo);
    if (request.replyChannel) args.push("--reply-channel", request.replyChannel);
    if (request.deliver) args.push("--deliver");
    if (request.local) args.push("--local");
    if (request.timeout) args.push("--timeout", request.timeout.toString());
    args.push("--json");

    const output = await this.runCLI(args);
    const response = JSON.parse(output) as OpenClawAgentResponse;

    this.emit("agent-completed", response);
    return response;
  }

  /**
   * Stream an agent turn with real-time updates
   */
  async streamAgent(
    request: OpenClawAgentRequest,
    onThinking?: (thinking: string) => void,
    onToolCall?: (tool: OpenClawToolCall) => void,
    onChunk?: (chunk: string) => void
  ): Promise<OpenClawAgentResponse> {
    // For streaming, we use the WebSocket connection
    if (!this.isConnected) {
      throw new Error("Not connected to OpenClaw Gateway for streaming");
    }

    const listeners = {
      thinking: (data: unknown) => onThinking?.((data as { content: string }).content),
      toolCall: (data: unknown) => onToolCall?.(data as OpenClawToolCall),
      chunk: (data: unknown) => onChunk?.((data as { content: string }).content),
    };

    this.on("agent-thinking", listeners.thinking);
    this.on("agent-tool-call", listeners.toolCall);
    this.on("agent-response", listeners.chunk);

    try {
      const response = await this.sendWebSocketRequest<OpenClawAgentResponse>(
        "agent:run",
        request,
        request.timeout ? request.timeout * 1000 : 600000
      );
      return response;
    } finally {
      this.off("agent-thinking", listeners.thinking);
      this.off("agent-tool-call", listeners.toolCall);
      this.off("agent-response", listeners.chunk);
    }
  }

  // ===========================================================================
  // MESSAGING INTERFACE
  // ===========================================================================

  /**
   * Send a message to a target via any configured channel
   */
  async sendMessage(request: OpenClawMessageRequest): Promise<OpenClawMessageResponse> {
    logger.info("Sending message via OpenClaw:", {
      target: request.target,
      channel: request.channel || this.config.defaultChannel,
    });

    const args = [
      "message",
      "send",
      "--target", request.target,
      "--message", request.message,
    ];

    if (request.channel) args.push("--channel", request.channel);
    if (request.media) {
      for (const m of request.media) {
        args.push("--media", m);
      }
    }
    if (request.replyTo) args.push("--reply-to", request.replyTo);
    args.push("--json");

    const output = await this.runCLI(args);
    const response = JSON.parse(output) as OpenClawMessageResponse;

    this.emit("message-sent-cli", response);
    return response;
  }

  /**
   * Broadcast a message to multiple targets
   */
  async broadcastMessage(request: OpenClawBroadcastRequest): Promise<OpenClawMessageResponse[]> {
    logger.info("Broadcasting message via OpenClaw:", {
      targets: request.targets.length,
      channel: request.channel || this.config.defaultChannel,
    });

    const args = [
      "message",
      "broadcast",
      "--message", request.message,
    ];

    for (const target of request.targets) {
      args.push("--target", target);
    }

    if (request.channel) args.push("--channel", request.channel);
    if (request.media) {
      for (const m of request.media) {
        args.push("--media", m);
      }
    }
    args.push("--json");

    const output = await this.runCLI(args);
    return JSON.parse(output);
  }

  /**
   * Read recent messages from a channel
   */
  async readMessages(
    target: string,
    channel?: OpenClawChannel,
    limit = 20
  ): Promise<unknown[]> {
    const args = [
      "message",
      "read",
      "--target", target,
      "--limit", limit.toString(),
    ];

    if (channel) args.push("--channel", channel);
    args.push("--json");

    const output = await this.runCLI(args);
    return JSON.parse(output);
  }

  // ===========================================================================
  // MEMORY INTERFACE
  // ===========================================================================

  /**
   * Search OpenClaw's memory system
   */
  async searchMemory(request: OpenClawMemorySearchRequest): Promise<OpenClawMemoryResult[]> {
    logger.info("Searching OpenClaw memory:", { query: request.query });

    const args = ["memory", "search", "--query", request.query];

    if (request.sessionId) args.push("--session-id", request.sessionId);
    if (request.limit) args.push("--limit", request.limit.toString());
    args.push("--json");

    const output = await this.runCLI(args);
    return JSON.parse(output);
  }

  // ===========================================================================
  // PLUGIN MANAGEMENT
  // ===========================================================================

  /**
   * List installed plugins
   */
  async listPlugins(): Promise<OpenClawPlugin[]> {
    const output = await this.runCLI(["plugins", "list", "--json"]);
    return JSON.parse(output);
  }

  /**
   * Install a plugin
   */
  async installPlugin(pluginId: string): Promise<void> {
    await this.runCLI(["plugins", "install", pluginId]);
    this.emit("plugin-installed", { pluginId });
  }

  /**
   * Uninstall a plugin
   */
  async uninstallPlugin(pluginId: string): Promise<void> {
    await this.runCLI(["plugins", "uninstall", pluginId]);
    this.emit("plugin-uninstalled", { pluginId });
  }

  /**
   * Enable a plugin
   */
  async enablePlugin(pluginId: string): Promise<void> {
    await this.runCLI(["plugins", "enable", pluginId]);
    this.emit("plugin-enabled", { pluginId });
  }

  /**
   * Disable a plugin
   */
  async disablePlugin(pluginId: string): Promise<void> {
    await this.runCLI(["plugins", "disable", pluginId]);
    this.emit("plugin-disabled", { pluginId });
  }

  // ===========================================================================
  // CHANNEL MANAGEMENT
  // ===========================================================================

  /**
   * Get available channels and their status
   */
  async getChannels(): Promise<OpenClawChannelStatus[]> {
    const status = await this.getGatewayStatus();
    return status?.channels || [];
  }

  /**
   * Configure a channel
   */
  async configureChannel(channel: OpenClawChannel): Promise<void> {
    // Opens the interactive configuration for the channel
    await this.runCLI(["configure", "--channel", channel]);
  }

  // ===========================================================================
  // DOCTOR / DIAGNOSTICS
  // ===========================================================================

  /**
   * Run health checks and get diagnostic information
   */
  async runDoctor(): Promise<unknown> {
    const output = await this.runCLI(["doctor", "--json"]);
    return JSON.parse(output);
  }

  // ===========================================================================
  // UTILITY METHODS
  // ===========================================================================

  isGatewayConnected(): boolean {
    return this.isConnected;
  }

  getConnectionStatus(): "connected" | "disconnected" | "connecting" | "error" {
    if (this.isConnected) return "connected";
    if (this.reconnectTimer) return "connecting";
    return "disconnected";
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

let integrationInstance: OpenClawIntegrationService | null = null;

export function getOpenClawIntegration(): OpenClawIntegrationService {
  if (!integrationInstance) {
    integrationInstance = OpenClawIntegrationService.getInstance();
  }
  return integrationInstance;
}

export async function initializeOpenClaw(
  config?: Partial<OpenClawIntegrationConfig>
): Promise<OpenClawIntegrationService> {
  const integration = getOpenClawIntegration();
  await integration.initialize(config);
  return integration;
}
