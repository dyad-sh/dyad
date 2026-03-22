import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// =============================================================================
// AI EMAIL AGENT TABLES
// Multi-account email with AI triage, compose, summarize, calendar extraction,
// follow-up tracking, and configurable agent autonomy.
// =============================================================================

/**
 * Email Accounts — multi-provider (IMAP/SMTP, Gmail, Microsoft Graph)
 */
export const emailAccounts = sqliteTable("email_accounts", {
  id: text("id").primaryKey(), // UUID v4
  provider: text("provider", {
    enum: ["imap", "gmail", "microsoft"],
  }).notNull(),
  displayName: text("display_name").notNull(),
  email: text("email").notNull(),
  config: text("config", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull(),
  isDefault: integer("is_default", { mode: "boolean" })
    .notNull()
    .default(false),
  syncCursor: text("sync_cursor"),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Email Messages — locally cached messages with AI enrichment
 */
export const emailMessages = sqliteTable("email_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: text("account_id")
    .notNull()
    .references(() => emailAccounts.id, { onDelete: "cascade" }),
  remoteId: text("remote_id").notNull(),
  threadId: text("thread_id"),
  folder: text("folder").notNull(),
  from: text("from_addr", { mode: "json" })
    .$type<{ name?: string; address: string }>()
    .notNull(),
  to: text("to_addr", { mode: "json" })
    .$type<{ name?: string; address: string }[]>()
    .notNull(),
  cc: text("cc_addr", { mode: "json" })
    .$type<{ name?: string; address: string }[]>()
    .notNull()
    .default(sql`'[]'`),
  bcc: text("bcc_addr", { mode: "json" })
    .$type<{ name?: string; address: string }[]>()
    .notNull()
    .default(sql`'[]'`),
  subject: text("subject").notNull().default(""),
  bodyPlain: text("body_plain"),
  bodyHtml: text("body_html"),
  snippet: text("snippet").notNull().default(""),
  date: integer("date", { mode: "timestamp" }).notNull(),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  isStarred: integer("is_starred", { mode: "boolean" })
    .notNull()
    .default(false),
  hasAttachments: integer("has_attachments", { mode: "boolean" })
    .notNull()
    .default(false),
  rawHeaders: text("raw_headers", { mode: "json" }).$type<
    Record<string, string> | null
  >(),
  size: integer("size"),

  // AI-enriched fields
  priority: text("priority", {
    enum: ["urgent", "high", "normal", "low"],
  }),
  aiCategory: text("ai_category", {
    enum: [
      "action_required",
      "fyi",
      "newsletter",
      "promotional",
      "social",
      "finance",
      "travel",
      "calendar",
      "uncategorized",
    ],
  }),
  aiSummary: text("ai_summary"),
  aiFollowUpDate: integer("ai_follow_up_date", { mode: "timestamp" }),
  calendarEventJson: text("calendar_event_json", { mode: "json" }).$type<
    unknown[] | null
  >(),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Email Drafts — locally saved drafts, including AI-generated ones
 */
export const emailDrafts = sqliteTable("email_drafts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: text("account_id")
    .notNull()
    .references(() => emailAccounts.id, { onDelete: "cascade" }),
  to: text("to_addr", { mode: "json" })
    .$type<{ name?: string; address: string }[]>()
    .notNull()
    .default(sql`'[]'`),
  cc: text("cc_addr", { mode: "json" })
    .$type<{ name?: string; address: string }[]>()
    .notNull()
    .default(sql`'[]'`),
  bcc: text("bcc_addr", { mode: "json" })
    .$type<{ name?: string; address: string }[]>()
    .notNull()
    .default(sql`'[]'`),
  subject: text("subject").notNull().default(""),
  body: text("body").notNull().default(""),
  bodyHtml: text("body_html"),
  inReplyTo: text("in_reply_to"),
  parentMessageId: integer("parent_message_id"),
  aiGenerated: integer("ai_generated", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Email Folders — cached folder structure per account
 */
export const emailFolders = sqliteTable("email_folders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: text("account_id")
    .notNull()
    .references(() => emailAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  path: text("path").notNull(),
  type: text("type", {
    enum: [
      "inbox",
      "sent",
      "drafts",
      "trash",
      "spam",
      "archive",
      "starred",
      "custom",
    ],
  })
    .notNull()
    .default("custom"),
  delimiter: text("delimiter").notNull().default("/"),
  unreadCount: integer("unread_count").notNull().default(0),
  totalCount: integer("total_count").notNull().default(0),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
});

/**
 * Email Attachments — metadata and optional local storage path
 */
export const emailAttachments = sqliteTable("email_attachments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messageId: integer("message_id")
    .notNull()
    .references(() => emailMessages.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull().default(0),
  contentId: text("content_id"),
  storagePath: text("storage_path"),
});

/**
 * Email Agent Actions — configurable autonomy queue
 * Actions with trust "confirm" are created here for user approval;
 * "auto" actions are executed immediately and logged;
 * "never" actions are blocked.
 */
export const emailAgentActions = sqliteTable("email_agent_actions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: text("account_id")
    .notNull()
    .references(() => emailAccounts.id, { onDelete: "cascade" }),
  actionType: text("action_type", {
    enum: [
      "send",
      "reply",
      "forward",
      "archive",
      "label",
      "delete",
      "mark_read",
      "move",
    ],
  }).notNull(),
  targetMessageId: integer("target_message_id"),
  payload: text("payload", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull(),
  trustLevel: text("trust_level", {
    enum: ["auto", "confirm", "never"],
  }).notNull(),
  status: text("status", {
    enum: ["pending", "approved", "executed", "rejected"],
  })
    .notNull()
    .default("pending"),
  result: text("result"),
  executedAt: integer("executed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Email Sync Log — audit trail of sync operations per account
 */
export const emailSyncLog = sqliteTable("email_sync_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: text("account_id")
    .notNull()
    .references(() => emailAccounts.id, { onDelete: "cascade" }),
  syncType: text("sync_type", {
    enum: ["full", "incremental", "folder"],
  }).notNull(),
  status: text("status", {
    enum: ["success", "partial", "error"],
  }).notNull(),
  messagesAdded: integer("messages_added").notNull().default(0),
  messagesDeleted: integer("messages_deleted").notNull().default(0),
  messagesUpdated: integer("messages_updated").notNull().default(0),
  error: text("error"),
  startedAt: integer("started_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});
