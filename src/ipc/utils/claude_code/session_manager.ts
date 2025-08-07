import fs from 'fs-extra';
import path from 'path';
import log from "electron-log/main";
import { app } from 'electron';

const logger = log.scope("claude-session-manager");

export interface ClaudeSession {
  id: string;
  projectPath: string;
  conversationHistory: ConversationEntry[];
  workspaceState: WorkspaceState;
  createdAt: number;
  lastUsed: number;
  settings: SessionSettings;
}

export interface ConversationEntry {
  timestamp: number;
  type: 'command' | 'response' | 'error' | 'permission';
  content: string;
  metadata?: Record<string, any>;
}

export interface WorkspaceState {
  currentDirectory: string;
  openFiles: string[];
  modifiedFiles: string[];
  lastCommand?: string;
}

export interface SessionSettings {
  autoSave: boolean;
  maxHistoryEntries: number;
  persistenceLevel: 'none' | 'basic' | 'full';
}

export class SessionManager {
  private sessionsDir: string;
  private currentSession: ClaudeSession | null = null;
  private defaultSettings: SessionSettings = {
    autoSave: true,
    maxHistoryEntries: 1000,
    persistenceLevel: 'full'
  };

  constructor() {
    this.sessionsDir = path.join(app.getPath('userData'), 'claude-sessions');
    this.ensureSessionsDirectory();
  }

  private async ensureSessionsDirectory(): Promise<void> {
    await fs.ensureDir(this.sessionsDir);
  }

  async createSession(projectPath: string, settings?: Partial<SessionSettings>): Promise<ClaudeSession> {
    const sessionId = this.generateSessionId();
    const now = Date.now();

    const session: ClaudeSession = {
      id: sessionId,
      projectPath,
      conversationHistory: [],
      workspaceState: {
        currentDirectory: projectPath,
        openFiles: [],
        modifiedFiles: []
      },
      createdAt: now,
      lastUsed: now,
      settings: { ...this.defaultSettings, ...settings }
    };

    this.currentSession = session;
    await this.saveSession(session);

    logger.info("Created new Claude session:", sessionId);
    return session;
  }

  async loadSession(sessionId: string): Promise<ClaudeSession | null> {
    try {
      const sessionPath = path.join(this.sessionsDir, `${sessionId}.json`);
      
      if (!await fs.pathExists(sessionPath)) {
        logger.warn("Session file not found:", sessionId);
        return null;
      }

      const sessionData = await fs.readJSON(sessionPath);
      const session: ClaudeSession = {
        ...sessionData,
        lastUsed: Date.now()
      };

      this.currentSession = session;
      await this.saveSession(session); // Update lastUsed timestamp

      logger.info("Loaded Claude session:", sessionId);
      return session;
    } catch (error) {
      logger.error("Error loading session:", sessionId, error);
      return null;
    }
  }

  async saveSession(session?: ClaudeSession): Promise<void> {
    const sessionToSave = session || this.currentSession;
    if (!sessionToSave) {
      logger.warn("No session to save");
      return;
    }

    if (sessionToSave.settings.persistenceLevel === 'none') {
      return; // Don't save if persistence is disabled
    }

    try {
      const sessionPath = path.join(this.sessionsDir, `${sessionToSave.id}.json`);
      
      // Limit history size based on settings
      const limitedSession = this.limitSessionHistory(sessionToSave);
      
      await fs.writeJSON(sessionPath, limitedSession, { spaces: 2 });
      logger.debug("Session saved:", sessionToSave.id);
    } catch (error) {
      logger.error("Error saving session:", sessionToSave.id, error);
    }
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const sessionPath = path.join(this.sessionsDir, `${sessionId}.json`);
      await fs.remove(sessionPath);
      
      if (this.currentSession?.id === sessionId) {
        this.currentSession = null;
      }

      logger.info("Deleted session:", sessionId);
      return true;
    } catch (error) {
      logger.error("Error deleting session:", sessionId, error);
      return false;
    }
  }

  async listSessions(): Promise<ClaudeSession[]> {
    try {
      const files = await fs.readdir(this.sessionsDir);
      const sessionFiles = files.filter(file => file.endsWith('.json'));
      
      const sessions: ClaudeSession[] = [];
      
      for (const file of sessionFiles) {
        try {
          const sessionData = await fs.readJSON(path.join(this.sessionsDir, file));
          sessions.push(sessionData);
        } catch (error) {
          logger.warn("Error reading session file:", file, error);
        }
      }

      // Sort by last used, most recent first
      sessions.sort((a, b) => b.lastUsed - a.lastUsed);
      
      return sessions;
    } catch (error) {
      logger.error("Error listing sessions:", error);
      return [];
    }
  }

  addConversationEntry(entry: Omit<ConversationEntry, 'timestamp'>): void {
    if (!this.currentSession) {
      logger.warn("No current session to add conversation entry");
      return;
    }

    const fullEntry: ConversationEntry = {
      ...entry,
      timestamp: Date.now()
    };

    this.currentSession.conversationHistory.push(fullEntry);
    this.currentSession.lastUsed = Date.now();

    // Auto-save if enabled
    if (this.currentSession.settings.autoSave) {
      this.saveSession().catch(error => {
        logger.error("Error auto-saving session:", error);
      });
    }
  }

  updateWorkspaceState(updates: Partial<WorkspaceState>): void {
    if (!this.currentSession) {
      logger.warn("No current session to update workspace state");
      return;
    }

    this.currentSession.workspaceState = {
      ...this.currentSession.workspaceState,
      ...updates
    };

    this.currentSession.lastUsed = Date.now();
  }

  getCurrentSession(): ClaudeSession | null {
    return this.currentSession;
  }

  async findSessionForProject(projectPath: string): Promise<ClaudeSession | null> {
    const sessions = await this.listSessions();
    return sessions.find(session => session.projectPath === projectPath) || null;
  }

  async getOrCreateSessionForProject(projectPath: string): Promise<ClaudeSession> {
    let session = await this.findSessionForProject(projectPath);
    
    if (!session) {
      session = await this.createSession(projectPath);
    } else {
      this.currentSession = session;
      session.lastUsed = Date.now();
      await this.saveSession(session);
    }

    return session;
  }

  private generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `claude_${timestamp}_${random}`;
  }

  private limitSessionHistory(session: ClaudeSession): ClaudeSession {
    const maxEntries = session.settings.maxHistoryEntries;
    
    if (session.conversationHistory.length > maxEntries) {
      const limitedHistory = session.conversationHistory.slice(-maxEntries);
      return {
        ...session,
        conversationHistory: limitedHistory
      };
    }

    return session;
  }

  // Cleanup old sessions
  async cleanupOldSessions(maxAge: number = 30 * 24 * 60 * 60 * 1000): Promise<number> { // 30 days default
    try {
      const sessions = await this.listSessions();
      const now = Date.now();
      let deletedCount = 0;

      for (const session of sessions) {
        if (now - session.lastUsed > maxAge) {
          await this.deleteSession(session.id);
          deletedCount++;
        }
      }

      logger.info(`Cleaned up ${deletedCount} old sessions`);
      return deletedCount;
    } catch (error) {
      logger.error("Error cleaning up old sessions:", error);
      return 0;
    }
  }

  // Export session data
  async exportSession(sessionId: string): Promise<string | null> {
    try {
      const sessionPath = path.join(this.sessionsDir, `${sessionId}.json`);
      const sessionData = await fs.readJSON(sessionPath);
      return JSON.stringify(sessionData, null, 2);
    } catch (error) {
      logger.error("Error exporting session:", sessionId, error);
      return null;
    }
  }

  // Import session data
  async importSession(sessionData: string): Promise<ClaudeSession | null> {
    try {
      const session: ClaudeSession = JSON.parse(sessionData);
      
      // Generate new ID to avoid conflicts
      session.id = this.generateSessionId();
      session.lastUsed = Date.now();

      await this.saveSession(session);
      logger.info("Imported session:", session.id);
      
      return session;
    } catch (error) {
      logger.error("Error importing session:", error);
      return null;
    }
  }
}