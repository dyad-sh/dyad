import { ipcMain } from "electron";
import log from "electron-log";
import type { LocalModelListResponse, LocalModel } from "../ipc_types";
import { LM_STUDIO_BASE_URL } from "../utils/lm_studio_utils";

const logger = log.scope("lmstudio_handler");

export interface LMStudioModel {
  type: "llm" | "embedding" | string;
  id: string;
  object: string;
  publisher: string;
  state: "loaded" | "not-loaded";
  max_context_length: number;
  quantization: string;
  compatibility_type: string;
  arch: string;
  [key: string]: any;
}

export async function fetchLMStudioModels(): Promise<LocalModelListResponse> {
  try {
    const modelsResponse: Response = await fetch(
      `${LM_STUDIO_BASE_URL}/api/v0/models`,
    );
    if (!modelsResponse.ok) {
      logger.warn("LM Studio not available or returned error status");
      return { models: [] };
    }
    const modelsJson = await modelsResponse.json();
    const downloadedModels = modelsJson.data as LMStudioModel[];
    const models: LocalModel[] = downloadedModels
      .filter((model: any) => model.type === "llm")
      .map((model: any) => ({
        modelName: model.id,
        displayName: model.id,
        provider: "lmstudio",
      }));

    logger.info(`Successfully fetched ${models.length} models from LM Studio`);
    return { models };
  } catch (error) {
    // LM Studio is not running or not available - this is expected
    logger.debug("LM Studio not available (this is normal if not running)");
    return { models: [] };
  }
}

export function registerLMStudioHandlers() {
  ipcMain.handle(
    "local-models:list-lmstudio",
    async (): Promise<LocalModelListResponse> => {
      logger.info("Fetching LM Studio models...");
      const result = await fetchLMStudioModels();
      logger.info(`Returning ${result.models.length} LM Studio models`);
      return result;
    },
  );
}
