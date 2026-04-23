/**
 * IPC Handlers for AI Learning Mode
 */

import { ipcMain } from "electron";
import {
  getAILearningMode,
  type ProfileId,
  type PatternId,
  type LearningDomain,
  type PatternType,
  type FeedbackType,
  type PatternExample,
  type FeedbackContext,
  type StyleGuide,
  type CommunicationPreferences,
} from "../../lib/ai_learning_mode";

export function registerAILearningHandlers(): void {
  const learning = getAILearningMode();

  // Auto-initialize on startup so the DB is ready without the UI needing to call initialize first.
  learning.initialize().catch((err) => {
    console.error("[ai-learning] Auto-initialization failed:", err);
  });

  // Initialize
  ipcMain.handle("ai-learning:initialize", async () => {
    await learning.initialize();
    return { success: true };
  });

  // Shutdown
  ipcMain.handle("ai-learning:shutdown", async () => {
    await learning.shutdown();
    return { success: true };
  });

  // Profile management
  ipcMain.handle(
    "ai-learning:create-profile",
    async (
      _,
      params: {
        name: string;
        description?: string;
        domains?: LearningDomain[];
      }
    ) => {
      return learning.createProfile(params);
    }
  );

  ipcMain.handle(
    "ai-learning:get-profile",
    async (_, params: { profileId: ProfileId }) => {
      return learning.getProfile(params.profileId);
    }
  );

  ipcMain.handle("ai-learning:list-profiles", async () => {
    return learning.listProfiles();
  });

  ipcMain.handle(
    "ai-learning:update-profile",
    async (
      _,
      params: {
        profileId: ProfileId;
        updates: Partial<{
          name: string;
          description: string;
          domains: LearningDomain[];
        }>;
      }
    ) => {
      return learning.updateProfile(params.profileId, params.updates);
    }
  );

  ipcMain.handle(
    "ai-learning:delete-profile",
    async (_, params: { profileId: ProfileId }) => {
      return learning.deleteProfile(params.profileId);
    }
  );

  ipcMain.handle(
    "ai-learning:activate-profile",
    async (_, params: { profileId: ProfileId }) => {
      return learning.activateProfile(params.profileId);
    }
  );

  ipcMain.handle("ai-learning:get-active-profile", async () => {
    return learning.getActiveProfile();
  });

  // Pattern management
  ipcMain.handle(
    "ai-learning:learn-pattern",
    async (
      _,
      params: {
        profileId: ProfileId;
        domain: LearningDomain;
        type: PatternType;
        name: string;
        description?: string;
        pattern: string;
        examples?: PatternExample[];
        confidence?: number;
        weight?: number;
      }
    ) => {
      return learning.learnPattern(params);
    }
  );

  ipcMain.handle(
    "ai-learning:get-pattern",
    async (_, params: { patternId: PatternId }) => {
      return learning.getPattern(params.patternId);
    }
  );

  ipcMain.handle(
    "ai-learning:list-patterns",
    async (
      _,
      params?: {
        profileId?: ProfileId;
        domain?: LearningDomain;
        type?: PatternType;
        enabled?: boolean;
      }
    ) => {
      return learning.listPatterns(params);
    }
  );

  ipcMain.handle(
    "ai-learning:update-pattern",
    async (
      _,
      params: {
        patternId: PatternId;
        updates: Partial<{
          name: string;
          description: string;
          pattern: string;
          confidence: number;
          weight: number;
          isEnabled: boolean;
        }>;
      }
    ) => {
      return learning.updatePattern(params.patternId, params.updates);
    }
  );

  ipcMain.handle(
    "ai-learning:add-pattern-example",
    async (
      _,
      params: {
        patternId: PatternId;
        example: PatternExample;
      }
    ) => {
      return learning.addPatternExample(params.patternId, params.example);
    }
  );

  ipcMain.handle(
    "ai-learning:delete-pattern",
    async (_, params: { patternId: PatternId }) => {
      return learning.deletePattern(params.patternId);
    }
  );

  ipcMain.handle(
    "ai-learning:search-patterns",
    async (
      _,
      params: {
        query: string;
        profileId?: ProfileId;
      }
    ) => {
      return learning.searchPatterns(params.query, params.profileId);
    }
  );

  // Feedback
  ipcMain.handle(
    "ai-learning:record-feedback",
    async (
      _,
      params: {
        profileId: ProfileId;
        patternId?: PatternId;
        type: FeedbackType;
        domain: LearningDomain;
        originalResponse: string;
        correctedResponse?: string;
        feedbackText?: string;
        context?: FeedbackContext;
      }
    ) => {
      return learning.recordFeedback(params);
    }
  );

  ipcMain.handle(
    "ai-learning:list-feedback",
    async (
      _,
      params?: {
        profileId?: ProfileId;
        patternId?: PatternId;
        type?: FeedbackType;
        domain?: LearningDomain;
        limit?: number;
      }
    ) => {
      return learning.listFeedback(params);
    }
  );

  // Style guide
  ipcMain.handle("ai-learning:get-style-guide", async () => {
    return learning.getStyleGuide();
  });

  ipcMain.handle(
    "ai-learning:update-style-guide",
    async (_, params: { updates: Partial<StyleGuide> }) => {
      return learning.updateStyleGuide(params.updates);
    }
  );

  // Communication preferences
  ipcMain.handle("ai-learning:get-communication-prefs", async () => {
    return learning.getCommunicationPreferences();
  });

  ipcMain.handle(
    "ai-learning:update-communication-prefs",
    async (_, params: { updates: Partial<CommunicationPreferences> }) => {
      return learning.updateCommunicationPreferences(params.updates);
    }
  );

  // Context generation
  ipcMain.handle(
    "ai-learning:generate-context",
    async (
      _,
      params?: {
        includeStyle?: boolean;
        includePreferences?: boolean;
        includePatterns?: boolean;
        domains?: LearningDomain[];
      }
    ) => {
      return learning.generatePromptContext(params);
    }
  );

  // Stats
  ipcMain.handle("ai-learning:get-stats", async () => {
    return learning.getStats();
  });

  // Subscribe to events
  const subscriptions = new Map<string, () => void>();

  ipcMain.handle("ai-learning:subscribe", (event) => {
    const webContentsId = event.sender.id.toString();

    if (subscriptions.has(webContentsId)) {
      subscriptions.get(webContentsId)!();
    }

    const unsubscribe = learning.subscribe((learningEvent) => {
      try {
        event.sender.send("ai-learning:event", learningEvent);
      } catch {
        unsubscribe();
        subscriptions.delete(webContentsId);
      }
    });

    subscriptions.set(webContentsId, unsubscribe);
    return { success: true };
  });

  ipcMain.handle("ai-learning:unsubscribe", (event) => {
    const webContentsId = event.sender.id.toString();
    if (subscriptions.has(webContentsId)) {
      subscriptions.get(webContentsId)!();
      subscriptions.delete(webContentsId);
    }
    return { success: true };
  });
}
