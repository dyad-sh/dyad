/**
 * Local Model Service
 * Unified interface for Ollama, LM Studio, and other local inference providers
 */

import log from "electron-log";
import crypto from "crypto";
import type {
  LocalModelProvider,
  LocalModelInfo,
  LocalModelConfig,
  InferenceRequest,
  InferenceResponse,
  InferenceMessage,
} from "@/types/trustless_inference";

const logger = log.scope("local_models");

// ============================================================================
// Provider Configuration
// ============================================================================

const PROVIDER_DEFAULTS: Record<LocalModelProvider, { baseUrl: string; healthEndpoint: string }> = {
  ollama: { baseUrl: "http://127.0.0.1:11434", healthEndpoint: "/api/tags" },
  lmstudio: { baseUrl: "http://127.0.0.1:1234", healthEndpoint: "/v1/models" },
  llamacpp: { baseUrl: "http://127.0.0.1:8080", healthEndpoint: "/health" },
  vllm: { baseUrl: "http://127.0.0.1:8000", healthEndpoint: "/v1/models" },
};

// ============================================================================
// Ollama Provider
// ============================================================================

export class OllamaProvider {
  private baseUrl: string;

  constructor(baseUrl: string = PROVIDER_DEFAULTS.ollama.baseUrl) {
    this.baseUrl = baseUrl;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<LocalModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`);
    if (!response.ok) throw new Error("Failed to list Ollama models");

    const data = await response.json();
    return (data.models || []).map((model: any) => ({
      id: model.name,
      name: model.name.split(":")[0],
      provider: "ollama" as LocalModelProvider,
      modelHash: model.digest,
      size: model.size,
      quantization: this.extractQuantization(model.name),
      family: model.details?.family,
      parameters: model.details?.parameter_size,
      contextLength: model.details?.context_length,
      modifiedAt: model.modified_at,
      digest: model.digest,
    }));
  }

  async getModelInfo(modelId: string): Promise<LocalModelInfo | null> {
    try {
      const response = await fetch(`${this.baseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelId }),
      });

      if (!response.ok) return null;

      const data = await response.json();
      return {
        id: modelId,
        name: modelId.split(":")[0],
        provider: "ollama",
        modelHash: data.digest,
        family: data.details?.family,
        parameters: data.details?.parameter_size,
        contextLength: data.details?.context_length,
        quantization: data.details?.quantization_level,
        digest: data.digest,
      };
    } catch {
      return null;
    }
  }

  async generate(request: InferenceRequest): Promise<InferenceResponse> {
    const startTime = Date.now();

    const ollamaRequest: any = {
      model: request.modelConfig.modelId,
      prompt: request.prompt,
      stream: false,
      options: {
        temperature: request.modelConfig.options?.temperature ?? 0.7,
        top_p: request.modelConfig.options?.topP ?? 0.9,
        top_k: request.modelConfig.options?.topK ?? 40,
        repeat_penalty: request.modelConfig.options?.repeatPenalty ?? 1.1,
        seed: request.modelConfig.options?.seed,
        num_predict: request.modelConfig.options?.numPredict ?? 2048,
        num_ctx: request.modelConfig.options?.numCtx ?? 4096,
        stop: request.modelConfig.options?.stop,
      },
    };

    if (request.systemPrompt) {
      ollamaRequest.system = request.systemPrompt;
    }

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ollamaRequest),
    });

    if (!response.ok) {
      throw new Error(`Ollama generation failed: ${response.statusText}`);
    }

    const data = await response.json();
    const endTime = Date.now();

    const modelInfo = await this.getModelInfo(request.modelConfig.modelId);

    return {
      id: crypto.randomUUID(),
      requestId: request.id,
      modelInfo: modelInfo || {
        id: request.modelConfig.modelId,
        name: request.modelConfig.modelId,
        provider: "ollama",
      },
      output: data.response,
      promptTokens: data.prompt_eval_count || 0,
      completionTokens: data.eval_count || 0,
      totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      generationTimeMs: endTime - startTime,
      timestamp: endTime,
      finishReason: data.done ? "stop" : "length",
    };
  }

  async chat(request: InferenceRequest): Promise<InferenceResponse> {
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

    const ollamaRequest = {
      model: request.modelConfig.modelId,
      messages,
      stream: false,
      options: {
        temperature: request.modelConfig.options?.temperature ?? 0.7,
        top_p: request.modelConfig.options?.topP ?? 0.9,
        top_k: request.modelConfig.options?.topK ?? 40,
        repeat_penalty: request.modelConfig.options?.repeatPenalty ?? 1.1,
        seed: request.modelConfig.options?.seed,
        num_predict: request.modelConfig.options?.numPredict ?? 2048,
        num_ctx: request.modelConfig.options?.numCtx ?? 4096,
      },
    };

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ollamaRequest),
    });

    if (!response.ok) {
      throw new Error(`Ollama chat failed: ${response.statusText}`);
    }

    const data = await response.json();
    const endTime = Date.now();

    const modelInfo = await this.getModelInfo(request.modelConfig.modelId);

    return {
      id: crypto.randomUUID(),
      requestId: request.id,
      modelInfo: modelInfo || {
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
      finishReason: data.done ? "stop" : "length",
    };
  }

  async streamChat(
    request: InferenceRequest,
    onChunk: (chunk: string) => void
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

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.modelConfig.modelId,
        messages,
        stream: true,
        options: request.modelConfig.options,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama stream failed: ${response.statusText}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullOutput = "";
    let promptTokens = 0;
    let completionTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n").filter((l) => l.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            fullOutput += data.message.content;
            onChunk(data.message.content);
          }
          if (data.prompt_eval_count) promptTokens = data.prompt_eval_count;
          if (data.eval_count) completionTokens = data.eval_count;
        } catch {
          // Skip invalid JSON
        }
      }
    }

    const endTime = Date.now();
    const modelInfo = await this.getModelInfo(request.modelConfig.modelId);

    return {
      id: crypto.randomUUID(),
      requestId: request.id,
      modelInfo: modelInfo || {
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

  async pullModel(modelId: string, onProgress?: (progress: number) => void): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelId, stream: true }),
    });

    if (!response.ok) {
      throw new Error(`Failed to pull model: ${response.statusText}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value).split("\n").filter((l) => l.trim());
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.completed && data.total && onProgress) {
            onProgress((data.completed / data.total) * 100);
          }
        } catch {
          // Skip
        }
      }
    }
  }

  private extractQuantization(modelName: string): string | undefined {
    const match = modelName.match(/:([^:]+)$/);
    if (match) {
      const tag = match[1].toLowerCase();
      if (tag.includes("q4")) return "Q4";
      if (tag.includes("q5")) return "Q5";
      if (tag.includes("q8")) return "Q8";
      if (tag.includes("fp16")) return "FP16";
      if (tag.includes("f16")) return "FP16";
    }
    return undefined;
  }
}

// ============================================================================
// LM Studio Provider (OpenAI-compatible API)
// ============================================================================

export class LMStudioProvider {
  private baseUrl: string;

  constructor(baseUrl: string = PROVIDER_DEFAULTS.lmstudio.baseUrl) {
    this.baseUrl = baseUrl;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<LocalModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/v1/models`);
    if (!response.ok) throw new Error("Failed to list LM Studio models");

    const data = await response.json();
    return (data.data || []).map((model: any) => ({
      id: model.id,
      name: model.id,
      provider: "lmstudio" as LocalModelProvider,
      contextLength: model.context_length,
    }));
  }

  async chat(request: InferenceRequest): Promise<InferenceResponse> {
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

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.modelConfig.modelId,
        messages,
        temperature: request.modelConfig.options?.temperature ?? 0.7,
        top_p: request.modelConfig.options?.topP ?? 0.9,
        max_tokens: request.modelConfig.options?.numPredict ?? 2048,
        stop: request.modelConfig.options?.stop,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`LM Studio chat failed: ${response.statusText}`);
    }

    const data = await response.json();
    const endTime = Date.now();

    return {
      id: data.id || crypto.randomUUID(),
      requestId: request.id,
      modelInfo: {
        id: request.modelConfig.modelId,
        name: request.modelConfig.modelId,
        provider: "lmstudio",
      },
      output: data.choices?.[0]?.message?.content || "",
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0,
      generationTimeMs: endTime - startTime,
      timestamp: endTime,
      finishReason: data.choices?.[0]?.finish_reason === "stop" ? "stop" : "length",
    };
  }

  async streamChat(
    request: InferenceRequest,
    onChunk: (chunk: string) => void
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

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.modelConfig.modelId,
        messages,
        temperature: request.modelConfig.options?.temperature ?? 0.7,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`LM Studio stream failed: ${response.statusText}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let fullOutput = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

      for (const line of lines) {
        const jsonStr = line.slice(6);
        if (jsonStr === "[DONE]") continue;

        try {
          const data = JSON.parse(jsonStr);
          const content = data.choices?.[0]?.delta?.content;
          if (content) {
            fullOutput += content;
            onChunk(content);
          }
        } catch {
          // Skip invalid JSON
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
        provider: "lmstudio",
      },
      output: fullOutput,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      generationTimeMs: endTime - startTime,
      timestamp: endTime,
      finishReason: "stop",
    };
  }
}

// ============================================================================
// Unified Local Model Service
// ============================================================================

export class LocalModelService {
  private ollama: OllamaProvider;
  private lmstudio: LMStudioProvider;

  constructor(config?: { ollamaUrl?: string; lmstudioUrl?: string }) {
    this.ollama = new OllamaProvider(config?.ollamaUrl);
    this.lmstudio = new LMStudioProvider(config?.lmstudioUrl);
  }

  async getAvailableProviders(): Promise<LocalModelProvider[]> {
    const available: LocalModelProvider[] = [];

    if (await this.ollama.isAvailable()) {
      available.push("ollama");
    }
    if (await this.lmstudio.isAvailable()) {
      available.push("lmstudio");
    }

    return available;
  }

  async listAllModels(): Promise<LocalModelInfo[]> {
    const models: LocalModelInfo[] = [];

    try {
      if (await this.ollama.isAvailable()) {
        const ollamaModels = await this.ollama.listModels();
        models.push(...ollamaModels);
      }
    } catch (error) {
      logger.warn("Failed to list Ollama models:", error);
    }

    try {
      if (await this.lmstudio.isAvailable()) {
        const lmstudioModels = await this.lmstudio.listModels();
        models.push(...lmstudioModels);
      }
    } catch (error) {
      logger.warn("Failed to list LM Studio models:", error);
    }

    return models;
  }

  async listModels(provider: LocalModelProvider): Promise<LocalModelInfo[]> {
    switch (provider) {
      case "ollama":
        return this.ollama.listModels();
      case "lmstudio":
        return this.lmstudio.listModels();
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  async chat(request: InferenceRequest): Promise<InferenceResponse> {
    switch (request.modelConfig.provider) {
      case "ollama":
        return this.ollama.chat(request);
      case "lmstudio":
        return this.lmstudio.chat(request);
      default:
        throw new Error(`Unsupported provider: ${request.modelConfig.provider}`);
    }
  }

  async streamChat(
    request: InferenceRequest,
    onChunk: (chunk: string) => void
  ): Promise<InferenceResponse> {
    switch (request.modelConfig.provider) {
      case "ollama":
        return this.ollama.streamChat(request, onChunk);
      case "lmstudio":
        return this.lmstudio.streamChat(request, onChunk);
      default:
        throw new Error(`Unsupported provider: ${request.modelConfig.provider}`);
    }
  }

  async generate(request: InferenceRequest): Promise<InferenceResponse> {
    if (request.modelConfig.provider === "ollama") {
      return this.ollama.generate(request);
    }
    // For other providers, use chat
    return this.chat(request);
  }

  async pullModel(
    provider: LocalModelProvider,
    modelId: string,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    if (provider === "ollama") {
      return this.ollama.pullModel(modelId, onProgress);
    }
    throw new Error(`Pull not supported for provider: ${provider}`);
  }

  async getModelInfo(
    provider: LocalModelProvider,
    modelId: string
  ): Promise<LocalModelInfo | null> {
    if (provider === "ollama") {
      return this.ollama.getModelInfo(modelId);
    }
    // For other providers, list models and find
    const models = await this.listModels(provider);
    return models.find((m) => m.id === modelId) || null;
  }
}

// Export singleton
export const localModelService = new LocalModelService();
