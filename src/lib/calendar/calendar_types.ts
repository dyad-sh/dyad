/**
 * Calendar Provider System — Shared types and provider interface.
 *
 * Every external calendar source (Google, Outlook, iCal, CalDAV) and the
 * internal agent-activity virtual source implement this interface so they
 * can be consumed uniformly by the sync service and IPC handlers.
 */

// ── Provider Config Union ────────────────────────────────────────────────────

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number;
  calendarId?: string; // defaults to "primary"
  /** If true, reuse credentials from the Gmail email provider */
  reuseGmailAuth?: boolean;
}

export interface OutlookCalendarConfig {
  clientId: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number;
  calendarId?: string;
}

export interface ICalConfig {
  url: string; // .ics feed URL
  /** Optional basic-auth username */
  username?: string;
  /** Optional basic-auth password */
  password?: string;
}

export interface CalDAVConfig {
  serverUrl: string;
  username: string;
  password: string;
  calendarPath?: string; // e.g. "/remote.php/dav/calendars/user/personal/"
}

export interface AgentActivityConfig {
  /** Which agent IDs to include. Empty = all agents */
  agentIds?: string[];
  /** Include kanban task events */
  includeKanbanTasks?: boolean;
  /** Include channel messages (bot posts) */
  includeChannelMessages?: boolean;
  /** Include workspace executions */
  includeExecutions?: boolean;
}

export type CalendarSourceConfig =
  | GoogleCalendarConfig
  | OutlookCalendarConfig
  | ICalConfig
  | CalDAVConfig
  | AgentActivityConfig;

// ── Calendar List (for providers that host multiple calendars) ────────────────

export interface CalendarInfo {
  id: string;
  name: string;
  description?: string;
  color?: string;
  primary?: boolean;
  readOnly?: boolean;
}

// ── Normalized Event ─────────────────────────────────────────────────────────

export interface CalendarEventInput {
  title: string;
  description?: string;
  startAt: number; // Unix timestamp (seconds)
  endAt?: number;
  isAllDay?: boolean;
  location?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  recurrenceRule?: string; // RRULE
  attendees?: Array<{ name?: string; email: string }>;
}

export interface CalendarEventOutput {
  externalId: string;
  title: string;
  description?: string;
  startAt: number;
  endAt?: number;
  isAllDay: boolean;
  location?: string;
  status: "confirmed" | "tentative" | "cancelled";
  recurrenceRule?: string;
  attendees?: Array<{ name?: string; email: string; status?: string }>;
  icsData?: string;
  metadata?: Record<string, unknown>;
}

// ── Provider Interface ───────────────────────────────────────────────────────

export interface CalendarProvider {
  /** Test connection / auth validity */
  connect(): Promise<void>;

  /** Tear down any open connections */
  disconnect(): Promise<void>;

  /** List all calendars the user has access to (Google/Outlook/CalDAV) */
  listCalendars?(): Promise<CalendarInfo[]>;

  /**
   * Fetch events in a date range.
   * @param startUnix  Start of range (Unix seconds)
   * @param endUnix    End of range (Unix seconds)
   */
  fetchEvents(startUnix: number, endUnix: number): Promise<CalendarEventOutput[]>;

  /**
   * Create a new event. Only supported for writable providers.
   * @returns The provider's external ID for the created event
   */
  createEvent?(event: CalendarEventInput): Promise<string>;

  /**
   * Update an existing event by its external ID.
   */
  updateEvent?(externalId: string, event: Partial<CalendarEventInput>): Promise<void>;

  /**
   * Delete an event by its external ID.
   */
  deleteEvent?(externalId: string): Promise<void>;
}

// ── Source Type Union (mirrors DB enum) ──────────────────────────────────────

export type CalendarSourceType = "google" | "outlook" | "ical" | "caldav" | "agent";
