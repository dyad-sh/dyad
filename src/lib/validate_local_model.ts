import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { discoverLMStudioModelsCached } from "@/lib/lm_studio_models";
import {
  getLMStudioBaseUrlFromSettings,
  getOllamaApiUrl,
  isLocalProviderId,
} from "@/lib/local_provider_utils";
import type { LargeLanguageModel, UserSettings } from "@/lib/schemas";

interface OllamaTagsResponse {
  models?: { name: string }[];
}

const OLLAMA_CACHE_TTL_MS = 30_000;
const ollamaTagsCache = new Map<
  string,
  { expiresAt: number; modelNames: Set<string> }
>();

async function getOllamaModelNames(
  settings?: UserSettings | null,
): Promise<Set<string>> {
  const apiUrl = getOllamaApiUrl(settings);
  const now = Date.now();
  const cached = ollamaTagsCache.get(apiUrl);
  if (cached && cached.expiresAt > now) {
    return cached.modelNames;
  }

  const response = await fetch(`${apiUrl}/tags`);
  if (!response.ok) {
    throw new DyadError(
      `Could not list Ollama models (${response.status}). Is Ollama running?`,
      DyadErrorKind.External,
    );
  }

  const data = (await response.json()) as OllamaTagsResponse;
  const modelNames = new Set(
    (data.models ?? []).map((m) => m.name).filter(Boolean),
  );
  ollamaTagsCache.set(apiUrl, {
    expiresAt: now + OLLAMA_CACHE_TTL_MS,
    modelNames,
  });
  return modelNames;
}

function modelNameMatchesLoaded(
  selected: string,
  loadedNames: Iterable<string>,
): boolean {
  const normalized = selected.trim();
  if (!normalized) return false;

  const loaded = [...loadedNames];
  if (loaded.some((name) => name === normalized)) {
    return true;
  }

  // Ollama tags may omit ":latest"; LM Studio ids are exact.
  const withoutTag = normalized.split(":")[0];
  return loaded.some(
    (name) =>
      name === withoutTag ||
      name.startsWith(`${withoutTag}:`) ||
      name.split(":")[0] === withoutTag,
  );
}

/**
 * Fail fast before streaming when a local model server is down or the model
 * is not available — avoids opaque SDK errors mid-stream.
 */
export async function assertLocalModelReady(
  model: LargeLanguageModel,
  settings?: UserSettings | null,
): Promise<void> {
  if (!isLocalProviderId(model.provider)) {
    return;
  }

  const modelName = model.name?.trim();
  if (!modelName) {
    throw new DyadError(
      "No model selected. Choose a model in the chat picker.",
      DyadErrorKind.Validation,
    );
  }

  if (model.provider === "lmstudio") {
    const baseUrl = getLMStudioBaseUrlFromSettings(settings);
    let discovery: Awaited<ReturnType<typeof discoverLMStudioModelsCached>>;
    try {
      discovery = await discoverLMStudioModelsCached(baseUrl);
    } catch (error) {
      if (
        error instanceof TypeError &&
        (error as Error).message.includes("fetch failed")
      ) {
        throw new DyadError(
          `Could not connect to LM Studio at ${baseUrl}. Enable the local server in LM Studio → Developer.`,
          DyadErrorKind.External,
        );
      }
      throw error;
    }

    if (!discovery.reachable) {
      throw new DyadError(
        `Could not connect to LM Studio at ${baseUrl}. Enable the local server in LM Studio → Developer.`,
        DyadErrorKind.External,
      );
    }

    if (discovery.models.length === 0) {
      throw new DyadError(
        "Connected to LM Studio but no chat models are loaded. Load a model until it shows READY, then try again.",
        DyadErrorKind.External,
      );
    }

    const loadedIds = discovery.models.map((m) => m.modelName);
    if (!modelNameMatchesLoaded(modelName, loadedIds)) {
      const preview = loadedIds.slice(0, 5).join(", ");
      const suffix =
        loadedIds.length > 5 ? ` (+${loadedIds.length - 5} more)` : "";
      throw new DyadError(
        `Model "${modelName}" is not loaded in LM Studio. Loaded: ${preview}${suffix}. Pick a loaded model or load this one in LM Studio.`,
        DyadErrorKind.Validation,
      );
    }
    return;
  }

  if (model.provider === "ollama") {
    let modelNames: Set<string>;
    try {
      modelNames = await getOllamaModelNames(settings);
    } catch (error) {
      if (
        error instanceof TypeError &&
        (error as Error).message.includes("fetch failed")
      ) {
        const host = getOllamaApiUrl(settings).replace(/\/api$/, "");
        throw new DyadError(
          `Could not connect to Ollama at ${host}. Make sure Ollama is running.`,
          DyadErrorKind.External,
        );
      }
      throw error;
    }

    if (modelNames.size === 0) {
      throw new DyadError(
        "Ollama is running but no models are installed. Run `ollama pull <model>` first.",
        DyadErrorKind.External,
      );
    }

    if (!modelNameMatchesLoaded(modelName, modelNames)) {
      const preview = [...modelNames].slice(0, 5).join(", ");
      throw new DyadError(
        `Model "${modelName}" is not available in Ollama. Installed: ${preview}. Run \`ollama pull ${modelName.split(":")[0]}\` or pick another model.`,
        DyadErrorKind.Validation,
      );
    }
  }
}
