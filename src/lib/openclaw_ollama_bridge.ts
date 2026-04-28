/**
 * OpenClaw-Ollama Bridge
 * 
 * Connects OpenClaw Personal AI Assistant with local Ollama inference.
 * OpenClaw becomes the intelligent router that decides when to use local
 * Ollama models vs cloud providers, based on task complexity and privacy needs.
 * 
 * ðŸ¦ž EXFOLIATE! EXFOLIATE! - Local AI supremacy!
 */

import { EventEmitter } from "events";
import log from "electron-log";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { v4 as uuidv4 } from "uuid";

const logger = log.scope("openclaw_ollama");

// =============================================================================
// TYPES
// =============================================================================

export interface OllamaModel {
  name: string;
  modifiedAt: string;
  size: number;
  digest: string;
  details: {
    format: string;
    family: string;
    parameterSize: string;
    quantizationLevel: string;
  };
}

export interface OllamaCapabilities {
  chat: boolean;
  completion: boolean;
  embedding: boolean;
  vision: boolean;
  functionCalling: boolean;
}

export interface OllamaInferenceRequest {
  model: string;
  messages?: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    images?: string[];
  }>;
  prompt?: string;
  systemPrompt?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
}

export interface OllamaInferenceResponse {
  id: string;
  model: string;
  content: string;
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  finishReason: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  timing: {
    totalMs: number;
    tokensPerSecond: number;
  };
}

export interface OpenClawOllamaConfig {
  /** Ollama base URL */
  ollamaBaseUrl: string;
  
  /** Default model for chat */
  defaultChatModel: string;
  
  /** Default model for code tasks */
  defaultCodeModel: string;
  
  /** Default model for vision tasks */
  defaultVisionModel: string;
  
  /** Default model for embeddings */
  defaultEmbeddingModel: string;
  
  /** Maximum context size */
  maxContextSize: number;
  
  /** Auto-select best model based on task */
  autoSelectModel: boolean;
  
  /** Prefer local models over cloud */
  preferLocal: boolean;
  
  /** Fall back to cloud if local fails */
  cloudFallback: boolean;
  
  /** Model performance thresholds for routing */
  routingThresholds: {
    /** Max task complexity for local (1-10) */
    maxLocalComplexity: number;
    /** Min required quality for local (0-1) */
    minLocalQuality: number;
    /** Max tokens for local processing */
    maxLocalTokens: number;
  };
}

export interface ModelRecommendation {
  model: string;
  reason: string;
  isLocal: boolean;
  estimatedSpeed: "fast" | "medium" | "slow";
  estimatedQuality: "high" | "medium" | "low";
}

// =============================================================================
// OPENCLAW OLLAMA BRIDGE
// =============================================================================

export class OpenClawOllamaBridge extends EventEmitter {
  private static instance: OpenClawOllamaBridge;
  
  private config: OpenClawOllamaConfig = {
    ollamaBaseUrl: "http://localhost:11434",
    defaultChatModel: "llama3.2:latest",
    defaultCodeModel: "codellama:latest",
    defaultVisionModel: "llava:latest",
    defaultEmbeddingModel: "nomic-embed-text:latest",
    maxContextSize: 8192,
    autoSelectModel: true,
    preferLocal: true,
    cloudFallback: true,
    routingThresholds: {
      maxLocalComplexity: 7,
      minLocalQuality: 0.7,
      maxLocalTokens: 4096,
    },
  };
  
  private ollamaAvailable = false;
  private availableModels: OllamaModel[] = [];
  private modelCapabilities: Map<string, OllamaCapabilities> = new Map();
  private lastHealthCheck: Date | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  
  // Performance tracking
  private modelPerformance: Map<string, {
    avgLatencyMs: number;
    avgTokensPerSecond: number;
    successRate: number;
    totalRequests: number;
  }> = new Map();
  
  private constructor() {
    super();
  }
  
  static getInstance(): OpenClawOllamaBridge {
    if (!OpenClawOllamaBridge.instance) {
      OpenClawOllamaBridge.instance = new OpenClawOllamaBridge();
    }
    return OpenClawOllamaBridge.instance;
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(config?: Partial<OpenClawOllamaConfig>): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config };
    }
    
    logger.info("ðŸ¦ž Initializing OpenClaw-Ollama bridge...");
    
    // Check Ollama availability
    await this.checkOllamaHealth();
    
    // Load available models
    if (this.ollamaAvailable) {
      await this.refreshModels();
    }
    
    // Start health check interval
    this.healthCheckInterval = setInterval(
      () => this.checkOllamaHealth(),
      30000
    );
    
    logger.info("ðŸ¦ž OpenClaw-Ollama bridge initialized", {
      ollamaAvailable: this.ollamaAvailable,
      modelsCount: this.availableModels.length,
    });
    
    this.emit("initialized", {
      ollamaAvailable: this.ollamaAvailable,
      models: this.availableModels.map(m => m.name),
    });
  }
  
  async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    this.emit("shutdown");
    logger.info("ðŸ¦ž OpenClaw-Ollama bridge shut down");
  }
  
  // ===========================================================================
  // OLLAMA HEALTH & MODELS
  // ===========================================================================
  
  async checkOllamaHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.ollamaBaseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      
      this.ollamaAvailable = response.ok;
      this.lastHealthCheck = new Date();
      
      if (this.ollamaAvailable) {
        this.emit("ollama:connected");
      } else {
        this.emit("ollama:disconnected");
      }
      
      return this.ollamaAvailable;
    } catch (error) {
      this.ollamaAvailable = false;
      this.lastHealthCheck = new Date();
      this.emit("ollama:error", error);
      return false;
    }
  }
  
  async refreshModels(): Promise<OllamaModel[]> {
    try {
      // Fetch from both API and disk, merge results to work around
      // Ollama bug where /api/tags can get out of sync with installed models
      const [apiModels, diskNames] = await Promise.all([
        this.fetchModelsFromApi(),
        this.scanOllamaManifests(),
      ]);

      const seen = new Set(apiModels.map((m) => m.name));
      const diskOnly: OllamaModel[] = diskNames
        .filter((name) => !seen.has(name))
        .map((name) => ({
          name,
          modifiedAt: new Date().toISOString(),
          size: 0,
          digest: "",
          details: {
            format: "gguf",
            family: "unknown",
            parameterSize: "unknown",
            quantizationLevel: "unknown",
          },
        }));

      this.availableModels = [...apiModels, ...diskOnly];

      logger.info(
        `Ollama: ${apiModels.length} from API, ${diskNames.length} from disk, ${this.availableModels.length} merged`,
      );

      // Auto-register disk-only models with the Ollama server (fire-and-forget)
      for (const model of diskOnly) {
        this.registerModelWithServer(model.name).catch(() => {});
      }
      
      // Update capabilities for each model
      for (const model of this.availableModels) {
        await this.detectModelCapabilities(model.name);
      }
      
      this.emit("models:refreshed", this.availableModels);
      
      return this.availableModels;
    } catch (error) {
      logger.error("Failed to refresh Ollama models:", error);
      return [];
    }
  }

  private async fetchModelsFromApi(): Promise<OllamaModel[]> {
    try {
      const response = await fetch(`${this.config.ollamaBaseUrl}/api/tags`);
      if (!response.ok) return [];

      const data = await response.json();
      return (data.models || []).map((m: any) => ({
        name: m.name,
        modifiedAt: m.modified_at,
        size: m.size,
        digest: m.digest,
        details: {
          format: m.details?.format || "gguf",
          family: m.details?.family || "unknown",
          parameterSize: m.details?.parameter_size || "unknown",
          quantizationLevel: m.details?.quantization_level || "unknown",
        },
      }));
    } catch {
      return [];
    }
  }

  private async scanOllamaManifests(): Promise<string[]> {
    const modelsDir =
      process.env.OLLAMA_MODELS ||
      path.join(os.homedir(), ".ollama", "models");
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
      const names: string[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const tags = await fs.promises.readdir(
          path.join(manifestsDir, entry.name),
          { withFileTypes: true },
        );
        for (const tag of tags) {
          if (tag.isFile()) {
            names.push(`${entry.name}:${tag.name}`);
          }
        }
      }
      return names;
    } catch {
      return [];
    }
  }

  /**
   * Register a model with the Ollama server using the CLI.
   * Ollama â‰¥0.15 can have models on disk that aren't in its internal DB.
   */
  private async registerModelWithServer(modelName: string): Promise<void> {
    const execFileAsync = promisify(execFile);
    const ollamaCli = this.findOllamaCli();
    try {
      const { stdout: modelfile } = await execFileAsync(ollamaCli, [
        "show", modelName, "--modelfile",
      ], { timeout: 30_000 });

      if (!modelfile || !modelfile.includes("FROM")) return;

      const tmpFile = path.join(os.tmpdir(), `ollama-reg-${modelName.replace(/[:/]/g, "_")}.modelfile`);
      await fs.promises.writeFile(tmpFile, modelfile, "utf-8");

      await execFileAsync(ollamaCli, [
        "create", modelName, "-f", tmpFile,
      ], { timeout: 300_000 });

      fs.promises.unlink(tmpFile).catch(() => {});
      logger.info(`Registered disk-only model via CLI: ${modelName}`);
    } catch (error) {
      logger.warn(`Failed to register model ${modelName} via CLI:`, error);
    }
  }

  private findOllamaCli(): string {
    if (process.platform === "win32") {
      const candidate = path.join(
        process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe",
      );
      if (fs.existsSync(candidate)) return candidate;
    }
    return "ollama";
  }
  
  private async detectModelCapabilities(modelName: string): Promise<OllamaCapabilities> {
    const nameLower = modelName.toLowerCase();
    
    // Detect capabilities based on model name
    const capabilities: OllamaCapabilities = {
      chat: true, // All models support chat
      completion: true,
      embedding: nameLower.includes("embed") || nameLower.includes("nomic"),
      vision: nameLower.includes("llava") || nameLower.includes("vision") || nameLower.includes("bakllava"),
      functionCalling: nameLower.includes("llama3") || nameLower.includes("mistral") || nameLower.includes("qwen"),
    };
    
    this.modelCapabilities.set(modelName, capabilities);
    
    return capabilities;
  }
  
  // ===========================================================================
  // INTELLIGENT MODEL SELECTION
  // ===========================================================================
  
  /**
   * Recommend the best model for a given task
   */
  recommendModel(task: {
    type: "chat" | "code" | "vision" | "embedding" | "analysis" | "creative";
    complexity?: number; // 1-10
    inputLength?: number;
    requiresVision?: boolean;
    requiresTools?: boolean;
    preferQuality?: boolean;
    preferSpeed?: boolean;
  }): ModelRecommendation {
    const complexity = task.complexity || 5;
    
    // Check if we should use local
    const useLocal = this.config.preferLocal &&
      this.ollamaAvailable &&
      complexity <= this.config.routingThresholds.maxLocalComplexity &&
      (!task.inputLength || task.inputLength <= this.config.routingThresholds.maxLocalTokens);
    
    if (!useLocal || !this.ollamaAvailable) {
      return {
        model: "claude-sonnet-4-5", // Default cloud model
        reason: this.ollamaAvailable
          ? "Task complexity exceeds local threshold"
          : "Ollama not available",
        isLocal: false,
        estimatedSpeed: "medium",
        estimatedQuality: "high",
      };
    }
    
    // Select best local model based on task
    let model: string;
    let reason: string;
    let quality: "high" | "medium" | "low" = "medium";
    let speed: "fast" | "medium" | "slow" = "medium";
    
    // Vision task
    if (task.requiresVision || task.type === "vision") {
      const visionModel = this.findModel(["llava", "bakllava", "vision"]);
      if (visionModel) {
        model = visionModel;
        reason = "Vision-capable model for image tasks";
        speed = "slow";
      } else {
        return {
          model: "claude-sonnet-4-5",
          reason: "No local vision model available",
          isLocal: false,
          estimatedSpeed: "medium",
          estimatedQuality: "high",
        };
      }
    }
    // Code task
    else if (task.type === "code") {
      const codeModel = this.findModel(["codellama", "deepseek-coder", "codegemma", "starcoder"]);
      model = codeModel || this.config.defaultCodeModel;
      reason = "Code-specialized model for programming tasks";
      quality = "high";
      speed = "medium";
    }
    // Embedding task
    else if (task.type === "embedding") {
      const embedModel = this.findModel(["nomic-embed", "all-minilm", "bge"]);
      model = embedModel || this.config.defaultEmbeddingModel;
      reason = "Embedding model for vector operations";
      quality = "high";
      speed = "fast";
    }
    // Creative task
    else if (task.type === "creative") {
      // Prefer larger models for creative tasks
      const creativeModel = this.findModel(["llama3.2:70b", "mixtral", "llama3.2"]);
      model = creativeModel || this.config.defaultChatModel;
      reason = "High-capability model for creative tasks";
      quality = task.preferQuality ? "high" : "medium";
      speed = "slow";
    }
    // Analysis task - needs reasoning
    else if (task.type === "analysis") {
      const analysisModel = this.findModel(["llama3.2", "qwen", "phi"]);
      model = analysisModel || this.config.defaultChatModel;
      reason = "Reasoning-capable model for analysis";
      quality = "medium";
      speed = "medium";
    }
    // General chat
    else {
      // Fast model for simple chat
      if (task.preferSpeed && !task.preferQuality) {
        const fastModel = this.findModel(["phi", "gemma:2b", "tinyllama"]);
        model = fastModel || this.config.defaultChatModel;
        reason = "Fast model for quick responses";
        quality = "low";
        speed = "fast";
      } else {
        model = this.config.defaultChatModel;
        reason = "Default chat model";
        quality = "medium";
        speed = "medium";
      }
    }
    
    return {
      model: model!,
      reason,
      isLocal: true,
      estimatedSpeed: speed,
      estimatedQuality: quality,
    };
  }
  
  private findModel(patterns: string[]): string | null {
    for (const pattern of patterns) {
      const found = this.availableModels.find(m => 
        m.name.toLowerCase().includes(pattern.toLowerCase())
      );
      if (found) return found.name;
    }
    return null;
  }
  
  // ===========================================================================
  // INFERENCE
  // ===========================================================================
  
  /**
   * Run inference through Ollama
   */
  async inference(request: OllamaInferenceRequest): Promise<OllamaInferenceResponse> {
    if (!this.ollamaAvailable) {
      throw new Error("Ollama is not available");
    }
    
    const startTime = Date.now();
    const requestId = uuidv4();
    
    this.emit("inference:start", { id: requestId, model: request.model });
    
    try {
      // Use chat API if messages provided, otherwise generate
      const endpoint = request.messages ? "/api/chat" : "/api/generate";
      
      const body: Record<string, unknown> = {
        model: request.model,
        stream: false,
        options: {
          temperature: request.temperature ?? 0.7,
          top_p: request.topP ?? 0.9,
          top_k: request.topK ?? 40,
          num_predict: request.maxTokens ?? 1024,
        },
      };
      
      if (request.messages) {
        body.messages = request.messages;
        if (request.tools) {
          body.tools = request.tools;
        }
      } else {
        body.prompt = request.prompt;
        if (request.systemPrompt) {
          body.system = request.systemPrompt;
        }
      }
      
      const response = await fetch(`${this.config.ollamaBaseUrl}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      
      if (!response.ok) {
        throw new Error(`Ollama request failed: ${response.statusText}`);
      }
      
      const data = await response.json();
      const endTime = Date.now();
      const latencyMs = endTime - startTime;
      
      const result: OllamaInferenceResponse = {
        id: requestId,
        model: request.model,
        content: data.message?.content || data.response || "",
        toolCalls: data.message?.tool_calls,
        finishReason: data.done_reason || "stop",
        usage: {
          promptTokens: data.prompt_eval_count || 0,
          completionTokens: data.eval_count || 0,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        },
        timing: {
          totalMs: latencyMs,
          tokensPerSecond: data.eval_count && latencyMs > 0
            ? (data.eval_count / latencyMs) * 1000
            : 0,
        },
      };
      
      // Update performance tracking
      this.updateModelPerformance(request.model, result);
      
      this.emit("inference:complete", result);
      
      return result;
      
    } catch (error) {
      this.emit("inference:error", { id: requestId, error });
      throw error;
    }
  }
  
  /**
   * Stream inference through Ollama
   */
  async *inferenceStream(
    request: OllamaInferenceRequest
  ): AsyncGenerator<string, OllamaInferenceResponse, unknown> {
    if (!this.ollamaAvailable) {
      throw new Error("Ollama is not available");
    }
    
    const startTime = Date.now();
    const requestId = uuidv4();
    
    this.emit("inference:start", { id: requestId, model: request.model, streaming: true });
    
    const endpoint = request.messages ? "/api/chat" : "/api/generate";
    
    const body: Record<string, unknown> = {
      model: request.model,
      stream: true,
      options: {
        temperature: request.temperature ?? 0.7,
        top_p: request.topP ?? 0.9,
        top_k: request.topK ?? 40,
        num_predict: request.maxTokens ?? 1024,
      },
    };
    
    if (request.messages) {
      body.messages = request.messages;
    } else {
      body.prompt = request.prompt;
      if (request.systemPrompt) {
        body.system = request.systemPrompt;
      }
    }
    
    const response = await fetch(`${this.config.ollamaBaseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      throw new Error(`Ollama stream failed: ${response.statusText}`);
    }
    
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    
    let fullContent = "";
    let finalData: any = null;
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter(l => l.trim());
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            
            if (data.done) {
              finalData = data;
            } else {
              const content = data.message?.content || data.response || "";
              fullContent += content;
              
              if (content) {
                this.emit("inference:chunk", { id: requestId, content });
                yield content;
              }
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    
    const endTime = Date.now();
    const latencyMs = endTime - startTime;
    
    const result: OllamaInferenceResponse = {
      id: requestId,
      model: request.model,
      content: fullContent,
      finishReason: finalData?.done_reason || "stop",
      usage: {
        promptTokens: finalData?.prompt_eval_count || 0,
        completionTokens: finalData?.eval_count || 0,
        totalTokens: (finalData?.prompt_eval_count || 0) + (finalData?.eval_count || 0),
      },
      timing: {
        totalMs: latencyMs,
        tokensPerSecond: finalData?.eval_count && latencyMs > 0
          ? (finalData.eval_count / latencyMs) * 1000
          : 0,
      },
    };
    
    this.updateModelPerformance(request.model, result);
    this.emit("inference:complete", result);
    
    return result;
  }
  
  /**
   * Generate embeddings
   */
  async embed(
    model: string,
    input: string | string[]
  ): Promise<{ embeddings: number[][]; model: string }> {
    if (!this.ollamaAvailable) {
      throw new Error("Ollama is not available");
    }
    
    const inputs = Array.isArray(input) ? input : [input];
    
    const response = await fetch(`${this.config.ollamaBaseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: inputs,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Embedding failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      embeddings: data.embeddings,
      model,
    };
  }
  
  // ===========================================================================
  // PERFORMANCE TRACKING
  // ===========================================================================
  
  private updateModelPerformance(model: string, response: OllamaInferenceResponse): void {
    const existing = this.modelPerformance.get(model) || {
      avgLatencyMs: 0,
      avgTokensPerSecond: 0,
      successRate: 1,
      totalRequests: 0,
    };
    
    const n = existing.totalRequests;
    const newN = n + 1;
    
    existing.avgLatencyMs = (existing.avgLatencyMs * n + response.timing.totalMs) / newN;
    existing.avgTokensPerSecond = (existing.avgTokensPerSecond * n + response.timing.tokensPerSecond) / newN;
    existing.totalRequests = newN;
    
    this.modelPerformance.set(model, existing);
  }
  
  getModelPerformance(model: string) {
    return this.modelPerformance.get(model);
  }
  
  getAllModelPerformance() {
    return Object.fromEntries(this.modelPerformance);
  }
  
  // ===========================================================================
  // GETTERS
  // ===========================================================================
  
  isOllamaAvailable(): boolean {
    return this.ollamaAvailable;
  }
  
  getAvailableModels(): OllamaModel[] {
    return this.availableModels;
  }
  
  getModelCapabilities(model: string): OllamaCapabilities | undefined {
    return this.modelCapabilities.get(model);
  }
  
  getConfig(): OpenClawOllamaConfig {
    return { ...this.config };
  }
  
  updateConfig(config: Partial<OpenClawOllamaConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit("config:updated", this.config);
  }
  
  getStatus() {
    return {
      ollamaAvailable: this.ollamaAvailable,
      lastHealthCheck: this.lastHealthCheck,
      modelsCount: this.availableModels.length,
      models: this.availableModels.map(m => ({
        name: m.name,
        size: m.size,
        capabilities: this.modelCapabilities.get(m.name),
      })),
      config: this.config,
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

let instance: OpenClawOllamaBridge | null = null;

export function getOpenClawOllamaBridge(): OpenClawOllamaBridge {
  if (!instance) {
    instance = OpenClawOllamaBridge.getInstance();
  }
  return instance;
}

export default OpenClawOllamaBridge;
