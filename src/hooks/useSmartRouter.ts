/**
 * useSmartRouter - React hooks for intelligent model routing
 * 
 * Provides easy access to the smart router for:
 * - Automatic local/cloud routing based on task complexity
 * - Cost-optimized model selection
 * - Privacy-aware routing (keep sensitive data local)
 * - Provider management and monitoring
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { smartRouterClient } from "@/ipc/smart_router_client";
import type {
  RoutingContext,
  RoutingResult,
  RouterConfig,
  AIProvider,
  TaskType,
  PrivacyLevel,
} from "@/ipc/smart_router_client";
import { showError, showSuccess } from "@/lib/toast";

// Query keys for TanStack Query
const QUERY_KEYS = {
  providers: ["smart-router", "providers"] as const,
  config: ["smart-router", "config"] as const,
  stats: ["smart-router", "stats"] as const,
  provider: (id: string) => ["smart-router", "provider", id] as const,
};

/**
 * Hook to list all available AI providers
 */
export function useProviders() {
  return useQuery({
    queryKey: QUERY_KEYS.providers,
    queryFn: () => smartRouterClient.listProviders(),
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to get local providers only
 */
export function useLocalProviders() {
  return useQuery({
    queryKey: [...QUERY_KEYS.providers, "local"],
    queryFn: () => smartRouterClient.getLocalProviders(),
    staleTime: 30000,
  });
}

/**
 * Hook to get cloud providers only
 */
export function useCloudProviders() {
  return useQuery({
    queryKey: [...QUERY_KEYS.providers, "cloud"],
    queryFn: () => smartRouterClient.getCloudProviders(),
    staleTime: 30000,
  });
}

/**
 * Hook to get a specific provider by ID
 */
export function useProvider(providerId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.provider(providerId),
    queryFn: () => smartRouterClient.getProvider(providerId),
    enabled: !!providerId,
  });
}

/**
 * Hook to get routing configuration
 */
export function useRoutingConfig() {
  return useQuery({
    queryKey: QUERY_KEYS.config,
    queryFn: () => smartRouterClient.getConfig(),
    staleTime: 60000, // 1 minute
  });
}

/**
 * Hook to get routing statistics
 */
export function useRoutingStats() {
  return useQuery({
    queryKey: QUERY_KEYS.stats,
    queryFn: () => smartRouterClient.getStats(),
    refetchInterval: 10000, // Auto-refresh every 10 seconds
  });
}

/**
 * Hook to route a request to the best provider/model
 */
export function useRouteRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: RoutingContext) => smartRouterClient.route(request),
    onSuccess: () => {
      // Invalidate stats after routing
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stats });
    },
    onError: (error: Error) => {
      showError(`Routing failed: ${error.message}`);
    },
  });
}

/**
 * Hook for chat-specific routing
 */
export function useRouteChatMessage() {
  const routeRequest = useRouteRequest();

  return {
    ...routeRequest,
    routeChat: (
      prompt: string,
      options?: {
        privacyLevel?: PrivacyLevel;
        preferLocal?: boolean;
        maxCostCents?: number;
      }
    ) => {
      return routeRequest.mutateAsync({
        taskType: "chat",
        prompt,
        privacyLevel: options?.privacyLevel ?? "standard",
        budgetCents: options?.maxCostCents,
        preferredProviders: options?.preferLocal ? ["ollama", "llamacpp"] : undefined,
      });
    },
  };
}

/**
 * Hook for code generation routing
 */
export function useRouteCodeGeneration() {
  const routeRequest = useRouteRequest();

  return {
    ...routeRequest,
    routeCode: (
      prompt: string,
      options?: {
        language?: string;
        preferLocal?: boolean;
      }
    ) => {
      return routeRequest.mutateAsync({
        taskType: "code_generation",
        prompt,
        privacyLevel: options?.preferLocal ? "private" : "standard",
        preferredProviders: options?.preferLocal ? ["ollama", "llamacpp"] : undefined,
        metadata: { language: options?.language },
      });
    },
  };
}

/**
 * Hook for reasoning/analysis tasks
 */
export function useRouteReasoning() {
  const routeRequest = useRouteRequest();

  return {
    ...routeRequest,
    routeReasoning: (
      prompt: string,
      options?: {
        preferQuality?: boolean;
        maxCostCents?: number;
      }
    ) => {
      return routeRequest.mutateAsync({
        taskType: "reasoning",
        prompt,
        privacyLevel: "standard",
        budgetCents: options?.maxCostCents,
        preferredProviders: options?.preferQuality ? ["openai", "anthropic"] : undefined,
      });
    },
  };
}

/**
 * Hook for creative writing tasks
 */
export function useRouteCreativeWriting() {
  const routeRequest = useRouteRequest();

  return {
    ...routeRequest,
    routeCreative: (
      prompt: string,
      options?: {
        temperature?: number;
      }
    ) => {
      return routeRequest.mutateAsync({
        taskType: "creative_writing",
        prompt,
        privacyLevel: "standard",
        temperature: options?.temperature ?? 0.9,
      });
    },
  };
}

/**
 * Hook for agent/tool-use tasks
 */
export function useRouteAgentTask() {
  const routeRequest = useRouteRequest();

  return {
    ...routeRequest,
    routeAgent: (
      prompt: string,
      options?: {
        tools?: string[];
        maxCostCents?: number;
      }
    ) => {
      return routeRequest.mutateAsync({
        taskType: "agent",
        prompt,
        privacyLevel: "standard",
        requiresTools: true,
        budgetCents: options?.maxCostCents,
        metadata: { tools: options?.tools },
      });
    },
  };
}

/**
 * Hook to record request results for learning
 */
export function useRecordResult() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (result: RoutingResult) => smartRouterClient.recordResult(result),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stats });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.providers });
    },
  });
}

/**
 * Hook to register a new provider
 */
export function useRegisterProvider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (provider: AIProvider) =>
      smartRouterClient.registerProvider(provider),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.providers });
      showSuccess("Provider registered successfully");
    },
    onError: (error: Error) => {
      showError(`Failed to register provider: ${error.message}`);
    },
  });
}

/**
 * Hook to update provider status
 */
export function useUpdateProviderStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      providerId: string;
      status: AIProvider["status"];
    }) => smartRouterClient.updateProviderStatus(params.providerId, params.status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.providers });
    },
  });
}

/**
 * Hook to update routing configuration
 */
export function useUpdateConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: Partial<RouterConfig>) =>
      smartRouterClient.updateConfig(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.config });
      showSuccess("Routing configuration updated");
    },
    onError: (error: Error) => {
      showError(`Failed to update config: ${error.message}`);
    },
  });
}

/**
 * Hook for privacy-first routing (always prefer local)
 */
export function usePrivateRouting() {
  return {
    routePrivate: (taskType: TaskType, prompt: string) =>
      smartRouterClient.routePrivate(taskType, prompt),
  };
}

/**
 * Hook for cost-optimized routing
 */
export function useCostOptimizedRouting() {
  return {
    routeCheap: (taskType: TaskType, prompt: string, maxCostCents?: number) =>
      smartRouterClient.routeCheap(taskType, prompt, maxCostCents),
  };
}

/**
 * Hook for quality-optimized routing
 */
export function useQualityRouting() {
  return {
    routeBestQuality: (taskType: TaskType, prompt: string) =>
      smartRouterClient.routeBestQuality(taskType, prompt),
  };
}

/**
 * Combined smart router hook with all common operations
 */
export function useSmartRouter() {
  const providers = useProviders();
  const localProviders = useLocalProviders();
  const cloudProviders = useCloudProviders();
  const config = useRoutingConfig();
  const stats = useRoutingStats();
  const routeRequest = useRouteRequest();
  const recordResult = useRecordResult();
  const updateConfig = useUpdateConfig();
  const registerProvider = useRegisterProvider();
  const updateProviderStatus = useUpdateProviderStatus();

  return {
    // Data
    providers: providers.data ?? [],
    localProviders: localProviders.data ?? [],
    cloudProviders: cloudProviders.data ?? [],
    config: config.data,
    stats: stats.data,

    // Loading states
    isLoadingProviders: providers.isLoading,
    isLoadingConfig: config.isLoading,
    isLoadingStats: stats.isLoading,

    // Routing methods
    route: routeRequest.mutateAsync,
    routeChat: (prompt: string, options?: { privacyLevel?: PrivacyLevel }) =>
      smartRouterClient.routeChat(prompt, options),
    routeCode: (prompt: string, options?: { preferLocal?: boolean }) =>
      smartRouterClient.routeCode(prompt, options),
    routeReasoning: (prompt: string) =>
      smartRouterClient.routeReasoning(prompt),
    routeCreative: (prompt: string) =>
      smartRouterClient.routeCreative(prompt),
    routeAgent: (prompt: string) =>
      smartRouterClient.routeAgent(prompt),
    routePrivate: (taskType: TaskType, prompt: string) =>
      smartRouterClient.routePrivate(taskType, prompt),
    routeCheap: (taskType: TaskType, prompt: string, maxCostCents?: number) =>
      smartRouterClient.routeCheap(taskType, prompt, maxCostCents),
    routeBestQuality: (taskType: TaskType, prompt: string) =>
      smartRouterClient.routeBestQuality(taskType, prompt),

    // Recording
    recordResult: recordResult.mutateAsync,

    // Configuration
    updateConfig: updateConfig.mutateAsync,
    setPreferLocal: (prefer: boolean) =>
      smartRouterClient.setPreferLocal(prefer),
    setPrivacyLevel: (level: PrivacyLevel) =>
      smartRouterClient.setDefaultPrivacyLevel(level),
    setCostOptimization: (strategy: "aggressive" | "balanced" | "quality") =>
      smartRouterClient.setCostOptimization(strategy),

    // Provider management
    registerProvider: registerProvider.mutateAsync,
    updateProviderStatus: updateProviderStatus.mutateAsync,

    // Stats helpers
    getCostSavings: () => smartRouterClient.getCostSavings(),
    getUsageRatio: () => smartRouterClient.getUsageRatio(),

    // Mutation states
    isRouting: routeRequest.isPending,
    isRecording: recordResult.isPending,
    isUpdatingConfig: updateConfig.isPending,
  };
}

export default useSmartRouter;
