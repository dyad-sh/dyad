import { useState, useEffect, useCallback } from "react";
import { IpcClient } from "@/ipc/ipc_client";
import type { ProposalResult } from "@/lib/schemas"; // Import Proposal type
import { proposalResultAtom } from "@/atoms/proposalAtoms";
import { useAtom } from "jotai";
export function useProposal(chatId?: number | undefined) {
  const [proposalResult, setProposalResult] = useAtom(proposalResultAtom);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const fetchProposal = useCallback(
    async (overrideChatId?: number) => {
      chatId = overrideChatId ?? chatId;
      if (chatId === undefined) {
        setProposalResult(null);
        setIsLoading(false);
        setError(null);
        return;
      }
      setIsLoading(true);
      setError(null);
      try {
        // Type assertion might be needed depending on how IpcClient is typed
        const result = (await IpcClient.getInstance().getProposal(
          chatId,
        )) as ProposalResult | null;

        if (result) {
          setProposalResult(result);
        } else {
          setProposalResult(null); // Explicitly set to null if IPC returns null
        }
      } catch (err: any) {
        console.error("Error fetching proposal:", err);
        setError(err.message || "Failed to fetch proposal");
        setProposalResult(null); // Clear proposal data on error
      } finally {
        setIsLoading(false);
      }
    },
    [chatId], // Only depend on chatId, setProposalResult is stable
  ); // Depend on chatId

  useEffect(() => {
    fetchProposal();

    // Cleanup function if needed (e.g., for aborting requests)
    // return () => {
    //   // Abort logic here
    // };
  }, [fetchProposal]); // Re-run effect if fetchProposal changes (due to chatId change)

  return {
    proposalResult: proposalResult,
    isLoading,
    error,
    refreshProposal: fetchProposal, // Expose the refresh function
  };
}
