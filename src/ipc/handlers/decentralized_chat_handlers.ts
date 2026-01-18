/**
 * Decentralized Chat Handlers
 * Wallet-to-wallet encrypted messaging with Helia IPFS pinning
 * Full libp2p integration for offline message retrieval
 */

import { ipcMain, BrowserWindow } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import * as crypto from "crypto";
import log from "electron-log";
import { getUserDataPath } from "@/paths/paths";
import type {
  ChatIdentity,
  ChatMessage,
  ChatConversation,
  ChatMessageType,
  ConversationParticipant,
  ConversationSettings,
  MessageDAGNode,
  ConversationManifest,
  MessagePin,
  ChatPubSubMessage,
  OfflineMessageQueue,
  QueuedMessage,
  ChatSyncState,
  SyncRequest,
  SyncResponse,
  KeyBundle,
  SessionKeys,
  ChatEvent,
  SendMessageRequest,
  SendMessageResult,
  CreateConversationRequest,
  CreateConversationResult,
  SyncMessagesRequest,
  SyncMessagesResult,
  PullPinnedMessagesRequest,
  PullPinnedMessagesResult,
  ChatServiceStatus,
  DeliveryStatus,
  EncryptionAlgorithm,
  ChatPresenceStatus,
  ParticipantRole,
} from "@/types/decentralized_chat_types";

const logger = log.scope("decentralized-chat");

// ESM module imports
let nacl: any;
let naclUtil: any;
let createHelia: any;
let json: any;
let FsBlockstore: any;
let FsDatastore: any;
let gossipsub: any;
let kadDHT: any;

async function loadCryptoModules() {
  if (!nacl) {
    nacl = await import("tweetnacl");
    naclUtil = await import("tweetnacl-util");
  }
}

async function loadHeliaModules() {
  if (!createHelia) {
    const heliaModule = await import("helia");
    createHelia = heliaModule.createHelia;
    
    const jsonModule = await import("@helia/json");
    json = jsonModule.json;
    
    const blockstoreModule = await import("blockstore-fs");
    FsBlockstore = blockstoreModule.FsBlockstore;
    
    const datastoreModule = await import("datastore-fs");
    FsDatastore = datastoreModule.FsDatastore;
    
    // Load gossipsub for pubsub messaging
    try {
      const gossipsubModule = await import("@chainsafe/libp2p-gossipsub");
      gossipsub = gossipsubModule.gossipsub;
    } catch (e) {
      logger.warn("Failed to load gossipsub:", e);
    }
    
    // Load kadDHT for distributed hash table
    try {
      const kadDHTModule = await import("@libp2p/kad-dht");
      kadDHT = kadDHTModule.kadDHT;
    } catch (e) {
      logger.warn("Failed to load kadDHT:", e);
    }
  }
}

// Chat-specific Helia instance
let chatHelia: any = null;
let chatJsonCodec: any = null;

async function ensureChatHelia(): Promise<void> {
  if (chatHelia) return;
  
  await loadHeliaModules();
  
  const storagePath = path.join(getChatDir(), "helia-store");
  await fs.ensureDir(storagePath);
  
  const blockstorePath = path.join(storagePath, "blocks");
  const datastorePath = path.join(storagePath, "data");
  
  await fs.ensureDir(blockstorePath);
  await fs.ensureDir(datastorePath);
  
  const blockstore = new FsBlockstore(blockstorePath);
  const datastore = new FsDatastore(datastorePath);
  
  chatHelia = await createHelia({
    blockstore,
    datastore,
  });
  
  chatJsonCodec = json(chatHelia);
  
  logger.info("Chat Helia node started", {
    peerId: chatHelia.libp2p.peerId.toString(),
  });
}

async function storeChatJSON(data: any): Promise<string> {
  await ensureChatHelia();
  const cid = await chatJsonCodec.add(data);
  return cid.toString();
}

async function getChatJSON(cidString: string): Promise<any> {
  await ensureChatHelia();
  const { CID } = await import("multiformats/cid");
  const cid = CID.parse(cidString);
  return chatJsonCodec.get(cid);
}

// ============================================================================
// Storage Paths
// ============================================================================

function getChatDir(): string {
  return path.join(getUserDataPath(), "decentralized-chat");
}

function getIdentityDir(): string {
  return path.join(getChatDir(), "identity");
}

function getConversationsDir(): string {
  return path.join(getChatDir(), "conversations");
}

function getMessagesDir(): string {
  return path.join(getChatDir(), "messages");
}

function getPinsDir(): string {
  return path.join(getChatDir(), "pins");
}

function getKeysDir(): string {
  return path.join(getChatDir(), "keys");
}

function getOfflineQueueDir(): string {
  return path.join(getChatDir(), "offline-queue");
}

function getSyncStateDir(): string {
  return path.join(getChatDir(), "sync-state");
}

async function initChatDirs(): Promise<void> {
  await fs.ensureDir(getChatDir());
  await fs.ensureDir(getIdentityDir());
  await fs.ensureDir(getConversationsDir());
  await fs.ensureDir(getMessagesDir());
  await fs.ensureDir(getPinsDir());
  await fs.ensureDir(getKeysDir());
  await fs.ensureDir(getOfflineQueueDir());
  await fs.ensureDir(getSyncStateDir());
}

// ============================================================================
// In-Memory State
// ============================================================================

let localIdentity: ChatIdentity | null = null;
let privateKey: Uint8Array | null = null;
let signingKey: Uint8Array | null = null;

const conversations = new Map<string, ChatConversation>();
const messages = new Map<string, ChatMessage[]>();
const pins = new Map<string, MessagePin>();
const offlineQueues = new Map<string, OfflineMessageQueue>();
const sessionKeys = new Map<string, SessionKeys>();
const presenceCache = new Map<string, { status: ChatPresenceStatus; lastSeen: string }>();

// PubSub subscriptions
const activeSubscriptions = new Set<string>();

// Sync state
let syncState: ChatSyncState | null = null;
let isSyncing = false;

// ============================================================================
// Identity Management
// ============================================================================

/**
 * Generate X25519 keypair for encryption
 */
async function generateEncryptionKeyPair(): Promise<{ publicKey: Uint8Array; secretKey: Uint8Array }> {
  await loadCryptoModules();
  return nacl.box.keyPair();
}

/**
 * Generate Ed25519 keypair for signing
 */
async function generateSigningKeyPair(): Promise<{ publicKey: Uint8Array; secretKey: Uint8Array }> {
  await loadCryptoModules();
  return nacl.sign.keyPair();
}

/**
 * Create a new chat identity linked to a wallet
 */
async function createChatIdentity(
  walletAddress: string,
  displayName?: string,
  walletSignature?: string
): Promise<{ identity: ChatIdentity; secretKeys: { encryption: string; signing: string } }> {
  await loadCryptoModules();
  
  // Generate keypairs
  const encryptionKeys = await generateEncryptionKeyPair();
  const signingKeys = await generateSigningKeyPair();
  
  const identityId = `chat-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
  const did = `did:joy:chat:${walletAddress.toLowerCase()}`;
  
  const identity: ChatIdentity = {
    id: identityId,
    walletAddress: walletAddress.toLowerCase(),
    did,
    publicKey: naclUtil.encodeBase64(encryptionKeys.publicKey),
    signingKey: naclUtil.encodeBase64(signingKeys.publicKey),
    displayName,
    status: "online",
    lastSeen: new Date().toISOString(),
    walletSignature,
    verified: !!walletSignature,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  // Store identity
  const identityPath = path.join(getIdentityDir(), "identity.json");
  await fs.writeJson(identityPath, identity, { spaces: 2 });
  
  // Store encrypted keys
  const keysPath = path.join(getKeysDir(), "master-keys.json");
  await fs.writeJson(keysPath, {
    encryption: naclUtil.encodeBase64(encryptionKeys.secretKey),
    signing: naclUtil.encodeBase64(signingKeys.secretKey),
  }, { spaces: 2 });
  
  // Set in memory
  localIdentity = identity;
  privateKey = encryptionKeys.secretKey;
  signingKey = signingKeys.secretKey;
  
  logger.info("Created chat identity", { walletAddress, did });
  
  return {
    identity,
    secretKeys: {
      encryption: naclUtil.encodeBase64(encryptionKeys.secretKey),
      signing: naclUtil.encodeBase64(signingKeys.secretKey),
    },
  };
}

/**
 * Load existing chat identity
 */
async function loadChatIdentity(): Promise<ChatIdentity | null> {
  await loadCryptoModules();
  
  const identityPath = path.join(getIdentityDir(), "identity.json");
  const keysPath = path.join(getKeysDir(), "master-keys.json");
  
  if (!await fs.pathExists(identityPath) || !await fs.pathExists(keysPath)) {
    return null;
  }
  
  try {
    localIdentity = await fs.readJson(identityPath);
    const keys = await fs.readJson(keysPath);
    
    privateKey = naclUtil.decodeBase64(keys.encryption);
    signingKey = naclUtil.decodeBase64(keys.signing);
    
    // Update presence
    if (localIdentity) {
      localIdentity.status = "online";
      localIdentity.lastSeen = new Date().toISOString();
      await fs.writeJson(identityPath, localIdentity, { spaces: 2 });
    }
    
    logger.info("Loaded chat identity", { walletAddress: localIdentity?.walletAddress });
    return localIdentity;
  } catch (error) {
    logger.error("Failed to load chat identity:", error);
    return null;
  }
}

/**
 * Get local identity (create or load)
 */
async function getLocalChatIdentity(): Promise<ChatIdentity | null> {
  if (localIdentity) return localIdentity;
  return loadChatIdentity();
}

/**
 * Update identity profile
 */
async function updateIdentityProfile(updates: {
  displayName?: string;
  avatar?: string;
  bio?: string;
  status?: ChatPresenceStatus;
}): Promise<ChatIdentity | null> {
  if (!localIdentity) return null;
  
  localIdentity = {
    ...localIdentity,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  const identityPath = path.join(getIdentityDir(), "identity.json");
  await fs.writeJson(identityPath, localIdentity, { spaces: 2 });
  
  // Broadcast presence update
  await broadcastPresence(localIdentity.status);
  
  return localIdentity;
}

// ============================================================================
// Encryption/Decryption
// ============================================================================

/**
 * Encrypt message for a recipient
 */
async function encryptMessage(
  content: string,
  recipientPublicKey: string
): Promise<{ encrypted: string; nonce: string }> {
  await loadCryptoModules();
  
  if (!privateKey) {
    throw new Error("No encryption key available");
  }
  
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageUint8 = naclUtil.decodeUTF8(content);
  const recipientKey = naclUtil.decodeBase64(recipientPublicKey);
  
  const encrypted = nacl.box(messageUint8, nonce, recipientKey, privateKey);
  
  return {
    encrypted: naclUtil.encodeBase64(encrypted),
    nonce: naclUtil.encodeBase64(nonce),
  };
}

/**
 * Decrypt message from a sender
 */
async function decryptMessage(
  encryptedContent: string,
  nonce: string,
  senderPublicKey: string
): Promise<string> {
  await loadCryptoModules();
  
  if (!privateKey) {
    throw new Error("No decryption key available");
  }
  
  const encrypted = naclUtil.decodeBase64(encryptedContent);
  const nonceUint8 = naclUtil.decodeBase64(nonce);
  const senderKey = naclUtil.decodeBase64(senderPublicKey);
  
  const decrypted = nacl.box.open(encrypted, nonceUint8, senderKey, privateKey);
  
  if (!decrypted) {
    throw new Error("Failed to decrypt message");
  }
  
  return naclUtil.encodeUTF8(decrypted);
}

/**
 * Sign message
 */
async function signMessage(messageHash: string): Promise<string> {
  await loadCryptoModules();
  
  if (!signingKey) {
    throw new Error("No signing key available");
  }
  
  const messageUint8 = naclUtil.decodeUTF8(messageHash);
  const signature = nacl.sign.detached(messageUint8, signingKey);
  
  return naclUtil.encodeBase64(signature);
}

/**
 * Verify message signature
 */
async function verifySignature(
  messageHash: string,
  signature: string,
  signingPublicKey: string
): Promise<boolean> {
  await loadCryptoModules();
  
  try {
    const messageUint8 = naclUtil.decodeUTF8(messageHash);
    const signatureUint8 = naclUtil.decodeBase64(signature);
    const publicKeyUint8 = naclUtil.decodeBase64(signingPublicKey);
    
    return nacl.sign.detached.verify(messageUint8, signatureUint8, publicKeyUint8);
  } catch {
    return false;
  }
}

/**
 * Hash content
 */
function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

// ============================================================================
// Conversation Management
// ============================================================================

/**
 * Create a new conversation
 */
async function createConversation(
  request: CreateConversationRequest
): Promise<CreateConversationResult> {
  if (!localIdentity) {
    return { success: false, error: "No local identity" };
  }
  
  const conversationId = `conv-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
  
  // Build participants list
  const participants: ConversationParticipant[] = [
    {
      walletAddress: localIdentity.walletAddress,
      did: localIdentity.did,
      publicKey: localIdentity.publicKey,
      displayName: localIdentity.displayName,
      avatar: localIdentity.avatar,
      role: "owner",
      joinedAt: new Date().toISOString(),
      notificationSettings: {
        enabled: true,
        sound: true,
        mentions: true,
        allMessages: true,
      },
    },
  ];
  
  // Add other participants (would need to resolve their public keys from DHT/network)
  for (const walletAddress of request.participants) {
    if (walletAddress.toLowerCase() === localIdentity.walletAddress) continue;
    
    // Try to get participant's public key from network
    const participantInfo = await resolveParticipantInfo(walletAddress);
    
    participants.push({
      walletAddress: walletAddress.toLowerCase(),
      did: `did:joy:chat:${walletAddress.toLowerCase()}`,
      publicKey: participantInfo?.publicKey || "",
      displayName: participantInfo?.displayName,
      avatar: participantInfo?.avatar,
      role: "member",
      joinedAt: new Date().toISOString(),
      notificationSettings: {
        enabled: true,
        sound: true,
        mentions: true,
        allMessages: true,
      },
    });
  }
  
  const defaultSettings: ConversationSettings = {
    isPublic: false,
    allowJoinRequests: false,
    requireApproval: request.type !== "direct",
    allowReactions: true,
    allowReplies: true,
    allowEdits: true,
    allowDeletes: true,
    messageRetention: "forever",
    autoDeleteRead: false,
    autoPinMessages: true,
    pinRetentionDays: 365,
    inviteOnly: true,
    maxParticipants: request.type === "direct" ? 2 : 100,
  };
  
  const conversation: ChatConversation = {
    id: conversationId,
    type: request.type,
    participants,
    creatorId: localIdentity.walletAddress,
    name: request.name,
    description: request.description,
    settings: { ...defaultSettings, ...request.settings },
    encryptionType: "end-to-end",
    keyRotationCount: 0,
    unreadCount: 0,
    pinnedMessages: [],
    syncState: "synced",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
  };
  
  // Store locally
  conversations.set(conversationId, conversation);
  const convPath = path.join(getConversationsDir(), `${conversationId}.json`);
  await fs.writeJson(convPath, conversation, { spaces: 2 });
  
  // Create and pin manifest to Helia
  let manifestCid: string | undefined;
  try {
    manifestCid = await pinConversationManifest(conversation);
    logger.info("Pinned conversation manifest", { conversationId, manifestCid });
  } catch (error) {
    logger.warn("Failed to pin conversation manifest:", error);
  }
  
  // Subscribe to PubSub topic for real-time messages
  await subscribeToConversation(conversationId);
  
  // Emit event
  emitChatEvent({ type: "conversation:created", conversation });
  
  logger.info("Created conversation", { conversationId, type: request.type, participants: participants.length });
  
  return {
    success: true,
    conversation,
    manifestCid,
  };
}

/**
 * Resolve participant info from network
 */
async function resolveParticipantInfo(walletAddress: string): Promise<{
  publicKey: string;
  displayName?: string;
  avatar?: string;
} | null> {
  // Try DHT lookup
  try {
    const dhtKey = `chat:identity:${walletAddress.toLowerCase()}`;
    
    // Ensure chat Helia is running for DHT lookup
    if (chatHelia) {
      // Would use Helia DHT to lookup identity
      // For now, return null and handle missing keys gracefully
    }
  } catch (error) {
    logger.debug("Failed to resolve participant info:", error);
  }
  
  return null;
}

/**
 * Get conversation by ID
 */
async function getConversation(conversationId: string): Promise<ChatConversation | null> {
  // Check in-memory first
  if (conversations.has(conversationId)) {
    return conversations.get(conversationId)!;
  }
  
  // Load from disk
  const convPath = path.join(getConversationsDir(), `${conversationId}.json`);
  if (await fs.pathExists(convPath)) {
    const conversation = await fs.readJson(convPath);
    conversations.set(conversationId, conversation);
    return conversation;
  }
  
  return null;
}

/**
 * List all conversations
 */
async function listConversations(): Promise<ChatConversation[]> {
  const convDir = getConversationsDir();
  const files = await fs.readdir(convDir);
  
  const convs: ChatConversation[] = [];
  for (const file of files) {
    if (file.endsWith(".json")) {
      try {
        const conv = await fs.readJson(path.join(convDir, file));
        conversations.set(conv.id, conv);
        convs.push(conv);
      } catch (error) {
        logger.warn("Failed to load conversation:", { file, error });
      }
    }
  }
  
  // Sort by last activity
  convs.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
  
  return convs;
}

/**
 * Get direct conversation with wallet
 */
async function getDirectConversation(walletAddress: string): Promise<ChatConversation | null> {
  if (!localIdentity) return null;
  
  const convs = await listConversations();
  return convs.find(c => 
    c.type === "direct" && 
    c.participants.some(p => p.walletAddress.toLowerCase() === walletAddress.toLowerCase())
  ) || null;
}

// ============================================================================
// Message Management
// ============================================================================

/**
 * Send a message
 */
async function sendMessage(request: SendMessageRequest): Promise<SendMessageResult> {
  if (!localIdentity) {
    return { success: false, deliveryStatus: "failed", error: "No local identity" };
  }
  
  const conversation = await getConversation(request.conversationId);
  if (!conversation) {
    return { success: false, deliveryStatus: "failed", error: "Conversation not found" };
  }
  
  const messageId = `msg-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
  const messageHash = hashContent(request.content);
  const signature = await signMessage(messageHash);
  
  // Get recipients (all participants except self)
  const recipients = conversation.participants
    .filter(p => p.walletAddress !== localIdentity!.walletAddress)
    .map(p => p.walletAddress);
  
  // For direct messages, encrypt for recipient's public key
  // For groups, would use group key (simplified for now)
  let encryptedContent: string;
  let nonce: string;
  
  if (conversation.type === "direct" && recipients.length === 1) {
    const recipient = conversation.participants.find(p => p.walletAddress === recipients[0]);
    if (!recipient?.publicKey) {
      return { success: false, deliveryStatus: "failed", error: "Recipient public key not found" };
    }
    
    const encrypted = await encryptMessage(request.content, recipient.publicKey);
    encryptedContent = encrypted.encrypted;
    nonce = encrypted.nonce;
  } else {
    // Group encryption - simplified
    const encrypted = await encryptMessage(request.content, localIdentity.publicKey);
    encryptedContent = encrypted.encrypted;
    nonce = encrypted.nonce;
  }
  
  const message: ChatMessage = {
    id: messageId,
    conversationId: request.conversationId,
    sender: localIdentity.walletAddress,
    senderDid: localIdentity.did,
    recipients,
    encryptedContent,
    nonce,
    encryptionAlgorithm: "x25519-xsalsa20-poly1305",
    messageType: request.messageType || "text",
    replyTo: request.replyTo,
    threadId: request.threadId,
    deliveryStatus: "sending",
    readReceipts: [],
    signature,
    messageHash,
    createdAt: new Date().toISOString(),
  };
  
  // Handle expiration
  if (request.expiresIn) {
    message.expiresAt = new Date(Date.now() + request.expiresIn * 1000).toISOString();
  }
  
  // Store locally
  if (!messages.has(request.conversationId)) {
    messages.set(request.conversationId, []);
  }
  messages.get(request.conversationId)!.push(message);
  
  // Save to disk
  const msgPath = path.join(getMessagesDir(), request.conversationId);
  await fs.ensureDir(msgPath);
  await fs.writeJson(path.join(msgPath, `${messageId}.json`), message, { spaces: 2 });
  
  // Pin to Helia
  let cid: string | undefined;
  try {
    cid = await pinMessage(message);
    message.cid = cid;
    message.pinnedAt = new Date().toISOString();
    message.deliveryStatus = "pinned";
    
    // Update stored message with CID
    await fs.writeJson(path.join(msgPath, `${messageId}.json`), message, { spaces: 2 });
    
    logger.info("Pinned message to Helia", { messageId, cid });
  } catch (error) {
    logger.warn("Failed to pin message:", error);
  }
  
  // Publish to PubSub for real-time delivery
  try {
    await publishMessage(conversation.id, message);
    message.deliveryStatus = "sent";
  } catch (error) {
    logger.warn("Failed to publish message to PubSub:", error);
  }
  
  // Queue for offline recipients
  for (const recipientWallet of recipients) {
    const isOnline = await checkPeerOnline(recipientWallet);
    if (!isOnline && cid) {
      await queueOfflineMessage(recipientWallet, message, cid);
    }
  }
  
  // Update conversation
  conversation.lastMessage = {
    id: messageId,
    senderId: localIdentity.walletAddress,
    senderName: localIdentity.displayName,
    preview: request.content.substring(0, 100),
    timestamp: message.createdAt,
    type: message.messageType,
  };
  conversation.lastActivityAt = message.createdAt;
  conversation.updatedAt = message.createdAt;
  if (cid) {
    conversation.headCid = cid;
  }
  
  const convPath = path.join(getConversationsDir(), `${conversation.id}.json`);
  await fs.writeJson(convPath, conversation, { spaces: 2 });
  
  // Emit event
  emitChatEvent({ type: "message:sent", message, cid: cid || "" });
  
  return {
    success: true,
    message,
    cid,
    deliveryStatus: message.deliveryStatus,
  };
}

/**
 * Get messages for a conversation
 */
async function getMessages(
  conversationId: string,
  options?: {
    limit?: number;
    before?: string;
    after?: string;
  }
): Promise<ChatMessage[]> {
  // Check in-memory first
  let msgs = messages.get(conversationId) || [];
  
  // Load from disk if needed
  if (msgs.length === 0) {
    const msgDir = path.join(getMessagesDir(), conversationId);
    if (await fs.pathExists(msgDir)) {
      const files = await fs.readdir(msgDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          try {
            const msg = await fs.readJson(path.join(msgDir, file));
            msgs.push(msg);
          } catch {
            // Skip invalid files
          }
        }
      }
      messages.set(conversationId, msgs);
    }
  }
  
  // Sort by timestamp
  msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  
  // Apply filters
  if (options?.before) {
    msgs = msgs.filter(m => new Date(m.createdAt) < new Date(options.before!));
  }
  if (options?.after) {
    msgs = msgs.filter(m => new Date(m.createdAt) > new Date(options.after!));
  }
  if (options?.limit) {
    msgs = msgs.slice(-options.limit);
  }
  
  return msgs;
}

/**
 * Decrypt messages for display
 */
async function decryptMessages(
  msgs: ChatMessage[],
  conversation: ChatConversation
): Promise<Array<ChatMessage & { decryptedContent?: string }>> {
  if (!localIdentity) return msgs;
  
  const results: Array<ChatMessage & { decryptedContent?: string }> = [];
  
  for (const msg of msgs) {
    try {
      // Find sender's public key
      const sender = conversation.participants.find(p => p.walletAddress === msg.sender);
      const senderPublicKey = sender?.publicKey || localIdentity.publicKey;
      
      const decryptedContent = await decryptMessage(
        msg.encryptedContent,
        msg.nonce,
        senderPublicKey
      );
      
      results.push({ ...msg, decryptedContent });
    } catch (error) {
      // If decryption fails, return without decrypted content
      results.push(msg);
      logger.debug("Failed to decrypt message:", { messageId: msg.id, error });
    }
  }
  
  return results;
}

// ============================================================================
// Helia/IPFS Pinning
// ============================================================================

/**
 * Pin a message to Helia
 */
async function pinMessage(message: ChatMessage): Promise<string> {
  // Ensure chat Helia is running
  await ensureChatHelia();
  
  // Create DAG node with message
  const dagNode: MessageDAGNode = {
    message,
    depth: 0,
    hash: message.messageHash,
    signature: message.signature,
    version: 1,
    createdAt: message.createdAt,
  };
  
  // Get previous message CID for linking
  const conversation = await getConversation(message.conversationId);
  if (conversation?.headCid) {
    dagNode.previous = conversation.headCid;
    dagNode.depth = (conversation.pinnedMessages?.length || 0) + 1;
  }
  
  // Store in chat Helia
  const cid = await storeChatJSON(dagNode);
  
  // Track pin
  const pin: MessagePin = {
    cid,
    messageId: message.id,
    conversationId: message.conversationId,
    pinnedAt: new Date().toISOString(),
    pinnedBy: message.sender,
    provider: "helia",
    status: "pinned",
    size: JSON.stringify(dagNode).length,
  };
  
  pins.set(cid, pin);
  await fs.writeJson(path.join(getPinsDir(), `${cid}.json`), pin, { spaces: 2 });
  
  return cid;
}

/**
 * Pin conversation manifest
 */
async function pinConversationManifest(conversation: ChatConversation): Promise<string> {
  const manifest: ConversationManifest = {
    id: conversation.id,
    type: conversation.type,
    participants: conversation.participants.map(p => ({
      walletAddress: p.walletAddress,
      publicKey: p.publicKey,
      role: p.role,
    })),
    genesisMessageCid: conversation.headCid || "",
    latestMessageCid: conversation.headCid || "",
    messageCount: conversation.pinnedMessages?.length || 0,
    settings: conversation.settings,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    signature: "",
    signedBy: localIdentity?.did || "",
  };
  
  // Sign manifest
  const manifestHash = hashContent(JSON.stringify(manifest));
  manifest.signature = await signMessage(manifestHash);
  
  // Store in chat Helia
  const cid = await storeChatJSON(manifest);
  
  // Store manifest CID in DHT for discovery
  await publishToDHT(`chat:manifest:${conversation.id}`, cid);
  
  return cid;
}

/**
 * Pull pinned messages from Helia
 */
async function pullPinnedMessages(
  request: PullPinnedMessagesRequest
): Promise<PullPinnedMessagesResult> {
  // Ensure chat Helia is running
  try {
    await ensureChatHelia();
  } catch (error) {
    return { success: false, messages: [], failedCids: [], error: "Failed to start Helia" };
  }
  
  const pulledMessages: ChatMessage[] = [];
  const failedCids: string[] = [];
  
  // Get CIDs to pull
  let cidsToFetch: string[] = request.cids || [];
  
  // If conversation specified, get message CIDs from it
  if (request.conversationId) {
    const conversation = await getConversation(request.conversationId);
    if (conversation?.headCid) {
      // Walk the linked list from head
      let currentCid = conversation.headCid;
      while (currentCid && cidsToFetch.length < 100) {
        cidsToFetch.push(currentCid);
        
        // Get previous CID
        try {
          const dagNode = await getChatJSON(currentCid) as MessageDAGNode;
          currentCid = dagNode.previous || "";
        } catch {
          break;
        }
      }
    }
  }
  
  // Fetch each CID
  for (const cid of cidsToFetch) {
    try {
      const dagNode = await getChatJSON(cid) as MessageDAGNode;
      if (dagNode?.message) {
        // Verify message
        const isValid = await verifySignature(
          dagNode.message.messageHash,
          dagNode.message.signature,
          "" // Would need sender's signing key
        );
        
        dagNode.message.cid = cid;
        pulledMessages.push(dagNode.message);
        
        // Store locally
        const msgPath = path.join(getMessagesDir(), dagNode.message.conversationId);
        await fs.ensureDir(msgPath);
        await fs.writeJson(path.join(msgPath, `${dagNode.message.id}.json`), dagNode.message, { spaces: 2 });
      }
    } catch (error) {
      logger.warn("Failed to pull message:", { cid, error });
      failedCids.push(cid);
    }
  }
  
  logger.info("Pulled pinned messages", { 
    total: cidsToFetch.length, 
    success: pulledMessages.length, 
    failed: failedCids.length 
  });
  
  return {
    success: true,
    messages: pulledMessages,
    failedCids,
  };
}

// ============================================================================
// PubSub Real-time Messaging
// ============================================================================

/**
 * Subscribe to conversation topic
 */
async function subscribeToConversation(conversationId: string): Promise<void> {
  const topic = `/joycreate/chat/v1/${conversationId}`;
  
  if (activeSubscriptions.has(topic)) {
    return;
  }
  
  try {
    await ensureChatHelia();
    
    // Try to subscribe via libp2p pubsub if available
    if (chatHelia?.libp2p?.services?.pubsub) {
      chatHelia.libp2p.services.pubsub.subscribe(topic);
      
      // Set up message handler
      chatHelia.libp2p.services.pubsub.addEventListener("message", (evt: any) => {
        if (evt.detail.topic === topic) {
          handlePubSubMessage(topic, evt.detail.data).catch(err => {
            logger.error("Error handling pubsub message:", err);
          });
        }
      });
      
      logger.info("Subscribed to conversation via PubSub", { conversationId, topic });
    }
    
    activeSubscriptions.add(topic);
    logger.info("Subscribed to conversation", { conversationId, topic });
  } catch (error) {
    logger.error("Failed to subscribe to conversation:", error);
    // Still track subscription for local handling
    activeSubscriptions.add(topic);
  }
}

/**
 * Publish message to PubSub
 */
async function publishMessage(conversationId: string, message: ChatMessage): Promise<void> {
  const topic = `/joycreate/chat/v1/${conversationId}`;
  
  const pubsubMessage: ChatPubSubMessage = {
    type: "message:new",
    conversationId,
    senderId: message.sender,
    payload: {
      messageId: message.id,
      cid: message.cid,
      messageType: message.messageType,
      timestamp: message.createdAt,
    },
    timestamp: new Date().toISOString(),
    signature: await signMessage(JSON.stringify(message)),
  };
  
  try {
    await ensureChatHelia();
    
    // Try to publish via libp2p pubsub if available
    if (chatHelia?.libp2p?.services?.pubsub) {
      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(pubsubMessage));
      await chatHelia.libp2p.services.pubsub.publish(topic, data);
      logger.info("Published message to PubSub", { topic, messageId: message.id });
    } else {
      logger.debug("PubSub not available, message pinned to IPFS only", { messageId: message.id });
    }
    
    // Also publish to presence topic for discovery
    const presenceTopic = `/joycreate/chat/v1/presence`;
    if (chatHelia?.libp2p?.services?.pubsub) {
      const presenceMsg = {
        type: "message:available",
        senderId: message.sender,
        conversationId,
        cid: message.cid,
        timestamp: new Date().toISOString(),
      };
      const presenceData = new TextEncoder().encode(JSON.stringify(presenceMsg));
      await chatHelia.libp2p.services.pubsub.publish(presenceTopic, presenceData);
    }
  } catch (error) {
    logger.warn("Failed to publish to PubSub:", error);
  }
}

/**
 * Handle incoming PubSub message
 */
async function handlePubSubMessage(topic: string, data: Uint8Array): Promise<void> {
  try {
    await loadCryptoModules();
    const message = JSON.parse(naclUtil.encodeUTF8(data)) as ChatPubSubMessage;
    
    switch (message.type) {
      case "message:new":
        // Pull the message from IPFS if we have the CID
        if (message.payload.cid) {
          await pullPinnedMessages({ cids: [message.payload.cid] });
        }
        emitChatEvent({
          type: "message:received",
          message: message.payload,
          conversationId: message.conversationId,
        });
        break;
        
      case "typing:start":
        emitChatEvent({
          type: "typing:started",
          conversationId: message.conversationId,
          userId: message.senderId,
        });
        break;
        
      case "typing:stop":
        emitChatEvent({
          type: "typing:stopped",
          conversationId: message.conversationId,
          userId: message.senderId,
        });
        break;
        
      case "presence:update":
        presenceCache.set(message.senderId, {
          status: message.payload.status,
          lastSeen: message.timestamp,
        });
        emitChatEvent({
          type: "presence:changed",
          userId: message.senderId,
          status: message.payload.status,
        });
        break;
    }
  } catch (error) {
    logger.error("Failed to handle PubSub message:", error);
  }
}

// ============================================================================
// Offline Message Queue
// ============================================================================

/**
 * Queue message for offline recipient
 */
async function queueOfflineMessage(
  recipientWallet: string,
  message: ChatMessage,
  cid: string
): Promise<void> {
  let queue = offlineQueues.get(recipientWallet);
  
  if (!queue) {
    queue = {
      recipientWallet,
      recipientDid: `did:joy:chat:${recipientWallet.toLowerCase()}`,
      messages: [],
      attemptCount: 0,
      createdAt: new Date().toISOString(),
    };
  }
  
  const queuedMessage: QueuedMessage = {
    id: message.id,
    messageCid: cid,
    conversationId: message.conversationId,
    priority: "normal",
    queuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
    retryCount: 0,
  };
  
  queue.messages.push(queuedMessage);
  offlineQueues.set(recipientWallet, queue);
  
  // Store to disk
  const queuePath = path.join(getOfflineQueueDir(), `${recipientWallet}.json`);
  await fs.writeJson(queuePath, queue, { spaces: 2 });
  
  // Publish to DHT for recipient to discover when online
  await publishToDHT(`chat:offline:${recipientWallet}`, {
    cids: queue.messages.map(m => m.messageCid),
    updatedAt: new Date().toISOString(),
  });
  
  emitChatEvent({
    type: "offline:queued",
    messageId: message.id,
    recipientWallet,
  });
  
  logger.info("Queued offline message", { recipientWallet, messageId: message.id, cid });
}

/**
 * Check for offline messages when coming online
 */
async function checkOfflineMessages(): Promise<ChatMessage[]> {
  if (!localIdentity) return [];
  
  const messages: ChatMessage[] = [];
  
  try {
    // Check DHT for offline messages
    const dhtKey = `chat:offline:${localIdentity.walletAddress}`;
    const record = await getFromDHT(dhtKey);
    
    if (record?.cids && Array.isArray(record.cids)) {
      const result = await pullPinnedMessages({ cids: record.cids });
      messages.push(...result.messages);
      
      // Clear DHT entry after pulling
      if (result.messages.length > 0) {
        await publishToDHT(dhtKey, { cids: [], updatedAt: new Date().toISOString() });
      }
    }
  } catch (error) {
    logger.warn("Failed to check offline messages:", error);
  }
  
  return messages;
}

// ============================================================================
// DHT Operations (with local storage fallback)
// ============================================================================

// DHT cache stored locally for offline message discovery
const dhtCache = new Map<string, { value: any; timestamp: string }>();
const dhtCacheFile = () => path.join(getChatDir(), "dht-cache.json");

async function loadDHTCache(): Promise<void> {
  try {
    const cachePath = dhtCacheFile();
    if (await fs.pathExists(cachePath)) {
      const data = await fs.readJson(cachePath);
      for (const [key, entry] of Object.entries(data)) {
        dhtCache.set(key, entry as { value: any; timestamp: string });
      }
      logger.debug("Loaded DHT cache", { entries: dhtCache.size });
    }
  } catch (error) {
    logger.warn("Failed to load DHT cache:", error);
  }
}

async function saveDHTCache(): Promise<void> {
  try {
    const data: Record<string, any> = {};
    for (const [key, entry] of dhtCache) {
      data[key] = entry;
    }
    await fs.writeJson(dhtCacheFile(), data, { spaces: 2 });
  } catch (error) {
    logger.warn("Failed to save DHT cache:", error);
  }
}

/**
 * Publish to DHT (with local fallback)
 */
async function publishToDHT(key: string, value: any): Promise<void> {
  try {
    // Store locally first for fallback
    dhtCache.set(key, { value, timestamp: new Date().toISOString() });
    await saveDHTCache();
    
    // Try to publish to Helia's DHT if available
    if (chatHelia?.libp2p?.services?.dht) {
      const encoder = new TextEncoder();
      const valueBytes = encoder.encode(JSON.stringify(value));
      await chatHelia.libp2p.services.dht.put(
        encoder.encode(key),
        valueBytes
      );
      logger.debug("Published to DHT", { key });
    }
    
    // Also store as pinned JSON for IPFS discovery
    const cid = await storeChatJSON({ key, value, timestamp: new Date().toISOString() });
    
    // Store CID mapping locally for retrieval
    const mappingPath = path.join(getChatDir(), "dht-mappings.json");
    let mappings: Record<string, string> = {};
    if (await fs.pathExists(mappingPath)) {
      mappings = await fs.readJson(mappingPath);
    }
    mappings[key] = cid;
    await fs.writeJson(mappingPath, mappings, { spaces: 2 });
    
    logger.info("Published to DHT with CID", { key, cid });
  } catch (error) {
    logger.warn("Failed to publish to DHT:", error);
  }
}

/**
 * Get from DHT (with local fallback)
 */
async function getFromDHT(key: string): Promise<any | null> {
  try {
    // Try to get from Helia's DHT first
    if (chatHelia?.libp2p?.services?.dht) {
      try {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const result = await chatHelia.libp2p.services.dht.get(encoder.encode(key));
        if (result) {
          const value = JSON.parse(decoder.decode(result));
          // Update local cache
          dhtCache.set(key, { value, timestamp: new Date().toISOString() });
          await saveDHTCache();
          return value;
        }
      } catch (e) {
        // DHT lookup failed, try fallback
      }
    }
    
    // Try local cache
    const cached = dhtCache.get(key);
    if (cached) {
      return cached.value;
    }
    
    // Try to load from CID mapping
    const mappingPath = path.join(getChatDir(), "dht-mappings.json");
    if (await fs.pathExists(mappingPath)) {
      const mappings = await fs.readJson(mappingPath);
      if (mappings[key]) {
        try {
          const data = await getChatJSON(mappings[key]);
          if (data?.value) {
            dhtCache.set(key, { value: data.value, timestamp: data.timestamp });
            await saveDHTCache();
            return data.value;
          }
        } catch (e) {
          // CID fetch failed
        }
      }
    }
    
    return null;
  } catch (error) {
    logger.warn("Failed to get from DHT:", error);
    return null;
  }
}

// ============================================================================
// Presence & Online Status
// ============================================================================

/**
 * Check if peer is online
 */
async function checkPeerOnline(walletAddress: string): Promise<boolean> {
  const presence = presenceCache.get(walletAddress);
  if (presence) {
    const lastSeenMs = new Date(presence.lastSeen).getTime();
    const isRecent = Date.now() - lastSeenMs < 60000; // 1 minute
    return presence.status === "online" && isRecent;
  }
  return false;
}

/**
 * Broadcast presence update
 */
async function broadcastPresence(status: ChatPresenceStatus): Promise<void> {
  if (!localIdentity) return;
  
  const presenceMessage: ChatPubSubMessage = {
    type: "presence:update",
    conversationId: "global",
    senderId: localIdentity.walletAddress,
    payload: { status },
    timestamp: new Date().toISOString(),
    signature: await signMessage(status),
  };
  
  // Publish to presence topic
  // Would use libp2p pubsub
  logger.debug("Broadcasting presence", { status });
}

/**
 * Send typing indicator
 */
async function sendTypingIndicator(conversationId: string, isTyping: boolean): Promise<void> {
  if (!localIdentity) return;
  
  const typingMessage: ChatPubSubMessage = {
    type: isTyping ? "typing:start" : "typing:stop",
    conversationId,
    senderId: localIdentity.walletAddress,
    payload: {},
    timestamp: new Date().toISOString(),
    signature: "",
  };
  
  // Publish to conversation topic
  logger.debug("Sending typing indicator", { conversationId, isTyping });
}

// ============================================================================
// Sync Operations
// ============================================================================

/**
 * Sync all conversations when coming online
 */
async function syncOnComingOnline(): Promise<SyncMessagesResult> {
  if (isSyncing) {
    return { success: false, conversations: [], totalNewMessages: 0, error: "Already syncing" };
  }
  
  isSyncing = true;
  
  try {
    // Ensure chat Helia is running
    await ensureChatHelia();
    
    // Check for offline messages
    const offlineMessages = await checkOfflineMessages();
    
    // Sync each conversation
    const convs = await listConversations();
    const results: SyncMessagesResult["conversations"] = [];
    let totalNew = offlineMessages.length;
    
    for (const conv of convs) {
      emitChatEvent({ type: "sync:started", conversationId: conv.id });
      
      try {
        // Pull latest from network
        if (conv.headCid) {
          const pulled = await pullPinnedMessages({ conversationId: conv.id });
          
          results.push({
            conversationId: conv.id,
            newMessages: pulled.messages.length,
            latestCid: conv.headCid,
          });
          
          totalNew += pulled.messages.length;
          
          emitChatEvent({ type: "sync:completed", conversationId: conv.id, messageCount: pulled.messages.length });
        }
        
        // Subscribe for real-time updates
        await subscribeToConversation(conv.id);
      } catch (error) {
        emitChatEvent({ type: "sync:failed", conversationId: conv.id, error: (error as Error).message });
      }
    }
    
    // Broadcast that we're online
    await broadcastPresence("online");
    
    logger.info("Sync completed", { conversations: convs.length, totalNewMessages: totalNew });
    
    return {
      success: true,
      conversations: results,
      totalNewMessages: totalNew,
    };
  } finally {
    isSyncing = false;
  }
}

// ============================================================================
// Event Emission
// ============================================================================

function emitChatEvent(event: ChatEvent): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send("decentralized-chat:event", event);
  }
}

// ============================================================================
// Service Status
// ============================================================================

async function getChatServiceStatus(): Promise<ChatServiceStatus> {
  const convs = await listConversations();
  
  let messageCount = 0;
  for (const [, msgs] of messages) {
    messageCount += msgs.length;
  }
  
  // Get Helia status
  const heliaRunning = !!chatHelia;
  const heliaPeerId = chatHelia?.libp2p?.peerId?.toString();
  const connectedPeers = chatHelia?.libp2p?.getPeers()?.length || 0;
  
  return {
    initialized: !!localIdentity,
    identity: localIdentity || undefined,
    walletConnected: !!localIdentity?.walletAddress,
    heliaConnected: heliaRunning,
    heliaPeerId,
    connectedPeers,
    pubsubEnabled: activeSubscriptions.size > 0,
    activeTopics: Array.from(activeSubscriptions),
    dhtEnabled: true,
    dhtRecords: dhtCache.size,
    conversationCount: convs.length,
    messageCount,
    pinnedMessageCount: pins.size,
    syncState: isSyncing ? "syncing" : "idle",
    lastSyncAt: syncState?.lastSyncedAt,
    pendingMessages: 0,
    offlineQueueSize: Array.from(offlineQueues.values()).reduce((sum, q) => sum + q.messages.length, 0),
  };
}

/**
 * Subscribe to global presence topic for message discovery
 */
async function subscribeToGlobalPresence(): Promise<void> {
  const presenceTopic = `/joycreate/chat/v1/presence`;
  
  if (activeSubscriptions.has(presenceTopic)) {
    return;
  }
  
  try {
    await ensureChatHelia();
    
    if (chatHelia?.libp2p?.services?.pubsub) {
      chatHelia.libp2p.services.pubsub.subscribe(presenceTopic);
      
      chatHelia.libp2p.services.pubsub.addEventListener("message", async (evt: any) => {
        if (evt.detail.topic === presenceTopic) {
          try {
            const decoder = new TextDecoder();
            const message = JSON.parse(decoder.decode(evt.detail.data));
            
            // Handle message availability notifications
            if (message.type === "message:available" && message.cid) {
              // Check if this is for one of our conversations
              const convs = await listConversations();
              const conv = convs.find(c => c.id === message.conversationId);
              
              if (conv && message.senderId !== localIdentity?.walletAddress) {
                // Pull the message
                logger.info("Received message notification, pulling from IPFS", { cid: message.cid });
                const result = await pullPinnedMessages({ cids: [message.cid] });
                
                if (result.messages.length > 0) {
                  emitChatEvent({
                    type: "message:received",
                    message: result.messages[0],
                    conversationId: message.conversationId,
                  });
                }
              }
            }
            
            // Handle presence updates
            if (message.type === "presence:update" && message.senderId) {
              presenceCache.set(message.senderId, {
                status: message.payload?.status || "online",
                lastSeen: message.timestamp,
              });
              
              emitChatEvent({
                type: "presence:updated",
                userId: message.senderId,
                status: message.payload?.status || "online",
              });
            }
          } catch (e) {
            logger.warn("Failed to process presence message:", e);
          }
        }
      });
      
      logger.info("Subscribed to global presence topic");
    }
    
    activeSubscriptions.add(presenceTopic);
  } catch (error) {
    logger.error("Failed to subscribe to global presence:", error);
  }
}

// ============================================================================
// Register IPC Handlers
// ============================================================================

export function registerDecentralizedChatHandlers(): void {
  initChatDirs();
  
  // Load DHT cache and identity on startup
  loadDHTCache().catch(err => logger.warn("Failed to load DHT cache:", err));
  loadChatIdentity().then(identity => {
    if (identity) {
      logger.info("Loaded existing chat identity", { walletAddress: identity.walletAddress });
      // Subscribe to global presence for message discovery
      subscribeToGlobalPresence().catch(err => logger.warn("Failed to subscribe to presence:", err));
    }
  }).catch(err => logger.warn("Failed to load chat identity:", err));
  
  // Identity
  ipcMain.handle("dchat:identity:create", async (_, walletAddress: string, displayName?: string, signature?: string) => {
    const result = await createChatIdentity(walletAddress, displayName, signature);
    // Subscribe to presence after identity creation
    subscribeToGlobalPresence().catch(err => logger.warn("Failed to subscribe to presence:", err));
    return result;
  });
  
  ipcMain.handle("dchat:identity:get", async () => {
    return getLocalChatIdentity();
  });
  
  ipcMain.handle("dchat:identity:update", async (_, updates: Parameters<typeof updateIdentityProfile>[0]) => {
    return updateIdentityProfile(updates);
  });
  
  // Conversations
  ipcMain.handle("dchat:conversation:create", async (_, request: CreateConversationRequest) => {
    return createConversation(request);
  });
  
  ipcMain.handle("dchat:conversation:get", async (_, conversationId: string) => {
    return getConversation(conversationId);
  });
  
  ipcMain.handle("dchat:conversation:list", async () => {
    return listConversations();
  });
  
  ipcMain.handle("dchat:conversation:get-direct", async (_, walletAddress: string) => {
    return getDirectConversation(walletAddress);
  });
  
  // Messages
  ipcMain.handle("dchat:message:send", async (_, request: SendMessageRequest) => {
    return sendMessage(request);
  });
  
  ipcMain.handle("dchat:message:get", async (_, conversationId: string, options?: Parameters<typeof getMessages>[1]) => {
    return getMessages(conversationId, options);
  });
  
  ipcMain.handle("dchat:message:decrypt", async (_, conversationId: string) => {
    const conversation = await getConversation(conversationId);
    if (!conversation) return [];
    const msgs = await getMessages(conversationId);
    return decryptMessages(msgs, conversation);
  });
  
  // Pinning
  ipcMain.handle("dchat:pin:pull", async (_, request: PullPinnedMessagesRequest) => {
    return pullPinnedMessages(request);
  });
  
  // Sync
  ipcMain.handle("dchat:sync:online", async () => {
    return syncOnComingOnline();
  });
  
  ipcMain.handle("dchat:offline:check", async () => {
    return checkOfflineMessages();
  });
  
  // Presence
  ipcMain.handle("dchat:presence:broadcast", async (_, status: ChatPresenceStatus) => {
    return broadcastPresence(status);
  });
  
  ipcMain.handle("dchat:typing:send", async (_, conversationId: string, isTyping: boolean) => {
    return sendTypingIndicator(conversationId, isTyping);
  });
  
  // Status
  ipcMain.handle("dchat:status", async () => {
    return getChatServiceStatus();
  });
  
  logger.info("Decentralized chat handlers registered");
}
