/**
 * Agent Swarm IPC Handlers
 * Handles all IPC communication for the self-replicating agent system
 */

import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from "electron";
import {
  getAgentSwarm,
  type SwarmId,
  type AgentNodeId,
  type WitnessId,
  type MessageId,
  type KnowledgeId,
  type Swarm,
  type SwarmConfig,
  type SpawnRequest,
  type ReplicationRequest,
  type WitnessMode,
  type MessageType,
  type KnowledgeType,
  type TaskAssignment,
  type SwarmEvent,
} from "@/lib/agent_swarm";

// Event subscription management
const eventSubscribers = new Map<number, () => void>();

export function registerAgentSwarmHandlers(): void {
  const swarm = getAgentSwarm();

  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  ipcMain.handle("agent-swarm:initialize", async () => {
    await swarm.initialize();
    return { success: true };
  });

  ipcMain.handle("agent-swarm:shutdown", async () => {
    await swarm.shutdown();
    return { success: true };
  });

  // ---------------------------------------------------------------------------
  // SWARM MANAGEMENT
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "agent-swarm:create-swarm",
    async (
      _event: IpcMainInvokeEvent,
      name: string,
      description?: string,
      config?: Partial<SwarmConfig>
    ) => {
      return swarm.createSwarm(name, description, config);
    }
  );

  ipcMain.handle(
    "agent-swarm:get-swarm",
    async (_event: IpcMainInvokeEvent, swarmId: SwarmId) => {
      return swarm.getSwarm(swarmId);
    }
  );

  ipcMain.handle("agent-swarm:list-swarms", async () => {
    return swarm.listSwarms();
  });

  ipcMain.handle(
    "agent-swarm:update-swarm",
    async (
      _event: IpcMainInvokeEvent,
      swarmId: SwarmId,
      updates: Partial<{ name: string; description: string; config: Partial<SwarmConfig> }>
    ) => {
      // Cast to the expected type - the lib handles partial config merging internally
      return swarm.updateSwarm(swarmId, updates as Partial<Pick<Swarm, "name" | "description" | "config">>);
    }
  );

  ipcMain.handle(
    "agent-swarm:start-swarm",
    async (_event: IpcMainInvokeEvent, swarmId: SwarmId) => {
      await swarm.startSwarm(swarmId);
      return { success: true };
    }
  );

  ipcMain.handle(
    "agent-swarm:pause-swarm",
    async (_event: IpcMainInvokeEvent, swarmId: SwarmId) => {
      await swarm.pauseSwarm(swarmId);
      return { success: true };
    }
  );

  ipcMain.handle(
    "agent-swarm:terminate-swarm",
    async (_event: IpcMainInvokeEvent, swarmId: SwarmId) => {
      await swarm.terminateSwarm(swarmId);
      return { success: true };
    }
  );

  ipcMain.handle(
    "agent-swarm:delete-swarm",
    async (_event: IpcMainInvokeEvent, swarmId: SwarmId) => {
      await swarm.deleteSwarm(swarmId);
      return { success: true };
    }
  );

  // ---------------------------------------------------------------------------
  // AGENT SPAWNING & MANAGEMENT
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "agent-swarm:spawn-agent",
    async (
      _event: IpcMainInvokeEvent,
      swarmId: SwarmId,
      request: SpawnRequest,
      parentId?: AgentNodeId
    ) => {
      return swarm.spawnAgent(swarmId, request, parentId);
    }
  );

  ipcMain.handle(
    "agent-swarm:get-agent",
    async (_event: IpcMainInvokeEvent, agentId: AgentNodeId) => {
      return swarm.getAgent(agentId);
    }
  );

  ipcMain.handle(
    "agent-swarm:list-agents",
    async (_event: IpcMainInvokeEvent, swarmId: SwarmId) => {
      return swarm.listAgents(swarmId);
    }
  );

  ipcMain.handle(
    "agent-swarm:get-agent-children",
    async (_event: IpcMainInvokeEvent, agentId: AgentNodeId) => {
      return swarm.getAgentChildren(agentId);
    }
  );

  ipcMain.handle(
    "agent-swarm:get-agent-lineage",
    async (_event: IpcMainInvokeEvent, agentId: AgentNodeId) => {
      return swarm.getAgentLineage(agentId);
    }
  );

  ipcMain.handle(
    "agent-swarm:update-agent",
    async (
      _event: IpcMainInvokeEvent,
      agentId: AgentNodeId,
      updates: Partial<{ name: string; config: any; resources: any }>
    ) => {
      return swarm.updateAgent(agentId, updates);
    }
  );

  ipcMain.handle(
    "agent-swarm:start-agent",
    async (_event: IpcMainInvokeEvent, agentId: AgentNodeId) => {
      await swarm.startAgent(agentId);
      return { success: true };
    }
  );

  ipcMain.handle(
    "agent-swarm:stop-agent",
    async (_event: IpcMainInvokeEvent, agentId: AgentNodeId) => {
      await swarm.stopAgent(agentId);
      return { success: true };
    }
  );

  ipcMain.handle(
    "agent-swarm:terminate-agent",
    async (_event: IpcMainInvokeEvent, agentId: AgentNodeId) => {
      await swarm.terminateAgent(agentId);
      return { success: true };
    }
  );

  // ---------------------------------------------------------------------------
  // SELF-REPLICATION
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "agent-swarm:replicate-agent",
    async (
      _event: IpcMainInvokeEvent,
      agentId: AgentNodeId,
      request: ReplicationRequest
    ) => {
      return swarm.replicateAgent(agentId, request);
    }
  );

  ipcMain.handle(
    "agent-swarm:list-replications",
    async (_event: IpcMainInvokeEvent, agentId?: AgentNodeId) => {
      return swarm.listReplications(agentId);
    }
  );

  // ---------------------------------------------------------------------------
  // WITNESS SYSTEM
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "agent-swarm:start-witness",
    async (
      _event: IpcMainInvokeEvent,
      observerId: AgentNodeId,
      targetId: AgentNodeId,
      mode: WitnessMode
    ) => {
      return swarm.startWitness(observerId, targetId, mode);
    }
  );

  ipcMain.handle(
    "agent-swarm:record-observation",
    async (
      _event: IpcMainInvokeEvent,
      witnessId: WitnessId,
      eventType: string,
      data: unknown,
      analysis?: string
    ) => {
      return swarm.recordObservation(witnessId, eventType, data, analysis);
    }
  );

  ipcMain.handle(
    "agent-swarm:add-witness-insight",
    async (
      _event: IpcMainInvokeEvent,
      witnessId: WitnessId,
      type: KnowledgeType,
      content: string,
      confidence: number,
      sourceObservationIds: string[]
    ) => {
      return swarm.addWitnessInsight(witnessId, type, content, confidence, sourceObservationIds);
    }
  );

  ipcMain.handle(
    "agent-swarm:end-witness",
    async (_event: IpcMainInvokeEvent, witnessId: WitnessId) => {
      await swarm.endWitness(witnessId);
      return { success: true };
    }
  );

  ipcMain.handle(
    "agent-swarm:get-witness",
    async (_event: IpcMainInvokeEvent, witnessId: WitnessId) => {
      return swarm.getWitness(witnessId);
    }
  );

  ipcMain.handle(
    "agent-swarm:list-witnesses",
    async (_event: IpcMainInvokeEvent, agentId?: AgentNodeId) => {
      return swarm.listWitnesses(agentId);
    }
  );

  // ---------------------------------------------------------------------------
  // TASK MANAGEMENT
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "agent-swarm:assign-task",
    async (
      _event: IpcMainInvokeEvent,
      agentId: AgentNodeId,
      task: Omit<TaskAssignment, "id" | "status" | "createdAt">
    ) => {
      return swarm.assignTask(agentId, task);
    }
  );

  ipcMain.handle(
    "agent-swarm:delegate-task",
    async (
      _event: IpcMainInvokeEvent,
      fromAgentId: AgentNodeId,
      toAgentId: AgentNodeId,
      taskId: string
    ) => {
      await swarm.delegateTask(fromAgentId, toAgentId, taskId);
      return { success: true };
    }
  );

  ipcMain.handle(
    "agent-swarm:complete-task",
    async (
      _event: IpcMainInvokeEvent,
      agentId: AgentNodeId,
      taskId: string,
      output: unknown
    ) => {
      await swarm.completeTask(agentId, taskId, output);
      return { success: true };
    }
  );

  ipcMain.handle(
    "agent-swarm:fail-task",
    async (
      _event: IpcMainInvokeEvent,
      agentId: AgentNodeId,
      taskId: string,
      error: string
    ) => {
      await swarm.failTask(agentId, taskId, error);
      return { success: true };
    }
  );

  // ---------------------------------------------------------------------------
  // INTER-AGENT MESSAGING
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "agent-swarm:send-message",
    async (
      _event: IpcMainInvokeEvent,
      senderId: AgentNodeId | "system",
      recipientId: AgentNodeId | "broadcast",
      swarmId: SwarmId,
      type: MessageType,
      payload: unknown,
      options?: { priority?: number; requiresAck?: boolean }
    ) => {
      return swarm.sendMessage(senderId, recipientId, swarmId, type, payload, options);
    }
  );

  ipcMain.handle(
    "agent-swarm:acknowledge-message",
    async (_event: IpcMainInvokeEvent, messageId: MessageId) => {
      await swarm.acknowledgeMessage(messageId);
      return { success: true };
    }
  );

  ipcMain.handle(
    "agent-swarm:list-messages",
    async (_event: IpcMainInvokeEvent, agentId?: AgentNodeId, swarmId?: SwarmId) => {
      return swarm.listMessages(agentId, swarmId);
    }
  );

  // ---------------------------------------------------------------------------
  // KNOWLEDGE SHARING
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "agent-swarm:share-knowledge",
    async (
      _event: IpcMainInvokeEvent,
      contributorId: AgentNodeId,
      type: KnowledgeType,
      content: string,
      metadata?: Record<string, unknown>
    ) => {
      return swarm.shareKnowledge(contributorId, type, content, metadata);
    }
  );

  ipcMain.handle(
    "agent-swarm:apply-knowledge",
    async (_event: IpcMainInvokeEvent, agentId: AgentNodeId, knowledgeId: KnowledgeId) => {
      await swarm.applyKnowledge(agentId, knowledgeId);
      return { success: true };
    }
  );

  ipcMain.handle(
    "agent-swarm:rate-knowledge",
    async (_event: IpcMainInvokeEvent, knowledgeId: KnowledgeId, rating: number) => {
      await swarm.rateKnowledge(knowledgeId, rating);
      return { success: true };
    }
  );

  ipcMain.handle(
    "agent-swarm:search-knowledge",
    async (
      _event: IpcMainInvokeEvent,
      swarmId: SwarmId,
      query: string,
      type?: KnowledgeType
    ) => {
      return swarm.searchKnowledge(swarmId, query, type);
    }
  );

  ipcMain.handle(
    "agent-swarm:get-knowledge",
    async (_event: IpcMainInvokeEvent, knowledgeId: KnowledgeId) => {
      return swarm.getKnowledge(knowledgeId);
    }
  );

  ipcMain.handle(
    "agent-swarm:list-knowledge",
    async (_event: IpcMainInvokeEvent, swarmId: SwarmId) => {
      return swarm.listKnowledge(swarmId);
    }
  );

  // ---------------------------------------------------------------------------
  // STATISTICS & METRICS
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "agent-swarm:get-swarm-stats",
    async (_event: IpcMainInvokeEvent, swarmId: SwarmId) => {
      return swarm.getSwarmStats(swarmId);
    }
  );

  ipcMain.handle(
    "agent-swarm:get-agent-stats",
    async (_event: IpcMainInvokeEvent, agentId: AgentNodeId) => {
      return swarm.getAgentStats(agentId);
    }
  );

  ipcMain.handle(
    "agent-swarm:get-recent-events",
    async (_event: IpcMainInvokeEvent, swarmId: SwarmId, limit?: number) => {
      return swarm.getRecentEvents(swarmId, limit);
    }
  );

  // ---------------------------------------------------------------------------
  // EVENT SUBSCRIPTIONS
  // ---------------------------------------------------------------------------

  ipcMain.handle("agent-swarm:subscribe", (event: IpcMainInvokeEvent) => {
    const webContentsId = event.sender.id;

    // Clean up existing subscription
    if (eventSubscribers.has(webContentsId)) {
      const unsub = eventSubscribers.get(webContentsId);
      unsub?.();
      eventSubscribers.delete(webContentsId);
    }

    // Create new subscription
    const callback = (swarmEvent: SwarmEvent) => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed()) {
          event.sender.send("agent-swarm:event", swarmEvent);
        }
      } catch {
        // Window closed, clean up
        const unsub = eventSubscribers.get(webContentsId);
        unsub?.();
        eventSubscribers.delete(webContentsId);
      }
    };

    const unsubscribe = swarm.subscribeToEvents(callback);
    eventSubscribers.set(webContentsId, unsubscribe);

    return { success: true };
  });

  ipcMain.handle("agent-swarm:unsubscribe", (event: IpcMainInvokeEvent) => {
    const webContentsId = event.sender.id;
    const unsub = eventSubscribers.get(webContentsId);
    if (unsub) {
      unsub();
      eventSubscribers.delete(webContentsId);
    }
    return { success: true };
  });
}
