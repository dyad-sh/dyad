/**
 * Calendar Sync Service
 *
 * Singleton service running in the main process. Handles periodic background
 * sync of all enabled calendar sources into the local `calendar_events` table.
 *
 * Features:
 *  - Per-source configurable sync interval (1-60 min)
 *  - Upsert with dedup by (externalId + sourceId)
 *  - Emits progress/completion events to renderer via BrowserWindow.webContents
 *  - Agent activity provider is fetched on-demand (no DB caching needed)
 */

import { v4 as uuidv4 } from "uuid";
import { eq, and, sql } from "drizzle-orm";
import log from "electron-log";
import { BrowserWindow } from "electron";

import { getDb } from "@/db";
import { calendarSources, calendarEvents } from "@/db/schema";

import type {
  CalendarProvider,
  CalendarEventOutput,
  CalendarSourceType,
  GoogleCalendarConfig,
  ICalConfig,
  OutlookCalendarConfig,
  CalDAVConfig,
  AgentActivityConfig,
} from "./calendar_types";
import { GoogleCalendarProvider } from "./google_calendar_provider";
import { ICalProvider } from "./ical_provider";
import { OutlookCalendarProvider } from "./outlook_calendar_provider";
import { CalDAVProvider } from "./caldav_provider";
import { AgentActivityProvider } from "./agent_activity_provider";

const logger = log.scope("calendar/sync");

// How far ahead/behind to sync (90 days each way)
const SYNC_RANGE_DAYS = 90;

interface SyncTimer {
  sourceId: string;
  timer: ReturnType<typeof setInterval>;
}

class CalendarSyncService {
  private static instance: CalendarSyncService | null = null;
  private timers: SyncTimer[] = [];
  private running = false;

  static getInstance(): CalendarSyncService {
    if (!CalendarSyncService.instance) {
      CalendarSyncService.instance = new CalendarSyncService();
    }
    return CalendarSyncService.instance;
  }

  /** Start auto-sync for all enabled sources */
  startAutoSync(): void {
    if (this.running) return;
    this.running = true;

    const db = getDb();
    const sources = db
      .select()
      .from(calendarSources)
      .where(eq(calendarSources.enabled, true))
      .all();

    for (const source of sources) {
      if (source.type === "agent") continue; // Agent events are virtual — no sync needed
      this.scheduleSource(source.id, (source.syncIntervalMinutes ?? 15) * 60 * 1000);
    }

    // Do an initial sync for all sources
    this.syncAll().catch((err) => logger.error("Initial sync failed:", err));
    logger.info(`Auto-sync started for ${sources.length} calendar source(s)`);
  }

  /** Stop all auto-sync timers */
  stopAutoSync(): void {
    for (const t of this.timers) {
      clearInterval(t.timer);
    }
    this.timers = [];
    this.running = false;
    logger.info("Auto-sync stopped");
  }

  /** Restart timer for a specific source (e.g. after config change) */
  rescheduleSource(sourceId: string, intervalMs: number): void {
    this.timers = this.timers.filter((t) => {
      if (t.sourceId === sourceId) {
        clearInterval(t.timer);
        return false;
      }
      return true;
    });
    this.scheduleSource(sourceId, intervalMs);
  }

  /** Remove timer for a source (e.g. after deletion) */
  removeSource(sourceId: string): void {
    this.timers = this.timers.filter((t) => {
      if (t.sourceId === sourceId) {
        clearInterval(t.timer);
        return false;
      }
      return true;
    });
  }

  /** Sync all enabled sources */
  async syncAll(): Promise<void> {
    const db = getDb();
    const sources = db
      .select()
      .from(calendarSources)
      .where(eq(calendarSources.enabled, true))
      .all();

    for (const source of sources) {
      if (source.type === "agent") continue;
      try {
        await this.syncSource(source.id);
      } catch (err) {
        logger.error(`Sync failed for source ${source.id}:`, err);
      }
    }
  }

  /** Sync a single source by ID */
  async syncSource(sourceId: string): Promise<{ synced: number; errors: number }> {
    const db = getDb();
    const source = db
      .select()
      .from(calendarSources)
      .where(eq(calendarSources.id, sourceId))
      .get();

    if (!source) throw new Error(`Calendar source not found: ${sourceId}`);

    // Mark as syncing
    db.update(calendarSources)
      .set({ syncStatus: "syncing", syncError: null })
      .where(eq(calendarSources.id, sourceId))
      .run();

    this.broadcast("calendar:sync-progress", { sourceId, status: "syncing" });

    try {
      const provider = this.createProvider(
        source.type as CalendarSourceType,
        (source.configJson ?? {}) as Record<string, unknown>,
        (source.authJson ?? {}) as Record<string, unknown>,
      );

      await provider.connect();

      const now = Math.floor(Date.now() / 1000);
      const startUnix = now - SYNC_RANGE_DAYS * 86400;
      const endUnix = now + SYNC_RANGE_DAYS * 86400;

      const events = await provider.fetchEvents(startUnix, endUnix);
      let synced = 0;
      let errors = 0;

      db.transaction((tx) => {
        for (const event of events) {
          try {
            this.upsertEvent(tx, sourceId, event);
            synced++;
          } catch (err) {
            errors++;
            logger.warn(`Failed to upsert event ${event.externalId}: ${(err as Error).message}`);
          }
        }
      });

      await provider.disconnect();

      // Update source status
      db.update(calendarSources)
        .set({
          syncStatus: "idle",
          syncError: null,
          lastSyncAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(calendarSources.id, sourceId))
        .run();

      // If provider refreshed tokens, persist them
      if (source.type === "google" && provider instanceof GoogleCalendarProvider) {
        const updatedConfig = provider.getUpdatedConfig();
        db.update(calendarSources)
          .set({
            authJson: {
              accessToken: updatedConfig.accessToken,
              refreshToken: updatedConfig.refreshToken,
              tokenExpiry: updatedConfig.tokenExpiry,
            },
          })
          .where(eq(calendarSources.id, sourceId))
          .run();
      }

      this.broadcast("calendar:sync-complete", { sourceId, synced, errors });
      logger.info(`Synced source ${source.name}: ${synced} events, ${errors} errors`);
      return { synced, errors };
    } catch (err) {
      const errorMsg = (err as Error).message;
      db.update(calendarSources)
        .set({ syncStatus: "error", syncError: errorMsg, updatedAt: new Date() })
        .where(eq(calendarSources.id, sourceId))
        .run();

      this.broadcast("calendar:sync-complete", { sourceId, synced: 0, errors: 1, error: errorMsg });
      throw err;
    }
  }

  /** Create a provider instance from source type and config */
  createProvider(
    type: CalendarSourceType,
    config: Record<string, unknown>,
    auth?: Record<string, unknown>,
  ): CalendarProvider {
    switch (type) {
      case "google":
        return new GoogleCalendarProvider({
          clientId: (auth?.clientId as string) ?? (config.clientId as string) ?? "",
          clientSecret: (auth?.clientSecret as string) ?? (config.clientSecret as string) ?? "",
          accessToken: (auth?.accessToken as string) ?? "",
          refreshToken: (auth?.refreshToken as string) ?? "",
          tokenExpiry: (auth?.tokenExpiry as number) ?? undefined,
          calendarId: (config.calendarId as string) ?? "primary",
        });

      case "outlook":
        return new OutlookCalendarProvider({
          clientId: (auth?.clientId as string) ?? (config.clientId as string) ?? "",
          accessToken: (auth?.accessToken as string) ?? "",
          refreshToken: (auth?.refreshToken as string) ?? "",
          tokenExpiry: (auth?.tokenExpiry as number) ?? undefined,
          calendarId: (config.calendarId as string) ?? undefined,
        });

      case "ical":
        return new ICalProvider({
          url: (config.url as string) ?? "",
          username: (config.username as string) ?? undefined,
          password: (config.password as string) ?? undefined,
        });

      case "caldav":
        return new CalDAVProvider({
          serverUrl: (config.serverUrl as string) ?? "",
          username: (auth?.username as string) ?? (config.username as string) ?? "",
          password: (auth?.password as string) ?? (config.password as string) ?? "",
          calendarPath: (config.calendarPath as string) ?? undefined,
        });

      case "agent":
        return new AgentActivityProvider(config as unknown as AgentActivityConfig);

      default:
        throw new Error(`Unknown calendar source type: ${type}`);
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private scheduleSource(sourceId: string, intervalMs: number): void {
    const timer = setInterval(() => {
      this.syncSource(sourceId).catch((err) =>
        logger.error(`Scheduled sync failed for ${sourceId}:`, err),
      );
    }, Math.max(intervalMs, 60_000)); // min 1 minute

    this.timers.push({ sourceId, timer });
  }

  private upsertEvent(
    tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
    sourceId: string,
    event: CalendarEventOutput,
  ): void {
    // Check for existing event by (sourceId, externalId)
    const existing = tx
      .select({ id: calendarEvents.id })
      .from(calendarEvents)
      .where(and(
        eq(calendarEvents.sourceId, sourceId),
        eq(calendarEvents.externalId, event.externalId),
      ))
      .get();

    if (existing) {
      tx.update(calendarEvents)
        .set({
          title: event.title,
          description: event.description,
          startAt: new Date(event.startAt * 1000),
          endAt: event.endAt ? new Date(event.endAt * 1000) : null,
          isAllDay: event.isAllDay,
          location: event.location,
          status: event.status,
          recurrenceRule: event.recurrenceRule,
          attendeesJson: event.attendees ?? null,
          icsData: event.icsData,
          metadataJson: event.metadata ?? null,
          updatedAt: new Date(),
        })
        .where(eq(calendarEvents.id, existing.id))
        .run();
    } else {
      tx.insert(calendarEvents)
        .values({
          id: uuidv4(),
          sourceId,
          externalId: event.externalId,
          title: event.title,
          description: event.description,
          startAt: new Date(event.startAt * 1000),
          endAt: event.endAt ? new Date(event.endAt * 1000) : null,
          isAllDay: event.isAllDay,
          location: event.location,
          status: event.status,
          recurrenceRule: event.recurrenceRule,
          attendeesJson: event.attendees ?? null,
          icsData: event.icsData,
          metadataJson: event.metadata ?? null,
          isReadOnly: true,
        })
        .run();
    }
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.webContents.send(channel, payload);
      } catch {
        // Window may have been destroyed
      }
    }
  }
}

export { CalendarSyncService };
