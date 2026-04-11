/**
 * Outlook / Office 365 Calendar Provider
 *
 * Uses Microsoft Graph API (already available via @microsoft/microsoft-graph-client)
 * to read, create, update, and delete calendar events from Outlook / Office 365.
 *
 * Follows the same auth pattern as src/lib/email/microsoft_provider.ts.
 */

import { Client } from "@microsoft/microsoft-graph-client";
import log from "electron-log";
import type {
  CalendarProvider,
  CalendarInfo,
  CalendarEventInput,
  CalendarEventOutput,
  OutlookCalendarConfig,
} from "./calendar_types";

const logger = log.scope("calendar/outlook");

interface GraphEvent {
  id?: string;
  subject?: string;
  body?: { content?: string; contentType?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isAllDay?: boolean;
  location?: { displayName?: string };
  showAs?: string;
  isCancelled?: boolean;
  recurrence?: { pattern?: Record<string, unknown>; range?: Record<string, unknown> };
  attendees?: Array<{
    emailAddress?: { name?: string; address?: string };
    status?: { response?: string };
  }>;
}

interface GraphCalendar {
  id?: string;
  name?: string;
  color?: string;
  isDefaultCalendar?: boolean;
  canEdit?: boolean;
}

export class OutlookCalendarProvider implements CalendarProvider {
  private client: Client | null = null;
  private connected = false;
  private calendarId: string | undefined;

  constructor(private config: OutlookCalendarConfig) {
    this.calendarId = config.calendarId;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.client = Client.init({
      authProvider: (done) => {
        done(null, this.config.accessToken ?? "");
      },
    });

    // Verify connection
    try {
      await this.client.api("/me").get();
    } catch (err) {
      throw new Error(`Outlook Calendar auth failed: ${(err as Error).message}`);
    }

    this.connected = true;
    logger.info("Connected to Outlook Calendar via Microsoft Graph");
  }

  async disconnect(): Promise<void> {
    this.client = null;
    this.connected = false;
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    if (!this.client) throw new Error("Not connected");
    const res = await this.client.api("/me/calendars").get();
    return ((res.value ?? []) as GraphCalendar[]).map((cal) => ({
      id: cal.id ?? "",
      name: cal.name ?? "Untitled",
      color: cal.color ?? undefined,
      primary: cal.isDefaultCalendar ?? false,
      readOnly: !(cal.canEdit ?? true),
    }));
  }

  async fetchEvents(startUnix: number, endUnix: number): Promise<CalendarEventOutput[]> {
    if (!this.client) throw new Error("Not connected");

    const startISO = new Date(startUnix * 1000).toISOString();
    const endISO = new Date(endUnix * 1000).toISOString();

    const basePath = this.calendarId
      ? `/me/calendars/${this.calendarId}/calendarView`
      : "/me/calendarView";

    const events: CalendarEventOutput[] = [];
    let url: string | null = `${basePath}?startDateTime=${startISO}&endDateTime=${endISO}&$top=100&$orderby=start/dateTime`;

    while (url) {
      const res = await this.client.api(url).get();
      for (const item of (res.value ?? []) as GraphEvent[]) {
        events.push(this.mapEvent(item));
      }
      url = res["@odata.nextLink"] ?? null;
    }

    logger.info(`Fetched ${events.length} events from Outlook Calendar`);
    return events;
  }

  async createEvent(event: CalendarEventInput): Promise<string> {
    if (!this.client) throw new Error("Not connected");
    const basePath = this.calendarId
      ? `/me/calendars/${this.calendarId}/events`
      : "/me/events";

    const res = await this.client.api(basePath).post(this.toGraphEvent(event));
    return res.id ?? "";
  }

  async updateEvent(externalId: string, event: Partial<CalendarEventInput>): Promise<void> {
    if (!this.client) throw new Error("Not connected");
    await this.client.api(`/me/events/${externalId}`).patch(this.toGraphEvent(event as CalendarEventInput));
  }

  async deleteEvent(externalId: string): Promise<void> {
    if (!this.client) throw new Error("Not connected");
    await this.client.api(`/me/events/${externalId}`).delete();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private mapEvent(item: GraphEvent): CalendarEventOutput {
    const isAllDay = item.isAllDay ?? false;
    const startAt = item.start?.dateTime
      ? Math.floor(new Date(item.start.dateTime + "Z").getTime() / 1000)
      : 0;
    const endAt = item.end?.dateTime
      ? Math.floor(new Date(item.end.dateTime + "Z").getTime() / 1000)
      : undefined;

    return {
      externalId: item.id ?? "",
      title: item.subject ?? "Untitled Event",
      description: item.body?.contentType === "text" ? item.body.content ?? undefined : undefined,
      startAt,
      endAt,
      isAllDay,
      location: item.location?.displayName ?? undefined,
      status: item.isCancelled ? "cancelled" : "confirmed",
      attendees: (item.attendees ?? []).map((a) => ({
        name: a.emailAddress?.name ?? undefined,
        email: a.emailAddress?.address ?? "",
        status: a.status?.response ?? undefined,
      })),
    };
  }

  private toGraphEvent(event: CalendarEventInput): Record<string, unknown> {
    const isAllDay = event.isAllDay ?? false;
    const body: Record<string, unknown> = {
      subject: event.title,
    };

    if (event.description) {
      body.body = { contentType: "text", content: event.description };
    }
    if (event.location) {
      body.location = { displayName: event.location };
    }

    if (isAllDay) {
      body.isAllDay = true;
      body.start = { dateTime: new Date(event.startAt * 1000).toISOString().split("T")[0], timeZone: "UTC" };
      body.end = event.endAt
        ? { dateTime: new Date(event.endAt * 1000).toISOString().split("T")[0], timeZone: "UTC" }
        : body.start;
    } else {
      body.start = { dateTime: new Date(event.startAt * 1000).toISOString(), timeZone: "UTC" };
      body.end = event.endAt
        ? { dateTime: new Date(event.endAt * 1000).toISOString(), timeZone: "UTC" }
        : { dateTime: new Date((event.startAt + 3600) * 1000).toISOString(), timeZone: "UTC" };
    }

    if (event.attendees?.length) {
      body.attendees = event.attendees.map((a) => ({
        emailAddress: { name: a.name, address: a.email },
        type: "required",
      }));
    }

    return body;
  }
}
