/**
 * React hooks for the Decentralized Model Registry
 * Uses TanStack Query for server state management via IPC
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ModelRegistryClient } from "@/ipc/model_registry_client";
import { toast } from "sonner";
import type {
  SearchParams,
  RateModelParams,
  RegisterModelParams,
} from "@/lib/model_registry_service";

const client = ModelRegistryClient.getInstance();

// =============================================================================
// QUERY HOOKS
// =============================================================================

export function useRegistryStats() {
  return useQuery({
    queryKey: ["model-registry", "stats"],
    queryFn: () => client.getStats(),
    refetchInterval: 30_000,
  });
}

export function useModelRegistrySearch(params?: SearchParams) {
  return useQuery({
    queryKey: ["model-registry", "search", params],
    queryFn: () => client.search(params),
  });
}

export function useLocalModels() {
  return useQuery({
    queryKey: ["model-registry", "local"],
    queryFn: () => client.listLocal(),
  });
}

export function useModelEntry(id: string | undefined) {
  return useQuery({
    queryKey: ["model-registry", "entry", id],
    queryFn: () => client.get(id!),
    enabled: !!id,
  });
}

export function useModelRatings(modelEntryId: string | undefined) {
  return useQuery({
    queryKey: ["model-registry", "ratings", modelEntryId],
    queryFn: () => client.getRatings(modelEntryId!),
    enabled: !!modelEntryId,
  });
}

export function useRegistryPeers() {
  return useQuery({
    queryKey: ["model-registry", "peers"],
    queryFn: () => client.listPeers(),
    refetchInterval: 60_000,
  });
}

export function useActiveDownloads() {
  return useQuery({
    queryKey: ["model-registry", "downloads"],
    queryFn: () => client.listDownloads(),
    refetchInterval: 5_000,
  });
}

// =============================================================================
// MUTATION HOOKS
// =============================================================================

export function useRegisterModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: RegisterModelParams) => client.register(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["model-registry"] });
      toast.success("Model registered in the registry");
    },
    onError: (err: Error) => toast.error(`Failed to register: ${err.message}`),
  });
}

export function usePublishModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (modelId: string) => client.publish(modelId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["model-registry"] });
      toast.success(
        `Model published (${result.publishState})${result.celestiaHeight ? ` — Celestia height ${result.celestiaHeight}` : ""}`,
      );
    },
    onError: (err: Error) => toast.error(`Publish failed: ${err.message}`),
  });
}

export function useRateModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: RateModelParams) => client.rate(params),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["model-registry", "entry", variables.modelEntryId],
      });
      queryClient.invalidateQueries({
        queryKey: ["model-registry", "ratings", variables.modelEntryId],
      });
    },
    onError: (err: Error) => toast.error(`Rating failed: ${err.message}`),
  });
}

export function useDeleteModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["model-registry"] });
      toast.success("Model removed from registry");
    },
    onError: (err: Error) => toast.error(`Delete failed: ${err.message}`),
  });
}

export function useDelistModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.delist(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["model-registry"] });
      toast.success("Model delisted");
    },
    onError: (err: Error) => toast.error(`Delist failed: ${err.message}`),
  });
}

export function useDownloadModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (modelEntryId: string) => client.download(modelEntryId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["model-registry", "downloads"],
      });
      toast.success("Download started");
    },
    onError: (err: Error) => toast.error(`Download failed: ${err.message}`),
  });
}

export function useUpdateModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      id: string;
      updates: Partial<{
        name: string;
        description: string;
        tags: string[];
        license: string;
        licenseUrl: string;
      }>;
    }) => client.update(args.id, args.updates),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["model-registry", "entry", variables.id],
      });
      queryClient.invalidateQueries({ queryKey: ["model-registry", "search"] });
      toast.success("Model updated");
    },
    onError: (err: Error) => toast.error(`Update failed: ${err.message}`),
  });
}
