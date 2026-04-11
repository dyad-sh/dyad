/**
 * Calendar IPC Handlers
 *
 * Source management, event CRUD, sync control, and agent scheduling.
 * Uses CalendarSyncService for background sync and per-provider CRUD.
 */

import { ipcMain } from "electron";
import { v4 as uuidv4 } from "uuid";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import log from "electron-log";

import { getDb } from "@/db";
import { calendarSources, calendarEvents } from "@/db/schema";
import { CalendarSyncService } from "@/lib/calendar/calendar_sync_service";
import type {
  CalendarSourceType,
  CalendarEventInput,
  CalendarInfo,
} from "@/lib/calendar/calendar_types";
import { AgentActivityProvider } from "@/lib/calendar/agent_activity_provider";

const logger = log.scope("calendar");

export function registerCalendarHandlers(): void {
  // ── Source Management ───────────────────────────────────────────────────

  ipcMain.handle("calendar:list-sources", async () => {
    const db = getDb();
    return db.select().from(calendarSources).all();
  });

  ipcMain.handle(
    "calendar:add-source",
    async (
      _,
      params: {
        name: string;
        type: CalendarSourceType;
        color?: string;
        configJson?: Record<string, unknown>;
        authJson?: Record<string, unknown>;
        syncIntervalMinutes?: number;
      },
    ) => {
      if (!params.name || !params.type) {
        throw new Error("Name and type are required");
      }

      const db = getDb();
      const id = uuidv4();

      db.insert(calendarSources)
        .values({
          id,
          name: params.name,
          type: params.type,
          color: params.color ?? "#3b82f6",
          configJson: params.configJson ?? {},
          authJson: params.authJson ?? {},
          syncIntervalMinutes: params.syncIntervalMinutes ?? 15,
        })
        .run();

      // Start sync timer if not agent type
      if (params.type !== "agent") {
        const syncService = CalendarSyncService.getInstance();
        syncService.rescheduleSource(id, (params.syncIntervalMinutes ?? 15) * 60 * 1000);
      }

      return db
        .select()
        .from(calendarSources)
        .where(eq(calendarSources.id, id))
        .get();
    },
  );

  ipcMain.handle(
    "calendar:update-source",
    async (
      _,
      params: {
        id: string;
        name?: string;
        color?: string;
        enabled?: boolean;
        configJson?: Record<string, unknown>;
        authJson?: Record<string, unknown>;
        syncIntervalMinutes?: number;
      },
    ) => {
      if (!params.id) throw new Error("Source ID is required");

      const db = getDb();
      const existing = db
        .select()
        .from(calendarSources)
        .where(eq(calendarSources.id, params.id))
        .get();

      if (!existing) throw new Error(`Calendar source not found: ${params.id}`);

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (params.name !== undefined) updates.name = params.name;
      if (params.color !== undefined) updates.color = params.color;
      if (params.enabled !== undefined) updates.enabled = params.enabled;
      if (params.configJson !== undefined) updates.configJson = params.configJson;
      if (params.authJson !== undefined) updates.authJson = params.authJson;
      if (params.syncIntervalMinutes !== undefined) updates.syncIntervalMinutes = params.syncIntervalMinutes;

      db.update(calendarSources)
        .set(updates)
        .where(eq(calendarSources.id, params.id))
        .run();

      // Reschedule sync timer
      const syncService = CalendarSyncService.getInstance();
      if (params.enabled === false) {
        syncService.removeSource(params.id);
      } else if (existing.type !== "agent") {
        syncService.rescheduleSource(
          params.id,
          ((params.syncIntervalMinutes ?? existing.syncIntervalMinutes ?? 15) * 60 * 1000),
        );
      }

      return db
        .select()
        .from(calendarSources)
        .where(eq(calendarSources.id, params.id))
        .get();
    },
  );

  ipcMain.handle("calendar:remove-source", async (_, params: { id: string }) => {
    if (!params.id) throw new Error("Source ID is required");

    const db = getDb();
    CalendarSyncService.getInstance().removeSource(params.id);

    // cascade delete handled by FK, but delete events explicitly to be safe
    db.delete(calendarEvents)
      .where(eq(calendarEvents.sourceId, params.id))
      .run();

    db.delete(calendarSources)
      .where(eq(calendarSources.id, params.id))
      .run();

    return { deleted: true };
  });

  ipcMain.handle("calendar:test-source", async (_, params: { id: string }) => {
    if (!params.id) throw new Error("Source ID is required");

    const db = getDb();
    const source = db
      .select()
      .from(calendarSources)
      .where(eq(calendarSources.id, params.id))
      .get();

    if (!source) throw new Error(`Calendar source not found: ${params.id}`);

    const provider = CalendarSyncService.getInstance().createProvider(
      source.type as CalendarSourceType,
      (source.configJson ?? {}) as Record<string, unknown>,
      (source.authJson ?? {}) as Record<string, unknown>,
    );

    await provider.connect();
    await provider.disconnect();
    return { success: true };
  });

  // ── Sync ────────────────────────────────────────────────────────────────

  ipcMain.handle("calendar:sync-source", async (_, params: { id: string }) => {
    if (!params.id) throw new Error("Source ID is required");
    return CalendarSyncService.getInstance().syncSource(params.id);
  });

  ipcMain.handle("calendar:sync-all", async () => {
    await CalendarSyncService.getInstance().syncAll();
    return { done: true };
  });

  // ── Calendar Discovery ──────────────────────────────────────────────────

  ipcMain.handle(
    "calendar:list-calendars",
    async (_, params: { sourceId: string }): Promise<CalendarInfo[]> => {
      if (!params.sourceId) throw new Error("Source ID is required");

      const db = getDb();
      const source = db
        .select()
        .from(calendarSources)
        .where(eq(calendarSources.id, params.sourceId))
        .get();

      if (!source) throw new Error(`Calendar source not found: ${params.sourceId}`);

      const provider = CalendarSyncService.getInstance().createProvider(
        source.type as CalendarSourceType,
        (source.configJson ?? {}) as Record<string, unknown>,
        (source.authJson ?? {}) as Record<string, unknown>,
      );

      await provider.connect();
      if (!provider.listCalendars) {
        await provider.disconnect();
        throw new Error("This source type does not support listing calendars");
      }
      const calendars = await provider.listCalendars();
      await provider.disconnect();
      return calendars;
    },
  );

  // ── Events ──────────────────────────────────────────────────────────────

  ipcMain.handle(
    "calendar:list-events",
    async (
      _,
      params: {
        startAt: number; // Unix seconds
        endAt: number;
        sourceIds?: string[];
        types?: string[];
        includeAgentActivity?: boolean;
      },
    ) => {
      if (!params.startAt || !params.endAt) {
        throw new Error("startAt and endAt are required");
      }

      const db = getDb();
      const startDate = new Date(params.startAt * 1000);
      const endDate = new Date(params.endAt * 1000);

      // Build conditions
      const conditions = [
        gte(calendarEvents.startAt, startDate),
        lte(calendarEvents.startAt, endDate),
      ];

      if (params.sourceIds?.length) {
        conditions.push(inArray(calendarEvents.sourceId, params.sourceIds));
      }
      if (params.types?.length) {
        const validTypes = params.types as readonly ("meeting" | "task" | "agent_run" | "agent_post" | "agent_task" | "reminder" | "custom")[];
        conditions.push(inArray(calendarEvents.type, validTypes));
      }

      const dbEvents = db
        .select()
        .from(calendarEvents)
        .where(and(...conditions))
        .all();

      // Optionally merge in virtual agent activity events
      if (params.includeAgentActivity !== false) {
        const agentSources = db
          .select()
          .from(calendarSources)
          .where(and(eq(calendarSources.type, "agent"), eq(calendarSources.enabled, true)))
          .all();

        for (const agentSource of agentSources) {
          try {
            const config = (agentSource.configJson ?? {}) as Record<string, unknown>;
            const provider = new AgentActivityProvider(config as import("@/lib/calendar/calendar_types").AgentActivityConfig);
            await provider.connect();
            const agentEvents = await provider.fetchEvents(params.startAt, params.endAt);
            await provider.disconnect();

            for (const evt of agentEvents) {
              dbEvents.push({
                id: evt.externalId,
                sourceId: agentSource.id,
                externalId: evt.externalId,
                title: evt.title,
                description: evt.description ?? null,
                startAt: new Date(evt.startAt * 1000),
                endAt: evt.endAt ? new Date(evt.endAt * 1000) : null,
                isAllDay: evt.isAllDay,
                location: evt.location ?? null,
                status: evt.status,
                type: ((evt.metadata?.type ?? "agent_run") as "agent_run" | "agent_post" | "agent_task" | "meeting" | "task" | "reminder" | "custom"),
                recurrenceRule: evt.recurrenceRule ?? null,
                attendeesJson: evt.attendees ?? null,
                agentId: (evt.metadata?.agentId as string) ?? null,
                agentName: (evt.metadata?.agentName as string) ?? null,
                metadataJson: evt.metadata ?? null,
                icsData: evt.icsData ?? null,
                isReadOnly: true,
                createdAt: new Date(evt.startAt * 1000),
                updatedAt: new Date(evt.startAt * 1000),
              });
            }
          } catch (err) {
            logger.warn(`Failed to fetch agent events from source ${agentSource.id}:`, err);
          }
        }
      }

      return dbEvents;
    },
  );

  ipcMain.handle("calendar:get-event", async (_, params: { id: string }) => {
    if (!params.id) throw new Error("Event ID is required");

    const db = getDb();
    const event = db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, params.id))
      .get();

    if (!event) throw new Error(`Calendar event not found: ${params.id}`);
    return event;
  });

  ipcMain.handle(
    "calendar:create-event",
    async (
      _,
      params: {
        sourceId: string;
        event: CalendarEventInput;
        type?: string;
        agentId?: string;
        agentName?: string;
      },
    ) => {
      if (!params.sourceId) throw new Error("Source ID is required");
      if (!params.event?.title) throw new Error("Event title is required");

      const db = getDb();
      const source = db
        .select()
        .from(calendarSources)
        .where(eq(calendarSources.id, params.sourceId))
        .get();

      if (!source) throw new Error(`Calendar source not found: ${params.sourceId}`);

      let externalId: string | undefined;

      // Try to create via provider first (for writable sources)
      if (source.type !== "agent") {
        try {
          const provider = CalendarSyncService.getInstance().createProvider(
            source.type as CalendarSourceType,
            (source.configJson ?? {}) as Record<string, unknown>,
            (source.authJson ?? {}) as Record<string, unknown>,
          );
          await provider.connect();
          if (provider.createEvent) {
            externalId = await provider.createEvent(params.event);
          }
          await provider.disconnect();
        } catch (err) {
          logger.warn(`Remote create failed, saving locally only:`, err);
        }
      }

      const id = uuidv4();
      db.insert(calendarEvents)
        .values({
          id,
          sourceId: params.sourceId,
          externalId: externalId ?? id,
          title: params.event.title,
          description: params.event.description,
          startAt: new Date(params.event.startAt * 1000),
          endAt: params.event.endAt ? new Date(params.event.endAt * 1000) : null,
          isAllDay: params.event.isAllDay ?? false,
          location: params.event.location,
          status: params.event.status ?? "confirmed",
          type: (params.type ?? "meeting") as "meeting" | "task" | "agent_run" | "agent_post" | "agent_task" | "reminder" | "custom",
          recurrenceRule: params.event.recurrenceRule,
          attendeesJson: params.event.attendees ?? null,
          agentId: params.agentId,
          agentName: params.agentName,
          isReadOnly: false,
        })
        .run();

      return db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.id, id))
        .get();
    },
  );

  ipcMain.handle(
    "calendar:update-event",
    async (
      _,
      params: {
        id: string;
        updates: Partial<CalendarEventInput>;
        type?: string;
      },
    ) => {
      if (!params.id) throw new Error("Event ID is required");

      const db = getDb();
      const event = db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.id, params.id))
        .get();

      if (!event) throw new Error(`Calendar event not found: ${params.id}`);
      if (event.isReadOnly) throw new Error("Cannot modify a read-only event");

      // Try to update via provider
      const eventSourceId = event.sourceId;
      const source = eventSourceId
        ? db
            .select()
            .from(calendarSources)
            .where(eq(calendarSources.id, eventSourceId))
            .get()
        : null;

      if (source && source.type !== "agent" && event.externalId) {
        try {
          const provider = CalendarSyncService.getInstance().createProvider(
            source.type as CalendarSourceType,
            (source.configJson ?? {}) as Record<string, unknown>,
            (source.authJson ?? {}) as Record<string, unknown>,
          );
          await provider.connect();
          if (provider.updateEvent) {
            await provider.updateEvent(event.externalId, params.updates);
          }
          await provider.disconnect();
        } catch (err) {
          logger.warn(`Remote update failed, updating locally only:`, err);
        }
      }

      const localUpdates: Record<string, unknown> = { updatedAt: new Date() };
      if (params.updates.title !== undefined) localUpdates.title = params.updates.title;
      if (params.updates.description !== undefined) localUpdates.description = params.updates.description;
      if (params.updates.startAt !== undefined) localUpdates.startAt = new Date(params.updates.startAt * 1000);
      if (params.updates.endAt !== undefined) localUpdates.endAt = new Date(params.updates.endAt * 1000);
      if (params.updates.isAllDay !== undefined) localUpdates.isAllDay = params.updates.isAllDay;
      if (params.updates.location !== undefined) localUpdates.location = params.updates.location;
      if (params.updates.status !== undefined) localUpdates.status = params.updates.status;
      if (params.updates.recurrenceRule !== undefined) localUpdates.recurrenceRule = params.updates.recurrenceRule;
      if (params.updates.attendees !== undefined) localUpdates.attendeesJson = params.updates.attendees;
      if (params.type !== undefined) localUpdates.type = params.type;

      db.update(calendarEvents)
        .set(localUpdates)
        .where(eq(calendarEvents.id, params.id))
        .run();

      return db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.id, params.id))
        .get();
    },
  );

  ipcMain.handle("calendar:delete-event", async (_, params: { id: string }) => {
    if (!params.id) throw new Error("Event ID is required");

    const db = getDb();
    const event = db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, params.id))
      .get();

    if (!event) throw new Error(`Calendar event not found: ${params.id}`);
    if (event.isReadOnly) throw new Error("Cannot delete a read-only event");

    // Try to delete via provider
    const deleteSourceId = event.sourceId;
    const source = deleteSourceId
      ? db
          .select()
          .from(calendarSources)
          .where(eq(calendarSources.id, deleteSourceId))
          .get()
      : null;

    if (source && source.type !== "agent" && event.externalId) {
      try {
        const provider = CalendarSyncService.getInstance().createProvider(
          source.type as CalendarSourceType,
          (source.configJson ?? {}) as Record<string, unknown>,
          (source.authJson ?? {}) as Record<string, unknown>,
        );
        await provider.connect();
        if (provider.deleteEvent) {
          await provider.deleteEvent(event.externalId);
        }
        await provider.disconnect();
      } catch (err) {
        logger.warn(`Remote delete failed, deleting locally only:`, err);
      }
    }

    db.delete(calendarEvents)
      .where(eq(calendarEvents.id, params.id))
      .run();

    return { deleted: true };
  });

  // ── Agent Scheduling ────────────────────────────────────────────────────

  ipcMain.handle(
    "calendar:schedule-agent-event",
    async (
      _,
      params: {
        title: string;
        description?: string;
        startAt: number;
        endAt?: number;
        type: "agent_run" | "agent_post" | "agent_task";
        agentId: string;
        agentName: string;
        metadata?: Record<string, unknown>;
      },
    ) => {
      if (!params.title || !params.agentId || !params.startAt) {
        throw new Error("title, agentId, and startAt are required");
      }

      const db = getDb();

      // Find or create an agent source
      let agentSource = db
        .select()
        .from(calendarSources)
        .where(eq(calendarSources.type, "agent"))
        .get();

      if (!agentSource) {
        const sourceId = uuidv4();
        db.insert(calendarSources)
          .values({
            id: sourceId,
            name: "Agent Activity",
            type: "agent",
            color: "#8b5cf6",
            configJson: {},
            authJson: {},
          })
          .run();
        agentSource = db
          .select()
          .from(calendarSources)
          .where(eq(calendarSources.id, sourceId))
          .get()!;
      }

      const id = uuidv4();
      db.insert(calendarEvents)
        .values({
          id,
          sourceId: agentSource.id,
          externalId: id,
          title: params.title,
          description: params.description,
          startAt: new Date(params.startAt * 1000),
          endAt: params.endAt ? new Date(params.endAt * 1000) : null,
          isAllDay: false,
          type: params.type,
          status: "confirmed",
          agentId: params.agentId,
          agentName: params.agentName,
          metadataJson: params.metadata ?? null,
          isReadOnly: false,
        })
        .run();

      return db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.id, id))
        .get();
    },
  );

  ipcMain.handle(
    "calendar:list-agent-events",
    async (
      _,
      params: {
        agentId?: string;
        startAt?: number;
        endAt?: number;
      },
    ) => {
      const db = getDb();
      const conditions = [
        inArray(calendarEvents.type, ["agent_run", "agent_post", "agent_task"]),
      ];

      if (params.agentId) {
        conditions.push(eq(calendarEvents.agentId, params.agentId));
      }
      if (params.startAt) {
        conditions.push(gte(calendarEvents.startAt, new Date(params.startAt * 1000)));
      }
      if (params.endAt) {
        conditions.push(lte(calendarEvents.startAt, new Date(params.endAt * 1000)));
      }

      return db
        .select()
        .from(calendarEvents)
        .where(and(...conditions))
        .all();
    },
  );

  // ── ICS Export ──────────────────────────────────────────────────────────

  ipcMain.handle("calendar:export-ics", async (_, params: { eventId: string }) => {
    if (!params.eventId) throw new Error("Event ID is required");

    const db = getDb();
    const event = db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, params.eventId))
      .get();

    if (!event) throw new Error(`Calendar event not found: ${params.eventId}`);

    // If we already have icsData from sync, return it
    if (event.icsData) return event.icsData;

    // Otherwise generate a minimal ICS
    const dtStart = formatICSDate(event.startAt);
    const dtEnd = event.endAt
      ? formatICSDate(event.endAt)
      : formatICSDate(new Date(event.startAt.getTime() + 3600_000));

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//JoyCreate//Calendar//EN",
      "BEGIN:VEVENT",
      `UID:${event.externalId ?? event.id}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${escapeICS(event.title)}`,
    ];

    if (event.description) lines.push(`DESCRIPTION:${escapeICS(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeICS(event.location)}`);
    if (event.recurrenceRule) lines.push(`RRULE:${event.recurrenceRule}`);
    if (event.status) lines.push(`STATUS:${event.status.toUpperCase()}`);

    lines.push("END:VEVENT", "END:VCALENDAR");
    return lines.join("\r\n");
  });

  logger.info("Calendar handlers registered");
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatICSDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function escapeICS(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}
