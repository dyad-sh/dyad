/**
 * useFlywheel — TanStack Query hooks for the Data Flywheel system
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlywheelClient } from "@/ipc/flywheel_client";

const client = FlywheelClient.getInstance();

/** Rate a message (thumbs up/down) */
export function useRateMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      messageId,
      rating,
    }: {
      messageId: number;
      rating: "positive" | "negative";
    }) => client.rateMessage(messageId, rating),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flywheel-stats"] });
      queryClient.invalidateQueries({ queryKey: ["chat-messages"] });
    },
  });
}

/** Correct a message */
export function useCorrectMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      messageId,
      correctedOutput,
    }: {
      messageId: number;
      correctedOutput: string;
    }) => client.correctMessage(messageId, correctedOutput),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flywheel-stats"] });
    },
  });
}

/** Get flywheel stats */
export function useFlywheelStats(agentId?: number) {
  return useQuery({
    queryKey: ["flywheel-stats", agentId],
    queryFn: () => client.getStats(agentId),
  });
}

/** Get flywheel run history */
export function useFlywheelRuns(agentId?: number) {
  return useQuery({
    queryKey: ["flywheel-runs", agentId],
    queryFn: () => client.getRuns(agentId),
  });
}

/** Manually trigger a flywheel cycle */
export function useRunFlywheelCycle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (agentId?: number) => client.runCycle(agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flywheel-stats"] });
      queryClient.invalidateQueries({ queryKey: ["flywheel-runs"] });
    },
  });
}
