import { useQuery } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import type { ProposalResult } from "@/lib/schemas";

export function useProposal(chatId?: number | undefined) {
  const {
    data: proposalResult,
    isLoading,
    error,
    refetch: refreshProposal,
  } = useQuery<ProposalResult | null, Error>({
    queryKey: ["proposal", chatId],
    queryFn: async (): Promise<ProposalResult | null> => {
      if (chatId === undefined) {
        return null;
      }
      return IpcClient.getInstance().getProposal(chatId);
    },
    enabled: chatId !== undefined,
    meta: { showErrorToast: true },
  });

  return {
    proposalResult,
    isLoading,
    error,
    refreshProposal,
  };
}
