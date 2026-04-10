/**
 * OpenClaw Autonomous Hooks — TanStack Query integration for the autonomous brain.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AutonomousClient } from "@/ipc/openclaw_autonomous_client";
import type {
  AutonomousRequest,
} from "@/types/openclaw_autonomous_types";

// ── Query Keys ─────────────────────────────────────────────────────────────

export const autonomousKeys = {
  all: ["openclaw-autonomous"] as const,
  status: () => [...autonomousKeys.all, "status"] as const,
  executions: () => [...autonomousKeys.all, "executions"] as const,
  execution: (id: string) => [...autonomousKeys.all, "execution", id] as const,
  actions: () => [...autonomousKeys.all, "actions"] as const,
};

// ── Queries ────────────────────────────────────────────────────────────────

export function useAutonomousStatus() {
  return useQuery({
    queryKey: autonomousKeys.status(),
    queryFn: () => AutonomousClient.getStatus(),
    refetchInterval: 5_000,
  });
}

export function useAutonomousExecutions() {
  return useQuery({
    queryKey: autonomousKeys.executions(),
    queryFn: () => AutonomousClient.listExecutions(),
    refetchInterval: 3_000,
  });
}

export function useAutonomousExecution(executionId: string | undefined) {
  return useQuery({
    queryKey: autonomousKeys.execution(executionId ?? ""),
    queryFn: () => AutonomousClient.getExecution(executionId!),
    enabled: !!executionId,
    refetchInterval: 2_000,
  });
}

export function useAutonomousActions() {
  return useQuery({
    queryKey: autonomousKeys.actions(),
    queryFn: () => AutonomousClient.getActions(),
    staleTime: 300_000,
  });
}

// ── Mutations ──────────────────────────────────────────────────────────────

export function useAutonomousExecute() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: AutonomousRequest) =>
      AutonomousClient.execute(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: autonomousKeys.executions() });
      queryClient.invalidateQueries({ queryKey: autonomousKeys.status() });
    },
  });
}

export function useAutonomousPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: AutonomousRequest) =>
      AutonomousClient.plan(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: autonomousKeys.executions() });
    },
  });
}

export function useAutonomousApprove() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (executionId: string) =>
      AutonomousClient.approve(executionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: autonomousKeys.executions() });
      queryClient.invalidateQueries({ queryKey: autonomousKeys.status() });
    },
  });
}

export function useAutonomousCancel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (executionId: string) =>
      AutonomousClient.cancel(executionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: autonomousKeys.executions() });
      queryClient.invalidateQueries({ queryKey: autonomousKeys.status() });
    },
  });
}
