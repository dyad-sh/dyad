/**
 * P2P Chat Extensions â€” Exhaustive Feature Set
 * 
 * Extends decentralized_chat_types.ts with:
 * - AI Agent & Bot Framework (agents as first-class chat participants)
 * - Channels (Discord/Slack-style within communities)
 * - Threads (nested conversations within channels/groups)
 * - Voice Messages & Audio Rooms
 * - Message Search, Forwarding, Bookmarks
 * - Stories/Status Updates
 * - Smart Notifications & Agent Alerts
 * - Rich Embeds & Link Previews
 * - Polls UI Extensions
 * - Community Spaces
 * - Payment/Tip Integration
 * - Moderation & Anti-Spam AI
 */

import type {
  ChatIdentity,
  ChatMessage,
  ChatConversation,
  ConversationParticipant,
  ConversationSettings,
  ChatPresenceStatus,
  ParticipantRole,
  ChatMessageType,
  DeliveryStatus,
  MessageAttachment,
  GroupSettings,
  GroupPermissions,
  GroupRole,
  MeetingSettings,
  Poll,
  PollOption,
} from "./decentralized_chat_types";

// ============================================================================
// 1. AI AGENT & BOT FRAMEWORK
// ============================================================================

/**
 * Bot/Agent identity within the chat system.
 * Agents are first-class participants â€” they can DM, join groups,
 * respond to commands, process tasks, and interact with humans seamlessly.
 */
export interface ChatBot {
  id: string;
  /** Link to JoyCreate agent ID (if backed by a JoyCreate agent) */
  agentId?: number;
  /** Link to A2A agent card ID (for cross-network agents) */
  a2aAgentId?: string;

  // Identity
  name: string;
  displayName: string;
  description: string;
  avatar?: string;                   // IPFS CID
  banner?: string;                   // IPFS CID
  did: string;                       // DID for the bot
  walletAddress: string;             // Bot's wallet for payments

  // Classification
  type: BotType;
  category: BotCategory;
  tags: string[];

  // Capabilities
  capabilities: BotCapability[];
  commands: BotCommand[];
  triggers: BotTrigger[];
  supportedLanguages: string[];

  // AI Model Config (for AI-powered bots)
  aiConfig?: BotAIConfig;

  // Permissions & Scope
  permissions: BotPermissions;
  maxConversations: number;          // Max simultaneous conversations
  rateLimits: BotRateLimits;

  // Status
  status: BotStatus;
  lastActive: string;
  uptime: number;                    // Percentage
  totalInteractions: number;
  avgResponseMs: number;

  // Owner
  ownerWallet: string;
  ownerDid: string;
  isVerified: boolean;
  isOfficial: boolean;               // Built by JoyCreate team

  // Marketplace
  isPublished: boolean;
  installCount: number;
  rating: number;                    // 0-5
  reviewCount: number;
  pricing: BotPricing;

  createdAt: string;
  updatedAt: string;
}

export type BotType =
  | "ai-agent"          // LLM-powered conversational agent
  | "task-bot"          // Automated task execution
  | "notification-bot"  // Push notifications & alerts
  | "moderation-bot"    // Content moderation
  | "integration-bot"   // External service bridge (GitHub, Jira, etc.)
  | "game-bot"          // Games & entertainment
  | "utility-bot"       // Tools (calculator, translator, etc.)
  | "analytics-bot"     // Analytics & reporting
  | "commerce-bot"      // Payments, orders, commerce
  | "custom";

export type BotCategory =
  | "productivity"
  | "development"
  | "moderation"
  | "analytics"
  | "entertainment"
  | "education"
  | "finance"
  | "social"
  | "ai-assistant"
  | "integration"
  | "other";

export interface BotCapability {
  id: string;
  name: string;
  description: string;
  type: "command" | "trigger" | "passive" | "webhook" | "scheduled";
  enabled: boolean;
}

export interface BotCommand {
  id: string;
  command: string;                   // e.g., "/summarize"
  aliases?: string[];                // e.g., ["/sum", "/tldr"]
  description: string;
  usage: string;                     // e.g., "/summarize [count]"
  category: string;
  parameters: BotCommandParam[];
  permissions: ParticipantRole[];    // Who can invoke
  cooldownMs?: number;               // Rate limiting per user
  groupOnly?: boolean;
  dmOnly?: boolean;
  examples?: string[];
}

export interface BotCommandParam {
  name: string;
  type: "string" | "number" | "boolean" | "user" | "channel" | "file" | "choice";
  description: string;
  required: boolean;
  default?: any;
  choices?: string[];
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
}

export interface BotTrigger {
  id: string;
  type: BotTriggerType;
  pattern?: string;                  // Regex or keyword
  event?: string;                    // Event name
  description: string;
  enabled: boolean;
  cooldownMs?: number;
  conditions?: BotTriggerCondition[];
}

export type BotTriggerType =
  | "keyword"           // Matches keywords in messages
  | "mention"           // When bot is @mentioned
  | "regex"             // Regex pattern match
  | "join"              // When someone joins a group
  | "leave"             // When someone leaves
  | "reaction"          // When a reaction is added
  | "scheduled"         // Cron-based
  | "webhook"           // External webhook
  | "message-type"      // Specific message types (image, file, etc.)
  | "sentiment"         // Sentiment threshold trigger
  | "new-member"        // Welcome new members
  | "inactivity"        // No messages for X time
  | "any-message";      // Every message (use carefully)

export interface BotTriggerCondition {
  field: string;                     // e.g., "sender.role", "message.length"
  operator: "eq" | "neq" | "gt" | "lt" | "contains" | "matches";
  value: any;
}

export interface BotAIConfig {
  modelId: string;                   // e.g., "anthropic/claude-sonnet-4-5"
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  contextWindow: number;             // How many messages to include as context
  ragEnabled: boolean;               // Use RAG for knowledge base
  ragDatasetIds?: string[];          // JoyCreate dataset IDs
  tools?: BotAITool[];               // Tools the AI can call
  fallbackModel?: string;
  streamResponses: boolean;
  personalityTraits?: string[];      // e.g., ["friendly", "concise", "technical"]
}

export interface BotAITool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: string;                   // IPC channel or function reference
}

export interface BotPermissions {
  canReadMessages: boolean;
  canSendMessages: boolean;
  canSendMedia: boolean;
  canReact: boolean;
  canDeleteMessages: boolean;
  canPinMessages: boolean;
  canKickMembers: boolean;
  canBanMembers: boolean;
  canManageRoles: boolean;
  canCreateThreads: boolean;
  canManageThreads: boolean;
  canStartMeetings: boolean;
  canAccessHistory: boolean;         // Read message history
  canSendDMs: boolean;               // DM users directly
  canModerate: boolean;
  canAccessFiles: boolean;
  canManageWebhooks: boolean;
}

export interface BotRateLimits {
  messagesPerMinute: number;
  messagesPerHour: number;
  commandsPerMinute: number;
  apiCallsPerMinute: number;
}

export type BotStatus =
  | "active"
  | "idle"
  | "processing"
  | "error"
  | "disabled"
  | "maintenance";

export interface BotPricing {
  model: "free" | "freemium" | "paid" | "per-use" | "subscription";
  price?: string;
  currency?: string;
  features?: {
    free: string[];
    premium: string[];
  };
}

/** Bot installation in a conversation/group */
export interface BotInstallation {
  id: string;
  botId: string;
  conversationId: string;
  installedBy: string;               // Wallet address
  config: BotInstallConfig;
  status: "active" | "paused" | "error" | "uninstalling";
  permissions: BotPermissions;
  installedAt: string;
  lastInteraction?: string;
  interactionCount: number;
}

export interface BotInstallConfig {
  prefix?: string;                   // Command prefix (default: "/")
  enabledCommands?: string[];        // Specific commands to enable (null = all)
  disabledCommands?: string[];
  enabledTriggers?: string[];
  disabledTriggers?: string[];
  responseMode: "public" | "ephemeral" | "dm";
  maxResponseLength?: number;
  customSettings?: Record<string, unknown>;
}

/** Bot interaction log */
export interface BotInteraction {
  id: string;
  botId: string;
  conversationId: string;
  userId: string;                    // Who triggered
  type: "command" | "trigger" | "mention" | "dm" | "scheduled";
  input: string;
  output?: string;
  status: "pending" | "processing" | "completed" | "failed" | "timeout";
  durationMs?: number;
  tokensUsed?: number;
  cost?: string;
  error?: string;
  timestamp: string;
}

// ============================================================================
// 2. CHANNELS (Discord/Slack-style)
// ============================================================================

/**
 * Channel within a Community Space.
 * Channels are persistent topic-based conversation streams.
 */
export interface ChatChannel {
  id: string;
  communityId: string;               // Parent community
  categoryId?: string;               // Parent category

  // Basic info
  name: string;                      // e.g., "general", "dev-chat"
  topic?: string;                    // Channel topic/description
  description?: string;
  icon?: string;                     // Emoji or IPFS CID
  color?: string;                    // Hex color

  // Type
  type: ChannelType;

  // Access
  isPrivate: boolean;
  isArchived: boolean;
  isLocked: boolean;                 // No new messages
  isNSFW: boolean;
  
  // Slow mode
  slowModeSeconds: number;           // 0 = disabled

  // Permissions
  permissionOverrides: ChannelPermissionOverride[];

  // Pinned & Bookmarked
  pinnedMessageIds: string[];

  // Thread settings
  defaultThreadAutoArchiveMinutes: number;
  
  // Position
  position: number;

  // Stats
  memberCount: number;
  messageCount: number;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  unreadCount: number;
  mentionCount: number;

  // IPFS
  manifestCid?: string;

  createdAt: string;
  updatedAt: string;
}

export type ChannelType =
  | "text"              // Standard text channel
  | "voice"             // Voice/audio channel
  | "stage"             // Stage channel (speaker + audience)
  | "announcement"      // Announcement-only (admins post)
  | "forum"             // Forum-style (thread-first)
  | "media"             // Media gallery channel
  | "bot"               // Dedicated bot interaction channel
  | "feed";             // RSS/webhook feed channel

/** Category for organizing channels */
export interface ChannelCategory {
  id: string;
  communityId: string;
  name: string;
  position: number;
  isCollapsed: boolean;
  channels: string[];                // Channel IDs in order
  permissionOverrides: ChannelPermissionOverride[];
  createdAt: string;
}

export interface ChannelPermissionOverride {
  targetType: "role" | "member" | "bot";
  targetId: string;
  allow: Partial<ChannelPermissions>;
  deny: Partial<ChannelPermissions>;
}

export interface ChannelPermissions {
  viewChannel: boolean;
  sendMessages: boolean;
  sendMedia: boolean;
  embedLinks: boolean;
  attachFiles: boolean;
  addReactions: boolean;
  useExternalEmoji: boolean;
  mentionEveryone: boolean;
  manageMessages: boolean;
  manageChannel: boolean;
  createThreads: boolean;
  sendInThreads: boolean;
  manageThreads: boolean;
  useCommands: boolean;
  connect: boolean;                  // Voice channels
  speak: boolean;                    // Voice channels
  stream: boolean;                   // Screen share in voice
  muteMembers: boolean;              // Voice moderation
  deafenMembers: boolean;
  moveMembers: boolean;
}

// ============================================================================
// 3. THREADS
// ============================================================================

/**
 * Thread â€” a nested conversation branching from a message.
 * Works in channels, groups, and even DMs.
 */
export interface ChatThread {
  id: string;
  parentMessageId: string;           // The message that started the thread
  conversationId: string;            // Parent conversation/channel
  channelId?: string;                // If in a channel

  // Basic info
  name?: string;                     // Thread name (auto-generated or custom)
  
  // Participants
  participantWallets: string[];      // Who's in this thread
  creatorWallet: string;

  // Settings
  isLocked: boolean;
  autoArchiveMinutes: number;        // 60, 1440 (1d), 4320 (3d), 10080 (7d)
  
  // Stats
  messageCount: number;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  unreadCount: number;

  // Status
  isArchived: boolean;
  isPinned: boolean;

  // IPFS
  threadCid?: string;

  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface ThreadMessage extends ChatMessage {
  threadId: string;
  threadPosition: number;            // Order within thread
}

// ============================================================================
// 4. VOICE MESSAGES & AUDIO ROOMS
// ============================================================================

export interface VoiceMessage {
  id: string;
  messageId: string;                 // Parent ChatMessage ID
  conversationId: string;

  // Audio data
  cid: string;                       // IPFS CID of encrypted audio
  format: "opus" | "aac" | "mp3" | "wav" | "ogg";
  durationMs: number;
  sampleRate: number;
  channels: 1 | 2;                   // Mono or stereo
  bitrate: number;
  fileSize: number;

  // Visualization
  waveform: number[];                // Amplitude samples for waveform display (0-1)
  
  // Transcription
  transcript?: string;               // AI-generated transcript
  transcriptLanguage?: string;
  transcriptConfidence?: number;     // 0-1
  isTranscribing: boolean;

  // Playback tracking
  playedBy: string[];                // Wallet addresses who played it
  playCount: number;

  createdAt: string;
}

/** Persistent audio room (like Discord voice channels) */
export interface AudioRoom {
  id: string;
  channelId?: string;                // If attached to a voice channel
  communityId?: string;

  name: string;
  description?: string;

  // Participants
  participants: AudioRoomParticipant[];
  maxParticipants: number;
  listenerCount: number;             // Audience (stage mode)

  // Settings
  type: "open" | "stage" | "private";
  requireSpeakerApproval: boolean;   // Stage mode
  isRecording: boolean;
  recordingCid?: string;
  allowChat: boolean;                // Text chat alongside audio

  // Quality
  codec: "opus" | "g722";
  spatialAudio: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;

  // Status
  status: "active" | "ended";
  startedAt: string;
  endedAt?: string;
}

export interface AudioRoomParticipant {
  walletAddress: string;
  displayName?: string;
  avatar?: string;
  role: "host" | "speaker" | "listener" | "invited";
  isMuted: boolean;
  isDeafened: boolean;
  handRaised: boolean;
  joinedAt: string;
  speakingDurationMs: number;
}

// ============================================================================
// 5. MESSAGE SEARCH
// ============================================================================

export interface MessageSearchQuery {
  /** Full-text search query */
  query: string;
  
  /** Filters */
  conversationIds?: string[];
  channelIds?: string[];
  communityIds?: string[];
  senderWallets?: string[];
  messageTypes?: ChatMessageType[];
  hasAttachments?: boolean;
  hasLinks?: boolean;
  hasReactions?: boolean;
  isPinned?: boolean;
  isBookmarked?: boolean;

  /** Date range */
  fromDate?: string;
  toDate?: string;

  /** Sorting */
  sortBy: "relevance" | "newest" | "oldest";

  /** Pagination */
  offset: number;
  limit: number;
}

export interface MessageSearchResult {
  messages: SearchResultMessage[];
  total: number;
  offset: number;
  limit: number;
  took: number;                      // Search duration in ms
  highlights: Record<string, string[]>; // Message ID â†’ highlighted snippets
}

export interface SearchResultMessage {
  message: ChatMessage;
  /** Decrypted content (only for messages user can access) */
  decryptedPreview?: string;
  /** Conversation context */
  conversationName?: string;
  conversationType?: string;
  /** Relevance score */
  score: number;
  /** Highlighted snippet with <mark> tags */
  highlight?: string;
}

// ============================================================================
// 6. MESSAGE FORWARDING
// ============================================================================

export interface ForwardMessageRequest {
  messageIds: string[];              // Messages to forward
  targetConversationIds: string[];   // Where to forward
  comment?: string;                  // Optional comment with forward
  preserveOriginalSender: boolean;   // Show original sender or show as your forward
}

export interface ForwardMessageResult {
  success: boolean;
  forwardedMessages: Array<{
    originalId: string;
    newId: string;
    conversationId: string;
  }>;
  error?: string;
}

export interface ForwardedMessageMeta {
  originalMessageId: string;
  originalConversationId: string;
  originalSenderWallet: string;
  originalSenderName?: string;
  originalTimestamp: string;
  forwardedBy: string;
  forwardedAt: string;
  forwardChain: number;              // How many times forwarded
}

// ============================================================================
// 7. BOOKMARKS & SAVED MESSAGES
// ============================================================================

export interface MessageBookmark {
  id: string;
  messageId: string;
  conversationId: string;
  userWallet: string;

  // Organization
  folder?: string;                   // Custom folder name
  tags: string[];
  note?: string;                     // Personal note about this bookmark
  color?: string;                    // Color label

  // Content snapshot (in case original is deleted)
  contentSnapshot: string;
  senderName?: string;
  messageTimestamp: string;

  createdAt: string;
}

export interface BookmarkFolder {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  bookmarkCount: number;
  createdAt: string;
}

// ============================================================================
// 8. STORIES / STATUS UPDATES
// ============================================================================

/**
 * Ephemeral status updates (like WhatsApp/Instagram stories).
 * Auto-expire after 24h. Stored encrypted on IPFS with TTL.
 */
export interface ChatStory {
  id: string;
  authorWallet: string;
  authorName?: string;
  authorAvatar?: string;

  // Content
  type: StoryType;
  content: StoryContent;

  // Privacy
  visibility: "everyone" | "contacts" | "custom";
  allowedViewers?: string[];         // Wallet addresses (for custom)
  blockedViewers?: string[];

  // Interaction
  viewCount: number;
  viewers: StoryViewer[];
  reactions: StoryReaction[];
  allowReactions: boolean;
  allowReplies: boolean;
  replies: StoryReply[];

  // Expiry
  expiresAt: string;                 // 24h from creation
  isExpired: boolean;

  // IPFS
  cid?: string;
  encryptionKey?: string;

  createdAt: string;
}

export type StoryType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "link"
  | "poll"
  | "location"
  | "mood";

export interface StoryContent {
  text?: string;
  mediaCid?: string;                 // IPFS CID
  mediaType?: string;
  backgroundColor?: string;
  fontStyle?: string;
  linkUrl?: string;
  linkPreview?: LinkPreview;
  location?: { lat: number; lng: number; name: string };
  mood?: { emoji: string; text: string };
  poll?: { question: string; options: string[] };
}

export interface StoryViewer {
  walletAddress: string;
  viewedAt: string;
}

export interface StoryReaction {
  walletAddress: string;
  emoji: string;
  timestamp: string;
}

export interface StoryReply {
  id: string;
  senderWallet: string;
  content: string;
  timestamp: string;
}

// ============================================================================
// 9. RICH EMBEDS & LINK PREVIEWS
// ============================================================================

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  siteName?: string;
  type: "article" | "video" | "image" | "audio" | "rich" | "link";
  
  // For embeddable content
  embedUrl?: string;
  embedHtml?: string;
  
  // Metadata
  author?: string;
  publishedDate?: string;
  
  // Fetched
  fetchedAt: string;
  cid?: string;                      // Cached preview on IPFS
}

export interface RichEmbed {
  id: string;
  messageId: string;
  type: EmbedType;
  title?: string;
  description?: string;
  url?: string;
  color?: string;                    // Hex color for embed border
  thumbnail?: { url: string; width?: number; height?: number };
  image?: { url: string; width?: number; height?: number };
  video?: { url: string; width?: number; height?: number };
  author?: { name: string; url?: string; iconUrl?: string };
  footer?: { text: string; iconUrl?: string };
  fields: EmbedField[];
  timestamp?: string;
}

export type EmbedType =
  | "link-preview"
  | "bot-response"
  | "code-snippet"
  | "file-preview"
  | "poll-embed"
  | "payment-request"
  | "transaction"
  | "agent-task"
  | "custom";

export interface EmbedField {
  name: string;
  value: string;
  inline: boolean;
}

// ============================================================================
// 10. COMMUNITY SPACES
// ============================================================================

/**
 * Community Space â€” a collection of channels, members, bots, and roles.
 * Like a Discord server or Slack workspace.
 */
export interface CommunitySpace {
  id: string;
  
  // Identity
  name: string;
  description?: string;
  shortDescription?: string;
  avatar?: string;                   // IPFS CID
  banner?: string;                   // IPFS CID
  icon?: string;                     // Emoji

  // Owner
  ownerWallet: string;
  ownerDid: string;

  // Structure
  channels: ChatChannel[];
  categories: ChannelCategory[];
  roles: CommunityRole[];

  // Members
  memberCount: number;
  onlineCount: number;
  maxMembers: number;

  // Bots
  installedBots: BotInstallation[];

  // Settings
  settings: CommunitySettings;

  // Discovery
  isPublic: boolean;
  tags: string[];
  category: CommunityCategory;
  inviteCode?: string;
  vanityUrl?: string;                // e.g., "joycreate-dev"
  website?: string;

  // Verification
  isVerified: boolean;
  isPartnered: boolean;

  // Stats
  totalMessages: number;
  activeMembers7d: number;
  boostLevel: number;
  boostCount: number;

  // IPFS
  manifestCid?: string;

  // NFT gating
  nftGating?: NFTGateConfig;

  // Token gating
  tokenGating?: TokenGateConfig;

  createdAt: string;
  updatedAt: string;
}

export type CommunityCategory =
  | "technology"
  | "gaming"
  | "education"
  | "art"
  | "music"
  | "business"
  | "finance"
  | "defi"
  | "nft"
  | "dao"
  | "social"
  | "science"
  | "health"
  | "sports"
  | "other";

export interface CommunitySettings {
  // General
  defaultChannel: string;
  systemChannelId?: string;          // Where system messages go
  rulesChannelId?: string;

  // Verification
  verificationLevel: "none" | "low" | "medium" | "high" | "highest";
  
  // Content filter
  explicitContentFilter: "disabled" | "members-without-roles" | "all-members";
  
  // Notifications
  defaultNotifications: "all" | "mentions" | "none";
  
  // Moderation
  autoModEnabled: boolean;
  
  // Welcome
  welcomeMessage?: string;
  welcomeChannelId?: string;
  
  // Boost
  boostBarEnabled: boolean;
  
  // Privacy
  requireCaptcha: boolean;
  requireWalletVerification: boolean;
}

export interface CommunityRole {
  id: string;
  name: string;
  color?: string;                    // Hex color
  icon?: string;                     // Emoji
  position: number;                  // Higher = more authority
  permissions: ChannelPermissions;
  isMentionable: boolean;
  isDefault: boolean;                // Auto-assigned to new members
  memberCount: number;
  createdAt: string;
}

export interface CommunityMember {
  walletAddress: string;
  did: string;
  displayName?: string;
  avatar?: string;
  nickname?: string;                 // Server-specific nickname
  roles: string[];                   // Role IDs
  joinedAt: string;
  lastActiveAt?: string;
  isBoosting: boolean;
  boostingSince?: string;
  communicationDisabled?: boolean;   // Timed out
  communicationDisabledUntil?: string;
}

// ============================================================================
// 11. NFT & TOKEN GATING
// ============================================================================

export interface NFTGateConfig {
  enabled: boolean;
  rules: NFTGateRule[];
  message?: string;                  // Custom "you need NFT" message
}

export interface NFTGateRule {
  id: string;
  contractAddress: string;
  chain: "ethereum" | "polygon" | "base" | "solana" | "arbitrum" | "optimism";
  tokenType: "ERC-721" | "ERC-1155" | "SPL";
  minBalance: number;
  specificTokenIds?: string[];       // Specific token IDs required
  grantRoleId?: string;             // Auto-assign this role
  grantChannelAccess?: string[];    // Auto-grant channel access
}

export interface TokenGateConfig {
  enabled: boolean;
  rules: TokenGateRule[];
}

export interface TokenGateRule {
  id: string;
  contractAddress: string;
  chain: string;
  tokenSymbol: string;
  minBalance: string;                // In token units
  grantRoleId?: string;
  grantChannelAccess?: string[];
}

// ============================================================================
// 12. PAYMENT / TIP INTEGRATION
// ============================================================================

export interface ChatPayment {
  id: string;
  messageId: string;
  conversationId: string;

  type: PaymentType;
  
  // Parties
  senderWallet: string;
  recipientWallet: string;

  // Amount
  amount: string;
  currency: string;                  // "ETH", "USDC", "JOY", etc.
  chain: string;

  // Transaction
  txHash?: string;
  status: PaymentStatus;
  confirmedAt?: string;

  // Metadata
  memo?: string;
  isAnonymous: boolean;

  // Request details (for payment requests)
  requestedAmount?: string;
  requestedCurrency?: string;
  expiresAt?: string;

  createdAt: string;
}

export type PaymentType =
  | "tip"               // Gratitude payment
  | "payment"           // Direct payment
  | "request"           // Payment request
  | "split"             // Split bill
  | "subscription"      // Recurring
  | "bounty";           // For completing a task

export type PaymentStatus =
  | "pending"
  | "processing"
  | "confirmed"
  | "failed"
  | "cancelled"
  | "refunded"
  | "expired";

// ============================================================================
// 13. SMART NOTIFICATIONS
// ============================================================================

export interface SmartNotification {
  id: string;
  recipientWallet: string;

  // Source
  type: NotificationType;
  sourceConversationId?: string;
  sourceChannelId?: string;
  sourceCommunityId?: string;
  sourceMessageId?: string;
  sourceBotId?: string;

  // Content
  title: string;
  body: string;
  icon?: string;
  image?: string;
  url?: string;                      // Deep link

  // Priority
  priority: "critical" | "high" | "normal" | "low";
  
  // AI classification
  aiCategory?: "urgent" | "action-required" | "mention" | "reply" | "social" | "bot" | "system";
  aiSummary?: string;

  // Status
  isRead: boolean;
  isActioned: boolean;
  isMuted: boolean;
  readAt?: string;

  // Actions
  actions?: NotificationAction[];

  // Delivery
  deliveredVia: ("push" | "in-app" | "email" | "sms")[];
  deliveredAt: string;

  createdAt: string;
  expiresAt?: string;
}

export type NotificationType =
  | "message"
  | "mention"
  | "reply"
  | "reaction"
  | "thread-update"
  | "meeting-invite"
  | "meeting-starting"
  | "appointment-reminder"
  | "group-invite"
  | "community-invite"
  | "bot-alert"
  | "payment-received"
  | "payment-request"
  | "role-assigned"
  | "moderation-action"
  | "system";

export interface NotificationAction {
  id: string;
  label: string;
  type: "reply" | "accept" | "decline" | "dismiss" | "open" | "custom";
  url?: string;
  payload?: Record<string, unknown>;
}

// ============================================================================
// 14. MODERATION & ANTI-SPAM AI
// ============================================================================

export interface ModerationAction {
  id: string;
  communityId?: string;
  channelId?: string;
  conversationId?: string;

  // Target
  targetWallet: string;
  targetMessageId?: string;

  // Action
  type: ModerationActionType;
  reason: string;
  evidence?: string[];               // Message IDs as evidence
  
  // Duration
  duration?: number;                 // Minutes (for temp actions)
  expiresAt?: string;

  // Who
  moderatorWallet: string;
  isBotAction: boolean;              // Auto-moderation
  botId?: string;

  // Appeal
  isAppealed: boolean;
  appealMessage?: string;
  appealStatus?: "pending" | "accepted" | "rejected";

  createdAt: string;
}

export type ModerationActionType =
  | "warn"
  | "mute"
  | "kick"
  | "ban"
  | "timeout"
  | "delete-message"
  | "purge-messages"
  | "restrict"
  | "flag"
  | "shadow-ban";

export interface AutoModConfig {
  enabled: boolean;
  
  // Rules
  spamDetection: boolean;
  spamThreshold: number;             // 0-1 sensitivity
  
  profanityFilter: boolean;
  profanityWordlist?: string[];
  profanityAction: ModerationActionType;
  
  linkFiltering: boolean;
  allowedDomains?: string[];
  blockedDomains?: string[];
  
  capsLockDetection: boolean;
  capsThreshold: number;             // Percentage of caps (0-100)
  
  duplicateMessageDetection: boolean;
  duplicateWindow: number;           // Seconds
  
  mentionSpamDetection: boolean;
  maxMentionsPerMessage: number;
  
  inviteLinkDetection: boolean;
  blockInviteLinks: boolean;
  
  raidProtection: boolean;
  raidJoinThreshold: number;         // Joins per minute to trigger
  raidAction: "lock" | "verify" | "kick-new";
  
  // AI-powered
  aiModeration: boolean;
  aiSentimentThreshold?: number;     // Block messages below this sentiment
  aiToxicityThreshold?: number;      // Block messages above this toxicity
  aiScamDetection: boolean;
  aiPhishingDetection: boolean;

  // Custom
  customRules: AutoModCustomRule[];
}

export interface AutoModCustomRule {
  id: string;
  name: string;
  type: "keyword" | "regex" | "ai-classifier";
  pattern: string;
  action: ModerationActionType;
  channels?: string[];               // Apply to specific channels only
  exemptRoles?: string[];
  enabled: boolean;
}

export interface ModerationLog {
  actions: ModerationAction[];
  total: number;
  filters: {
    type?: ModerationActionType;
    moderator?: string;
    target?: string;
    dateFrom?: string;
    dateTo?: string;
    isBotAction?: boolean;
  };
}

// ============================================================================
// 15. EXTENDED MESSAGE TYPES
// ============================================================================

/** Extended message type union for all new features */
export type ExtendedMessageType = ChatMessageType
  | "voice"             // Voice message
  | "sticker"           // Sticker
  | "gif"               // GIF
  | "poll"              // Inline poll
  | "payment"           // Payment/tip
  | "payment-request"   // Payment request
  | "forward"           // Forwarded message
  | "embed"             // Rich embed
  | "thread-start"      // Thread creation
  | "bot-response"      // Bot response card
  | "bot-command"        // Bot command invocation
  | "agent-task"         // A2A agent task update
  | "location"          // Location share
  | "contact"           // Contact card
  | "event"             // Calendar event
  | "document"          // Document preview
  | "code-block"        // Syntax-highlighted code
  | "math"              // LaTeX/math expression
  | "canvas"            // Collaborative whiteboard
  | "call-started"      // Call notification
  | "call-ended"        // Call ended notification
  | "member-joined"     // System: member joined
  | "member-left"       // System: member left
  | "pinned"            // System: message pinned
  | "role-changed"      // System: role changed
  | "encrypted-file";   // E2E encrypted file

/** Sticker for chat */
export interface ChatSticker {
  id: string;
  packId: string;
  name: string;
  tags: string[];
  cid: string;                       // IPFS CID
  format: "png" | "gif" | "apng" | "lottie" | "webp";
  width: number;
  height: number;
}

export interface StickerPack {
  id: string;
  name: string;
  description?: string;
  author: string;
  authorWallet: string;
  stickers: ChatSticker[];
  thumbnail: string;                 // CID
  isAnimated: boolean;
  isOfficial: boolean;
  installCount: number;
  price?: string;
  currency?: string;
  createdAt: string;
}

// ============================================================================
// 16. COLLABORATIVE FEATURES
// ============================================================================

/** Shared whiteboard/canvas within chat */
export interface SharedCanvas {
  id: string;
  conversationId: string;
  name: string;
  
  // Canvas data
  dataCid: string;                   // IPFS CID of canvas state
  thumbnailCid?: string;
  format: "excalidraw" | "tldraw" | "custom";
  
  // Collaboration
  activeEditors: string[];           // Wallet addresses currently editing
  totalEditors: number;
  version: number;
  
  // Access
  isReadOnly: boolean;
  allowedEditors?: string[];
  
  createdAt: string;
  updatedAt: string;
}

/** Shared document within chat */
export interface SharedDocument {
  id: string;
  conversationId: string;
  name: string;
  
  type: "text" | "markdown" | "code" | "spreadsheet";
  dataCid: string;
  language?: string;                 // For code documents
  
  activeEditors: string[];
  version: number;
  
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// 17. ANALYTICS & INSIGHTS
// ============================================================================

export interface ChatAnalytics {
  conversationId?: string;
  communityId?: string;
  
  // Activity
  messagesPerDay: Array<{ date: string; count: number }>;
  activeUsersPerDay: Array<{ date: string; count: number }>;
  peakHours: Array<{ hour: number; count: number }>;
  
  // Engagement
  avgResponseTimeMs: number;
  avgMessageLength: number;
  mediaPercentage: number;
  reactionRate: number;
  threadRate: number;
  
  // Growth
  memberGrowth: Array<{ date: string; total: number; joined: number; left: number }>;
  retentionRate: number;
  
  // Top contributors
  topSenders: Array<{ wallet: string; name?: string; messageCount: number }>;
  topReactors: Array<{ wallet: string; name?: string; reactionCount: number }>;
  
  // Bot usage
  botInteractions: number;
  topBotCommands: Array<{ command: string; count: number }>;
  
  // Content
  topEmoji: Array<{ emoji: string; count: number }>;
  topLinks: Array<{ domain: string; count: number }>;
  
  period: "24h" | "7d" | "30d" | "90d" | "all";
}

// ============================================================================
// 18. API REQUEST/RESPONSE EXTENSIONS
// ============================================================================

export interface CreateChannelRequest {
  communityId: string;
  categoryId?: string;
  name: string;
  type: ChannelType;
  topic?: string;
  isPrivate?: boolean;
  permissionOverrides?: ChannelPermissionOverride[];
}

export interface CreateChannelResult {
  success: boolean;
  channel?: ChatChannel;
  error?: string;
}

export interface CreateCommunityRequest {
  name: string;
  description?: string;
  avatar?: string;
  isPublic?: boolean;
  category?: CommunityCategory;
  tags?: string[];
  nftGating?: NFTGateConfig;
  tokenGating?: TokenGateConfig;
}

export interface CreateCommunityResult {
  success: boolean;
  community?: CommunitySpace;
  inviteCode?: string;
  error?: string;
}

export interface CreateThreadRequest {
  conversationId: string;
  channelId?: string;
  parentMessageId: string;
  name?: string;
  initialMessage?: string;
  autoArchiveMinutes?: number;
}

export interface CreateThreadResult {
  success: boolean;
  thread?: ChatThread;
  error?: string;
}

export interface InstallBotRequest {
  botId: string;
  conversationId: string;
  config?: Partial<BotInstallConfig>;
  permissions?: Partial<BotPermissions>;
}

export interface InstallBotResult {
  success: boolean;
  installation?: BotInstallation;
  error?: string;
}

export interface SendVoiceMessageRequest {
  conversationId: string;
  audioData: ArrayBuffer | string;   // Raw audio or base64
  format: VoiceMessage["format"];
  durationMs: number;
  transcribe?: boolean;
  replyTo?: string;
}

export interface SendVoiceMessageResult {
  success: boolean;
  voiceMessage?: VoiceMessage;
  message?: ChatMessage;
  cid?: string;
  error?: string;
}

export interface CreateStoryRequest {
  type: StoryType;
  content: StoryContent;
  visibility?: ChatStory["visibility"];
  allowedViewers?: string[];
  allowReactions?: boolean;
  allowReplies?: boolean;
}

export interface CreateStoryResult {
  success: boolean;
  story?: ChatStory;
  cid?: string;
  error?: string;
}

export interface SendPaymentRequest {
  conversationId: string;
  recipientWallet: string;
  amount: string;
  currency: string;
  chain: string;
  type: PaymentType;
  memo?: string;
  isAnonymous?: boolean;
}

export interface SendPaymentResult {
  success: boolean;
  payment?: ChatPayment;
  txHash?: string;
  error?: string;
}

export interface SearchMessagesRequest extends MessageSearchQuery {}
export interface SearchMessagesResult extends MessageSearchResult {}
