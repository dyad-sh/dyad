/**
 * Decentralized Chat Types
 * Wallet-to-wallet encrypted messaging with Helia IPFS pinning
 * Supports offline message retrieval via libp2p pubsub and DHT
 */

// ============================================================================
// Identity & Wallet Types
// ============================================================================

/**
 * Chat identity linked to a wallet address
 */
export interface ChatIdentity {
  id: string;                        // Unique identity ID
  walletAddress: string;             // Ethereum/Solana wallet address
  did: string;                       // Decentralized identifier (did:joy:...)
  publicKey: string;                 // X25519 public key for encryption
  signingKey: string;                // Ed25519 public key for signatures
  displayName?: string;
  avatar?: string;                   // IPFS CID of avatar
  bio?: string;
  
  // Presence
  status: ChatPresenceStatus;
  lastSeen: string;                  // ISO timestamp
  
  // Verification
  walletSignature?: string;          // Signature proving wallet ownership
  verified: boolean;
  
  createdAt: string;
  updatedAt: string;
}

export type ChatPresenceStatus = "online" | "away" | "busy" | "offline";

/**
 * Wallet verification proof
 */
export interface WalletVerificationProof {
  walletAddress: string;
  message: string;
  signature: string;
  timestamp: string;
  chain: "ethereum" | "solana" | "polygon" | "base";
}

// ============================================================================
// Message Types
// ============================================================================

/**
 * Encrypted chat message stored on IPFS
 */
export interface ChatMessage {
  id: string;                        // Unique message ID
  conversationId: string;
  
  // Sender & Recipients
  sender: string;                    // Sender wallet address
  senderDid: string;                 // Sender DID
  recipients: string[];              // Recipient wallet addresses
  
  // Content (encrypted)
  encryptedContent: string;          // X25519-XSalsa20-Poly1305 encrypted
  nonce: string;                     // Encryption nonce
  encryptionAlgorithm: EncryptionAlgorithm;
  
  // Message metadata (public)
  messageType: ChatMessageType;
  replyTo?: string;                  // Message ID being replied to
  threadId?: string;                 // Thread root message ID
  
  // Attachments
  attachments?: MessageAttachment[];
  
  // Reactions
  reactions?: MessageReaction[];
  
  // Status tracking
  deliveryStatus: DeliveryStatus;
  readReceipts: ReadReceipt[];
  
  // Signatures & Verification
  signature: string;                 // Ed25519 signature of message hash
  messageHash: string;               // SHA-256 hash of original content
  
  // IPFS/Helia
  cid?: string;                      // IPFS content identifier
  pinnedAt?: string;                 // When message was pinned
  pinProviders?: string[];           // Nodes pinning this message
  
  // Timestamps
  createdAt: string;
  editedAt?: string;
  expiresAt?: string;                // For ephemeral messages
}

export type EncryptionAlgorithm = 
  | "x25519-xsalsa20-poly1305"       // NaCl box
  | "x25519-chacha20-poly1305"       // Modern alternative
  | "aes-256-gcm";                   // AES-GCM

export type ChatMessageType = 
  | "text"
  | "image"
  | "file"
  | "audio"
  | "video"
  | "link"
  | "code"
  | "system"
  | "reaction"
  | "typing"
  | "presence"
  | "key-exchange"
  | "delivery-receipt"
  | "read-receipt";

export interface MessageAttachment {
  id: string;
  type: "image" | "file" | "audio" | "video";
  name: string;
  mimeType: string;
  size: number;
  cid: string;                       // IPFS CID of attachment
  encryptedKey?: string;             // Encrypted symmetric key for attachment
  thumbnail?: string;                // CID of thumbnail (for images/videos)
  width?: number;
  height?: number;
  duration?: number;                 // For audio/video (seconds)
}

export interface MessageReaction {
  emoji: string;
  userId: string;
  timestamp: string;
}

export interface ReadReceipt {
  userId: string;
  readAt: string;
}

export type DeliveryStatus = 
  | "sending"                        // Being sent
  | "sent"                           // Sent to network
  | "pinned"                         // Pinned to Helia
  | "delivered"                      // Delivered to recipient
  | "read"                           // Read by recipient
  | "failed";                        // Failed to send

// ============================================================================
// Conversation Types
// ============================================================================

/**
 * Chat conversation (1:1 or group)
 */
export interface ChatConversation {
  id: string;
  type: "direct" | "group" | "channel";
  
  // Participants
  participants: ConversationParticipant[];
  creatorId: string;                 // Wallet address of creator
  
  // Group/Channel info (for non-direct)
  name?: string;
  description?: string;
  avatar?: string;                   // IPFS CID
  
  // Settings
  settings: ConversationSettings;
  
  // Encryption
  encryptionType: "end-to-end" | "server-assisted";
  groupKey?: string;                 // Encrypted group key (for groups)
  keyRotationCount: number;
  
  // Message tracking
  lastMessage?: ChatMessagePreview;
  unreadCount: number;
  pinnedMessages: string[];          // Message IDs
  
  // IPFS sync
  headCid?: string;                  // Latest message CID (linked list head)
  syncState: ConversationSyncState;
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface ConversationParticipant {
  walletAddress: string;
  did: string;
  publicKey: string;                 // Encryption public key
  displayName?: string;
  avatar?: string;
  role: ParticipantRole;
  joinedAt: string;
  lastReadMessageId?: string;
  notificationSettings: NotificationSettings;
  encryptedGroupKey?: string;        // Group key encrypted for this participant
}

export type ParticipantRole = "owner" | "admin" | "member" | "readonly";

export interface ConversationSettings {
  // Privacy
  isPublic: boolean;                 // Can be discovered
  allowJoinRequests: boolean;
  requireApproval: boolean;
  
  // Messages
  allowReactions: boolean;
  allowReplies: boolean;
  allowEdits: boolean;
  allowDeletes: boolean;
  
  // Retention
  messageRetention: "forever" | "1day" | "7days" | "30days" | "90days";
  autoDeleteRead: boolean;
  
  // Pinning
  autoPinMessages: boolean;          // Auto-pin to Helia
  pinRetentionDays: number;          // How long to keep pins
  
  // Access
  inviteOnly: boolean;
  maxParticipants: number;
}

export interface NotificationSettings {
  enabled: boolean;
  sound: boolean;
  mentions: boolean;
  allMessages: boolean;
  mutedUntil?: string;               // ISO timestamp
}

export interface ChatMessagePreview {
  id: string;
  senderId: string;
  senderName?: string;
  preview: string;                   // Truncated/decrypted preview
  timestamp: string;
  type: ChatMessageType;
}

export type ConversationSyncState = 
  | "synced"                         // Fully synced with network
  | "syncing"                        // Currently syncing
  | "behind"                         // Local behind network
  | "ahead"                          // Local ahead (pending upload)
  | "conflict"                       // Merge conflict
  | "offline";                       // Cannot sync

// ============================================================================
// Helia/IPFS Storage Types
// ============================================================================

/**
 * Message stored as IPLD DAG node
 */
export interface MessageDAGNode {
  // Message content
  message: ChatMessage;
  
  // Linked list for conversation history
  previous?: string;                 // CID of previous message
  next?: string[];                   // CIDs of next messages (for branches)
  
  // Merkle tree info
  root?: string;                     // Root CID of conversation
  depth: number;                     // Depth in tree
  
  // Verification
  hash: string;
  signature: string;
  
  // Metadata
  version: number;
  createdAt: string;
}

/**
 * Conversation manifest stored on IPFS
 */
export interface ConversationManifest {
  id: string;
  type: "direct" | "group" | "channel";
  
  // Participants (public keys only, not message content)
  participants: Array<{
    walletAddress: string;
    publicKey: string;
    role: ParticipantRole;
  }>;
  
  // Message chain
  genesisMessageCid: string;         // First message CID
  latestMessageCid: string;          // Latest message CID
  messageCount: number;
  
  // Settings
  settings: ConversationSettings;
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
  
  // Signature
  signature: string;
  signedBy: string;                  // DID of signer
}

/**
 * Pin record for tracking pinned messages
 */
export interface MessagePin {
  cid: string;
  messageId: string;
  conversationId: string;
  pinnedAt: string;
  pinnedBy: string;                  // Wallet address
  expiresAt?: string;
  provider: "helia" | "pinata" | "web3storage" | "filebase";
  status: "pinning" | "pinned" | "failed" | "expired";
  size: number;
}

// ============================================================================
// libp2p PubSub Types
// ============================================================================

/**
 * PubSub topic for real-time messaging
 */
export interface ChatPubSubTopic {
  name: string;                      // Topic name (e.g., "/joycreate/chat/v1/{conversationId}")
  type: "conversation" | "presence" | "typing" | "system";
  conversationId?: string;
  subscribers: string[];             // Peer IDs
  createdAt: string;
}

/**
 * PubSub message wrapper
 */
export interface ChatPubSubMessage {
  type: PubSubMessageType;
  conversationId: string;
  senderId: string;                  // Wallet address
  payload: any;                      // Type-specific payload
  timestamp: string;
  signature: string;
}

export type PubSubMessageType = 
  | "message:new"
  | "message:edit"
  | "message:delete"
  | "message:reaction"
  | "typing:start"
  | "typing:stop"
  | "presence:update"
  | "sync:request"
  | "sync:response"
  | "key:rotate"
  | "participant:join"
  | "participant:leave";

// ============================================================================
// Offline Sync Types
// ============================================================================

/**
 * Offline message queue for unreachable recipients
 */
export interface OfflineMessageQueue {
  recipientWallet: string;
  recipientDid: string;
  messages: QueuedMessage[];
  lastAttempt?: string;
  attemptCount: number;
  createdAt: string;
}

export interface QueuedMessage {
  id: string;
  messageCid: string;
  conversationId: string;
  priority: "high" | "normal" | "low";
  queuedAt: string;
  expiresAt: string;
  retryCount: number;
}

/**
 * Sync state for pulling messages when coming online
 */
export interface ChatSyncState {
  walletAddress: string;
  lastSyncedAt: string;
  
  // Per-conversation sync
  conversations: Map<string, {
    conversationId: string;
    lastMessageCid: string;
    lastMessageTimestamp: string;
    unreadCount: number;
    needsSync: boolean;
  }>;
  
  // DHT records to check
  pendingDHTKeys: string[];
  
  // Pinned messages to retrieve
  pendingPins: string[];
}

/**
 * Message sync request/response
 */
export interface SyncRequest {
  requestId: string;
  requesterId: string;               // Wallet address
  conversationId: string;
  
  // What to sync
  fromCid?: string;                  // Start from this CID
  fromTimestamp?: string;            // Start from this timestamp
  limit: number;
  
  timestamp: string;
  signature: string;
}

export interface SyncResponse {
  requestId: string;
  responderId: string;               // Wallet address
  conversationId: string;
  
  // Synced data
  messages: ChatMessage[];
  messageCids: string[];
  latestCid: string;
  hasMore: boolean;
  
  timestamp: string;
  signature: string;
}

// ============================================================================
// Key Exchange Types
// ============================================================================

/**
 * X3DH key bundle for async key exchange
 */
export interface KeyBundle {
  identityKey: string;               // Long-term identity key
  signedPreKey: string;              // Medium-term signed pre-key
  preKeySignature: string;           // Signature of pre-key
  oneTimePreKeys: string[];          // One-time pre-keys
  
  walletAddress: string;
  uploadedAt: string;
  expiresAt: string;
}

/**
 * Session keys for an established conversation
 */
export interface SessionKeys {
  conversationId: string;
  
  // Ratchet state
  rootKey: string;
  chainKey: string;
  messageNumber: number;
  
  // DHs
  ourEphemeralKey: string;
  theirPublicKey: string;
  
  // History
  skippedKeys: Map<number, string>;
  
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Chat Events
// ============================================================================

export type ChatEvent = 
  | { type: "message:received"; message: ChatMessage; conversationId: string }
  | { type: "message:sent"; message: ChatMessage; cid: string }
  | { type: "message:delivered"; messageId: string; to: string }
  | { type: "message:read"; messageId: string; by: string }
  | { type: "message:failed"; messageId: string; error: string }
  | { type: "message:pinned"; messageId: string; cid: string }
  | { type: "typing:started"; conversationId: string; userId: string }
  | { type: "typing:stopped"; conversationId: string; userId: string }
  | { type: "presence:changed"; userId: string; status: ChatPresenceStatus }
  | { type: "conversation:created"; conversation: ChatConversation }
  | { type: "conversation:updated"; conversationId: string; updates: Partial<ChatConversation> }
  | { type: "participant:joined"; conversationId: string; participant: ConversationParticipant }
  | { type: "participant:left"; conversationId: string; walletAddress: string }
  | { type: "sync:started"; conversationId: string }
  | { type: "sync:completed"; conversationId: string; messageCount: number }
  | { type: "sync:failed"; conversationId: string; error: string }
  | { type: "peer:connected"; peerId: string; walletAddress: string }
  | { type: "peer:disconnected"; peerId: string }
  | { type: "offline:queued"; messageId: string; recipientWallet: string }
  | { type: "offline:delivered"; messageId: string; recipientWallet: string };

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface SendMessageRequest {
  conversationId: string;
  content: string;
  messageType?: ChatMessageType;
  attachments?: Array<{
    data: Buffer | string;           // File data or CID
    name: string;
    mimeType: string;
  }>;
  replyTo?: string;
  threadId?: string;
  expiresIn?: number;                // Seconds until expiration
}

export interface SendMessageResult {
  success: boolean;
  message?: ChatMessage;
  cid?: string;
  deliveryStatus: DeliveryStatus;
  error?: string;
}

export interface CreateConversationRequest {
  type: "direct" | "group" | "channel";
  participants: string[];            // Wallet addresses
  name?: string;
  description?: string;
  settings?: Partial<ConversationSettings>;
}

export interface CreateConversationResult {
  success: boolean;
  conversation?: ChatConversation;
  manifestCid?: string;
  error?: string;
}

export interface SyncMessagesRequest {
  conversationId?: string;           // Specific conversation or all
  fromTimestamp?: string;
  limit?: number;
}

export interface SyncMessagesResult {
  success: boolean;
  conversations: Array<{
    conversationId: string;
    newMessages: number;
    latestCid: string;
  }>;
  totalNewMessages: number;
  error?: string;
}

export interface PullPinnedMessagesRequest {
  conversationId?: string;
  cids?: string[];                   // Specific CIDs to pull
  fromTimestamp?: string;
}

export interface PullPinnedMessagesResult {
  success: boolean;
  messages: ChatMessage[];
  failedCids: string[];
  error?: string;
}

// ============================================================================
// Chat Service Status
// ============================================================================

export interface ChatServiceStatus {
  initialized: boolean;
  
  // Identity
  identity?: ChatIdentity;
  walletConnected: boolean;
  
  // Network
  heliaConnected: boolean;
  heliaPeerId?: string;
  connectedPeers: number;
  
  // PubSub
  pubsubEnabled: boolean;
  activeTopics: string[];
  
  // DHT
  dhtEnabled: boolean;
  dhtRecords: number;
  
  // Local state
  conversationCount: number;
  messageCount: number;
  pinnedMessageCount: number;
  
  // Sync
  syncState: "idle" | "syncing" | "error";
  lastSyncAt?: string;
  pendingMessages: number;
  offlineQueueSize: number;
}

// ============================================================================
// Meeting & Video Call Types
// ============================================================================

/**
 * Meeting/Video call information
 */
export interface Meeting {
  id: string;
  conversationId: string;
  
  // Basic info
  title: string;
  description?: string;
  type: MeetingType;
  status: MeetingStatus;
  
  // Scheduling
  scheduledStart?: string;           // ISO timestamp (for scheduled meetings)
  scheduledEnd?: string;
  actualStart?: string;
  actualEnd?: string;
  duration?: number;                 // In minutes
  timezone?: string;
  
  // Participants
  hostWallet: string;
  participants: MeetingParticipant[];
  maxParticipants: number;
  waitingRoom: string[];             // Wallet addresses waiting to join
  
  // Access
  isPublic: boolean;
  requiresApproval: boolean;
  password?: string;                 // Encrypted meeting password
  inviteLink?: string;
  
  // Recording
  isRecording: boolean;
  recordingCid?: string;             // IPFS CID of recording
  allowRecording: boolean;
  autoRecord: boolean;
  
  // Settings
  settings: MeetingSettings;
  
  // WebRTC
  webrtcRoomId: string;
  signalingTopic: string;            // PubSub topic for signaling
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
}

export type MeetingType = 
  | "instant"                        // Start now
  | "scheduled"                      // Future meeting
  | "recurring"                      // Repeating meeting
  | "webinar"                        // One-to-many
  | "screen-share";                  // Screen sharing session

export type MeetingStatus =
  | "scheduled"                      // Not yet started
  | "waiting"                        // Host has started, waiting for participants
  | "live"                           // Meeting in progress
  | "paused"                         // Temporarily paused
  | "ended"                          // Meeting finished
  | "cancelled";                     // Meeting was cancelled

export interface MeetingParticipant {
  walletAddress: string;
  displayName?: string;
  avatar?: string;
  role: MeetingRole;
  status: ParticipantStatus;
  
  // Media state
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  handRaised: boolean;
  
  // Connection
  peerId?: string;
  connectionQuality?: "excellent" | "good" | "fair" | "poor";
  
  // Timestamps
  joinedAt?: string;
  leftAt?: string;
}

export type MeetingRole = 
  | "host"
  | "co-host"
  | "presenter"
  | "participant"
  | "viewer";                        // Can only watch/listen

export type ParticipantStatus =
  | "invited"
  | "waiting"
  | "joining"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "kicked"
  | "left";

export interface MeetingSettings {
  // Audio/Video defaults
  startWithAudioMuted: boolean;
  startWithVideoOff: boolean;
  allowParticipantVideo: boolean;
  allowParticipantAudio: boolean;
  allowScreenShare: boolean;
  
  // Moderation
  muteOnEntry: boolean;
  lockMeeting: boolean;
  allowChat: boolean;
  allowReactions: boolean;
  allowHandRaise: boolean;
  
  // Recording & Privacy
  allowRecording: boolean;
  notifyOnRecording: boolean;
  endToEndEncryption: boolean;
  
  // Waiting room
  enableWaitingRoom: boolean;
  autoAdmit: boolean;
  
  // Layout
  defaultLayout: "gallery" | "speaker" | "sidebar" | "presentation";
  maxVideoTiles: number;
  
  // Quality
  preferredVideoQuality: "auto" | "720p" | "1080p" | "4k";
  preferredAudioCodec: "opus" | "g722";
}

// ============================================================================
// Appointment/Scheduling Types
// ============================================================================

/**
 * Appointment for scheduling meetings
 */
export interface Appointment {
  id: string;
  conversationId?: string;
  
  // Basic info
  title: string;
  description?: string;
  type: AppointmentType;
  status: AppointmentStatus;
  
  // Scheduling
  startTime: string;
  endTime: string;
  timezone: string;
  
  // Recurrence
  recurrence?: RecurrenceRule;
  
  // Participants
  organizerWallet: string;
  attendees: AppointmentAttendee[];
  
  // Location
  locationType: "virtual" | "in-person" | "phone" | "hybrid";
  meetingLink?: string;              // For virtual meetings
  physicalLocation?: string;
  phoneNumber?: string;
  
  // Reminders
  reminders: AppointmentReminder[];
  
  // Notes
  notes?: string;
  agenda?: string[];
  attachments?: AppointmentAttachment[];
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
}

export type AppointmentType =
  | "meeting"
  | "call"
  | "interview"
  | "consultation"
  | "demo"
  | "workshop"
  | "event"
  | "reminder"
  | "other";

export type AppointmentStatus =
  | "pending"                        // Awaiting confirmations
  | "confirmed"                      // All confirmed
  | "tentative"                      // Some tentative
  | "cancelled"
  | "completed"
  | "no-show";

export interface AppointmentAttendee {
  walletAddress: string;
  email?: string;
  displayName?: string;
  responseStatus: "pending" | "accepted" | "declined" | "tentative";
  isOptional: boolean;
  responseAt?: string;
  comment?: string;
}

export interface RecurrenceRule {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;                  // Every N days/weeks/months
  daysOfWeek?: number[];             // 0-6 (Sunday-Saturday)
  dayOfMonth?: number;
  monthOfYear?: number;
  endDate?: string;
  occurrences?: number;              // End after N occurrences
  exceptions?: string[];             // Dates to skip
}

export interface AppointmentReminder {
  id: string;
  type: "notification" | "email" | "sms";
  minutesBefore: number;
  sent: boolean;
  sentAt?: string;
}

export interface AppointmentAttachment {
  id: string;
  name: string;
  type: string;
  cid: string;                       // IPFS CID
  size: number;
}

// ============================================================================
// Group Management Types
// ============================================================================

/**
 * Group chat with advanced features
 */
export interface ChatGroup {
  id: string;
  conversationId: string;
  
  // Basic info
  name: string;
  description?: string;
  avatar?: string;
  coverImage?: string;
  
  // Visibility & Access
  isPrivate: boolean;               // True = invite-only, false = public
  inviteLink?: string;              // Shareable invite link
  inviteCode?: string;              // Short code for joining
  
  // Ownership
  ownerWallet: string;
  admins: string[];                  // Wallet addresses
  
  // Members
  members: GroupMember[];
  pendingInvites: GroupInvite[];
  pendingRequests: JoinRequest[];
  bannedUsers: BannedUser[];
  
  // Settings
  settings: GroupSettings;
  
  // Categories/Topics
  topics?: GroupTopic[];
  
  // Stats
  memberCount: number;
  messageCount: number;
  unreadCount?: number;             // Unread messages for current user
  lastActivityAt: string;
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
}

export interface GroupMember {
  walletAddress: string;
  displayName?: string;
  avatar?: string;
  role: GroupRole;
  permissions: GroupPermissions;
  joinedAt: string;
  invitedBy?: string;
  lastSeenAt?: string;
  mutedUntil?: string;
  customTitle?: string;              // Custom role title
}

export type GroupRole = 
  | "owner"
  | "admin"
  | "moderator"
  | "member"
  | "guest";

export interface GroupPermissions {
  canSendMessages: boolean;
  canSendMedia: boolean;
  canAddMembers: boolean;
  canRemoveMembers: boolean;
  canChangeSettings: boolean;
  canPinMessages: boolean;
  canDeleteMessages: boolean;
  canStartMeetings: boolean;
  canCreatePolls: boolean;
  canManageTopics: boolean;
}

export interface GroupSettings {
  // Membership
  isPublic: boolean;
  joinMethod: "open" | "invite" | "request" | "code";
  inviteCode?: string;
  requireApproval: boolean;
  maxMembers: number;
  
  // Messaging
  slowMode: boolean;
  slowModeInterval?: number;         // Seconds between messages
  allowLinks: boolean;
  allowMedia: boolean;
  allowPolls: boolean;
  
  // Moderation
  autoMod: boolean;
  autoModRules?: AutoModRule[];
  
  // Notifications
  defaultMuted: boolean;
  announcementsOnly: boolean;
}

export interface AutoModRule {
  id: string;
  type: "spam" | "profanity" | "links" | "mentions" | "caps" | "custom";
  action: "warn" | "delete" | "mute" | "kick" | "ban";
  pattern?: string;                  // Regex for custom rules
  duration?: number;                 // Mute/ban duration in minutes
}

export interface GroupInvite {
  id: string;
  groupId: string;
  inviterWallet: string;
  inviteeWallet: string;
  message?: string;
  status: "pending" | "accepted" | "declined" | "expired";
  expiresAt: string;
  createdAt: string;
}

export interface JoinRequest {
  id: string;
  groupId: string;
  requesterWallet: string;
  message?: string;
  status: "pending" | "approved" | "rejected";
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface BannedUser {
  walletAddress: string;
  bannedBy: string;
  reason?: string;
  bannedAt: string;
  expiresAt?: string;                // null = permanent
}

export interface GroupTopic {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  messageCount: number;
  isDefault: boolean;
  position: number;
}

// ============================================================================
// Poll Types (for Groups)
// ============================================================================

export interface Poll {
  id: string;
  conversationId: string;
  creatorWallet: string;
  
  // Content
  question: string;
  options: PollOption[];
  
  // Settings
  type: "single" | "multiple";
  anonymous: boolean;
  showResults: "always" | "after-vote" | "after-end";
  allowAddOptions: boolean;
  
  // Timing
  endsAt?: string;
  
  // Results
  totalVotes: number;
  
  // Status
  status: "active" | "ended" | "cancelled";
  
  // Timestamps
  createdAt: string;
  endedAt?: string;
}

export interface PollOption {
  id: string;
  text: string;
  votes: number;
  voters?: string[];                 // Wallet addresses (if not anonymous)
}

// ============================================================================
// Reactions & Emoji Types
// ============================================================================

export interface ReactionSet {
  messageId: string;
  reactions: {
    [emoji: string]: string[];       // emoji -> wallet addresses
  };
}

// ============================================================================
// Meeting Request/Response Types
// ============================================================================

export interface CreateMeetingRequest {
  conversationId?: string;
  title: string;
  description?: string;
  type: MeetingType;
  scheduledStart?: string;
  scheduledEnd?: string;
  invitees?: string[];               // Wallet addresses
  settings?: Partial<MeetingSettings>;
}

export interface CreateMeetingResult {
  success: boolean;
  meeting?: Meeting;
  inviteLink?: string;
  error?: string;
}

export interface JoinMeetingRequest {
  meetingId: string;
  password?: string;
  audioEnabled?: boolean;
  videoEnabled?: boolean;
}

export interface JoinMeetingResult {
  success: boolean;
  meeting?: Meeting;
  webrtcConfig?: {
    iceServers: any[];
    signalingTopic: string;
  };
  error?: string;
}

export interface CreateAppointmentRequest {
  title: string;
  description?: string;
  type: AppointmentType;
  startTime: string;
  endTime: string;
  timezone: string;
  attendees: string[];               // Wallet addresses
  locationType: "virtual" | "in-person" | "phone" | "hybrid";
  recurrence?: RecurrenceRule;
  reminders?: Array<{ type: "notification" | "email"; minutesBefore: number }>;
}

export interface CreateAppointmentResult {
  success: boolean;
  appointment?: Appointment;
  error?: string;
}

export interface CreateGroupRequest {
  name: string;
  description?: string;
  avatar?: string;
  members?: string[];                // Initial member wallet addresses
  settings?: Partial<GroupSettings>;
}

export interface CreateGroupResult {
  success: boolean;
  group?: ChatGroup;
  conversation?: ChatConversation;
  error?: string;
}
