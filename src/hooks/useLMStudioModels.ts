import { useCallback } from "react";
import { useAtom } from "jotai";
import {
  lmStudioModelsAtom,
  lmStudioModelsLoadingAtom,
  lmStudioModelsErrorAtom,
} from "@/atoms/localModelsAtoms";
import { IpcClient } from "@/ipc/ipc_client";

/**
 * A hook for managing local LM Studio models.
 * @returns {object} An object with the list of models, loading state, error, and a function to load the models.
 * @property {import("@/ipc/ipc_types").LocalModel[]} models - The list of local models.
 * @property {boolean} loading - Whether the models are being loaded.
 * @property {Error | null} error - The error object if the query fails.
 * @property {() => Promise<import("@/ipc/ipc_types").LocalModel[]>} loadModels - A function to load the models.
 */
export function useLocalLMSModels() {
  const [models, setModels] = useAtom(lmStudioModelsAtom);
  const [loading, setLoading] = useAtom(lmStudioModelsLoadingAtom);
  const [error, setError] = useAtom(lmStudioModelsErrorAtom);

  const ipcClient = IpcClient.getInstance();

  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      const modelList = await ipcClient.listLocalLMStudioModels();
      setModels(modelList);
      setError(null);

      return modelList;
    } catch (error) {
      console.error("Error loading local LMStudio models:", error);
      setError(error instanceof Error ? error : new Error(String(error)));
      return [];
    } finally {
      setLoading(false);
    }
  }, [ipcClient, setModels, setError, setLoading]);

  return {
    models,
    loading,
    error,
    loadModels,
  };
}
