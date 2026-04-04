/**
 * Creator Dashboard Hooks — TanStack Query integration for the unified creator dashboard.
 */

import { useQuery } from "@tanstack/react-query";
import { IpcClient } from "../ipc/ipc_client";
import type {
  CreatorOverview,
  CreatorAssetRecord,
  EarningsBreakdown,
  CreatorAnalytics,
} from "@/types/publish_types";

const client = IpcClient.getInstance();

// ============================================================================
// Query Keys
// ============================================================================

export const creatorKeys = {
  all: ["creator"] as const,
  overview: () => [...creatorKeys.all, "overview"] as const,
  assets: () => [...creatorKeys.all, "assets"] as const,
  earnings: () => [...creatorKeys.all, "earnings"] as const,
  analytics: () => [...creatorKeys.all, "analytics"] as const,
};

// ============================================================================
// Hooks
// ============================================================================

export function useCreatorOverview() {
  return useQuery({
    queryKey: creatorKeys.overview(),
    queryFn: () => client.creatorGetOverview(),
    staleTime: 30_000,
  });
}

export function useCreatorAssets() {
  return useQuery({
    queryKey: creatorKeys.assets(),
    queryFn: () => client.creatorGetAllAssets(),
    staleTime: 30_000,
  });
}

export function useCreatorEarnings() {
  return useQuery({
    queryKey: creatorKeys.earnings(),
    queryFn: () => client.creatorGetEarningsBreakdown(),
    staleTime: 60_000,
  });
}

export function useCreatorAnalytics() {
  return useQuery({
    queryKey: creatorKeys.analytics(),
    queryFn: () => client.creatorGetAnalytics(),
    staleTime: 60_000,
  });
}
