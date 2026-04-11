/**
 * Agent Activity Provider
 *
 * Generates calendar events from existing JoyCreate agent/bot activity tables:
 *   - openclaw_activity_log  → agent started/completed/failed events
 *   - openclaw_kanban_tasks  → task executions with start/end timestamps
 *   - agent_workspace_executions → execution history with timing
 *   - openclaw_channel_messages → bot posts on Discord/Telegram/Slack/etc.
 *
 * This provider is read-only for historical events (they're virtual, not stored
 * in calendar_events). For future scheduling, it writes real rows.
 */

import { getDb } from "@/db";
import {
  openclawActivityLog,
  openclawKanbanTasks,
  agentWorkspaceExecutions,
  openclawChannelMessages,
} from "@/db/schema";
import { and, gte, lte, eq, desc, inArray } from "drizzle-orm";
import log from "electron-log";
import type {
  CalendarProvider,
  CalendarEventOutput,
  AgentActivityConfig,
} from "./calendar_types";

const logger = log.scope("calendar/agent-activity");

export class AgentActivityProvider implements CalendarProvider {
  private config: AgentActivityConfig;

  constructor(config: AgentActivityConfig) {
    this.config = {
      includeKanbanTasks: true,
      includeChannelMessages: true,
      includeExecutions: true,
      ...config,
    };
  }

  async connect(): Promise<void> {
    // No connection needed — uses local DB
  }

  async disconnect(): Promise<void> {
    // Nothing to tear down
  }

  async fetchEvents(startUnix: number, endUnix: number): Promise<CalendarEventOutput[]> {
    const events: CalendarEventOutput[] = [];

    try {
      events.push(...this.fetchActivityLogEvents(startUnix, endUnix));
    } catch (err) {
      logger.warn(`Failed to fetch activity log events: ${(err as Error).message}`);
    }

    if (this.config.includeKanbanTasks) {
      try {
        events.push(...this.fetchKanbanTaskEvents(startUnix, endUnix));
      } catch (err) {
        logger.warn(`Failed to fetch kanban task events: ${(err as Error).message}`);
      }
    }

    if (this.config.includeExecutions) {
      try {
        events.push(...this.fetchExecutionEvents(startUnix, endUnix));
      } catch (err) {
        logger.warn(`Failed to fetch execution events: ${(err as Error).message}`);
      }
    }

    if (this.config.includeChannelMessages) {
      try {
        events.push(...this.fetchChannelMessageEvents(startUnix, endUnix));
      } catch (err) {
        logger.warn(`Failed to fetch channel message events: ${(err as Error).message}`);
      }
    }

    logger.info(`Generated ${events.length} agent activity events for range`);
    return events;
  }

  // Read-only for historical — no create/update/delete on virtual events

  // ── Internal query methods ────────────────────────────────────────────────

  private fetchActivityLogEvents(startUnix: number, endUnix: number): CalendarEventOutput[] {
    const db = getDb();

    const agentEventTypes = ["agent_started", "agent_completed", "agent_failed"];
    const conditions = [
      gte(openclawActivityLog.createdAt, new Date(startUnix * 1000)),
      lte(openclawActivityLog.createdAt, new Date(endUnix * 1000)),
      inArray(openclawActivityLog.eventType, agentEventTypes),
    ];

    if (this.config.agentIds?.length) {
      conditions.push(inArray(openclawActivityLog.agentId, this.config.agentIds));
    }

    const rows = db
      .select()
      .from(openclawActivityLog)
      .where(and(...conditions))
      .orderBy(desc(openclawActivityLog.createdAt))
      .limit(500)
      .all();

    return rows.map((row) => {
      const createdAt = row.createdAt instanceof Date
        ? Math.floor(row.createdAt.getTime() / 1000)
        : typeof row.createdAt === "number" ? row.createdAt : Math.floor(Date.now() / 1000);

      const durationSec = row.durationMs ? Math.ceil(row.durationMs / 1000) : 60;

      return {
        externalId: `activity_${row.id}`,
        title: `${this.getEventTypeLabel(row.eventType)} — ${row.actorDisplayName ?? row.actor ?? "Agent"}`,
        description: row.content ?? undefined,
        startAt: createdAt,
        endAt: createdAt + durationSec,
        isAllDay: false,
        status: "confirmed" as const,
        metadata: {
          type: "agent_run",
          eventType: row.eventType,
          channel: row.channel,
          provider: row.provider,
          model: row.model,
          tokensUsed: row.tokensUsed,
          durationMs: row.durationMs,
          agentId: row.agentId,
          taskId: row.taskId,
        },
      };
    });
  }

  private fetchKanbanTaskEvents(startUnix: number, endUnix: number): CalendarEventOutput[] {
    const db = getDb();

    const conditions = [
      gte(openclawKanbanTasks.createdAt, new Date(startUnix * 1000)),
      lte(openclawKanbanTasks.createdAt, new Date(endUnix * 1000)),
    ];

    if (this.config.agentIds?.length) {
      conditions.push(inArray(openclawKanbanTasks.agentId, this.config.agentIds));
    }

    const rows = db
      .select()
      .from(openclawKanbanTasks)
      .where(and(...conditions))
      .orderBy(desc(openclawKanbanTasks.createdAt))
      .limit(500)
      .all();

    return rows.map((row) => {
      const createdAt = row.createdAt instanceof Date
        ? Math.floor(row.createdAt.getTime() / 1000)
        : typeof row.createdAt === "number" ? row.createdAt : Math.floor(Date.now() / 1000);

      const startedAt = row.startedAt instanceof Date
        ? Math.floor(row.startedAt.getTime() / 1000)
        : typeof row.startedAt === "number" ? row.startedAt : createdAt;

      const completedAt = row.completedAt instanceof Date
        ? Math.floor(row.completedAt.getTime() / 1000)
        : typeof row.completedAt === "number" ? row.completedAt : undefined;

      const durationSec = row.durationMs ? Math.ceil(row.durationMs / 1000) : 300;

      return {
        externalId: `kanban_${row.id}`,
        title: `Task: ${row.title}`,
        description: row.description ?? undefined,
        startAt: startedAt,
        endAt: completedAt ?? startedAt + durationSec,
        isAllDay: false,
        status: row.status === "cancelled" ? "cancelled" as const : "confirmed" as const,
        metadata: {
          type: "agent_task",
          taskType: row.taskType,
          status: row.status,
          priority: row.priority,
          provider: row.provider,
          model: row.model,
          tokensUsed: row.tokensUsed,
          durationMs: row.durationMs,
          agentId: row.agentId,
          assignee: row.assignee,
        },
      };
    });
  }

  private fetchExecutionEvents(startUnix: number, endUnix: number): CalendarEventOutput[] {
    const db = getDb();

    const rows = db
      .select()
      .from(agentWorkspaceExecutions)
      .where(and(
        gte(agentWorkspaceExecutions.startedAt, new Date(startUnix * 1000).toISOString()),
        lte(agentWorkspaceExecutions.startedAt, new Date(endUnix * 1000).toISOString()),
      ))
      .orderBy(desc(agentWorkspaceExecutions.startedAt))
      .limit(500)
      .all();

    return rows.map((row) => {
      const startAt = Math.floor(new Date(row.startedAt).getTime() / 1000);
      const endAt = row.completedAt
        ? Math.floor(new Date(row.completedAt).getTime() / 1000)
        : startAt + Math.ceil((row.durationMs ?? 60000) / 1000);

      return {
        externalId: `exec_${row.id}`,
        title: `Execution: ${row.taskId}`,
        description: row.error ?? undefined,
        startAt,
        endAt,
        isAllDay: false,
        status: row.status === "failed" ? "cancelled" as const : "confirmed" as const,
        metadata: {
          type: "agent_run",
          executionStatus: row.status,
          durationMs: row.durationMs,
          agentId: row.agentId,
          taskId: row.taskId,
        },
      };
    });
  }

  private fetchChannelMessageEvents(startUnix: number, endUnix: number): CalendarEventOutput[] {
    const db = getDb();

    const rows = db
      .select()
      .from(openclawChannelMessages)
      .where(and(
        gte(openclawChannelMessages.createdAt, new Date(startUnix * 1000)),
        lte(openclawChannelMessages.createdAt, new Date(endUnix * 1000)),
        eq(openclawChannelMessages.isBot, true),
      ))
      .orderBy(desc(openclawChannelMessages.createdAt))
      .limit(500)
      .all();

    return rows.map((row) => {
      const createdAt = row.createdAt instanceof Date
        ? Math.floor(row.createdAt.getTime() / 1000)
        : typeof row.createdAt === "number" ? row.createdAt : Math.floor(Date.now() / 1000);

      return {
        externalId: `msg_${row.id}`,
        title: `Bot Post on ${(row.channel ?? "unknown").charAt(0).toUpperCase() + (row.channel ?? "unknown").slice(1)}`,
        description: row.content?.slice(0, 200) ?? undefined,
        startAt: createdAt,
        endAt: createdAt + 60,
        isAllDay: false,
        status: "confirmed" as const,
        metadata: {
          type: "agent_post",
          channel: row.channel,
          channelName: row.channelName,
          senderName: row.senderName,
          provider: row.provider,
          model: row.model,
          tokensUsed: row.tokensUsed,
        },
      };
    });
  }

  private getEventTypeLabel(eventType: string): string {
    const labels: Record<string, string> = {
      agent_started: "Agent Started",
      agent_completed: "Agent Completed",
      agent_failed: "Agent Failed",
      workflow_triggered: "Workflow Triggered",
      tool_invoked: "Tool Invoked",
    };
    return labels[eventType] ?? eventType;
  }
}
