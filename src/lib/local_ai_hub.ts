/**
 * JoyCreate Local AI Power Hub
 * 
 * A unified service for managing multiple local AI providers:
 * - Ollama
 * - LM Studio  
 * - llama.cpp
 * - vLLM
 * - LocalAI
 * - GPT4All
 * - Text Generation WebUI (oobabooga)
 * - koboldcpp
 * 
 * This makes JoyCreate more powerful than any paid alternative by giving
 * users complete control over their AI infrastructure.
 */

import log from "electron-log";
import { EventEmitter } from "events";
import type {
  LocalModelProvider,
  LocalModelInfo,
  InferenceRequest,
  InferenceResponse,
} from "@/types/trustless_inference";

const logger = log.scope("local_ai_hub");

// =============================================================================
// EXTENDED PROVIDER TYPES
// =============================================================================

export type ExtendedLocalProvider = 
  | "ollama"
  | "lmstudio"
  | "llamacpp"
  | "vllm"
  | "localai"
  | "gpt4all"
  | "oobabooga"
  | "koboldcpp"
  | "jan"
  | "mlx"
  | "exllama";

export interface LocalProviderConfig {
  id: ExtendedLocalProvider;
  name: string;
  description: string;
  defaultPort: number;
  defaultBaseUrl: string;
  apiType: "openai" | "ollama" | "kobold" | "custom";
  supportsStreaming: boolean;
  supportsEmbeddings: boolean;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  installGuide: string;
  downloadUrl?: string;
  features: string[];
}

export interface ProviderStatus {
  id: ExtendedLocalProvider;
  available: boolean;
  baseUrl: string;
  models: LocalModelInfo[];
  lastChecked: Date;
  error?: string;
  version?: string;
  gpuInfo?: {
    available: boolean;
    name?: string;
    vram?: number;
    cudaVersion?: string;
  };
}

export interface ModelDownloadProgress {
  modelId: string;
  provider: ExtendedLocalProvider;
  progress: number;
  speed?: number;
  eta?: number;
  status: "pending" | "downloading" | "complete" | "error";
  error?: string;
}

export interface AIHubConfig {
  providers: Record<ExtendedLocalProvider, {
    enabled: boolean;
    baseUrl: string;
    autoStart?: boolean;
    gpuLayers?: number;
    contextSize?: number;
    customArgs?: string[];
  }>;
  defaultProvider: ExtendedLocalProvider;
  fallbackChain: ExtendedLocalProvider[];
  autoDetect: boolean;
  healthCheckInterval: number;
  loadBalancing: "round-robin" | "least-loaded" | "fastest" | "none";
}

// =============================================================================
// PROVIDER CONFIGURATIONS
// =============================================================================

export const PROVIDER_CONFIGS: Record<ExtendedLocalProvider, LocalProviderConfig> = {
  ollama: {
    id: "ollama",
    name: "Ollama",
    description: "Easy-to-use local LLM runner with one-click model downloads",
    defaultPort: 11434,
    defaultBaseUrl: "http://localhost:11434",
    apiType: "ollama",
    supportsStreaming: true,
    supportsEmbeddings: true,
    supportsVision: true,
    supportsFunctionCalling: true,
    installGuide: "https://ollama.ai/download",
    downloadUrl: "https://ollama.ai/download",
    features: ["Easy setup", "Model library", "GPU acceleration", "Multi-model"],
  },
  lmstudio: {
    id: "lmstudio",
    name: "LM Studio",
    description: "User-friendly desktop app for running local LLMs",
    defaultPort: 1234,
    defaultBaseUrl: "http://localhost:1234",
    apiType: "openai",
    supportsStreaming: true,
    supportsEmbeddings: true,
    supportsVision: true,
    supportsFunctionCalling: true,
    installGuide: "https://lmstudio.ai/",
    downloadUrl: "https://lmstudio.ai/",
    features: ["GUI interface", "GGUF support", "Model browser", "Chat history"],
  },
  llamacpp: {
    id: "llamacpp",
    name: "llama.cpp",
    description: "High-performance C++ inference engine",
    defaultPort: 8080,
    defaultBaseUrl: "http://localhost:8080",
    apiType: "openai",
    supportsStreaming: true,
    supportsEmbeddings: true,
    supportsVision: true,
    supportsFunctionCalling: false,
    installGuide: "https://github.com/ggerganov/llama.cpp",
    features: ["Maximum performance", "Quantization", "CPU/GPU hybrid", "Minimal resources"],
  },
  vllm: {
    id: "vllm",
    name: "vLLM",
    description: "High-throughput inference with PagedAttention",
    defaultPort: 8000,
    defaultBaseUrl: "http://localhost:8000",
    apiType: "openai",
    supportsStreaming: true,
    supportsEmbeddings: false,
    supportsVision: true,
    supportsFunctionCalling: true,
    installGuide: "https://docs.vllm.ai/",
    features: ["High throughput", "Batching", "Tensor parallelism", "Production ready"],
  },
  localai: {
    id: "localai",
    name: "LocalAI",
    description: "OpenAI API drop-in replacement for local inference",
    defaultPort: 8080,
    defaultBaseUrl: "http://localhost:8080",
    apiType: "openai",
    supportsStreaming: true,
    supportsEmbeddings: true,
    supportsVision: true,
    supportsFunctionCalling: true,
    installGuide: "https://localai.io/",
    features: ["OpenAI compatible", "Multiple backends", "Audio support", "Image generation"],
  },
  gpt4all: {
    id: "gpt4all",
    name: "GPT4All",
    description: "Privacy-focused local AI assistant",
    defaultPort: 4891,
    defaultBaseUrl: "http://localhost:4891",
    apiType: "openai",
    supportsStreaming: true,
    supportsEmbeddings: true,
    supportsVision: false,
    supportsFunctionCalling: false,
    installGuide: "https://gpt4all.io/",
    downloadUrl: "https://gpt4all.io/",
    features: ["Privacy focused", "Cross-platform", "Document QA", "Offline"],
  },
  oobabooga: {
    id: "oobabooga",
    name: "Text Generation WebUI",
    description: "Feature-rich web interface for LLM inference",
    defaultPort: 5000,
    defaultBaseUrl: "http://localhost:5000",
    apiType: "openai",
    supportsStreaming: true,
    supportsEmbeddings: true,
    supportsVision: true,
    supportsFunctionCalling: false,
    installGuide: "https://github.com/oobabooga/text-generation-webui",
    features: ["Extensions", "LoRA support", "Training", "Character cards"],
  },
  koboldcpp: {
    id: "koboldcpp",
    name: "KoboldCpp",
    description: "Easy-to-use llama.cpp wrapper with GUI",
    defaultPort: 5001,
    defaultBaseUrl: "http://localhost:5001",
    apiType: "kobold",
    supportsStreaming: true,
    supportsEmbeddings: false,
    supportsVision: false,
    supportsFunctionCalling: false,
    installGuide: "https://github.com/LostRuins/koboldcpp",
    features: ["One-click launch", "GPU acceleration", "Memory efficient", "Portable"],
  },
  jan: {
    id: "jan",
    name: "Jan",
    description: "Open-source ChatGPT alternative that runs offline",
    defaultPort: 1337,
    defaultBaseUrl: "http://localhost:1337",
    apiType: "openai",
    supportsStreaming: true,
    supportsEmbeddings: true,
    supportsVision: true,
    supportsFunctionCalling: true,
    installGuide: "https://jan.ai/",
    downloadUrl: "https://jan.ai/",
    features: ["Beautiful UI", "Model hub", "Extensions", "Offline first"],
  },
  mlx: {
    id: "mlx",
    name: "MLX (Apple Silicon)",
    description: "Apple's ML framework optimized for M-series chips",
    defaultPort: 8008,
    defaultBaseUrl: "http://localhost:8008",
    apiType: "openai",
    supportsStreaming: true,
    supportsEmbeddings: true,
    supportsVision: true,
    supportsFunctionCalling: false,
    installGuide: "https://github.com/ml-explore/mlx",
    features: ["Apple Silicon optimized", "Unified memory", "Fast inference", "Low power"],
  },
  exllama: {
    id: "exllama",
    name: "ExLlama2",
    description: "Ultra-fast inference for GPTQ/EXL2 quantized models",
    defaultPort: 5005,
    defaultBaseUrl: "http://localhost:5005",
    apiType: "openai",
    supportsStreaming: true,
    supportsEmbeddings: false,
    supportsVision: false,
    supportsFunctionCalling: false,
    installGuide: "https://github.com/turboderp/exllamav2",
    features: ["Fastest GPTQ", "EXL2 format", "GPU optimized", "Flash attention"],
  },
};

// =============================================================================
// LOCAL AI HUB SERVICE
// =============================================================================

export class LocalAIHub extends EventEmitter {
  private static instance: LocalAIHub;
  private config: AIHubConfig;
  private providerStatus: Map<ExtendedLocalProvider, ProviderStatus> = new Map();
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private downloadProgress: Map<string, ModelDownloadProgress> = new Map();

  private constructor() {
    super();
    this.config = this.getDefaultConfig();
  }

  static getInstance(): LocalAIHub {
    if (!LocalAIHub.instance) {
      LocalAIHub.instance = new LocalAIHub();
    }
    return LocalAIHub.instance;
  }

  private getDefaultConfig(): AIHubConfig {
    return {
      providers: Object.fromEntries(
        Object.keys(PROVIDER_CONFIGS).map((id) => [
          id,
          {
            enabled: true,
            baseUrl: PROVIDER_CONFIGS[id as ExtendedLocalProvider].defaultBaseUrl,
            autoStart: false,
            gpuLayers: -1, // Auto-detect
            contextSize: 4096,
          },
        ])
      ) as AIHubConfig["providers"],
      defaultProvider: "ollama",
      fallbackChain: ["ollama", "lmstudio", "llamacpp", "jan", "gpt4all"],
      autoDetect: true,
      healthCheckInterval: 30000,
      loadBalancing: "fastest",
    };
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  async initialize(): Promise<void> {
    logger.info("Initializing Local AI Hub...");
    
    // Start health checks
    this.startHealthChecks();
    
    // Initial provider detection
    if (this.config.autoDetect) {
      await this.detectProviders();
    }
    
    logger.info("Local AI Hub initialized successfully");
    this.emit("initialized");
  }

  async shutdown(): Promise<void> {
    logger.info("Shutting down Local AI Hub...");
    
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    
    this.emit("shutdown");
  }

  // ============================================================================
  // PROVIDER DETECTION & HEALTH
  // ============================================================================

  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(() => {
      this.detectProviders().catch((err) => {
        logger.error("Health check failed:", err);
      });
    }, this.config.healthCheckInterval);
  }

  async detectProviders(): Promise<ProviderStatus[]> {
    const results: ProviderStatus[] = [];
    
    const checkPromises = Object.entries(this.config.providers)
      .filter(([_, config]) => config.enabled)
      .map(async ([id, config]) => {
        const providerId = id as ExtendedLocalProvider;
        const status = await this.checkProvider(providerId, config.baseUrl);
        this.providerStatus.set(providerId, status);
        results.push(status);
        return status;
      });
    
    await Promise.allSettled(checkPromises);
    
    this.emit("providers-updated", results);
    return results;
  }

  private async checkProvider(
    id: ExtendedLocalProvider,
    baseUrl: string
  ): Promise<ProviderStatus> {
    const config = PROVIDER_CONFIGS[id];
    const status: ProviderStatus = {
      id,
      available: false,
      baseUrl,
      models: [],
      lastChecked: new Date(),
    };

    try {
      // Check health endpoint based on API type
      const healthUrl = this.getHealthUrl(id, baseUrl);
      const response = await fetch(healthUrl, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        status.available = true;
        
        // Get models
        try {
          status.models = await this.listProviderModels(id, baseUrl);
        } catch (err) {
          logger.warn(`Failed to list models for ${id}:`, err);
        }

        // Try to get version
        try {
          status.version = await this.getProviderVersion(id, baseUrl);
        } catch {
          // Version is optional
        }
      }
    } catch (err) {
      status.error = err instanceof Error ? err.message : String(err);
    }

    return status;
  }

  private getHealthUrl(id: ExtendedLocalProvider, baseUrl: string): string {
    const endpoints: Record<ExtendedLocalProvider, string> = {
      ollama: `${baseUrl}/api/tags`,
      lmstudio: `${baseUrl}/v1/models`,
      llamacpp: `${baseUrl}/health`,
      vllm: `${baseUrl}/v1/models`,
      localai: `${baseUrl}/v1/models`,
      gpt4all: `${baseUrl}/v1/models`,
      oobabooga: `${baseUrl}/v1/models`,
      koboldcpp: `${baseUrl}/api/v1/model`,
      jan: `${baseUrl}/v1/models`,
      mlx: `${baseUrl}/v1/models`,
      exllama: `${baseUrl}/v1/models`,
    };
    return endpoints[id];
  }

  private async getProviderVersion(
    id: ExtendedLocalProvider,
    baseUrl: string
  ): Promise<string | undefined> {
    try {
      if (id === "ollama") {
        const res = await fetch(`${baseUrl}/api/version`);
        const data = await res.json();
        return data.version;
      }
    } catch {
      return undefined;
    }
  }

  // ============================================================================
  // MODEL MANAGEMENT
  // ============================================================================

  async listProviderModels(
    id: ExtendedLocalProvider,
    baseUrl: string
  ): Promise<LocalModelInfo[]> {
    const config = PROVIDER_CONFIGS[id];

    if (id === "ollama") {
      const res = await fetch(`${baseUrl}/api/tags`);
      const data = await res.json();
      return (data.models || []).map((m: any) => ({
        id: m.name,
        name: m.name.split(":")[0],
        provider: "ollama" as LocalModelProvider,
        size: m.size,
        digest: m.digest,
        modifiedAt: m.modified_at,
        contextLength: m.details?.context_length,
        parameters: m.details?.parameter_size,
      }));
    }

    // OpenAI-compatible providers
    if (config.apiType === "openai") {
      const res = await fetch(`${baseUrl}/v1/models`);
      const data = await res.json();
      return (data.data || []).map((m: any) => ({
        id: m.id,
        name: m.id,
        provider: id as any,
        contextLength: m.context_length || m.max_model_len,
      }));
    }

    // Kobold API
    if (config.apiType === "kobold") {
      const res = await fetch(`${baseUrl}/api/v1/model`);
      const data = await res.json();
      return [{
        id: data.result || "default",
        name: data.result || "default",
        provider: id as any,
      }];
    }

    return [];
  }

  async listAllModels(): Promise<Array<LocalModelInfo & { source: ExtendedLocalProvider }>> {
    const allModels: Array<LocalModelInfo & { source: ExtendedLocalProvider }> = [];
    
    for (const [id, status] of this.providerStatus) {
      if (status.available) {
        for (const model of status.models) {
          allModels.push({ ...model, source: id });
        }
      }
    }
    
    return allModels;
  }

  async pullModel(
    provider: ExtendedLocalProvider,
    modelId: string,
    onProgress?: (progress: ModelDownloadProgress) => void
  ): Promise<void> {
    const key = `${provider}:${modelId}`;
    const progressData: ModelDownloadProgress = {
      modelId,
      provider,
      progress: 0,
      status: "pending",
    };
    
    this.downloadProgress.set(key, progressData);
    
    try {
      progressData.status = "downloading";
      
      if (provider === "ollama") {
        const baseUrl = this.config.providers.ollama.baseUrl;
        const response = await fetch(`${baseUrl}/api/pull`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: modelId, stream: true }),
        });

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let lastProgress = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value, { stream: true });
          const lines = text.split("\n").filter(Boolean);

          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              if (data.total && data.completed) {
                progressData.progress = (data.completed / data.total) * 100;
                if (progressData.progress !== lastProgress) {
                  lastProgress = progressData.progress;
                  onProgress?.(progressData);
                  this.emit("download-progress", progressData);
                }
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      progressData.status = "complete";
      progressData.progress = 100;
      onProgress?.(progressData);
      this.emit("download-complete", progressData);
      
    } catch (err) {
      progressData.status = "error";
      progressData.error = err instanceof Error ? err.message : String(err);
      onProgress?.(progressData);
      this.emit("download-error", progressData);
      throw err;
    } finally {
      this.downloadProgress.delete(key);
    }
  }

  // ============================================================================
  // INFERENCE
  // ============================================================================

  async chat(request: InferenceRequest): Promise<InferenceResponse> {
    // Find the best available provider
    const provider = await this.selectProvider(request);
    if (!provider) {
      throw new Error("No available local AI providers");
    }

    const config = PROVIDER_CONFIGS[provider];
    const baseUrl = this.config.providers[provider].baseUrl;

    // Route to appropriate API handler
    if (provider === "ollama") {
      return this.ollamaChat(baseUrl, request);
    } else if (config.apiType === "openai") {
      return this.openaiChat(baseUrl, request);
    } else if (config.apiType === "kobold") {
      return this.koboldChat(baseUrl, request);
    }

    throw new Error(`Unsupported provider: ${provider}`);
  }

  async streamChat(
    request: InferenceRequest,
    onChunk: (chunk: string) => void
  ): Promise<InferenceResponse> {
    const provider = await this.selectProvider(request);
    if (!provider) {
      throw new Error("No available local AI providers");
    }

    const config = PROVIDER_CONFIGS[provider];
    const baseUrl = this.config.providers[provider].baseUrl;

    if (provider === "ollama") {
      return this.ollamaStreamChat(baseUrl, request, onChunk);
    } else if (config.apiType === "openai") {
      return this.openaiStreamChat(baseUrl, request, onChunk);
    }

    throw new Error(`Streaming not supported for provider: ${provider}`);
  }

  private async selectProvider(request: InferenceRequest): Promise<ExtendedLocalProvider | null> {
    // If request specifies a provider, use it
    const requestedProvider = request.modelConfig?.provider as ExtendedLocalProvider;
    if (requestedProvider && this.providerStatus.get(requestedProvider)?.available) {
      return requestedProvider;
    }

    // Use fallback chain
    for (const provider of this.config.fallbackChain) {
      const status = this.providerStatus.get(provider);
      if (status?.available && status.models.length > 0) {
        return provider;
      }
    }

    // Last resort: any available provider
    for (const [id, status] of this.providerStatus) {
      if (status.available && status.models.length > 0) {
        return id;
      }
    }

    return null;
  }

  private async ollamaChat(
    baseUrl: string,
    request: InferenceRequest
  ): Promise<InferenceResponse> {
    const startTime = Date.now();
    
    const messages: any[] = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    if (request.messages) {
      messages.push(...request.messages);
    } else {
      messages.push({ role: "user", content: request.prompt });
    }

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.modelConfig.modelId,
        messages,
        stream: false,
        options: {
          temperature: request.modelConfig.options?.temperature ?? 0.7,
          num_predict: request.modelConfig.options?.numPredict ?? 2048,
        },
      }),
    });

    const data = await response.json();
    const endTime = Date.now();

    return {
      id: crypto.randomUUID(),
      requestId: request.id,
      modelInfo: {
        id: request.modelConfig.modelId,
        name: request.modelConfig.modelId,
        provider: "ollama",
      },
      output: data.message?.content || "",
      promptTokens: data.prompt_eval_count || 0,
      completionTokens: data.eval_count || 0,
      totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      generationTimeMs: endTime - startTime,
      timestamp: endTime,
      finishReason: "stop",
    };
  }

  private async ollamaStreamChat(
    baseUrl: string,
    request: InferenceRequest,
    onChunk: (chunk: string) => void
  ): Promise<InferenceResponse> {
    const startTime = Date.now();
    let fullOutput = "";
    let promptTokens = 0;
    let completionTokens = 0;

    const messages: any[] = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    if (request.messages) {
      messages.push(...request.messages);
    } else {
      messages.push({ role: "user", content: request.prompt });
    }

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.modelConfig.modelId,
        messages,
        stream: true,
        options: {
          temperature: request.modelConfig.options?.temperature ?? 0.7,
          num_predict: request.modelConfig.options?.numPredict ?? 2048,
        },
      }),
    });

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const lines = text.split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            fullOutput += data.message.content;
            onChunk(data.message.content);
          }
          if (data.done) {
            promptTokens = data.prompt_eval_count || 0;
            completionTokens = data.eval_count || 0;
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    const endTime = Date.now();
    return {
      id: crypto.randomUUID(),
      requestId: request.id,
      modelInfo: {
        id: request.modelConfig.modelId,
        name: request.modelConfig.modelId,
        provider: "ollama",
      },
      output: fullOutput,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      generationTimeMs: endTime - startTime,
      timestamp: endTime,
      finishReason: "stop",
    };
  }

  private async openaiChat(
    baseUrl: string,
    request: InferenceRequest
  ): Promise<InferenceResponse> {
    const startTime = Date.now();

    const messages: any[] = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    if (request.messages) {
      messages.push(...request.messages);
    } else {
      messages.push({ role: "user", content: request.prompt });
    }

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.modelConfig.modelId,
        messages,
        temperature: request.modelConfig.options?.temperature ?? 0.7,
        max_tokens: request.modelConfig.options?.numPredict ?? 2048,
        stream: false,
      }),
    });

    const data = await response.json();
    const endTime = Date.now();

    return {
      id: data.id || crypto.randomUUID(),
      requestId: request.id,
      modelInfo: {
        id: request.modelConfig.modelId,
        name: request.modelConfig.modelId,
        provider: request.modelConfig.provider as any,
      },
      output: data.choices?.[0]?.message?.content || "",
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0,
      generationTimeMs: endTime - startTime,
      timestamp: endTime,
      finishReason: data.choices?.[0]?.finish_reason || "stop",
    };
  }

  private async openaiStreamChat(
    baseUrl: string,
    request: InferenceRequest,
    onChunk: (chunk: string) => void
  ): Promise<InferenceResponse> {
    const startTime = Date.now();
    let fullOutput = "";

    const messages: any[] = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    if (request.messages) {
      messages.push(...request.messages);
    } else {
      messages.push({ role: "user", content: request.prompt });
    }

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.modelConfig.modelId,
        messages,
        temperature: request.modelConfig.options?.temperature ?? 0.7,
        max_tokens: request.modelConfig.options?.numPredict ?? 2048,
        stream: true,
      }),
    });

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const lines = text.split("\n").filter(Boolean);

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const json = line.slice(6);
          if (json === "[DONE]") continue;
          try {
            const data = JSON.parse(json);
            const content = data.choices?.[0]?.delta?.content;
            if (content) {
              fullOutput += content;
              onChunk(content);
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    }

    const endTime = Date.now();
    return {
      id: crypto.randomUUID(),
      requestId: request.id,
      modelInfo: {
        id: request.modelConfig.modelId,
        name: request.modelConfig.modelId,
        provider: request.modelConfig.provider as any,
      },
      output: fullOutput,
      promptTokens: 0, // Not available in streaming
      completionTokens: 0,
      totalTokens: 0,
      generationTimeMs: endTime - startTime,
      timestamp: endTime,
      finishReason: "stop",
    };
  }

  private async koboldChat(
    baseUrl: string,
    request: InferenceRequest
  ): Promise<InferenceResponse> {
    const startTime = Date.now();

    let prompt = request.prompt;
    if (request.systemPrompt) {
      prompt = `${request.systemPrompt}\n\n${prompt}`;
    }

    const response = await fetch(`${baseUrl}/api/v1/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        max_length: request.modelConfig.options?.numPredict ?? 2048,
        temperature: request.modelConfig.options?.temperature ?? 0.7,
      }),
    });

    const data = await response.json();
    const endTime = Date.now();

    return {
      id: crypto.randomUUID(),
      requestId: request.id,
      modelInfo: {
        id: request.modelConfig.modelId,
        name: request.modelConfig.modelId,
        provider: "koboldcpp" as any,
      },
      output: data.results?.[0]?.text || "",
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      generationTimeMs: endTime - startTime,
      timestamp: endTime,
      finishReason: "stop",
    };
  }

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  getConfig(): AIHubConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<AIHubConfig>): void {
    this.config = { ...this.config, ...updates };
    this.emit("config-updated", this.config);
  }

  getProviderStatus(id: ExtendedLocalProvider): ProviderStatus | undefined {
    return this.providerStatus.get(id);
  }

  getAllProviderStatus(): ProviderStatus[] {
    return Array.from(this.providerStatus.values());
  }

  getAvailableProviders(): ExtendedLocalProvider[] {
    return Array.from(this.providerStatus.entries())
      .filter(([_, status]) => status.available)
      .map(([id]) => id);
  }

  getProviderConfigs(): Record<ExtendedLocalProvider, LocalProviderConfig> {
    return PROVIDER_CONFIGS;
  }
}

// Export singleton
export const localAIHub = LocalAIHub.getInstance();
