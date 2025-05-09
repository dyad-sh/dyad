import { ipcMain } from "electron";
import log from "electron-log";
import type { LocalModelListResponse, LocalModel } from "../ipc_types";
import {readSettings} from "../../main/settings.ts";
import {DEFAULT_LMSTUDIO_API_URL} from "../../constants/models.ts";

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
const settings = await readSettings();
const baseURL = settings?.providerSettings?.lmstudio?.baseURL || DEFAULT_LMSTUDIO_API_URL;
try {
  const modelsResponse: Response = await fetch(`${baseURL}/v1/models`);
    if (!modelsResponse.ok) {
      throw new Error("Failed to fetch models from LM Studio");
    }
    const modelsJson = await modelsResponse.json();
    const downloadedModels = modelsJson.data as LMStudioModel[];
    const models: LocalModel[] = downloadedModels
      .map((model: any) => ({
        modelName: model.id,
        displayName: model.id,
        provider: "lmstudio",
      }));

    logger.info(`Successfully fetched ${models.length} models from LM Studio`);
    return { models, error: null };
  } catch {
    return { models: [], error: "Failed to fetch models from LM Studio" };
  }
}

export function registerLMStudioHandlers() {
  ipcMain.handle(
    "local-models:list-lmstudio",
    async (): Promise<LocalModelListResponse> => {
      return fetchLMStudioModels();
    },
  );
}
