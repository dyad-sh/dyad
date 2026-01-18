/**
 * Decentralized Chat Client
 * Renderer-side client for wallet-to-wallet encrypted messaging
 */

import type { IpcRenderer } from "electron";
import type {
  ChatIdentity,
  ChatMessage,
  ChatConversation,
  ChatPresenceStatus,
  ChatEvent,
  SendMessageRequest,
  SendMessageResult,
  CreateConversationRequest,
  CreateConversationResult,
  PullPinnedMessagesRequest,
  PullPinnedMessagesResult,
  SyncMessagesResult,
  ChatServiceStatus,
} from "@/types/decentralized_chat_types";

type EventCallback = (event: ChatEvent) => void;

class DecentralizedChatClient {
  private static instance: DecentralizedChatClient;
  private ipcRenderer: IpcRenderer;
  private eventListeners: Map<string, Set<EventCallback>> = new Map();
  private identity: ChatIdentity | null = null;

  private constructor() {
    this.ipcRenderer = (window as any).electron.ipcRenderer as IpcRenderer;
    this.setupEventListener();
  }

  static getInstance(): DecentralizedChatClient {
    if (!DecentralizedChatClient.instance) {
      DecentralizedChatClient.instance = new DecentralizedChatClient();
    }
    return DecentralizedChatClient.instance;
  }

  private setupEventListener(): void {
    this.ipcRenderer.on("decentralized-chat:event", (_event: unknown, chatEvent: ChatEvent) => {
      this.notifyListeners(chatEvent);
    });
  }

  private notifyListeners(event: ChatEvent): void {
    // Notify all listeners
    const allListeners = this.eventListeners.get("*");
    if (allListeners) {
      allListeners.forEach(cb => cb(event));
    }

    // Notify type-specific listeners
    const typeListeners = this.eventListeners.get(event.type);
    if (typeListeners) {
      typeListeners.forEach(cb => cb(event));
    }
  }

  // ============================================================================
  // Event Subscription
  // ============================================================================

  /**
   * Subscribe to chat events
   * @param eventType Event type to listen for, or "*" for all events
   * @param callback Callback function
   * @returns Unsubscribe function
   */
  on(eventType: ChatEvent["type"] | "*", callback: EventCallback): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(callback);

    return () => {
      this.eventListeners.get(eventType)?.delete(callback);
    };
  }

  /**
   * Subscribe to an event once
   */
  once(eventType: ChatEvent["type"] | "*", callback: EventCallback): void {
    const unsubscribe = this.on(eventType, (event) => {
      unsubscribe();
      callback(event);
    });
  }

  // ============================================================================
  // Identity Management
  // ============================================================================

  /**
   * Create a new chat identity linked to a wallet
   */
  async createIdentity(
    walletAddress: string,
    displayName?: string,
    walletSignature?: string
  ): Promise<{ identity: ChatIdentity; secretKeys: { encryption: string; signing: string } }> {
    const result = await this.ipcRenderer.invoke(
      "dchat:identity:create",
      walletAddress,
      displayName,
      walletSignature
    );
    this.identity = result.identity;
    return result;
  }

  /**
   * Get the local chat identity
   */
  async getIdentity(): Promise<ChatIdentity | null> {
    const identity = await this.ipcRenderer.invoke("dchat:identity:get");
    this.identity = identity;
    return identity;
  }

  /**
   * Update identity profile
   */
  async updateProfile(updates: {
    displayName?: string;
    avatar?: string;
    bio?: string;
    status?: ChatPresenceStatus;
  }): Promise<ChatIdentity | null> {
    const identity = await this.ipcRenderer.invoke("dchat:identity:update", updates);
    this.identity = identity;
    return identity;
  }

  /**
   * Get cached identity (without IPC call)
   */
  getCachedIdentity(): ChatIdentity | null {
    return this.identity;
  }

  // ============================================================================
  // Conversation Management
  // ============================================================================

  /**
   * Create a new conversation
   */
  async createConversation(request: CreateConversationRequest): Promise<CreateConversationResult> {
    return this.ipcRenderer.invoke("dchat:conversation:create", request);
  }

  /**
   * Create or get direct conversation with a wallet
   */
  async getOrCreateDirectConversation(walletAddress: string): Promise<CreateConversationResult> {
    // Try to get existing
    const existing = await this.getDirectConversation(walletAddress);
    if (existing) {
      return { success: true, conversation: existing };
    }

    // Create new
    return this.createConversation({
      type: "direct",
      participants: [walletAddress],
    });
  }

  /**
   * Get a conversation by ID
   */
  async getConversation(conversationId: string): Promise<ChatConversation | null> {
    return this.ipcRenderer.invoke("dchat:conversation:get", conversationId);
  }

  /**
   * List all conversations
   */
  async listConversations(): Promise<ChatConversation[]> {
    return this.ipcRenderer.invoke("dchat:conversation:list");
  }

  /**
   * Get direct conversation with a wallet
   */
  async getDirectConversation(walletAddress: string): Promise<ChatConversation | null> {
    return this.ipcRenderer.invoke("dchat:conversation:get-direct", walletAddress);
  }

  // ============================================================================
  // Messaging
  // ============================================================================

  /**
   * Send a message
   */
  async sendMessage(request: SendMessageRequest): Promise<SendMessageResult> {
    return this.ipcRenderer.invoke("dchat:message:send", request);
  }

  /**
   * Send a text message (convenience method)
   */
  async sendText(conversationId: string, content: string, options?: {
    replyTo?: string;
    threadId?: string;
    expiresIn?: number;
  }): Promise<SendMessageResult> {
    return this.sendMessage({
      conversationId,
      content,
      messageType: "text",
      ...options,
    });
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(
    conversationId: string,
    options?: {
      limit?: number;
      before?: string;
      after?: string;
    }
  ): Promise<ChatMessage[]> {
    return this.ipcRenderer.invoke("dchat:message:get", conversationId, options);
  }

  /**
   * Get decrypted messages for a conversation
   */
  async getDecryptedMessages(conversationId: string): Promise<Array<ChatMessage & { decryptedContent?: string }>> {
    return this.ipcRenderer.invoke("dchat:message:decrypt", conversationId);
  }

  // ============================================================================
  // IPFS/Helia Pinning
  // ============================================================================

  /**
   * Pull pinned messages from Helia
   */
  async pullPinnedMessages(request: PullPinnedMessagesRequest): Promise<PullPinnedMessagesResult> {
    return this.ipcRenderer.invoke("dchat:pin:pull", request);
  }

  /**
   * Pull messages for a specific conversation
   */
  async pullConversationMessages(conversationId: string): Promise<PullPinnedMessagesResult> {
    return this.pullPinnedMessages({ conversationId });
  }

  /**
   * Pull specific message CIDs
   */
  async pullMessagesByCid(cids: string[]): Promise<PullPinnedMessagesResult> {
    return this.pullPinnedMessages({ cids });
  }

  // ============================================================================
  // Sync & Offline
  // ============================================================================

  /**
   * Sync all conversations when coming online
   */
  async syncOnComingOnline(): Promise<SyncMessagesResult> {
    return this.ipcRenderer.invoke("dchat:sync:online");
  }

  /**
   * Check for offline messages
   */
  async checkOfflineMessages(): Promise<ChatMessage[]> {
    return this.ipcRenderer.invoke("dchat:offline:check");
  }

  // ============================================================================
  // Presence & Typing
  // ============================================================================

  /**
   * Broadcast presence status
   */
  async broadcastPresence(status: ChatPresenceStatus): Promise<void> {
    return this.ipcRenderer.invoke("dchat:presence:broadcast", status);
  }

  /**
   * Set online status
   */
  async setOnline(): Promise<void> {
    return this.broadcastPresence("online");
  }

  /**
   * Set away status
   */
  async setAway(): Promise<void> {
    return this.broadcastPresence("away");
  }

  /**
   * Set offline status
   */
  async setOffline(): Promise<void> {
    return this.broadcastPresence("offline");
  }

  /**
   * Send typing indicator
   */
  async sendTypingIndicator(conversationId: string, isTyping: boolean): Promise<void> {
    return this.ipcRenderer.invoke("dchat:typing:send", conversationId, isTyping);
  }

  /**
   * Start typing in a conversation
   */
  async startTyping(conversationId: string): Promise<void> {
    return this.sendTypingIndicator(conversationId, true);
  }

  /**
   * Stop typing in a conversation
   */
  async stopTyping(conversationId: string): Promise<void> {
    return this.sendTypingIndicator(conversationId, false);
  }

  // ============================================================================
  // Service Status
  // ============================================================================

  /**
   * Get chat service status
   */
  async getStatus(): Promise<ChatServiceStatus> {
    return this.ipcRenderer.invoke("dchat:status");
  }

  /**
   * Check if chat is initialized
   */
  async isInitialized(): Promise<boolean> {
    const status = await this.getStatus();
    return status.initialized;
  }

  /**
   * Check if connected to Helia network
   */
  async isConnected(): Promise<boolean> {
    const status = await this.getStatus();
    return status.heliaConnected;
  }

  // ============================================================================
  // Self-Test Methods
  // ============================================================================

  /**
   * Test encryption round-trip
   */
  async testEncryption(message: string): Promise<{
    success: boolean;
    originalMessage: string;
    decryptedMessage: string;
    encryptedLength: number;
    algorithm: string;
  }> {
    return this.ipcRenderer.invoke("dchat:test:encryption", message);
  }

  /**
   * Test pinning to IPFS (minimal footprint)
   */
  async testPin(data?: unknown): Promise<{
    success: boolean;
    cid: string;
    dataSize: number;
    verified: boolean;
  }> {
    return this.ipcRenderer.invoke("dchat:test:pin", data);
  }

  /**
   * Test P2P connectivity
   */
  async testConnectivity(): Promise<{
    heliaInitialized: boolean;
    identityInitialized: boolean;
    peerCount: number;
    walletAddress?: string;
    pubsubReady: boolean;
  }> {
    return this.ipcRenderer.invoke("dchat:test:connectivity");
  }
}

export const decentralizedChatClient = DecentralizedChatClient.getInstance();
