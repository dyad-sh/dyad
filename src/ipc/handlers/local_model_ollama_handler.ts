import { ipcMain } from "electron";
import log from "electron-log";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
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

/**
 * Get the Ollama models directory. Respects OLLAMA_MODELS env var,
 * otherwise defaults to ~/.ollama/models.
 */
function getOllamaModelsDir(): string {
  return (
    process.env.OLLAMA_MODELS || path.join(os.homedir(), ".ollama", "models")
  );
}

/**
 * Format a model name into a human-readable display name.
 */
function formatDisplayName(modelName: string): string {
  return modelName
    .split(":")[0]
    .replace(/-/g, " ")
    .replace(/(\d+)/, " $1 ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
    .trim();
}

/**
 * Scan the Ollama manifest directory on disk to discover installed models.
 * This is more reliable than the /api/tags endpoint which can get out of sync.
 * Structure: {modelsDir}/manifests/registry.ollama.ai/library/{model}/{tag}
 */
async function scanOllamaManifests(): Promise<string[]> {
  const modelsDir = getOllamaModelsDir();
  const manifestsDir = path.join(
    modelsDir,
    "manifests",
    "registry.ollama.ai",
    "library",
  );

  try {
    const entries = await fs.promises.readdir(manifestsDir, {
      withFileTypes: true,
    });
    const modelNames: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const modelDir = path.join(manifestsDir, entry.name);
      const tags = await fs.promises.readdir(modelDir, {
        withFileTypes: true,
      });

      for (const tag of tags) {
        if (tag.isFile()) {
          modelNames.push(`${entry.name}:${tag.name}`);
        }
      }
    }

    logger.info(
      `Disk scan found ${modelNames.length} Ollama models in ${manifestsDir}`,
    );
    return modelNames;
  } catch (error) {
    logger.debug(
      "Could not scan Ollama manifests directory (Ollama may not be installed):",
      error,
    );
    return [];
  }
}

/**
 * Fetch models from the Ollama HTTP API (/api/tags).
 */
async function fetchOllamaModelsFromApi(): Promise<LocalModel[]> {
  const apiUrl = `${getOllamaApiUrl()}/api/tags`;
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      logger.warn("Ollama API returned error status");
      return [];
    }

    const data = await response.json();
    const ollamaModels: OllamaModel[] = data.models || [];

    return ollamaModels.map((model: OllamaModel) => ({
      modelName: model.name,
      displayName: formatDisplayName(model.name),
      provider: "ollama" as const,
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch Ollama models by merging results from both the HTTP API and
 * a direct disk scan of the manifests directory. The disk scan catches
 * models that the API may fail to report (a known Ollama bug where
 * /api/tags gets out of sync with the actual installed models).
 */
export async function fetchOllamaModels(): Promise<LocalModelListResponse> {
  logger.info("Fetching Ollama models (API + disk scan)...");

  const [apiModels, diskModelNames] = await Promise.all([
    fetchOllamaModelsFromApi(),
    scanOllamaManifests(),
  ]);

  // Merge: start with API results, then add any disk-only models
  const seen = new Set<string>();
  const models: LocalModel[] = [];

  for (const model of apiModels) {
    seen.add(model.modelName);
    models.push(model);
  }

  for (const name of diskModelNames) {
    if (!seen.has(name)) {
      models.push({
        modelName: name,
        displayName: formatDisplayName(name),
        provider: "ollama",
      });
    }
  }

  logger.info(
    `Ollama models: ${apiModels.length} from API, ${diskModelNames.length} from disk, ${models.length} total (merged)`,
  );
  return { models };
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
