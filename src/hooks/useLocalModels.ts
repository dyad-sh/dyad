import { useCallback } from "react";
import { useAtom } from "jotai";
import {
  localModelsAtom,
  localModelsLoadingAtom,
  localModelsErrorAtom,
} from "@/atoms/localModelsAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import log from "electron-log";

const logger = log.scope("useLocalModels");

export function useLocalModels() {
  const [models, setModels] = useAtom(localModelsAtom);
  const [loading, setLoading] = useAtom(localModelsLoadingAtom);
  const [error, setError] = useAtom(localModelsErrorAtom);

  const ipcClient = IpcClient.getInstance();

  /**
   * Load local models from Ollama
   */
  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      const modelList = await ipcClient.listLocalOllamaModels();
      setModels(modelList);
      setError(null);

      return modelList;
    } catch (error) {
      logger.error("Error loading local Ollama models:", error);
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
