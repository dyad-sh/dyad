/**
 * Agent Swarm IPC Client
 * Renderer-side API for the self-replicating agent system
 */

import type {
  SwarmId,
  AgentNodeId,
  WitnessId,
  MessageId,
  KnowledgeId,
  Swarm,
  AgentNode,
  Witness,
  AgentMessage,
  SharedKnowledge,
  Replication,
  SwarmConfig,
  SpawnRequest,
  ReplicationRequest,
  WitnessMode,
  MessageType,
  KnowledgeType,
  TaskAssignment,
  SwarmEvent,
  SwarmMetrics,
  AgentMetrics,
  WitnessObservation,
  WitnessInsight,
  ReplicationStrategy,
  AgentRole,
  TaskType,
  AgentNodeStatus,
  SwarmStatus,
  SwarmEventType,
} from "@/lib/agent_swarm";

// Re-export types for convenience
export type {
  SwarmId,
  AgentNodeId,
  WitnessId,
  MessageId,
  KnowledgeId,
  Swarm,
  AgentNode,
  Witness,
  AgentMessage,
  SharedKnowledge,
  Replication,
  SwarmConfig,
  SpawnRequest,
  ReplicationRequest,
  WitnessMode,
  MessageType,
  KnowledgeType,
  TaskAssignment,
  SwarmEvent,
  SwarmMetrics,
  AgentMetrics,
  WitnessObservation,
  WitnessInsight,
  ReplicationStrategy,
  AgentRole,
  TaskType,
  AgentNodeStatus,
  SwarmStatus,
  SwarmEventType,
};

function getIpcRenderer() {
  const ipc = (window as any).electron?.ipcRenderer;
  if (!ipc) {
    throw new Error("IPC not available - not running in Electron");
  }
  return ipc;
}

// =============================================================================
// AGENT SWARM CLIENT
// =============================================================================

class AgentSwarmClient {
  private static instance: AgentSwarmClient | null = null;
  private eventListeners: Set<(event: SwarmEvent) => void> = new Set();
  private subscribed = false;

  private constructor() {
    // Set up event listener from main process
    try {
      const ipc = getIpcRenderer();
      ipc.on("agent-swarm:event", (_event: unknown, swarmEvent: SwarmEvent) => {
        this.eventListeners.forEach((listener) => {
          try {
            listener(swarmEvent);
          } catch (e) {
            console.error("Error in swarm event listener:", e);
          }
        });
      });
    } catch {
      // Not in Electron environment
    }
  }

  static getInstance(): AgentSwarmClient {
    if (!AgentSwarmClient.instance) {
      AgentSwarmClient.instance = new AgentSwarmClient();
    }
    return AgentSwarmClient.instance;
  }

  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    await getIpcRenderer().invoke("agent-swarm:initialize");
  }

  async shutdown(): Promise<void> {
    await getIpcRenderer().invoke("agent-swarm:shutdown");
  }

  // ---------------------------------------------------------------------------
  // SWARM MANAGEMENT
  // ---------------------------------------------------------------------------

  async createSwarm(
    name: string,
    description?: string,
    config?: Partial<SwarmConfig>
  ): Promise<Swarm> {
    return getIpcRenderer().invoke("agent-swarm:create-swarm", name, description, config);
  }

  async getSwarm(swarmId: SwarmId): Promise<Swarm | null> {
    return getIpcRenderer().invoke("agent-swarm:get-swarm", swarmId);
  }

  async listSwarms(): Promise<Swarm[]> {
    return getIpcRenderer().invoke("agent-swarm:list-swarms");
  }

  async updateSwarm(
    swarmId: SwarmId,
    updates: Partial<{ name: string; description: string; config: Partial<SwarmConfig> }>
  ): Promise<Swarm> {
    return getIpcRenderer().invoke("agent-swarm:update-swarm", swarmId, updates);
  }

  async startSwarm(swarmId: SwarmId): Promise<void> {
    await getIpcRenderer().invoke("agent-swarm:start-swarm", swarmId);
  }

  async pauseSwarm(swarmId: SwarmId): Promise<void> {
    await getIpcRenderer().invoke("agent-swarm:pause-swarm", swarmId);
  }

  async terminateSwarm(swarmId: SwarmId): Promise<void> {
    await getIpcRenderer().invoke("agent-swarm:terminate-swarm", swarmId);
  }

  async deleteSwarm(swarmId: SwarmId): Promise<void> {
    await getIpcRenderer().invoke("agent-swarm:delete-swarm", swarmId);
  }

  // ---------------------------------------------------------------------------
  // AGENT SPAWNING & MANAGEMENT
  // ---------------------------------------------------------------------------

  async spawnAgent(
    swarmId: SwarmId,
    request: SpawnRequest,
    parentId?: AgentNodeId
  ): Promise<AgentNode> {
    return getIpcRenderer().invoke("agent-swarm:spawn-agent", swarmId, request, parentId);
  }

  async getAgent(agentId: AgentNodeId): Promise<AgentNode | null> {
    return getIpcRenderer().invoke("agent-swarm:get-agent", agentId);
  }

  async listAgents(swarmId: SwarmId): Promise<AgentNode[]> {
    return getIpcRenderer().invoke("agent-swarm:list-agents", swarmId);
  }

  async getAgentChildren(agentId: AgentNodeId): Promise<AgentNode[]> {
    return getIpcRenderer().invoke("agent-swarm:get-agent-children", agentId);
  }

  async getAgentLineage(agentId: AgentNodeId): Promise<AgentNode[]> {
    return getIpcRenderer().invoke("agent-swarm:get-agent-lineage", agentId);
  }

  async updateAgent(
    agentId: AgentNodeId,
    updates: Partial<{ name: string; config: any; resources: any }>
  ): Promise<AgentNode> {
    return getIpcRenderer().invoke("agent-swarm:update-agent", agentId, updates);
  }

  async startAgent(agentId: AgentNodeId): Promise<void> {
    await getIpcRenderer().invoke("agent-swarm:start-agent", agentId);
  }

  async stopAgent(agentId: AgentNodeId): Promise<void> {
    await getIpcRenderer().invoke("agent-swarm:stop-agent", agentId);
  }

  async terminateAgent(agentId: AgentNodeId): Promise<void> {
    await getIpcRenderer().invoke("agent-swarm:terminate-agent", agentId);
  }

  // ---------------------------------------------------------------------------
  // SELF-REPLICATION
  // ---------------------------------------------------------------------------

  async replicateAgent(
    agentId: AgentNodeId,
    request: ReplicationRequest
  ): Promise<AgentNode> {
    return getIpcRenderer().invoke("agent-swarm:replicate-agent", agentId, request);
  }

  async listReplications(agentId?: AgentNodeId): Promise<Replication[]> {
    return getIpcRenderer().invoke("agent-swarm:list-replications", agentId);
  }

  // ---------------------------------------------------------------------------
  // WITNESS SYSTEM
  // ---------------------------------------------------------------------------

  async startWitness(
    observerId: AgentNodeId,
    targetId: AgentNodeId,
    mode: WitnessMode
  ): Promise<Witness> {
    return getIpcRenderer().invoke("agent-swarm:start-witness", observerId, targetId, mode);
  }

  async recordObservation(
    witnessId: WitnessId,
    eventType: string,
    data: unknown,
    analysis?: string
  ): Promise<WitnessObservation> {
    return getIpcRenderer().invoke(
      "agent-swarm:record-observation",
      witnessId,
      eventType,
      data,
      analysis
    );
  }

  async addWitnessInsight(
    witnessId: WitnessId,
    type: KnowledgeType,
    content: string,
    confidence: number,
    sourceObservationIds: string[]
  ): Promise<WitnessInsight> {
    return getIpcRenderer().invoke(
      "agent-swarm:add-witness-insight",
      witnessId,
      type,
      content,
      confidence,
      sourceObservationIds
    );
  }

  async endWitness(witnessId: WitnessId): Promise<void> {
    await getIpcRenderer().invoke("agent-swarm:end-witness", witnessId);
  }

  async getWitness(witnessId: WitnessId): Promise<Witness | null> {
    return getIpcRenderer().invoke("agent-swarm:get-witness", witnessId);
  }

  async listWitnesses(agentId?: AgentNodeId): Promise<Witness[]> {
    return getIpcRenderer().invoke("agent-swarm:list-witnesses", agentId);
  }

  // ---------------------------------------------------------------------------
  // TASK MANAGEMENT
  // ---------------------------------------------------------------------------

  async assignTask(
    agentId: AgentNodeId,
    task: Omit<TaskAssignment, "id" | "status" | "createdAt">
  ): Promise<TaskAssignment> {
    return getIpcRenderer().invoke("agent-swarm:assign-task", agentId, task);
  }

  async delegateTask(
    fromAgentId: AgentNodeId,
    toAgentId: AgentNodeId,
    taskId: string
  ): Promise<void> {
    await getIpcRenderer().invoke("agent-swarm:delegate-task", fromAgentId, toAgentId, taskId);
  }

  async completeTask(
    agentId: AgentNodeId,
    taskId: string,
    output: unknown
  ): Promise<void> {
    await getIpcRenderer().invoke("agent-swarm:complete-task", agentId, taskId, output);
  }

  async failTask(
    agentId: AgentNodeId,
    taskId: string,
    error: string
  ): Promise<void> {
    await getIpcRenderer().invoke("agent-swarm:fail-task", agentId, taskId, error);
  }

  // ---------------------------------------------------------------------------
  // INTER-AGENT MESSAGING
  // ---------------------------------------------------------------------------

  async sendMessage(
    senderId: AgentNodeId | "system",
    recipientId: AgentNodeId | "broadcast",
    swarmId: SwarmId,
    type: MessageType,
    payload: unknown,
    options?: { priority?: number; requiresAck?: boolean }
  ): Promise<AgentMessage> {
    return getIpcRenderer().invoke(
      "agent-swarm:send-message",
      senderId,
      recipientId,
      swarmId,
      type,
      payload,
      options
    );
  }

  async acknowledgeMessage(messageId: MessageId): Promise<void> {
    await getIpcRenderer().invoke("agent-swarm:acknowledge-message", messageId);
  }

  async listMessages(agentId?: AgentNodeId, swarmId?: SwarmId): Promise<AgentMessage[]> {
    return getIpcRenderer().invoke("agent-swarm:list-messages", agentId, swarmId);
  }

  // ---------------------------------------------------------------------------
  // KNOWLEDGE SHARING
  // ---------------------------------------------------------------------------

  async shareKnowledge(
    contributorId: AgentNodeId,
    type: KnowledgeType,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<SharedKnowledge> {
    return getIpcRenderer().invoke(
      "agent-swarm:share-knowledge",
      contributorId,
      type,
      content,
      metadata
    );
  }

  async applyKnowledge(agentId: AgentNodeId, knowledgeId: KnowledgeId): Promise<void> {
    await getIpcRenderer().invoke("agent-swarm:apply-knowledge", agentId, knowledgeId);
  }

  async rateKnowledge(knowledgeId: KnowledgeId, rating: number): Promise<void> {
    await getIpcRenderer().invoke("agent-swarm:rate-knowledge", knowledgeId, rating);
  }

  async searchKnowledge(
    swarmId: SwarmId,
    query: string,
    type?: KnowledgeType
  ): Promise<SharedKnowledge[]> {
    return getIpcRenderer().invoke("agent-swarm:search-knowledge", swarmId, query, type);
  }

  async getKnowledge(knowledgeId: KnowledgeId): Promise<SharedKnowledge | null> {
    return getIpcRenderer().invoke("agent-swarm:get-knowledge", knowledgeId);
  }

  async listKnowledge(swarmId: SwarmId): Promise<SharedKnowledge[]> {
    return getIpcRenderer().invoke("agent-swarm:list-knowledge", swarmId);
  }

  // ---------------------------------------------------------------------------
  // STATISTICS & METRICS
  // ---------------------------------------------------------------------------

  async getSwarmStats(swarmId: SwarmId): Promise<SwarmMetrics & { details: any }> {
    return getIpcRenderer().invoke("agent-swarm:get-swarm-stats", swarmId);
  }

  async getAgentStats(agentId: AgentNodeId): Promise<AgentMetrics & { details: any }> {
    return getIpcRenderer().invoke("agent-swarm:get-agent-stats", agentId);
  }

  async getRecentEvents(swarmId: SwarmId, limit?: number): Promise<SwarmEvent[]> {
    return getIpcRenderer().invoke("agent-swarm:get-recent-events", swarmId, limit);
  }

  // ---------------------------------------------------------------------------
  // EVENT SUBSCRIPTIONS
  // ---------------------------------------------------------------------------

  async subscribe(): Promise<void> {
    if (!this.subscribed) {
      await getIpcRenderer().invoke("agent-swarm:subscribe");
      this.subscribed = true;
    }
  }

  async unsubscribe(): Promise<void> {
    if (this.subscribed) {
      await getIpcRenderer().invoke("agent-swarm:unsubscribe");
      this.subscribed = false;
    }
  }

  onEvent(callback: (event: SwarmEvent) => void): () => void {
    this.eventListeners.add(callback);
    return () => {
      this.eventListeners.delete(callback);
    };
  }
}

// Export singleton instance
export const agentSwarmClient = AgentSwarmClient.getInstance();

// Export class for testing
export { AgentSwarmClient };
