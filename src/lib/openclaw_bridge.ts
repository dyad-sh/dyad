/**
 * OpenClaw Bridge for Autonomous Agents
 * 
 * Integrates OpenClaw as the central nervous system for JoyCreate's
 * autonomous agent system. This bridge allows agents to:
 * - Send messages across all OpenClaw channels
 * - Use OpenClaw's AI inference with thinking levels
 * - Access OpenClaw's memory system
 * - Leverage OpenClaw plugins
 * - Coordinate multi-agent tasks via OpenClaw Gateway
 * 
 * 🦞 The Claw is the nervous system - agents are the appendages!
 */

import { EventEmitter } from "node:events";
import log from "electron-log";
import {
  getOpenClawIntegration,
  type OpenClawIntegrationService,
  type OpenClawAgentRequest,
  type OpenClawAgentResponse,
  type OpenClawChannel,
  type OpenClawThinkingLevel,
  type OpenClawMessageRequest,
  type OpenClawMemorySearchRequest,
  type OpenClawMemoryResult,
} from "@/lib/openclaw_integration";
import type { AutonomousAgentId, MissionId } from "@/lib/autonomous_agent";

const logger = log.scope("openclaw_bridge");

// =============================================================================
// TYPES
// =============================================================================

export interface OpenClawBridgeConfig {
  defaultThinking: OpenClawThinkingLevel;
  defaultChannel: OpenClawChannel;
  enableMemoryPersistence: boolean;
  maxConcurrentAgentTurns: number;
  agentTimeout: number;
}

export interface AgentOpenClawSession {
  agentId: AutonomousAgentId;
  openClawSessionId?: string;
  channel: OpenClawChannel;
  thinkingLevel: OpenClawThinkingLevel;
  conversationHistory: AgentMessage[];
  memoryContext: OpenClawMemoryResult[];
  startedAt: number;
  lastActivityAt: number;
}

export interface AgentMessage {
  role: "agent" | "openclaw" | "user" | "system";
  content: string;
  thinking?: string;
  timestamp: number;
  missionId?: MissionId;
  channel?: OpenClawChannel;
}

export interface AgentInferenceRequest {
  agentId: AutonomousAgentId;
  missionId?: MissionId;
  message: string;
  thinking?: OpenClawThinkingLevel;
  systemPrompt?: string;
  includeMemory?: boolean;
  memoryQuery?: string;
  deliverResponse?: boolean;
  deliveryTarget?: string;
  deliveryChannel?: OpenClawChannel;
}

export interface AgentInferenceResult {
  agentId: AutonomousAgentId;
  sessionId: string;
  reply: string;
  thinking?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
    output?: unknown;
  }>;
  memoryUsed: OpenClawMemoryResult[];
  tokens: {
    input: number;
    output: number;
    thinking?: number;
  };
  duration: number;
  delivered?: boolean;
}

export interface AgentNotification {
  agentId: AutonomousAgentId;
  target: string;
  channel: OpenClawChannel;
  message: string;
  priority: "low" | "normal" | "high" | "urgent";
  missionId?: MissionId;
}

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

export const DEFAULT_OPENCLAW_BRIDGE_CONFIG: OpenClawBridgeConfig = {
  defaultThinking: "medium",
  defaultChannel: "whatsapp",
  enableMemoryPersistence: true,
  maxConcurrentAgentTurns: 5,
  agentTimeout: 600, // 10 minutes
};

// =============================================================================
// OPENCLAW BRIDGE
// =============================================================================

export class OpenClawBridge extends EventEmitter {
  private static instance: OpenClawBridge | null = null;
  
  private config: OpenClawBridgeConfig;
  private openClaw: OpenClawIntegrationService | null = null;
  private sessions = new Map<AutonomousAgentId, AgentOpenClawSession>();
  private pendingTurns = new Map<string, AbortController>();
  private initialized = false;

  private constructor() {
    super();
    this.config = { ...DEFAULT_OPENCLAW_BRIDGE_CONFIG };
  }

  static getInstance(): OpenClawBridge {
    if (!OpenClawBridge.instance) {
      OpenClawBridge.instance = new OpenClawBridge();
    }
    return OpenClawBridge.instance;
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  async initialize(config?: Partial<OpenClawBridgeConfig>): Promise<void> {
    if (this.initialized) {
      logger.warn("OpenClaw Bridge already initialized");
      return;
    }

    logger.info("🦞 Initializing OpenClaw Bridge for Autonomous Agents...");

    if (config) {
      this.config = { ...this.config, ...config };
    }

    // Get the OpenClaw integration service
    this.openClaw = getOpenClawIntegration();

    // Set up event listeners
    this.setupEventListeners();

    this.initialized = true;
    logger.info("🦞 OpenClaw Bridge initialized - agents can now use the nervous system!");
  }

  private setupEventListeners(): void {
    if (!this.openClaw) return;

    // Forward relevant events
    this.openClaw.on("message-received", (data) => {
      this.handleIncomingMessage(data);
    });

    this.openClaw.on("agent-completed", (response) => {
      this.emit("inference-completed", response);
    });

    this.openClaw.on("agent-thinking", (data) => {
      this.emit("agent-thinking", data);
    });

    this.openClaw.on("agent-tool-call", (data) => {
      this.emit("agent-tool-call", data);
    });

    this.openClaw.on("error", (error) => {
      logger.error("OpenClaw error:", error);
      this.emit("error", error);
    });
  }

  private handleIncomingMessage(data: unknown): void {
    // Route incoming messages to the appropriate agent session
    const message = data as { sessionId?: string; content: string; channel: OpenClawChannel };
    
    // Find the session by OpenClaw session ID
    for (const [agentId, session] of this.sessions) {
      if (session.openClawSessionId === message.sessionId) {
        this.emit("message-for-agent", {
          agentId,
          message: message.content,
          channel: message.channel,
        });
        break;
      }
    }
  }

  // ===========================================================================
  // AGENT SESSION MANAGEMENT
  // ===========================================================================

  /**
   * Create or get an OpenClaw session for an agent
   */
  getOrCreateSession(
    agentId: AutonomousAgentId,
    options?: {
      channel?: OpenClawChannel;
      thinking?: OpenClawThinkingLevel;
    }
  ): AgentOpenClawSession {
    let session = this.sessions.get(agentId);

    if (!session) {
      session = {
        agentId,
        channel: options?.channel ?? this.config.defaultChannel,
        thinkingLevel: options?.thinking ?? this.config.defaultThinking,
        conversationHistory: [],
        memoryContext: [],
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
      };
      this.sessions.set(agentId, session);
      logger.info(`Created OpenClaw session for agent ${agentId}`);
    }

    return session;
  }

  /**
   * Close an agent's OpenClaw session
   */
  closeSession(agentId: AutonomousAgentId): void {
    const session = this.sessions.get(agentId);
    if (session) {
      this.sessions.delete(agentId);
      logger.info(`Closed OpenClaw session for agent ${agentId}`);
      this.emit("session-closed", { agentId });
    }
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): AgentOpenClawSession[] {
    return Array.from(this.sessions.values());
  }

  // ===========================================================================
  // AI INFERENCE
  // ===========================================================================

  /**
   * Run an agent inference turn through OpenClaw
   */
  async runAgentInference(request: AgentInferenceRequest): Promise<AgentInferenceResult> {
    if (!this.openClaw) {
      throw new Error("OpenClaw Bridge not initialized");
    }

    const session = this.getOrCreateSession(request.agentId, {
      thinking: request.thinking,
    });

    // Build the full message with context
    let fullMessage = request.message;

    // Add system prompt if provided
    if (request.systemPrompt) {
      fullMessage = `[System]: ${request.systemPrompt}\n\n${fullMessage}`;
    }

    // Optionally search memory and include context
    let memoryResults: OpenClawMemoryResult[] = [];
    if (request.includeMemory && request.memoryQuery) {
      try {
        memoryResults = await this.openClaw.searchMemory({
          query: request.memoryQuery,
          sessionId: session.openClawSessionId,
          limit: 5,
        });

        if (memoryResults.length > 0) {
          const memoryContext = memoryResults
            .map((m) => `[Memory: ${m.score.toFixed(2)}] ${m.content}`)
            .join("\n");
          fullMessage = `[Relevant Context]:\n${memoryContext}\n\n[Request]:\n${fullMessage}`;
        }
      } catch (error) {
        logger.warn("Failed to fetch memory context:", error);
      }
    }

    // Prepare OpenClaw agent request
    const clawRequest: OpenClawAgentRequest = {
      message: fullMessage,
      sessionId: session.openClawSessionId,
      thinking: request.thinking ?? session.thinkingLevel,
      deliver: request.deliverResponse,
      replyTo: request.deliveryTarget,
      replyChannel: request.deliveryChannel,
      timeout: this.config.agentTimeout,
    };

    logger.info(`Running inference for agent ${request.agentId}`, {
      messageLength: fullMessage.length,
      thinking: clawRequest.thinking,
      includesMemory: memoryResults.length > 0,
    });

    const startTime = Date.now();

    // Run the agent turn
    const response = await this.openClaw.runAgent(clawRequest);

    // Update session
    session.openClawSessionId = response.sessionId;
    session.lastActivityAt = Date.now();
    session.memoryContext = memoryResults;

    // Add to conversation history
    session.conversationHistory.push({
      role: "agent",
      content: request.message,
      timestamp: startTime,
      missionId: request.missionId,
    });

    session.conversationHistory.push({
      role: "openclaw",
      content: response.reply,
      thinking: response.thinking,
      timestamp: Date.now(),
    });

    const result: AgentInferenceResult = {
      agentId: request.agentId,
      sessionId: response.sessionId,
      reply: response.reply,
      thinking: response.thinking,
      toolCalls: response.toolCalls,
      memoryUsed: memoryResults,
      tokens: response.tokens ?? { input: 0, output: 0 },
      duration: response.duration,
      delivered: response.delivered,
    };

    this.emit("inference-result", result);
    return result;
  }

  // ===========================================================================
  // MESSAGING
  // ===========================================================================

  /**
   * Send a notification from an agent via OpenClaw channels
   */
  async sendAgentNotification(notification: AgentNotification): Promise<void> {
    if (!this.openClaw) {
      throw new Error("OpenClaw Bridge not initialized");
    }

    const priorityPrefix = {
      low: "",
      normal: "",
      high: "⚠️ ",
      urgent: "🚨 URGENT: ",
    };

    const message = `${priorityPrefix[notification.priority]}[Agent: ${notification.agentId}] ${notification.message}`;

    const request: OpenClawMessageRequest = {
      target: notification.target,
      message,
      channel: notification.channel,
    };

    await this.openClaw.sendMessage(request);

    logger.info(`Agent ${notification.agentId} sent notification to ${notification.target}`);
    this.emit("notification-sent", notification);
  }

  /**
   * Broadcast from an agent to multiple targets
   */
  async broadcastFromAgent(
    agentId: AutonomousAgentId,
    targets: string[],
    message: string,
    channel?: OpenClawChannel
  ): Promise<void> {
    if (!this.openClaw) {
      throw new Error("OpenClaw Bridge not initialized");
    }

    const fullMessage = `[Agent: ${agentId}] ${message}`;

    await this.openClaw.broadcastMessage({
      targets,
      message: fullMessage,
      channel: channel ?? this.config.defaultChannel,
    });

    logger.info(`Agent ${agentId} broadcast to ${targets.length} targets`);
  }

  // ===========================================================================
  // MEMORY
  // ===========================================================================

  /**
   * Search OpenClaw memory on behalf of an agent
   */
  async searchMemoryForAgent(
    agentId: AutonomousAgentId,
    query: string,
    limit?: number
  ): Promise<OpenClawMemoryResult[]> {
    if (!this.openClaw) {
      throw new Error("OpenClaw Bridge not initialized");
    }

    const session = this.sessions.get(agentId);

    const request: OpenClawMemorySearchRequest = {
      query,
      sessionId: session?.openClawSessionId,
      limit: limit ?? 10,
    };

    const results = await this.openClaw.searchMemory(request);

    logger.info(`Memory search for agent ${agentId}: found ${results.length} results`);
    return results;
  }

  // ===========================================================================
  // COORDINATION
  // ===========================================================================

  /**
   * Coordinate multiple agents via OpenClaw
   * Useful for swarm tasks where agents need to communicate
   */
  async coordinateAgents(
    agentIds: AutonomousAgentId[],
    coordinationMessage: string,
    thinking: OpenClawThinkingLevel = "high"
  ): Promise<Map<AutonomousAgentId, AgentInferenceResult>> {
    const results = new Map<AutonomousAgentId, AgentInferenceResult>();

    // Run all agents in parallel with coordination context
    const promises = agentIds.map(async (agentId) => {
      const contextMessage = `[Multi-Agent Coordination]\n` +
        `Participating agents: ${agentIds.join(", ")}\n` +
        `Your ID: ${agentId}\n\n` +
        `Coordination Task:\n${coordinationMessage}`;

      const result = await this.runAgentInference({
        agentId,
        message: contextMessage,
        thinking,
      });

      results.set(agentId, result);
    });

    await Promise.all(promises);

    this.emit("coordination-completed", {
      agentIds,
      results: Array.from(results.entries()),
    });

    return results;
  }

  // ===========================================================================
  // UTILITY
  // ===========================================================================

  /**
   * Check if OpenClaw is available for agent use
   */
  isAvailable(): boolean {
    return this.initialized && this.openClaw?.isGatewayConnected() === true;
  }

  /**
   * Get bridge statistics
   */
  getStats(): {
    activeSessions: number;
    totalInferences: number;
    pendingTurns: number;
    isConnected: boolean;
  } {
    return {
      activeSessions: this.sessions.size,
      totalInferences: Array.from(this.sessions.values())
        .reduce((sum, s) => sum + s.conversationHistory.filter((m) => m.role === "openclaw").length, 0),
      pendingTurns: this.pendingTurns.size,
      isConnected: this.openClaw?.isGatewayConnected() ?? false,
    };
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

let bridgeInstance: OpenClawBridge | null = null;

export function getOpenClawBridge(): OpenClawBridge {
  if (!bridgeInstance) {
    bridgeInstance = OpenClawBridge.getInstance();
  }
  return bridgeInstance;
}

export async function initializeOpenClawBridge(
  config?: Partial<OpenClawBridgeConfig>
): Promise<OpenClawBridge> {
  const bridge = getOpenClawBridge();
  await bridge.initialize(config);
  return bridge;
}
