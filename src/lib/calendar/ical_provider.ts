/**
 * iCal URL Provider
 *
 * Read-only provider that fetches and parses .ics feeds from any URL.
 * Works with Apple Calendar public feeds, Outlook shared calendars,
 * Google Calendar public URLs, and any standard iCal endpoint.
 *
 * Uses `node-ical` (already installed) for parsing.
 */

import * as ical from "node-ical";
import log from "electron-log";
import type {
  CalendarProvider,
  CalendarEventOutput,
  ICalConfig,
} from "./calendar_types";

const logger = log.scope("calendar/ical");

export class ICalProvider implements CalendarProvider {
  private url: string;
  private username?: string;
  private password?: string;

  constructor(config: ICalConfig) {
    this.url = config.url;
    this.username = config.username;
    this.password = config.password;
  }

  async connect(): Promise<void> {
    // Validate the URL is reachable by doing a small fetch
    try {
      const data = await this.fetchFeed();
      const keys = Object.keys(data).filter(
        (k) => (data[k] as ical.VEvent)?.type === "VEVENT",
      );
      logger.info(`iCal feed connected — ${keys.length} events found at ${this.url}`);
    } catch (err) {
      throw new Error(`Cannot connect to iCal feed: ${(err as Error).message}`);
    }
  }

  async disconnect(): Promise<void> {
    // No persistent connection to tear down
  }

  async fetchEvents(startUnix: number, endUnix: number): Promise<CalendarEventOutput[]> {
    const data = await this.fetchFeed();
    const events: CalendarEventOutput[] = [];

    for (const key of Object.keys(data)) {
      const component = data[key];
      if (!component || (component as ical.VEvent).type !== "VEVENT") continue;

      const vevent = component as ical.VEvent;
      const mapped = this.mapEvent(vevent, key);
      if (!mapped) continue;

      // Filter to requested range
      const eventEnd = mapped.endAt ?? mapped.startAt;
      if (mapped.startAt <= endUnix && eventEnd >= startUnix) {
        events.push(mapped);
      }
    }

    // Handle recurring events via RRULE expansion
    for (const key of Object.keys(data)) {
      const component = data[key];
      if (!component || (component as ical.VEvent).type !== "VEVENT") continue;
      const vevent = component as ical.VEvent;
      if (!vevent.rrule) continue;

      try {
        const occurrences = vevent.rrule.between(
          new Date(startUnix * 1000),
          new Date(endUnix * 1000),
        );
        const duration = vevent.end && vevent.start
          ? (new Date(vevent.end as unknown as string).getTime() - new Date(vevent.start as unknown as string).getTime()) / 1000
          : 3600;

        for (const occ of occurrences) {
          const occStart = Math.floor(occ.getTime() / 1000);
          // Skip if we already have the base event at this time
          if (events.some((e) => e.externalId === key && e.startAt === occStart)) continue;

          events.push({
            externalId: `${key}_${occStart}`,
            title: vevent.summary ?? "Untitled Event",
            description: vevent.description ?? undefined,
            startAt: occStart,
            endAt: occStart + duration,
            isAllDay: false,
            location: vevent.location ?? undefined,
            status: "confirmed",
            recurrenceRule: vevent.rrule.toString(),
          });
        }
      } catch {
        // RRULE expansion can fail on malformed rules — skip silently
      }
    }

    logger.info(`Parsed ${events.length} events from iCal feed`);
    return events;
  }

  // Read-only — no create/update/delete

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async fetchFeed(): Promise<ical.CalendarResponse> {
    const opts: Record<string, unknown> = {};
    if (this.username && this.password) {
      opts.headers = {
        Authorization: `Basic ${Buffer.from(`${this.username}:${this.password}`).toString("base64")}`,
      };
    }
    return ical.async.fromURL(this.url, opts);
  }

  private mapEvent(vevent: ical.VEvent, key: string): CalendarEventOutput | null {
    if (!vevent.start) return null;

    const startDate = new Date(vevent.start as unknown as string);
    const endDate = vevent.end ? new Date(vevent.end as unknown as string) : null;

    // Detect all-day: date-only values have no time component
    const isAllDay = typeof vevent.start === "string"
      ? vevent.start.length <= 10
      : vevent.datetype === "date";

    return {
      externalId: vevent.uid ?? key,
      title: vevent.summary ?? "Untitled Event",
      description: vevent.description ?? undefined,
      startAt: Math.floor(startDate.getTime() / 1000),
      endAt: endDate ? Math.floor(endDate.getTime() / 1000) : undefined,
      isAllDay,
      location: vevent.location ?? undefined,
      status: vevent.status === "TENTATIVE"
        ? "tentative"
        : vevent.status === "CANCELLED"
          ? "cancelled"
          : "confirmed",
      recurrenceRule: vevent.rrule?.toString() ?? undefined,
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
}
