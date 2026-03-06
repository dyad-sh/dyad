/**
 * Agent Trigger Type Definitions
 * Types for trigger events (Gmail, Slack, Google Sheets, Webhooks, Schedules)
 * that auto-start agent workflows via n8n.
 */

// ============================================================================
// Core Trigger Types
// ============================================================================

export type TriggerType =
  | "gmail"
  | "slack"
  | "google-sheets"
  | "webhook"
  | "schedule"
  | "calendar"
  | "discord"
  | "telegram"
  | "manual";

export type TriggerStatus = "active" | "paused" | "error" | "draft";

export interface AgentTrigger {
  id: string;
  agentId: number;
  name: string;
  description?: string;
  type: TriggerType;
  config: TriggerConfig;
  status: TriggerStatus;
  n8nWorkflowId?: string;
  lastTriggered?: number;
  triggerCount: number;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// Trigger Configuration (union per type)
// ============================================================================

export type TriggerConfig =
  | GmailTriggerConfig
  | SlackTriggerConfig
  | GoogleSheetsTriggerConfig
  | WebhookTriggerConfig
  | ScheduleTriggerConfig
  | CalendarTriggerConfig
  | DiscordTriggerConfig
  | TelegramTriggerConfig
  | ManualTriggerConfig;

export interface GmailTriggerConfig {
  type: "gmail";
  /** Filter labels (e.g. "INBOX", "STARRED") */
  labels?: string[];
  /** Filter by sender */
  from?: string;
  /** Filter by subject pattern */
  subjectPattern?: string;
  /** Poll interval in seconds */
  pollInterval: number;
  /** Only unread messages */
  unreadOnly: boolean;
  /** OAuth credentials reference */
  credentialId?: string;
}

export interface SlackTriggerConfig {
  type: "slack";
  /** Channel ID or name */
  channel?: string;
  /** Trigger on message events */
  onMessage: boolean;
  /** Trigger on mentions */
  onMention: boolean;
  /** Trigger on reactions */
  onReaction: boolean;
  /** Trigger on slash commands */
  onSlashCommand?: string;
  /** Bot token credential */
  credentialId?: string;
}

export interface GoogleSheetsTriggerConfig {
  type: "google-sheets";
  /** Spreadsheet ID */
  spreadsheetId: string;
  /** Sheet name or index */
  sheetName?: string;
  /** Watch for row additions */
  onRowAdded: boolean;
  /** Watch for cell changes */
  onCellChanged: boolean;
  /** Poll interval in seconds */
  pollInterval: number;
  /** Specific columns to watch */
  watchColumns?: string[];
  /** OAuth credentials reference */
  credentialId?: string;
}

export interface WebhookTriggerConfig {
  type: "webhook";
  /** HTTP method */
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Custom webhook path */
  path?: string;
  /** Authentication type */
  auth?: "none" | "basic" | "header" | "jwt";
  /** Auth credentials */
  authValue?: string;
  /** Response mode */
  responseMode: "immediate" | "lastNode";
}

export interface ScheduleTriggerConfig {
  type: "schedule";
  /** Cron expression */
  cronExpression: string;
  /** Timezone */
  timezone: string;
  /** Human-readable description of schedule */
  scheduleDescription?: string;
}

export interface CalendarTriggerConfig {
  type: "calendar";
  /** Calendar ID */
  calendarId: string;
  /** Minutes before event to trigger */
  minutesBefore: number;
  /** Trigger on event creation */
  onEventCreated: boolean;
  /** Trigger on event update */
  onEventUpdated: boolean;
  /** OAuth credentials reference */
  credentialId?: string;
}

export interface DiscordTriggerConfig {
  type: "discord";
  /** Server (guild) ID */
  guildId?: string;
  /** Channel ID */
  channelId?: string;
  /** Trigger on messages */
  onMessage: boolean;
  /** Trigger on slash commands */
  onSlashCommand?: string;
  /** Bot token credential */
  credentialId?: string;
}

export interface TelegramTriggerConfig {
  type: "telegram";
  /** Trigger on messages */
  onMessage: boolean;
  /** Trigger on commands */
  onCommand?: string;
  /** Bot token credential */
  credentialId?: string;
}

export interface ManualTriggerConfig {
  type: "manual";
}

// ============================================================================
// Trigger Template (pre-built trigger configurations)
// ============================================================================

export interface TriggerTemplate {
  id: string;
  name: string;
  description: string;
  type: TriggerType;
  icon: string;
  category: TriggerCategory;
  defaultConfig: Partial<TriggerConfig>;
  requiredCredentials?: string[];
  n8nNodeType: string;
}

export type TriggerCategory =
  | "email"
  | "messaging"
  | "productivity"
  | "webhook"
  | "schedule"
  | "custom";

// ============================================================================
// IPC Request/Response Types
// ============================================================================

export interface CreateTriggerRequest {
  agentId: number;
  name: string;
  description?: string;
  type: TriggerType;
  config: TriggerConfig;
}

export interface UpdateTriggerRequest {
  id: string;
  name?: string;
  description?: string;
  config?: Partial<TriggerConfig>;
  status?: TriggerStatus;
}

export interface TriggerEvent {
  triggerId: string;
  agentId: number;
  type: TriggerType;
  payload: Record<string, unknown>;
  timestamp: number;
  n8nExecutionId?: string;
}
