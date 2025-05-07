import { ipcMain } from "electron";
import log from "electron-log";
import { LocalModelListResponse, LocalModel } from "../ipc_types";

const logger = log.scope("ollama_handler");

const OLLAMA_API_URL = "http://localhost:11434";

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

export async function fetchOllamaModels(): Promise<LocalModelListResponse> {
  try {
    const response = await fetch(`${OLLAMA_API_URL}/api/tags`);
    if (!response.ok) {
      throw new Error(`Failed to fetch model: ${response.statusText}`);
    }

    const data = await response.json();
    const ollamaModels: OllamaModel[] = data.models || [];

    const models: LocalModel[] = ollamaModels.map((model: OllamaModel) => {
      const displayName = model.name
        .split(":")[0]
        .replace(/-/g, " ")
        .replace(/(\d+)/, " $1 ")
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
        .trim();

      return {
        modelName: model.name,
        displayName,
        provider: "ollama",
      };
    });
    logger.info(`Successfully fetched ${models.length} models from Ollama`);
    return { models, error: null };
  } catch (error) {
    if (
      error instanceof TypeError &&
      (error as Error).message.includes("fetch failed")
    ) {
      logger.error("Could not connect to Ollama");
      return {
        models: [],
        error:
          "Could not connect to Ollama. Make sure it's running at http://localhost:11434",
      };
    }
    return { models: [], error: "Failed to fetch models from Ollama" };
  }
}

export function registerOllamaHandlers() {
  ipcMain.handle(
    "local-models:list-ollama",
    async (): Promise<LocalModelListResponse> => {
      return fetchOllamaModels();
    },
  );
}
