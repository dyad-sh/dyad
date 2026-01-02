/**
 * n8n IPC Client
 * Renderer-side client for n8n workflow automation
 */

import type { IpcRenderer } from "electron";
import type {
  N8nWorkflow,
  N8nExecutionResult,
  WorkflowGenerationRequest,
  WorkflowGenerationResult,
  AgentMessage,
  AgentCollaboration,
} from "@/types/n8n_types";

// Database configuration type (mirrors the one in n8n_handlers.ts)
export interface N8nDatabaseConfig {
  type: "sqlite" | "postgresdb";
  postgresHost?: string;
  postgresPort?: number;
  postgresDatabase?: string;
  postgresUser?: string;
  postgresPassword?: string;
  postgresSchema?: string;
  postgresSsl?: boolean;
}

class N8nClient {
  private static instance: N8nClient;
  private ipcRenderer: IpcRenderer;

  private constructor() {
    this.ipcRenderer = (window as any).electron.ipcRenderer as IpcRenderer;
  }

  static getInstance(): N8nClient {
    if (!N8nClient.instance) {
      N8nClient.instance = new N8nClient();
    }
    return N8nClient.instance;
  }

  // ============================================================================
  // n8n Process Management
  // ============================================================================

  async startN8n(): Promise<{ success: boolean; error?: string }> {
    return this.ipcRenderer.invoke("n8n:start");
  }

  async stopN8n(): Promise<void> {
    return this.ipcRenderer.invoke("n8n:stop");
  }

  async getN8nStatus(): Promise<{ running: boolean }> {
    return this.ipcRenderer.invoke("n8n:status");
  }

  // ============================================================================
  // Database Configuration
  // ============================================================================

  async configureDatabase(config: Partial<N8nDatabaseConfig>): Promise<{ success: boolean }> {
    return this.ipcRenderer.invoke("n8n:db:configure", config);
  }

  async getDatabaseConfig(): Promise<N8nDatabaseConfig> {
    return this.ipcRenderer.invoke("n8n:db:get-config");
  }

  // ============================================================================
  // Workflow Management
  // ============================================================================

  async createWorkflow(workflow: N8nWorkflow): Promise<N8nWorkflow> {
    return this.ipcRenderer.invoke("n8n:workflow:create", workflow);
  }

  async updateWorkflow(id: string, workflow: N8nWorkflow): Promise<N8nWorkflow> {
    return this.ipcRenderer.invoke("n8n:workflow:update", id, workflow);
  }

  async getWorkflow(id: string): Promise<N8nWorkflow> {
    return this.ipcRenderer.invoke("n8n:workflow:get", id);
  }

  async listWorkflows(): Promise<{ data: N8nWorkflow[] }> {
    return this.ipcRenderer.invoke("n8n:workflow:list");
  }

  async deleteWorkflow(id: string): Promise<void> {
    return this.ipcRenderer.invoke("n8n:workflow:delete", id);
  }

  async activateWorkflow(id: string): Promise<N8nWorkflow> {
    return this.ipcRenderer.invoke("n8n:workflow:activate", id);
  }

  async deactivateWorkflow(id: string): Promise<N8nWorkflow> {
    return this.ipcRenderer.invoke("n8n:workflow:deactivate", id);
  }

  async executeWorkflow(id: string, data?: Record<string, unknown>): Promise<N8nExecutionResult> {
    return this.ipcRenderer.invoke("n8n:workflow:execute", id, data);
  }

  // ============================================================================
  // AI Workflow Generation
  // ============================================================================

  async generateWorkflow(request: WorkflowGenerationRequest): Promise<WorkflowGenerationResult> {
    return this.ipcRenderer.invoke("n8n:workflow:generate", request);
  }

  async createMetaWorkflowBuilder(): Promise<N8nWorkflow> {
    return this.ipcRenderer.invoke("n8n:meta-builder:create");
  }

  // ============================================================================
  // Agent Communication
  // ============================================================================

  async sendAgentMessage(message: Omit<AgentMessage, "id" | "timestamp" | "status">): Promise<AgentMessage> {
    return this.ipcRenderer.invoke("n8n:agent:send-message", message);
  }

  async getAgentMessages(agentId: number): Promise<AgentMessage[]> {
    return this.ipcRenderer.invoke("n8n:agent:get-messages", agentId);
  }

  async createCollaboration(name: string, agentIds: number[]): Promise<AgentCollaboration> {
    return this.ipcRenderer.invoke("n8n:agent:create-collaboration", name, agentIds);
  }

  async getCollaboration(id: string): Promise<AgentCollaboration | undefined> {
    return this.ipcRenderer.invoke("n8n:agent:get-collaboration", id);
  }

  async listCollaborations(): Promise<AgentCollaboration[]> {
    return this.ipcRenderer.invoke("n8n:agent:list-collaborations");
  }

  async createCollaborationWorkflow(agentIds: number[]): Promise<N8nWorkflow> {
    return this.ipcRenderer.invoke("n8n:agent:create-collab-workflow", agentIds);
  }
}

export const n8nClient = N8nClient.getInstance();
