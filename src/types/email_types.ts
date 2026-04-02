/**
 * JoyCreate AI Email Agent — Type Definitions
 *
 * Covers multi-account email management, AI-powered triage/compose/summarize,
 * configurable agent autonomy, and calendar event extraction.
 */

// ─── Provider Types ──────────────────────────────────────────────────────────

export type EmailProviderType = "imap" | "gmail" | "microsoft";

export type EmailTrustLevel = "auto" | "confirm" | "never";

export type EmailAgentActionType =
  | "send"
  | "reply"
  | "forward"
  | "archive"
  | "label"
  | "delete"
  | "mark_read"
  | "move";

export type EmailAgentActionStatus =
  | "pending"
  | "approved"
  | "executed"
  | "rejected";

export type EmailPriority = "urgent" | "high" | "normal" | "low";

export type EmailCategory =
  | "action_required"
  | "fyi"
  | "newsletter"
  | "promotional"
  | "social"
  | "finance"
  | "travel"
  | "calendar"
  | "uncategorized";

export type EmailFolderType =
  | "inbox"
  | "sent"
  | "drafts"
  | "trash"
  | "spam"
  | "archive"
  | "starred"
  | "custom";

export type EmailSyncStatus =
  | "idle"
  | "syncing"
  | "error"
  | "paused"
  | "initial";

// ─── Core Data Models ────────────────────────────────────────────────────────

export interface EmailAddress {
  name?: string;
  address: string;
}

export interface EmailAccountConfig {
  // IMAP/SMTP
  imapHost?: string;
  imapPort?: number;
  imapTls?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpTls?: boolean;
  username?: string;

  // TLS — allow self-signed certificates
  allowInsecure?: boolean;

  // OAuth tokens (Gmail / Microsoft)
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number;
  clientId?: string;
  clientSecret?: string;
  tenantId?: string; // Microsoft only

  // Sync
  syncIntervalMs?: number; // default 60000
  cacheDays?: number; // default 30
  maxSyncMessages?: number; // per-folder limit for initial sync
}

export interface EmailAccount {
  id: string;
  provider: EmailProviderType;
  displayName: string;
  email: string;
  config: EmailAccountConfig;
  isDefault: boolean;
  syncCursor?: string;
  lastSyncAt?: number;
  createdAt: number;
}

export interface EmailMessage {
  id: number;
  accountId: string;
  remoteId: string;
  threadId?: string;
  folder: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  subject: string;
  bodyPlain?: string;
  bodyHtml?: string;
  snippet: string;
  date: number;
  isRead: boolean;
  isStarred: boolean;
  hasAttachments: boolean;
  rawHeaders?: Record<string, string>;
  size?: number;
  // AI-enriched fields
  priority?: EmailPriority;
  aiCategory?: EmailCategory;
  aiSummary?: string;
  aiFollowUpDate?: number;
  calendarEvents?: CalendarEvent[];
  createdAt: number;
}

export interface EmailThread {
  threadId: string;
  messages: EmailMessage[];
  subject: string;
  participants: EmailAddress[];
  snippet: string;
  lastDate: number;
  unreadCount: number;
}

export interface EmailFolder {
  id: number;
  accountId: string;
  name: string;
  path: string;
  type: EmailFolderType;
  delimiter: string;
  unreadCount: number;
  totalCount: number;
  lastSyncAt?: number;
}

export interface EmailDraft {
  id?: number;
  accountId: string;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  subject: string;
  body: string;
  bodyHtml?: string;
  inReplyTo?: string;
  parentMessageId?: number;
  aiGenerated: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface EmailAttachment {
  id?: number;
  messageId: number;
  filename: string;
  mimeType: string;
  size: number;
  contentId?: string;
  content?: Buffer;
  storagePath?: string;
}

export interface EmailSearchQuery {
  query?: string;
  folder?: string;
  from?: string;
  to?: string;
  subject?: string;
  dateAfter?: number;
  dateBefore?: number;
  hasAttachment?: boolean;
  isUnread?: boolean;
  aiCategory?: EmailCategory;
  limit?: number;
  offset?: number;
}

// ─── AI Models ───────────────────────────────────────────────────────────────

export interface EmailTriageResult {
  priority: EmailPriority;
  category: EmailCategory;
  suggestedActions: string[];
  followUpDate?: number;
  reason: string;
}

export interface EmailSummary {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
}

export interface DailyDigest {
  date: number;
  totalUnread: number;
  urgent: EmailMessage[];
  actionRequired: EmailMessage[];
  fyis: EmailMessage[];
  newsletters: EmailMessage[];
  summary: string;
  topActionItems: string[];
}

export interface FollowUp {
  messageId: number;
  subject: string;
  commitment: string;
  dueDate?: number;
  parties: EmailAddress[];
  status: "pending" | "overdue" | "completed";
}

export interface CalendarEvent {
  title: string;
  start: number;
  end?: number;
  location?: string;
  description?: string;
  attendees: EmailAddress[];
  isAllDay: boolean;
  organizer?: EmailAddress;
  status?: "confirmed" | "tentative" | "cancelled";
  icsData?: string;
}

// ─── Agent Action Models ─────────────────────────────────────────────────────

export interface EmailAgentAction {
  id?: number;
  accountId: string;
  actionType: EmailAgentActionType;
  targetMessageId?: number;
  payload: Record<string, unknown>;
  trustLevel: EmailTrustLevel;
  status: EmailAgentActionStatus;
  result?: string;
  executedAt?: number;
  createdAt?: number;
}

export interface EmailAgentConfig {
  defaultTrustLevel: EmailTrustLevel;
  actionOverrides: Partial<Record<EmailAgentActionType, EmailTrustLevel>>;
  autoTriageEnabled: boolean;
  autoSummarizeEnabled: boolean;
  followUpTrackingEnabled: boolean;
  dailyDigestEnabled: boolean;
  dailyDigestTime?: string; // "09:00"
}

export const DEFAULT_EMAIL_AGENT_CONFIG: EmailAgentConfig = {
  defaultTrustLevel: "confirm",
  actionOverrides: {},
  autoTriageEnabled: true,
  autoSummarizeEnabled: false,
  followUpTrackingEnabled: true,
  dailyDigestEnabled: true,
  dailyDigestTime: "09:00",
};

// ─── Sync Models ─────────────────────────────────────────────────────────────

export interface EmailSyncEvent {
  accountId: string;
  type: "sync_started" | "sync_completed" | "sync_error" | "new_messages" | "folder_updated";
  data?: {
    folder?: string;
    messagesAdded?: number;
    messagesDeleted?: number;
    error?: string;
  };
  timestamp: number;
}

export interface EmailSyncResult {
  accountId: string;
  syncType: "full" | "incremental" | "folder";
  status: "success" | "partial" | "error";
  messagesAdded: number;
  messagesDeleted: number;
  messagesUpdated: number;
  error?: string;
  durationMs: number;
}

// ─── Provider Interface ──────────────────────────────────────────────────────

export interface IEmailProvider {
  readonly providerId: EmailProviderType;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  listFolders(): Promise<EmailFolder[]>;
  fetchMessages(
    folder: string,
    options?: { limit?: number; offset?: number; since?: Date },
  ): Promise<EmailMessage[]>;
  fetchMessage(remoteId: string, folder: string): Promise<EmailMessage | null>;
  searchMessages(query: EmailSearchQuery): Promise<EmailMessage[]>;

  sendMessage(draft: EmailDraft): Promise<{ messageId: string }>;
  moveMessage(remoteId: string, fromFolder: string, toFolder: string): Promise<void>;
  deleteMessage(remoteId: string, folder: string): Promise<void>;
  markRead(remoteId: string, folder: string, read: boolean): Promise<void>;
  markStarred(remoteId: string, folder: string, starred: boolean): Promise<void>;

  /** Incremental sync — returns new/changed messages since cursor */
  syncChanges(cursor?: string): Promise<{
    messages: EmailMessage[];
    deletedIds: string[];
    newCursor: string;
  }>;

  /** Extract calendar events from a message's iCal attachments */
  getCalendarEvents(remoteId: string, folder: string): Promise<CalendarEvent[]>;
}

// ─── IPC Payloads ────────────────────────────────────────────────────────────

export interface AddEmailAccountPayload {
  provider: EmailProviderType;
  displayName: string;
  email: string;
  config: EmailAccountConfig;
  isDefault?: boolean;
}

// ─── Autonomous Orchestrator ─────────────────────────────────────────────────

export type EmailAutoRuleAction =
  | "archive"
  | "label"
  | "mark_read"
  | "delete"
  | "star";

export interface EmailAutoRule {
  id?: number;
  accountId: string;
  name: string;
  enabled: boolean;
  /** Match condition — any of these can be set */
  condition: {
    aiCategory?: EmailCategory;
    priority?: EmailPriority;
    fromPattern?: string;   // regex or glob
    subjectPattern?: string;
  };
  action: EmailAutoRuleAction;
  actionTarget?: string; // e.g. folder name for "label"/"archive"
  createdAt?: number;
}

export interface EmailOrchestratorStatus {
  running: boolean;
  autoTriageEnabled: boolean;
  autoActionsEnabled: boolean;
  rulesCount: number;
  lastRunAt?: number;
  messagesProcessed: number;
  actionsExecuted: number;
}

export interface EmailComposeRequest {
  instruction: string;
  context?: {
    replyToMessageId?: number;
    threadMessages?: EmailMessage[];
    tone?: "formal" | "casual" | "friendly" | "urgent";
  };
}

export interface EmailToneAdjustRequest {
  draft: EmailDraft;
  tone: "formal" | "casual" | "friendly" | "urgent";
}
