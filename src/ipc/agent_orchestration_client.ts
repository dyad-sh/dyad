/**
 * Agent Orchestration Client
 * Renderer-side client for the autonomous meta-agent orchestration system
 *
 * This is distinct from orchestrator_client.ts which handles the legacy
 * orchestrator_core workflow engine. This client handles the new autonomous
 * meta-agent orchestration layer that unifies Swarm + Autonomous + Factory + CNS.
 */

import type {
  OrchestrationId,
  OrchestrationStatus,
  SubmitTaskRequest,
  SubmitTaskResponse,
  Orchestration,
  OrchestratorDashboard,
  MetaAgent,
  AgentTemplate,
  ExecutionConfig,
  CommunicationConfig,
  LongTermTaskConfig,
  SystemStatus,
  OrchestratorEvent,
  OrchestratorInput,
} from "@/types/agent_orchestrator";

// =============================================================================
// AUTONOMOUS ORCHESTRATION CLIENT
// =============================================================================

class AgentOrchestrationClient {
  private static instance: AgentOrchestrationClient;

  static getInstance(): AgentOrchestrationClient {
    if (!AgentOrchestrationClient.instance) {
      AgentOrchestrationClient.instance = new AgentOrchestrationClient();
    }
    return AgentOrchestrationClient.instance;
  }

  private invoke(channel: string, ...args: unknown[]): Promise<any> {
    return window.electron.ipcRenderer.invoke(channel as any, ...args);
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  async initialize(): Promise<{ success: boolean }> {
    return this.invoke("orchestrator:initialize");
  }

  async shutdown(): Promise<{ success: boolean }> {
    return this.invoke("orchestrator:shutdown");
  }

  async getStatus(): Promise<SystemStatus> {
    return this.invoke("orchestrator:status");
  }

  // ===========================================================================
  // CORE — SUBMIT TASK
  // ===========================================================================

  async submitTask(request: SubmitTaskRequest): Promise<SubmitTaskResponse> {
    return this.invoke("orchestrator:submit-task", request);
  }

  /** Convenience: submit a text task */
  async submitTextTask(text: string, config?: Partial<ExecutionConfig>): Promise<SubmitTaskResponse> {
    const input: OrchestratorInput = {
      modality: "text",
      text,
    };
    return this.submitTask({ input, executionConfig: config });
  }

  /** Convenience: submit a voice task */
  async submitVoiceTask(audioPath: string, config?: Partial<ExecutionConfig>): Promise<SubmitTaskResponse> {
    const input: OrchestratorInput = {
      modality: "voice",
      text: "",
      audioPath,
    };
    return this.submitTask({ input, executionConfig: config });
  }

  // ===========================================================================
  // ORCHESTRATION CRUD
  // ===========================================================================

  async getOrchestration(id: string): Promise<Orchestration> {
    return this.invoke("orchestrator:get", id);
  }

  async listOrchestrations(filter?: {
    status?: OrchestrationStatus;
    limit?: number;
  }): Promise<Orchestration[]> {
    return this.invoke("orchestrator:list", filter);
  }

  async cancelOrchestration(id: string): Promise<{ success: boolean }> {
    return this.invoke("orchestrator:cancel", id);
  }

  async pauseOrchestration(id: string): Promise<{ success: boolean }> {
    return this.invoke("orchestrator:pause", id);
  }

  async resumeOrchestration(id: string): Promise<{ success: boolean }> {
    return this.invoke("orchestrator:resume", id);
  }

  // ===========================================================================
  // DASHBOARD
  // ===========================================================================

  async getDashboard(): Promise<OrchestratorDashboard> {
    return this.invoke("orchestrator:dashboard");
  }

  // ===========================================================================
  // META-AGENT
  // ===========================================================================

  async getMetaAgent(): Promise<MetaAgent | null> {
    return this.invoke("orchestrator:meta-agent");
  }

  // ===========================================================================
  // TEMPLATES
  // ===========================================================================

  async getTemplates(): Promise<AgentTemplate[]> {
    return this.invoke("orchestrator:templates");
  }

  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  async getExecutionConfig(): Promise<ExecutionConfig> {
    return this.invoke("orchestrator:config:execution:get");
  }

  async updateExecutionConfig(updates: Partial<ExecutionConfig>): Promise<ExecutionConfig> {
    return this.invoke("orchestrator:config:execution:update", updates);
  }

  async getCommunicationConfig(): Promise<CommunicationConfig> {
    return this.invoke("orchestrator:config:communication:get");
  }

  async updateCommunicationConfig(updates: Partial<CommunicationConfig>): Promise<CommunicationConfig> {
    return this.invoke("orchestrator:config:communication:update", updates);
  }

  async getLongTermConfig(): Promise<LongTermTaskConfig> {
    return this.invoke("orchestrator:config:longterm:get");
  }

  async updateLongTermConfig(updates: Partial<LongTermTaskConfig>): Promise<LongTermTaskConfig> {
    return this.invoke("orchestrator:config:longterm:update", updates);
  }

  // ===========================================================================
  // EVENT SUBSCRIPTION
  // ===========================================================================

  async subscribe(): Promise<{ success: boolean }> {
    return this.invoke("orchestrator:subscribe");
  }

  onEvent(callback: (event: OrchestratorEvent) => void): () => void {
    window.electron.ipcRenderer.on("orchestrator:event" as any, callback as any);
    return () => {
      window.electron.ipcRenderer.removeListener("orchestrator:event" as any, callback as any);
    };
  }
}

export const agentOrchestrationClient = AgentOrchestrationClient.getInstance();
export default agentOrchestrationClient;
