/**
 * n8n Workflow IPC Client
 * Renderer-side client for n8n workflow operations,
 * trigger management, and agent-stack orchestration.
 */

import type { IpcRenderer } from "electron";
import type {
  N8nWorkflow,
  N8nExecutionResult,
  WorkflowGenerationRequest,
  WorkflowGenerationResult,
} from "@/types/n8n_types";
import type {
  AgentTrigger,
  CreateTriggerRequest,
  UpdateTriggerRequest,
} from "@/types/agent_triggers";

class N8nWorkflowClient {
  private static instance: N8nWorkflowClient;
  private ipcRenderer: IpcRenderer;

  private constructor() {
    this.ipcRenderer = (window as any).electron.ipcRenderer as IpcRenderer;
  }

  public static getInstance(): N8nWorkflowClient {
    if (!N8nWorkflowClient.instance) {
      N8nWorkflowClient.instance = new N8nWorkflowClient();
    }
    return N8nWorkflowClient.instance;
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
  // Workflow CRUD
  // ============================================================================

  async createWorkflow(workflow: N8nWorkflow): Promise<N8nWorkflow | null> {
    return this.ipcRenderer.invoke("n8n:workflow:create", workflow);
  }

  async updateWorkflow(id: string, workflow: N8nWorkflow): Promise<N8nWorkflow | null> {
    return this.ipcRenderer.invoke("n8n:workflow:update", id, workflow);
  }

  async getWorkflow(id: string): Promise<N8nWorkflow | null> {
    return this.ipcRenderer.invoke("n8n:workflow:get", id);
  }

  async listWorkflows(): Promise<{ data: N8nWorkflow[] }> {
    return this.ipcRenderer.invoke("n8n:workflow:list");
  }

  async deleteWorkflow(id: string): Promise<{ success: boolean; error?: string }> {
    return this.ipcRenderer.invoke("n8n:workflow:delete", id);
  }

  async activateWorkflow(id: string): Promise<N8nWorkflow | null> {
    return this.ipcRenderer.invoke("n8n:workflow:activate", id);
  }

  async deactivateWorkflow(id: string): Promise<N8nWorkflow | null> {
    return this.ipcRenderer.invoke("n8n:workflow:deactivate", id);
  }

  async executeWorkflow(id: string, data?: Record<string, unknown>): Promise<N8nExecutionResult | null> {
    return this.ipcRenderer.invoke("n8n:workflow:execute", id, data);
  }

  // ============================================================================
  // AI Workflow Generation
  // ============================================================================

  async generateWorkflow(request: WorkflowGenerationRequest): Promise<WorkflowGenerationResult> {
    return this.ipcRenderer.invoke("n8n:workflow:generate", request);
  }

  // ============================================================================
  // Agent Trigger Management
  // ============================================================================

  async createTrigger(request: CreateTriggerRequest): Promise<AgentTrigger> {
    return this.ipcRenderer.invoke("agent:trigger:create", request);
  }

  async listTriggers(agentId: number): Promise<AgentTrigger[]> {
    return this.ipcRenderer.invoke("agent:trigger:list", agentId);
  }

  async updateTrigger(request: UpdateTriggerRequest): Promise<AgentTrigger> {
    return this.ipcRenderer.invoke("agent:trigger:update", request);
  }

  async deleteTrigger(triggerId: string): Promise<void> {
    return this.ipcRenderer.invoke("agent:trigger:delete", triggerId);
  }

  async activateTrigger(triggerId: string): Promise<AgentTrigger> {
    return this.ipcRenderer.invoke("agent:trigger:activate", triggerId);
  }

  async pauseTrigger(triggerId: string): Promise<AgentTrigger> {
    return this.ipcRenderer.invoke("agent:trigger:pause", triggerId);
  }

  // ============================================================================
  // Agent Stack Builder (end-to-end)
  // ============================================================================

  async buildAgentStack(request: BuildAgentStackRequest): Promise<BuildAgentStackResult> {
    return this.ipcRenderer.invoke("agent:stack:build", request);
  }

  async getAgentStack(agentId: number): Promise<AgentStackConfig | null> {
    return this.ipcRenderer.invoke("agent:stack:get", agentId);
  }

  async syncStackToN8n(agentId: number): Promise<{ success: boolean; n8nWorkflowId?: string; error?: string }> {
    return this.ipcRenderer.invoke("agent:stack:sync-n8n", agentId);
  }

  // ============================================================================
  // Meta-Workflow Builder
  // ============================================================================

  async createMetaBuilder(): Promise<N8nWorkflow | null> {
    return this.ipcRenderer.invoke("n8n:meta-builder:create");
  }

  // ============================================================================
  // Agent Collaboration
  // ============================================================================

  async sendAgentMessage(message: {
    fromAgentId: number;
    toAgentId: number | "broadcast";
    type: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    return this.ipcRenderer.invoke("n8n:agent:send-message", message);
  }

  async getAgentMessages(agentId: number): Promise<unknown[]> {
    return this.ipcRenderer.invoke("n8n:agent:get-messages", agentId);
  }
}

// ============================================================================
// Agent Stack Types
// ============================================================================

export interface BuildAgentStackRequest {
  agentId: number;
  /** Natural language description of the agent's purpose */
  description: string;
  /** Trigger configurations */
  triggers: Array<{
    type: string;
    config: Record<string, unknown>;
  }>;
  /** Tool IDs from the catalog */
  toolIds: string[];
  /** Knowledge base file paths */
  knowledgeFiles?: string[];
  /** Whether to auto-sync to n8n */
  syncToN8n: boolean;
}

export interface BuildAgentStackResult {
  success: boolean;
  /** Created n8n workflow ID (if synced) */
  n8nWorkflowId?: string;
  /** Trigger IDs created */
  triggerIds: string[];
  /** Tool IDs attached */
  toolIds: string[];
  /** Errors encountered */
  errors?: string[];
}

export interface AgentStackConfig {
  agentId: number;
  triggers: Array<{
    id: string;
    type: string;
    name: string;
    status: string;
    n8nNodeType?: string;
  }>;
  tools: Array<{
    id: string;
    name: string;
    category: string;
    enabled: boolean;
  }>;
  n8nWorkflow?: {
    id: string;
    name: string;
    active: boolean;
  };
  knowledgeBases: Array<{
    id: number;
    name: string;
    documentCount: number;
    indexStatus: string;
  }>;
}

export const n8nWorkflowClient = N8nWorkflowClient.getInstance();
