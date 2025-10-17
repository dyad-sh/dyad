import { useCallback } from "react";
import { atom, useAtom } from "jotai";
import { IpcClient } from "@/ipc/ipc_client";
import type { TokenCountResult } from "@/ipc/ipc_types";

// Create atoms to store the token count state
/**
 * An atom to store the token count result.
 */
export const tokenCountResultAtom = atom<TokenCountResult | null>(null);
/**
 * An atom to store the loading state of the token count.
 */
export const tokenCountLoadingAtom = atom<boolean>(false);
/**
 * An atom to store the error state of the token count.
 */
export const tokenCountErrorAtom = atom<Error | null>(null);

/**
 * A hook for counting tokens in a chat.
 * @returns {object} An object with a function to count tokens, the result, loading state, and error.
 * @property {(chatId: number, input: string) => Promise<TokenCountResult>} countTokens - A function to count tokens.
 * @property {TokenCountResult | null} result - The result of the token count.
 * @property {boolean} loading - Whether the token count is loading.
 * @property {Error | null} error - The error object if the token count fails.
 */
export function useCountTokens() {
  const [result, setResult] = useAtom(tokenCountResultAtom);
  const [loading, setLoading] = useAtom(tokenCountLoadingAtom);
  const [error, setError] = useAtom(tokenCountErrorAtom);

  const countTokens = useCallback(
    async (chatId: number, input: string) => {
      setLoading(true);
      setError(null);

      try {
        const ipcClient = IpcClient.getInstance();
        const tokenResult = await ipcClient.countTokens({ chatId, input });
        setResult(tokenResult);
        return tokenResult;
      } catch (error) {
        console.error("Error counting tokens:", error);
        setError(error instanceof Error ? error : new Error(String(error)));
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [setLoading, setError, setResult],
  );

  return {
    countTokens,
    result,
    loading,
    error,
  };
}
