import { ipcMain } from "electron";
import log from "electron-log";
import { LocalModelListResponse, LocalModel } from "../ipc_types";

const logger = log.scope("local_model_handlers");
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

export function registerLocalModelHandlers() {
  // Get list of models from Ollama
  ipcMain.handle(
    "local-models:list",
    async (): Promise<LocalModelListResponse> => {
      try {
        const response = await fetch(`${OLLAMA_API_URL}/api/tags`);

        if (!response.ok) {
          throw new Error(`Failed to fetch models: ${response.statusText}`);
        }

        const data = await response.json();
        const ollamaModels: OllamaModel[] = data.models || [];

        // Transform the data to return just what we need
        const models: LocalModel[] = ollamaModels.map((model) => {
          // Extract display name by cleaning up the model name
          // For names like "llama2:latest" we want to show "Llama 2"
          let displayName = model.name.split(":")[0]; // Remove tags like ":latest"

          // Capitalize and add spaces for readability
          displayName = displayName
            .replace(/-/g, " ")
            .replace(/(\d+)/, " $1 ") // Add spaces around numbers
            .split(" ")
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ")
            .trim();

          return {
            modelName: model.name, // The actual model name used for API calls
            displayName, // The user-friendly name
          };
        });

        logger.info(
          `Successfully fetched ${models.length} local models from Ollama`
        );
        return { models, error: null };
      } catch (error) {
        if (
          error instanceof TypeError &&
          (error as Error).message.includes("fetch failed")
        ) {
          logger.error("Could not connect to Ollama. Is it running?");
          return {
            models: [],
            error:
              "Could not connect to Ollama. Make sure it's running at http://localhost:11434",
          };
        }

        logger.error("Error fetching local models:", error);
        return { models: [], error: "Failed to fetch models from Ollama" };
      }
    }
  );
}
