/**
 * IPC Client for Dyad MCP Server
 * 
 * Communicates with the main Dyad application via IPC
 * instead of accessing the database directly
 */

import { App, Chat, Message } from "./database.js";

/**
 * IPC Client to communicate with Dyad main process
 */
export class DyadIpcClient {
  private isConnected: boolean = false;

  constructor() {
    // Check if we're running as a child process of Dyad
    this.isConnected = this.checkConnection();
  }

  /**
   * Check if we can connect to Dyad via IPC
   */
  private checkConnection(): boolean {
    // Check if we have access to the IPC channel
    // This would be provided by Dyad when launching the MCP server
    return process.env.DYAD_IPC_ENABLED === "true";
  }

  /**
   * Send a request to Dyad main process
   */
  private async sendRequest<T>(
    method: string,
    params?: any
  ): Promise<T> {
    if (!this.isConnected) {
      throw new Error(
        "Not connected to Dyad. This MCP server must be launched by Dyad " +
        "or have access to Dyad's IPC channel."
      );
    }

    // In a real implementation, this would use:
    // - process.send() for child_process IPC
    // - MessagePort for worker_threads
    // - HTTP for remote connection
    
    // For now, throw an error to indicate IPC is not yet implemented
    throw new Error(
      `IPC method '${method}' not yet implemented. ` +
      "The MCP server needs to be integrated with Dyad's IPC system."
    );
  }

  /**
   * List all apps via IPC
   */
  async listApps(): Promise<App[]> {
    return this.sendRequest<App[]>("list-apps");
  }

  /**
   * Get app by ID via IPC
   */
  async getApp(appId: number): Promise<App | undefined> {
    return this.sendRequest<App | undefined>("get-app", { appId });
  }

  /**
   * Search apps via IPC
   */
  async searchApps(query: string): Promise<App[]> {
    return this.sendRequest<App[]>("search-apps", { query });
  }

  /**
   * List chats via IPC
   */
  async listChats(appId?: number): Promise<Chat[]> {
    return this.sendRequest<Chat[]>("list-chats", { appId });
  }

  /**
   * Get chat by ID via IPC
   */
  async getChat(chatId: number): Promise<Chat | undefined> {
    return this.sendRequest<Chat | undefined>("get-chat", { chatId });
  }

  /**
   * Search chats via IPC
   */
  async searchChats(query: string, appId?: number): Promise<Chat[]> {
    return this.sendRequest<Chat[]>("search-chats", { query, appId });
  }

  /**
   * Get chat messages via IPC
   */
  async getChatMessages(chatId: number): Promise<Message[]> {
    return this.sendRequest<Message[]>("get-chat-messages", { chatId });
  }

  /**
   * Get message by ID via IPC
   */
  async getMessage(messageId: number): Promise<Message | undefined> {
    return this.sendRequest<Message | undefined>("get-message", { messageId });
  }
}
