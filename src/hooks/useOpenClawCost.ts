/**
 * OpenClaw Cost Engine — TanStack Query hooks for cost tracking & budget management
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CostClient } from "@/ipc/openclaw_cost_client";
import type { CostBudget, TaskModule, TaskModelRoute, TaskModelRouting } from "@/lib/openclaw_cost_engine";

export const costKeys = {
  all: ["openclaw-cost"] as const,
  summary: () => [...costKeys.all, "summary"] as const,
  records: (limit?: number) => [...costKeys.all, "records", limit] as const,
  budget: () => [...costKeys.all, "budget"] as const,
  taskRouting: () => [...costKeys.all, "task-routing"] as const,
};

export function useCostSummary() {
  return useQuery({
    queryKey: costKeys.summary(),
    queryFn: () => CostClient.getSummary(),
    refetchInterval: 5_000,
  });
}

export function useCostRecords(limit = 50) {
  return useQuery({
    queryKey: costKeys.records(limit),
    queryFn: () => CostClient.getRecords(limit),
    refetchInterval: 10_000,
  });
}

export function useCostBudget() {
  return useQuery({
    queryKey: costKeys.budget(),
    queryFn: () => CostClient.getBudget(),
    staleTime: 60_000,
  });
}

export function useSetCostBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (budget: Partial<CostBudget>) => CostClient.setBudget(budget),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: costKeys.budget() });
      queryClient.invalidateQueries({ queryKey: costKeys.summary() });
    },
  });
}

// ── Task Routing Hooks ──

export function useTaskRouting() {
  return useQuery({
    queryKey: costKeys.taskRouting(),
    queryFn: () => CostClient.getTaskRouting(),
    staleTime: 60_000,
  });
}

export function useSetTaskRouting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (updates: Partial<Record<TaskModule, TaskModelRoute>>) =>
      CostClient.setTaskRouting(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: costKeys.taskRouting() });
    },
  });
}

export function useResetTaskRouting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => CostClient.resetTaskRouting(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: costKeys.taskRouting() });
    },
  });
}
