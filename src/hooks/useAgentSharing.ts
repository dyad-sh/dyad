import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type {
  CreateShareConfigRequest,
  UpdateShareConfigRequest,
  SaveAppAsAgentTemplateRequest,
} from "@/types/agent_builder";
import { toast } from "sonner";

const ipc = IpcClient.getInstance();

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useAgentShareConfig(agentId: number | undefined) {
  return useQuery({
    queryKey: ["agent-share-config", agentId],
    queryFn: () => ipc.getAgentShareConfig(agentId!),
    enabled: !!agentId,
  });
}

export function useAgentShareCodes(agentId: number | undefined) {
  return useQuery({
    queryKey: ["agent-share-codes", agentId],
    queryFn: () => ipc.generateAgentShareCodes(agentId!),
    enabled: !!agentId,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateShareConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateShareConfigRequest) =>
      ipc.createAgentShareConfig(req),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["agent-share-config", variables.agentId],
      });
      queryClient.invalidateQueries({
        queryKey: ["agent-share-codes", variables.agentId],
      });
      toast.success("Share configuration created");
    },
    onError: (err: Error) => {
      toast.error(`Failed to create share config: ${err.message}`);
    },
  });
}

export function useUpdateShareConfig(agentId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: UpdateShareConfigRequest) =>
      ipc.updateAgentShareConfig(req),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["agent-share-config", agentId],
      });
      queryClient.invalidateQueries({
        queryKey: ["agent-share-codes", agentId],
      });
      toast.success("Share configuration updated");
    },
    onError: (err: Error) => {
      toast.error(`Failed to update share config: ${err.message}`);
    },
  });
}

export function useDeleteShareConfig(agentId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (shareConfigId: number) =>
      ipc.deleteAgentShareConfig(shareConfigId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["agent-share-config", agentId],
      });
      queryClient.invalidateQueries({
        queryKey: ["agent-share-codes", agentId],
      });
      toast.success("Share configuration deleted");
    },
    onError: (err: Error) => {
      toast.error(`Failed to delete share config: ${err.message}`);
    },
  });
}

export function useSaveAppAsAgentTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: SaveAppAsAgentTemplateRequest) =>
      ipc.saveAppAsAgentTemplate(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      toast.success("App saved as agent template");
    },
    onError: (err: Error) => {
      toast.error(`Failed to save as template: ${err.message}`);
    },
  });
}
