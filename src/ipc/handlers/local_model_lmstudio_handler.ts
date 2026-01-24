import log from "electron-log";
import { LM_STUDIO_BASE_URL } from "../utils/lm_studio_utils";
import { createTypedHandler } from "./base";
import { languageModelContracts } from "../types/language-model";
import type { LocalModel } from "../types/language-model";

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

export async function fetchLMStudioModels(): Promise<{ models: LocalModel[] }> {
  const modelsResponse: Response = await fetch(
    `${LM_STUDIO_BASE_URL}/api/v0/models`,
  );
  if (!modelsResponse.ok) {
    throw new Error("Failed to fetch models from LM Studio");
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
}

export function registerLMStudioHandlers() {
  createTypedHandler(languageModelContracts.listLMStudioModels, async () => {
    return fetchLMStudioModels();
  });
}
