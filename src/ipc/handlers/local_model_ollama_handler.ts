import { ipcMain } from "electron";
import log from "electron-log";
import { LocalModelListResponse, LocalModel } from "../ipc_types";

const logger = log.scope("ollama_handler");

export function parseOllamaHost(host?: string): string {
  if (!host) {
    return "http://localhost:11434";
  }

  // If it already has a protocol, use as-is
  if (host.startsWith("http://") || host.startsWith("https://")) {
    return host;
  }

  // Check for bracketed IPv6 with port: [::1]:8080
  if (host.startsWith("[") && host.includes("]:")) {
    return `http://${host}`;
  }

  // Check for regular host:port (but not plain IPv6)
  if (
    host.includes(":") &&
    !host.includes("::") &&
    host.split(":").length === 2
  ) {
    return `http://${host}`;
  }

  // Check if it's a plain IPv6 address (contains :: or multiple colons)
  if (host.includes("::") || host.split(":").length > 2) {
    return `http://[${host}]:11434`;
  }

  // If it's just a hostname, add default port
  return `http://${host}:11434`;
}

export function getOllamaApiUrl(): string {
  return parseOllamaHost(process.env.OLLAMA_HOST);
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
  const apiUrl = `${getOllamaApiUrl()}/api/tags`;
  logger.info(`Fetching Ollama models from: ${apiUrl}`);
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      logger.warn("Ollama not available or returned error status");
      return { models: [] };
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
    // Ollama is not running or not available - this is expected
    if (
      error instanceof TypeError &&
      (error as Error).message.includes("fetch failed")
    ) {
      logger.debug("Ollama not available (this is normal if not running)");
    } else {
      logger.warn("Failed to fetch models from Ollama:", error);
    }
    return { models: [] };
  }
}

export function registerOllamaHandlers() {
  ipcMain.handle(
    "local-models:list-ollama",
    async (): Promise<LocalModelListResponse> => {
      logger.info("Fetching Ollama models...");
      const result = await fetchOllamaModels();
      logger.info(`Returning ${result.models.length} Ollama models`);
      return result;
    },
  );
}
