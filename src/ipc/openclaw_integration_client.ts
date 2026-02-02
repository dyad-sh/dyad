/**
 * OpenClaw Integration IPC Client
 * 
 * Renderer-side client for communicating with the OpenClaw Personal AI Assistant.
 * Provides typed methods for all OpenClaw operations.
 * 
 * 🦞 EXFOLIATE! EXFOLIATE!
 */

import type { IpcRenderer } from "electron";
import type {
  OpenClawChannel,
  OpenClawThinkingLevel,
  OpenClawGatewayStatus,
  OpenClawHealthStatus,
  OpenClawAgentRequest,
  OpenClawAgentResponse,
  OpenClawMessageRequest,
  OpenClawMessageResponse,
  OpenClawBroadcastRequest,
  OpenClawMemorySearchRequest,
  OpenClawMemoryResult,
  OpenClawPlugin,
  OpenClawIntegrationConfig,
  OpenClawChannelStatus,
} from "@/lib/openclaw_integration";

// =============================================================================
// CLIENT CLASS
// =============================================================================

export class OpenClawIntegrationClient {
  private static instance: OpenClawIntegrationClient | null = null;
  private ipcRenderer: IpcRenderer;

  private constructor() {
    // @ts-ignore - window.electron is injected by preload
    this.ipcRenderer = window.electron?.ipcRenderer;
  }

  static getInstance(): OpenClawIntegrationClient {
    if (!OpenClawIntegrationClient.instance) {
      OpenClawIntegrationClient.instance = new OpenClawIntegrationClient();
    }
    return OpenClawIntegrationClient.instance;
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  async initialize(config?: Partial<OpenClawIntegrationConfig>): Promise<{ success: boolean; connected: boolean }> {
    return this.ipcRenderer.invoke("openclaw:initialize", config);
  }

  async shutdown(): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:shutdown");
  }

  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  async getConfig(): Promise<OpenClawIntegrationConfig> {
    return this.ipcRenderer.invoke("openclaw:config:get");
  }

  async updateConfig(updates: Partial<OpenClawIntegrationConfig>): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:config:update", updates);
  }

  // ===========================================================================
  // GATEWAY MANAGEMENT
  // ===========================================================================

  async getGatewayStatus(): Promise<OpenClawGatewayStatus | null> {
    return this.ipcRenderer.invoke("openclaw:gateway:status");
  }

  async getGatewayHealth(): Promise<OpenClawHealthStatus | null> {
    return this.ipcRenderer.invoke("openclaw:gateway:health");
  }

  async startGateway(): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:gateway:start");
  }

  async stopGateway(): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:gateway:stop");
  }

  async restartGateway(): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:gateway:restart");
  }

  async getConnectionStatus(): Promise<{ connected: boolean; status: "connected" | "disconnected" | "connecting" | "error" }> {
    return this.ipcRenderer.invoke("openclaw:connection:status");
  }

  // ===========================================================================
  // AGENT INTERFACE
  // ===========================================================================

  async runAgent(request: OpenClawAgentRequest): Promise<OpenClawAgentResponse> {
    return this.ipcRenderer.invoke("openclaw:agent:run", request);
  }

  // ===========================================================================
  // MESSAGING
  // ===========================================================================

  async sendMessage(request: OpenClawMessageRequest): Promise<OpenClawMessageResponse> {
    return this.ipcRenderer.invoke("openclaw:message:send", request);
  }

  async broadcastMessage(request: OpenClawBroadcastRequest): Promise<OpenClawMessageResponse[]> {
    return this.ipcRenderer.invoke("openclaw:message:broadcast", request);
  }

  async readMessages(
    target: string,
    channel?: OpenClawChannel,
    limit?: number
  ): Promise<unknown[]> {
    return this.ipcRenderer.invoke("openclaw:message:read", target, channel, limit);
  }

  // ===========================================================================
  // MEMORY
  // ===========================================================================

  async searchMemory(request: OpenClawMemorySearchRequest): Promise<OpenClawMemoryResult[]> {
    return this.ipcRenderer.invoke("openclaw:memory:search", request);
  }

  // ===========================================================================
  // CHANNELS
  // ===========================================================================

  async getChannels(): Promise<OpenClawChannelStatus[]> {
    return this.ipcRenderer.invoke("openclaw:channels:list");
  }

  async configureChannel(channel: OpenClawChannel): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:channels:configure", channel);
  }

  // ===========================================================================
  // PLUGINS
  // ===========================================================================

  async listPlugins(): Promise<OpenClawPlugin[]> {
    return this.ipcRenderer.invoke("openclaw:plugins:list");
  }

  async installPlugin(pluginId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:plugins:install", pluginId);
  }

  async uninstallPlugin(pluginId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:plugins:uninstall", pluginId);
  }

  async enablePlugin(pluginId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:plugins:enable", pluginId);
  }

  async disablePlugin(pluginId: string): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("openclaw:plugins:disable", pluginId);
  }

  // ===========================================================================
  // DIAGNOSTICS
  // ===========================================================================

  async runDoctor(): Promise<unknown> {
    return this.ipcRenderer.invoke("openclaw:doctor");
  }

  // ===========================================================================
  // EVENT SUBSCRIPTIONS
  // ===========================================================================

  /**
   * Subscribe to OpenClaw events
   * Returns an unsubscribe function
   */
  onEvent(
    event: string,
    callback: (data: unknown) => void
  ): () => void {
    const channel = `openclaw:event:${event}` as any;
    // @ts-ignore - The preload exposes a custom `on` that returns unsubscribe
    return this.ipcRenderer.on(channel, callback);
  }

  onConnected(callback: () => void): () => void {
    return this.onEvent("connected", callback);
  }

  onDisconnected(callback: () => void): () => void {
    return this.onEvent("disconnected", callback);
  }

  onError(callback: (error: unknown) => void): () => void {
    return this.onEvent("error", callback);
  }

  onAgentThinking(callback: (data: { content: string }) => void): () => void {
    return this.onEvent("agent-thinking", callback as (data: unknown) => void);
  }

  onAgentToolCall(callback: (data: unknown) => void): () => void {
    return this.onEvent("agent-tool-call", callback);
  }

  onAgentResponse(callback: (data: { content: string }) => void): () => void {
    return this.onEvent("agent-response", callback as (data: unknown) => void);
  }

  onAgentCompleted(callback: (response: OpenClawAgentResponse) => void): () => void {
    return this.onEvent("agent-completed", callback as (data: unknown) => void);
  }

  onMessageReceived(callback: (message: unknown) => void): () => void {
    return this.onEvent("message-received", callback);
  }

  onMessageSent(callback: (message: unknown) => void): () => void {
    return this.onEvent("message-sent", callback);
  }

  onChannelConnected(callback: (data: unknown) => void): () => void {
    return this.onEvent("channel-connected", callback);
  }

  onChannelDisconnected(callback: (data: unknown) => void): () => void {
    return this.onEvent("channel-disconnected", callback);
  }

  onPluginInstalled(callback: (data: { pluginId: string }) => void): () => void {
    return this.onEvent("plugin-installed", callback as (data: unknown) => void);
  }

  onPluginUninstalled(callback: (data: { pluginId: string }) => void): () => void {
    return this.onEvent("plugin-uninstalled", callback as (data: unknown) => void);
  }

  onPluginEnabled(callback: (data: { pluginId: string }) => void): () => void {
    return this.onEvent("plugin-enabled", callback as (data: unknown) => void);
  }

  onPluginDisabled(callback: (data: { pluginId: string }) => void): () => void {
    return this.onEvent("plugin-disabled", callback as (data: unknown) => void);
  }

  onConfigUpdated(callback: (config: OpenClawIntegrationConfig) => void): () => void {
    return this.onEvent("config-updated", callback as (data: unknown) => void);
  }

  onGatewayStarted(callback: () => void): () => void {
    return this.onEvent("gateway-started", callback);
  }

  onGatewayStopped(callback: () => void): () => void {
    return this.onEvent("gateway-stopped", callback);
  }

  onGatewayRestarted(callback: () => void): () => void {
    return this.onEvent("gateway-restarted", callback);
  }

  onReconnectFailed(callback: () => void): () => void {
    return this.onEvent("reconnect-failed", callback);
  }

  onWarning(callback: (data: { message: string }) => void): () => void {
    return this.onEvent("warning", callback as (data: unknown) => void);
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const openClawIntegrationClient = OpenClawIntegrationClient.getInstance();
