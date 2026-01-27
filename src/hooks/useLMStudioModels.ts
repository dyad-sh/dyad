import { useCallback, useMemo } from "react";
import { useAtom } from "jotai";
import {
  lmStudioModelsAtom,
  lmStudioModelsLoadingAtom,
  lmStudioModelsErrorAtom,
} from "@/atoms/localModelsAtoms";
import { IpcClient } from "@/ipc/ipc_client";

export function useLocalLMSModels() {
  const [models, setModels] = useAtom(lmStudioModelsAtom);
  const [loading, setLoading] = useAtom(lmStudioModelsLoadingAtom);
  const [error, setError] = useAtom(lmStudioModelsErrorAtom);

  // Get stable reference to IPC client
  const ipcClient = useMemo(() => IpcClient.getInstance(), []);

  /**
   * Load local models from LM Studio
   */
  const loadModels = useCallback(async () => {
    console.log("[useLMStudioModels] Loading LM Studio models...");
    setLoading(true);
    try {
      const modelList = await ipcClient.listLocalLMStudioModels();
      console.log(`[useLMStudioModels] Loaded ${modelList.length} LM Studio models`);
      setModels(modelList);
      setError(null);

      return modelList;
    } catch (error) {
      // Only log if it's not a "fetch failed" error (LMStudio not running)
      const isFetchError = error instanceof Error && error.message.includes("fetch failed");
      if (!isFetchError) {
        console.error("Error loading local LMStudio models:", error);
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
