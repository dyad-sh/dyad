/**
 * Agent Memory IPC Client — Renderer-side API for agent memory system
 */

import type {
  AgentMemoryConfig,
  LongTermMemory,
  LongTermMemoryCategory,
  ShortTermMemory,
  UpsertAgentMemoryConfigRequest,
  CreateLongTermMemoryRequest,
  UpdateLongTermMemoryRequest,
  SearchLongTermMemoryRequest,
  SetShortTermMemoryRequest,
  GetShortTermMemoriesRequest,
  DeleteShortTermMemoryRequest,
  ClearShortTermMemoryRequest,
} from "../../types/agent_memory";

export class AgentMemoryClient {
  private static instance: AgentMemoryClient;

  static getInstance(): AgentMemoryClient {
    if (!AgentMemoryClient.instance) {
      AgentMemoryClient.instance = new AgentMemoryClient();
    }
    return AgentMemoryClient.instance;
  }

  private invoke(channel: string, ...args: unknown[]): Promise<any> {
    return window.electron.ipcRenderer.invoke(channel, ...args);
  }

  // ── Config ──────────────────────────────────────────────────────

  getConfig(agentId: number): Promise<AgentMemoryConfig | null> {
    return this.invoke("agent-memory:config:get", agentId);
  }

  upsertConfig(
    params: UpsertAgentMemoryConfigRequest,
  ): Promise<AgentMemoryConfig> {
    return this.invoke("agent-memory:config:upsert", params);
  }

  // ── Long-Term Memory ───────────────────────────────────────────

  createLTM(params: CreateLongTermMemoryRequest): Promise<LongTermMemory> {
    return this.invoke("agent-memory:ltm:create", params);
  }

  getLTM(id: number): Promise<LongTermMemory | null> {
    return this.invoke("agent-memory:ltm:get", id);
  }

  listLTM(
    agentId: number,
    category?: LongTermMemoryCategory,
  ): Promise<LongTermMemory[]> {
    return this.invoke("agent-memory:ltm:list", agentId, category);
  }

  updateLTM(params: UpdateLongTermMemoryRequest): Promise<LongTermMemory | null> {
    return this.invoke("agent-memory:ltm:update", params);
  }

  deleteLTM(id: number): Promise<void> {
    return this.invoke("agent-memory:ltm:delete", id);
  }

  searchLTM(params: SearchLongTermMemoryRequest): Promise<LongTermMemory[]> {
    return this.invoke("agent-memory:ltm:search", params);
  }

  // ── Short-Term Memory ──────────────────────────────────────────

  setSTM(params: SetShortTermMemoryRequest): Promise<ShortTermMemory> {
    return this.invoke("agent-memory:stm:set", params);
  }

  listSTM(params: GetShortTermMemoriesRequest): Promise<ShortTermMemory[]> {
    return this.invoke("agent-memory:stm:list", params);
  }

  deleteSTM(params: DeleteShortTermMemoryRequest): Promise<void> {
    return this.invoke("agent-memory:stm:delete", params);
  }

  clearSTM(params: ClearShortTermMemoryRequest): Promise<void> {
    return this.invoke("agent-memory:stm:clear", params);
  }
}

export const agentMemoryClient = AgentMemoryClient.getInstance();
