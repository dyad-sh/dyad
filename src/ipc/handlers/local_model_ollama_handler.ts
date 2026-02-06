import { ipcMain } from "electron";
import log from "electron-log";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { LocalModelListResponse, LocalModel } from "../ipc_types";

const execFileAsync = promisify(execFile);
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
 * Find the `ollama` CLI binary path.
 */
function findOllamaCli(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    const candidate = path.join(localAppData, "Programs", "Ollama", "ollama.exe");
    if (fs.existsSync(candidate)) return candidate;
  }
  // Fallback: assume `ollama` is in PATH
  return "ollama";
}

/**
 * Register a model with the Ollama server using the CLI.
 *
 * Ollama ≥0.15 uses an internal SQLite DB that can get out of sync
 * with manifest files on disk. We use `ollama show --modelfile` to
 * extract the model definition, write it to a temp file, then
 * `ollama create <name> -f <tempfile>` to re-register it.
 */
async function ensureModelRegistered(modelName: string): Promise<boolean> {
  const ollamaCli = findOllamaCli();
  try {
    // Step 1: Get the model's Modelfile via CLI
    const { stdout: modelfile } = await execFileAsync(ollamaCli, [
      "show",
      modelName,
      "--modelfile",
    ], { timeout: 30_000 });

    if (!modelfile || !modelfile.includes("FROM")) {
      logger.warn(`Could not extract modelfile for ${modelName}`);
      return false;
    }

    // Step 2: Write modelfile to a temp file
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `ollama-register-${modelName.replace(/[:/]/g, "_")}.modelfile`);
    await fs.promises.writeFile(tmpFile, modelfile, "utf-8");

    // Step 3: Re-create the model via CLI (registers it in the DB)
    await execFileAsync(ollamaCli, [
      "create",
      modelName,
      "-f",
      tmpFile,
    ], { timeout: 300_000 }); // 5min timeout for large models

    // Step 4: Clean up temp file
    fs.promises.unlink(tmpFile).catch(() => {});

    logger.info(`Registered disk-only model with Ollama server via CLI: ${modelName}`);
    return true;
  } catch (error) {
    logger.warn(`Failed to register model ${modelName} via CLI:`, error);
    return false;
  }
}

/**
 * Ensure a model is available in the Ollama server for inference.
 * Checks the API first; if the model is not found, registers it
 * using the Ollama CLI (which is more reliable than the API for this).
 *
 * Called from get_model_client.ts before creating the AI SDK provider,
 * so that "model not found" errors from Ollama are avoided.
 */
export async function ensureOllamaModelReady(modelName: string): Promise<void> {
  const apiUrl = getOllamaApiUrl();
  try {
    // Quick check: is the model already known to the server?
    const showRes = await fetch(`${apiUrl}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(5_000),
    });
    if (showRes.ok) {
      return; // Model is known to the server, nothing to do
    }
  } catch {
    // Server might not be running; we'll still try to register
  }

  // Model not in the server — try to register it from disk via CLI
  logger.info(
    `Model "${modelName}" not found in Ollama server, registering from disk...`,
  );
  await ensureModelRegistered(modelName);
}

/**
 * Fetch Ollama models by merging results from both the HTTP API and
 * a direct disk scan of the manifests directory. The disk scan catches
 * models that the API may fail to report (a known Ollama ≥0.15 bug
 * where /api/tags gets out of sync with the actual installed models).
 *
 * Any disk-only models are automatically registered with the Ollama
 * server via /api/create so they become usable for inference.
 */
export async function fetchOllamaModels(): Promise<LocalModelListResponse> {
  logger.info("Fetching Ollama models (API + disk scan)...");

  const [apiModels, diskModelNames] = await Promise.all([
    fetchOllamaModelsFromApi(),
    scanOllamaManifests(),
  ]);

  // Merge: start with API results, then add any disk-only models
  const apiModelNames = new Set(apiModels.map((m) => m.modelName));
  const models: LocalModel[] = [...apiModels];
  const diskOnlyNames = diskModelNames.filter((n) => !apiModelNames.has(n));

  if (diskOnlyNames.length > 0) {
    logger.info(
      `Found ${diskOnlyNames.length} disk-only models not in API, registering with server...`,
    );

    // Register disk-only models in the background so they become usable
    // for inference. We don't await all of them to avoid blocking the
    // model list from returning, but we do add them to the returned list
    // immediately so the UI shows them.
    for (const name of diskOnlyNames) {
      models.push({
        modelName: name,
        displayName: formatDisplayName(name),
        provider: "ollama",
      });
      // Fire-and-forget registration — next time the list is fetched
      // they'll be in the API directly
      ensureModelRegistered(name).catch(() => {});
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
