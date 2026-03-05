/**
 * Agent Memory React Hooks — TanStack Query wrappers for agent memory IPC
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { agentMemoryClient } from "../ipc/clients/agent_memory_client";
import type {
  LongTermMemoryCategory,
  UpsertAgentMemoryConfigRequest,
  CreateLongTermMemoryRequest,
  UpdateLongTermMemoryRequest,
  SearchLongTermMemoryRequest,
  SetShortTermMemoryRequest,
  DeleteShortTermMemoryRequest,
  ClearShortTermMemoryRequest,
} from "../types/agent_memory";

// ── Query Keys ──────────────────────────────────────────────────

export const agentMemoryKeys = {
  all: ["agent-memory"] as const,
  config: (agentId: number) =>
    [...agentMemoryKeys.all, "config", agentId] as const,
  ltm: (agentId: number, category?: LongTermMemoryCategory) =>
    [...agentMemoryKeys.all, "ltm", agentId, category ?? "all"] as const,
  ltmSearch: (agentId: number, query: string) =>
    [...agentMemoryKeys.all, "ltm-search", agentId, query] as const,
  stm: (agentId: number, chatId: string) =>
    [...agentMemoryKeys.all, "stm", agentId, chatId] as const,
};

// ── Config Hooks ────────────────────────────────────────────────

export function useAgentMemoryConfig(agentId: number) {
  return useQuery({
    queryKey: agentMemoryKeys.config(agentId),
    queryFn: () => agentMemoryClient.getConfig(agentId),
    enabled: agentId > 0,
  });
}

export function useUpsertAgentMemoryConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: UpsertAgentMemoryConfigRequest) =>
      agentMemoryClient.upsertConfig(params),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: agentMemoryKeys.config(vars.agentId),
      });
      toast.success("Memory settings saved");
    },
    onError: (err: Error) =>
      toast.error(`Failed to save memory settings: ${err.message}`),
  });
}

// ── Long-Term Memory Hooks ──────────────────────────────────────

export function useLongTermMemories(
  agentId: number,
  category?: LongTermMemoryCategory,
) {
  return useQuery({
    queryKey: agentMemoryKeys.ltm(agentId, category),
    queryFn: () => agentMemoryClient.listLTM(agentId, category),
    enabled: agentId > 0,
  });
}

export function useSearchLongTermMemories(
  params: SearchLongTermMemoryRequest,
) {
  return useQuery({
    queryKey: agentMemoryKeys.ltmSearch(params.agentId, params.query),
    queryFn: () => agentMemoryClient.searchLTM(params),
    enabled: params.agentId > 0 && params.query.length > 0,
  });
}

export function useCreateLongTermMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateLongTermMemoryRequest) =>
      agentMemoryClient.createLTM(params),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: agentMemoryKeys.ltm(vars.agentId),
      });
      toast.success("Memory created");
    },
    onError: (err: Error) =>
      toast.error(`Failed to create memory: ${err.message}`),
  });
}

export function useUpdateLongTermMemory(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: UpdateLongTermMemoryRequest) =>
      agentMemoryClient.updateLTM(params),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: agentMemoryKeys.ltm(agentId),
      });
      toast.success("Memory updated");
    },
    onError: (err: Error) =>
      toast.error(`Failed to update memory: ${err.message}`),
  });
}

export function useDeleteLongTermMemory(agentId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => agentMemoryClient.deleteLTM(id),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: agentMemoryKeys.ltm(agentId),
      });
      toast.success("Memory deleted");
    },
    onError: (err: Error) =>
      toast.error(`Failed to delete memory: ${err.message}`),
  });
}

// ── Short-Term Memory Hooks ─────────────────────────────────────

export function useShortTermMemories(agentId: number, chatId: string) {
  return useQuery({
    queryKey: agentMemoryKeys.stm(agentId, chatId),
    queryFn: () =>
      agentMemoryClient.listSTM({ agentId, chatId }),
    enabled: agentId > 0 && !!chatId,
  });
}

export function useSetShortTermMemory(agentId: number, chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: SetShortTermMemoryRequest) =>
      agentMemoryClient.setSTM(params),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: agentMemoryKeys.stm(agentId, chatId),
      });
    },
    onError: (err: Error) =>
      toast.error(`Failed to set memory: ${err.message}`),
  });
}

export function useDeleteShortTermMemory(agentId: number, chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: DeleteShortTermMemoryRequest) =>
      agentMemoryClient.deleteSTM(params),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: agentMemoryKeys.stm(agentId, chatId),
      });
    },
    onError: (err: Error) =>
      toast.error(`Failed to delete memory: ${err.message}`),
  });
}

export function useClearShortTermMemory(agentId: number, chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: ClearShortTermMemoryRequest) =>
      agentMemoryClient.clearSTM(params),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: agentMemoryKeys.stm(agentId, chatId),
      });
      toast.success("Short-term memory cleared");
    },
    onError: (err: Error) =>
      toast.error(`Failed to clear memory: ${err.message}`),
  });
}
