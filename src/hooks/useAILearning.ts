/**
 * AI Learning Mode React Hooks
 * TanStack Query integration for learning mode operations
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useCallback, useState } from "react";
import { toast } from "sonner";
import {
  AILearningClient,
  type ProfileId,
  type PatternId,
  type LearningDomain,
  type PatternType,
  type FeedbackType,
  type LearningProfile,
  type LearnedPattern,
  type UserFeedback,
  type PatternExample,
  type FeedbackContext,
  type StyleGuide,
  type CommunicationPreferences,
  type LearningStats,
  type LearningEvent,
} from "../ipc/ai_learning_client";

// Query keys
const LEARNING_KEYS = {
  all: ["ai-learning"] as const,
  profiles: () => [...LEARNING_KEYS.all, "profiles"] as const,
  profile: (id: ProfileId) => [...LEARNING_KEYS.profiles(), id] as const,
  activeProfile: () => [...LEARNING_KEYS.all, "active-profile"] as const,
  patterns: () => [...LEARNING_KEYS.all, "patterns"] as const,
  patternList: (filters?: {
    profileId?: ProfileId;
    domain?: LearningDomain;
    type?: PatternType;
    enabled?: boolean;
  }) => [...LEARNING_KEYS.patterns(), filters ?? "all"] as const,
  pattern: (id: PatternId) => [...LEARNING_KEYS.patterns(), id] as const,
  patternSearch: (query: string, profileId?: ProfileId) =>
    [...LEARNING_KEYS.patterns(), "search", query, profileId] as const,
  feedback: () => [...LEARNING_KEYS.all, "feedback"] as const,
  feedbackList: (filters?: {
    profileId?: ProfileId;
    patternId?: PatternId;
    type?: FeedbackType;
    domain?: LearningDomain;
    limit?: number;
  }) => [...LEARNING_KEYS.feedback(), filters ?? "all"] as const,
  styleGuide: () => [...LEARNING_KEYS.all, "style-guide"] as const,
  communicationPrefs: () => [...LEARNING_KEYS.all, "communication-prefs"] as const,
  stats: () => [...LEARNING_KEYS.all, "stats"] as const,
};

// ============ Initialization Hooks ============

export function useInitializeAILearning() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => AILearningClient.initialize(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.all });
    },
    onError: (error: Error) => {
      toast.error(`Failed to initialize learning mode: ${error.message}`);
    },
  });
}

export function useShutdownAILearning() {
  return useMutation({
    mutationFn: () => AILearningClient.shutdown(),
    onError: (error: Error) => {
      toast.error(`Failed to shutdown learning mode: ${error.message}`);
    },
  });
}

// ============ Profile Hooks ============

export function useLearningProfiles() {
  return useQuery({
    queryKey: LEARNING_KEYS.profiles(),
    queryFn: () => AILearningClient.listProfiles(),
  });
}

export function useLearningProfile(profileId: ProfileId | null) {
  return useQuery({
    queryKey: LEARNING_KEYS.profile(profileId!),
    queryFn: () => AILearningClient.getProfile(profileId!),
    enabled: !!profileId,
  });
}

export function useActiveProfile() {
  return useQuery({
    queryKey: LEARNING_KEYS.activeProfile(),
    queryFn: () => AILearningClient.getActiveProfile(),
  });
}

export function useCreateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      name: string;
      description?: string;
      domains?: LearningDomain[];
    }) => AILearningClient.createProfile(params),
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.profiles() });
      toast.success(`Profile "${profile.name}" created`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to create profile: ${error.message}`);
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      profileId,
      updates,
    }: {
      profileId: ProfileId;
      updates: Partial<{ name: string; description: string; domains: LearningDomain[] }>;
    }) => AILearningClient.updateProfile(profileId, updates),
    onSuccess: (profile) => {
      if (profile) {
        queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.profiles() });
        queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.profile(profile.id) });
        toast.success("Profile updated");
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to update profile: ${error.message}`);
    },
  });
}

export function useDeleteProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (profileId: ProfileId) => AILearningClient.deleteProfile(profileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.profiles() });
      queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.activeProfile() });
      toast.success("Profile deleted");
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete profile: ${error.message}`);
    },
  });
}

export function useActivateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (profileId: ProfileId) => AILearningClient.activateProfile(profileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.profiles() });
      queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.activeProfile() });
      toast.success("Profile activated");
    },
    onError: (error: Error) => {
      toast.error(`Failed to activate profile: ${error.message}`);
    },
  });
}

// ============ Pattern Hooks ============

export function useLearnedPatterns(filters?: {
  profileId?: ProfileId;
  domain?: LearningDomain;
  type?: PatternType;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: LEARNING_KEYS.patternList(filters),
    queryFn: () => AILearningClient.listPatterns(filters),
  });
}

export function useLearnedPattern(patternId: PatternId | null) {
  return useQuery({
    queryKey: LEARNING_KEYS.pattern(patternId!),
    queryFn: () => AILearningClient.getPattern(patternId!),
    enabled: !!patternId,
  });
}

export function useSearchPatterns(query: string, profileId?: ProfileId) {
  return useQuery({
    queryKey: LEARNING_KEYS.patternSearch(query, profileId),
    queryFn: () => AILearningClient.searchPatterns(query, profileId),
    enabled: query.length > 0,
  });
}

export function useLearnPattern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      profileId: ProfileId;
      domain: LearningDomain;
      type: PatternType;
      name: string;
      description?: string;
      pattern: string;
      examples?: PatternExample[];
      confidence?: number;
      weight?: number;
    }) => AILearningClient.learnPattern(params),
    onSuccess: (pattern) => {
      queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.patterns() });
      queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.stats() });
      toast.success(`Pattern "${pattern.name}" learned`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to learn pattern: ${error.message}`);
    },
  });
}

export function useUpdatePattern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      patternId,
      updates,
    }: {
      patternId: PatternId;
      updates: Partial<{
        name: string;
        description: string;
        pattern: string;
        confidence: number;
        weight: number;
        isEnabled: boolean;
      }>;
    }) => AILearningClient.updatePattern(patternId, updates),
    onSuccess: (pattern) => {
      if (pattern) {
        queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.patterns() });
        queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.pattern(pattern.id) });
        toast.success("Pattern updated");
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to update pattern: ${error.message}`);
    },
  });
}

export function useAddPatternExample() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      patternId,
      example,
    }: {
      patternId: PatternId;
      example: PatternExample;
    }) => AILearningClient.addPatternExample(patternId, example),
    onSuccess: (pattern) => {
      if (pattern) {
        queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.pattern(pattern.id) });
        toast.success("Example added to pattern");
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to add example: ${error.message}`);
    },
  });
}

export function useDeletePattern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patternId: PatternId) => AILearningClient.deletePattern(patternId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.patterns() });
      queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.stats() });
      toast.success("Pattern deleted");
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete pattern: ${error.message}`);
    },
  });
}

// ============ Feedback Hooks ============

export function useFeedbackHistory(filters?: {
  profileId?: ProfileId;
  patternId?: PatternId;
  type?: FeedbackType;
  domain?: LearningDomain;
  limit?: number;
}) {
  return useQuery({
    queryKey: LEARNING_KEYS.feedbackList(filters),
    queryFn: () => AILearningClient.listFeedback(filters),
  });
}

export function useRecordFeedback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      profileId: ProfileId;
      patternId?: PatternId;
      type: FeedbackType;
      domain: LearningDomain;
      originalResponse: string;
      correctedResponse?: string;
      feedbackText?: string;
      context?: FeedbackContext;
    }) => AILearningClient.recordFeedback(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.feedback() });
      queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.patterns() });
      queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.stats() });
      toast.success("Feedback recorded");
    },
    onError: (error: Error) => {
      toast.error(`Failed to record feedback: ${error.message}`);
    },
  });
}

// ============ Style Guide Hooks ============

export function useStyleGuide() {
  return useQuery({
    queryKey: LEARNING_KEYS.styleGuide(),
    queryFn: () => AILearningClient.getStyleGuide(),
  });
}

export function useUpdateStyleGuide() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (updates: Partial<StyleGuide>) =>
      AILearningClient.updateStyleGuide(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.styleGuide() });
      toast.success("Style guide updated");
    },
    onError: (error: Error) => {
      toast.error(`Failed to update style guide: ${error.message}`);
    },
  });
}

// ============ Communication Preferences Hooks ============

export function useCommunicationPreferences() {
  return useQuery({
    queryKey: LEARNING_KEYS.communicationPrefs(),
    queryFn: () => AILearningClient.getCommunicationPreferences(),
  });
}

export function useUpdateCommunicationPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (updates: Partial<CommunicationPreferences>) =>
      AILearningClient.updateCommunicationPreferences(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.communicationPrefs() });
      toast.success("Communication preferences updated");
    },
    onError: (error: Error) => {
      toast.error(`Failed to update preferences: ${error.message}`);
    },
  });
}

// ============ Context Generation Hook ============

export function useGeneratePromptContext(options?: {
  includeStyle?: boolean;
  includePreferences?: boolean;
  includePatterns?: boolean;
  domains?: LearningDomain[];
}) {
  return useQuery({
    queryKey: [...LEARNING_KEYS.all, "context", options],
    queryFn: () => AILearningClient.generatePromptContext(options),
    enabled: false, // Manual trigger only
  });
}

export function useGenerateContext() {
  return useMutation({
    mutationFn: (options?: {
      includeStyle?: boolean;
      includePreferences?: boolean;
      includePatterns?: boolean;
      domains?: LearningDomain[];
    }) => AILearningClient.generatePromptContext(options),
  });
}

// ============ Stats Hook ============

export function useLearningStats() {
  return useQuery({
    queryKey: LEARNING_KEYS.stats(),
    queryFn: () => AILearningClient.getStats(),
  });
}

// ============ Event Subscription Hook ============

export function useLearningEvents(onEvent?: (event: LearningEvent) => void) {
  const queryClient = useQueryClient();
  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const subscribe = async () => {
      try {
        await AILearningClient.subscribe();
        setIsSubscribed(true);

        unsubscribe = AILearningClient.onEvent((event) => {
          // Invalidate relevant queries based on event type
          switch (event.type) {
            case "profile:created":
            case "profile:updated":
            case "profile:activated":
              queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.profiles() });
              queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.activeProfile() });
              break;
            case "pattern:learned":
            case "pattern:updated":
            case "pattern:disabled":
              queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.patterns() });
              queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.stats() });
              break;
            case "feedback:received":
            case "feedback:applied":
              queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.feedback() });
              queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.stats() });
              break;
            case "style:updated":
              queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.styleGuide() });
              break;
            case "preferences:updated":
              queryClient.invalidateQueries({ queryKey: LEARNING_KEYS.communicationPrefs() });
              break;
          }

          // Call custom handler if provided
          onEvent?.(event);
        });
      } catch (error) {
        console.error("Failed to subscribe to learning events:", error);
      }
    };

    subscribe();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
      AILearningClient.unsubscribe().catch(console.error);
      setIsSubscribed(false);
    };
  }, [queryClient, onEvent]);

  return { isSubscribed };
}

// ============ Combined Manager Hook ============

export function useAILearningManager() {
  // Initialize
  const initMutation = useInitializeAILearning();
  const shutdownMutation = useShutdownAILearning();

  // Profiles
  const { data: profiles, isLoading: profilesLoading } = useLearningProfiles();
  const { data: activeProfile, isLoading: activeProfileLoading } = useActiveProfile();
  const createProfileMutation = useCreateProfile();
  const updateProfileMutation = useUpdateProfile();
  const deleteProfileMutation = useDeleteProfile();
  const activateProfileMutation = useActivateProfile();

  // Patterns (from active profile)
  const { data: patterns, isLoading: patternsLoading } = useLearnedPatterns(
    activeProfile ? { profileId: activeProfile.id } : undefined
  );
  const learnPatternMutation = useLearnPattern();
  const updatePatternMutation = useUpdatePattern();
  const deletePatternMutation = useDeletePattern();
  const addExampleMutation = useAddPatternExample();

  // Feedback (from active profile)
  const { data: feedback, isLoading: feedbackLoading } = useFeedbackHistory(
    activeProfile ? { profileId: activeProfile.id, limit: 50 } : undefined
  );
  const recordFeedbackMutation = useRecordFeedback();

  // Style & Preferences
  const { data: styleGuide, isLoading: styleLoading } = useStyleGuide();
  const { data: communicationPrefs, isLoading: prefsLoading } = useCommunicationPreferences();
  const updateStyleMutation = useUpdateStyleGuide();
  const updatePrefsMutation = useUpdateCommunicationPreferences();

  // Stats
  const { data: stats, isLoading: statsLoading } = useLearningStats();

  // Context generation
  const generateContextMutation = useGenerateContext();

  // Events
  const { isSubscribed } = useLearningEvents();

  return {
    // State
    profiles: profiles ?? [],
    activeProfile,
    patterns: patterns ?? [],
    feedback: feedback ?? [],
    styleGuide,
    communicationPrefs,
    stats,
    isSubscribed,

    // Loading states
    isLoading:
      profilesLoading ||
      activeProfileLoading ||
      patternsLoading ||
      feedbackLoading ||
      styleLoading ||
      prefsLoading ||
      statsLoading,

    // Initialization
    initialize: initMutation.mutate,
    shutdown: shutdownMutation.mutate,
    isInitializing: initMutation.isPending,

    // Profile actions
    createProfile: createProfileMutation.mutate,
    updateProfile: updateProfileMutation.mutate,
    deleteProfile: deleteProfileMutation.mutate,
    activateProfile: activateProfileMutation.mutate,
    isProfileMutating:
      createProfileMutation.isPending ||
      updateProfileMutation.isPending ||
      deleteProfileMutation.isPending ||
      activateProfileMutation.isPending,

    // Pattern actions
    learnPattern: learnPatternMutation.mutate,
    updatePattern: updatePatternMutation.mutate,
    deletePattern: deletePatternMutation.mutate,
    addPatternExample: addExampleMutation.mutate,
    isPatternMutating:
      learnPatternMutation.isPending ||
      updatePatternMutation.isPending ||
      deletePatternMutation.isPending ||
      addExampleMutation.isPending,

    // Feedback actions
    recordFeedback: recordFeedbackMutation.mutate,
    isFeedbackMutating: recordFeedbackMutation.isPending,

    // Style & Preferences actions
    updateStyleGuide: updateStyleMutation.mutate,
    updateCommunicationPrefs: updatePrefsMutation.mutate,
    isStyleMutating: updateStyleMutation.isPending || updatePrefsMutation.isPending,

    // Context generation
    generateContext: generateContextMutation.mutateAsync,
    isGeneratingContext: generateContextMutation.isPending,
    generatedContext: generateContextMutation.data,
  };
}

// Export types
export type {
  ProfileId,
  PatternId,
  LearningDomain,
  PatternType,
  FeedbackType,
  LearningProfile,
  LearnedPattern,
  UserFeedback,
  PatternExample,
  FeedbackContext,
  StyleGuide,
  CommunicationPreferences,
  LearningStats,
  LearningEvent,
};
