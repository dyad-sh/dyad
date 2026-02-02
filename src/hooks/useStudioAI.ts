/**
 * Studio AI React Hooks
 * TanStack Query hooks for the unified Studio AI Service
 * 
 * Provides Claude Code + Ollama integration across all studios
 */

import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  studioAIClient,
  type StudioAIConfig,
  type StudioAIResponse,
  type StudioType,
} from "@/ipc/studio_ai_client";

// Query keys
const STUDIO_AI_KEYS = {
  config: ["studio-ai", "config"],
  stats: ["studio-ai", "stats"],
};

// =============================================================================
// CONFIG & STATS HOOKS
// =============================================================================

/**
 * Hook to manage Studio AI configuration
 */
export function useStudioAIConfig() {
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: STUDIO_AI_KEYS.config,
    queryFn: () => studioAIClient.getConfig(),
  });

  const updateConfig = useMutation({
    mutationFn: (updates: Partial<StudioAIConfig>) => studioAIClient.updateConfig(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STUDIO_AI_KEYS.config });
    },
  });

  return {
    config,
    isLoading,
    updateConfig: updateConfig.mutate,
    isUpdating: updateConfig.isPending,
    
    // Convenience setters
    setPreferLocal: (preferLocal: boolean) => 
      updateConfig.mutate({ privacyMode: preferLocal, preferredProvider: preferLocal ? "ollama" : "auto" }),
    setUseClaudeCode: (use: boolean) => 
      updateConfig.mutate({ useClaudeCode: use }),
    setOllamaModel: (model: string) => 
      updateConfig.mutate({ ollamaModel: model }),
  };
}

/**
 * Hook to track Studio AI stats
 */
export function useStudioAIStats() {
  const { data: stats, isLoading } = useQuery({
    queryKey: STUDIO_AI_KEYS.stats,
    queryFn: () => studioAIClient.getStats(),
    refetchInterval: 5000,
  });

  return {
    stats,
    isLoading,
    totalRequests: stats?.totalRequests || 0,
    ollamaRequests: stats?.ollamaRequests || 0,
    anthropicRequests: stats?.anthropicRequests || 0,
    claudeCodeTasks: stats?.claudeCodeTasks || 0,
    errors: stats?.errors || 0,
    totalTokens: stats?.totalTokens || 0,
    localPercentage: stats?.totalRequests 
      ? Math.round((stats.ollamaRequests / stats.totalRequests) * 100) 
      : 0,
  };
}

// =============================================================================
// UNIFIED EXECUTE HOOK
// =============================================================================

/**
 * Hook for executing any Studio AI request
 */
export function useStudioAIExecute() {
  const queryClient = useQueryClient();
  const [lastResponse, setLastResponse] = useState<StudioAIResponse | null>(null);

  const executeMutation = useMutation({
    mutationFn: (request: {
      studio: StudioType;
      operation: string;
      prompt: string;
      systemPrompt?: string;
      context?: Record<string, unknown>;
      config?: Partial<StudioAIConfig>;
    }) => studioAIClient.execute(request),
    onSuccess: (response) => {
      setLastResponse(response);
      queryClient.invalidateQueries({ queryKey: STUDIO_AI_KEYS.stats });
    },
  });

  return {
    execute: executeMutation.mutate,
    executeAsync: executeMutation.mutateAsync,
    isLoading: executeMutation.isPending,
    lastResponse,
    error: executeMutation.error,
    reset: () => {
      setLastResponse(null);
      executeMutation.reset();
    },
  };
}

// =============================================================================
// DATA STUDIO HOOKS
// =============================================================================

/**
 * Hook for generating dataset items
 */
export function useDataGeneration() {
  const queryClient = useQueryClient();

  const generateItems = useMutation({
    mutationFn: (params: {
      schema: Record<string, unknown>;
      count: number;
      examples?: unknown[];
      constraints?: string[];
      config?: Partial<StudioAIConfig>;
    }) => studioAIClient.generateDataItems(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STUDIO_AI_KEYS.stats });
    },
  });

  const augmentData = useMutation({
    mutationFn: (params: {
      item: unknown;
      augmentationType: "paraphrase" | "expand" | "summarize" | "translate" | "noise";
      config?: Partial<StudioAIConfig>;
    }) => studioAIClient.augmentData(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STUDIO_AI_KEYS.stats });
    },
  });

  const analyzeData = useMutation({
    mutationFn: (params: {
      data: unknown[];
      analysisType: "quality" | "distribution" | "anomalies" | "summary";
      config?: Partial<StudioAIConfig>;
    }) => studioAIClient.analyzeData(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STUDIO_AI_KEYS.stats });
    },
  });

  return {
    generateItems: generateItems.mutate,
    generateItemsAsync: generateItems.mutateAsync,
    isGenerating: generateItems.isPending,
    generatedItems: generateItems.data?.items,

    augmentData: augmentData.mutate,
    augmentDataAsync: augmentData.mutateAsync,
    isAugmenting: augmentData.isPending,
    augmentedData: augmentData.data?.augmented,

    analyzeData: analyzeData.mutate,
    analyzeDataAsync: analyzeData.mutateAsync,
    isAnalyzing: analyzeData.isPending,
    analysis: analyzeData.data,

    isLoading: generateItems.isPending || augmentData.isPending || analyzeData.isPending,
  };
}

// =============================================================================
// DOCUMENT STUDIO HOOKS
// =============================================================================

/**
 * Hook for document generation and enhancement
 */
export function useDocumentGeneration() {
  const queryClient = useQueryClient();

  const generateDocument = useMutation({
    mutationFn: (params: {
      type: "report" | "article" | "email" | "presentation" | "memo" | "proposal";
      description: string;
      tone?: string;
      length?: "short" | "medium" | "long";
      format?: "markdown" | "plain" | "html";
      config?: Partial<StudioAIConfig>;
    }) => studioAIClient.generateDocument(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STUDIO_AI_KEYS.stats });
    },
  });

  const enhanceDocument = useMutation({
    mutationFn: (params: {
      content: string;
      enhancement: "grammar" | "style" | "clarity" | "expand" | "summarize";
      config?: Partial<StudioAIConfig>;
    }) => studioAIClient.enhanceDocument(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STUDIO_AI_KEYS.stats });
    },
  });

  return {
    generateDocument: generateDocument.mutate,
    generateDocumentAsync: generateDocument.mutateAsync,
    isGenerating: generateDocument.isPending,
    generatedDocument: generateDocument.data,

    enhanceDocument: enhanceDocument.mutate,
    enhanceDocumentAsync: enhanceDocument.mutateAsync,
    isEnhancing: enhanceDocument.isPending,
    enhancedContent: enhanceDocument.data?.content,

    isLoading: generateDocument.isPending || enhanceDocument.isPending,
  };
}

// =============================================================================
// ASSET STUDIO HOOKS
// =============================================================================

/**
 * Hook for code generation and analysis
 */
export function useCodeGeneration() {
  const queryClient = useQueryClient();

  const generateCode = useMutation({
    mutationFn: (params: {
      language: string;
      description: string;
      framework?: string;
      includeTests?: boolean;
      config?: Partial<StudioAIConfig>;
    }) => studioAIClient.generateCode(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STUDIO_AI_KEYS.stats });
    },
  });

  const analyzeCode = useMutation({
    mutationFn: (params: {
      code: string;
      language: string;
      analysisType: "bugs" | "security" | "performance" | "style" | "all";
      config?: Partial<StudioAIConfig>;
    }) => studioAIClient.analyzeCode(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STUDIO_AI_KEYS.stats });
    },
  });

  const refactorCode = useMutation({
    mutationFn: (params: {
      code: string;
      language: string;
      refactorType: "clean" | "optimize" | "modernize" | "typescript" | "functional";
      config?: Partial<StudioAIConfig>;
    }) => studioAIClient.refactorCode(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STUDIO_AI_KEYS.stats });
    },
  });

  const generateTests = useMutation({
    mutationFn: (params: {
      code: string;
      language: string;
      framework?: string;
      coverage?: "unit" | "integration" | "e2e" | "all";
      config?: Partial<StudioAIConfig>;
    }) => studioAIClient.generateTests(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STUDIO_AI_KEYS.stats });
    },
  });

  return {
    generateCode: generateCode.mutate,
    generateCodeAsync: generateCode.mutateAsync,
    isGenerating: generateCode.isPending,
    generatedCode: generateCode.data?.code,

    analyzeCode: analyzeCode.mutate,
    analyzeCodeAsync: analyzeCode.mutateAsync,
    isAnalyzing: analyzeCode.isPending,
    codeAnalysis: analyzeCode.data,

    refactorCode: refactorCode.mutate,
    refactorCodeAsync: refactorCode.mutateAsync,
    isRefactoring: refactorCode.isPending,
    refactoredCode: refactorCode.data?.content,

    generateTests: generateTests.mutate,
    generateTestsAsync: generateTests.mutateAsync,
    isGeneratingTests: generateTests.isPending,
    generatedTests: generateTests.data?.content,

    isLoading: generateCode.isPending || analyzeCode.isPending || 
               refactorCode.isPending || generateTests.isPending,
  };
}

/**
 * Hook for schema generation
 */
export function useSchemaGeneration() {
  const queryClient = useQueryClient();

  const generateSchema = useMutation({
    mutationFn: (params: {
      schemaType: "json-schema" | "openapi" | "graphql" | "sql" | "drizzle";
      description: string;
      entities?: string[];
      config?: Partial<StudioAIConfig>;
    }) => studioAIClient.generateSchema(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STUDIO_AI_KEYS.stats });
    },
  });

  return {
    generateSchema: generateSchema.mutate,
    generateSchemaAsync: generateSchema.mutateAsync,
    isGenerating: generateSchema.isPending,
    generatedSchema: generateSchema.data?.schema,
    provider: generateSchema.data?.provider,
    isLocal: generateSchema.data?.localProcessed,
  };
}

// =============================================================================
// AGENT SWARM HOOKS
// =============================================================================

/**
 * Hook for agent swarm AI operations
 */
export function useAgentSwarmAI() {
  const queryClient = useQueryClient();

  const generateConfig = useMutation({
    mutationFn: (params: {
      role: string;
      capabilities: string[];
      objectives: string[];
      constraints?: string[];
      config?: Partial<StudioAIConfig>;
    }) => studioAIClient.generateAgentConfig(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STUDIO_AI_KEYS.stats });
    },
  });

  const executeTask = useMutation({
    mutationFn: (params: {
      agentId: string;
      task: string;
      context?: Record<string, unknown>;
      systemPrompt?: string;
      config?: Partial<StudioAIConfig>;
    }) => studioAIClient.executeAgentTask(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STUDIO_AI_KEYS.stats });
    },
  });

  const coordinate = useMutation({
    mutationFn: (params: {
      agents: Array<{ id: string; role: string; capabilities: string[] }>;
      objective: string;
      strategy?: "parallel" | "sequential" | "hierarchical";
      config?: Partial<StudioAIConfig>;
    }) => studioAIClient.coordinateSwarm(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STUDIO_AI_KEYS.stats });
    },
  });

  const optimize = useMutation({
    mutationFn: (params: {
      agentId: string;
      currentConfig: Record<string, unknown>;
      performanceMetrics: {
        successRate: number;
        avgLatency: number;
        tokenUsage: number;
        taskCompletion: number;
      };
      config?: Partial<StudioAIConfig>;
    }) => studioAIClient.optimizeAgent(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STUDIO_AI_KEYS.stats });
    },
  });

  return {
    // Generate agent config
    generateConfig: generateConfig.mutate,
    generateConfigAsync: generateConfig.mutateAsync,
    isGeneratingConfig: generateConfig.isPending,
    generatedConfig: generateConfig.data,

    // Execute task
    executeTask: executeTask.mutate,
    executeTaskAsync: executeTask.mutateAsync,
    isExecuting: executeTask.isPending,
    taskResult: executeTask.data?.result,

    // Coordinate swarm
    coordinate: coordinate.mutate,
    coordinateAsync: coordinate.mutateAsync,
    isCoordinating: coordinate.isPending,
    coordinationPlan: coordinate.data?.plan,

    // Optimize agent
    optimize: optimize.mutate,
    optimizeAsync: optimize.mutateAsync,
    isOptimizing: optimize.isPending,
    optimizationResult: optimize.data,

    isLoading: generateConfig.isPending || executeTask.isPending || 
               coordinate.isPending || optimize.isPending,
  };
}

// =============================================================================
// DATASET STUDIO HOOKS
// =============================================================================

/**
 * Hook for dataset-specific generation
 */
export function useDatasetGeneration() {
  const queryClient = useQueryClient();

  const generateQA = useMutation({
    mutationFn: (params: {
      topic: string;
      count: number;
      difficulty?: "easy" | "medium" | "hard" | "mixed";
      format?: "simple" | "conversational" | "instructional";
      config?: Partial<StudioAIConfig>;
    }) => studioAIClient.generateQAPairs(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STUDIO_AI_KEYS.stats });
    },
  });

  const generateConversations = useMutation({
    mutationFn: (params: {
      scenario: string;
      turns: number;
      participants?: string[];
      tone?: string;
      config?: Partial<StudioAIConfig>;
    }) => studioAIClient.generateConversations(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STUDIO_AI_KEYS.stats });
    },
  });

  const generateClassification = useMutation({
    mutationFn: (params: {
      categories: string[];
      count: number;
      domain?: string;
      includeEdgeCases?: boolean;
      config?: Partial<StudioAIConfig>;
    }) => studioAIClient.generateClassificationData(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STUDIO_AI_KEYS.stats });
    },
  });

  return {
    generateQA: generateQA.mutate,
    generateQAAsync: generateQA.mutateAsync,
    isGeneratingQA: generateQA.isPending,
    qaPairs: generateQA.data,

    generateConversations: generateConversations.mutate,
    generateConversationsAsync: generateConversations.mutateAsync,
    isGeneratingConversations: generateConversations.isPending,
    conversations: generateConversations.data,

    generateClassification: generateClassification.mutate,
    generateClassificationAsync: generateClassification.mutateAsync,
    isGeneratingClassification: generateClassification.isPending,
    classificationData: generateClassification.data,

    isLoading: generateQA.isPending || generateConversations.isPending || 
               generateClassification.isPending,
  };
}

// =============================================================================
// QUICK CHAT HOOKS
// =============================================================================

/**
 * Simple chat hook for quick AI interactions
 */
export function useStudioAIChat() {
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const queryClient = useQueryClient();

  const sendMessage = useMutation({
    mutationFn: async (params: {
      message: string;
      systemPrompt?: string;
      preferLocal?: boolean;
    }) => {
      setMessages(prev => [...prev, { role: "user", content: params.message }]);
      const response = await studioAIClient.quickChat(params.message, {
        systemPrompt: params.systemPrompt,
        preferLocal: params.preferLocal,
      });
      setMessages(prev => [...prev, { role: "assistant", content: response }]);
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STUDIO_AI_KEYS.stats });
    },
  });

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    sendMessage: sendMessage.mutate,
    sendMessageAsync: sendMessage.mutateAsync,
    isLoading: sendMessage.isPending,
    clearMessages,
    lastResponse: messages[messages.length - 1]?.content,
  };
}

// =============================================================================
// COMBINED HOOK
// =============================================================================

/**
 * Combined hook for all Studio AI functionality
 */
export function useStudioAI() {
  const config = useStudioAIConfig();
  const stats = useStudioAIStats();
  const execute = useStudioAIExecute();
  const dataGen = useDataGeneration();
  const docGen = useDocumentGeneration();
  const codeGen = useCodeGeneration();
  const schemaGen = useSchemaGeneration();
  const agentSwarm = useAgentSwarmAI();
  const datasetGen = useDatasetGeneration();

  // Auto-initialize on first use
  useEffect(() => {
    studioAIClient.initialize().catch(console.error);
  }, []);

  return {
    // Config
    config: config.config,
    updateConfig: config.updateConfig,
    setPreferLocal: config.setPreferLocal,
    setUseClaudeCode: config.setUseClaudeCode,

    // Stats
    stats: stats.stats,
    localPercentage: stats.localPercentage,

    // Execute
    execute: execute.execute,
    executeAsync: execute.executeAsync,

    // Data Studio
    generateDataItems: dataGen.generateItemsAsync,
    augmentData: dataGen.augmentDataAsync,
    analyzeData: dataGen.analyzeDataAsync,

    // Document Studio
    generateDocument: docGen.generateDocumentAsync,
    enhanceDocument: docGen.enhanceDocumentAsync,

    // Asset Studio
    generateCode: codeGen.generateCodeAsync,
    analyzeCode: codeGen.analyzeCodeAsync,
    refactorCode: codeGen.refactorCodeAsync,
    generateTests: codeGen.generateTestsAsync,
    generateSchema: schemaGen.generateSchemaAsync,

    // Agent Swarm
    generateAgentConfig: agentSwarm.generateConfigAsync,
    executeAgentTask: agentSwarm.executeTaskAsync,
    coordinateSwarm: agentSwarm.coordinateAsync,
    optimizeAgent: agentSwarm.optimizeAsync,

    // Dataset Studio
    generateQAPairs: datasetGen.generateQAAsync,
    generateConversations: datasetGen.generateConversationsAsync,
    generateClassificationData: datasetGen.generateClassificationAsync,

    // Loading states
    isLoading: execute.isLoading || dataGen.isLoading || docGen.isLoading ||
               codeGen.isLoading || schemaGen.isGenerating || agentSwarm.isLoading ||
               datasetGen.isLoading,
  };
}
