import {
  DEFAULT_OLLAMA_ENDPOINT,
  DEFAULT_OLLAMA_PORT,
} from "@/constants/localModels";
import { ipcMain } from "electron";
import log from "electron-log";
import { readSettings } from "../../main/settings";
import { LocalModel, LocalModelListResponse } from "../ipc_types";

const logger = log.scope("ollama_handler");

export function parseOllamaHost(host?: string): string {
  if (!host) {
    return DEFAULT_OLLAMA_ENDPOINT;
  }

  if (!host) {
    return DEFAULT_OLLAMA_ENDPOINT;
  }

  const hostWithoutWhitespace = host.replace(/\s+/g, "");
  if (!hostWithoutWhitespace) {
    return DEFAULT_OLLAMA_ENDPOINT;
  }

  // If it already has a protocol, use as-is
  if (
    hostWithoutWhitespace.startsWith("http://") ||
    hostWithoutWhitespace.startsWith("https://")
  ) {
    return hostWithoutWhitespace;
  }

  if (
    hostWithoutWhitespace.startsWith("[") &&
    hostWithoutWhitespace.includes("]:")
  ) {
    return `http://${hostWithoutWhitespace}`;
  }

  if (
    hostWithoutWhitespace.includes(":") &&
    !hostWithoutWhitespace.includes("::") &&
    hostWithoutWhitespace.split(":").length === 2
  ) {
    return `http://${hostWithoutWhitespace}`;
  }

  if (
    hostWithoutWhitespace.includes("::") ||
    hostWithoutWhitespace.split(":").length > 2
  ) {
    const address = hostWithoutWhitespace.startsWith("[")
      ? hostWithoutWhitespace
      : `[${hostWithoutWhitespace}]`;
    return `http://${address}:${DEFAULT_OLLAMA_PORT}`;
  }

  return `http://${hostWithoutWhitespace}:${DEFAULT_OLLAMA_PORT}`;
}

export function getOllamaApiUrl(): string {
  const envHost = process.env.OLLAMA_HOST;
  if (envHost && envHost.trim()) {
    return parseOllamaHost(envHost);
  }
  const settings = readSettings();
  const endpointFromSettings = settings.ollamaEndpoint;
  return parseOllamaHost(endpointFromSettings);
}

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
  const apiUrl = getOllamaApiUrl();
  try {
    const response = await fetch(`${apiUrl}/api/tags`);
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
    return { models };
  } catch (error) {
    if (
      error instanceof TypeError &&
      (error as Error).message.includes("fetch failed")
    ) {
      throw new Error(
        `Could not connect to the local model endpoint at ${apiUrl}.`,
      );
    }
    throw new Error("Failed to fetch models from the local model endpoint");
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
