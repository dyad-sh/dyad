/**
 * AI Learning Mode IPC Client
 * Renderer-side API for learning mode operations
 */

import type {
  ProfileId,
  PatternId,
  FeedbackId,
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
} from "../lib/ai_learning_mode";

function getIpcRenderer() {
  return (window as any).electron?.ipcRenderer;
}

export const AILearningClient = {
  // Initialization
  async initialize(): Promise<{ success: boolean }> {
    return getIpcRenderer()?.invoke("ai-learning:initialize");
  },

  async shutdown(): Promise<{ success: boolean }> {
    return getIpcRenderer()?.invoke("ai-learning:shutdown");
  },

  // Profile management
  async createProfile(params: {
    name: string;
    description?: string;
    domains?: LearningDomain[];
  }): Promise<LearningProfile> {
    return getIpcRenderer()?.invoke("ai-learning:create-profile", params);
  },

  async getProfile(profileId: ProfileId): Promise<LearningProfile | null> {
    return getIpcRenderer()?.invoke("ai-learning:get-profile", { profileId });
  },

  async listProfiles(): Promise<LearningProfile[]> {
    return getIpcRenderer()?.invoke("ai-learning:list-profiles");
  },

  async updateProfile(
    profileId: ProfileId,
    updates: Partial<{
      name: string;
      description: string;
      domains: LearningDomain[];
    }>
  ): Promise<LearningProfile | null> {
    return getIpcRenderer()?.invoke("ai-learning:update-profile", { profileId, updates });
  },

  async deleteProfile(profileId: ProfileId): Promise<boolean> {
    return getIpcRenderer()?.invoke("ai-learning:delete-profile", { profileId });
  },

  async activateProfile(profileId: ProfileId): Promise<boolean> {
    return getIpcRenderer()?.invoke("ai-learning:activate-profile", { profileId });
  },

  async getActiveProfile(): Promise<LearningProfile | null> {
    return getIpcRenderer()?.invoke("ai-learning:get-active-profile");
  },

  // Pattern management
  async learnPattern(params: {
    profileId: ProfileId;
    domain: LearningDomain;
    type: PatternType;
    name: string;
    description?: string;
    pattern: string;
    examples?: PatternExample[];
    confidence?: number;
    weight?: number;
  }): Promise<LearnedPattern> {
    return getIpcRenderer()?.invoke("ai-learning:learn-pattern", params);
  },

  async getPattern(patternId: PatternId): Promise<LearnedPattern | null> {
    return getIpcRenderer()?.invoke("ai-learning:get-pattern", { patternId });
  },

  async listPatterns(filters?: {
    profileId?: ProfileId;
    domain?: LearningDomain;
    type?: PatternType;
    enabled?: boolean;
  }): Promise<LearnedPattern[]> {
    return getIpcRenderer()?.invoke("ai-learning:list-patterns", filters);
  },

  async updatePattern(
    patternId: PatternId,
    updates: Partial<{
      name: string;
      description: string;
      pattern: string;
      confidence: number;
      weight: number;
      isEnabled: boolean;
    }>
  ): Promise<LearnedPattern | null> {
    return getIpcRenderer()?.invoke("ai-learning:update-pattern", { patternId, updates });
  },

  async addPatternExample(patternId: PatternId, example: PatternExample): Promise<LearnedPattern | null> {
    return getIpcRenderer()?.invoke("ai-learning:add-pattern-example", { patternId, example });
  },

  async deletePattern(patternId: PatternId): Promise<boolean> {
    return getIpcRenderer()?.invoke("ai-learning:delete-pattern", { patternId });
  },

  async searchPatterns(query: string, profileId?: ProfileId): Promise<LearnedPattern[]> {
    return getIpcRenderer()?.invoke("ai-learning:search-patterns", { query, profileId });
  },

  // Feedback
  async recordFeedback(params: {
    profileId: ProfileId;
    patternId?: PatternId;
    type: FeedbackType;
    domain: LearningDomain;
    originalResponse: string;
    correctedResponse?: string;
    feedbackText?: string;
    context?: FeedbackContext;
  }): Promise<UserFeedback> {
    return getIpcRenderer()?.invoke("ai-learning:record-feedback", params);
  },

  async listFeedback(filters?: {
    profileId?: ProfileId;
    patternId?: PatternId;
    type?: FeedbackType;
    domain?: LearningDomain;
    limit?: number;
  }): Promise<UserFeedback[]> {
    return getIpcRenderer()?.invoke("ai-learning:list-feedback", filters);
  },

  // Style guide
  async getStyleGuide(): Promise<StyleGuide> {
    return getIpcRenderer()?.invoke("ai-learning:get-style-guide");
  },

  async updateStyleGuide(updates: Partial<StyleGuide>): Promise<StyleGuide> {
    return getIpcRenderer()?.invoke("ai-learning:update-style-guide", { updates });
  },

  // Communication preferences
  async getCommunicationPreferences(): Promise<CommunicationPreferences> {
    return getIpcRenderer()?.invoke("ai-learning:get-communication-prefs");
  },

  async updateCommunicationPreferences(
    updates: Partial<CommunicationPreferences>
  ): Promise<CommunicationPreferences> {
    return getIpcRenderer()?.invoke("ai-learning:update-communication-prefs", { updates });
  },

  // Context generation
  async generatePromptContext(options?: {
    includeStyle?: boolean;
    includePreferences?: boolean;
    includePatterns?: boolean;
    domains?: LearningDomain[];
  }): Promise<string> {
    return getIpcRenderer()?.invoke("ai-learning:generate-context", options);
  },

  // Stats
  async getStats(): Promise<LearningStats> {
    return getIpcRenderer()?.invoke("ai-learning:get-stats");
  },

  // Event subscription
  async subscribe(): Promise<{ success: boolean }> {
    return getIpcRenderer()?.invoke("ai-learning:subscribe");
  },

  async unsubscribe(): Promise<{ success: boolean }> {
    return getIpcRenderer()?.invoke("ai-learning:unsubscribe");
  },

  onEvent(callback: (event: LearningEvent) => void): () => void {
    const handler = (_: any, event: LearningEvent) => callback(event);
    getIpcRenderer()?.on("ai-learning:event", handler);
    return () => getIpcRenderer()?.off("ai-learning:event", handler);
  },
};

export type {
  ProfileId,
  PatternId,
  FeedbackId,
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
