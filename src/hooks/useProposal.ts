import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import type { ProposalResult } from "@/lib/schemas";
import { queryKeys } from "@/lib/queryKeys";

export function useProposal(
  chatId: number | undefined,
  { isStreaming }: { isStreaming: boolean },
) {
  const {
    data: proposalResult,
    isLoading,
    error,
    refetch: refreshProposal,
  } = useQuery<ProposalResult | null, Error>({
    queryKey: queryKeys.proposals.detail({ chatId }),
    queryFn: async (): Promise<ProposalResult | null> => {
      if (chatId === undefined) {
        return null;
      }
      return ipc.proposal.getProposal({ chatId });
    },
    enabled: chatId !== undefined && !isStreaming,
    staleTime: 0,
    meta: { showErrorToast: true },
  });

  return {
    proposalResult,
    isLoading,
    error,
    refreshProposal,
  };
}
