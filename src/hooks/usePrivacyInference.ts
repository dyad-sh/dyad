/**
 * React hooks for Privacy-Preserving Inference Bridge
 * 
 * Provides easy access to local-first AI with federated fallback,
 * ensuring no data harvesting occurs.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "../ipc/ipc_client";
import type {
  InferenceBridgeState,
  InferenceBridgeConfig,
  CreateInferenceRequest,
  PrivacyPreservingInferenceResponse,
  InferenceBridgeStats,
  PrivacyLevel,
  DataHandling,
} from "../types/privacy_inference_types";

const ipcClient = IpcClient.getInstance();

// =============================================================================
// QUERY KEYS
// =============================================================================

export const privacyInferenceKeys = {
  all: ["privacy-inference"] as const,
  state: () => [...privacyInferenceKeys.all, "state"] as const,
  config: () => [...privacyInferenceKeys.all, "config"] as const,
  stats: () => [...privacyInferenceKeys.all, "stats"] as const,
  privacyProfiles: () => [...privacyInferenceKeys.all, "privacy-profiles"] as const,
  routingProfiles: () => [...privacyInferenceKeys.all, "routing-profiles"] as const,
};

// =============================================================================
// STATE & CONFIG HOOKS
// =============================================================================

/**
 * Initialize and get the inference bridge state
 */
export function useInferenceBridgeState() {
  return useQuery({
    queryKey: privacyInferenceKeys.state(),
    queryFn: async () => {
      // Initialize on first call
      return await ipcClient.initializeInferenceBridge();
    },
    staleTime: 5000, // State can change frequently
    refetchInterval: 10000, // Poll for updates
  });
}

/**
 * Get the inference bridge configuration
 */
export function useInferenceBridgeConfig() {
  return useQuery({
    queryKey: privacyInferenceKeys.config(),
    queryFn: () => ipcClient.getInferenceBridgeConfig(),
    staleTime: 30000,
  });
}

/**
 * Update the inference bridge configuration
 */
export function useUpdateInferenceBridgeConfig() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (config: Partial<InferenceBridgeConfig>) =>
      ipcClient.updateInferenceBridgeConfig(config),
    onSuccess: (newConfig) => {
      queryClient.setQueryData(privacyInferenceKeys.config(), newConfig);
    },
  });
}

// =============================================================================
// INFERENCE HOOKS
// =============================================================================

/**
 * Main inference hook - privacy-preserving AI completion
 */
export function usePrivacyInference() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (request: CreateInferenceRequest) =>
      ipcClient.privacyInfer(request),
    onSuccess: () => {
      // Invalidate stats after inference
      queryClient.invalidateQueries({ queryKey: privacyInferenceKeys.stats() });
      queryClient.invalidateQueries({ queryKey: privacyInferenceKeys.state() });
    },
  });
}

/**
 * Quick local completion - maximum privacy, never leaves device
 */
export function useLocalComplete() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ prompt, modelId }: { prompt: string; modelId?: string }) =>
      ipcClient.localComplete(prompt, modelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: privacyInferenceKeys.stats() });
    },
  });
}

/**
 * Run a task through a custom agent
 */
export function useAgentTask() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ agentId, task }: { agentId: string; task: unknown }) =>
      ipcClient.agentTask(agentId, task),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: privacyInferenceKeys.stats() });
    },
  });
}

// =============================================================================
// STATS HOOKS
// =============================================================================

/**
 * Get inference statistics (cost savings, privacy metrics, etc.)
 */
export function useInferenceStats() {
  return useQuery({
    queryKey: privacyInferenceKeys.stats(),
    queryFn: () => ipcClient.getInferenceStats(),
    staleTime: 5000,
    refetchInterval: 30000,
  });
}

/**
 * Reset inference statistics
 */
export function useResetInferenceStats() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: () => ipcClient.resetInferenceStats(),
    onSuccess: (newStats) => {
      queryClient.setQueryData(privacyInferenceKeys.stats(), newStats);
    },
  });
}

// =============================================================================
// REGISTRATION HOOKS
// =============================================================================

/**
 * Register a trained adapter for inference
 */
export function useRegisterInferenceAdapter() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (adapter: {
      id: string;
      name: string;
      baseModelId: string;
      method: string;
      path: string;
    }) => ipcClient.registerInferenceAdapter(adapter),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: privacyInferenceKeys.state() });
    },
  });
}

/**
 * Register a custom agent for inference
 */
export function useRegisterInferenceAgent() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (agent: {
      id: string;
      name: string;
      type: string;
      modelId: string;
      adapterId?: string;
    }) => ipcClient.registerInferenceAgent(agent),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: privacyInferenceKeys.state() });
    },
  });
}

// =============================================================================
// PEER MANAGEMENT HOOKS
// =============================================================================

/**
 * Add a trusted peer for federated inference
 */
export function useAddTrustedPeer() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (peerId: string) => ipcClient.addTrustedPeer(peerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: privacyInferenceKeys.state() });
    },
  });
}

/**
 * Remove a trusted peer
 */
export function useRemoveTrustedPeer() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (peerId: string) => ipcClient.removeTrustedPeer(peerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: privacyInferenceKeys.state() });
    },
  });
}

// =============================================================================
// PROFILE HOOKS
// =============================================================================

/**
 * Get available privacy profiles
 */
export function usePrivacyProfiles() {
  return useQuery({
    queryKey: privacyInferenceKeys.privacyProfiles(),
    queryFn: () => ipcClient.getPrivacyProfiles(),
    staleTime: Infinity, // Profiles don't change
  });
}

/**
 * Get available routing profiles
 */
export function useRoutingProfiles() {
  return useQuery({
    queryKey: privacyInferenceKeys.routingProfiles(),
    queryFn: () => ipcClient.getRoutingProfiles(),
    staleTime: Infinity,
  });
}

// =============================================================================
// CONVENIENCE HOOKS
// =============================================================================

/**
 * High-level hook for privacy-first AI completions
 * 
 * Usage:
 * ```tsx
 * const { complete, isLoading, response } = usePrivacyFirstAI();
 * 
 * // Maximum privacy (local only)
 * complete({ prompt: "Hello", privacy: "maximum" });
 * 
 * // Balanced (federated with encryption)
 * complete({ prompt: "Hello", privacy: "standard" });
 * ```
 */
export function usePrivacyFirstAI() {
  const inference = usePrivacyInference();
  const stats = useInferenceStats();
  
  const complete = async ({
    prompt,
    privacy = "high",
    modelId,
    agentId,
  }: {
    prompt: string;
    privacy?: "maximum" | "high" | "standard" | "balanced";
    modelId?: string;
    agentId?: string;
  }) => {
    const privacyConfig = getPrivacyConfig(privacy);
    
    return inference.mutateAsync({
      type: "completion",
      payload: { prompt },
      modelConfig: {
        modelId,
        agentId: agentId as any,
        preferLocal: true,
      },
      privacy: privacyConfig,
    });
  };
  
  return {
    complete,
    isLoading: inference.isPending,
    response: inference.data,
    error: inference.error,
    stats: stats.data,
  };
}

/**
 * Hook for chat-style AI interactions with privacy
 */
export function usePrivacyFirstChat() {
  const inference = usePrivacyInference();
  
  const chat = async ({
    messages,
    systemPrompt,
    privacy = "high",
    modelId,
  }: {
    messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }>;
    systemPrompt?: string;
    privacy?: "maximum" | "high" | "standard" | "balanced";
    modelId?: string;
  }) => {
    const privacyConfig = getPrivacyConfig(privacy);
    
    return inference.mutateAsync({
      type: "chat",
      payload: {
        messages,
        systemPrompt,
      },
      modelConfig: {
        modelId,
        preferLocal: true,
      },
      privacy: privacyConfig,
    });
  };
  
  return {
    chat,
    isLoading: inference.isPending,
    response: inference.data,
    error: inference.error,
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getPrivacyConfig(level: "maximum" | "high" | "standard" | "balanced") {
  const configs = {
    maximum: {
      level: "local_only" as PrivacyLevel,
      dataHandling: "never_share" as DataHandling,
      allowPromptHashing: false,
      allowResponseHashing: false,
      allowMetricSharing: false,
      allowModelIdSharing: false,
      encryptInTransit: true,
      encryptAtRest: true,
      keyRotationEnabled: true,
    },
    high: {
      level: "local_preferred" as PrivacyLevel,
      dataHandling: "hash_only" as DataHandling,
      allowPromptHashing: true,
      allowResponseHashing: true,
      allowMetricSharing: false,
      allowModelIdSharing: false,
      encryptInTransit: true,
      encryptAtRest: true,
      keyRotationEnabled: true,
    },
    standard: {
      level: "federated" as PrivacyLevel,
      dataHandling: "encrypted" as DataHandling,
      allowPromptHashing: true,
      allowResponseHashing: true,
      allowMetricSharing: true,
      allowModelIdSharing: true,
      encryptInTransit: true,
      encryptAtRest: true,
      keyRotationEnabled: true,
    },
    balanced: {
      level: "hybrid" as PrivacyLevel,
      dataHandling: "encrypted" as DataHandling,
      allowPromptHashing: true,
      allowResponseHashing: true,
      allowMetricSharing: true,
      allowModelIdSharing: true,
      encryptInTransit: true,
      encryptAtRest: false,
      keyRotationEnabled: false,
    },
  };
  
  return configs[level];
}

// =============================================================================
// TYPES EXPORT
// =============================================================================

export type {
  InferenceBridgeState,
  InferenceBridgeConfig,
  CreateInferenceRequest,
  PrivacyPreservingInferenceResponse,
  InferenceBridgeStats,
};
