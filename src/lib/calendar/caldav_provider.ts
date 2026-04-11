/**
 * CalDAV Calendar Provider
 *
 * Connects to CalDAV servers (Nextcloud, Radicale, Baikal, iCloud, etc.)
 * using the `tsdav` library. Supports read/write operations on calendar events.
 */

import { createDAVClient, type DAVClient, type DAVCalendar, type DAVObject } from "tsdav";
import * as ical from "node-ical";
import log from "electron-log";
import type {
  CalendarProvider,
  CalendarInfo,
  CalendarEventInput,
  CalendarEventOutput,
  CalDAVConfig,
} from "./calendar_types";

const logger = log.scope("calendar/caldav");

export class CalDAVProvider implements CalendarProvider {
  private client: DAVClient | null = null;
  private calendar: DAVCalendar | null = null;
  private connected = false;

  constructor(private config: CalDAVConfig) {}

  async connect(): Promise<void> {
    if (this.connected) return;

    this.client = await createDAVClient({
      serverUrl: this.config.serverUrl,
      credentials: {
        username: this.config.username,
        password: this.config.password,
      },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });

    // If a specific calendar path is configured, find it
    if (this.config.calendarPath) {
      const calendars = await this.client.fetchCalendars();
      this.calendar = calendars.find((c) => c.url === this.config.calendarPath) ?? calendars[0] ?? null;
    }

    this.connected = true;
    logger.info(`Connected to CalDAV server: ${this.config.serverUrl}`);
  }

  async disconnect(): Promise<void> {
    this.client = null;
    this.calendar = null;
    this.connected = false;
  }

  async listCalendars(): Promise<CalendarInfo[]> {
    if (!this.client) throw new Error("Not connected");
    const calendars = await this.client.fetchCalendars();
    return calendars.map((cal) => ({
      id: cal.url,
      name: cal.displayName ?? cal.url,
      description: cal.description ?? undefined,
      readOnly: false,
    }));
  }

  async fetchEvents(startUnix: number, endUnix: number): Promise<CalendarEventOutput[]> {
    if (!this.client) throw new Error("Not connected");

    const calendars = this.calendar ? [this.calendar] : await this.client.fetchCalendars();
    const events: CalendarEventOutput[] = [];

    for (const cal of calendars) {
      const objects = await this.client.fetchCalendarObjects({
        calendar: cal,
        timeRange: {
          start: new Date(startUnix * 1000).toISOString(),
          end: new Date(endUnix * 1000).toISOString(),
        },
      });

      for (const obj of objects) {
        const parsed = this.parseCalendarObject(obj);
        if (parsed) events.push(parsed);
      }
    }

    logger.info(`Fetched ${events.length} events from CalDAV server`);
    return events;
  }

  async createEvent(event: CalendarEventInput): Promise<string> {
    if (!this.client) throw new Error("Not connected");
    const cal = this.calendar ?? (await this.client.fetchCalendars())[0];
    if (!cal) throw new Error("No calendar available");

    const uid = crypto.randomUUID();
    const icsContent = this.buildICS(uid, event);

    await this.client.createCalendarObject({
      calendar: cal,
      filename: `${uid}.ics`,
      iCalString: icsContent,
    });

    return uid;
  }

  async updateEvent(externalId: string, event: Partial<CalendarEventInput>): Promise<void> {
    if (!this.client) throw new Error("Not connected");
    const cal = this.calendar ?? (await this.client.fetchCalendars())[0];
    if (!cal) throw new Error("No calendar available");

    const objects = await this.client.fetchCalendarObjects({ calendar: cal });
    const target = objects.find((o) => this.getUidFromObject(o) === externalId);
    if (!target) throw new Error(`Calendar event not found: ${externalId}`);

    const icsContent = this.buildICS(externalId, event as CalendarEventInput);
    await this.client.updateCalendarObject({
      calendarObject: {
        ...target,
        data: icsContent,
      },
    });
  }

  async deleteEvent(externalId: string): Promise<void> {
    if (!this.client) throw new Error("Not connected");
    const cal = this.calendar ?? (await this.client.fetchCalendars())[0];
    if (!cal) throw new Error("No calendar available");

    const objects = await this.client.fetchCalendarObjects({ calendar: cal });
    const target = objects.find((o) => this.getUidFromObject(o) === externalId);
    if (!target) throw new Error(`Calendar event not found: ${externalId}`);

    await this.client.deleteCalendarObject({ calendarObject: target });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private parseCalendarObject(obj: DAVObject): CalendarEventOutput | null {
    if (!obj.data) return null;

    try {
      const parsed = ical.parseICS(obj.data);
      for (const key of Object.keys(parsed)) {
        const component = parsed[key];
        if (!component || (component as ical.VEvent).type !== "VEVENT") continue;

        const vevent = component as ical.VEvent;
        if (!vevent.start) continue;

        const startDate = new Date(vevent.start as unknown as string);
        const endDate = vevent.end ? new Date(vevent.end as unknown as string) : null;
        const isAllDay = (vevent as unknown as Record<string, unknown>).datetype === "date";

        return {
          externalId: vevent.uid ?? key,
          title: vevent.summary ?? "Untitled Event",
          description: vevent.description ?? undefined,
          startAt: Math.floor(startDate.getTime() / 1000),
          endAt: endDate ? Math.floor(endDate.getTime() / 1000) : undefined,
          isAllDay,
          location: vevent.location ?? undefined,
          status: vevent.status === "TENTATIVE" ? "tentative"
            : vevent.status === "CANCELLED" ? "cancelled"
              : "confirmed",
          recurrenceRule: vevent.rrule?.toString() ?? undefined,
          icsData: obj.data,
          attendees: (vevent.attendee
            ? (Array.isArray(vevent.attendee) ? vevent.attendee : [vevent.attendee])
            : []
          ).map((a) => {
            if (typeof a === "string") return { email: a };
            return {
              name: a.params?.CN ?? undefined,
              email: (a.val ?? "").replace("mailto:", ""),
            };
          }),
        };
      }
    } catch (err) {
      logger.warn(`Failed to parse CalDAV object: ${(err as Error).message}`);
    }
    return null;
  }

  private getUidFromObject(obj: DAVObject): string | null {
    if (!obj.data) return null;
    const match = obj.data.match(/UID:(.+)/);
    return match?.[1]?.trim() ?? null;
  }

  private buildICS(uid: string, event: CalendarEventInput): string {
    const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const dtStart = event.isAllDay
      ? new Date(event.startAt * 1000).toISOString().split("T")[0].replace(/-/g, "")
      : new Date(event.startAt * 1000).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const dtEnd = event.endAt
      ? (event.isAllDay
        ? new Date(event.endAt * 1000).toISOString().split("T")[0].replace(/-/g, "")
        : new Date(event.endAt * 1000).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z")
      : (event.isAllDay ? dtStart : new Date((event.startAt + 3600) * 1000).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z");

    let ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//JoyCreate//Calendar//EN\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:${now}\r\nDTSTART${event.isAllDay ? ";VALUE=DATE" : ""}:${dtStart}\r\nDTEND${event.isAllDay ? ";VALUE=DATE" : ""}:${dtEnd}\r\nSUMMARY:${this.escapeICS(event.title)}\r\n`;

    if (event.description) ics += `DESCRIPTION:${this.escapeICS(event.description)}\r\n`;
    if (event.location) ics += `LOCATION:${this.escapeICS(event.location)}\r\n`;
    if (event.status) ics += `STATUS:${event.status.toUpperCase()}\r\n`;
    if (event.recurrenceRule) ics += `${event.recurrenceRule}\r\n`;

    ics += "END:VEVENT\r\nEND:VCALENDAR\r\n";
    return ics;
  }

  private escapeICS(text: string): string {
    return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  }
}
