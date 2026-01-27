import { useCallback, useMemo } from "react";
import { useAtom } from "jotai";
import {
  localModelsAtom,
  localModelsLoadingAtom,
  localModelsErrorAtom,
} from "@/atoms/localModelsAtoms";
import { IpcClient } from "@/ipc/ipc_client";

export function useLocalModels() {
  const [models, setModels] = useAtom(localModelsAtom);
  const [loading, setLoading] = useAtom(localModelsLoadingAtom);
  const [error, setError] = useAtom(localModelsErrorAtom);

  // Get stable reference to IPC client
  const ipcClient = useMemo(() => IpcClient.getInstance(), []);

  /**
   * Load local models from Ollama
   */
  const loadModels = useCallback(async () => {
    console.log("[useLocalModels] Loading Ollama models...");
    setLoading(true);
    try {
      const modelList = await ipcClient.listLocalOllamaModels();
      console.log(`[useLocalModels] Loaded ${modelList.length} Ollama models`);
      setModels(modelList);
      setError(null);

      return modelList;
    } catch (error) {
      // Only log if it's not a connection error (Ollama not running)
      const isConnectionError = error instanceof Error && 
        (error.message.includes("fetch failed") || error.message.includes("Could not connect"));
      if (!isConnectionError) {
        console.error("Error loading local Ollama models:", error);
      }
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
