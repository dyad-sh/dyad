/**
 * React hooks for OpenClaw Activity Log
 * Provides persistent activity feed, channel message history,
 * and activity statistics — data survives even when JoyCreate is closed.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";

// Query keys
const ACTIVITY_KEYS = {
  list: (filters?: Record<string, unknown>) => ["openclaw", "activity", "list", filters ?? {}],
  stats: (since?: number) => ["openclaw", "activity", "stats", since ?? "all"],
  messages: (filters?: Record<string, unknown>) => ["openclaw", "activity", "messages", filters ?? {}],
};

// ─── Activity Log ───────────────────────────────────────────────────────────

export function useActivityLog(filters?: {
  eventType?: string | string[];
  channel?: string | string[];
  actor?: string;
  direction?: "inbound" | "outbound" | "internal";
  search?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}) {
  const ipc = IpcClient.getInstance();

  return useQuery({
    queryKey: ACTIVITY_KEYS.list(filters),
    queryFn: () => ipc.listActivity(filters),
    refetchInterval: 15_000, // Refresh every 15s for live feel
  });
}

export function useActivityStats(since?: number) {
  const ipc = IpcClient.getInstance();

  return useQuery({
    queryKey: ACTIVITY_KEYS.stats(since),
    queryFn: () => ipc.getActivityStats(since),
    refetchInterval: 30_000,
  });
}

export function useLogActivity() {
  const queryClient = useQueryClient();
  const ipc = IpcClient.getInstance();

  return useMutation({
    mutationFn: (params: Parameters<typeof ipc.logActivity>[0]) =>
      ipc.logActivity(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["openclaw", "activity"] });
    },
  });
}

// ─── Channel Messages ───────────────────────────────────────────────────────

export function useChannelMessages(filters?: {
  channel?: string | string[];
  channelId?: string;
  senderId?: string;
  isBot?: boolean;
  search?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}) {
  const ipc = IpcClient.getInstance();

  return useQuery({
    queryKey: ACTIVITY_KEYS.messages(filters),
    queryFn: () => ipc.listChannelMessages(filters),
    refetchInterval: 10_000,
  });
}

export function useSaveChannelMessage() {
  const queryClient = useQueryClient();
  const ipc = IpcClient.getInstance();

  return useMutation({
    mutationFn: (params: Parameters<typeof ipc.saveChannelMessage>[0]) =>
      ipc.saveChannelMessage(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["openclaw", "activity", "messages"] });
    },
  });
}
