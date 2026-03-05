// =============================================================================
// MAB Learning React Hooks — TanStack Query wrappers for bandit IPC calls
// =============================================================================

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MABClient } from "../ipc/clients/mab_client";
import type {
  MABDomain,
  CreateArmParams,
  RecordRewardParams,
  SelectArmParams,
  MABDecayConfig,
} from "../types/mab_types";

const client = MABClient.getInstance();

// ---- Query Keys ----

export const mabKeys = {
  all: ["mab"] as const,
  arms: (filters?: Record<string, unknown>) =>
    [...mabKeys.all, "arms", filters ?? {}] as const,
  arm: (id: string) => [...mabKeys.all, "arm", id] as const,
  stats: () => [...mabKeys.all, "stats"] as const,
  rewardHistory: (armId: string) =>
    [...mabKeys.all, "reward-history", armId] as const,
  recentEvents: () => [...mabKeys.all, "recent-events"] as const,
  contextKeys: () => [...mabKeys.all, "context-keys"] as const,
  decayConfig: (domain: MABDomain) =>
    [...mabKeys.all, "decay-config", domain] as const,
};

// ---- Arms ----

export function useMABArms(filters?: {
  domain?: MABDomain;
  contextKey?: string;
  activeOnly?: boolean;
}) {
  return useQuery({
    queryKey: mabKeys.arms(filters as any),
    queryFn: () => client.listArms(filters),
  });
}

export function useMABArm(id: string) {
  return useQuery({
    queryKey: mabKeys.arm(id),
    queryFn: () => client.getArm(id),
    enabled: !!id,
  });
}

export function useCreateArm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateArmParams) => client.createArm(params),
    onSuccess: (arm) => {
      qc.invalidateQueries({ queryKey: mabKeys.arms() });
      qc.invalidateQueries({ queryKey: mabKeys.stats() });
      qc.invalidateQueries({ queryKey: mabKeys.contextKeys() });
      toast.success(`Created arm "${arm.name}"`);
    },
    onError: (err: Error) => toast.error(`Failed to create arm: ${err.message}`),
  });
}

export function useGetOrCreateArm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateArmParams) => client.getOrCreateArm(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mabKeys.arms() });
      qc.invalidateQueries({ queryKey: mabKeys.contextKeys() });
    },
    onError: (err: Error) => toast.error(`Failed to get/create arm: ${err.message}`),
  });
}

export function useUpdateArm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<{
        name: string;
        description: string;
        isActive: boolean;
        metadata: Record<string, unknown>;
      }>;
    }) => client.updateArm(id, updates),
    onSuccess: (arm) => {
      if (arm) {
        qc.invalidateQueries({ queryKey: mabKeys.arm(arm.id) });
      }
      qc.invalidateQueries({ queryKey: mabKeys.arms() });
      toast.success("Arm updated");
    },
    onError: (err: Error) => toast.error(`Failed to update arm: ${err.message}`),
  });
}

export function useDeleteArm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.deleteArm(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mabKeys.arms() });
      qc.invalidateQueries({ queryKey: mabKeys.stats() });
      toast.success("Arm deleted");
    },
    onError: (err: Error) => toast.error(`Failed to delete arm: ${err.message}`),
  });
}

export function useResetArm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.resetArm(id),
    onSuccess: (arm) => {
      if (arm) {
        qc.invalidateQueries({ queryKey: mabKeys.arm(arm.id) });
        qc.invalidateQueries({ queryKey: mabKeys.rewardHistory(arm.id) });
      }
      qc.invalidateQueries({ queryKey: mabKeys.arms() });
      qc.invalidateQueries({ queryKey: mabKeys.stats() });
      toast.success("Arm reset to prior");
    },
    onError: (err: Error) => toast.error(`Failed to reset arm: ${err.message}`),
  });
}

// ---- Selection ----

export function useSelectArm() {
  return useMutation({
    mutationFn: (params: SelectArmParams) => client.selectArm(params),
    onError: (err: Error) => toast.error(`Selection failed: ${err.message}`),
  });
}

// ---- Rewards ----

export function useRecordReward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: RecordRewardParams) => client.recordReward(params),
    onSuccess: (event) => {
      qc.invalidateQueries({ queryKey: mabKeys.arm(event.armId) });
      qc.invalidateQueries({ queryKey: mabKeys.arms() });
      qc.invalidateQueries({ queryKey: mabKeys.rewardHistory(event.armId) });
      qc.invalidateQueries({ queryKey: mabKeys.recentEvents() });
      qc.invalidateQueries({ queryKey: mabKeys.stats() });
    },
    onError: (err: Error) => toast.error(`Failed to record reward: ${err.message}`),
  });
}

export function useRecordRewardByName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      domain: MABDomain;
      contextKey: string;
      armName: string;
      reward: number;
      opts?: { context?: Record<string, unknown>; feedback?: string; source?: "auto" | "user" | "system" };
    }) => client.recordRewardByName(params.domain, params.contextKey, params.armName, params.reward, params.opts),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mabKeys.arms() });
      qc.invalidateQueries({ queryKey: mabKeys.recentEvents() });
      qc.invalidateQueries({ queryKey: mabKeys.stats() });
    },
    onError: (err: Error) => toast.error(`Failed to record reward: ${err.message}`),
  });
}

export function useRewardHistory(armId: string, limit = 50) {
  return useQuery({
    queryKey: mabKeys.rewardHistory(armId),
    queryFn: () => client.getRewardHistory(armId, limit),
    enabled: !!armId,
  });
}

export function useRecentRewardEvents(limit = 20) {
  return useQuery({
    queryKey: mabKeys.recentEvents(),
    queryFn: () => client.getRecentEvents(limit),
    refetchInterval: 30_000,
  });
}

// ---- Stats ----

export function useMABStats() {
  return useQuery({
    queryKey: mabKeys.stats(),
    queryFn: () => client.getStats(),
    refetchInterval: 30_000,
  });
}

// ---- Context Keys ----

export function useMABContextKeys() {
  return useQuery({
    queryKey: mabKeys.contextKeys(),
    queryFn: () => client.listContextKeys(),
  });
}

// ---- Decay ----

export function useMABDecayConfig(domain: MABDomain) {
  return useQuery({
    queryKey: mabKeys.decayConfig(domain),
    queryFn: () => client.getDecayConfig(domain),
    enabled: !!domain,
  });
}

export function useSetDecayConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ domain, config }: { domain: MABDomain; config: Partial<MABDecayConfig> }) =>
      client.setDecayConfig(domain, config),
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({ queryKey: mabKeys.decayConfig(variables.domain) });
      toast.success("Decay config updated");
    },
    onError: (err: Error) => toast.error(`Failed to update decay: ${err.message}`),
  });
}

export function useApplyDecay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (domain?: MABDomain) => client.applyDecay(domain),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: mabKeys.arms() });
      qc.invalidateQueries({ queryKey: mabKeys.stats() });
      toast.success(`Decayed ${result.decayed} arms`);
    },
    onError: (err: Error) => toast.error(`Decay failed: ${err.message}`),
  });
}
