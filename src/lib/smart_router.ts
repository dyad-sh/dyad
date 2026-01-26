/**
 * Smart Router - Intelligent AI Request Routing System
 * 
 * Automatically routes requests between local models and cloud APIs based on:
 * - Task complexity
 * - Cost optimization
 * - Latency requirements
 * - Privacy constraints
 * - Model capabilities
 * - Network availability
 * - User preferences
 * 
 * This makes JoyCreate the most intelligent AI tool available - using local
 * resources when possible, and seamlessly falling back to powerful cloud
 * APIs only when needed for complex tasks.
 */

import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import { app } from "electron";
import log from "electron-log";
import { EventEmitter } from "events";

const logger = log.scope("smart_router");

// =============================================================================
// TYPES
// =============================================================================

export interface RoutingContext {
  taskType: TaskType;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  requiresVision?: boolean;
  requiresTools?: boolean;
  requiresStreaming?: boolean;
  privacyLevel: PrivacyLevel;
  budgetCents?: number;
  maxLatencyMs?: number;
  preferredProviders?: string[];
  excludedProviders?: string[];
  metadata?: Record<string, unknown>;
}

export type TaskType = 
  | "chat"
  | "completion"
  | "code_generation"
  | "code_review"
  | "summarization"
  | "translation"
  | "extraction"
  | "classification"
  | "embedding"
  | "image_generation"
  | "image_analysis"
  | "audio_transcription"
  | "audio_generation"
  | "reasoning"
  | "math"
  | "creative_writing"
  | "agent"
  | "function_calling"
  | "rag"
  | "fine_tuned";

export type PrivacyLevel = 
  | "public"       // Any provider OK
  | "standard"     // Major cloud providers OK
  | "sensitive"    // Only trusted providers
  | "private"      // Local only, no cloud
  | "air_gapped";  // No network at all

export type ProviderType = "local" | "cloud" | "p2p" | "hybrid";

export interface AIProvider {
  id: string;
  name: string;
  type: ProviderType;
  models: ProviderModel[];
  capabilities: ProviderCapabilities;
  pricing: ProviderPricing;
  status: ProviderStatus;
  priority: number;
  trustLevel: number; // 0-100, higher = more trusted
  metadata?: Record<string, unknown>;
}

export interface ProviderModel {
  id: string;
  name: string;
  contextLength: number;
  capabilities: ModelCapabilities;
  performance: ModelPerformance;
  pricing?: ModelPricing;
}

export interface ProviderCapabilities {
  chat: boolean;
  completion: boolean;
  embedding: boolean;
  vision: boolean;
  tools: boolean;
  streaming: boolean;
  json_mode: boolean;
  fine_tuning: boolean;
  image_generation: boolean;
  audio: boolean;
}

export interface ModelCapabilities {
  reasoning: number;      // 0-100
  coding: number;         // 0-100
  creativity: number;     // 0-100
  math: number;           // 0-100
  multilingual: number;   // 0-100
  factuality: number;     // 0-100
  instruction_following: number; // 0-100
}

export interface ModelPerformance {
  avgLatencyMs: number;
  tokensPerSecond: number;
  reliability: number;    // 0-100
  uptime: number;         // 0-100
}

export interface ProviderPricing {
  inputPer1kTokens: number;  // in cents
  outputPer1kTokens: number; // in cents
  imagePerRequest?: number;
  audioPerMinute?: number;
  freeQuota?: number;
}

export interface ModelPricing {
  inputPer1kTokens: number;
  outputPer1kTokens: number;
}

export type ProviderStatus = "online" | "offline" | "degraded" | "rate_limited" | "unknown";

export interface RoutingDecision {
  providerId: string;
  modelId: string;
  reason: string;
  confidence: number;      // 0-100
  estimatedCost: number;   // in cents
  estimatedLatency: number; // in ms
  fallbacks: RoutingDecision[];
  metadata?: Record<string, unknown>;
}

export interface RoutingResult {
  success: boolean;
  decision: RoutingDecision;
  actualProvider: string;
  actualModel: string;
  latencyMs: number;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  usedFallback: boolean;
  fallbackReason?: string;
}

export interface RouterConfig {
  defaultPrivacyLevel: PrivacyLevel;
  preferLocal: boolean;
  maxCostPerRequestCents: number;
  maxLatencyMs: number;
  enableTelemetry: boolean;
  cacheDurationMs: number;
  retryAttempts: number;
  costOptimization: "aggressive" | "balanced" | "quality";
  loadBalancing: "round_robin" | "least_latency" | "least_cost" | "capability_match";
}

export interface RoutingStats {
  totalRequests: number;
  localRequests: number;
  cloudRequests: number;
  p2pRequests: number;
  totalCostCents: number;
  avgLatencyMs: number;
  successRate: number;
  fallbackRate: number;
  costSavings: number; // compared to always using cloud
  providerStats: Map<string, ProviderStats>;
}

export interface ProviderStats {
  requests: number;
  successes: number;
  failures: number;
  totalLatencyMs: number;
  totalCostCents: number;
}

// =============================================================================
// COMPLEXITY ANALYZER
// =============================================================================

class ComplexityAnalyzer {
  private tokenPatterns = {
    code: /```[\s\S]*?```|`[^`]+`|function\s+\w+|class\s+\w+|const\s+\w+|let\s+\w+|import\s+|export\s+/gi,
    math: /\$[\s\S]*?\$|\\\[[\s\S]*?\\\]|∑|∫|∂|√|∞|\d+[\+\-\*\/\^]\d+/gi,
    reasoning: /explain|why|how|analyze|compare|contrast|evaluate|assess|reason|think through/gi,
    creative: /write|create|compose|generate|imagine|story|poem|narrative|fiction/gi,
    factual: /what is|who is|when did|where is|define|list|name|identify/gi,
    multiStep: /first|then|next|after that|finally|step \d+|1\.|2\.|3\./gi,
  };

  analyzeComplexity(prompt: string): {
    score: number;
    factors: Record<string, number>;
    recommendedCapabilities: Partial<ModelCapabilities>;
  } {
    const wordCount = prompt.split(/\s+/).length;
    const sentenceCount = prompt.split(/[.!?]+/).length;
    
    const factors: Record<string, number> = {
      length: Math.min(wordCount / 500, 1) * 20,
      codePresence: this.countMatches(prompt, this.tokenPatterns.code) * 5,
      mathPresence: this.countMatches(prompt, this.tokenPatterns.math) * 8,
      reasoningRequired: this.countMatches(prompt, this.tokenPatterns.reasoning) * 6,
      creativityRequired: this.countMatches(prompt, this.tokenPatterns.creative) * 4,
      factualQuery: this.countMatches(prompt, this.tokenPatterns.factual) * 2,
      multiStep: this.countMatches(prompt, this.tokenPatterns.multiStep) * 5,
      questionCount: (prompt.match(/\?/g) || []).length * 3,
      nestedStructure: this.analyzeNesting(prompt) * 10,
    };

    const score = Math.min(
      Object.values(factors).reduce((a, b) => a + b, 0),
      100
    );

    const recommendedCapabilities: Partial<ModelCapabilities> = {};
    if (factors.codePresence > 10) recommendedCapabilities.coding = 70;
    if (factors.mathPresence > 10) recommendedCapabilities.math = 80;
    if (factors.reasoningRequired > 10) recommendedCapabilities.reasoning = 75;
    if (factors.creativityRequired > 5) recommendedCapabilities.creativity = 60;
    if (factors.factualQuery > 5) recommendedCapabilities.factuality = 70;

    return { score, factors, recommendedCapabilities };
  }

  private countMatches(text: string, pattern: RegExp): number {
    const matches = text.match(pattern);
    return matches ? matches.length : 0;
  }

  private analyzeNesting(text: string): number {
    let maxNesting = 0;
    let current = 0;
    const openers = ['(', '[', '{', '<'];
    const closers = [')', ']', '}', '>'];
    
    for (const char of text) {
      if (openers.includes(char)) {
        current++;
        maxNesting = Math.max(maxNesting, current);
      } else if (closers.includes(char)) {
        current = Math.max(0, current - 1);
      }
    }
    
    return maxNesting;
  }

  estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }
}

// =============================================================================
// SMART ROUTER
// =============================================================================

export class SmartRouter extends EventEmitter {
  private configPath: string;
  private statsPath: string;
  private providers: Map<string, AIProvider> = new Map();
  private config: RouterConfig;
  private stats: RoutingStats;
  private complexityAnalyzer: ComplexityAnalyzer;
  private decisionCache: Map<string, { decision: RoutingDecision; timestamp: number }> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    const dataDir = path.join(app.getPath("userData"), "smart_router");
    this.configPath = path.join(dataDir, "config.json");
    this.statsPath = path.join(dataDir, "stats.json");
    this.complexityAnalyzer = new ComplexityAnalyzer();
    
    this.config = this.getDefaultConfig();
    this.stats = this.getInitialStats();
  }

  private getDefaultConfig(): RouterConfig {
    return {
      defaultPrivacyLevel: "standard",
      preferLocal: true,
      maxCostPerRequestCents: 50,
      maxLatencyMs: 30000,
      enableTelemetry: true,
      cacheDurationMs: 60000,
      retryAttempts: 3,
      costOptimization: "balanced",
      loadBalancing: "capability_match",
    };
  }

  private getInitialStats(): RoutingStats {
    return {
      totalRequests: 0,
      localRequests: 0,
      cloudRequests: 0,
      p2pRequests: 0,
      totalCostCents: 0,
      avgLatencyMs: 0,
      successRate: 100,
      fallbackRate: 0,
      costSavings: 0,
      providerStats: new Map(),
    };
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  async initialize(): Promise<void> {
    logger.info("Initializing Smart Router");
    
    const dataDir = path.dirname(this.configPath);
    await fs.mkdir(dataDir, { recursive: true });
    
    await this.loadConfig();
    await this.loadStats();
    await this.initializeDefaultProviders();
    
    // Start health checks
    this.healthCheckInterval = setInterval(() => this.checkProviderHealth(), 60000);
    
    logger.info("Smart Router initialized", {
      providers: this.providers.size,
      config: this.config,
    });
  }

  private async loadConfig(): Promise<void> {
    if (existsSync(this.configPath)) {
      try {
        const data = await fs.readFile(this.configPath, "utf-8");
        this.config = { ...this.config, ...JSON.parse(data) };
      } catch (error) {
        logger.warn("Failed to load router config", { error });
      }
    }
  }

  private async loadStats(): Promise<void> {
    if (existsSync(this.statsPath)) {
      try {
        const data = await fs.readFile(this.statsPath, "utf-8");
        const loaded = JSON.parse(data);
        this.stats = {
          ...loaded,
          providerStats: new Map(Object.entries(loaded.providerStats || {})),
        };
      } catch (error) {
        logger.warn("Failed to load router stats", { error });
      }
    }
  }

  private async saveConfig(): Promise<void> {
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
  }

  private async saveStats(): Promise<void> {
    const toSave = {
      ...this.stats,
      providerStats: Object.fromEntries(this.stats.providerStats),
    };
    await fs.writeFile(this.statsPath, JSON.stringify(toSave, null, 2));
  }

  private async initializeDefaultProviders(): Promise<void> {
    // Local providers (always available)
    this.registerProvider({
      id: "ollama",
      name: "Ollama (Local)",
      type: "local",
      models: [
        {
          id: "llama3.2",
          name: "Llama 3.2 (8B)",
          contextLength: 128000,
          capabilities: { reasoning: 75, coding: 70, creativity: 65, math: 60, multilingual: 70, factuality: 70, instruction_following: 80 },
          performance: { avgLatencyMs: 2000, tokensPerSecond: 30, reliability: 99, uptime: 99 },
        },
        {
          id: "codellama",
          name: "CodeLlama (7B)",
          contextLength: 16000,
          capabilities: { reasoning: 65, coding: 85, creativity: 40, math: 55, multilingual: 50, factuality: 60, instruction_following: 75 },
          performance: { avgLatencyMs: 1500, tokensPerSecond: 40, reliability: 99, uptime: 99 },
        },
        {
          id: "mistral",
          name: "Mistral (7B)",
          contextLength: 32000,
          capabilities: { reasoning: 70, coding: 70, creativity: 65, math: 60, multilingual: 75, factuality: 70, instruction_following: 78 },
          performance: { avgLatencyMs: 1800, tokensPerSecond: 35, reliability: 99, uptime: 99 },
        },
        {
          id: "deepseek-coder",
          name: "DeepSeek Coder",
          contextLength: 16000,
          capabilities: { reasoning: 65, coding: 90, creativity: 35, math: 70, multilingual: 40, factuality: 65, instruction_following: 75 },
          performance: { avgLatencyMs: 2000, tokensPerSecond: 30, reliability: 99, uptime: 99 },
        },
        {
          id: "qwen2.5",
          name: "Qwen 2.5 (7B)",
          contextLength: 32000,
          capabilities: { reasoning: 72, coding: 75, creativity: 60, math: 70, multilingual: 85, factuality: 72, instruction_following: 80 },
          performance: { avgLatencyMs: 1900, tokensPerSecond: 32, reliability: 99, uptime: 99 },
        },
      ],
      capabilities: { chat: true, completion: true, embedding: true, vision: false, tools: true, streaming: true, json_mode: true, fine_tuning: false, image_generation: false, audio: false },
      pricing: { inputPer1kTokens: 0, outputPer1kTokens: 0, freeQuota: Infinity },
      status: "unknown",
      priority: 100,
      trustLevel: 100, // Full trust for local
    });

    this.registerProvider({
      id: "llamacpp",
      name: "llama.cpp (Local)",
      type: "local",
      models: [
        {
          id: "local-gguf",
          name: "Custom GGUF Model",
          contextLength: 4096,
          capabilities: { reasoning: 65, coding: 60, creativity: 55, math: 50, multilingual: 50, factuality: 60, instruction_following: 70 },
          performance: { avgLatencyMs: 3000, tokensPerSecond: 20, reliability: 99, uptime: 99 },
        },
      ],
      capabilities: { chat: true, completion: true, embedding: true, vision: false, tools: false, streaming: true, json_mode: false, fine_tuning: false, image_generation: false, audio: false },
      pricing: { inputPer1kTokens: 0, outputPer1kTokens: 0, freeQuota: Infinity },
      status: "unknown",
      priority: 90,
      trustLevel: 100,
    });

    // Cloud providers
    this.registerProvider({
      id: "openai",
      name: "OpenAI",
      type: "cloud",
      models: [
        {
          id: "gpt-4o",
          name: "GPT-4o",
          contextLength: 128000,
          capabilities: { reasoning: 95, coding: 92, creativity: 90, math: 88, multilingual: 95, factuality: 90, instruction_following: 95 },
          performance: { avgLatencyMs: 1500, tokensPerSecond: 80, reliability: 99, uptime: 99 },
          pricing: { inputPer1kTokens: 0.25, outputPer1kTokens: 1.0 },
        },
        {
          id: "gpt-4o-mini",
          name: "GPT-4o Mini",
          contextLength: 128000,
          capabilities: { reasoning: 82, coding: 80, creativity: 78, math: 75, multilingual: 85, factuality: 80, instruction_following: 85 },
          performance: { avgLatencyMs: 800, tokensPerSecond: 120, reliability: 99, uptime: 99 },
          pricing: { inputPer1kTokens: 0.015, outputPer1kTokens: 0.06 },
        },
        {
          id: "o1",
          name: "OpenAI o1",
          contextLength: 200000,
          capabilities: { reasoning: 99, coding: 95, creativity: 85, math: 98, multilingual: 90, factuality: 95, instruction_following: 90 },
          performance: { avgLatencyMs: 15000, tokensPerSecond: 20, reliability: 98, uptime: 99 },
          pricing: { inputPer1kTokens: 1.5, outputPer1kTokens: 6.0 },
        },
        {
          id: "o1-mini",
          name: "OpenAI o1-mini",
          contextLength: 128000,
          capabilities: { reasoning: 92, coding: 90, creativity: 75, math: 95, multilingual: 80, factuality: 88, instruction_following: 85 },
          performance: { avgLatencyMs: 8000, tokensPerSecond: 30, reliability: 98, uptime: 99 },
          pricing: { inputPer1kTokens: 0.3, outputPer1kTokens: 1.2 },
        },
      ],
      capabilities: { chat: true, completion: true, embedding: true, vision: true, tools: true, streaming: true, json_mode: true, fine_tuning: true, image_generation: true, audio: true },
      pricing: { inputPer1kTokens: 0.015, outputPer1kTokens: 0.06, imagePerRequest: 4, audioPerMinute: 0.6 },
      status: "unknown",
      priority: 80,
      trustLevel: 85,
    });

    this.registerProvider({
      id: "anthropic",
      name: "Anthropic",
      type: "cloud",
      models: [
        {
          id: "claude-3-5-sonnet",
          name: "Claude 3.5 Sonnet",
          contextLength: 200000,
          capabilities: { reasoning: 94, coding: 93, creativity: 92, math: 85, multilingual: 92, factuality: 92, instruction_following: 95 },
          performance: { avgLatencyMs: 1200, tokensPerSecond: 90, reliability: 99, uptime: 99 },
          pricing: { inputPer1kTokens: 0.3, outputPer1kTokens: 1.5 },
        },
        {
          id: "claude-3-5-haiku",
          name: "Claude 3.5 Haiku",
          contextLength: 200000,
          capabilities: { reasoning: 80, coding: 78, creativity: 75, math: 70, multilingual: 80, factuality: 78, instruction_following: 82 },
          performance: { avgLatencyMs: 600, tokensPerSecond: 150, reliability: 99, uptime: 99 },
          pricing: { inputPer1kTokens: 0.08, outputPer1kTokens: 0.4 },
        },
        {
          id: "claude-3-opus",
          name: "Claude 3 Opus",
          contextLength: 200000,
          capabilities: { reasoning: 96, coding: 94, creativity: 95, math: 88, multilingual: 94, factuality: 94, instruction_following: 96 },
          performance: { avgLatencyMs: 3000, tokensPerSecond: 50, reliability: 98, uptime: 99 },
          pricing: { inputPer1kTokens: 1.5, outputPer1kTokens: 7.5 },
        },
      ],
      capabilities: { chat: true, completion: true, embedding: false, vision: true, tools: true, streaming: true, json_mode: true, fine_tuning: false, image_generation: false, audio: false },
      pricing: { inputPer1kTokens: 0.08, outputPer1kTokens: 0.4 },
      status: "unknown",
      priority: 85,
      trustLevel: 90,
    });

    this.registerProvider({
      id: "google",
      name: "Google AI",
      type: "cloud",
      models: [
        {
          id: "gemini-2.0-flash",
          name: "Gemini 2.0 Flash",
          contextLength: 1000000,
          capabilities: { reasoning: 88, coding: 85, creativity: 82, math: 85, multilingual: 92, factuality: 85, instruction_following: 88 },
          performance: { avgLatencyMs: 800, tokensPerSecond: 150, reliability: 98, uptime: 99 },
          pricing: { inputPer1kTokens: 0.01, outputPer1kTokens: 0.04 },
        },
        {
          id: "gemini-1.5-pro",
          name: "Gemini 1.5 Pro",
          contextLength: 2000000,
          capabilities: { reasoning: 90, coding: 88, creativity: 85, math: 88, multilingual: 95, factuality: 88, instruction_following: 90 },
          performance: { avgLatencyMs: 1500, tokensPerSecond: 80, reliability: 98, uptime: 99 },
          pricing: { inputPer1kTokens: 0.125, outputPer1kTokens: 0.5 },
        },
      ],
      capabilities: { chat: true, completion: true, embedding: true, vision: true, tools: true, streaming: true, json_mode: true, fine_tuning: true, image_generation: true, audio: true },
      pricing: { inputPer1kTokens: 0.01, outputPer1kTokens: 0.04, imagePerRequest: 2 },
      status: "unknown",
      priority: 75,
      trustLevel: 80,
    });

    this.registerProvider({
      id: "deepseek",
      name: "DeepSeek",
      type: "cloud",
      models: [
        {
          id: "deepseek-chat",
          name: "DeepSeek Chat",
          contextLength: 64000,
          capabilities: { reasoning: 85, coding: 88, creativity: 70, math: 85, multilingual: 75, factuality: 80, instruction_following: 82 },
          performance: { avgLatencyMs: 1000, tokensPerSecond: 100, reliability: 97, uptime: 98 },
          pricing: { inputPer1kTokens: 0.014, outputPer1kTokens: 0.028 },
        },
        {
          id: "deepseek-reasoner",
          name: "DeepSeek R1",
          contextLength: 64000,
          capabilities: { reasoning: 95, coding: 92, creativity: 65, math: 96, multilingual: 70, factuality: 88, instruction_following: 85 },
          performance: { avgLatencyMs: 5000, tokensPerSecond: 40, reliability: 97, uptime: 98 },
          pricing: { inputPer1kTokens: 0.055, outputPer1kTokens: 0.22 },
        },
      ],
      capabilities: { chat: true, completion: true, embedding: false, vision: false, tools: true, streaming: true, json_mode: true, fine_tuning: false, image_generation: false, audio: false },
      pricing: { inputPer1kTokens: 0.014, outputPer1kTokens: 0.028 },
      status: "unknown",
      priority: 70,
      trustLevel: 70,
    });

    this.registerProvider({
      id: "groq",
      name: "Groq",
      type: "cloud",
      models: [
        {
          id: "llama-3.3-70b-versatile",
          name: "Llama 3.3 70B",
          contextLength: 128000,
          capabilities: { reasoning: 85, coding: 82, creativity: 78, math: 75, multilingual: 80, factuality: 82, instruction_following: 85 },
          performance: { avgLatencyMs: 300, tokensPerSecond: 500, reliability: 98, uptime: 99 },
          pricing: { inputPer1kTokens: 0.059, outputPer1kTokens: 0.079 },
        },
        {
          id: "mixtral-8x7b",
          name: "Mixtral 8x7B",
          contextLength: 32000,
          capabilities: { reasoning: 75, coding: 72, creativity: 70, math: 68, multilingual: 80, factuality: 72, instruction_following: 78 },
          performance: { avgLatencyMs: 200, tokensPerSecond: 600, reliability: 98, uptime: 99 },
          pricing: { inputPer1kTokens: 0.024, outputPer1kTokens: 0.024 },
        },
      ],
      capabilities: { chat: true, completion: true, embedding: false, vision: false, tools: true, streaming: true, json_mode: true, fine_tuning: false, image_generation: false, audio: false },
      pricing: { inputPer1kTokens: 0.024, outputPer1kTokens: 0.024 },
      status: "unknown",
      priority: 72,
      trustLevel: 75,
    });

    // P2P providers (JCN network)
    this.registerProvider({
      id: "jcn-network",
      name: "JCN P2P Network",
      type: "p2p",
      models: [
        {
          id: "jcn-inference",
          name: "JCN Distributed Inference",
          contextLength: 32000,
          capabilities: { reasoning: 70, coding: 70, creativity: 60, math: 60, multilingual: 60, factuality: 65, instruction_following: 72 },
          performance: { avgLatencyMs: 3000, tokensPerSecond: 25, reliability: 90, uptime: 85 },
        },
      ],
      capabilities: { chat: true, completion: true, embedding: true, vision: false, tools: false, streaming: true, json_mode: false, fine_tuning: false, image_generation: true, audio: false },
      pricing: { inputPer1kTokens: 0.001, outputPer1kTokens: 0.002 },
      status: "unknown",
      priority: 60,
      trustLevel: 95, // Trustless verification
    });
  }

  // ===========================================================================
  // PROVIDER MANAGEMENT
  // ===========================================================================

  registerProvider(provider: AIProvider): void {
    this.providers.set(provider.id, provider);
    this.emit("provider:registered", provider);
    logger.info("Provider registered", { id: provider.id, name: provider.name });
  }

  unregisterProvider(providerId: string): void {
    this.providers.delete(providerId);
    this.emit("provider:unregistered", { providerId });
  }

  getProvider(providerId: string): AIProvider | undefined {
    return this.providers.get(providerId);
  }

  listProviders(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  async updateProviderStatus(providerId: string, status: ProviderStatus): Promise<void> {
    const provider = this.providers.get(providerId);
    if (provider) {
      provider.status = status;
      this.emit("provider:status-changed", { providerId, status });
    }
  }

  // ===========================================================================
  // ROUTING LOGIC
  // ===========================================================================

  async route(context: RoutingContext): Promise<RoutingDecision> {
    // Check cache first
    const cacheKey = this.getCacheKey(context);
    const cached = this.decisionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.config.cacheDurationMs) {
      return cached.decision;
    }

    // Analyze request complexity
    const complexity = this.complexityAnalyzer.analyzeComplexity(context.prompt);
    const estimatedTokens = this.complexityAnalyzer.estimateTokens(context.prompt);
    
    logger.debug("Routing request", {
      taskType: context.taskType,
      complexity: complexity.score,
      estimatedTokens,
      privacyLevel: context.privacyLevel,
    });

    // Get eligible providers
    const eligible = this.getEligibleProviders(context, complexity);
    
    if (eligible.length === 0) {
      throw new Error("No eligible providers found for this request");
    }

    // Score and rank providers
    const scored = eligible.map(({ provider, model }) => ({
      provider,
      model,
      score: this.scoreProviderModel(provider, model, context, complexity),
    }));

    scored.sort((a, b) => b.score - a.score);

    // Build decision
    const best = scored[0];
    const fallbacks = scored.slice(1, 4).map(s => this.buildDecision(s, context, estimatedTokens));

    const decision = this.buildDecision(best, context, estimatedTokens, fallbacks);

    // Cache decision
    this.decisionCache.set(cacheKey, { decision, timestamp: Date.now() });

    this.emit("routing:decided", { context, decision, complexity });

    return decision;
  }

  private getCacheKey(context: RoutingContext): string {
    return crypto.createHash("md5")
      .update(JSON.stringify({
        taskType: context.taskType,
        promptHash: crypto.createHash("md5").update(context.prompt).digest("hex"),
        privacyLevel: context.privacyLevel,
        requiresVision: context.requiresVision,
        requiresTools: context.requiresTools,
      }))
      .digest("hex");
  }

  private getEligibleProviders(
    context: RoutingContext,
    complexity: ReturnType<ComplexityAnalyzer["analyzeComplexity"]>
  ): Array<{ provider: AIProvider; model: ProviderModel }> {
    const eligible: Array<{ provider: AIProvider; model: ProviderModel }> = [];
    const privacyLevel = context.privacyLevel || this.config.defaultPrivacyLevel;

    for (const provider of this.providers.values()) {
      // Privacy filter
      if (!this.meetsPrivacyRequirements(provider, privacyLevel)) {
        continue;
      }

      // Status filter
      if (provider.status === "offline") {
        continue;
      }

      // Exclusion filter
      if (context.excludedProviders?.includes(provider.id)) {
        continue;
      }

      // Capability filter
      if (context.requiresVision && !provider.capabilities.vision) continue;
      if (context.requiresTools && !provider.capabilities.tools) continue;
      if (context.requiresStreaming && !provider.capabilities.streaming) continue;

      // Find best model from this provider
      for (const model of provider.models) {
        // Context length check
        const estimatedTokens = this.complexityAnalyzer.estimateTokens(context.prompt);
        if (model.contextLength < estimatedTokens * 2) {
          continue;
        }

        // Capability match
        if (this.modelMeetsCapabilities(model, complexity.recommendedCapabilities)) {
          eligible.push({ provider, model });
        }
      }
    }

    return eligible;
  }

  private meetsPrivacyRequirements(provider: AIProvider, privacyLevel: PrivacyLevel): boolean {
    switch (privacyLevel) {
      case "air_gapped":
        return provider.type === "local";
      case "private":
        return provider.type === "local";
      case "sensitive":
        return provider.trustLevel >= 90;
      case "standard":
        return provider.trustLevel >= 70;
      case "public":
        return true;
      default:
        return true;
    }
  }

  private modelMeetsCapabilities(
    model: ProviderModel,
    required: Partial<ModelCapabilities>
  ): boolean {
    for (const [capability, minValue] of Object.entries(required)) {
      const modelValue = model.capabilities[capability as keyof ModelCapabilities];
      if (modelValue !== undefined && modelValue < (minValue as number) * 0.7) {
        return false;
      }
    }
    return true;
  }

  private scoreProviderModel(
    provider: AIProvider,
    model: ProviderModel,
    context: RoutingContext,
    complexity: ReturnType<ComplexityAnalyzer["analyzeComplexity"]>
  ): number {
    let score = 0;

    // Base priority score
    score += provider.priority;

    // Capability match score (0-100)
    const capabilityScore = this.calculateCapabilityMatch(model, complexity.recommendedCapabilities);
    score += capabilityScore * 0.5;

    // Cost score (0-50, higher for cheaper)
    const estimatedCost = this.estimateCost(provider, model, context);
    if (context.budgetCents && estimatedCost > context.budgetCents) {
      score -= 100; // Heavy penalty for over budget
    } else if (provider.type === "local") {
      score += 50; // Bonus for free local
    } else {
      score += Math.max(0, 50 - estimatedCost);
    }

    // Latency score (0-30)
    const estimatedLatency = model.performance.avgLatencyMs;
    if (context.maxLatencyMs && estimatedLatency > context.maxLatencyMs) {
      score -= 50; // Penalty for too slow
    } else {
      score += Math.max(0, 30 - (estimatedLatency / 1000));
    }

    // Trust score (0-30)
    score += provider.trustLevel * 0.3;

    // Prefer local if configured
    if (this.config.preferLocal && provider.type === "local") {
      score += 30;
    }

    // Reliability bonus
    score += model.performance.reliability * 0.2;

    // Complexity-based scoring
    if (complexity.score > 70 && provider.type === "cloud") {
      score += 20; // Complex tasks benefit from cloud
    }
    if (complexity.score < 30 && provider.type === "local") {
      score += 20; // Simple tasks fine for local
    }

    // Preferred provider bonus
    if (context.preferredProviders?.includes(provider.id)) {
      score += 50;
    }

    return score;
  }

  private calculateCapabilityMatch(
    model: ProviderModel,
    required: Partial<ModelCapabilities>
  ): number {
    if (Object.keys(required).length === 0) return 80;

    let total = 0;
    let count = 0;

    for (const [capability, minValue] of Object.entries(required)) {
      const modelValue = model.capabilities[capability as keyof ModelCapabilities];
      if (modelValue !== undefined) {
        total += Math.min(100, (modelValue / (minValue as number)) * 100);
        count++;
      }
    }

    return count > 0 ? total / count : 80;
  }

  private estimateCost(
    provider: AIProvider,
    model: ProviderModel,
    context: RoutingContext
  ): number {
    if (provider.type === "local") return 0;

    const inputTokens = this.complexityAnalyzer.estimateTokens(context.prompt);
    const outputTokens = context.maxTokens || inputTokens * 2;

    const pricing = model.pricing || provider.pricing;
    const inputCost = (inputTokens / 1000) * pricing.inputPer1kTokens;
    const outputCost = (outputTokens / 1000) * pricing.outputPer1kTokens;

    return inputCost + outputCost;
  }

  private buildDecision(
    scored: { provider: AIProvider; model: ProviderModel; score: number },
    context: RoutingContext,
    estimatedTokens: number,
    fallbacks: RoutingDecision[] = []
  ): RoutingDecision {
    const { provider, model, score } = scored;
    const estimatedCost = this.estimateCost(provider, model, context);

    return {
      providerId: provider.id,
      modelId: model.id,
      reason: this.generateReason(provider, model, context, score),
      confidence: Math.min(100, Math.max(0, score)),
      estimatedCost,
      estimatedLatency: model.performance.avgLatencyMs,
      fallbacks,
    };
  }

  private generateReason(
    provider: AIProvider,
    model: ProviderModel,
    context: RoutingContext,
    score: number
  ): string {
    const reasons: string[] = [];

    if (provider.type === "local") {
      reasons.push("Local model for privacy and zero cost");
    }

    if (context.privacyLevel === "private" || context.privacyLevel === "air_gapped") {
      reasons.push("Privacy requirements met");
    }

    if (context.requiresVision) {
      reasons.push("Vision capabilities required");
    }

    if (context.requiresTools) {
      reasons.push("Tool use supported");
    }

    if (score > 150) {
      reasons.push("Best capability match");
    } else if (score > 100) {
      reasons.push("Good balance of capability and cost");
    } else {
      reasons.push("Available option");
    }

    return reasons.join("; ");
  }

  // ===========================================================================
  // EXECUTION
  // ===========================================================================

  async recordResult(result: RoutingResult): Promise<void> {
    this.stats.totalRequests++;
    
    const provider = this.providers.get(result.actualProvider);
    if (provider) {
      switch (provider.type) {
        case "local":
          this.stats.localRequests++;
          break;
        case "cloud":
          this.stats.cloudRequests++;
          break;
        case "p2p":
          this.stats.p2pRequests++;
          break;
      }
    }

    this.stats.totalCostCents += result.costCents;
    this.stats.avgLatencyMs = (this.stats.avgLatencyMs * (this.stats.totalRequests - 1) + result.latencyMs) / this.stats.totalRequests;

    if (result.usedFallback) {
      this.stats.fallbackRate = ((this.stats.fallbackRate * (this.stats.totalRequests - 1)) + 100) / this.stats.totalRequests;
    }

    if (!result.success) {
      this.stats.successRate = ((this.stats.successRate * (this.stats.totalRequests - 1))) / this.stats.totalRequests;
    }

    // Update provider stats
    if (!this.stats.providerStats.has(result.actualProvider)) {
      this.stats.providerStats.set(result.actualProvider, {
        requests: 0,
        successes: 0,
        failures: 0,
        totalLatencyMs: 0,
        totalCostCents: 0,
      });
    }

    const providerStats = this.stats.providerStats.get(result.actualProvider)!;
    providerStats.requests++;
    if (result.success) {
      providerStats.successes++;
    } else {
      providerStats.failures++;
    }
    providerStats.totalLatencyMs += result.latencyMs;
    providerStats.totalCostCents += result.costCents;

    // Calculate cost savings (compared to using GPT-4o for everything)
    const hypotheticalCloudCost = ((result.inputTokens + result.outputTokens) / 1000) * 1.25;
    this.stats.costSavings += Math.max(0, hypotheticalCloudCost - result.costCents);

    this.emit("result:recorded", result);

    // Periodically save stats
    if (this.stats.totalRequests % 10 === 0) {
      await this.saveStats();
    }
  }

  // ===========================================================================
  // HEALTH CHECKS
  // ===========================================================================

  private async checkProviderHealth(): Promise<void> {
    for (const provider of this.providers.values()) {
      try {
        const isHealthy = await this.pingProvider(provider);
        await this.updateProviderStatus(
          provider.id,
          isHealthy ? "online" : "offline"
        );
      } catch (error) {
        await this.updateProviderStatus(provider.id, "unknown");
      }
    }
  }

  private async pingProvider(provider: AIProvider): Promise<boolean> {
    // Implementation would ping the actual provider
    // For now, assume all registered providers are online
    return true;
  }

  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  async updateConfig(updates: Partial<RouterConfig>): Promise<void> {
    this.config = { ...this.config, ...updates };
    await this.saveConfig();
    this.emit("config:updated", this.config);
  }

  getConfig(): RouterConfig {
    return { ...this.config };
  }

  getStats(): RoutingStats {
    return {
      ...this.stats,
      providerStats: new Map(this.stats.providerStats),
    };
  }

  // ===========================================================================
  // CLEANUP
  // ===========================================================================

  async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    await this.saveStats();
    await this.saveConfig();

    this.decisionCache.clear();
    logger.info("Smart Router shutdown complete");
  }
}

// Export singleton
export const smartRouter = new SmartRouter();
