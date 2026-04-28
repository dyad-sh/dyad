/**
 * OpenClaw Smart Cost Engine
 *
 * Tracks API costs, enforces budgets, and routes to the cheapest model
 * that's adequate for the task complexity.
 *
 * Key concepts:
 *  - MODEL_PRICING: $/1M tokens for every known model (input + output separate)
 *  - CostTracker: accumulates per-model, per-day spend with rolling totals
 *  - SmartRouter: given a task complexity (1-10), picks the cheapest model
 *    that can handle it without over-paying for a top-tier model on a trivial query
 */

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";

// â”€â”€ Pricing ($ per 1M tokens) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  /** 0 = free/local, higher = more capable */
  tier: number;
  /** Minimum complexity (1-10) this model should be used for to get good results */
  minComplexity: number;
  /** Maximum complexity (1-10) this model handles well */
  maxComplexity: number;
  provider: "ollama" | "openai" | "anthropic" | "google" | "openrouter" | "xai" | "azure" | "vertex";
}

/**
 * Pricing data for known models.
 * Ollama models are free (local). Cloud prices are approximate public rates.
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // â”€â”€ Ollama / local (free) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "llama3.2:3b":         { inputPer1M: 0, outputPer1M: 0, tier: 0, minComplexity: 1, maxComplexity: 4, provider: "ollama" },
  "llama3.2:7b":         { inputPer1M: 0, outputPer1M: 0, tier: 0, minComplexity: 1, maxComplexity: 5, provider: "ollama" },
  "llama3.1:8b":         { inputPer1M: 0, outputPer1M: 0, tier: 0, minComplexity: 1, maxComplexity: 5, provider: "ollama" },
  "llama3.1:70b":        { inputPer1M: 0, outputPer1M: 0, tier: 0, minComplexity: 1, maxComplexity: 7, provider: "ollama" },
  "codellama:7b":        { inputPer1M: 0, outputPer1M: 0, tier: 0, minComplexity: 1, maxComplexity: 5, provider: "ollama" },
  "codellama:13b":       { inputPer1M: 0, outputPer1M: 0, tier: 0, minComplexity: 1, maxComplexity: 6, provider: "ollama" },
  "mistral:7b":          { inputPer1M: 0, outputPer1M: 0, tier: 0, minComplexity: 1, maxComplexity: 5, provider: "ollama" },
  "qwen2.5-coder:7b":   { inputPer1M: 0, outputPer1M: 0, tier: 0, minComplexity: 1, maxComplexity: 6, provider: "ollama" },
  "deepseek-coder-v2:16b": { inputPer1M: 0, outputPer1M: 0, tier: 0, minComplexity: 1, maxComplexity: 6, provider: "ollama" },

  // â”€â”€ OpenRouter free â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "qwen/qwen3-coder:free":         { inputPer1M: 0, outputPer1M: 0, tier: 0, minComplexity: 1, maxComplexity: 6, provider: "openrouter" },
  "mistralai/devstral-2512:free":  { inputPer1M: 0, outputPer1M: 0, tier: 0, minComplexity: 1, maxComplexity: 5, provider: "openrouter" },

  // â”€â”€ OpenRouter paid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "qwen/qwen3-coder":              { inputPer1M: 0.50, outputPer1M: 2.00, tier: 2, minComplexity: 1, maxComplexity: 7, provider: "openrouter" },
  "deepseek/deepseek-chat-v3.1":   { inputPer1M: 0.27, outputPer1M: 1.10, tier: 2, minComplexity: 1, maxComplexity: 7, provider: "openrouter" },
  "moonshotai/kimi-k2-0905":       { inputPer1M: 0.60, outputPer1M: 2.40, tier: 2, minComplexity: 1, maxComplexity: 7, provider: "openrouter" },
  "z-ai/glm-4.7":                  { inputPer1M: 0.50, outputPer1M: 2.00, tier: 2, minComplexity: 1, maxComplexity: 7, provider: "openrouter" },

  // â”€â”€ OpenAI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "gpt-5-mini":          { inputPer1M:  1.50, outputPer1M:  6.00, tier: 2, minComplexity: 1, maxComplexity: 6, provider: "openai" },
  "gpt-5":               { inputPer1M:  5.00, outputPer1M: 15.00, tier: 3, minComplexity: 3, maxComplexity: 8, provider: "openai" },
  "gpt-5-codex":         { inputPer1M:  5.00, outputPer1M: 15.00, tier: 3, minComplexity: 3, maxComplexity: 9, provider: "openai" },
  "gpt-5.1":             { inputPer1M:  5.00, outputPer1M: 15.00, tier: 3, minComplexity: 3, maxComplexity: 9, provider: "openai" },
  "gpt-5.1-codex":       { inputPer1M:  5.00, outputPer1M: 15.00, tier: 3, minComplexity: 3, maxComplexity: 9, provider: "openai" },
  "gpt-5.1-codex-mini":  { inputPer1M:  2.00, outputPer1M:  8.00, tier: 2, minComplexity: 1, maxComplexity: 7, provider: "openai" },
  "gpt-5.2":             { inputPer1M:  5.00, outputPer1M: 15.00, tier: 4, minComplexity: 4, maxComplexity: 10, provider: "openai" },

  // â”€â”€ Anthropic â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "claude-sonnet-4-5":   { inputPer1M: 3.00, outputPer1M: 15.00, tier: 3, minComplexity: 3, maxComplexity: 9, provider: "anthropic" },
  "claude-sonnet-4-5-20250929": { inputPer1M: 3.00, outputPer1M: 15.00, tier: 4, minComplexity: 4, maxComplexity: 10, provider: "anthropic" },
  "claude-opus-4-5":            { inputPer1M: 15.00, outputPer1M: 75.00, tier: 5, minComplexity: 7, maxComplexity: 10, provider: "anthropic" },
  "claude-opus-4-6":            { inputPer1M: 15.00, outputPer1M: 75.00, tier: 5, minComplexity: 7, maxComplexity: 10, provider: "anthropic" },

  // â”€â”€ Google â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "gemini-flash-latest":       { inputPer1M: 0.15, outputPer1M: 0.60, tier: 1, minComplexity: 1, maxComplexity: 6, provider: "google" },
  "gemini-2.5-pro":            { inputPer1M: 1.25, outputPer1M: 5.00, tier: 3, minComplexity: 3, maxComplexity: 8, provider: "google" },
  "gemini-3-flash-preview":    { inputPer1M: 0.20, outputPer1M: 0.80, tier: 2, minComplexity: 1, maxComplexity: 7, provider: "google" },
  "gemini-3-pro-preview":      { inputPer1M: 2.50, outputPer1M: 10.00, tier: 4, minComplexity: 4, maxComplexity: 9, provider: "google" },

  // â”€â”€ xAI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  "grok-code-fast-1":          { inputPer1M: 0.30, outputPer1M: 1.20, tier: 2, minComplexity: 1, maxComplexity: 6, provider: "xai" },
};


// â”€â”€ Cost Record & Budget Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface CostRecord {
  id: string;
  timestamp: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  taskType: string;
  source: "cns" | "chat-stream" | "autonomous" | "agent";
}

export interface CostBudget {
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  /** When spending exceeds this % of limit, warn but don't block */
  warningThresholdPct: number;
  /** Automatically downgrade to cheaper models when over warning threshold */
  autoDowngrade: boolean;
  /** Prefer free/local models whenever possible */
  preferFree: boolean;
}

export interface CostSummary {
  todayUsd: number;
  monthUsd: number;
  allTimeUsd: number;
  todayTokens: number;
  monthTokens: number;
  todayRequests: number;
  budget: CostBudget;
  overBudget: boolean;
  warningActive: boolean;
  topModels: Array<{ model: string; cost: number; requests: number }>;
  savedByLocal: number; // $ estimated if local hadn't been used
}

const DEFAULT_BUDGET: CostBudget = {
  dailyLimitUsd: 5.00,
  monthlyLimitUsd: 50.00,
  warningThresholdPct: 80,
  autoDowngrade: true,
  preferFree: true,
};


// â”€â”€ Task-to-Model Routing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Maps each JoyCreate module/task category to a preferred model.
 * Users can override any of these from the Costs UI.
 */
export type TaskModule =
  | "code"             // App building, site creation, code generation
  | "agent"            // Agent creation, deployment, orchestration
  | "image"            // Image generation, vision
  | "video"            // Video generation
  | "document"         // Document writing, spreadsheets, text generation
  | "workflow"         // n8n workflow creation, automation
  | "email"            // Email composition, triage, digests
  | "chat"             // General chat, Telegram/Discord/WhatsApp responses
  | "planning"         // Autonomous planning, task decomposition
  | "data"             // Scraping, data pipelines, vector search
  | "deploy"           // Deployment, GitHub operations
  | "marketplace";     // Marketplace browse, publish, install

export interface TaskModelRoute {
  /** Preferred model for this module */
  model: string;
  /** Provider for this model */
  provider: string;
  /** Why â€” user-facing explanation */
  reason: string;
}

export type TaskModelRouting = Record<TaskModule, TaskModelRoute>;

/**
 * Default routing â€” balance cost vs quality per module.
 *
 *  - Code / agents â†’ Claude (best for code reasoning)
 *  - Images â†’ Gemini (good vision + cheap)
 *  - Documents / workflows / email / chat â†’ DeepSeek (cheap + competent)
 *  - Planning â†’ Gemini Flash (cheap + fast for JSON planning)
 *  - Data / deploy / marketplace â†’ DeepSeek (simple structured tasks)
 */
export const DEFAULT_TASK_ROUTING: TaskModelRouting = {
  code:         { model: "claude-sonnet-4-5",     provider: "anthropic",   reason: "Best for code generation and reasoning" },
  agent:        { model: "claude-sonnet-4-5",     provider: "anthropic",   reason: "Best for agent logic and tool use" },
  image:        { model: "gemini-3-flash-preview",       provider: "google",      reason: "Fast vision + image understanding at low cost" },
  video:        { model: "gemini-3-flash-preview",       provider: "google",      reason: "Multimodal + cost-effective" },
  document:     { model: "deepseek/deepseek-chat-v3.1",  provider: "openrouter",  reason: "Great writing quality at very low cost" },
  workflow:     { model: "deepseek/deepseek-chat-v3.1",  provider: "openrouter",  reason: "Good structured output for workflow JSON" },
  email:        { model: "deepseek/deepseek-chat-v3.1",  provider: "openrouter",  reason: "Natural writing at low cost" },
  chat:         { model: "deepseek/deepseek-chat-v3.1",  provider: "openrouter",  reason: "Fast conversational responses at lowest cost" },
  planning:     { model: "gemini-flash-latest",          provider: "google",      reason: "Fast JSON planning at very low cost" },
  data:         { model: "deepseek/deepseek-chat-v3.1",  provider: "openrouter",  reason: "Structured data tasks, cost-effective" },
  deploy:       { model: "deepseek/deepseek-chat-v3.1",  provider: "openrouter",  reason: "Simple command orchestration" },
  marketplace:  { model: "gemini-flash-latest",          provider: "google",      reason: "Quick lookups, low cost" },
};

/**
 * Maps action catalog categories + AIRequest types to TaskModules.
 */
const TASK_MODULE_MAP: Record<string, TaskModule> = {
  // AIRequest.type values
  chat: "chat",
  completion: "code",
  agent: "agent",
  embedding: "data",
  vision: "image",
  transcription: "document",

  // Action catalog categories
  app: "code",
  github: "deploy",
  deploy: "deploy",
  marketplace: "marketplace",
  workflow: "workflow",
  email: "email",
  image: "image",
  video: "video",
  scraper: "data",
  mission: "planning",
  data: "data",
  system: "data",

  // Channel names (Telegram, Discord, etc.)
  telegram: "chat",
  discord: "chat",
  slack: "chat",
  whatsapp: "chat",
  webchat: "chat",
};

/** Resolve any task type / category / channel string to a TaskModule */
export function resolveTaskModule(taskKey: string): TaskModule {
  return TASK_MODULE_MAP[taskKey] ?? "chat";
}


// â”€â”€ Cost Engine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export class OpenClawCostEngine extends EventEmitter {
  private static instance: OpenClawCostEngine;

  private records: CostRecord[] = [];
  private budget: CostBudget = { ...DEFAULT_BUDGET };
  private taskRouting: TaskModelRouting = { ...DEFAULT_TASK_ROUTING };

  private constructor() {
    super();
  }

  static getInstance(): OpenClawCostEngine {
    if (!OpenClawCostEngine.instance) {
      OpenClawCostEngine.instance = new OpenClawCostEngine();
    }
    return OpenClawCostEngine.instance;
  }

  // â”€â”€ Configuration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  setBudget(budget: Partial<CostBudget>): void {
    this.budget = { ...this.budget, ...budget };
    this.emit("budget:updated", this.budget);
  }

  getBudget(): CostBudget {
    return { ...this.budget };
  }

  // â”€â”€ Task-to-Model Routing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Get the full taskâ†’model routing table */
  getTaskRouting(): TaskModelRouting {
    return { ...this.taskRouting };
  }

  /** Update one or more moduleâ†’model mappings */
  setTaskRouting(updates: Partial<TaskModelRouting>): void {
    this.taskRouting = { ...this.taskRouting, ...updates };
    this.emit("taskRouting:updated", this.taskRouting);
  }

  /** Reset task routing to defaults */
  resetTaskRouting(): void {
    this.taskRouting = { ...DEFAULT_TASK_ROUTING };
    this.emit("taskRouting:updated", this.taskRouting);
  }

  /**
   * Get the preferred model for a given task type, action category, or channel.
   *
   * @param taskKey AIRequest.type (e.g. "chat"), action category (e.g. "image"),
   *               or channel name (e.g. "telegram")
   * @returns { model, provider, reason } â€” the configured preferred model
   */
  getModelForTask(taskKey: string): TaskModelRoute {
    const module = resolveTaskModule(taskKey);
    return this.taskRouting[module];
  }

  // â”€â”€ Cost Calculation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Calculate cost for a given model and token usage */
  calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): { inputCost: number; outputCost: number; totalCost: number } {
    const pricing = this.lookupPricing(model);
    const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
    return { inputCost, outputCost, totalCost: inputCost + outputCost };
  }

  /** Estimate cost before running a request */
  estimateCost(
    model: string,
    estimatedInputTokens: number,
    estimatedOutputTokens: number = 1000,
  ): number {
    const { totalCost } = this.calculateCost(model, estimatedInputTokens, estimatedOutputTokens);
    return totalCost;
  }

  // â”€â”€ Recording â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Record a completed request with actual token usage */
  recordUsage(params: {
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    taskType: string;
    source: CostRecord["source"];
  }): CostRecord {
    const { inputCost, outputCost, totalCost } = this.calculateCost(
      params.model,
      params.inputTokens,
      params.outputTokens,
    );

    const record: CostRecord = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      model: params.model,
      provider: params.provider,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      totalTokens: params.inputTokens + params.outputTokens,
      inputCost,
      outputCost,
      totalCost,
      taskType: params.taskType,
      source: params.source,
    };

    this.records.push(record);

    // Trim old records (keep last 30 days max, 10K records)
    if (this.records.length > 10_000) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      this.records = this.records.filter(
        (r) => new Date(r.timestamp) >= cutoff,
      );
    }

    // Check budget
    const summary = this.getSummary();
    if (summary.overBudget) {
      this.emit("budget:exceeded", summary);
    } else if (summary.warningActive) {
      this.emit("budget:warning", summary);
    }

    this.emit("cost:recorded", record);
    return record;
  }

  // â”€â”€ Summary & Reporting â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  getSummary(): CostSummary {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let todayUsd = 0;
    let monthUsd = 0;
    let allTimeUsd = 0;
    let todayTokens = 0;
    let monthTokens = 0;
    let todayRequests = 0;
    let savedByLocal = 0;

    const modelStats = new Map<string, { cost: number; requests: number }>();

    for (const r of this.records) {
      const ts = new Date(r.timestamp);
      allTimeUsd += r.totalCost;

      if (ts >= monthStart) {
        monthUsd += r.totalCost;
        monthTokens += r.totalTokens;
      }
      if (ts >= todayStart) {
        todayUsd += r.totalCost;
        todayTokens += r.totalTokens;
        todayRequests++;
      }

      // Track model stats
      const existing = modelStats.get(r.model) ?? { cost: 0, requests: 0 };
      existing.cost += r.totalCost;
      existing.requests++;
      modelStats.set(r.model, existing);

      // Estimate savings from local models
      if (r.totalCost === 0 && r.totalTokens > 0) {
        // If this were processed on a mid-tier cloud model instead
        const hypotheticalCost = this.calculateCost(
          "claude-sonnet-4-5",
          r.inputTokens,
          r.outputTokens,
        ).totalCost;
        savedByLocal += hypotheticalCost;
      }
    }

    const topModels = Array.from(modelStats.entries())
      .map(([model, s]) => ({ model, ...s }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5);

    const warningThreshold = this.budget.dailyLimitUsd * (this.budget.warningThresholdPct / 100);

    return {
      todayUsd,
      monthUsd,
      allTimeUsd,
      todayTokens,
      monthTokens,
      todayRequests,
      budget: { ...this.budget },
      overBudget: todayUsd >= this.budget.dailyLimitUsd || monthUsd >= this.budget.monthlyLimitUsd,
      warningActive: todayUsd >= warningThreshold,
      topModels,
      savedByLocal,
    };
  }

  getRecords(limit = 50): CostRecord[] {
    return this.records.slice(-limit);
  }

  // â”€â”€ Smart Model Selection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Pick the cheapest model adequate for the given complexity.
   * If budget is under pressure, aggressively downgrades to local.
   *
   * @param complexity 1-10 task complexity from CNS estimator
   * @param availableModels Models the caller has access to (e.g. Ollama models, configured providers)
   * @param preferLocal Prefer free/local models
   * @returns { model, provider, estimatedCost, reason }
   */
  selectCheapestAdequateModel(
    complexity: number,
    availableModels: string[],
    preferLocal = this.budget.preferFree,
  ): {
    model: string;
    provider: string;
    estimatedCostPer1kTokens: number;
    reason: string;
  } {
    const summary = this.getSummary();

    // If over budget or auto-downgrade is active and warning threshold hit, force local
    if (
      summary.overBudget ||
      (this.budget.autoDowngrade && summary.warningActive)
    ) {
      const localModel = this.findBestLocal(complexity, availableModels);
      if (localModel) {
        return {
          model: localModel,
          provider: "ollama",
          estimatedCostPer1kTokens: 0,
          reason: summary.overBudget
            ? "Budget exceeded â€” using free local model"
            : "Approaching budget limit â€” downgrading to local",
        };
      }
    }

    // Gather candidates that can handle the complexity
    const candidates: Array<{
      model: string;
      pricing: ModelPricing;
      avgCostPer1k: number;
    }> = [];

    for (const model of availableModels) {
      const pricing = MODEL_PRICING[model];
      if (!pricing) continue;
      if (complexity > pricing.maxComplexity) continue; // Too weak
      // Allow usage below minComplexity â€” model is overkill but still works

      const avgCostPer1k =
        (pricing.inputPer1M + pricing.outputPer1M) / 2 / 1000;
      candidates.push({ model, pricing, avgCostPer1k });
    }

    if (candidates.length === 0) {
      // No known models, fall back to first available
      return {
        model: availableModels[0] ?? "llama3.2:3b",
        provider: "ollama",
        estimatedCostPer1kTokens: 0,
        reason: "No priced models available â€” using default",
      };
    }

    // Sort by cost ascending
    candidates.sort((a, b) => a.avgCostPer1k - b.avgCostPer1k);

    if (preferLocal) {
      // Prefer free models first
      const freeCandidate = candidates.find((c) => c.avgCostPer1k === 0);
      if (freeCandidate) {
        return {
          model: freeCandidate.model,
          provider: freeCandidate.pricing.provider,
          estimatedCostPer1kTokens: 0,
          reason: `Free model adequate for complexity ${complexity}`,
        };
      }
    }

    // Pick cheapest that meets complexity
    const best = candidates[0];
    return {
      model: best.model,
      provider: best.pricing.provider,
      estimatedCostPer1kTokens: best.avgCostPer1k,
      reason: `Cheapest adequate model for complexity ${complexity} ($${best.avgCostPer1k.toFixed(4)}/1k tokens)`,
    };
  }

  /**
   * Estimate total cost of an autonomous execution plan before running it.
   */
  estimatePlanCost(
    steps: Array<{ actionId: string; estimatedTokens?: number }>,
    planningModel: string,
    planningTokens: number,
  ): {
    planningCost: number;
    executionCost: number;
    selfCorrectionBuffer: number;
    totalEstimate: number;
  } {
    const planningCost = this.estimateCost(planningModel, planningTokens, 2000);

    // Each action dispatch may trigger AI (e.g. agent.create, workflow.generate)
    let executionCost = 0;
    for (const step of steps) {
      const tokens = step.estimatedTokens ?? 1500;
      // Most actions use a mid-tier model
      executionCost += this.estimateCost("gemini-flash-latest", tokens, 1000);
    }

    // Budget 20% extra for potential self-correction retries
    const selfCorrectionBuffer = executionCost * 0.2;

    return {
      planningCost,
      executionCost,
      selfCorrectionBuffer,
      totalEstimate: planningCost + executionCost + selfCorrectionBuffer,
    };
  }

  /**
   * Check if an operation would exceed the budget.
   * Returns true if OK to proceed, false if blocked.
   */
  checkBudget(estimatedCostUsd: number): {
    allowed: boolean;
    reason: string;
    remainingDailyUsd: number;
    remainingMonthlyUsd: number;
  } {
    const summary = this.getSummary();
    const remainingDaily = Math.max(0, this.budget.dailyLimitUsd - summary.todayUsd);
    const remainingMonthly = Math.max(0, this.budget.monthlyLimitUsd - summary.monthUsd);

    if (estimatedCostUsd > remainingDaily) {
      return {
        allowed: false,
        reason: `Estimated cost $${estimatedCostUsd.toFixed(4)} exceeds remaining daily budget $${remainingDaily.toFixed(2)}`,
        remainingDailyUsd: remainingDaily,
        remainingMonthlyUsd: remainingMonthly,
      };
    }

    if (estimatedCostUsd > remainingMonthly) {
      return {
        allowed: false,
        reason: `Estimated cost $${estimatedCostUsd.toFixed(4)} exceeds remaining monthly budget $${remainingMonthly.toFixed(2)}`,
        remainingDailyUsd: remainingDaily,
        remainingMonthlyUsd: remainingMonthly,
      };
    }

    return {
      allowed: true,
      reason: "Within budget",
      remainingDailyUsd: remainingDaily,
      remainingMonthlyUsd: remainingMonthly,
    };
  }

  // â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private lookupPricing(model: string): ModelPricing {
    // Direct match
    if (MODEL_PRICING[model]) return MODEL_PRICING[model];

    // Partial match (e.g. "claude-sonnet-4-5" from a versioned string)
    for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
      if (model.includes(key) || key.includes(model)) return pricing;
    }

    // Unknown model â€” assume mid-tier cloud pricing as a safe default
    return {
      inputPer1M: 3.0,
      outputPer1M: 15.0,
      tier: 3,
      minComplexity: 3,
      maxComplexity: 9,
      provider: "anthropic",
    };
  }

  private findBestLocal(
    complexity: number,
    availableModels: string[],
  ): string | null {
    const localModels = availableModels.filter((m) => {
      const p = MODEL_PRICING[m];
      return p && p.provider === "ollama" && complexity <= p.maxComplexity;
    });

    if (localModels.length === 0) return null;

    // Pick the most capable local model
    localModels.sort((a, b) => {
      const pA = MODEL_PRICING[a];
      const pB = MODEL_PRICING[b];
      return (pB?.maxComplexity ?? 0) - (pA?.maxComplexity ?? 0);
    });

    return localModels[0];
  }
}

/** Convenience accessor */
export function getOpenClawCostEngine(): OpenClawCostEngine {
  return OpenClawCostEngine.getInstance();
}
