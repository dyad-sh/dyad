/**
 * React hooks for background missions.
 * Wraps IpcClient mission methods with TanStack Query.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";

// ============================================================================
// Query Keys
// ============================================================================

export const missionKeys = {
  all: ["missions"] as const,
  list: (filter?: { status?: string | string[]; appId?: number }) =>
    [...missionKeys.all, "list", filter ?? {}] as const,
  detail: (id: string) => [...missionKeys.all, "detail", id] as const,
};

// ============================================================================
// Queries
// ============================================================================

export function useMissions(filter?: {
  status?: string | string[];
  appId?: number;
}) {
  return useQuery({
    queryKey: missionKeys.list(filter),
    queryFn: () => IpcClient.getInstance().listMissions(filter),
    refetchInterval: 3000, // poll while missions may be running
  });
}

export function useMission(id: string | undefined) {
  return useQuery({
    queryKey: missionKeys.detail(id!),
    queryFn: () => IpcClient.getInstance().getMission(id!),
    enabled: !!id,
    refetchInterval: 2000,
  });
}

// ============================================================================
// Mutations
// ============================================================================

export function useStartMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      appId?: number;
      agentId?: string;
      title: string;
      description?: string;
      targetAppPath?: string;
      phases?: { name: string }[];
    }) => IpcClient.getInstance().startMission(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: missionKeys.all });
    },
  });
}

export function usePauseMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => IpcClient.getInstance().pauseMission(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: missionKeys.all });
    },
  });
}

export function useResumeMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => IpcClient.getInstance().resumeMission(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: missionKeys.all });
    },
  });
}

export function useCancelMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => IpcClient.getInstance().cancelMission(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: missionKeys.all });
    },
  });
}

export function useDeleteMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => IpcClient.getInstance().deleteMission(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: missionKeys.all });
    },
  });
}

export function useUpdateMission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; title?: string; description?: string }) =>
      IpcClient.getInstance().updateMission(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: missionKeys.all });
    },
  });
}
