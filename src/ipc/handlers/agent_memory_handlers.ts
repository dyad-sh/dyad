/**
 * Agent Memory IPC Handlers
 * Connect renderer to the agent memory engine (long-term + short-term)
 */

import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import {
  getMemoryConfig,
  upsertMemoryConfig,
  createLongTermMemory,
  getLongTermMemory,
  listLongTermMemories,
  updateLongTermMemory,
  deleteLongTermMemory,
  searchLongTermMemories,
  setShortTermMemory,
  getShortTermMemories,
  deleteShortTermMemory,
  clearShortTermMemory,
} from "../../lib/agent_memory_engine";
import type {
  LongTermMemoryCategory,
  ShortTermMemoryKind,
  UpsertAgentMemoryConfigRequest,
  CreateLongTermMemoryRequest,
  UpdateLongTermMemoryRequest,
  SearchLongTermMemoryRequest,
  SetShortTermMemoryRequest,
  GetShortTermMemoriesRequest,
  DeleteShortTermMemoryRequest,
  ClearShortTermMemoryRequest,
} from "../../types/agent_memory";

const logger = log.scope("agent_memory_handlers");
const handle = createLoggedHandler(logger);

export function registerAgentMemoryHandlers(): void {
  logger.info("Registering Agent Memory IPC handlers");

  // ---------------------------------------------------------------------------
  // CONFIG
  // ---------------------------------------------------------------------------

  handle(
    "agent-memory:config:get",
    async (_event, agentId: number) => {
      return getMemoryConfig(agentId);
    },
  );

  handle(
    "agent-memory:config:upsert",
    async (_event, params: UpsertAgentMemoryConfigRequest) => {
      return upsertMemoryConfig(params);
    },
  );

  // ---------------------------------------------------------------------------
  // LONG-TERM MEMORY
  // ---------------------------------------------------------------------------

  handle(
    "agent-memory:ltm:create",
    async (_event, params: CreateLongTermMemoryRequest) => {
      return createLongTermMemory(params);
    },
  );

  handle(
    "agent-memory:ltm:get",
    async (_event, id: number) => {
      return getLongTermMemory(id);
    },
  );

  handle(
    "agent-memory:ltm:list",
    async (
      _event,
      agentId: number,
      category?: LongTermMemoryCategory,
    ) => {
      return listLongTermMemories(agentId, category);
    },
  );

  handle(
    "agent-memory:ltm:update",
    async (_event, params: UpdateLongTermMemoryRequest) => {
      const { id, ...updates } = params;
      return updateLongTermMemory(id, updates);
    },
  );

  handle(
    "agent-memory:ltm:delete",
    async (_event, id: number) => {
      await deleteLongTermMemory(id);
    },
  );

  handle(
    "agent-memory:ltm:search",
    async (_event, params: SearchLongTermMemoryRequest) => {
      return searchLongTermMemories(params);
    },
  );

  // ---------------------------------------------------------------------------
  // SHORT-TERM MEMORY
  // ---------------------------------------------------------------------------

  handle(
    "agent-memory:stm:set",
    async (_event, params: SetShortTermMemoryRequest) => {
      return setShortTermMemory(params);
    },
  );

  handle(
    "agent-memory:stm:list",
    async (_event, params: GetShortTermMemoriesRequest) => {
      return getShortTermMemories(params.agentId, params.chatId);
    },
  );

  handle(
    "agent-memory:stm:delete",
    async (_event, params: DeleteShortTermMemoryRequest) => {
      await deleteShortTermMemory(params.agentId, params.chatId, params.key);
    },
  );

  handle(
    "agent-memory:stm:clear",
    async (_event, params: ClearShortTermMemoryRequest) => {
      await clearShortTermMemory(params.agentId, params.chatId);
    },
  );
}
