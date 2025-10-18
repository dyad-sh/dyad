import { useCallback } from "react";
import { useAtom } from "jotai";
import {
  localModelsAtom,
  localModelsLoadingAtom,
  localModelsErrorAtom,
} from "@/atoms/localModelsAtoms";
import { IpcClient } from "@/ipc/ipc_client";

/**
 * A hook for managing local models from Ollama.
 * @returns {object} An object with the list of models, loading state, error, and a function to load the models.
 * @property {import("@/ipc/ipc_types").LocalModel[]} models - The list of local models.
 * @property {boolean} loading - Whether the models are being loaded.
 * @property {Error | null} error - The error object if the query fails.
 * @property {() => Promise<import("@/ipc/ipc_types").LocalModel[]>} loadModels - A function to load the models.
 */
export function useLocalModels() {
  const [models, setModels] = useAtom(localModelsAtom);
  const [loading, setLoading] = useAtom(localModelsLoadingAtom);
  const [error, setError] = useAtom(localModelsErrorAtom);

  const ipcClient = IpcClient.getInstance();

  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      const modelList = await ipcClient.listLocalOllamaModels();
      setModels(modelList);
      setError(null);

      return modelList;
    } catch (error) {
      console.error("Error loading local Ollama models:", error);
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
