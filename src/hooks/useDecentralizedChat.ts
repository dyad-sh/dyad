/**
 * React Hooks for Decentralized Chat
 * Wallet-to-wallet encrypted messaging with TanStack Query
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { decentralizedChatClient } from "@/ipc/decentralized_chat_client";
import type {
  ChatIdentity,
  ChatMessage,
  ChatConversation,
  ChatEvent,
  ChatPresenceStatus,
  SendMessageRequest,
  CreateConversationRequest,
  ChatServiceStatus,
} from "@/types/decentralized_chat_types";

// Query keys
export const chatQueryKeys = {
  all: ["decentralized-chat"] as const,
  status: () => [...chatQueryKeys.all, "status"] as const,
  identity: () => [...chatQueryKeys.all, "identity"] as const,
  conversations: () => [...chatQueryKeys.all, "conversations"] as const,
  conversation: (id: string) => [...chatQueryKeys.all, "conversation", id] as const,
  messages: (conversationId: string) => [...chatQueryKeys.all, "messages", conversationId] as const,
};

// ============================================================================
// Chat Status Hook
// ============================================================================

export function useChatStatus(options: { refetchInterval?: number } = {}) {
  const { refetchInterval = 10000 } = options;

  return useQuery({
    queryKey: chatQueryKeys.status(),
    queryFn: () => decentralizedChatClient.getStatus(),
    refetchInterval,
    staleTime: 5000,
  });
}

// ============================================================================
// Chat Events Hook
// ============================================================================

export interface UseChatEventsOptions {
  eventTypes?: (ChatEvent["type"] | "*")[];
  onEvent?: (event: ChatEvent) => void;
}

export function useChatEvents(options: UseChatEventsOptions = {}) {
  const { eventTypes = ["*"], onEvent } = options;
  const [lastEvent, setLastEvent] = useState<ChatEvent | null>(null);
  const [typingUsers, setTypingUsers] = useState<Map<string, Set<string>>>(new Map());
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribers: (() => void)[] = [];

    for (const eventType of eventTypes) {
      const unsub = decentralizedChatClient.on(eventType, (event) => {
        setLastEvent(event);
        onEvent?.(event);

        // Handle specific events
        switch (event.type) {
          case "message:received":
          case "message:sent":
            queryClient.invalidateQueries({ 
              queryKey: chatQueryKeys.messages(event.type === "message:received" ? event.conversationId : event.message.conversationId) 
            });
            queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations() });
            break;

          case "conversation:created":
          case "conversation:updated":
            queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations() });
            break;

          case "typing:started":
            setTypingUsers(prev => {
              const updated = new Map(prev);
              const conversationTypers = updated.get(event.conversationId) || new Set();
              conversationTypers.add(event.userId);
              updated.set(event.conversationId, conversationTypers);
              return updated;
            });
            break;

          case "typing:stopped":
            setTypingUsers(prev => {
              const updated = new Map(prev);
              const conversationTypers = updated.get(event.conversationId);
              if (conversationTypers) {
                conversationTypers.delete(event.userId);
                if (conversationTypers.size === 0) {
                  updated.delete(event.conversationId);
                }
              }
              return updated;
            });
            break;

          case "sync:completed":
            queryClient.invalidateQueries({ queryKey: chatQueryKeys.messages(event.conversationId) });
            break;
        }
      });
      unsubscribers.push(unsub);
    }

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [eventTypes, onEvent, queryClient]);

  const getTypingUsers = useCallback((conversationId: string) => {
    return Array.from(typingUsers.get(conversationId) || []);
  }, [typingUsers]);

  return { lastEvent, typingUsers, getTypingUsers };
}

// ============================================================================
// Identity Hook
// ============================================================================

export function useChatIdentity() {
  const queryClient = useQueryClient();

  const identityQuery = useQuery({
    queryKey: chatQueryKeys.identity(),
    queryFn: () => decentralizedChatClient.getIdentity(),
    staleTime: 60000,
  });

  const createMutation = useMutation({
    mutationFn: ({ walletAddress, displayName, signature }: {
      walletAddress: string;
      displayName?: string;
      signature?: string;
    }) => decentralizedChatClient.createIdentity(walletAddress, displayName, signature),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.identity() });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (updates: {
      displayName?: string;
      avatar?: string;
      bio?: string;
      status?: ChatPresenceStatus;
    }) => decentralizedChatClient.updateProfile(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.identity() });
    },
  });

  return {
    identity: identityQuery.data,
    isLoading: identityQuery.isLoading,
    error: identityQuery.error,
    createIdentity: createMutation.mutateAsync,
    updateProfile: updateMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
  };
}

// ============================================================================
// Conversations Hook
// ============================================================================

export function useChatConversations() {
  const queryClient = useQueryClient();

  const conversationsQuery = useQuery({
    queryKey: chatQueryKeys.conversations(),
    queryFn: () => decentralizedChatClient.listConversations(),
    staleTime: 10000,
  });

  const createMutation = useMutation({
    mutationFn: (request: CreateConversationRequest) => 
      decentralizedChatClient.createConversation(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations() });
    },
  });

  const getOrCreateDirectMutation = useMutation({
    mutationFn: (walletAddress: string) => 
      decentralizedChatClient.getOrCreateDirectConversation(walletAddress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations() });
    },
  });

  return {
    conversations: conversationsQuery.data || [],
    isLoading: conversationsQuery.isLoading,
    error: conversationsQuery.error,
    createConversation: createMutation.mutateAsync,
    getOrCreateDirect: getOrCreateDirectMutation.mutateAsync,
    isCreating: createMutation.isPending || getOrCreateDirectMutation.isPending,
  };
}

// ============================================================================
// Single Conversation Hook
// ============================================================================

export function useChatConversation(conversationId: string | null) {
  return useQuery({
    queryKey: chatQueryKeys.conversation(conversationId || ""),
    queryFn: () => conversationId ? decentralizedChatClient.getConversation(conversationId) : null,
    enabled: !!conversationId,
    staleTime: 30000,
  });
}

// ============================================================================
// Messages Hook
// ============================================================================

export interface UseMessagesOptions {
  limit?: number;
  autoDecrypt?: boolean;
  refetchInterval?: number;
}

export function useChatMessages(conversationId: string | null, options: UseMessagesOptions = {}) {
  const { limit, autoDecrypt = true, refetchInterval = 0 } = options;
  const queryClient = useQueryClient();

  const messagesQuery = useQuery({
    queryKey: chatQueryKeys.messages(conversationId || ""),
    queryFn: async () => {
      if (!conversationId) return [];
      if (autoDecrypt) {
        return decentralizedChatClient.getDecryptedMessages(conversationId);
      }
      return decentralizedChatClient.getMessages(conversationId, { limit });
    },
    enabled: !!conversationId,
    staleTime: 5000,
    refetchInterval: refetchInterval > 0 ? refetchInterval : false,
  });

  const sendMutation = useMutation({
    mutationFn: (request: SendMessageRequest) => decentralizedChatClient.sendMessage(request),
    onSuccess: () => {
      if (conversationId) {
        queryClient.invalidateQueries({ queryKey: chatQueryKeys.messages(conversationId) });
        queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations() });
      }
    },
  });

  const sendTextMutation = useMutation({
    mutationFn: ({ content, options }: { 
      content: string; 
      options?: { replyTo?: string; threadId?: string; expiresIn?: number } 
    }) => {
      if (!conversationId) throw new Error("No conversation selected");
      return decentralizedChatClient.sendText(conversationId, content, options);
    },
    onSuccess: () => {
      if (conversationId) {
        queryClient.invalidateQueries({ queryKey: chatQueryKeys.messages(conversationId) });
        queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations() });
      }
    },
  });

  return {
    messages: messagesQuery.data || [],
    isLoading: messagesQuery.isLoading,
    error: messagesQuery.error,
    sendMessage: sendMutation.mutateAsync,
    sendText: (content: string, options?: { replyTo?: string; threadId?: string; expiresIn?: number }) =>
      sendTextMutation.mutateAsync({ content, options }),
    isSending: sendMutation.isPending || sendTextMutation.isPending,
  };
}

// ============================================================================
// Typing Indicator Hook
// ============================================================================

export function useTypingIndicator(conversationId: string | null) {
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);

  const startTyping = useCallback(async () => {
    if (!conversationId || isTypingRef.current) return;
    
    isTypingRef.current = true;
    await decentralizedChatClient.startTyping(conversationId);

    // Auto-stop after 5 seconds of inactivity
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(async () => {
      if (conversationId) {
        await decentralizedChatClient.stopTyping(conversationId);
        isTypingRef.current = false;
      }
    }, 5000);
  }, [conversationId]);

  const stopTyping = useCallback(async () => {
    if (!conversationId || !isTypingRef.current) return;
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    
    isTypingRef.current = false;
    await decentralizedChatClient.stopTyping(conversationId);
  }, [conversationId]);

  const handleInputChange = useCallback(() => {
    startTyping();
  }, [startTyping]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (conversationId && isTypingRef.current) {
        decentralizedChatClient.stopTyping(conversationId);
      }
    };
  }, [conversationId]);

  return { startTyping, stopTyping, handleInputChange };
}

// ============================================================================
// Sync Hook
// ============================================================================

export function useChatSync() {
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);

  const syncMutation = useMutation({
    mutationFn: async () => {
      setIsSyncing(true);
      try {
        return await decentralizedChatClient.syncOnComingOnline();
      } finally {
        setIsSyncing(false);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.all });
    },
  });

  const pullPinnedMutation = useMutation({
    mutationFn: ({ conversationId, cids }: { conversationId?: string; cids?: string[] }) =>
      decentralizedChatClient.pullPinnedMessages({ conversationId, cids }),
    onSuccess: (_, variables) => {
      if (variables.conversationId) {
        queryClient.invalidateQueries({ queryKey: chatQueryKeys.messages(variables.conversationId) });
      }
    },
  });

  const checkOfflineMutation = useMutation({
    mutationFn: () => decentralizedChatClient.checkOfflineMessages(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.conversations() });
    },
  });

  return {
    syncOnline: syncMutation.mutateAsync,
    pullPinnedMessages: pullPinnedMutation.mutateAsync,
    checkOfflineMessages: checkOfflineMutation.mutateAsync,
    isSyncing: isSyncing || syncMutation.isPending,
    isPulling: pullPinnedMutation.isPending,
    syncResult: syncMutation.data,
  };
}

// ============================================================================
// Presence Hook
// ============================================================================

export function useChatPresence() {
  const [currentStatus, setCurrentStatus] = useState<ChatPresenceStatus>("offline");

  const setPresence = useCallback(async (status: ChatPresenceStatus) => {
    await decentralizedChatClient.broadcastPresence(status);
    setCurrentStatus(status);
  }, []);

  const setOnline = useCallback(() => setPresence("online"), [setPresence]);
  const setAway = useCallback(() => setPresence("away"), [setPresence]);
  const setBusy = useCallback(() => setPresence("busy"), [setPresence]);
  const setOffline = useCallback(() => setPresence("offline"), [setPresence]);

  // Auto-set online when hook mounts, offline when unmounts
  useEffect(() => {
    setOnline();
    
    // Handle visibility changes
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setAway();
      } else {
        setOnline();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      setOffline();
    };
  }, [setOnline, setAway, setOffline]);

  return {
    currentStatus,
    setPresence,
    setOnline,
    setAway,
    setBusy,
    setOffline,
  };
}

// ============================================================================
// Combined Chat Hook
// ============================================================================

export interface UseDecentralizedChatOptions {
  autoSync?: boolean;
  onEvent?: (event: ChatEvent) => void;
}

export function useDecentralizedChat(options: UseDecentralizedChatOptions = {}) {
  const { autoSync = true, onEvent } = options;
  const queryClient = useQueryClient();
  const [isGoingOffline, setIsGoingOffline] = useState(false);

  const status = useChatStatus();
  const identity = useChatIdentity();
  const conversations = useChatConversations();
  const events = useChatEvents({ onEvent });
  const sync = useChatSync();
  const presence = useChatPresence();
  
  // Go offline - disconnect from network and hide presence
  const goOffline = useCallback(async () => {
    setIsGoingOffline(true);
    try {
      await identity.updateProfile({ status: "offline" });
      await presence.setOffline();
      // Invalidate identity to refresh UI
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.identity() });
    } finally {
      setIsGoingOffline(false);
    }
  }, [identity, presence, queryClient]);
  
  // Go online - reconnect and broadcast presence
  const goOnline = useCallback(async () => {
    setIsGoingOffline(true);
    try {
      await identity.updateProfile({ status: "online" });
      await presence.setOnline();
      // Sync messages after coming online
      if (identity.identity) {
        await sync.syncOnline();
      }
      // Invalidate identity to refresh UI
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.identity() });
    } finally {
      setIsGoingOffline(false);
    }
  }, [identity, presence, sync, queryClient]);

  // Auto-sync on mount if enabled
  useEffect(() => {
    if (autoSync && identity.identity && !sync.isSyncing) {
      sync.syncOnline();
    }
  }, [autoSync, identity.identity?.id]);

  return {
    // Status
    status: status.data,
    isConnected: status.data?.heliaConnected ?? false,
    isInitialized: status.data?.initialized ?? false,

    // Identity
    identity: identity.identity,
    createIdentity: identity.createIdentity,
    updateProfile: identity.updateProfile,

    // Conversations
    conversations: conversations.conversations,
    createConversation: conversations.createConversation,
    getOrCreateDirect: conversations.getOrCreateDirect,

    // Sync
    syncOnline: sync.syncOnline,
    pullPinnedMessages: sync.pullPinnedMessages,
    isSyncing: sync.isSyncing,

    // Presence
    presence: presence.currentStatus,
    setPresence: presence.setPresence,
    
    // Online/Offline control
    goOffline,
    goOnline,
    isGoingOffline,

    // Events
    lastEvent: events.lastEvent,
    getTypingUsers: events.getTypingUsers,

    // Loading states
    isLoading: status.isLoading || identity.isLoading || conversations.isLoading,
  };
}

// ============================================================================
// Active Chat Hook (for chat window)
// ============================================================================

export function useActiveChat(conversationId: string | null) {
  const conversation = useChatConversation(conversationId);
  const messages = useChatMessages(conversationId);
  const typing = useTypingIndicator(conversationId);
  const events = useChatEvents({
    eventTypes: ["typing:started", "typing:stopped", "message:received"],
  });

  return {
    // Conversation
    conversation: conversation.data,
    isLoadingConversation: conversation.isLoading,

    // Messages
    messages: messages.messages,
    isLoadingMessages: messages.isLoading,
    sendMessage: messages.sendMessage,
    sendText: messages.sendText,
    isSending: messages.isSending,

    // Typing
    startTyping: typing.startTyping,
    stopTyping: typing.stopTyping,
    handleInputChange: typing.handleInputChange,
    typingUsers: conversationId ? events.getTypingUsers(conversationId) : [],
  };
}
