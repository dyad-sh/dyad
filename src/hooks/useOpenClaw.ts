/**
 * React hooks for OpenClaw Gateway integration
 * Provides easy-to-use hooks for chat, agent tasks, and autonomous creation
 */

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { IpcClient } from "@/ipc/ipc_client";
import { OpenClawClient } from "@/ipc/openclaw_client";
import type {
  OpenClawGatewayStatus,
  OpenClawProviderStatus,
  OpenClawChatParams,
  OpenClawChatResult,
  OpenClawAgentTaskParams,
  OpenClawAgentTaskResult,
  OpenClawQuickGenerateParams,
  OpenClawAutonomousAppParams,
} from "@/ipc/ipc_types";
import type { OpenClawEvent, OpenClawConfig, ClaudeCodeConfig } from "@/types/openclaw_types";
import type {
  OpenClawScrapingConfig,
  OpenClawScrapingResult,
  OpenClawImageGenConfig,
  OpenClawImageGenResult,
  OpenClawDataPipelineConfig,
  OpenClawPipelineResult,
} from "@/types/openclaw_types";

// Query keys
const OPENCLAW_QUERY_KEYS = {
  status: ["OpenClaw", "status"],
  config: ["OpenClaw", "config"],
  claudeCodeConfig: ["OpenClaw", "claudeCode", "config"],
  providers: ["OpenClaw", "providers"],
  providerHealth: ["OpenClaw", "providers", "health"],
  dataJobs: ["OpenClaw", "data", "jobs"],
  availableModels: ["OpenClaw", "kanban", "models"],
};

/**
 * Hook to manage OpenClaw Gateway status
 */
export function useOpenClawStatus() {
  const queryClient = useQueryClient();

  const { data: status, isLoading, error } = useQuery<OpenClawGatewayStatus>({
    queryKey: OPENCLAW_QUERY_KEYS.status,
    queryFn: () => OpenClawClient.getGatewayStatus(),
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  const startGateway = useMutation({
    mutationFn: () => OpenClawClient.startGateway(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.status });
    },
  });

  const stopGateway = useMutation({
    mutationFn: () => OpenClawClient.stopGateway(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.status });
    },
  });

  const initialize = useMutation({
    mutationFn: () => OpenClawClient.initialize(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.status });
    },
  });

  return {
    status,
    isLoading,
    error,
    isConnected: status?.status === "connected",
    startGateway: startGateway.mutate,
    stopGateway: stopGateway.mutate,
    initialize: initialize.mutate,
    isStarting: startGateway.isPending,
    isStopping: stopGateway.isPending,
  };
}

/**
 * Hook to manage OpenClaw configuration
 */
export function useOpenClawConfig() {
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery<OpenClawConfig>({
    queryKey: OPENCLAW_QUERY_KEYS.config,
    queryFn: () => OpenClawClient.getConfig(),
  });

  const updateConfig = useMutation({
    mutationFn: (updates: Partial<OpenClawConfig>) => OpenClawClient.updateConfig(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.config });
    },
  });

  return {
    config,
    isLoading,
    updateConfig: updateConfig.mutate,
    isUpdating: updateConfig.isPending,
  };
}

/**
 * Hook to manage Claude Code configuration
 */
export function useClaudeCodeConfig() {
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery<ClaudeCodeConfig>({
    queryKey: OPENCLAW_QUERY_KEYS.claudeCodeConfig,
    queryFn: () => OpenClawClient.getClaudeCodeConfig(),
  });

  const updateConfig = useMutation({
    mutationFn: (updates: Partial<ClaudeCodeConfig>) => 
      OpenClawClient.updateClaudeCodeConfig(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.claudeCodeConfig });
    },
  });

  const enableClaudeCode = useMutation({
    mutationFn: (config?: Partial<ClaudeCodeConfig>) => 
      OpenClawClient.enableClaudeCode(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.claudeCodeConfig });
    },
  });

  return {
    config,
    isLoading,
    updateConfig: updateConfig.mutate,
    enableClaudeCode: enableClaudeCode.mutate,
    isUpdating: updateConfig.isPending,
  };
}

/**
 * Hook to manage AI providers
 */
export function useOpenClawProviders() {
  const queryClient = useQueryClient();

  const { data: providers, isLoading } = useQuery<OpenClawProviderStatus[]>({
    queryKey: OPENCLAW_QUERY_KEYS.providers,
    queryFn: () => OpenClawClient.listProviders(),
  });

  const { data: health, refetch: refreshHealth } = useQuery<Record<string, boolean>>({
    queryKey: OPENCLAW_QUERY_KEYS.providerHealth,
    queryFn: () => OpenClawClient.checkProviderHealth(),
  });

  const configureProvider = useMutation({
    mutationFn: (params: { name: string; config: Record<string, unknown> }) =>
      OpenClawClient.configureProvider({
        name: params.name,
        config: params.config as any,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.providers });
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.providerHealth });
    },
  });

  const setApiKey = useMutation({
    mutationFn: ({ provider, apiKey }: { provider: string; apiKey: string }) =>
      OpenClawClient.setProviderApiKey(provider, apiKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.providers });
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.providerHealth });
    },
  });

  const setupOllama = useMutation({
    mutationFn: (config?: { baseURL?: string; model?: string }) =>
      OpenClawClient.setupOllama(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.providers });
    },
  });

  const setupAnthropic = useMutation({
    mutationFn: ({ apiKey, model }: { apiKey: string; model?: string }) =>
      OpenClawClient.setupAnthropic(apiKey, { model }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.providers });
    },
  });

  return {
    providers,
    health,
    isLoading,
    refreshHealth,
    configureProvider: configureProvider.mutate,
    setApiKey: setApiKey.mutate,
    setupOllama: setupOllama.mutate,
    setupAnthropic: setupAnthropic.mutate,
    isConfiguring: configureProvider.isPending,
  };
}

/**
 * Hook for OpenClaw chat
 */
export function useOpenClawChat() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedContent, setStreamedContent] = useState("");

  const chat = useMutation<OpenClawChatResult, Error, OpenClawChatParams>({
    mutationFn: (request) => OpenClawClient.chat(request),
  });

  const simpleChat = useMutation<string, Error, {
    message: string;
    systemPrompt?: string;
    useLocal?: boolean;
  }>({
    mutationFn: ({ message, systemPrompt, useLocal }) =>
      OpenClawClient.simpleChat(message, { systemPrompt, useLocal }),
  });

  // Subscribe to streaming events
  useEffect(() => {
    const handleStreamChunk = (event: OpenClawEvent) => {
      if (event.type === "message:received" && event.source === "stream") {
        const data = event.data as { chunk: { delta: string } };
        setStreamedContent((prev) => prev + (data.chunk?.delta || ""));
      }
    };

    OpenClawClient.addEventListener("message:received", handleStreamChunk);

    return () => {
      OpenClawClient.removeEventListener("message:received", handleStreamChunk);
    };
  }, []);

  const startStream = useCallback(async (request: OpenClawChatParams) => {
    setIsStreaming(true);
    setStreamedContent("");
    
    try {
      const result = await OpenClawClient.chatStream(request);
      setIsStreaming(false);
      return result;
    } catch (error) {
      setIsStreaming(false);
      throw error;
    }
  }, []);

  return {
    chat: chat.mutateAsync,
    simpleChat: simpleChat.mutateAsync,
    startStream,
    isLoading: chat.isPending || simpleChat.isPending,
    isStreaming,
    streamedContent,
    error: chat.error || simpleChat.error,
    lastResponse: chat.data,
  };
}

/**
 * Hook for executing agent tasks
 */
export function useOpenClawAgentTasks() {
  const executeTask = useMutation<OpenClawAgentTaskResult, Error, OpenClawAgentTaskParams>({
    mutationFn: (task) => OpenClawClient.executeAgentTask(task),
  });

  const executeWithN8n = useMutation<OpenClawAgentTaskResult, Error, {
    task: OpenClawAgentTaskParams;
    workflowId?: string;
    triggerWorkflow?: boolean;
  }>({
    mutationFn: (params) => OpenClawClient.executeAgentTaskWithN8n(params),
  });

  return {
    executeTask: executeTask.mutateAsync,
    executeWithN8n: executeWithN8n.mutateAsync,
    isExecuting: executeTask.isPending || executeWithN8n.isPending,
    error: executeTask.error || executeWithN8n.error,
    lastResult: executeTask.data || executeWithN8n.data,
  };
}

/**
 * Hook for autonomous app creation
 */
export function useAutonomousCreation() {
  const createApp = useMutation<OpenClawAgentTaskResult, Error, OpenClawAutonomousAppParams>({
    mutationFn: (params) => OpenClawClient.createAutonomousApp(params),
  });

  const refactorCode = useMutation<OpenClawAgentTaskResult, Error, {
    code: string;
    language: string;
    instructions: string;
    useLocal?: boolean;
  }>({
    mutationFn: (params) => OpenClawClient.refactorCode(params),
  });

  const analyzeCodebase = useMutation<OpenClawAgentTaskResult, Error, {
    files: Array<{ path: string; content: string }>;
    analysisType: "security" | "performance" | "quality" | "all";
    useLocal?: boolean;
  }>({
    mutationFn: (params) => OpenClawClient.analyzeCodebase(params),
  });

  return {
    createApp: createApp.mutateAsync,
    refactorCode: refactorCode.mutateAsync,
    analyzeCodebase: analyzeCodebase.mutateAsync,
    isCreating: createApp.isPending,
    isRefactoring: refactorCode.isPending,
    isAnalyzing: analyzeCodebase.isPending,
    isProcessing: createApp.isPending || refactorCode.isPending || analyzeCodebase.isPending,
  };
}

/**
 * Hook for quick code actions
 */
export function useQuickCodeActions() {
  const generateCode = useMutation({
    mutationFn: (params: OpenClawQuickGenerateParams) =>
      OpenClawClient.generateCode(params),
  });

  const explainCode = useMutation({
    mutationFn: (params: { code: string; language?: string; detail?: "brief" | "detailed" | "beginner" }) =>
      OpenClawClient.explainCode(params),
  });

  const fixError = useMutation({
    mutationFn: (params: { code: string; error: string; language?: string }) =>
      OpenClawClient.fixError(params),
  });

  return {
    generateCode: generateCode.mutateAsync,
    explainCode: explainCode.mutateAsync,
    fixError: fixError.mutateAsync,
    isGenerating: generateCode.isPending,
    isExplaining: explainCode.isPending,
    isFixing: fixError.isPending,
    isProcessing: generateCode.isPending || explainCode.isPending || fixError.isPending,
  };
}

/**
 * Hook for OpenClaw events
 */
export function useOpenClawEvents(eventTypes?: string[]) {
  const [events, setEvents] = useState<OpenClawEvent[]>([]);

  useEffect(() => {
    const handleEvent = (event: OpenClawEvent) => {
      if (!eventTypes || eventTypes.includes(event.type)) {
        setEvents((prev) => [...prev.slice(-99), event]); // Keep last 100 events
      }
    };

    OpenClawClient.addEventListener("*", handleEvent);
    OpenClawClient.subscribe().catch(console.error);

    return () => {
      OpenClawClient.removeEventListener("*", handleEvent);
    };
  }, [eventTypes]);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  return {
    events,
    clearEvents,
    lastEvent: events[events.length - 1],
  };
}

/**
 * Combined hook for easy OpenClaw integration
 */
export function useOpenClaw() {
  const status = useOpenClawStatus();
  const config = useOpenClawConfig();
  const providers = useOpenClawProviders();
  const chat = useOpenClawChat();
  const agentTasks = useOpenClawAgentTasks();
  const autonomousCreation = useAutonomousCreation();
  const quickActions = useQuickCodeActions();

  return {
    // Status
    isConnected: status.isConnected,
    gatewayStatus: status.status,
    initialize: status.initialize,
    startGateway: status.startGateway,
    stopGateway: status.stopGateway,

    // Providers
    providers: providers.providers,
    setupOllama: providers.setupOllama,
    setupAnthropic: providers.setupAnthropic,
    setApiKey: providers.setApiKey,

    // Chat
    chat: chat.chat,
    simpleChat: chat.simpleChat,
    startStream: chat.startStream,
    streamedContent: chat.streamedContent,

    // Agent Tasks
    executeTask: agentTasks.executeTask,
    executeWithN8n: agentTasks.executeWithN8n,

    // Autonomous Creation
    createApp: autonomousCreation.createApp,
    refactorCode: autonomousCreation.refactorCode,
    analyzeCodebase: autonomousCreation.analyzeCodebase,

    // Quick Actions
    generateCode: quickActions.generateCode,
    explainCode: quickActions.explainCode,
    fixError: quickActions.fixError,

    // Loading states
    isLoading: status.isLoading || config.isLoading || providers.isLoading,
    isProcessing: chat.isLoading || agentTasks.isExecuting || autonomousCreation.isProcessing || quickActions.isProcessing,
  };
}

// =============================================================================
// DATA PIPELINE HOOKS
// =============================================================================

/**
 * Hook for AI-enhanced web scraping
 */
export function useOpenClawScraping() {
  const queryClient = useQueryClient();

  const scrape = useMutation({
    mutationFn: (config: OpenClawScrapingConfig) => OpenClawClient.scrape(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.dataJobs });
    },
  });

  const scrapeSingle = useMutation({
    mutationFn: ({ url, options }: { url: string; options?: Partial<OpenClawScrapingConfig> }) => 
      OpenClawClient.scrapeSingle(url, options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.dataJobs });
    },
  });

  const quickScrape = useMutation({
    mutationFn: ({ url, instructions }: { url: string; instructions?: string }) => 
      OpenClawClient.quickScrape(url, instructions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.dataJobs });
    },
  });

  return {
    scrape: scrape.mutateAsync,
    scrapeSingle: scrapeSingle.mutateAsync,
    quickScrape: quickScrape.mutateAsync,
    isLoading: scrape.isPending || scrapeSingle.isPending || quickScrape.isPending,
    lastResults: scrape.data,
    lastSingleResult: scrapeSingle.data || quickScrape.data,
    error: scrape.error || scrapeSingle.error || quickScrape.error,
  };
}

/**
 * Hook for AI-enhanced image generation
 */
export function useOpenClawImageGen() {
  const generateImage = useMutation({
    mutationFn: (config: OpenClawImageGenConfig) => OpenClawClient.generateImage(config),
  });

  const enhancePrompt = useMutation({
    mutationFn: ({ prompt, options }: { prompt: string; options?: { style?: string; preferLocal?: boolean } }) => 
      OpenClawClient.enhanceImagePrompt(prompt, options),
  });

  const quickGenerate = useMutation({
    mutationFn: ({ prompt, options }: { 
      prompt: string; 
      options?: { style?: string; width?: number; height?: number; model?: string } 
    }) => OpenClawClient.quickGenerateImage(prompt, options),
  });

  return {
    generateImage: generateImage.mutateAsync,
    enhancePrompt: enhancePrompt.mutateAsync,
    quickGenerate: quickGenerate.mutateAsync,
    isGenerating: generateImage.isPending || quickGenerate.isPending,
    isEnhancing: enhancePrompt.isPending,
    lastResult: generateImage.data || quickGenerate.data,
    enhancedPrompt: enhancePrompt.data,
    error: generateImage.error || quickGenerate.error,
  };
}

/**
 * Hook for data pipeline orchestration
 */
export function useOpenClawPipeline() {
  const queryClient = useQueryClient();

  const runPipeline = useMutation({
    mutationFn: (config: OpenClawDataPipelineConfig) => OpenClawClient.runPipeline(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.dataJobs });
    },
  });

  const createScrapingPipeline = useMutation({
    mutationFn: ({ name, urls, options }: { 
      name: string; 
      urls: string[]; 
      options?: { aiInstructions?: string; datasetId?: string } 
    }) => OpenClawClient.createScrapingPipeline(name, urls, options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.dataJobs });
    },
  });

  return {
    runPipeline: runPipeline.mutateAsync,
    createScrapingPipeline: createScrapingPipeline.mutateAsync,
    isRunning: runPipeline.isPending || createScrapingPipeline.isPending,
    lastResult: runPipeline.data || createScrapingPipeline.data,
    error: runPipeline.error || createScrapingPipeline.error,
  };
}

/**
 * Hook for managing data pipeline jobs
 */
export function useOpenClawDataJobs() {
  const queryClient = useQueryClient();

  const { data: jobs, isLoading, refetch } = useQuery({
    queryKey: OPENCLAW_QUERY_KEYS.dataJobs,
    queryFn: () => OpenClawClient.listDataJobs(),
    refetchInterval: 2000, // Poll every 2 seconds while jobs are active
  });

  const cancelJob = useMutation({
    mutationFn: (jobId: string) => OpenClawClient.cancelDataJob(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.dataJobs });
    },
  });

  const getJob = useCallback(async (jobId: string) => {
    return OpenClawClient.getDataJob(jobId);
  }, []);

  return {
    jobs: jobs || [],
    isLoading,
    refetch,
    cancelJob: cancelJob.mutateAsync,
    isCancelling: cancelJob.isPending,
    getJob,
    activeJobs: (jobs || []).filter(j => j.status === "running"),
    hasActiveJobs: (jobs || []).some(j => j.status === "running"),
  };
}

/**
 * Hook for data pipeline events
 */
export function useOpenClawDataEvents() {
  const [events, setEvents] = useState<Array<{ type: string; data: unknown; timestamp: number }>>([]);
  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    const handleEvent = (event: unknown) => {
      setEvents((prev) => [
        ...prev.slice(-99), // Keep last 100 events
        { 
          type: "data:event", 
          data: event, 
          timestamp: Date.now() 
        },
      ]);
    };

    // Subscribe to data events
    OpenClawClient.addDataEventListener("*", handleEvent);
    OpenClawClient.subscribeToDataEvents().then((result) => {
      setIsSubscribed(result.success);
    });

    return () => {
      OpenClawClient.removeDataEventListener("*", handleEvent);
      OpenClawClient.unsubscribeFromDataEvents();
    };
  }, []);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  return {
    events,
    isSubscribed,
    clearEvents,
    lastEvent: events[events.length - 1],
    jobEvents: events.filter(e => {
      const data = e.data as Record<string, unknown>;
      return data && typeof data === "object" && "jobId" in data;
    }),
  };
}

/**
 * Combined hook for all data pipeline operations
 */
export function useOpenClawDataPipeline() {
  const scraping = useOpenClawScraping();
  const imageGen = useOpenClawImageGen();
  const pipeline = useOpenClawPipeline();
  const jobs = useOpenClawDataJobs();
  const events = useOpenClawDataEvents();

  // Initialize data pipeline on mount
  useEffect(() => {
    OpenClawClient.initializeDataPipeline().catch(console.error);
  }, []);

  return {
    // Scraping
    scrape: scraping.scrape,
    scrapeSingle: scraping.scrapeSingle,
    quickScrape: scraping.quickScrape,
    isScraping: scraping.isLoading,

    // Image Generation
    generateImage: imageGen.generateImage,
    enhancePrompt: imageGen.enhancePrompt,
    quickGenerateImage: imageGen.quickGenerate,
    isGenerating: imageGen.isGenerating,

    // Pipeline
    runPipeline: pipeline.runPipeline,
    createScrapingPipeline: pipeline.createScrapingPipeline,
    isPipelineRunning: pipeline.isRunning,

    // Jobs
    jobs: jobs.jobs,
    activeJobs: jobs.activeJobs,
    hasActiveJobs: jobs.hasActiveJobs,
    cancelJob: jobs.cancelJob,
    getJob: jobs.getJob,

    // Events
    events: events.events,
    jobEvents: events.jobEvents,
    lastEvent: events.lastEvent,
    clearEvents: events.clearEvents,

    // Loading states
    isLoading: scraping.isLoading || imageGen.isGenerating || pipeline.isRunning || jobs.isLoading,
  };
}

/**
 * Extended combined hook including data pipeline
 */
export function useOpenClawFull() {
  const base = useOpenClaw();
  const dataPipeline = useOpenClawDataPipeline();

  return {
    ...base,
    
    // Data Pipeline
    dataPipeline,
    scrape: dataPipeline.scrape,
    quickScrape: dataPipeline.quickScrape,
    generateImage: dataPipeline.generateImage,
    quickGenerateImage: dataPipeline.quickGenerateImage,
    runPipeline: dataPipeline.runPipeline,
    dataJobs: dataPipeline.jobs,
    hasActiveDataJobs: dataPipeline.hasActiveJobs,
  };
}

// =============================================================================
// SYSTEM INTEGRATION HOOKS
// =============================================================================

const SYSTEM_QUERY_KEYS = {
  config: ["OpenClaw", "system", "config"],
  stats: ["OpenClaw", "system", "stats"],
  history: ["OpenClaw", "system", "history"],
  localHubStatus: ["OpenClaw", "local-hub", "status"],
  combinedStats: ["OpenClaw", "combined-stats"],
};

/**
 * Hook to manage OpenClaw System Integration
 * This is the unified AI gateway across all JoyCreate systems
 */
export function useOpenClawSystemIntegration() {
  const queryClient = useQueryClient();

  // Initialize system integration
  const initializeSystem = useMutation({
    mutationFn: () => OpenClawClient.initializeSystemIntegration(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SYSTEM_QUERY_KEYS.config });
      queryClient.invalidateQueries({ queryKey: SYSTEM_QUERY_KEYS.stats });
    },
  });

  // System config
  const { data: systemConfig, isLoading: isConfigLoading } = useQuery({
    queryKey: SYSTEM_QUERY_KEYS.config,
    queryFn: () => OpenClawClient.getSystemConfig(),
  });

  const updateSystemConfig = useMutation({
    mutationFn: (updates: Record<string, unknown>) => OpenClawClient.updateSystemConfig(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SYSTEM_QUERY_KEYS.config });
    },
  });

  // System stats
  const { data: systemStats, isLoading: isStatsLoading } = useQuery({
    queryKey: SYSTEM_QUERY_KEYS.stats,
    queryFn: () => OpenClawClient.getSystemStats(),
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  // Operation history
  const { data: operationHistory } = useQuery({
    queryKey: SYSTEM_QUERY_KEYS.history,
    queryFn: () => OpenClawClient.getSystemHistory(100),
    refetchInterval: 10000,
  });

  return {
    // Initialization
    initializeSystem: initializeSystem.mutate,
    isInitializing: initializeSystem.isPending,

    // Config
    systemConfig,
    isConfigLoading,
    updateSystemConfig: updateSystemConfig.mutate,
    isUpdatingConfig: updateSystemConfig.isPending,

    // Stats
    systemStats,
    isStatsLoading,
    totalOperations: systemStats?.totalOperations || 0,
    localOperations: systemStats?.localOperations || 0,
    cloudOperations: systemStats?.cloudOperations || 0,
    localPercentage: systemStats?.totalOperations
      ? Math.round((systemStats.localOperations / systemStats.totalOperations) * 100)
      : 0,
    totalTokens: systemStats?.totalTokens || 0,
    totalCost: systemStats?.totalCost || 0,
    errors: systemStats?.errors || 0,

    // History
    operationHistory: operationHistory || [],
    recentOperations: (operationHistory || []).slice(-10),
  };
}

/**
 * Hook for unified chat through OpenClaw System Integration
 * Routes through local AI (Ollama) first, falls back to cloud (Anthropic)
 */
export function useOpenClawSystemChat() {
  const queryClient = useQueryClient();
  const [isStreaming, setIsStreaming] = useState(false);

  const chatMutation = useMutation({
    mutationFn: async ({ message, options }: {
      message: string;
      options?: { systemPrompt?: string; preferLocal?: boolean };
    }) => {
      return OpenClawClient.systemChat(message, options);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SYSTEM_QUERY_KEYS.stats });
      queryClient.invalidateQueries({ queryKey: SYSTEM_QUERY_KEYS.history });
    },
  });

  const executeMutation = useMutation({
    mutationFn: async (request: Parameters<typeof OpenClawClient.systemExecute>[0]) => {
      return OpenClawClient.systemExecute(request);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SYSTEM_QUERY_KEYS.stats });
      queryClient.invalidateQueries({ queryKey: SYSTEM_QUERY_KEYS.history });
    },
  });

  const chat = useCallback(async (
    message: string,
    options?: { systemPrompt?: string; preferLocal?: boolean }
  ) => {
    const result = await chatMutation.mutateAsync({ message, options });
    return result.content;
  }, [chatMutation]);

  const execute = useCallback(async (
    request: Parameters<typeof OpenClawClient.systemExecute>[0]
  ) => {
    return executeMutation.mutateAsync(request);
  }, [executeMutation]);

  return {
    // Simple chat
    chat,
    isLoading: chatMutation.isPending,
    lastResponse: chatMutation.data?.content,
    error: chatMutation.error,

    // Full execution
    execute,
    isExecuting: executeMutation.isPending,
    lastResult: executeMutation.data,
    executeError: executeMutation.error,

    // Stream state (for future streaming support)
    isStreaming,
    setIsStreaming,
  };
}

/**
 * Hook for agent inference through OpenClaw
 */
export function useOpenClawAgentInference() {
  const queryClient = useQueryClient();

  const inferenceMutation = useMutation({
    mutationFn: async ({ agentId, prompt, options }: {
      agentId: string;
      prompt: string;
      options?: { systemPrompt?: string; model?: string; temperature?: number };
    }) => {
      return OpenClawClient.systemAgentInference(agentId, prompt, options);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SYSTEM_QUERY_KEYS.stats });
    },
  });

  const runInference = useCallback(async (
    agentId: string,
    prompt: string,
    options?: { systemPrompt?: string; model?: string; temperature?: number }
  ) => {
    const result = await inferenceMutation.mutateAsync({ agentId, prompt, options });
    return result.content;
  }, [inferenceMutation]);

  return {
    runInference,
    isLoading: inferenceMutation.isPending,
    lastResponse: inferenceMutation.data?.content,
    error: inferenceMutation.error,
  };
}

/**
 * Hook for Local AI Hub status through OpenClaw
 */
export function useOpenClawLocalHub() {
  const queryClient = useQueryClient();

  const { data: hubStatus, isLoading: isStatusLoading } = useQuery({
    queryKey: SYSTEM_QUERY_KEYS.localHubStatus,
    queryFn: () => OpenClawClient.getLocalHubStatus(),
    refetchInterval: 15000, // Check every 15 seconds
  });

  const { data: combinedStats, isLoading: isStatsLoading } = useQuery({
    queryKey: SYSTEM_QUERY_KEYS.combinedStats,
    queryFn: () => OpenClawClient.getCombinedStats(),
    refetchInterval: 10000,
  });

  const localHubChatMutation = useMutation({
    mutationFn: async (request: Parameters<typeof OpenClawClient.localHubChat>[0]) => {
      return OpenClawClient.localHubChat(request);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SYSTEM_QUERY_KEYS.combinedStats });
    },
  });

  return {
    // Hub status
    hubStatus: hubStatus || [],
    availableProviders: (hubStatus || []).filter(p => p.available),
    hasAvailableProvider: (hubStatus || []).some(p => p.available),
    isStatusLoading,

    // Combined stats
    combinedStats,
    isStatsLoading,
    localStats: combinedStats?.local,
    OpenClawStats: combinedStats?.OpenClaw,

    // Local hub chat (with OpenClaw routing)
    chat: localHubChatMutation.mutate,
    chatAsync: localHubChatMutation.mutateAsync,
    isChatting: localHubChatMutation.isPending,
    chatError: localHubChatMutation.error,
  };
}

/**
 * Hook for system integration events
 */
export function useOpenClawSystemEvents() {
  const [events, setEvents] = useState<Array<{ type: string; data: unknown; timestamp: number }>>([]);
  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    const handleEvent = (event: unknown) => {
      setEvents(prev => [...prev.slice(-99), {
        ...(event as { type: string; data: unknown }),
        timestamp: Date.now(),
      }]);
    };

    OpenClawClient.addSystemEventListener("*", handleEvent);
    setIsSubscribed(true);

    return () => {
      OpenClawClient.removeSystemEventListener("*", handleEvent);
      setIsSubscribed(false);
    };
  }, []);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  return {
    events,
    isSubscribed,
    clearEvents,
    lastEvent: events[events.length - 1],
    completedOperations: events.filter(e => e.type === "operation:completed"),
    failedOperations: events.filter(e => e.type === "operation:failed"),
    providerSwitches: events.filter(e => e.type === "provider:switched"),
  };
}

/**
 * Complete system integration hook - combines all system hooks
 */
export function useOpenClawSystem() {
  const integration = useOpenClawSystemIntegration();
  const chat = useOpenClawSystemChat();
  const agentInference = useOpenClawAgentInference();
  const localHub = useOpenClawLocalHub();
  const events = useOpenClawSystemEvents();

  // Auto-initialize on first mount
  useEffect(() => {
    integration.initializeSystem();
  }, []);

  return {
    // Integration
    ...integration,

    // Chat
    chat: chat.chat,
    isChatting: chat.isLoading,
    lastChatResponse: chat.lastResponse,
    chatError: chat.error,

    // Execute
    execute: chat.execute,
    isExecuting: chat.isExecuting,
    lastResult: chat.lastResult,

    // Agent inference
    runAgentInference: agentInference.runInference,
    isAgentRunning: agentInference.isLoading,

    // Local hub
    localHubStatus: localHub.hubStatus,
    availableLocalProviders: localHub.availableProviders,
    hasLocalAI: localHub.hasAvailableProvider,
    localHubChat: localHub.chat,

    // Events
    systemEvents: events.events,
    lastSystemEvent: events.lastEvent,
    clearSystemEvents: events.clearEvents,

    // Combined loading state
    isLoading: integration.isConfigLoading || integration.isStatsLoading || chat.isLoading,
  };
}

/**
 * Ultimate combined hook - everything OpenClaw
 */
export function useOpenClawUltimate() {
  const full = useOpenClawFull();
  const system = useOpenClawSystem();

  return {
    ...full,
    
    // System Integration
    system,
    systemChat: system.chat,
    systemExecute: system.execute,
    systemStats: system.systemStats,
    localHubStatus: system.localHubStatus,
    hasLocalAI: system.hasLocalAI,
    
    // Agent inference
    runAgentInference: system.runAgentInference,
    
    // Combined stats
    localPercentage: system.localPercentage,
    totalOperations: system.totalOperations,
  };
}

// =============================================================================
// MODEL REGISTRY + TASK RATING HOOKS
// =============================================================================

/**
 * Hook to list available models (registry + local Ollama)
 * for the kanban model picker.
 */
export function useAvailableModels(filters?: { taskType?: string; source?: string }) {
  const ipc = IpcClient.getInstance();

  const { data: models, isLoading, refetch } = useQuery({
    queryKey: [...OPENCLAW_QUERY_KEYS.availableModels, filters],
    queryFn: () => ipc.listAvailableModels(filters),
    refetchInterval: 30_000,
  });

  return { models: models ?? [], isLoading, refetch };
}

/**
 * Hook for rating a completed kanban task (1-5 scale).
 * Feeds into MAB engine and data flywheel.
 */
export function useTaskRating() {
  const ipc = IpcClient.getInstance();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (params: { taskId: string; rating: number; feedback?: string }) =>
      ipc.rateKanbanTask(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: OPENCLAW_QUERY_KEYS.availableModels });
    },
  });

  return {
    rateTask: mutation.mutate,
    rateTaskAsync: mutation.mutateAsync,
    isRating: mutation.isPending,
  };
}
