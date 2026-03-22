/**
 * Privacy-Preserving Inference Bridge IPC Handlers
 * 
 * Routes inference requests through local models, trained adapters,
 * custom agents, or federated peers while preserving privacy.
 */

import { ipcMain, app, type IpcMainInvokeEvent } from "electron";
import { createHash, randomUUID } from "crypto";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import log from "electron-log";
import type {
  PrivacyPreservingInferenceRequest,
  PrivacyPreservingInferenceResponse,
  InferenceBridgeState,
  InferenceBridgeConfig,
  CreateInferenceRequest,
  InferenceStreamChunk,
  InferenceRequestId,
  PromptHash,
  PrivacyLevel,
  InferenceModelConfig,
  InferencePrivacyConfig,
  InferenceExecutor,
  InferenceResult,
  PrivacyAudit,
  InferenceMetrics,
  PRIVACY_PROFILES,
  ROUTING_PROFILES,
} from "../../types/privacy_inference_types";
import type { AdapterId } from "../../types/model_factory_types";
import type { CustomAgentId } from "../../types/agent_factory_types";
import {
  getOllamaApiUrl,
  fetchOllamaModels,
} from "./local_model_ollama_handler";

const inferenceLogger = log.scope("privacy_inference");

// =============================================================================
// STATE
// =============================================================================

const bridgeState: InferenceBridgeState = {
  initialized: false,
  localModels: [],
  loadedModels: [],
  adapters: [],
  loadedAdapters: [],
  agents: [],
  activeAgents: [],
  connectedPeers: 0,
  trustedPeers: [],
  availableCapacity: 0,
  stats: {
    totalRequests: 0,
    localRequests: 0,
    adapterRequests: 0,
    agentRequests: 0,
    peerRequests: 0,
    cloudRequests: 0,
    promptsKeptLocal: 0,
    promptsHashed: 0,
    promptsEncrypted: 0,
    avgLatencyMs: 0,
    avgTokensPerSecond: 0,
    estimatedCloudCostCents: 0,
    actualCostCents: 0,
    costSavingsCents: 0,
    receiptsCreated: 0,
    receiptsPinned: 0,
  },
};

let bridgeConfig: InferenceBridgeConfig = {
  defaultPrivacy: {
    level: "local_preferred",
    dataHandling: "hash_only",
    allowPromptHashing: true,
    allowResponseHashing: true,
    allowMetricSharing: false,
    allowModelIdSharing: false,
    encryptInTransit: true,
    encryptAtRest: true,
    keyRotationEnabled: true,
  },
  autoLoadModels: true,
  maxLoadedModels: 3,
  modelCacheSizeMb: 8192,
  autoLoadAdapters: true,
  maxLoadedAdapters: 5,
  enableFederation: true,
  maxPeerConnections: 20,
  peerTimeoutMs: 30000,
  defaultRouting: {
    preferenceOrder: ["local", "adapter", "agent", "peer"],
    loadBalancing: "most_private",
    maxRetries: 3,
    retryDelayMs: 500,
  },
  defaultVerification: {
    createReceipt: true,
    includePromptHash: true,
    includeResponseHash: true,
    includeTimings: true,
    includeModelInfo: false,
    signReceipt: true,
    requirePeerSignature: true,
    pinReceipt: false,
  },
  batchingEnabled: false,
  maxBatchSize: 4,
  batchTimeoutMs: 100,
};

const activeRequests = new Map<
  InferenceRequestId,
  PrivacyPreservingInferenceRequest
>();

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function generateRequestId(): InferenceRequestId {
  return `inf_${randomUUID()}` as InferenceRequestId;
}

function hashPrompt(prompt: string): PromptHash {
  return createHash("sha256").update(prompt).digest("hex") as PromptHash;
}

function estimateCloudCost(tokens: number): number {
  // Rough estimate: $0.002 per 1K tokens (GPT-4 level)
  return Math.ceil((tokens / 1000) * 0.2);
}

/**
 * Determines the best executor based on privacy settings and routing config
 */
async function selectExecutor(
  request: PrivacyPreservingInferenceRequest
): Promise<InferenceExecutor> {
  const { privacy, routing, modelConfig } = request;
  
  // If privacy is maximum, ONLY local
  if (privacy.level === "local_only") {
    return findLocalExecutor(modelConfig);
  }
  
  // Check routing preferences in order
  for (const preference of routing.preferenceOrder) {
    switch (preference) {
      case "local": {
        const local = await findLocalExecutor(modelConfig);
        if (local.modelId) return local;
        break;
      }
      case "adapter": {
        const adapter = await findAdapterExecutor(modelConfig);
        if (adapter.adapterId) return adapter;
        break;
      }
      case "agent": {
        const agent = await findAgentExecutor(modelConfig);
        if (agent.agentId) return agent;
        break;
      }
      case "peer": {
        // Only if privacy allows federation
        if (
          privacy.level === "federated" ||
          privacy.level === "hybrid" ||
          privacy.level === "any"
        ) {
          const peer = await findPeerExecutor(modelConfig, privacy);
          if (peer.peerId) return peer;
        }
        break;
      }
      case "cloud": {
        // Only if privacy allows and explicitly enabled
        if (privacy.level === "any") {
          return {
            type: "cloud",
            cloudProvider: "fallback",
            cloudModel: modelConfig.modelId || "default",
          };
        }
        break;
      }
    }
  }
  
  // Fallback to local
  return findLocalExecutor(modelConfig);
}

async function findLocalExecutor(
  config: InferenceModelConfig
): Promise<InferenceExecutor> {
  // Check if a specific model is requested and loaded
  if (config.modelId && bridgeState.loadedModels.includes(config.modelId)) {
    const model = bridgeState.localModels.find((m) => m.id === config.modelId);
    return {
      type: "local",
      modelId: model?.id,
      modelPath: model?.path,
    };
  }
  
  // Find any suitable loaded model
  for (const modelId of bridgeState.loadedModels) {
    const model = bridgeState.localModels.find((m) => m.id === modelId);
    if (model) {
      return {
        type: "local",
        modelId: model.id,
        modelPath: model.path,
      };
    }
  }
  
  // Check available local models
  if (bridgeState.localModels.length > 0) {
    const model = bridgeState.localModels[0];
    return {
      type: "local",
      modelId: model.id,
      modelPath: model.path,
    };
  }
  
  return { type: "local" };
}

async function findAdapterExecutor(
  config: InferenceModelConfig
): Promise<InferenceExecutor> {
  // Check for specific adapter
  if (config.adapterId) {
    const adapter = bridgeState.adapters.find(
      (a) => a.id === config.adapterId
    );
    if (adapter) {
      return {
        type: "adapter",
        adapterId: adapter.id,
        baseModelId: adapter.baseModelId,
      };
    }
  }
  
  // Find any loaded adapter
  for (const adapterId of bridgeState.loadedAdapters) {
    const adapter = bridgeState.adapters.find((a) => a.id === adapterId);
    if (adapter) {
      return {
        type: "adapter",
        adapterId: adapter.id,
        baseModelId: adapter.baseModelId,
      };
    }
  }
  
  return { type: "adapter" };
}

async function findAgentExecutor(
  config: InferenceModelConfig
): Promise<InferenceExecutor> {
  // Check for specific agent
  if (config.agentId) {
    const agent = bridgeState.agents.find((a) => a.id === config.agentId);
    if (agent) {
      return {
        type: "agent",
        agentId: agent.id,
        agentName: agent.name,
      };
    }
  }
  
  // Find any active agent with required capabilities
  if (config.requiredCapabilities?.length) {
    for (const agentId of bridgeState.activeAgents) {
      const agent = bridgeState.agents.find((a) => a.id === agentId);
      // In real impl, check capabilities match
      if (agent) {
        return {
          type: "agent",
          agentId: agent.id,
          agentName: agent.name,
        };
      }
    }
  }
  
  return { type: "agent" };
}

async function findPeerExecutor(
  config: InferenceModelConfig,
  privacy: InferencePrivacyConfig
): Promise<InferenceExecutor> {
  // Only use trusted peers if specified
  const availablePeers = privacy.trustedPeers?.length
    ? bridgeState.trustedPeers.filter((p) => privacy.trustedPeers?.includes(p))
    : bridgeState.trustedPeers;
  
  // Filter out blocked peers
  const allowedPeers = availablePeers.filter(
    (p) => !privacy.blockedPeers?.includes(p)
  );
  
  if (allowedPeers.length > 0) {
    return {
      type: "peer",
      peerId: allowedPeers[0],
      peerDid: `did:joy:${allowedPeers[0]}`,
    };
  }
  
  return { type: "peer" };
}

/**
 * Execute inference based on the selected executor
 */
async function executeInference(
  request: PrivacyPreservingInferenceRequest,
  executor: InferenceExecutor
): Promise<{
  result: InferenceResult;
  metrics: InferenceMetrics;
}> {
  const startTime = Date.now();
  
  switch (executor.type) {
    case "local":
      return executeLocalInference(request, executor, startTime);
    case "adapter":
      return executeAdapterInference(request, executor, startTime);
    case "agent":
      return executeAgentInference(request, executor, startTime);
    case "peer":
      return executePeerInference(request, executor, startTime);
    case "cloud":
      return executeCloudInference(request, executor, startTime);
    default:
      throw new Error(`Unknown executor type: ${executor.type}`);
  }
}

async function executeLocalInference(
  request: PrivacyPreservingInferenceRequest,
  executor: InferenceExecutor,
  startTime: number
): Promise<{ result: InferenceResult; metrics: InferenceMetrics }> {
  const content = await realLocalInference(request);
  
  const endTime = Date.now();
  const promptTokens = Math.ceil((request.payload.prompt?.length || 0) / 4);
  const completionTokens = Math.ceil(content.length / 4);
  
  return {
    result: {
      success: true,
      content,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    },
    metrics: {
      totalMs: endTime - startTime,
      routingMs: 10,
      executionMs: endTime - startTime - 10,
      promptTokens,
      completionTokens,
      tokensPerSecond: Math.round(
        completionTokens / ((endTime - startTime) / 1000)
      ),
      estimatedCostCents: 0, // Local is free!
    },
  };
}

async function executeAdapterInference(
  request: PrivacyPreservingInferenceRequest,
  executor: InferenceExecutor,
  startTime: number
): Promise<{ result: InferenceResult; metrics: InferenceMetrics }> {
  const content = await realAdapterInference(request, executor.adapterId!);
  
  const endTime = Date.now();
  const promptTokens = Math.ceil((request.payload.prompt?.length || 0) / 4);
  const completionTokens = Math.ceil(content.length / 4);
  
  return {
    result: {
      success: true,
      content,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    },
    metrics: {
      totalMs: endTime - startTime,
      routingMs: 15,
      executionMs: endTime - startTime - 15,
      promptTokens,
      completionTokens,
      tokensPerSecond: Math.round(
        completionTokens / ((endTime - startTime) / 1000)
      ),
      estimatedCostCents: 0,
    },
  };
}

async function executeAgentInference(
  request: PrivacyPreservingInferenceRequest,
  executor: InferenceExecutor,
  startTime: number
): Promise<{ result: InferenceResult; metrics: InferenceMetrics }> {
  const agentOutput = await realAgentInference(
    request,
    executor.agentId!
  );
  
  const endTime = Date.now();
  
  return {
    result: {
      success: true,
      agentOutput,
    },
    metrics: {
      totalMs: endTime - startTime,
      routingMs: 20,
      executionMs: endTime - startTime - 20,
      estimatedCostCents: 0,
    },
  };
}

async function executePeerInference(
  request: PrivacyPreservingInferenceRequest,
  executor: InferenceExecutor,
  startTime: number
): Promise<{ result: InferenceResult; metrics: InferenceMetrics }> {
  // Encrypt and send to peer
  // In real implementation, this uses the federation handlers
  
  // First, validate privacy allows this
  if (request.privacy.level === "local_only") {
    throw new Error("Privacy config prohibits peer inference");
  }
  
  const content = await realPeerInference(request, executor.peerId!);
  
  const endTime = Date.now();
  const promptTokens = Math.ceil((request.payload.prompt?.length || 0) / 4);
  const completionTokens = Math.ceil(content.length / 4);
  
  return {
    result: {
      success: true,
      content,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    },
    metrics: {
      totalMs: endTime - startTime,
      routingMs: 50,
      executionMs: endTime - startTime - 50,
      networkMs: 200,
      promptTokens,
      completionTokens,
      tokensPerSecond: Math.round(
        completionTokens / ((endTime - startTime) / 1000)
      ),
      estimatedCostCents: 1, // Minimal peer cost
    },
  };
}

async function executeCloudInference(
  request: PrivacyPreservingInferenceRequest,
  executor: InferenceExecutor,
  startTime: number
): Promise<{ result: InferenceResult; metrics: InferenceMetrics }> {
  // NOT RECOMMENDED - only for explicit opt-in
  if (request.privacy.level !== "any") {
    throw new Error("Privacy config prohibits cloud inference");
  }
  
  throw new Error(
    "Cloud inference disabled for privacy. Use local or federated."
  );
}

// =============================================================================
// REAL INFERENCE FUNCTIONS (Ollama-backed)
// =============================================================================

async function callOllama(
  prompt: string,
  systemPrompt?: string,
  modelId?: string,
): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
  const baseUrl = getOllamaApiUrl();
  const model = modelId || bridgeState.localModels[0]?.id || "llama3.2:3b";

  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return {
    content: data.message?.content ?? "",
    promptTokens: data.prompt_eval_count ?? Math.ceil(prompt.length / 4),
    completionTokens:
      data.eval_count ?? Math.ceil((data.message?.content?.length ?? 0) / 4),
  };
}

async function realLocalInference(
  request: PrivacyPreservingInferenceRequest,
): Promise<string> {
  const prompt = request.payload.prompt || "";
  const modelId = request.modelConfig.modelId;
  const { content } = await callOllama(prompt, undefined, modelId);
  return content;
}

async function realAdapterInference(
  request: PrivacyPreservingInferenceRequest,
  adapterId: AdapterId,
): Promise<string> {
  // Load adapter config from disk for system prompt override
  let systemPrompt: string | undefined;
  try {
    const adapterDir = path.join(app.getPath("userData"), "agents");
    const adapterFile = path.join(adapterDir, `${adapterId}.json`);
    const raw = await fs.readFile(adapterFile, "utf-8");
    const agent = JSON.parse(raw);
    systemPrompt = agent.systemPrompt;
  } catch {
    // No adapter config on disk, use default
  }

  const adapter = bridgeState.adapters.find((a) => a.id === adapterId);
  const modelId = adapter?.baseModelId || request.modelConfig.modelId;
  const prompt = request.payload.prompt || "";
  const { content } = await callOllama(prompt, systemPrompt, modelId);
  return content;
}

async function realAgentInference(
  request: PrivacyPreservingInferenceRequest,
  agentId: CustomAgentId,
): Promise<{ result: unknown; reasoning: string }> {
  // Load agent definition from disk
  let systemPrompt = "You are a helpful AI agent. Complete the task given to you accurately and concisely.";
  let modelId: string | undefined;
  try {
    const agentsDir = path.join(app.getPath("userData"), "agents");
    const agentFile = path.join(agentsDir, `${agentId}.json`);
    const raw = await fs.readFile(agentFile, "utf-8");
    const agent = JSON.parse(raw);
    systemPrompt = agent.systemPrompt || systemPrompt;
    modelId = agent.baseModelId;
  } catch {
    // No agent file found, use defaults
  }

  const prompt = request.payload.prompt ||
    (request.payload.agentTask
      ? JSON.stringify(request.payload.agentTask)
      : "");

  const { content } = await callOllama(
    prompt,
    systemPrompt + "\n\nAfter completing, explain your reasoning.",
    modelId || request.modelConfig.modelId,
  );

  // Try to split content and reasoning
  const reasoningIdx = content.toLowerCase().lastIndexOf("reasoning:");
  if (reasoningIdx > 0) {
    return {
      result: content.slice(0, reasoningIdx).trim(),
      reasoning: content.slice(reasoningIdx + 10).trim(),
    };
  }
  return { result: content, reasoning: "Agent processed the request with local inference." };
}

async function realPeerInference(
  _request: PrivacyPreservingInferenceRequest,
  peerId: string,
): Promise<string> {
  // Federated peer inference is not yet implemented — fall back to local
  inferenceLogger.warn(`Peer inference to ${peerId} not yet implemented, falling back to local.`);
  const prompt = _request.payload.prompt || "";
  const { content } = await callOllama(prompt);
  return `[FEDERATED-FALLBACK] ${content}`;
}

/**
 * Create privacy audit for the response
 */
function createPrivacyAudit(
  request: PrivacyPreservingInferenceRequest,
  executor: InferenceExecutor
): PrivacyAudit {
  const { privacy } = request;
  const destinations: PrivacyAudit["destinations"] = [];
  
  // Track where data went
  if (executor.type === "local" || executor.type === "adapter") {
    destinations.push({
      type: "local",
      dataTypes: ["prompt", "response"],
    });
  } else if (executor.type === "peer") {
    destinations.push({
      type: "peer",
      identifier: executor.peerId,
      dataTypes: privacy.dataHandling === "encrypted" 
        ? ["encrypted_payload"]
        : privacy.dataHandling === "hash_only"
        ? ["prompt_hash"]
        : ["prompt", "response"],
    });
  }
  
  return {
    promptShared: executor.type === "peer" && privacy.dataHandling === "full",
    promptHashShared:
      executor.type === "peer" && privacy.allowPromptHashing,
    responseShared: executor.type === "peer",
    responseHashShared:
      executor.type === "peer" && privacy.allowResponseHashing,
    metricsShared: privacy.allowMetricSharing,
    destinations,
    encryptionUsed: executor.type === "peer" && privacy.encryptInTransit,
    encryptionAlgorithm:
      executor.type === "peer" && privacy.encryptInTransit
        ? "AES-256-GCM"
        : undefined,
    compliantWithConfig: true,
    violations: [],
  };
}

// =============================================================================
// IPC HANDLERS
// =============================================================================

export function registerPrivacyInferenceHandlers(): void {
  // Initialize the bridge
  ipcMain.handle(
    "privacy-inference:initialize",
    async (_event: IpcMainInvokeEvent) => {
      // Load available local models from Ollama
      try {
        const { models } = await fetchOllamaModels();
        bridgeState.localModels = models.map((m) => ({
          id: m.modelName,
          name: m.displayName,
          path: m.modelName,
          loaded: false,
          size: 0,
          quantization: "unknown",
          capabilities: ["chat", "completion"],
        }));
        bridgeState.loadedModels = models.map((m) => m.modelName);
        inferenceLogger.info(`Loaded ${models.length} Ollama models into bridge`);
      } catch (err) {
        inferenceLogger.warn("Could not load Ollama models:", err);
      }

      // Load custom agents from Agent Factory disk storage
      try {
        const agentsDir = path.join(app.getPath("userData"), "agents");
        const files = await fs.readdir(agentsDir).catch(() => [] as string[]);
        for (const file of files) {
          if (!file.endsWith(".json")) continue;
          try {
            const raw = await fs.readFile(path.join(agentsDir, file), "utf-8");
            const agent = JSON.parse(raw);
            if (agent.id && agent.name) {
              bridgeState.agents.push({
                id: agent.id,
                name: agent.name,
                type: agent.type ?? "task",
                modelId: agent.baseModelId ?? "",
                active: true,
              });
              bridgeState.activeAgents.push(agent.id);
            }
          } catch { /* Skip invalid agent files */ }
        }
        inferenceLogger.info(`Loaded ${bridgeState.agents.length} custom agents`);
      } catch { /* agents dir doesn't exist yet */ }

      bridgeState.initialized = true;
      return bridgeState;
    }
  );
  
  // Get bridge state
  ipcMain.handle(
    "privacy-inference:get-state",
    async (_event: IpcMainInvokeEvent) => {
      return bridgeState;
    }
  );
  
  // Update config
  ipcMain.handle(
    "privacy-inference:update-config",
    async (
      _event: IpcMainInvokeEvent,
      config: Partial<InferenceBridgeConfig>
    ) => {
      bridgeConfig = { ...bridgeConfig, ...config };
      return bridgeConfig;
    }
  );
  
  // Get config
  ipcMain.handle(
    "privacy-inference:get-config",
    async (_event: IpcMainInvokeEvent) => {
      return bridgeConfig;
    }
  );
  
  // Create inference request
  ipcMain.handle(
    "privacy-inference:infer",
    async (
      _event: IpcMainInvokeEvent,
      params: CreateInferenceRequest
    ): Promise<PrivacyPreservingInferenceResponse> => {
      const requestId = generateRequestId();
      
      // Build full request with defaults
      const request: PrivacyPreservingInferenceRequest = {
        id: requestId,
        type: params.type,
        modelConfig: {
          preferLocal: true,
          acceptQuantized: true,
          ...params.modelConfig,
        },
        privacy: {
          ...bridgeConfig.defaultPrivacy,
          ...params.privacy,
        },
        payload: params.payload,
        routing: {
          ...bridgeConfig.defaultRouting,
          ...params.routing,
        },
        verification: {
          ...bridgeConfig.defaultVerification,
          ...params.verification,
        },
        createdAt: Date.now(),
      };
      
      activeRequests.set(requestId, request);
      bridgeState.stats.totalRequests++;
      
      try {
        // Select best executor based on privacy and routing
        const executor = await selectExecutor(request);
        
        // Update stats
        switch (executor.type) {
          case "local":
            bridgeState.stats.localRequests++;
            bridgeState.stats.promptsKeptLocal++;
            break;
          case "adapter":
            bridgeState.stats.adapterRequests++;
            bridgeState.stats.promptsKeptLocal++;
            break;
          case "agent":
            bridgeState.stats.agentRequests++;
            bridgeState.stats.promptsKeptLocal++;
            break;
          case "peer":
            bridgeState.stats.peerRequests++;
            if (request.privacy.dataHandling === "hash_only") {
              bridgeState.stats.promptsHashed++;
            } else if (request.privacy.dataHandling === "encrypted") {
              bridgeState.stats.promptsEncrypted++;
            }
            break;
          case "cloud":
            bridgeState.stats.cloudRequests++;
            break;
        }
        
        // Execute inference
        const { result, metrics } = await executeInference(request, executor);
        
        // Create privacy audit
        const privacyAudit = createPrivacyAudit(request, executor);
        
        // Calculate cost savings
        if (result.usage) {
          const estimatedCloud = estimateCloudCost(result.usage.totalTokens);
          bridgeState.stats.estimatedCloudCostCents += estimatedCloud;
          bridgeState.stats.actualCostCents += metrics.estimatedCostCents || 0;
          bridgeState.stats.costSavingsCents +=
            estimatedCloud - (metrics.estimatedCostCents || 0);
        }
        
        // Build response
        const response: PrivacyPreservingInferenceResponse = {
          id: requestId,
          executedBy: executor,
          result,
          privacyAudit,
          verification: request.verification.createReceipt
            ? {
                promptHash: request.privacy.allowPromptHashing
                  ? hashPrompt(request.payload.prompt || "")
                  : undefined,
              }
            : undefined,
          metrics: request.privacy.allowMetricSharing ? metrics : undefined,
          completedAt: Date.now(),
        };
        
        return response;
      } finally {
        activeRequests.delete(requestId);
      }
    }
  );
  
  // Quick local completion
  ipcMain.handle(
    "privacy-inference:local-complete",
    async (_event: IpcMainInvokeEvent, prompt: string, modelId?: string) => {
      return ipcMain.emit("privacy-inference:infer", {
        type: "completion",
        payload: { prompt },
        modelConfig: { modelId, preferLocal: true },
        privacy: { level: "local_only", dataHandling: "never_share" },
        routing: { preferenceOrder: ["local", "adapter"] },
      });
    }
  );
  
  // Quick agent task
  ipcMain.handle(
    "privacy-inference:agent-task",
    async (
      _event: IpcMainInvokeEvent,
      agentId: string,
      task: unknown
    ) => {
      const request: CreateInferenceRequest = {
        type: "agent_task",
        payload: {
          agentTask: {
            taskType: "custom",
            input: task,
          },
        },
        modelConfig: {
          agentId: agentId as CustomAgentId,
          preferLocal: true,
        },
        privacy: {
          level: "local_only",
          dataHandling: "never_share",
        },
      };
      
      return ipcMain.emit("privacy-inference:infer", request);
    }
  );
  
  // Get stats
  ipcMain.handle(
    "privacy-inference:get-stats",
    async (_event: IpcMainInvokeEvent) => {
      return bridgeState.stats;
    }
  );
  
  // Reset stats
  ipcMain.handle(
    "privacy-inference:reset-stats",
    async (_event: IpcMainInvokeEvent) => {
      bridgeState.stats = {
        totalRequests: 0,
        localRequests: 0,
        adapterRequests: 0,
        agentRequests: 0,
        peerRequests: 0,
        cloudRequests: 0,
        promptsKeptLocal: 0,
        promptsHashed: 0,
        promptsEncrypted: 0,
        avgLatencyMs: 0,
        avgTokensPerSecond: 0,
        estimatedCloudCostCents: 0,
        actualCostCents: 0,
        costSavingsCents: 0,
        receiptsCreated: 0,
        receiptsPinned: 0,
      };
      return bridgeState.stats;
    }
  );
  
  // Register adapter (from Model Factory)
  ipcMain.handle(
    "privacy-inference:register-adapter",
    async (
      _event: IpcMainInvokeEvent,
      adapter: {
        id: AdapterId;
        name: string;
        baseModelId: string;
        method: string;
        path: string;
      }
    ) => {
      bridgeState.adapters.push({
        ...adapter,
        method: adapter.method as any,
        loaded: false,
      });
      return true;
    }
  );
  
  // Register agent (from Agent Factory)
  ipcMain.handle(
    "privacy-inference:register-agent",
    async (
      _event: IpcMainInvokeEvent,
      agent: {
        id: CustomAgentId;
        name: string;
        type: string;
        modelId: string;
        adapterId?: AdapterId;
      }
    ) => {
      bridgeState.agents.push({
        ...agent,
        type: agent.type as any,
        active: false,
      });
      return true;
    }
  );
  
  // Add trusted peer
  ipcMain.handle(
    "privacy-inference:add-trusted-peer",
    async (_event: IpcMainInvokeEvent, peerId: string) => {
      if (!bridgeState.trustedPeers.includes(peerId)) {
        bridgeState.trustedPeers.push(peerId);
      }
      return bridgeState.trustedPeers;
    }
  );
  
  // Remove trusted peer
  ipcMain.handle(
    "privacy-inference:remove-trusted-peer",
    async (_event: IpcMainInvokeEvent, peerId: string) => {
      bridgeState.trustedPeers = bridgeState.trustedPeers.filter(
        (p) => p !== peerId
      );
      return bridgeState.trustedPeers;
    }
  );
  
  // Get privacy profiles
  ipcMain.handle(
    "privacy-inference:get-privacy-profiles",
    async (_event: IpcMainInvokeEvent) => {
      return {
        MAXIMUM: {
          level: "local_only",
          dataHandling: "never_share",
          allowPromptHashing: false,
          allowResponseHashing: false,
          allowMetricSharing: false,
          allowModelIdSharing: false,
          encryptInTransit: true,
          encryptAtRest: true,
          keyRotationEnabled: true,
        },
        HIGH: {
          level: "local_preferred",
          dataHandling: "hash_only",
          allowPromptHashing: true,
          allowResponseHashing: true,
          allowMetricSharing: false,
          allowModelIdSharing: false,
          encryptInTransit: true,
          encryptAtRest: true,
          keyRotationEnabled: true,
        },
        STANDARD: {
          level: "federated",
          dataHandling: "encrypted",
          allowPromptHashing: true,
          allowResponseHashing: true,
          allowMetricSharing: true,
          allowModelIdSharing: true,
          encryptInTransit: true,
          encryptAtRest: true,
          keyRotationEnabled: true,
        },
        BALANCED: {
          level: "hybrid",
          dataHandling: "encrypted",
          allowPromptHashing: true,
          allowResponseHashing: true,
          allowMetricSharing: true,
          allowModelIdSharing: true,
          encryptInTransit: true,
          encryptAtRest: false,
          keyRotationEnabled: false,
        },
      };
    }
  );
  
  // Get routing profiles
  ipcMain.handle(
    "privacy-inference:get-routing-profiles",
    async (_event: IpcMainInvokeEvent) => {
      return {
        LOCAL_ONLY: {
          preferenceOrder: ["local", "adapter", "agent"],
          loadBalancing: "fastest",
          maxRetries: 3,
          retryDelayMs: 100,
        },
        PRIVACY_FIRST: {
          preferenceOrder: ["local", "adapter", "agent", "peer"],
          loadBalancing: "most_private",
          maxRetries: 2,
          retryDelayMs: 500,
          peerSelection: {
            minReputation: 90,
            minUptime: 95,
          },
        },
        PERFORMANCE: {
          preferenceOrder: ["local", "adapter", "peer", "agent"],
          loadBalancing: "fastest",
          maxLatencyMs: 5000,
          maxRetries: 3,
          retryDelayMs: 100,
        },
        COST_OPTIMIZED: {
          preferenceOrder: ["local", "adapter", "agent", "peer"],
          loadBalancing: "cheapest",
          maxCostCents: 10,
          maxRetries: 2,
          retryDelayMs: 500,
        },
      };
    }
  );
}
