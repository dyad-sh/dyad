/**
 * Google Calendar Provider
 *
 * Uses the Google Calendar API v3 (googleapis) with OAuth2.
 * Supports two auth modes:
 *   1. Standalone OAuth2 (client ID + secret + tokens)
 *   2. Reuse Gmail OAuth tokens from the email hub
 */

import { google, type calendar_v3 } from "googleapis";
import log from "electron-log";
import type {
  CalendarProvider,
  CalendarInfo,
  CalendarEventInput,
  CalendarEventOutput,
  GoogleCalendarConfig,
} from "./calendar_types";

const logger = log.scope("calendar/google");

export class GoogleCalendarProvider implements CalendarProvider {
  private calendar: calendar_v3.Calendar | null = null;
  private connected = false;
  private calendarId: string;

  constructor(private config: GoogleCalendarConfig) {
    this.calendarId = config.calendarId ?? "primary";
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const auth = new google.auth.OAuth2(
      this.config.clientId,
      this.config.clientSecret,
    );
    auth.setCredentials({
      access_token: this.config.accessToken,
      refresh_token: this.config.refreshToken,
      expiry_date: this.config.tokenExpiry,
    });

    // Auto-refresh — persist updated tokens back to config
    auth.on("tokens", (tokens) => {
      if (tokens.access_token) this.config.accessToken = tokens.access_token;
      if (tokens.refresh_token) this.config.refreshToken = tokens.refresh_token;
      if (tokens.expiry_date) this.config.tokenExpiry = tokens.expiry_date;
    });

    this.calendar = google.calendar({ version: "v3", auth });
    this.connected = true;
    logger.info("Connected to Google Calendar API");
  }

  async disconnect(): Promise<void> {
    this.calendar = null;
    this.connected = false;
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    if (!this.calendar) throw new Error("Not connected");
    const res = await this.calendar.calendarList.list();
    return (res.data.items ?? []).map((cal) => ({
      id: cal.id ?? "",
      name: cal.summary ?? cal.id ?? "Untitled",
      description: cal.description ?? undefined,
      color: cal.backgroundColor ?? undefined,
      primary: cal.primary ?? false,
      readOnly: cal.accessRole === "reader" || cal.accessRole === "freeBusyReader",
    }));
  }

  async fetchEvents(startUnix: number, endUnix: number): Promise<CalendarEventOutput[]> {
    if (!this.calendar) throw new Error("Not connected");

    const events: CalendarEventOutput[] = [];
    let pageToken: string | undefined;

    do {
      const res = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: new Date(startUnix * 1000).toISOString(),
        timeMax: new Date(endUnix * 1000).toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
        pageToken,
      });

      for (const item of res.data.items ?? []) {
        events.push(this.mapEvent(item));
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    logger.info(`Fetched ${events.length} events from Google Calendar (${this.calendarId})`);
    return events;
  }

  async createEvent(event: CalendarEventInput): Promise<string> {
    if (!this.calendar) throw new Error("Not connected");
    const res = await this.calendar.events.insert({
      calendarId: this.calendarId,
      requestBody: this.toGoogleEvent(event),
    });
    return res.data.id ?? "";
  }

  async updateEvent(externalId: string, event: Partial<CalendarEventInput>): Promise<void> {
    if (!this.calendar) throw new Error("Not connected");
    await this.calendar.events.patch({
      calendarId: this.calendarId,
      eventId: externalId,
      requestBody: this.toGoogleEvent(event as CalendarEventInput),
    });
  }

  async deleteEvent(externalId: string): Promise<void> {
    if (!this.calendar) throw new Error("Not connected");
    await this.calendar.events.delete({
      calendarId: this.calendarId,
      eventId: externalId,
    });
  }

  /** Get updated config (tokens may have refreshed) */
  getUpdatedConfig(): GoogleCalendarConfig {
    return { ...this.config };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private mapEvent(item: calendar_v3.Schema$Event): CalendarEventOutput {
    const isAllDay = !!item.start?.date;
    const startAt = isAllDay
      ? Math.floor(new Date(item.start!.date!).getTime() / 1000)
      : Math.floor(new Date(item.start?.dateTime ?? "").getTime() / 1000);
    const endAt = isAllDay
      ? Math.floor(new Date(item.end?.date ?? "").getTime() / 1000)
      : item.end?.dateTime
        ? Math.floor(new Date(item.end.dateTime).getTime() / 1000)
        : undefined;

    const statusMap: Record<string, "confirmed" | "tentative" | "cancelled"> = {
      confirmed: "confirmed",
      tentative: "tentative",
      cancelled: "cancelled",
    };

    return {
      externalId: item.id ?? "",
      title: item.summary ?? "Untitled Event",
      description: item.description ?? undefined,
      startAt,
      endAt,
      isAllDay,
      location: item.location ?? undefined,
      status: statusMap[item.status ?? ""] ?? "confirmed",
      recurrenceRule: item.recurrence?.[0] ?? undefined,
      attendees: (item.attendees ?? []).map((a) => ({
        name: a.displayName ?? undefined,
        email: a.email ?? "",
        status: a.responseStatus ?? undefined,
      })),
    };
  }

  private toGoogleEvent(event: CalendarEventInput): calendar_v3.Schema$Event {
    const isAllDay = event.isAllDay ?? false;
    const body: calendar_v3.Schema$Event = {
      summary: event.title,
      description: event.description,
      location: event.location,
      status: event.status ?? "confirmed",
    };

    if (isAllDay) {
      body.start = { date: new Date(event.startAt * 1000).toISOString().split("T")[0] };
      if (event.endAt) {
        body.end = { date: new Date(event.endAt * 1000).toISOString().split("T")[0] };
      } else {
        body.end = body.start;
      }
    } else {
      body.start = { dateTime: new Date(event.startAt * 1000).toISOString() };
      body.end = event.endAt
        ? { dateTime: new Date(event.endAt * 1000).toISOString() }
        : { dateTime: new Date((event.startAt + 3600) * 1000).toISOString() };
    }

    if (event.recurrenceRule) {
      body.recurrence = [event.recurrenceRule];
    }

    if (event.attendees?.length) {
      body.attendees = event.attendees.map((a) => ({
        email: a.email,
        displayName: a.name,
      }));
    }

    return body;
  }
}
