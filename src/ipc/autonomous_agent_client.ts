/**
 * Autonomous Agent IPC Client
 * Renderer-side API for the fully autonomous AI system
 */

import type {
  AutonomousAgentId,
  MissionId,
  ArtifactId,
  AutonomousAgent,
  Mission,
  Artifact,
  MissionType,
  AgentConfiguration,
  AgentPerformanceMetrics,
  AutonomousAgentEvent,
  AutonomousAgentEventType,
  AgentLifecycleState,
  MissionStatus,
  CapabilityType,
  ArtifactType,
} from "@/lib/autonomous_agent";

// Re-export types for convenience
export type {
  AutonomousAgentId,
  MissionId,
  ArtifactId,
  AutonomousAgent,
  Mission,
  Artifact,
  MissionType,
  AgentConfiguration,
  AgentPerformanceMetrics,
  AutonomousAgentEvent,
  AutonomousAgentEventType,
  AgentLifecycleState,
  MissionStatus,
  CapabilityType,
  ArtifactType,
};

function getIpcRenderer() {
  const ipc = (window as any).electron?.ipcRenderer;
  if (!ipc) {
    throw new Error("IPC not available - not running in Electron");
  }
  return ipc;
}

// =============================================================================
// AUTONOMOUS AGENT CLIENT
// =============================================================================

class AutonomousAgentClient {
  private static instance: AutonomousAgentClient | null = null;
  private eventListeners: Set<(event: AutonomousAgentEvent) => void> = new Set();
  private inferenceListeners: Set<(request: any) => void> = new Set();
  private subscribed = false;

  private constructor() {
    // Set up event listener from main process
    try {
      const ipc = getIpcRenderer();
      ipc.on("autonomous-agent:event", (_event: unknown, agentEvent: AutonomousAgentEvent) => {
        for (const listener of this.eventListeners) {
          try {
            listener(agentEvent);
          } catch (error) {
            console.error("Error in autonomous agent event listener:", error);
          }
        }
      });
      
      // Listen for inference requests
      ipc.on("autonomous-agent:inference-request", (_event: unknown, request: any) => {
        for (const listener of this.inferenceListeners) {
          try {
            listener(request);
          } catch (error) {
            console.error("Error in inference request listener:", error);
          }
        }
      });
    } catch {
      // Not in Electron environment
    }
  }

  static getInstance(): AutonomousAgentClient {
    if (!AutonomousAgentClient.instance) {
      AutonomousAgentClient.instance = new AutonomousAgentClient();
    }
    return AutonomousAgentClient.instance;
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  async initialize(): Promise<void> {
    await getIpcRenderer().invoke("autonomous-agent:initialize");
  }

  async shutdown(): Promise<void> {
    await getIpcRenderer().invoke("autonomous-agent:shutdown");
  }

  // ===========================================================================
  // AGENT MANAGEMENT
  // ===========================================================================

  async createAgent(params: {
    name: string;
    purpose: string;
    config?: Partial<AgentConfiguration>;
    parentId?: AutonomousAgentId;
  }): Promise<AutonomousAgent> {
    return getIpcRenderer().invoke("autonomous-agent:create-agent", params);
  }

  async getAgent(agentId: AutonomousAgentId): Promise<AutonomousAgent | undefined> {
    return getIpcRenderer().invoke("autonomous-agent:get-agent", agentId);
  }

  async listAgents(): Promise<AutonomousAgent[]> {
    return getIpcRenderer().invoke("autonomous-agent:list-agents");
  }

  async activateAgent(agentId: AutonomousAgentId): Promise<void> {
    await getIpcRenderer().invoke("autonomous-agent:activate-agent", agentId);
  }

  async terminateAgent(agentId: AutonomousAgentId): Promise<void> {
    await getIpcRenderer().invoke("autonomous-agent:terminate-agent", agentId);
  }

  async replicateAgent(
    agentId: AutonomousAgentId,
    specialization?: string
  ): Promise<AutonomousAgent> {
    return getIpcRenderer().invoke("autonomous-agent:replicate-agent", agentId, specialization);
  }

  async getAgentStats(agentId: AutonomousAgentId): Promise<AgentPerformanceMetrics | undefined> {
    return getIpcRenderer().invoke("autonomous-agent:get-agent-stats", agentId);
  }

  // ===========================================================================
  // MISSION MANAGEMENT
  // ===========================================================================

  async createMission(params: {
    agentId: AutonomousAgentId;
    type: MissionType;
    objective: string;
    context?: string;
    constraints?: string[];
    successCriteria?: string[];
  }): Promise<Mission> {
    return getIpcRenderer().invoke("autonomous-agent:create-mission", params);
  }

  async getMission(missionId: MissionId): Promise<Mission | undefined> {
    return getIpcRenderer().invoke("autonomous-agent:get-mission", missionId);
  }

  async listMissions(agentId?: AutonomousAgentId): Promise<Mission[]> {
    return getIpcRenderer().invoke("autonomous-agent:list-missions", agentId);
  }

  // ===========================================================================
  // ARTIFACT MANAGEMENT
  // ===========================================================================

  async getArtifact(artifactId: ArtifactId): Promise<Artifact | undefined> {
    return getIpcRenderer().invoke("autonomous-agent:get-artifact", artifactId);
  }

  async listArtifacts(missionId?: MissionId): Promise<Artifact[]> {
    return getIpcRenderer().invoke("autonomous-agent:list-artifacts", missionId);
  }

  // ===========================================================================
  // VOICE CAPABILITIES
  // ===========================================================================

  async transcribeAudio(agentId: AutonomousAgentId, audioPath: string): Promise<string> {
    return getIpcRenderer().invoke("autonomous-agent:transcribe-audio", agentId, audioPath);
  }

  async synthesizeSpeech(agentId: AutonomousAgentId, text: string): Promise<string> {
    return getIpcRenderer().invoke("autonomous-agent:synthesize-speech", agentId, text);
  }

  // ===========================================================================
  // EVENTS
  // ===========================================================================

  async getRecentEvents(
    agentId: AutonomousAgentId,
    limit?: number
  ): Promise<AutonomousAgentEvent[]> {
    return getIpcRenderer().invoke("autonomous-agent:get-events", agentId, limit);
  }

  async subscribe(): Promise<void> {
    if (this.subscribed) return;
    await getIpcRenderer().invoke("autonomous-agent:subscribe");
    this.subscribed = true;
  }

  async unsubscribe(): Promise<void> {
    if (!this.subscribed) return;
    await getIpcRenderer().invoke("autonomous-agent:unsubscribe");
    this.subscribed = false;
  }

  onEvent(callback: (event: AutonomousAgentEvent) => void): () => void {
    this.eventListeners.add(callback);
    return () => {
      this.eventListeners.delete(callback);
    };
  }

  // ===========================================================================
  // INFERENCE HANDLING
  // ===========================================================================

  onInferenceRequest(callback: (request: any) => void): () => void {
    this.inferenceListeners.add(callback);
    return () => {
      this.inferenceListeners.delete(callback);
    };
  }

  async sendInferenceResponse(requestId: string, response: string): Promise<void> {
    await getIpcRenderer().invoke("autonomous-agent:inference-response", requestId, response);
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const autonomousAgentClient = AutonomousAgentClient.getInstance();
