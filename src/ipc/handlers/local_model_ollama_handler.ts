import log from "electron-log";
import { getOllamaApiUrl } from "@/lib/local_provider_utils";
import { readSettings } from "../../main/settings";
import { createTypedHandler } from "./base";
import { languageModelContracts } from "../types/language-model";
import type { LocalModel } from "../types/language-model";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { UserSettings } from "@/lib/schemas";

const logger = log.scope("ollama_handler");

export { getOllamaApiUrl, parseOllamaHost } from "@/lib/local_provider_utils";

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

export async function fetchOllamaModels(
  settings?: UserSettings | null,
): Promise<{ models: LocalModel[] }> {
  const apiUrl = getOllamaApiUrl(settings);

  try {
    const response = await fetch(`${apiUrl}/tags`);
    if (!response.ok) {
      throw new DyadError(
        `Failed to fetch models from Ollama (${response.status})`,
        DyadErrorKind.External,
      );
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
        sizeBytes: model.size,
        parameterSize: model.details?.parameter_size,
        quantization: model.details?.quantization_level,
        loaded: true,
      };
    });
    logger.info(`Successfully fetched ${models.length} models from Ollama`);
    return { models };
  } catch (error) {
    if (
      error instanceof TypeError &&
      (error as Error).message.includes("fetch failed")
    ) {
      throw new DyadError(
        `Could not connect to Ollama at ${apiUrl.replace(/\/api$/, "")}. Make sure Ollama is running.`,
        DyadErrorKind.External,
      );
    }
    if (error instanceof DyadError) {
      throw error;
    }
    throw new DyadError(
      "Failed to fetch models from Ollama",
      DyadErrorKind.External,
    );
  }
}

export function registerOllamaHandlers() {
  createTypedHandler(languageModelContracts.listOllamaModels, async () => {
    return fetchOllamaModels(readSettings());
  });
}
