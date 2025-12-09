/**
 * Database access layer for Dyad MCP Server
 *
 * Provides read-only access to Dyad's SQLite database
 * Note: This uses a simple approach without better-sqlite3 to avoid native dependencies
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
 * Uses Dyad's parent process database connection when available
 */
export class DyadDatabase {
  private dbPath: string;

  constructor(customPath?: string) {
    this.dbPath = customPath || this.getDefaultDatabasePath();

    if (!fs.existsSync(this.dbPath)) {
      throw new Error(
        `Dyad database not found at: ${this.dbPath}\n` +
        `Please ensure Dyad is installed and has been run at least once.`
      );
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

    return path.join(userDataPath, "dyad.db");
  }

  /**
   * Get the database path
   */
  getDatabasePath(): string {
    return this.dbPath;
  }

  // ============================================
  // App queries
  // Note: These methods now throw errors directing users to use Dyad's IPC
  // This MCP server should be run as a subprocess of Dyad itself
  // ============================================

  async listApps(): Promise<App[]> {
    throw new Error(
      "Database queries require Dyad to be running. " +
      "This MCP server should be configured to run through Dyad's IPC system."
    );
  }

  async getApp(appId: number): Promise<App | undefined> {
    throw new Error(
      "Database queries require Dyad to be running. " +
      "This MCP server should be configured to run through Dyad's IPC system."
    );
  }

  async searchApps(query: string): Promise<App[]> {
    throw new Error(
      "Database queries require Dyad to be running. " +
      "This MCP server should be configured to run through Dyad's IPC system."
    );
  }

  // ============================================
  // Chat queries
  // ============================================

  async listChats(appId?: number): Promise<Chat[]> {
    throw new Error(
      "Database queries require Dyad to be running. " +
      "This MCP server should be configured to run through Dyad's IPC system."
    );
  }

  async getChat(chatId: number): Promise<Chat | undefined> {
    throw new Error(
      "Database queries require Dyad to be running. " +
      "This MCP server should be configured to run through Dyad's IPC system."
    );
  }

  async searchChats(query: string, appId?: number): Promise<Chat[]> {
    throw new Error(
      "Database queries require Dyad to be running. " +
      "This MCP server should be configured to run through Dyad's IPC system."
    );
  }

  // ============================================
  // Message queries
  // ============================================

  async getChatMessages(chatId: number): Promise<Message[]> {
    throw new Error(
      "Database queries require Dyad to be running. " +
      "This MCP server should be configured to run through Dyad's IPC system."
    );
  }

  async getMessage(messageId: number): Promise<Message | undefined> {
    throw new Error(
      "Database queries require Dyad to be running. " +
      "This MCP server should be configured to run through Dyad's IPC system."
    );
  }
}
