/**
 * useMemory Hook
 * React hook for interacting with the persistent memory system
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { MemorySystemClient } from "@/ipc/memory_system_client";
import type {
  Memory,
  MemoryId,
  MemoryType,
  MemorySource,
  MemoryImportance,
  MemoryQuery,
  MemorySearchResult,
  MemoryStats,
  MemoryEvent,
  ConversationContext,
  ContextMessage,
  UserProfile,
} from "@/ipc/memory_system_client";
import { toast } from "sonner";

// =============================================================================
// QUERY KEYS
// =============================================================================

export const memoryKeys = {
  all: ["memory"] as const,
  stats: () => [...memoryKeys.all, "stats"] as const,
  profile: () => [...memoryKeys.all, "profile"] as const,
  memory: (id: MemoryId) => [...memoryKeys.all, "memory", id] as const,
  search: (query: MemoryQuery) => [...memoryKeys.all, "search", query] as const,
  fulltext: (query: string) => [...memoryKeys.all, "fulltext", query] as const,
  context: (chatId: string) => [...memoryKeys.all, "context", chatId] as const,
  related: (id: MemoryId) => [...memoryKeys.all, "related", id] as const,
};

// =============================================================================
// INITIALIZATION HOOK
// =============================================================================

export function useMemorySystem() {
  const [isReady, setIsReady] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const queryClient = useQueryClient();

  const initializeMutation = useMutation({
    mutationFn: () => MemorySystemClient.initialize(),
    onSuccess: () => {
      setIsReady(true);
      toast.success("Memory system initialized");
    },
    onError: (error) => {
      toast.error(`Failed to initialize memory system: ${error}`);
    },
  });

  const shutdownMutation = useMutation({
    mutationFn: () => MemorySystemClient.shutdown(),
    onSuccess: () => {
      setIsReady(false);
      queryClient.invalidateQueries({ queryKey: memoryKeys.all });
    },
  });

  const initialize = useCallback(async () => {
    if (isReady || isInitializing) return;
    setIsInitializing(true);
    try {
      await initializeMutation.mutateAsync();
      // Subscribe to events
      await MemorySystemClient.subscribe();
    } finally {
      setIsInitializing(false);
    }
  }, [isReady, isInitializing, initializeMutation]);

  // Event subscription
  useEffect(() => {
    if (!isReady) return;

    const unsubscribe = MemorySystemClient.onEvent((event: MemoryEvent) => {
      switch (event.type) {
        case "memory:created":
        case "memory:updated":
        case "memory:deleted":
          queryClient.invalidateQueries({ queryKey: memoryKeys.all });
          break;
        case "context:updated":
          if (event.data?.chatId) {
            queryClient.invalidateQueries({
              queryKey: memoryKeys.context(event.data.chatId),
            });
          }
          break;
        case "profile:updated":
          queryClient.invalidateQueries({ queryKey: memoryKeys.profile() });
          break;
        case "consolidation:complete":
          queryClient.invalidateQueries({ queryKey: memoryKeys.stats() });
          toast.info(`Memory consolidation complete: ${event.data?.merged} merged, ${event.data?.deleted} deleted`);
          break;
      }
    });

    return unsubscribe;
  }, [isReady, queryClient]);

  return {
    isReady,
    isInitializing,
    initialize,
    shutdown: shutdownMutation.mutate,
  };
}

// =============================================================================
// STATS HOOK
// =============================================================================

export function useMemoryStats(enabled = true) {
  return useQuery({
    queryKey: memoryKeys.stats(),
    queryFn: () => MemorySystemClient.getStats(),
    enabled,
    staleTime: 30000, // 30 seconds
  });
}

// =============================================================================
// MEMORY CRUD HOOKS
// =============================================================================

export function useMemory(id: MemoryId | null) {
  return useQuery({
    queryKey: id ? memoryKeys.memory(id) : memoryKeys.all,
    queryFn: () => (id ? MemorySystemClient.getMemory(id) : null),
    enabled: !!id,
  });
}

export function useCreateMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      type: MemoryType;
      content: string;
      summary?: string;
      source?: MemorySource;
      importance?: MemoryImportance;
      confidence?: number;
      tags?: string[];
      entities?: string[];
      appId?: number;
      chatId?: string;
      messageId?: string;
      relatedMemories?: MemoryId[];
      expiresAt?: number;
    }) => MemorySystemClient.createMemory(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.all });
    },
    onError: (error) => {
      toast.error(`Failed to create memory: ${error}`);
    },
  });
}

export function useUpdateMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }: { id: MemoryId; updates: Partial<Memory> }) =>
      MemorySystemClient.updateMemory(id, updates),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.memory(id) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.stats() });
    },
    onError: (error) => {
      toast.error(`Failed to update memory: ${error}`);
    },
  });
}

export function useDeleteMemory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: MemoryId) => MemorySystemClient.deleteMemory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.all });
    },
    onError: (error) => {
      toast.error(`Failed to delete memory: ${error}`);
    },
  });
}

// =============================================================================
// SEARCH HOOKS
// =============================================================================

export function useMemorySearch(query: MemoryQuery, enabled = true) {
  return useQuery({
    queryKey: memoryKeys.search(query),
    queryFn: () => MemorySystemClient.search(query),
    enabled: enabled && !!query.query,
    staleTime: 10000, // 10 seconds
  });
}

export function useMemoryFullTextSearch(query: string, limit?: number, enabled = true) {
  return useQuery({
    queryKey: memoryKeys.fulltext(query),
    queryFn: () => MemorySystemClient.fullTextSearch(query, limit),
    enabled: enabled && query.length >= 2,
    staleTime: 10000,
  });
}

export function useSearchMemories() {
  return useMutation({
    mutationFn: (query: MemoryQuery) => MemorySystemClient.search(query),
    onError: (error) => {
      toast.error(`Search failed: ${error}`);
    },
  });
}

// =============================================================================
// CONTEXT HOOKS
// =============================================================================

export function useConversationContext(chatId: string | null) {
  return useQuery({
    queryKey: chatId ? memoryKeys.context(chatId) : memoryKeys.all,
    queryFn: () => (chatId ? MemorySystemClient.getContext(chatId) : null),
    enabled: !!chatId,
    staleTime: 5000, // 5 seconds
  });
}

export function useAddToContext() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ chatId, message }: { chatId: string; message: ContextMessage }) =>
      MemorySystemClient.addToContext(chatId, message),
    onSuccess: (_, { chatId }) => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.context(chatId) });
    },
    onError: (error) => {
      toast.error(`Failed to add to context: ${error}`);
    },
  });
}

export function useClearContext() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (chatId: string) => MemorySystemClient.clearContext(chatId),
    onSuccess: (_, chatId) => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.context(chatId) });
    },
    onError: (error) => {
      toast.error(`Failed to clear context: ${error}`);
    },
  });
}

// =============================================================================
// USER PROFILE HOOKS
// =============================================================================

export function useUserProfile(enabled = true) {
  return useQuery({
    queryKey: memoryKeys.profile(),
    queryFn: () => MemorySystemClient.getProfile(),
    enabled,
    staleTime: 60000, // 1 minute
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (updates: Partial<UserProfile>) =>
      MemorySystemClient.updateProfile(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.profile() });
      toast.success("Profile updated");
    },
    onError: (error) => {
      toast.error(`Failed to update profile: ${error}`);
    },
  });
}

export function useLearnPreference() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      MemorySystemClient.learnPreference(key, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.profile() });
    },
  });
}

// =============================================================================
// RELATIONSHIP HOOKS
// =============================================================================

export function useRelatedMemories(id: MemoryId | null) {
  return useQuery({
    queryKey: id ? memoryKeys.related(id) : memoryKeys.all,
    queryFn: () => (id ? MemorySystemClient.getRelatedMemories(id) : []),
    enabled: !!id,
  });
}

export function useCreateRelationship() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      sourceId,
      targetId,
      type,
      strength,
    }: {
      sourceId: MemoryId;
      targetId: MemoryId;
      type: string;
      strength?: number;
    }) => MemorySystemClient.createRelationship(sourceId, targetId, type, strength),
    onSuccess: (_, { sourceId, targetId }) => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.related(sourceId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.related(targetId) });
    },
    onError: (error) => {
      toast.error(`Failed to create relationship: ${error}`);
    },
  });
}

// =============================================================================
// MAINTENANCE HOOKS
// =============================================================================

export function useConsolidateMemories() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => MemorySystemClient.consolidate(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.all });
      toast.success(`Consolidated: ${result.merged} merged, ${result.deleted} deleted`);
    },
    onError: (error) => {
      toast.error(`Consolidation failed: ${error}`);
    },
  });
}

// =============================================================================
// COMBINED HOOK FOR CHAT INTEGRATION
// =============================================================================

export function useChatMemory(chatId: string | null, appId?: number) {
  const queryClient = useQueryClient();
  const createMemory = useCreateMemory();
  const addToContext = useAddToContext();
  const { data: context } = useConversationContext(chatId);
  const searchMemories = useSearchMemories();

  // Remember a fact from the conversation
  const rememberFact = useCallback(
    async (content: string, importance: MemoryImportance = "medium") => {
      if (!chatId) return;
      await createMemory.mutateAsync({
        type: "fact",
        content,
        source: "observation",
        importance,
        chatId,
        appId,
      });
    },
    [chatId, appId, createMemory]
  );

  // Remember user preference
  const rememberPreference = useCallback(
    async (content: string) => {
      if (!chatId) return;
      await createMemory.mutateAsync({
        type: "preference",
        content,
        source: "user",
        importance: "high",
        chatId,
        appId,
      });
    },
    [chatId, appId, createMemory]
  );

  // Remember code pattern
  const rememberCodePattern = useCallback(
    async (content: string, tags: string[] = []) => {
      if (!chatId) return;
      await createMemory.mutateAsync({
        type: "code_pattern",
        content,
        source: "observation",
        importance: "medium",
        chatId,
        appId,
        tags,
      });
    },
    [chatId, appId, createMemory]
  );

  // Add message to conversation context
  const addMessage = useCallback(
    async (role: "user" | "assistant" | "system", content: string) => {
      if (!chatId) return;
      await addToContext.mutateAsync({
        chatId,
        message: {
          role,
          content,
          timestamp: Date.now(),
        },
      });
    },
    [chatId, addToContext]
  );

  // Search for relevant memories
  const findRelevant = useCallback(
    async (query: string, types?: MemoryType[]) => {
      const results = await searchMemories.mutateAsync({
        query,
        types,
        appId,
        limit: 10,
      });
      return results;
    },
    [appId, searchMemories]
  );

  // Get context for AI prompt
  const getContextForPrompt = useCallback((): string => {
    if (!context) return "";
    
    let contextStr = "";
    
    // Add working context
    if (context.workingContext) {
      contextStr += `## Current Context\n${context.workingContext}\n\n`;
    }
    
    // Add summary if available
    if (context.summary) {
      contextStr += `## Conversation Summary\n${context.summary}\n\n`;
    }
    
    return contextStr;
  }, [context]);

  return {
    context,
    rememberFact,
    rememberPreference,
    rememberCodePattern,
    addMessage,
    findRelevant,
    getContextForPrompt,
    isSearching: searchMemories.isPending,
  };
}

// Re-export types for convenience
export type {
  Memory,
  MemoryId,
  MemoryType,
  MemorySource,
  MemoryImportance,
  MemoryQuery,
  MemorySearchResult,
  MemoryStats,
  MemoryEvent,
  ConversationContext,
  ContextMessage,
  UserProfile,
};
