import { useState, useEffect, useCallback } from "react";
import { IpcClient } from "@/ipc/ipc_client";
import type { ProposalResult } from "@/lib/schemas"; // Import Proposal type
import { proposalResultAtom } from "@/atoms/proposalAtoms";
import { useAtom } from "jotai";
/**
 * A hook for fetching a proposal for a chat.
 * @param {number | undefined} chatId - The ID of the chat.
 * @returns {object} An object with the proposal result, loading state, error, and a function to refresh the proposal.
 * @property {ProposalResult | null} proposalResult - The proposal result.
 * @property {boolean} isLoading - Whether the proposal is being loaded.
 * @property {string | null} error - The error message if the query fails.
 * @property {(overrideChatId?: number) => Promise<void>} refreshProposal - A function to refresh the proposal.
 */
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
    [chatId, setProposalResult],
  );

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
