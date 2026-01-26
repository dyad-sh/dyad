/**
 * Smart Router IPC Handlers
 * Exposes smart routing capabilities to the renderer process.
 */

import { ipcMain } from "electron";
import log from "electron-log";
import {
  smartRouter,
  type RoutingContext,
  type RoutingDecision,
  type RoutingResult,
  type RouterConfig,
  type AIProvider,
} from "@/lib/smart_router";

const logger = log.scope("smart_router_handlers");

// =============================================================================
// CHANNEL NAMES
// =============================================================================

const CHANNELS = {
  // Routing
  ROUTE: "smart-router:route",
  RECORD_RESULT: "smart-router:record-result",
  
  // Provider management
  LIST_PROVIDERS: "smart-router:list-providers",
  GET_PROVIDER: "smart-router:get-provider",
  REGISTER_PROVIDER: "smart-router:register-provider",
  UPDATE_PROVIDER_STATUS: "smart-router:update-provider-status",
  
  // Configuration
  GET_CONFIG: "smart-router:get-config",
  UPDATE_CONFIG: "smart-router:update-config",
  
  // Stats
  GET_STATS: "smart-router:get-stats",
  
  // Analysis
  ANALYZE_COMPLEXITY: "smart-router:analyze-complexity",
} as const;

// =============================================================================
// INITIALIZATION
// =============================================================================

let initialized = false;

export function registerSmartRouterHandlers(): void {
  if (initialized) return;
  initialized = true;

  logger.info("Registering smart router handlers");

  // Initialize router
  smartRouter.initialize().catch(error => {
    logger.error("Failed to initialize smart router", { error });
  });

  // ============================================================================
  // ROUTING
  // ============================================================================

  ipcMain.handle(CHANNELS.ROUTE, async (_event, context: RoutingContext): Promise<RoutingDecision> => {
    try {
      const decision = await smartRouter.route(context);
      logger.debug("Route decision made", {
        taskType: context.taskType,
        provider: decision.providerId,
        model: decision.modelId,
        confidence: decision.confidence,
      });
      return decision;
    } catch (error) {
      logger.error("Failed to route request", { error, context });
      throw error;
    }
  });

  ipcMain.handle(CHANNELS.RECORD_RESULT, async (_event, result: RoutingResult): Promise<void> => {
    try {
      await smartRouter.recordResult(result);
    } catch (error) {
      logger.error("Failed to record routing result", { error });
      throw error;
    }
  });

  // ============================================================================
  // PROVIDER MANAGEMENT
  // ============================================================================

  ipcMain.handle(CHANNELS.LIST_PROVIDERS, async (): Promise<AIProvider[]> => {
    return smartRouter.listProviders();
  });

  ipcMain.handle(CHANNELS.GET_PROVIDER, async (_event, providerId: string): Promise<AIProvider | undefined> => {
    return smartRouter.getProvider(providerId);
  });

  ipcMain.handle(CHANNELS.REGISTER_PROVIDER, async (_event, provider: AIProvider): Promise<void> => {
    smartRouter.registerProvider(provider);
  });

  ipcMain.handle(
    CHANNELS.UPDATE_PROVIDER_STATUS,
    async (_event, providerId: string, status: AIProvider["status"]): Promise<void> => {
      await smartRouter.updateProviderStatus(providerId, status);
    }
  );

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  ipcMain.handle(CHANNELS.GET_CONFIG, async (): Promise<RouterConfig> => {
    return smartRouter.getConfig();
  });

  ipcMain.handle(CHANNELS.UPDATE_CONFIG, async (_event, updates: Partial<RouterConfig>): Promise<void> => {
    await smartRouter.updateConfig(updates);
  });

  // ============================================================================
  // STATS
  // ============================================================================

  ipcMain.handle(CHANNELS.GET_STATS, async () => {
    const stats = smartRouter.getStats();
    return {
      ...stats,
      providerStats: Object.fromEntries(stats.providerStats),
    };
  });

  logger.info("Smart router handlers registered");
}

/**
 * Cleanup smart router on app shutdown
 */
export async function shutdownSmartRouter(): Promise<void> {
  await smartRouter.shutdown();
}
