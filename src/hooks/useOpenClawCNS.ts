/**
 * React Hooks for OpenClaw Central Nervous System
 * 
 * Provides easy-to-use hooks for the unified AI system:
 * - Ollama local inference
 * - N8n workflow automation
 * - Intelligent routing
 * 
 * 🦞 EXFOLIATE! EXFOLIATE!
 */

import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// =============================================================================
// IPC CLIENT
// =============================================================================

class CNSClient {
  private static instance: CNSClient;
  private ipcRenderer: any;

  private constructor() {
    // @ts-ignore
    this.ipcRenderer = window.electron?.ipcRenderer;
  }

  static getInstance(): CNSClient {
    if (!CNSClient.instance) {
      CNSClient.instance = new CNSClient();
    }
    return CNSClient.instance;
  }

  // CNS Core
  initialize(config?: any) {
    return this.ipcRenderer.invoke("cns:initialize", config);
  }

  shutdown() {
    return this.ipcRenderer.invoke("cns:shutdown");
  }

  getStatus() {
    return this.ipcRenderer.invoke("cns:status");
  }

  getConfig() {
    return this.ipcRenderer.invoke("cns:config:get");
  }

  updateConfig(config: any) {
    return this.ipcRenderer.invoke("cns:config:update", config);
  }

  // Unified AI
  process(request: any) {
    return this.ipcRenderer.invoke("cns:process", request);
  }

  chat(message: string, options?: any) {
    return this.ipcRenderer.invoke("cns:chat", { message, ...options });
  }

  agentTask(agentId: string, task: string, options?: any) {
    return this.ipcRenderer.invoke("cns:agent-task", { agentId, task, ...options });
  }

  // Ollama
  getOllamaStatus() {
    return this.ipcRenderer.invoke("cns:ollama:status");
  }

  checkOllamaHealth() {
    return this.ipcRenderer.invoke("cns:ollama:health");
  }

  getOllamaModels() {
    return this.ipcRenderer.invoke("cns:ollama:models");
  }

  ollamaInference(args: any) {
    return this.ipcRenderer.invoke("cns:ollama:inference", args);
  }

  ollamaEmbed(model: string, input: string | string[]) {
    return this.ipcRenderer.invoke("cns:ollama:embed", { model, input });
  }

  recommendModel(task: any) {
    return this.ipcRenderer.invoke("cns:ollama:recommend-model", task);
  }

  getModelPerformance(model?: string) {
    return this.ipcRenderer.invoke("cns:ollama:performance", model);
  }

  updateOllamaConfig(config: any) {
    return this.ipcRenderer.invoke("cns:ollama:config:update", config);
  }

  // N8n
  getN8nStatus() {
    return this.ipcRenderer.invoke("cns:n8n:status");
  }

  getN8nConnections() {
    return this.ipcRenderer.invoke("cns:n8n:connections");
  }

  addN8nConnection(connection: any) {
    return this.ipcRenderer.invoke("cns:n8n:add-connection", connection);
  }

  removeN8nConnection(connectionId: string) {
    return this.ipcRenderer.invoke("cns:n8n:remove-connection", connectionId);
  }

  testN8nConnection(connectionId: string) {
    return this.ipcRenderer.invoke("cns:n8n:test-connection", connectionId);
  }

  listN8nWorkflows(connectionId?: string) {
    return this.ipcRenderer.invoke("cns:n8n:workflows", connectionId);
  }

  getN8nWorkflow(workflowId: string, connectionId?: string) {
    return this.ipcRenderer.invoke("cns:n8n:workflow", { workflowId, connectionId });
  }

  triggerN8nWorkflow(args: any) {
    return this.ipcRenderer.invoke("cns:n8n:trigger-workflow", args);
  }

  registerN8nWebhook(config: any) {
    return this.ipcRenderer.invoke("cns:n8n:register-webhook", config);
  }

  unregisterN8nWebhook(webhookId: string) {
    return this.ipcRenderer.invoke("cns:n8n:unregister-webhook", webhookId);
  }

  updateN8nConfig(config: any) {
    return this.ipcRenderer.invoke("cns:n8n:config:update", config);
  }

  // Events
  on(channel: string, callback: (data: any) => void) {
    return this.ipcRenderer.on(channel, (data: any) => callback(data));
  }
}

const cnsClient = CNSClient.getInstance();

// =============================================================================
// QUERY KEYS
// =============================================================================

export const CNS_QUERY_KEYS = {
  status: ["cns", "status"],
  config: ["cns", "config"],
  ollama: {
    status: ["cns", "ollama", "status"],
    models: ["cns", "ollama", "models"],
    performance: ["cns", "ollama", "performance"],
  },
  n8n: {
    status: ["cns", "n8n", "status"],
    connections: ["cns", "n8n", "connections"],
    workflows: (connectionId?: string) => ["cns", "n8n", "workflows", connectionId],
  },
} as const;

// =============================================================================
// CNS CORE HOOKS
// =============================================================================

/**
 * Hook for CNS status
 */
export function useCNSStatus() {
  const queryClient = useQueryClient();

  const { data: status, isLoading, error } = useQuery({
    queryKey: CNS_QUERY_KEYS.status,
    queryFn: () => cnsClient.getStatus(),
    refetchInterval: 5000,
  });

  // Listen for status events
  useEffect(() => {
    const unsub = cnsClient.on("cns:event:initialized", () => {
      queryClient.invalidateQueries({ queryKey: CNS_QUERY_KEYS.status });
    });
    return () => unsub?.();
  }, [queryClient]);

  const initializeMutation = useMutation({
    mutationFn: (config?: any) => cnsClient.initialize(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CNS_QUERY_KEYS.status });
    },
  });

  const shutdownMutation = useMutation({
    mutationFn: () => cnsClient.shutdown(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CNS_QUERY_KEYS.status });
    },
  });

  return {
    status,
    isLoading,
    error,
    isInitialized: status?.initialized ?? false,
    ollamaAvailable: status?.ollamaAvailable ?? false,
    n8nConnected: status?.n8nConnected ?? false,
    stats: status?.stats,
    initialize: initializeMutation.mutate,
    shutdown: shutdownMutation.mutate,
    isInitializing: initializeMutation.isPending,
  };
}

/**
 * Hook for CNS configuration
 */
export function useCNSConfig() {
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: CNS_QUERY_KEYS.config,
    queryFn: () => cnsClient.getConfig(),
  });

  const updateMutation = useMutation({
    mutationFn: (updates: any) => cnsClient.updateConfig(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CNS_QUERY_KEYS.config });
    },
  });

  return {
    config,
    isLoading,
    updateConfig: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
  };
}

// =============================================================================
// UNIFIED AI HOOKS
// =============================================================================

/**
 * Hook for unified chat - auto-routes to best backend
 */
export function useCNSChat() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedContent, setStreamedContent] = useState("");

  const chatMutation = useMutation({
    mutationFn: (args: {
      message: string;
      systemPrompt?: string;
      preferLocal?: boolean;
      channel?: string;
    }) => cnsClient.chat(args.message, args),
    onMutate: () => {
      setStreamedContent("");
    },
  });

  // Listen for streaming chunks
  useEffect(() => {
    const unsub = cnsClient.on("cns:event:ollama:inference:chunk", (data: any) => {
      setStreamedContent(prev => prev + (data.content || ""));
    });
    return () => unsub?.();
  }, []);

  const chat = useCallback(
    async (message: string, options?: {
      systemPrompt?: string;
      preferLocal?: boolean;
      channel?: string;
    }) => {
      return chatMutation.mutateAsync({ message, ...options });
    },
    [chatMutation]
  );

  return {
    chat,
    isLoading: chatMutation.isPending,
    isStreaming,
    streamedContent,
    lastResponse: chatMutation.data,
    error: chatMutation.error,
    reset: chatMutation.reset,
  };
}

/**
 * Hook for agent tasks
 */
export function useCNSAgent() {
  const agentMutation = useMutation({
    mutationFn: (args: {
      agentId: string;
      task: string;
      model?: string;
      preferLocal?: boolean;
    }) => cnsClient.agentTask(args.agentId, args.task, args),
  });

  return {
    runTask: agentMutation.mutate,
    runTaskAsync: agentMutation.mutateAsync,
    isRunning: agentMutation.isPending,
    result: agentMutation.data,
    error: agentMutation.error,
  };
}

// =============================================================================
// OLLAMA HOOKS
// =============================================================================

/**
 * Hook for Ollama status and models
 */
export function useOllama() {
  const queryClient = useQueryClient();

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: CNS_QUERY_KEYS.ollama.status,
    queryFn: () => cnsClient.getOllamaStatus(),
    refetchInterval: 10000,
  });

  const { data: modelsData } = useQuery({
    queryKey: CNS_QUERY_KEYS.ollama.models,
    queryFn: () => cnsClient.getOllamaModels(),
    enabled: status?.ollamaAvailable ?? false,
  });

  // Listen for connection events
  useEffect(() => {
    const unsubConnected = cnsClient.on("cns:event:ollama:connected", () => {
      queryClient.invalidateQueries({ queryKey: CNS_QUERY_KEYS.ollama.status });
      queryClient.invalidateQueries({ queryKey: CNS_QUERY_KEYS.ollama.models });
    });

    const unsubDisconnected = cnsClient.on("cns:event:ollama:disconnected", () => {
      queryClient.invalidateQueries({ queryKey: CNS_QUERY_KEYS.ollama.status });
    });

    return () => {
      unsubConnected?.();
      unsubDisconnected?.();
    };
  }, [queryClient]);

  const healthMutation = useMutation({
    mutationFn: () => cnsClient.checkOllamaHealth(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CNS_QUERY_KEYS.ollama.status });
    },
  });

  const refreshModelsMutation = useMutation({
    mutationFn: () => cnsClient.getOllamaModels(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CNS_QUERY_KEYS.ollama.models });
    },
  });

  return {
    status,
    isLoading: statusLoading,
    isAvailable: status?.ollamaAvailable ?? false,
    models: modelsData?.models ?? [],
    config: status?.config,
    checkHealth: healthMutation.mutate,
    refreshModels: refreshModelsMutation.mutate,
    isRefreshing: refreshModelsMutation.isPending,
  };
}

/**
 * Hook for Ollama inference
 */
export function useOllamaInference() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [chunks, setChunks] = useState<string[]>([]);

  const inferenceMutation = useMutation({
    mutationFn: (args: {
      model: string;
      messages?: Array<{ role: string; content: string }>;
      prompt?: string;
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
    }) => cnsClient.ollamaInference(args),
    onMutate: () => {
      setChunks([]);
      setIsStreaming(true);
    },
    onSettled: () => {
      setIsStreaming(false);
    },
  });

  // Listen for streaming
  useEffect(() => {
    const unsub = cnsClient.on("cns:event:ollama:inference:chunk", (data: any) => {
      if (data.content) {
        setChunks(prev => [...prev, data.content]);
      }
    });
    return () => unsub?.();
  }, []);

  const embedMutation = useMutation({
    mutationFn: (args: { model: string; input: string | string[] }) =>
      cnsClient.ollamaEmbed(args.model, args.input),
  });

  const recommendMutation = useMutation({
    mutationFn: (task: any) => cnsClient.recommendModel(task),
  });

  return {
    // Inference
    inference: inferenceMutation.mutate,
    inferenceAsync: inferenceMutation.mutateAsync,
    isInferencing: inferenceMutation.isPending,
    isStreaming,
    streamedContent: chunks.join(""),
    result: inferenceMutation.data,
    error: inferenceMutation.error,

    // Embedding
    embed: embedMutation.mutate,
    embedAsync: embedMutation.mutateAsync,
    isEmbedding: embedMutation.isPending,
    embeddings: embedMutation.data,

    // Model recommendation
    recommendModel: recommendMutation.mutateAsync,
  };
}

/**
 * Hook for Ollama model performance
 */
export function useOllamaPerformance() {
  const { data, isLoading } = useQuery({
    queryKey: CNS_QUERY_KEYS.ollama.performance,
    queryFn: () => cnsClient.getModelPerformance(),
    refetchInterval: 30000,
  });

  return {
    performance: data?.performance ?? {},
    isLoading,
  };
}

// =============================================================================
// N8N HOOKS
// =============================================================================

/**
 * Hook for N8n connections
 */
export function useN8nConnections() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: CNS_QUERY_KEYS.n8n.connections,
    queryFn: () => cnsClient.getN8nConnections(),
  });

  const addMutation = useMutation({
    mutationFn: (connection: {
      id: string;
      name: string;
      baseUrl: string;
      apiKey?: string;
    }) => cnsClient.addN8nConnection(connection),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CNS_QUERY_KEYS.n8n.connections });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (connectionId: string) => cnsClient.removeN8nConnection(connectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CNS_QUERY_KEYS.n8n.connections });
    },
  });

  const testMutation = useMutation({
    mutationFn: (connectionId: string) => cnsClient.testN8nConnection(connectionId),
  });

  return {
    connections: data?.connections ?? [],
    isLoading,
    addConnection: addMutation.mutate,
    removeConnection: removeMutation.mutate,
    testConnection: testMutation.mutateAsync,
    isAdding: addMutation.isPending,
    isRemoving: removeMutation.isPending,
    isTesting: testMutation.isPending,
  };
}

/**
 * Hook for N8n workflows
 */
export function useN8nWorkflows(connectionId?: string) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: CNS_QUERY_KEYS.n8n.workflows(connectionId),
    queryFn: () => cnsClient.listN8nWorkflows(connectionId),
  });

  const triggerMutation = useMutation({
    mutationFn: (args: {
      workflowId: string;
      data?: Record<string, unknown>;
      waitForCompletion?: boolean;
      timeout?: number;
    }) => cnsClient.triggerN8nWorkflow({ ...args, connectionId }),
  });

  return {
    workflows: data?.workflows ?? [],
    isLoading,
    refetch,
    triggerWorkflow: triggerMutation.mutate,
    triggerWorkflowAsync: triggerMutation.mutateAsync,
    isTriggering: triggerMutation.isPending,
    lastExecution: triggerMutation.data,
    triggerError: triggerMutation.error,
  };
}

/**
 * Hook for N8n webhooks (event-to-workflow mappings)
 */
export function useN8nWebhooks() {
  const queryClient = useQueryClient();

  const registerMutation = useMutation({
    mutationFn: (config: {
      eventPattern: string;
      workflowId: string;
      connectionId: string;
    }) => cnsClient.registerN8nWebhook(config),
  });

  const unregisterMutation = useMutation({
    mutationFn: (webhookId: string) => cnsClient.unregisterN8nWebhook(webhookId),
  });

  return {
    registerWebhook: registerMutation.mutate,
    registerWebhookAsync: registerMutation.mutateAsync,
    unregisterWebhook: unregisterMutation.mutate,
    isRegistering: registerMutation.isPending,
    isUnregistering: unregisterMutation.isPending,
  };
}

// =============================================================================
// COMPOSITE HOOK
// =============================================================================

/**
 * All-in-one hook for the OpenClaw CNS
 */
export function useOpenClawCNS() {
  const cnsStatus = useCNSStatus();
  const ollama = useOllama();
  const n8nConnections = useN8nConnections();
  const chat = useCNSChat();

  return {
    // Status
    isInitialized: cnsStatus.isInitialized,
    stats: cnsStatus.stats,
    initialize: cnsStatus.initialize,
    shutdown: cnsStatus.shutdown,

    // Ollama
    ollamaAvailable: ollama.isAvailable,
    ollamaModels: ollama.models,
    refreshOllamaModels: ollama.refreshModels,

    // N8n
    n8nConnected: n8nConnections.connections.some((c: any) => c.status === "connected"),
    n8nConnections: n8nConnections.connections,
    addN8nConnection: n8nConnections.addConnection,

    // Chat
    chat: chat.chat,
    isChatting: chat.isLoading,

    // Loading
    isLoading: cnsStatus.isLoading || ollama.isLoading || n8nConnections.isLoading,
  };
}

export default useOpenClawCNS;
