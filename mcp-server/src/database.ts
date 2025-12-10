/**
 * Database access layer for Dyad MCP Server
 *
 * Supports both SQLite (desktop) and PostgreSQL (web/server) via REST API
 */

import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

export interface App {
  id: number;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  favorite?: boolean;
  template?: string | null;
}

export interface Chat {
  id: number;
  appId: number;
  title: string;
  createdAt: string;
  initialCommitHash?: string | null;
}

export interface Message {
  id: number;
  chatId: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  approvalState?: "approved" | "rejected" | null;
}

/**
 * Database manager for Dyad
 * Supports both local SQLite and remote PostgreSQL via REST API
 */
export class DyadDatabase {
  private dbPath!: string;
  private apiUrl?: string;
  private mode: "sqlite" | "api";

  constructor(customPath?: string) {
    // Check if API URL is provided for web mode
    this.apiUrl = process.env.DYAD_API_URL;

    if (this.apiUrl) {
      this.mode = "api";
      console.error(`[MCP] Using API mode: ${this.apiUrl}`);
    } else {
      this.mode = "sqlite";
      this.dbPath = customPath || this.getDefaultDatabasePath();

      if (!fs.existsSync(this.dbPath)) {
        throw new Error(
          `Dyad database not found at: ${this.dbPath}\n` +
          `For web mode, set DYAD_API_URL environment variable.\n` +
          `For desktop mode, ensure Dyad is installed and has been run at least once.`
        );
      }
      console.error(`[MCP] Using SQLite mode: ${this.dbPath}`);
    }
  }

  /**
   * Make API request to Dyad server
   */
  private async apiRequest<T>(endpoint: string): Promise<T> {
    if (!this.apiUrl) {
      throw new Error("API URL not configured");
    }

    const url = `${this.apiUrl}${endpoint}`;
    console.error(`[MCP] API Request: ${url}`);

    try {
      const response = await fetch(url, {
        headers: {
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      return await response.json() as T;
    } catch (error) {
      console.error(`[MCP] API error:`, error);
      throw new Error(`Failed to fetch from Dyad API: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get the default Dyad database path based on OS
   */
  private getDefaultDatabasePath(): string {
    const platform = os.platform();
    const homeDir = os.homedir();

    let userDataPath: string;

    switch (platform) {
      case "darwin": // macOS
        userDataPath = path.join(
          homeDir,
          "Library",
          "Application Support",
          "dyad"
        );
        break;
      case "win32": // Windows
        userDataPath = path.join(
          process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"),
          "dyad"
        );
        break;
      case "linux":
        userDataPath = path.join(
          process.env.XDG_CONFIG_HOME || path.join(homeDir, ".config"),
          "dyad"
        );
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }

    return path.join(userDataPath, "sqlite.db");
  }

  /**
   * Get the database path
   */
  getDatabasePath(): string {
    return this.dbPath;
  }

  // ============================================
  // App queries
  // ============================================

  async listApps(): Promise<App[]> {
    if (this.mode === "api") {
      const response = await this.apiRequest<{ apps: App[] }>("/api/apps");
      return response.apps || [];
    }

    throw new Error(
      "SQLite mode requires direct database access implementation. " +
      "Use DYAD_API_URL for web mode or implement SQLite connector."
    );
  }

  async getApp(appId: number): Promise<App | undefined> {
    if (this.mode === "api") {
      try {
        const app = await this.apiRequest<App>(`/api/apps/${appId}`);
        return app;
      } catch (error) {
        return undefined;
      }
    }

    throw new Error(
      "SQLite mode requires direct database access implementation. " +
      "Use DYAD_API_URL for web mode or implement SQLite connector."
    );
  }

  async searchApps(query: string): Promise<App[]> {
    if (this.mode === "api") {
      const allApps = await this.listApps();
      return allApps.filter(app =>
        app.name.toLowerCase().includes(query.toLowerCase())
      );
    }

    throw new Error(
      "SQLite mode requires direct database access implementation. " +
      "Use DYAD_API_URL for web mode or implement SQLite connector."
    );
  }

  // ============================================
  // Chat queries
  // ============================================

  async listChats(appId?: number): Promise<Chat[]> {
    if (this.mode === "api") {
      const endpoint = appId
        ? `/api/apps/${appId}/chats`
        : "/api/chats";
      const response = await this.apiRequest<{ chats: Chat[] }>(endpoint);
      return response.chats || [];
    }

    throw new Error(
      "SQLite mode requires direct database access implementation. " +
      "Use DYAD_API_URL for web mode or implement SQLite connector."
    );
  }

  async getChat(chatId: number): Promise<Chat | undefined> {
    if (this.mode === "api") {
      try {
        const chat = await this.apiRequest<Chat>(`/api/chats/${chatId}`);
        return chat;
      } catch (error) {
        return undefined;
      }
    }

    throw new Error(
      "SQLite mode requires direct database access implementation. " +
      "Use DYAD_API_URL for web mode or implement SQLite connector."
    );
  }

  async searchChats(query: string, appId?: number): Promise<Chat[]> {
    if (this.mode === "api") {
      const chats = await this.listChats(appId);
      return chats.filter(chat =>
        chat.title.toLowerCase().includes(query.toLowerCase())
      );
    }

    throw new Error(
      "SQLite mode requires direct database access implementation. " +
      "Use DYAD_API_URL for web mode or implement SQLite connector."
    );
  }

  // ============================================
  // Message queries
  // ============================================

  async getChatMessages(chatId: number): Promise<Message[]> {
    if (this.mode === "api") {
      const response = await this.apiRequest<{ messages: Message[] }>(`/api/chats/${chatId}/messages`);
      return response.messages || [];
    }

    throw new Error(
      "SQLite mode requires direct database access implementation. " +
      "Use DYAD_API_URL for web mode or implement SQLite connector."
    );
  }

  async getMessage(messageId: number): Promise<Message | undefined> {
    if (this.mode === "api") {
      try {
        const message = await this.apiRequest<Message>(`/api/messages/${messageId}`);
        return message;
      } catch (error) {
        return undefined;
      }
    }

    throw new Error(
      "SQLite mode requires direct database access implementation. " +
      "Use DYAD_API_URL for web mode or implement SQLite connector."
    );
  }
}
