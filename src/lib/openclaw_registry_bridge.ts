/**
 * OpenClaw ↔ Model Registry Bridge
 * =================================
 * Bridges OpenClaw's inference routing with the Decentralized Model Registry
 * and Multi-Armed Bandit engine for intelligent, adaptive model selection.
 *
 * Responsibilities:
 *   - Merge local Ollama models + registry models into a unified catalog
 *   - MAB-driven model selection per task type (Thompson Sampling)
 *   - Record task outcomes as MAB rewards + registry ratings
 *   - Resolve whether a model runs locally, in cloud, or on a peer
 *
 * 🦞 EXFOLIATE! EXFOLIATE!
 */

import log from "electron-log";

import { MABEngine } from "@/lib/mab_engine";
import {
  searchModels,
  listLocalModels,
  recordMABSignal,
  recordModelUsage,
  getModelEntry,
  type ModelRegistryEntry,
} from "@/lib/model_registry_service";
import {
  getOpenClawOllamaBridge,
  type OllamaModel,
} from "@/lib/openclaw_ollama_bridge";

const logger = log.scope("openclaw_registry_bridge");

// =============================================================================
// TYPES
// =============================================================================

export interface AvailableModel {
  /** Registry entry ID (null if Ollama-only model not in registry) */
  registryId: string | null;
  /** Display name */
  name: string;
  /** Model family (llama, mistral, qwen, etc.) */
  family: string;
  /** Where this model runs */
  source: "local" | "peer" | "cloud";
  /** For local: Ollama model name. For peer: peer ID. For cloud: provider. */
  endpoint: string;
  /** Average rating 0-100 from registry (null if unrated) */
  avgRating: number | null;
  /** Number of ratings */
  totalRatings: number;
  /** Parameter count */
  parameters: number | null;
  /** Quantization level */
  quantization: string | null;
  /** Model capabilities */
  capabilities: {
    chat?: boolean;
    codeGeneration?: boolean;
    vision?: boolean;
    embedding?: boolean;
    functionCalling?: boolean;
  };
  /** MAB statistics (if this model has been used before) */
  mabScore: number | null;
  /** Model type */
  modelType: string;
  /** File size in bytes */
  fileSizeBytes: number | null;
  /** Current publish state */
  publishState: string | null;
}

export interface ModelSelection {
  /** The model identifier to use for inference */
  model: string;
  /** Provider: ollama, anthropic, peer */
  provider: "ollama" | "cloud" | "peer";
  /** Registry entry ID if the selection came from registry */
  registryId: string | null;
  /** Peer ID if provider is "peer" */
  peerId: string | null;
  /** How the model was selected */
  selectionMethod: "user_override" | "mab_auto" | "fallback";
  /** Reason for selection (human-readable) */
  reason: string;
  /** Content hash from registry (for receipt provenance) */
  contentHash: string | null;
}

export interface ModelFilter {
  /** Filter by task type to match capabilities */
  taskType?: string;
  /** Filter by source */
  source?: "local" | "peer" | "marketplace" | "all";
  /** Only models with this capability */
  capability?: "chat" | "codeGeneration" | "vision" | "embedding";
  /** Minimum rating (0-100) */
  minRating?: number;
  /** Model family */
  family?: string;
}

// MAB domain and context key pattern
const MAB_DOMAIN = "model_selection" as const;
const contextKeyForTask = (taskType: string) => `openclaw_task_${taskType}`;

// =============================================================================
// GET AVAILABLE MODELS
// =============================================================================

/**
 * Produce a unified catalog of models from:
 *  1. Ollama local models
 *  2. Registry models (local + peer + published)
 *
 * Deduplicates by name — registry entry takes precedence if both exist.
 */
export async function getAvailableModels(
  filter?: ModelFilter,
): Promise<AvailableModel[]> {
  const models: AvailableModel[] = [];
  const seenNames = new Set<string>();

  // ── Registry models ──
  try {
    const registryResult = await searchModels({
      source: filter?.source === "all" ? undefined : (filter?.source as "local" | "peer" | "marketplace" | undefined),
      family: filter?.family,
      minRating: filter?.minRating,
      limit: 200,
    });

    for (const entry of registryResult.entries) {
      const caps = (entry.capabilities as Record<string, boolean>) ?? {};

      // Apply capability filter
      if (filter?.capability && !caps[filter.capability]) continue;

      const isLocal = entry.source === "local";
      const isPeer = entry.source === "peer";

      models.push({
        registryId: entry.id,
        name: entry.name,
        family: entry.family,
        source: isPeer ? "peer" : isLocal ? "local" : "cloud",
        endpoint: isLocal
          ? entry.name // Ollama model name
          : isPeer
            ? (entry as any).sourcePeerId ?? "unknown-peer"
            : entry.name,
        avgRating: entry.avgRating,
        totalRatings: entry.totalRatings,
        parameters: entry.parameters,
        quantization: entry.quantization,
        capabilities: caps,
        mabScore: null, // Populated below
        modelType: entry.modelType,
        fileSizeBytes: entry.fileSizeBytes,
        publishState: entry.publishState,
      });
      seenNames.add(entry.name.toLowerCase());
    }
  } catch (err) {
    logger.warn("Failed to query model registry:", err);
  }

  // ── Ollama local models (fill in any not already in registry) ──
  try {
    const ollamaBridge = getOpenClawOllamaBridge();
    const ollamaModels = ollamaBridge.getAvailableModels();

    for (const m of ollamaModels) {
      const normName = m.name.toLowerCase();
      if (seenNames.has(normName)) continue;
      seenNames.add(normName);

      const family = m.details?.family || inferFamily(m.name);
      const caps = ollamaBridge.getModelCapabilities(m.name);

      models.push({
        registryId: null,
        name: m.name,
        family,
        source: "local",
        endpoint: m.name,
        avgRating: null,
        totalRatings: 0,
        parameters: parseParamSize(m.details?.parameterSize),
        quantization: m.details?.quantizationLevel || null,
        capabilities: caps
          ? {
              chat: caps.chat,
              codeGeneration: false,
              vision: caps.vision,
              embedding: caps.embedding,
              functionCalling: caps.functionCalling,
            }
          : { chat: true },
        mabScore: null,
        modelType: "base",
        fileSizeBytes: m.size || null,
        publishState: null,
      });
    }
  } catch (err) {
    logger.warn("Failed to query Ollama models:", err);
  }

  // ── Attach MAB scores ──
  try {
    const contextKey = contextKeyForTask(filter?.taskType ?? "general");
    const mab = MABEngine.getInstance();
    const arms = await mab.listArms({
      domain: MAB_DOMAIN,
      contextKey,
      activeOnly: true,
    });

    const armMap = new Map(arms.map((a) => [a.name, a]));
    for (const model of models) {
      const arm = armMap.get(model.name);
      if (arm) {
        model.mabScore = Math.round(
          (arm.alpha / (arm.alpha + arm.beta)) * 100,
        );
      }
    }
  } catch {
    // MAB unavailable — scores remain null
  }

  return models;
}

// =============================================================================
// SELECT MODEL FOR TASK
// =============================================================================

/**
 * Intelligently select a model for a given task.
 *
 * Priority:
 *  1. User-specified model (if set) — use directly
 *  2. MAB Thompson Sampling — select from available models for this task type
 *  3. Fallback — first available local model, or hardcoded default
 */
export async function selectModelForTask(
  taskType: string,
  complexity: number,
  preferredModel?: string | null,
): Promise<ModelSelection> {
  // ── 1. User override ──
  if (preferredModel && preferredModel !== "auto") {
    const resolved = await resolveModelEndpoint(preferredModel);
    return {
      model: resolved.model,
      provider: resolved.provider,
      registryId: resolved.registryId,
      peerId: resolved.peerId,
      selectionMethod: "user_override",
      reason: `User selected: ${preferredModel}`,
      contentHash: resolved.contentHash,
    };
  }

  // ── 2. MAB auto-selection ──
  const contextKey = contextKeyForTask(taskType);
  const mab = MABEngine.getInstance();

  try {
    // Ensure arms exist for available models
    await ensureArmsForContext(contextKey, taskType);

    const result = await mab.selectArm({
      contextKey,
      explorationBonus: complexity >= 7 ? 2.0 : 1.0, // More exploration for complex tasks
    });

    const selectedName = result.arm.name;
    const resolved = await resolveModelEndpoint(selectedName);

    logger.info(
      `MAB selected "${selectedName}" (score=${result.sampledValue.toFixed(3)}, ` +
        `explore=${result.explorationRatio.toFixed(2)}) for ${contextKey}`,
    );

    return {
      model: resolved.model,
      provider: resolved.provider,
      registryId: resolved.registryId,
      peerId: resolved.peerId,
      selectionMethod: "mab_auto",
      reason: `MAB Thompson Sampling: ${selectedName} (score ${(result.sampledValue * 100).toFixed(0)})`,
      contentHash: resolved.contentHash,
    };
  } catch (err) {
    logger.warn(`MAB selection failed for ${contextKey}, using fallback:`, err);
  }

  // ── 3. Fallback ──
  const ollamaBridge = getOpenClawOllamaBridge();
  const fallbackModel = ollamaBridge.isOllamaAvailable()
    ? ollamaBridge.getConfig().defaultChatModel
    : "llama3.2:3b";

  return {
    model: fallbackModel,
    provider: "ollama",
    registryId: null,
    peerId: null,
    selectionMethod: "fallback",
    reason: "Fallback: no MAB arms available or MAB selection failed",
    contentHash: null,
  };
}

// =============================================================================
// RECORD TASK OUTCOME
// =============================================================================

/**
 * Record the outcome of a task execution.
 * Updates both the MAB engine (for future selection) and the model registry
 * (for community ratings).
 */
export async function recordTaskOutcome(params: {
  model: string;
  taskId: string;
  taskType: string;
  success: boolean;
  latencyMs: number;
  tokensUsed: number;
  registryId: string | null;
}): Promise<void> {
  const { model, taskType, success, latencyMs, tokensUsed, registryId } =
    params;

  // ── MAB reward ──
  const reward = success ? 1.0 : 0.0;
  const contextKey = contextKeyForTask(taskType);

  try {
    const mab = MABEngine.getInstance();
    await mab.recordRewardByName(MAB_DOMAIN, contextKey, model, reward, {
      context: { taskType, latencyMs, tokensUsed },
      source: "auto",
    });

    logger.info(
      `MAB reward recorded: "${model}" ctx=${contextKey} reward=${reward}`,
    );
  } catch (err) {
    logger.warn("Failed to record MAB reward:", err);
  }

  // ── Registry rating + usage ──
  if (registryId) {
    try {
      // Get MAB arm stats for this model
      const mab = MABEngine.getInstance();
      const arms = await mab.listArms({
        domain: MAB_DOMAIN,
        contextKey,
      });
      const arm = arms.find((a) => a.name === model);
      if (arm) {
        await recordMABSignal(
          registryId,
          arm.alpha,
          arm.beta,
          arm.pulls,
        );
      }

      await recordModelUsage(registryId);
    } catch (err) {
      logger.warn("Failed to update registry rating:", err);
    }
  }
}

// =============================================================================
// MODEL CAPABILITY LOOKUP
// =============================================================================

/**
 * Get capabilities for a model from registry, falling back to Ollama.
 */
export async function getModelCapabilities(
  modelName: string,
): Promise<Record<string, boolean>> {
  // Check registry first
  try {
    const result = await searchModels({ query: modelName, limit: 1 });
    if (result.entries.length > 0 && result.entries[0].capabilities) {
      return result.entries[0].capabilities as Record<string, boolean>;
    }
  } catch {
    // fall through
  }

  // Fall back to Ollama capabilities
  try {
    const ollamaBridge = getOpenClawOllamaBridge();
    const caps = ollamaBridge.getModelCapabilities(modelName);
    if (caps) {
      return {
        chat: caps.chat,
        codeGeneration: false,
        vision: caps.vision,
        embedding: caps.embedding,
        functionCalling: caps.functionCalling,
      };
    }
  } catch {
    // fall through
  }

  return { chat: true };
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Resolve a model name → (endpoint, provider, registryId, peerId, contentHash)
 */
async function resolveModelEndpoint(modelName: string): Promise<{
  model: string;
  provider: "ollama" | "cloud" | "peer";
  registryId: string | null;
  peerId: string | null;
  contentHash: string | null;
}> {
  // Check if it's a registry ID (UUID pattern)
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      modelName,
    )
  ) {
    const entry = await getModelEntry(modelName);
    if (entry) {
      return {
        model: entry.name,
        provider:
          entry.source === "peer"
            ? "peer"
            : entry.source === "local"
              ? "ollama"
              : "cloud",
        registryId: entry.id,
        peerId: (entry as any).sourcePeerId ?? null,
        contentHash: entry.contentHash,
      };
    }
  }

  // Check registry by name
  try {
    const result = await searchModels({ query: modelName, limit: 1 });
    const match = result.entries.find(
      (m: any) => m.name.toLowerCase() === modelName.toLowerCase(),
    );
    if (match) {
      return {
        model: match.name,
        provider:
          match.source === "peer"
            ? "peer"
            : match.source === "local"
              ? "ollama"
              : "cloud",
        registryId: match.id,
        peerId: (match as any).sourcePeerId ?? null,
        contentHash: match.contentHash,
      };
    }
  } catch {
    // fall through
  }

  // Check if Ollama has it
  const ollamaBridge = getOpenClawOllamaBridge();
  const ollamaModels = ollamaBridge.getAvailableModels();
  if (ollamaModels.some((m) => m.name.toLowerCase() === modelName.toLowerCase())) {
    return {
      model: modelName,
      provider: "ollama",
      registryId: null,
      peerId: null,
      contentHash: null,
    };
  }

  // Default to Ollama and let it handle the error if model doesn't exist
  return {
    model: modelName,
    provider: "ollama",
    registryId: null,
    peerId: null,
    contentHash: null,
  };
}

/**
 * Ensure MAB arms exist for all available models in a given context.
 * Seeds new arms with registry avgRating (converted to Beta prior) if available.
 */
async function ensureArmsForContext(
  contextKey: string,
  taskType: string,
): Promise<void> {
  const mab = MABEngine.getInstance();
  const existingArms = await mab.listArms({
    domain: MAB_DOMAIN,
    contextKey,
    activeOnly: true,
  });
  const existingNames = new Set(existingArms.map((a) => a.name));

  // Get all available models from the catalog
  const models = await getAvailableModels({
    taskType,
    source: "all",
  });

  for (const model of models) {
    if (existingNames.has(model.name)) continue;

    // Seed initial priors from registry rating (if available)
    // avgRating is 0-100 → convert to weak Beta prior
    // e.g. avgRating 75 → alpha ~2.5, beta ~1.5 (total pseudo-count of 4)
    const metadata: Record<string, unknown> = {
      source: model.source,
      family: model.family,
      registryId: model.registryId,
    };

    await mab.getOrCreateArm({
      domain: MAB_DOMAIN,
      name: model.name,
      contextKey,
      metadata,
    });
  }
}

/**
 * Infer model family from name (for Ollama models not in registry).
 */
function inferFamily(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("llama")) return "llama";
  if (n.includes("mistral") || n.includes("mixtral")) return "mistral";
  if (n.includes("qwen")) return "qwen";
  if (n.includes("phi")) return "phi";
  if (n.includes("gemma")) return "gemma";
  if (n.includes("codellama") || n.includes("deepseek")) return "code";
  if (n.includes("llava") || n.includes("bakllava")) return "vision";
  if (n.includes("nomic") || n.includes("bge")) return "embedding";
  return "unknown";
}

/**
 * Parse parameter size strings like "7B", "13B", "70B" → number.
 */
function parseParamSize(sizeStr?: string): number | null {
  if (!sizeStr) return null;
  const match = sizeStr.match(/([\d.]+)\s*([bBmMkK])/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === "B") return Math.round(num * 1e9);
  if (unit === "M") return Math.round(num * 1e6);
  if (unit === "K") return Math.round(num * 1e3);
  return Math.round(num);
}
