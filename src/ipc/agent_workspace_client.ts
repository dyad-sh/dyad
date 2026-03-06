/**
 * Agent Workspace IPC Client
 * Renderer-side client for agent task management, knowledge source CRUD,
 * task execution, and workspace operations.
 */

import type {
  AgentTask,
  AgentKnowledgeSource,
  TaskExecution,
  AgentWorkspace,
  KnowledgeQueryResult,
  CreateAgentTaskRequest,
  UpdateAgentTaskRequest,
  ExecuteTaskRequest,
  AddKnowledgeSourceRequest,
  UpdateKnowledgeSourceRequest,
  QueryKnowledgeRequest,
} from "@/types/agent_workspace";

class AgentWorkspaceClient {
  private static instance: AgentWorkspaceClient;

  private constructor() {}

  public static getInstance(): AgentWorkspaceClient {
    if (!AgentWorkspaceClient.instance) {
      AgentWorkspaceClient.instance = new AgentWorkspaceClient();
    }
    return AgentWorkspaceClient.instance;
  }

  private invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    return window.electron.ipcRenderer.invoke(channel, ...args) as Promise<T>;
  }

  // ===========================================================================
  // TASK CRUD
  // ===========================================================================

  async createTask(request: CreateAgentTaskRequest): Promise<AgentTask> {
    return this.invoke("agent:workspace:task:create", request);
  }

  async listTasks(agentId: number): Promise<AgentTask[]> {
    return this.invoke("agent:workspace:task:list", agentId);
  }

  async getTask(taskId: string): Promise<AgentTask> {
    return this.invoke("agent:workspace:task:get", taskId);
  }

  async updateTask(request: UpdateAgentTaskRequest): Promise<AgentTask> {
    return this.invoke("agent:workspace:task:update", request);
  }

  async deleteTask(taskId: string): Promise<void> {
    return this.invoke("agent:workspace:task:delete", taskId);
  }

  // ===========================================================================
  // TASK EXECUTION
  // ===========================================================================

  async executeTask(request: ExecuteTaskRequest): Promise<TaskExecution> {
    return this.invoke("agent:workspace:task:execute", request);
  }

  async listExecutions(taskId: string): Promise<TaskExecution[]> {
    return this.invoke("agent:workspace:task:executions", taskId);
  }

  // ===========================================================================
  // KNOWLEDGE SOURCE CRUD
  // ===========================================================================

  async addKnowledgeSource(request: AddKnowledgeSourceRequest): Promise<AgentKnowledgeSource> {
    return this.invoke("agent:workspace:knowledge:add", request);
  }

  async listKnowledgeSources(agentId: number): Promise<AgentKnowledgeSource[]> {
    return this.invoke("agent:workspace:knowledge:list", agentId);
  }

  async getKnowledgeSource(sourceId: string): Promise<AgentKnowledgeSource> {
    return this.invoke("agent:workspace:knowledge:get", sourceId);
  }

  async updateKnowledgeSource(request: UpdateKnowledgeSourceRequest): Promise<AgentKnowledgeSource> {
    return this.invoke("agent:workspace:knowledge:update", request);
  }

  async deleteKnowledgeSource(sourceId: string): Promise<void> {
    return this.invoke("agent:workspace:knowledge:delete", sourceId);
  }

  async syncKnowledgeSource(sourceId: string): Promise<AgentKnowledgeSource> {
    return this.invoke("agent:workspace:knowledge:sync", sourceId);
  }

  async queryKnowledge(request: QueryKnowledgeRequest): Promise<KnowledgeQueryResult[]> {
    return this.invoke("agent:workspace:knowledge:query", request);
  }

  // ===========================================================================
  // WORKSPACE
  // ===========================================================================

  async getWorkspace(agentId: number): Promise<AgentWorkspace> {
    return this.invoke("agent:workspace:get", agentId);
  }
}

export const agentWorkspaceClient = AgentWorkspaceClient.getInstance();
export default agentWorkspaceClient;
