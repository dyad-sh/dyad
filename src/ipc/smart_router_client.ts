/**
 * Smart Router IPC Client
 * Renderer-side client for intelligent AI request routing.
 */

import type {
  RoutingContext,
  RoutingDecision,
  RoutingResult,
  RouterConfig,
  AIProvider,
  RoutingStats,
  TaskType,
  PrivacyLevel,
} from "@/lib/smart_router";

// =============================================================================
// CHANNEL NAMES
// =============================================================================

const CHANNELS = {
  ROUTE: "smart-router:route",
  RECORD_RESULT: "smart-router:record-result",
  LIST_PROVIDERS: "smart-router:list-providers",
  GET_PROVIDER: "smart-router:get-provider",
  REGISTER_PROVIDER: "smart-router:register-provider",
  UPDATE_PROVIDER_STATUS: "smart-router:update-provider-status",
  GET_CONFIG: "smart-router:get-config",
  UPDATE_CONFIG: "smart-router:update-config",
  GET_STATS: "smart-router:get-stats",
} as const;

// =============================================================================
// TYPES
// =============================================================================

interface IpcRenderer {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
}

// =============================================================================
// CLIENT
// =============================================================================

export class SmartRouterClient {
  private static instance: SmartRouterClient;
  private ipcRenderer: IpcRenderer;

  private constructor() {
    this.ipcRenderer = (window as any).electron.ipcRenderer;
  }

  static getInstance(): SmartRouterClient {
    if (!SmartRouterClient.instance) {
      SmartRouterClient.instance = new SmartRouterClient();
    }
    return SmartRouterClient.instance;
  }

  // ============================================================================
  // ROUTING
  // ============================================================================

  /**
   * Route an AI request to the best provider/model
   */
  async route(context: RoutingContext): Promise<RoutingDecision> {
    return this.ipcRenderer.invoke(CHANNELS.ROUTE, context);
  }

  /**
   * Quick route helper for chat tasks
   */
  async routeChat(
    prompt: string,
    options: {
      privacyLevel?: PrivacyLevel;
      requiresVision?: boolean;
      requiresTools?: boolean;
      maxCostCents?: number;
      preferredProviders?: string[];
    } = {}
  ): Promise<RoutingDecision> {
    return this.route({
      taskType: "chat",
      prompt,
      privacyLevel: options.privacyLevel || "standard",
      requiresVision: options.requiresVision,
      requiresTools: options.requiresTools,
      budgetCents: options.maxCostCents,
      preferredProviders: options.preferredProviders,
    });
  }

  /**
   * Quick route helper for code generation
   */
  async routeCode(
    prompt: string,
    options: {
      privacyLevel?: PrivacyLevel;
      preferLocal?: boolean;
    } = {}
  ): Promise<RoutingDecision> {
    return this.route({
      taskType: "code_generation",
      prompt,
      privacyLevel: options.privacyLevel || (options.preferLocal ? "private" : "standard"),
      preferredProviders: options.preferLocal ? ["ollama", "llamacpp"] : undefined,
    });
  }

  /**
   * Quick route helper for reasoning tasks (math, logic, analysis)
   */
  async routeReasoning(
    prompt: string,
    options: {
      privacyLevel?: PrivacyLevel;
      maxCostCents?: number;
    } = {}
  ): Promise<RoutingDecision> {
    return this.route({
      taskType: "reasoning",
      prompt,
      privacyLevel: options.privacyLevel || "standard",
      budgetCents: options.maxCostCents,
      // For complex reasoning, prefer powerful models
      preferredProviders: ["openai", "anthropic", "deepseek"],
    });
  }

  /**
   * Quick route helper for creative writing
   */
  async routeCreative(
    prompt: string,
    options: {
      privacyLevel?: PrivacyLevel;
      temperature?: number;
    } = {}
  ): Promise<RoutingDecision> {
    return this.route({
      taskType: "creative_writing",
      prompt,
      privacyLevel: options.privacyLevel || "standard",
      temperature: options.temperature || 0.9,
    });
  }

  /**
   * Quick route helper for agent tasks (tool use)
   */
  async routeAgent(
    prompt: string,
    options: {
      privacyLevel?: PrivacyLevel;
      maxCostCents?: number;
    } = {}
  ): Promise<RoutingDecision> {
    return this.route({
      taskType: "agent",
      prompt,
      privacyLevel: options.privacyLevel || "standard",
      requiresTools: true,
      budgetCents: options.maxCostCents,
    });
  }

  /**
   * Route with privacy-first constraint (local only)
   */
  async routePrivate(
    taskType: TaskType,
    prompt: string
  ): Promise<RoutingDecision> {
    return this.route({
      taskType,
      prompt,
      privacyLevel: "private",
    });
  }

  /**
   * Route with cost optimization
   */
  async routeCheap(
    taskType: TaskType,
    prompt: string,
    maxCostCents: number = 1
  ): Promise<RoutingDecision> {
    return this.route({
      taskType,
      prompt,
      privacyLevel: "public",
      budgetCents: maxCostCents,
      preferredProviders: ["ollama", "llamacpp", "groq", "deepseek"],
    });
  }

  /**
   * Route for best quality (regardless of cost)
   */
  async routeBestQuality(
    taskType: TaskType,
    prompt: string
  ): Promise<RoutingDecision> {
    return this.route({
      taskType,
      prompt,
      privacyLevel: "standard",
      preferredProviders: ["openai", "anthropic"],
    });
  }

  /**
   * Record the result of a routed request (for learning/stats)
   */
  async recordResult(result: RoutingResult): Promise<void> {
    return this.ipcRenderer.invoke(CHANNELS.RECORD_RESULT, result);
  }

  // ============================================================================
  // PROVIDER MANAGEMENT
  // ============================================================================

  /**
   * List all registered providers
   */
  async listProviders(): Promise<AIProvider[]> {
    return this.ipcRenderer.invoke(CHANNELS.LIST_PROVIDERS);
  }

  /**
   * Get a specific provider by ID
   */
  async getProvider(providerId: string): Promise<AIProvider | undefined> {
    return this.ipcRenderer.invoke(CHANNELS.GET_PROVIDER, providerId);
  }

  /**
   * Register a new provider
   */
  async registerProvider(provider: AIProvider): Promise<void> {
    return this.ipcRenderer.invoke(CHANNELS.REGISTER_PROVIDER, provider);
  }

  /**
   * Update a provider's status
   */
  async updateProviderStatus(
    providerId: string,
    status: AIProvider["status"]
  ): Promise<void> {
    return this.ipcRenderer.invoke(CHANNELS.UPDATE_PROVIDER_STATUS, providerId, status);
  }

  /**
   * Get providers filtered by type
   */
  async getProvidersByType(type: "local" | "cloud" | "p2p" | "hybrid"): Promise<AIProvider[]> {
    const providers = await this.listProviders();
    return providers.filter(p => p.type === type);
  }

  /**
   * Get local providers only
   */
  async getLocalProviders(): Promise<AIProvider[]> {
    return this.getProvidersByType("local");
  }

  /**
   * Get cloud providers only
   */
  async getCloudProviders(): Promise<AIProvider[]> {
    return this.getProvidersByType("cloud");
  }

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  /**
   * Get current router configuration
   */
  async getConfig(): Promise<RouterConfig> {
    return this.ipcRenderer.invoke(CHANNELS.GET_CONFIG);
  }

  /**
   * Update router configuration
   */
  async updateConfig(updates: Partial<RouterConfig>): Promise<void> {
    return this.ipcRenderer.invoke(CHANNELS.UPDATE_CONFIG, updates);
  }

  /**
   * Set privacy level preference
   */
  async setDefaultPrivacyLevel(level: PrivacyLevel): Promise<void> {
    return this.updateConfig({ defaultPrivacyLevel: level });
  }

  /**
   * Enable/disable local preference
   */
  async setPreferLocal(prefer: boolean): Promise<void> {
    return this.updateConfig({ preferLocal: prefer });
  }

  /**
   * Set cost optimization strategy
   */
  async setCostOptimization(strategy: "aggressive" | "balanced" | "quality"): Promise<void> {
    return this.updateConfig({ costOptimization: strategy });
  }

  // ============================================================================
  // STATS & ANALYTICS
  // ============================================================================

  /**
   * Get routing statistics
   */
  async getStats(): Promise<RoutingStats & { providerStats: Record<string, any> }> {
    return this.ipcRenderer.invoke(CHANNELS.GET_STATS);
  }

  /**
   * Get cost savings from using local models
   */
  async getCostSavings(): Promise<number> {
    const stats = await this.getStats();
    return stats.costSavings;
  }

  /**
   * Get local vs cloud usage ratio
   */
  async getUsageRatio(): Promise<{ local: number; cloud: number; p2p: number }> {
    const stats = await this.getStats();
    const total = stats.totalRequests || 1;
    return {
      local: (stats.localRequests / total) * 100,
      cloud: (stats.cloudRequests / total) * 100,
      p2p: (stats.p2pRequests / total) * 100,
    };
  }
}

// Export types for consumers
export type {
  RoutingContext,
  RoutingDecision,
  RoutingResult,
  RouterConfig,
  AIProvider,
  RoutingStats,
  TaskType,
  PrivacyLevel,
};

// Export singleton instance
export const smartRouterClient = SmartRouterClient.getInstance();
