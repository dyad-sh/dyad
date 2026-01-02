/**
 * Agent Builder IPC Client
 * Renderer-side client for agent builder operations
 */

import type { IpcRenderer } from "electron";
import type {
  Agent,
  AgentTool,
  AgentWorkflow,
  AgentDeployment,
  AgentTestSession,
  AgentKnowledgeBase,
  AgentUIComponent,
  CreateAgentRequest,
  UpdateAgentRequest,
  CreateAgentToolRequest,
  UpdateAgentToolRequest,
  DeployAgentRequest,
} from "@/types/agent_builder";

class AgentBuilderClient {
  private static instance: AgentBuilderClient;
  private ipcRenderer: IpcRenderer;

  private constructor() {
    this.ipcRenderer = (window as any).electron.ipcRenderer as IpcRenderer;
  }

  public static getInstance(): AgentBuilderClient {
    if (!AgentBuilderClient.instance) {
      AgentBuilderClient.instance = new AgentBuilderClient();
    }
    return AgentBuilderClient.instance;
  }

  // ============================================================================
  // Agent CRUD Operations
  // ============================================================================

  async createAgent(request: CreateAgentRequest): Promise<Agent> {
    return this.ipcRenderer.invoke("agent:create", request);
  }

  async getAgent(agentId: number): Promise<Agent | null> {
    return this.ipcRenderer.invoke("agent:get", agentId);
  }

  async listAgents(): Promise<Agent[]> {
    return this.ipcRenderer.invoke("agent:list");
  }

  async updateAgent(request: UpdateAgentRequest): Promise<Agent> {
    return this.ipcRenderer.invoke("agent:update", request);
  }

  async deleteAgent(agentId: number): Promise<void> {
    return this.ipcRenderer.invoke("agent:delete", agentId);
  }

  async duplicateAgent(agentId: number): Promise<Agent> {
    return this.ipcRenderer.invoke("agent:duplicate", agentId);
  }

  // ============================================================================
  // Agent Tool Operations
  // ============================================================================

  async createAgentTool(request: CreateAgentToolRequest): Promise<AgentTool> {
    return this.ipcRenderer.invoke("agent:tool:create", request);
  }

  async getAgentTools(agentId: number): Promise<AgentTool[]> {
    return this.ipcRenderer.invoke("agent:tool:list", agentId);
  }

  async updateAgentTool(request: UpdateAgentToolRequest): Promise<AgentTool> {
    return this.ipcRenderer.invoke("agent:tool:update", request);
  }

  async deleteAgentTool(toolId: number): Promise<void> {
    return this.ipcRenderer.invoke("agent:tool:delete", toolId);
  }

  // ============================================================================
  // Agent Workflow Operations
  // ============================================================================

  async createAgentWorkflow(
    agentId: number,
    name: string,
    description?: string
  ): Promise<AgentWorkflow> {
    return this.ipcRenderer.invoke("agent:workflow:create", agentId, name, description);
  }

  async getAgentWorkflows(agentId: number): Promise<AgentWorkflow[]> {
    return this.ipcRenderer.invoke("agent:workflow:list", agentId);
  }

  async updateAgentWorkflow(
    workflowId: number,
    updates: Partial<AgentWorkflow>
  ): Promise<AgentWorkflow> {
    return this.ipcRenderer.invoke("agent:workflow:update", workflowId, updates);
  }

  async deleteAgentWorkflow(workflowId: number): Promise<void> {
    return this.ipcRenderer.invoke("agent:workflow:delete", workflowId);
  }

  // ============================================================================
  // Agent Deployment Operations
  // ============================================================================

  async deployAgent(request: DeployAgentRequest): Promise<AgentDeployment> {
    return this.ipcRenderer.invoke("agent:deploy", request);
  }

  async getAgentDeployments(agentId: number): Promise<AgentDeployment[]> {
    return this.ipcRenderer.invoke("agent:deployment:list", agentId);
  }

  async stopDeployment(deploymentId: number): Promise<void> {
    return this.ipcRenderer.invoke("agent:deployment:stop", deploymentId);
  }

  // ============================================================================
  // Agent Test Session Operations
  // ============================================================================

  async createTestSession(agentId: number): Promise<AgentTestSession> {
    return this.ipcRenderer.invoke("agent:test:create", agentId);
  }

  async getTestSessions(agentId: number): Promise<AgentTestSession[]> {
    return this.ipcRenderer.invoke("agent:test:list", agentId);
  }

  // ============================================================================
  // Agent Knowledge Base Operations
  // ============================================================================

  async createKnowledgeBase(
    agentId: number,
    name: string,
    sourceType: string,
    config?: Record<string, unknown>
  ): Promise<AgentKnowledgeBase> {
    return this.ipcRenderer.invoke("agent:kb:create", agentId, name, sourceType, config);
  }

  async getKnowledgeBases(agentId: number): Promise<AgentKnowledgeBase[]> {
    return this.ipcRenderer.invoke("agent:kb:list", agentId);
  }

  // ============================================================================
  // Agent UI Component Operations
  // ============================================================================

  async createUIComponent(
    agentId: number,
    name: string,
    componentType: string,
    code?: string
  ): Promise<AgentUIComponent> {
    return this.ipcRenderer.invoke("agent:ui:create", agentId, name, componentType, code);
  }

  async getUIComponents(agentId: number): Promise<AgentUIComponent[]> {
    return this.ipcRenderer.invoke("agent:ui:list", agentId);
  }

  // ============================================================================
  // Agent Export Operations
  // ============================================================================

  async exportAgentJson(agentId: number): Promise<{ success: boolean; exportPath?: string; error?: string }> {
    return this.ipcRenderer.invoke("agent:export:json", agentId);
  }

  async exportAgentStandalone(agentId: number): Promise<{ success: boolean; exportPath?: string; error?: string }> {
    return this.ipcRenderer.invoke("agent:export:standalone", agentId);
  }

  async exportAgentDocker(agentId: number): Promise<{ success: boolean; exportPath?: string; error?: string }> {
    return this.ipcRenderer.invoke("agent:export:docker", agentId);
  }
}

export const agentBuilderClient = AgentBuilderClient.getInstance();
