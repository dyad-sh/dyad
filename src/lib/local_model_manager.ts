/**
 * Local Model Manager
 * Download, manage, and run LLMs locally without cloud dependencies.
 * Supports Ollama, llama.cpp, transformers, and more.
 */

import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs/promises";
import { existsSync, createWriteStream } from "fs";
import { spawn, ChildProcess } from "child_process";
import { app } from "electron";
import log from "electron-log";
import { EventEmitter } from "events";

import type {
  ModelId,
  LocalModel,
  ModelBackend,
  ModelFormat,
  ModelCapabilities,
  ModelDownloadRequest,
  ModelLoadConfig,
  InferenceRequest,
  InferenceResponse,
  ChatMessage,
  QuantizationType,
} from "@/types/sovereign_stack_types";

const logger = log.scope("local_model_manager");

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_MODELS_DIR = path.join(app.getPath("userData"), "models");

const MODEL_REGISTRY: Record<string, Partial<LocalModel>> = {
  "llama-3.2-3b": {
    name: "Llama 3.2 3B",
    family: "llama",
    version: "3.2",
    parameters: 3_000_000_000,
    contextLength: 131072,
    vocabSize: 128256,
    license: "Llama 3.2 Community License",
    author: "Meta",
    capabilities: {
      textGeneration: true,
      chat: true,
      embedding: false,
      codeGeneration: true,
      functionCalling: true,
      vision: false,
      audio: false,
      multimodal: false,
    },
  },
  "llama-3.2-1b": {
    name: "Llama 3.2 1B",
    family: "llama",
    version: "3.2",
    parameters: 1_000_000_000,
    contextLength: 131072,
    vocabSize: 128256,
    license: "Llama 3.2 Community License",
    author: "Meta",
    capabilities: {
      textGeneration: true,
      chat: true,
      embedding: false,
      codeGeneration: true,
      functionCalling: true,
      vision: false,
      audio: false,
      multimodal: false,
    },
  },
  "mistral-7b": {
    name: "Mistral 7B",
    family: "mistral",
    version: "0.3",
    parameters: 7_000_000_000,
    contextLength: 32768,
    vocabSize: 32000,
    license: "Apache 2.0",
    author: "Mistral AI",
    capabilities: {
      textGeneration: true,
      chat: true,
      embedding: false,
      codeGeneration: true,
      functionCalling: true,
      vision: false,
      audio: false,
      multimodal: false,
    },
  },
  "qwen2.5-7b": {
    name: "Qwen 2.5 7B",
    family: "qwen",
    version: "2.5",
    parameters: 7_000_000_000,
    contextLength: 131072,
    vocabSize: 152064,
    license: "Qwen License",
    author: "Alibaba",
    capabilities: {
      textGeneration: true,
      chat: true,
      embedding: false,
      codeGeneration: true,
      functionCalling: true,
      vision: false,
      audio: false,
      multimodal: false,
    },
  },
  "deepseek-coder-6.7b": {
    name: "DeepSeek Coder 6.7B",
    family: "deepseek",
    version: "1.5",
    parameters: 6_700_000_000,
    contextLength: 16384,
    vocabSize: 32000,
    license: "DeepSeek License",
    author: "DeepSeek",
    capabilities: {
      textGeneration: true,
      chat: true,
      embedding: false,
      codeGeneration: true,
      functionCalling: false,
      vision: false,
      audio: false,
      multimodal: false,
    },
  },
  "nomic-embed-text": {
    name: "Nomic Embed Text",
    family: "nomic",
    version: "1.5",
    parameters: 137_000_000,
    contextLength: 8192,
    embeddingDimension: 768,
    vocabSize: 30528,
    license: "Apache 2.0",
    author: "Nomic AI",
    capabilities: {
      textGeneration: false,
      chat: false,
      embedding: true,
      codeGeneration: false,
      functionCalling: false,
      vision: false,
      audio: false,
      multimodal: false,
    },
  },
  "all-minilm-l6-v2": {
    name: "All MiniLM L6 v2",
    family: "sentence-transformers",
    version: "1.0",
    parameters: 22_000_000,
    contextLength: 512,
    embeddingDimension: 384,
    vocabSize: 30522,
    license: "Apache 2.0",
    author: "Sentence Transformers",
    capabilities: {
      textGeneration: false,
      chat: false,
      embedding: true,
      codeGeneration: false,
      functionCalling: false,
      vision: false,
      audio: false,
      multimodal: false,
    },
  },
};

// =============================================================================
// MODEL MANAGER CLASS
// =============================================================================

export class LocalModelManager extends EventEmitter {
  private modelsDir: string;
  private models: Map<ModelId, LocalModel> = new Map();
  private loadedModels: Map<ModelId, LoadedModel> = new Map();
  private ollamaProcess?: ChildProcess;
  private llamaCppProcesses: Map<ModelId, ChildProcess> = new Map();
  
  constructor(modelsDir?: string) {
    super();
    this.modelsDir = modelsDir || DEFAULT_MODELS_DIR;
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(): Promise<void> {
    logger.info("Initializing local model manager", { modelsDir: this.modelsDir });
    
    // Ensure models directory exists
    await fs.mkdir(this.modelsDir, { recursive: true });
    
    // Scan for existing models
    await this.scanModels();
    
    // Check Ollama availability
    await this.checkOllamaStatus();
    
    logger.info("Model manager initialized", { modelCount: this.models.size });
  }
  
  /**
   * Scan models directory for downloaded models
   */
  private async scanModels(): Promise<void> {
    const entries = await fs.readdir(this.modelsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const modelPath = path.join(this.modelsDir, entry.name);
        const configPath = path.join(modelPath, "model_config.json");
        
        if (existsSync(configPath)) {
          try {
            const config = JSON.parse(await fs.readFile(configPath, "utf-8"));
            const model: LocalModel = {
              id: config.id as ModelId,
              ...config,
              path: modelPath,
              downloaded: true,
              loaded: false,
            };
            this.models.set(model.id, model);
          } catch (error) {
            logger.warn("Failed to load model config", { path: configPath, error });
          }
        }
      }
    }
  }
  
  /**
   * Check if Ollama is available
   */
  private async checkOllamaStatus(): Promise<boolean> {
    try {
      const response = await fetch("http://localhost:11434/api/tags");
      if (response.ok) {
        const data = await response.json();
        logger.info("Ollama available", { models: data.models?.length || 0 });
        
        // Import Ollama models
        for (const model of data.models || []) {
          const modelId = `ollama:${model.name}` as ModelId;
          if (!this.models.has(modelId)) {
            this.models.set(modelId, {
              id: modelId,
              name: model.name,
              family: model.details?.family || "unknown",
              version: model.details?.parameter_size || "unknown",
              backend: "ollama",
              format: "gguf",
              size: this.getSizeCategory(model.size),
              path: "",
              parameters: this.parseParameterCount(model.details?.parameter_size),
              contextLength: 4096,
              vocabSize: 32000,
              capabilities: {
                textGeneration: true,
                chat: true,
                embedding: model.name.includes("embed"),
                codeGeneration: model.name.includes("code"),
                functionCalling: false,
                vision: model.name.includes("vision"),
                audio: false,
                multimodal: model.name.includes("vision"),
              },
              downloaded: true,
              loaded: false,
              license: "Various",
              author: "Various",
              source: "ollama",
              createdAt: Date.now(),
            });
          }
        }
        
        return true;
      }
    } catch {
      logger.info("Ollama not available");
    }
    return false;
  }
  
  // ===========================================================================
  // MODEL LISTING
  // ===========================================================================
  
  /**
   * List all available models
   */
  listModels(): LocalModel[] {
    return Array.from(this.models.values());
  }
  
  /**
   * Get model by ID
   */
  getModel(modelId: ModelId): LocalModel | null {
    return this.models.get(modelId) || null;
  }
  
  /**
   * List models available for download
   */
  listAvailableModels(): Array<{ id: string; name: string; family: string; parameters: number }> {
    return Object.entries(MODEL_REGISTRY).map(([id, model]) => ({
      id,
      name: model.name!,
      family: model.family!,
      parameters: model.parameters!,
    }));
  }
  
  // ===========================================================================
  // MODEL DOWNLOAD
  // ===========================================================================
  
  /**
   * Download a model
   */
  async downloadModel(request: ModelDownloadRequest): Promise<LocalModel> {
    logger.info("Downloading model", { request });
    
    const modelId = crypto.randomUUID() as ModelId;
    const modelDir = path.join(this.modelsDir, modelId);
    await fs.mkdir(modelDir, { recursive: true });
    
    let model: LocalModel;
    
    switch (request.source) {
      case "ollama":
        model = await this.downloadFromOllama(modelId, modelDir, request);
        break;
      case "huggingface":
        model = await this.downloadFromHuggingFace(modelId, modelDir, request);
        break;
      case "url":
        model = await this.downloadFromUrl(modelId, modelDir, request);
        break;
      case "local":
        model = await this.importLocalModel(modelId, modelDir, request);
        break;
      default:
        throw new Error(`Unsupported source: ${request.source}`);
    }
    
    // Save config
    await fs.writeFile(
      path.join(modelDir, "model_config.json"),
      JSON.stringify(model, null, 2)
    );
    
    this.models.set(modelId, model);
    this.emit("model:downloaded", model);
    
    return model;
  }
  
  /**
   * Download model via Ollama
   */
  private async downloadFromOllama(
    modelId: ModelId,
    modelDir: string,
    request: ModelDownloadRequest
  ): Promise<LocalModel> {
    const modelName = request.modelId;
    
    // Pull model via Ollama API
    const response = await fetch("http://localhost:11434/api/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName, stream: true }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to pull model: ${response.statusText}`);
    }
    
    // Stream progress
    const reader = response.body?.getReader();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const text = new TextDecoder().decode(value);
        for (const line of text.split("\n").filter(Boolean)) {
          try {
            const data = JSON.parse(line);
            if (data.total && data.completed) {
              const progress = (data.completed / data.total) * 100;
              this.emit("download:progress", { modelId, progress, status: data.status });
            }
          } catch {}
        }
      }
    }
    
    // Get model info
    const infoResponse = await fetch("http://localhost:11434/api/show", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName }),
    });
    
    const info = await infoResponse.json();
    const registry = MODEL_REGISTRY[modelName] || {};
    
    return {
      id: modelId,
      name: info.name || modelName,
      family: info.details?.family || registry.family || "unknown",
      version: info.details?.parameter_size || registry.version || "unknown",
      backend: "ollama",
      format: "gguf",
      size: this.getSizeCategory(info.size),
      path: modelDir,
      parameters: registry.parameters || this.parseParameterCount(info.details?.parameter_size),
      contextLength: registry.contextLength || 4096,
      vocabSize: registry.vocabSize || 32000,
      capabilities: registry.capabilities || {
        textGeneration: true,
        chat: true,
        embedding: false,
        codeGeneration: false,
        functionCalling: false,
        vision: false,
        audio: false,
        multimodal: false,
      },
      downloaded: true,
      loaded: false,
      license: registry.license || "Various",
      author: registry.author || "Various",
      source: `ollama:${modelName}`,
      createdAt: Date.now(),
    };
  }
  
  /**
   * Download model from HuggingFace
   */
  private async downloadFromHuggingFace(
    modelId: ModelId,
    modelDir: string,
    request: ModelDownloadRequest
  ): Promise<LocalModel> {
    const repoId = request.modelId;
    const variant = request.variant || "main";
    const quant = request.quantization || "q4_0";
    
    // Determine files to download
    const files: string[] = [];
    
    // List repo files
    const listResponse = await fetch(
      `https://huggingface.co/api/models/${repoId}/tree/${variant}`
    );
    
    if (!listResponse.ok) {
      throw new Error(`Failed to list repo: ${listResponse.statusText}`);
    }
    
    const repoFiles = await listResponse.json();
    
    // Find GGUF files or safetensors
    for (const file of repoFiles) {
      if (file.path.endsWith(".gguf") && file.path.includes(quant)) {
        files.push(file.path);
      } else if (file.path.endsWith(".safetensors")) {
        files.push(file.path);
      } else if (["config.json", "tokenizer.json", "tokenizer_config.json"].includes(file.path)) {
        files.push(file.path);
      }
    }
    
    // Download files
    for (const file of files) {
      const url = `https://huggingface.co/${repoId}/resolve/${variant}/${file}`;
      const filePath = path.join(modelDir, file);
      
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await this.downloadFile(url, filePath, (progress) => {
        this.emit("download:progress", { modelId, progress, file });
      });
    }
    
    // Read config
    const configPath = path.join(modelDir, "config.json");
    let config: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      config = JSON.parse(await fs.readFile(configPath, "utf-8"));
    }
    
    const registry = MODEL_REGISTRY[repoId.split("/").pop()!] || {};
    
    return {
      id: modelId,
      name: (config.name as string) || repoId.split("/").pop()!,
      family: (config.model_type as string) || registry.family || "unknown",
      version: variant,
      backend: request.targetBackend,
      format: files.some((f) => f.endsWith(".gguf")) ? "gguf" : "safetensors",
      size: this.getSizeFromParams((config.num_parameters as number) || registry.parameters || 0),
      quantization: request.quantization,
      path: modelDir,
      parameters: (config.num_parameters as number) || registry.parameters || 0,
      contextLength: (config.max_position_embeddings as number) || registry.contextLength || 4096,
      vocabSize: (config.vocab_size as number) || registry.vocabSize || 32000,
      capabilities: registry.capabilities || {
        textGeneration: true,
        chat: true,
        embedding: false,
        codeGeneration: false,
        functionCalling: false,
        vision: false,
        audio: false,
        multimodal: false,
      },
      downloaded: true,
      loaded: false,
      license: registry.license || "Various",
      author: repoId.split("/")[0],
      source: `huggingface:${repoId}`,
      createdAt: Date.now(),
    };
  }
  
  /**
   * Download from URL
   */
  private async downloadFromUrl(
    modelId: ModelId,
    modelDir: string,
    request: ModelDownloadRequest
  ): Promise<LocalModel> {
    const url = request.modelId;
    const fileName = path.basename(new URL(url).pathname);
    const filePath = path.join(modelDir, fileName);
    
    await this.downloadFile(url, filePath, (progress) => {
      this.emit("download:progress", { modelId, progress });
    });
    
    const format: ModelFormat = fileName.endsWith(".gguf") ? "gguf" : "safetensors";
    
    return {
      id: modelId,
      name: fileName.replace(/\.(gguf|safetensors)$/, ""),
      family: "unknown",
      version: "1.0",
      backend: request.targetBackend,
      format,
      size: "medium",
      path: modelDir,
      parameters: 0,
      contextLength: 4096,
      vocabSize: 32000,
      capabilities: {
        textGeneration: true,
        chat: true,
        embedding: false,
        codeGeneration: false,
        functionCalling: false,
        vision: false,
        audio: false,
        multimodal: false,
      },
      downloaded: true,
      loaded: false,
      license: "Unknown",
      author: "Unknown",
      source: url,
      createdAt: Date.now(),
    };
  }
  
  /**
   * Import local model
   */
  private async importLocalModel(
    modelId: ModelId,
    modelDir: string,
    request: ModelDownloadRequest
  ): Promise<LocalModel> {
    const sourcePath = request.modelId;
    
    // Copy files
    const stat = await fs.stat(sourcePath);
    if (stat.isDirectory()) {
      await this.copyDirectory(sourcePath, modelDir);
    } else {
      await fs.copyFile(sourcePath, path.join(modelDir, path.basename(sourcePath)));
    }
    
    return {
      id: modelId,
      name: path.basename(sourcePath).replace(/\.(gguf|safetensors)$/, ""),
      family: "unknown",
      version: "1.0",
      backend: request.targetBackend,
      format: sourcePath.endsWith(".gguf") ? "gguf" : "safetensors",
      size: "medium",
      path: modelDir,
      parameters: 0,
      contextLength: 4096,
      vocabSize: 32000,
      capabilities: {
        textGeneration: true,
        chat: true,
        embedding: false,
        codeGeneration: false,
        functionCalling: false,
        vision: false,
        audio: false,
        multimodal: false,
      },
      downloaded: true,
      loaded: false,
      license: "Unknown",
      author: "Unknown",
      source: `local:${sourcePath}`,
      createdAt: Date.now(),
    };
  }
  
  // ===========================================================================
  // MODEL LOADING
  // ===========================================================================
  
  /**
   * Load a model into memory
   */
  async loadModel(config: ModelLoadConfig): Promise<void> {
    const model = this.models.get(config.modelId);
    if (!model) {
      throw new Error(`Model not found: ${config.modelId}`);
    }
    
    if (model.loaded) {
      logger.info("Model already loaded", { modelId: config.modelId });
      return;
    }
    
    logger.info("Loading model", { modelId: config.modelId, backend: model.backend });
    
    switch (model.backend) {
      case "ollama":
        await this.loadOllamaModel(model, config);
        break;
      case "llama.cpp":
        await this.loadLlamaCppModel(model, config);
        break;
      default:
        throw new Error(`Unsupported backend: ${model.backend}`);
    }
    
    model.loaded = true;
    model.gpuLayers = config.gpuLayers;
    this.emit("model:loaded", model);
  }
  
  /**
   * Load model via Ollama
   */
  private async loadOllamaModel(model: LocalModel, config: ModelLoadConfig): Promise<void> {
    const modelName = model.source?.replace("ollama:", "") || model.name;
    
    // Load model by making a dummy request
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        prompt: "test",
        options: {
          num_ctx: config.contextSize || 4096,
          num_gpu: config.gpuLayers || 0,
          num_thread: config.threads,
        },
        stream: false,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to load model: ${response.statusText}`);
    }
    
    this.loadedModels.set(config.modelId, {
      model,
      backend: "ollama",
      config,
    });
  }
  
  /**
   * Load model via llama.cpp server
   */
  private async loadLlamaCppModel(model: LocalModel, config: ModelLoadConfig): Promise<void> {
    // Find GGUF file
    const files = await fs.readdir(model.path);
    const ggufFile = files.find((f) => f.endsWith(".gguf"));
    
    if (!ggufFile) {
      throw new Error("No GGUF file found in model directory");
    }
    
    const modelPath = path.join(model.path, ggufFile);
    const port = 8080 + this.llamaCppProcesses.size;
    
    // Start llama.cpp server
    const args = [
      "-m", modelPath,
      "-c", String(config.contextSize || 4096),
      "-ngl", String(config.gpuLayers || 0),
      "-t", String(config.threads || 4),
      "--host", "127.0.0.1",
      "--port", String(port),
    ];
    
    if (config.flashAttention) {
      args.push("-fa");
    }
    
    const proc = spawn("llama-server", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    
    this.llamaCppProcesses.set(config.modelId, proc);
    
    // Wait for server to start
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Server start timeout")), 30000);
      
      proc.stdout?.on("data", (data) => {
        if (data.toString().includes("listening")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      
      proc.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    
    this.loadedModels.set(config.modelId, {
      model,
      backend: "llama.cpp",
      config,
      serverUrl: `http://127.0.0.1:${port}`,
    });
  }
  
  /**
   * Unload a model
   */
  async unloadModel(modelId: ModelId): Promise<void> {
    const loaded = this.loadedModels.get(modelId);
    if (!loaded) return;
    
    if (loaded.backend === "llama.cpp") {
      const proc = this.llamaCppProcesses.get(modelId);
      if (proc) {
        proc.kill();
        this.llamaCppProcesses.delete(modelId);
      }
    }
    
    this.loadedModels.delete(modelId);
    
    const model = this.models.get(modelId);
    if (model) {
      model.loaded = false;
    }
    
    this.emit("model:unloaded", { modelId });
  }
  
  // ===========================================================================
  // INFERENCE
  // ===========================================================================
  
  /**
   * Run inference
   */
  async inference(request: InferenceRequest): Promise<InferenceResponse> {
    const loaded = this.loadedModels.get(request.modelId);
    if (!loaded) {
      throw new Error(`Model not loaded: ${request.modelId}`);
    }
    
    const startTime = Date.now();
    let response: InferenceResponse;
    
    switch (loaded.backend) {
      case "ollama":
        response = await this.ollamaInference(loaded, request);
        break;
      case "llama.cpp":
        response = await this.llamaCppInference(loaded, request);
        break;
      default:
        throw new Error(`Unsupported backend: ${loaded.backend}`);
    }
    
    // Update last used
    const model = this.models.get(request.modelId);
    if (model) {
      model.lastUsedAt = Date.now();
    }
    
    return response;
  }
  
  /**
   * Run inference via Ollama
   */
  private async ollamaInference(loaded: LoadedModel, request: InferenceRequest): Promise<InferenceResponse> {
    const modelName = loaded.model.source?.replace("ollama:", "") || loaded.model.name;
    
    const body: Record<string, unknown> = {
      model: modelName,
      stream: false,
      options: {
        temperature: request.temperature ?? 0.7,
        top_p: request.topP ?? 0.9,
        top_k: request.topK ?? 40,
        repeat_penalty: request.repeatPenalty ?? 1.1,
        num_predict: request.maxTokens ?? 1024,
        stop: request.stopSequences,
      },
    };
    
    // Chat or completion
    if (request.messages) {
      body.messages = request.messages.map((m) => ({
        role: m.role,
        content: m.content,
        images: m.images,
      }));
      
      if (request.tools) {
        body.tools = request.tools;
      }
    } else {
      body.prompt = request.prompt;
      if (request.systemPrompt) {
        body.system = request.systemPrompt;
      }
    }
    
    const endpoint = request.messages ? "/api/chat" : "/api/generate";
    const response = await fetch(`http://localhost:11434${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      id: crypto.randomUUID(),
      modelId: request.modelId,
      content: data.message?.content || data.response || "",
      toolCalls: data.message?.tool_calls,
      finishReason: data.done_reason || "stop",
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
      timing: {
        promptEvalMs: data.prompt_eval_duration ? data.prompt_eval_duration / 1e6 : 0,
        evalMs: data.eval_duration ? data.eval_duration / 1e6 : 0,
        totalMs: data.total_duration ? data.total_duration / 1e6 : 0,
        tokensPerSecond: data.eval_count && data.eval_duration 
          ? (data.eval_count / (data.eval_duration / 1e9))
          : 0,
      },
    };
  }
  
  /**
   * Run inference via llama.cpp server
   */
  private async llamaCppInference(loaded: LoadedModel, request: InferenceRequest): Promise<InferenceResponse> {
    const body: Record<string, unknown> = {
      prompt: request.prompt,
      temperature: request.temperature ?? 0.7,
      top_p: request.topP ?? 0.9,
      top_k: request.topK ?? 40,
      repeat_penalty: request.repeatPenalty ?? 1.1,
      n_predict: request.maxTokens ?? 1024,
      stop: request.stopSequences,
      stream: false,
    };
    
    if (request.messages) {
      // Format as chat template
      body.prompt = this.formatChatPrompt(request.messages, request.systemPrompt);
    }
    
    const response = await fetch(`${loaded.serverUrl}/completion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      throw new Error(`llama.cpp request failed: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      id: crypto.randomUUID(),
      modelId: request.modelId,
      content: data.content || "",
      finishReason: data.stop ? "stop" : "length",
      usage: {
        promptTokens: data.tokens_evaluated || 0,
        completionTokens: data.tokens_predicted || 0,
        totalTokens: (data.tokens_evaluated || 0) + (data.tokens_predicted || 0),
      },
      timing: {
        promptEvalMs: data.timings?.prompt_ms || 0,
        evalMs: data.timings?.predicted_ms || 0,
        totalMs: (data.timings?.prompt_ms || 0) + (data.timings?.predicted_ms || 0),
        tokensPerSecond: data.timings?.predicted_per_second || 0,
      },
    };
  }
  
  /**
   * Stream inference
   */
  async *inferenceStream(request: InferenceRequest): AsyncGenerator<string, InferenceResponse> {
    const loaded = this.loadedModels.get(request.modelId);
    if (!loaded) {
      throw new Error(`Model not loaded: ${request.modelId}`);
    }
    
    // Similar to inference but with streaming
    // Implementation depends on backend
    yield* this.ollamaInferenceStream(loaded, request);
    
    return {
      id: crypto.randomUUID(),
      modelId: request.modelId,
      content: "",
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      timing: { promptEvalMs: 0, evalMs: 0, totalMs: 0, tokensPerSecond: 0 },
    };
  }
  
  /**
   * Stream via Ollama
   */
  private async *ollamaInferenceStream(loaded: LoadedModel, request: InferenceRequest): AsyncGenerator<string> {
    const modelName = loaded.model.source?.replace("ollama:", "") || loaded.model.name;
    
    const body: Record<string, unknown> = {
      model: modelName,
      stream: true,
      options: {
        temperature: request.temperature ?? 0.7,
        top_p: request.topP ?? 0.9,
        num_predict: request.maxTokens ?? 1024,
      },
    };
    
    if (request.messages) {
      body.messages = request.messages;
    } else {
      body.prompt = request.prompt;
    }
    
    const endpoint = request.messages ? "/api/chat" : "/api/generate";
    const response = await fetch(`http://localhost:11434${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      throw new Error(`Ollama stream failed: ${response.statusText}`);
    }
    
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");
    
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const text = decoder.decode(value);
      for (const line of text.split("\n").filter(Boolean)) {
        try {
          const data = JSON.parse(line);
          const content = data.message?.content || data.response || "";
          if (content) {
            yield content;
          }
        } catch {}
      }
    }
  }
  
  /**
   * Generate embeddings
   */
  async embed(modelId: ModelId, texts: string[]): Promise<number[][]> {
    const loaded = this.loadedModels.get(modelId);
    if (!loaded) {
      throw new Error(`Model not loaded: ${modelId}`);
    }
    
    if (!loaded.model.capabilities.embedding) {
      throw new Error(`Model does not support embeddings: ${modelId}`);
    }
    
    if (loaded.backend === "ollama") {
      const embeddings: number[][] = [];
      
      for (const text of texts) {
        const response = await fetch("http://localhost:11434/api/embeddings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: loaded.model.source?.replace("ollama:", "") || loaded.model.name,
            prompt: text,
          }),
        });
        
        if (!response.ok) {
          throw new Error(`Embedding failed: ${response.statusText}`);
        }
        
        const data = await response.json();
        embeddings.push(data.embedding);
      }
      
      return embeddings;
    }
    
    throw new Error(`Embeddings not supported for backend: ${loaded.backend}`);
  }
  
  // ===========================================================================
  // HELPERS
  // ===========================================================================
  
  private formatChatPrompt(messages: ChatMessage[], systemPrompt?: string): string {
    let prompt = "";
    
    if (systemPrompt) {
      prompt += `<|system|>\n${systemPrompt}</s>\n`;
    }
    
    for (const msg of messages) {
      prompt += `<|${msg.role}|>\n${msg.content}</s>\n`;
    }
    
    prompt += "<|assistant|>\n";
    return prompt;
  }
  
  private async downloadFile(
    url: string,
    destPath: string,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`);
    }
    
    const totalSize = parseInt(response.headers.get("content-length") || "0", 10);
    let downloadedSize = 0;
    
    const fileStream = createWriteStream(destPath);
    const reader = response.body?.getReader();
    
    if (!reader) throw new Error("No response body");
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      fileStream.write(value);
      downloadedSize += value.length;
      
      if (totalSize && onProgress) {
        onProgress((downloadedSize / totalSize) * 100);
      }
    }
    
    fileStream.close();
  }
  
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
  
  private getSizeCategory(bytes: number): "tiny" | "small" | "medium" | "large" | "xl" {
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb < 1) return "tiny";
    if (gb < 4) return "small";
    if (gb < 8) return "medium";
    if (gb < 20) return "large";
    return "xl";
  }
  
  private getSizeFromParams(params: number): "tiny" | "small" | "medium" | "large" | "xl" {
    const billions = params / 1_000_000_000;
    if (billions < 1) return "tiny";
    if (billions < 4) return "small";
    if (billions < 10) return "medium";
    if (billions < 30) return "large";
    return "xl";
  }
  
  private parseParameterCount(size: string | undefined): number {
    if (!size) return 0;
    const match = size.match(/([\d.]+)([BM])/i);
    if (!match) return 0;
    const num = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    return unit === "B" ? num * 1_000_000_000 : num * 1_000_000;
  }
  
  /**
   * Delete a model
   */
  async deleteModel(modelId: ModelId): Promise<void> {
    await this.unloadModel(modelId);
    
    const model = this.models.get(modelId);
    if (model?.path && existsSync(model.path)) {
      await fs.rm(model.path, { recursive: true, force: true });
    }
    
    this.models.delete(modelId);
    this.emit("model:deleted", { modelId });
  }
  
  /**
   * Shutdown manager
   */
  async shutdown(): Promise<void> {
    // Unload all models
    for (const modelId of this.loadedModels.keys()) {
      await this.unloadModel(modelId);
    }
    
    // Kill all llama.cpp processes
    for (const proc of this.llamaCppProcesses.values()) {
      proc.kill();
    }
    this.llamaCppProcesses.clear();
  }
}

// Internal type for loaded model tracking
interface LoadedModel {
  model: LocalModel;
  backend: ModelBackend;
  config: ModelLoadConfig;
  serverUrl?: string;
}

// Export singleton
export const localModelManager = new LocalModelManager();
