/**
 * OpenClaw Activity Log IPC Handlers
 * Persistent storage for all bot/agent activity so data survives
 * even when JoyCreate is closed while the bot is running.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { v4 as uuidv4 } from "uuid";
import { eq, desc, and, sql, like, inArray, gte, lte } from "drizzle-orm";
import log from "electron-log";

import { getDb } from "@/db";
import {
  openclawActivityLog,
  openclawChannelMessages,
} from "@/db/schema";

const logger = log.scope("openclaw_activity");

// ─── Types ──────────────────────────────────────────────────────────────────

export type ActivityEventType =
  | "message_received"
  | "message_sent"
  | "agent_started"
  | "agent_completed"
  | "agent_failed"
  | "provider_switched"
  | "workflow_triggered"
  | "tool_invoked"
  | "gateway_connected"
  | "gateway_disconnected"
  | "chat_request"
  | "chat_response"
  | "system";

export type ChannelType = "discord" | "telegram" | "slack" | "whatsapp" | "webchat";

export interface LogActivityParams {
  eventType: ActivityEventType;
  channel?: string;
  channelMessageId?: string;
  actor?: string;
  actorDisplayName?: string;
  content?: string;
  contentType?: string;
  provider?: string;
  model?: string;
  agentId?: string;
  taskId?: string;
  workflowId?: string;
  tokensUsed?: number;
  durationMs?: number;
  localProcessed?: boolean;
  direction?: "inbound" | "outbound" | "internal";
  metadataJson?: Record<string, unknown>;
  externalEventId?: string;
}

export interface ActivityFilterParams {
  eventType?: ActivityEventType | ActivityEventType[];
  channel?: ChannelType | ChannelType[];
  actor?: string;
  direction?: "inbound" | "outbound" | "internal";
  search?: string;
  since?: number; // Unix timestamp
  until?: number;
  limit?: number;
  offset?: number;
}

export interface ChannelMessageFilterParams {
  channel?: ChannelType | ChannelType[];
  channelId?: string;
  senderId?: string;
  isBot?: boolean;
  search?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

export interface SaveChannelMessageParams {
  channel: ChannelType;
  channelMessageId?: string;
  channelId?: string;
  channelName?: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  isBot?: boolean;
  content: string;
  contentType?: string;
  attachmentsJson?: Array<{ type: string; url: string; name?: string; size?: number }>;
  replyToMessageId?: string;
  replyToContent?: string;
  botResponseId?: string;
  provider?: string;
  model?: string;
  tokensUsed?: number;
  durationMs?: number;
  platformTimestamp?: number;
}

// ─── Registration ───────────────────────────────────────────────────────────

export function registerOpenClawActivityHandlers(): void {
  // =========================================================================
  // LOG ACTIVITY EVENT
  // =========================================================================

  ipcMain.handle(
    "openclaw:activity:log",
    async (_event: IpcMainInvokeEvent, params: LogActivityParams) => {
      const db = getDb();
      const id = uuidv4();

      // De-duplicate by external event ID
      if (params.externalEventId) {
        const existing = db
          .select({ id: openclawActivityLog.id })
          .from(openclawActivityLog)
          .where(eq(openclawActivityLog.externalEventId, params.externalEventId))
          .get();
        if (existing) return existing;
      }

      db.insert(openclawActivityLog)
        .values({
          id,
          eventType: params.eventType,
          channel: params.channel,
          channelMessageId: params.channelMessageId,
          actor: params.actor ?? "openclaw",
          actorDisplayName: params.actorDisplayName,
          content: params.content,
          contentType: params.contentType ?? "text",
          provider: params.provider,
          model: params.model,
          agentId: params.agentId,
          taskId: params.taskId,
          workflowId: params.workflowId,
          tokensUsed: params.tokensUsed,
          durationMs: params.durationMs,
          localProcessed: params.localProcessed ?? false,
          direction: params.direction ?? "internal",
          metadataJson: params.metadataJson ?? null,
          externalEventId: params.externalEventId,
        })
        .run();

      return { id };
    },
  );

  // =========================================================================
  // LOG BATCH — for syncing historical events from external gateway
  // =========================================================================

  ipcMain.handle(
    "openclaw:activity:log-batch",
    async (_event: IpcMainInvokeEvent, entries: LogActivityParams[]) => {
      const db = getDb();
      let inserted = 0;

      db.transaction((tx) => {
        for (const params of entries) {
          // De-duplicate
          if (params.externalEventId) {
            const existing = tx
              .select({ id: openclawActivityLog.id })
              .from(openclawActivityLog)
              .where(eq(openclawActivityLog.externalEventId, params.externalEventId))
              .get();
            if (existing) continue;
          }

          tx.insert(openclawActivityLog)
            .values({
              id: uuidv4(),
              eventType: params.eventType,
              channel: params.channel,
              channelMessageId: params.channelMessageId,
              actor: params.actor ?? "openclaw",
              actorDisplayName: params.actorDisplayName,
              content: params.content,
              contentType: params.contentType ?? "text",
              provider: params.provider,
              model: params.model,
              agentId: params.agentId,
              taskId: params.taskId,
              workflowId: params.workflowId,
              tokensUsed: params.tokensUsed,
              durationMs: params.durationMs,
              localProcessed: params.localProcessed ?? false,
              direction: params.direction ?? "internal",
              metadataJson: params.metadataJson ?? null,
              externalEventId: params.externalEventId,
            })
            .run();
          inserted++;
        }
      });

      return { inserted };
    },
  );

  // =========================================================================
  // LIST ACTIVITY
  // =========================================================================

  ipcMain.handle(
    "openclaw:activity:list",
    async (_event: IpcMainInvokeEvent, filters?: ActivityFilterParams) => {
      const db = getDb();
      const conditions: any[] = [];

      if (filters?.eventType) {
        if (Array.isArray(filters.eventType)) {
          conditions.push(inArray(openclawActivityLog.eventType, filters.eventType));
        } else {
          conditions.push(eq(openclawActivityLog.eventType, filters.eventType));
        }
      }

      if (filters?.channel) {
        if (Array.isArray(filters.channel)) {
          conditions.push(inArray(openclawActivityLog.channel, filters.channel));
        } else {
          conditions.push(eq(openclawActivityLog.channel, filters.channel));
        }
      }

      if (filters?.actor) {
        conditions.push(like(openclawActivityLog.actor, `%${filters.actor}%`));
      }

      if (filters?.direction) {
        conditions.push(eq(openclawActivityLog.direction, filters.direction));
      }

      if (filters?.search) {
        conditions.push(like(openclawActivityLog.content, `%${filters.search}%`));
      }

      if (filters?.since) {
        conditions.push(gte(openclawActivityLog.createdAt, new Date(filters.since * 1000)));
      }

      if (filters?.until) {
        conditions.push(lte(openclawActivityLog.createdAt, new Date(filters.until * 1000)));
      }

      const limit = filters?.limit ?? 100;
      const offset = filters?.offset ?? 0;

      const rows = db
        .select()
        .from(openclawActivityLog)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(openclawActivityLog.createdAt))
        .limit(limit)
        .offset(offset)
        .all();

      return rows;
    },
  );

  // =========================================================================
  // ACTIVITY STATS / SUMMARY
  // =========================================================================

  ipcMain.handle(
    "openclaw:activity:stats",
    async (_event: IpcMainInvokeEvent, since?: number) => {
      const db = getDb();

      const sinceCondition = since
        ? gte(openclawActivityLog.createdAt, new Date(since * 1000))
        : undefined;

      const totalEvents = db
        .select({ count: sql<number>`count(*)` })
        .from(openclawActivityLog)
        .where(sinceCondition)
        .get()?.count ?? 0;

      const byType = db
        .select({
          eventType: openclawActivityLog.eventType,
          count: sql<number>`count(*)`,
        })
        .from(openclawActivityLog)
        .where(sinceCondition)
        .groupBy(openclawActivityLog.eventType)
        .all();

      const byChannel = db
        .select({
          channel: openclawActivityLog.channel,
          count: sql<number>`count(*)`,
        })
        .from(openclawActivityLog)
        .where(sinceCondition)
        .groupBy(openclawActivityLog.channel)
        .all();

      const totalTokens = db
        .select({ total: sql<number>`coalesce(sum(${openclawActivityLog.tokensUsed}), 0)` })
        .from(openclawActivityLog)
        .where(sinceCondition)
        .get()?.total ?? 0;

      const totalMessages = db
        .select({ count: sql<number>`count(*)` })
        .from(openclawChannelMessages)
        .get()?.count ?? 0;

      return {
        totalEvents,
        byType: Object.fromEntries(byType.map((r) => [r.eventType, r.count])),
        byChannel: Object.fromEntries(byChannel.filter((r) => r.channel).map((r) => [r.channel, r.count])),
        totalTokens,
        totalMessages,
      };
    },
  );

  // =========================================================================
  // SAVE CHANNEL MESSAGE
  // =========================================================================

  ipcMain.handle(
    "openclaw:activity:message:save",
    async (_event: IpcMainInvokeEvent, params: SaveChannelMessageParams) => {
      const db = getDb();
      const id = uuidv4();

      // De-duplicate by platform message ID
      if (params.channelMessageId) {
        const existing = db
          .select({ id: openclawChannelMessages.id })
          .from(openclawChannelMessages)
          .where(
            and(
              eq(openclawChannelMessages.channel, params.channel),
              eq(openclawChannelMessages.channelMessageId, params.channelMessageId),
            ),
          )
          .get();
        if (existing) return existing;
      }

      db.insert(openclawChannelMessages)
        .values({
          id,
          channel: params.channel,
          channelMessageId: params.channelMessageId,
          channelId: params.channelId,
          channelName: params.channelName,
          senderId: params.senderId,
          senderName: params.senderName,
          senderAvatar: params.senderAvatar,
          isBot: params.isBot ?? false,
          content: params.content,
          contentType: params.contentType ?? "text",
          attachmentsJson: params.attachmentsJson ?? null,
          replyToMessageId: params.replyToMessageId,
          replyToContent: params.replyToContent,
          botResponseId: params.botResponseId,
          provider: params.provider,
          model: params.model,
          tokensUsed: params.tokensUsed,
          durationMs: params.durationMs,
          platformTimestamp: params.platformTimestamp
            ? new Date(params.platformTimestamp)
            : undefined,
        })
        .run();

      return { id };
    },
  );

  // =========================================================================
  // LIST CHANNEL MESSAGES
  // =========================================================================

  ipcMain.handle(
    "openclaw:activity:messages:list",
    async (_event: IpcMainInvokeEvent, filters?: ChannelMessageFilterParams) => {
      const db = getDb();
      const conditions: any[] = [];

      if (filters?.channel) {
        if (Array.isArray(filters.channel)) {
          conditions.push(inArray(openclawChannelMessages.channel, filters.channel));
        } else {
          conditions.push(eq(openclawChannelMessages.channel, filters.channel));
        }
      }

      if (filters?.channelId) {
        conditions.push(eq(openclawChannelMessages.channelId, filters.channelId));
      }

      if (filters?.senderId) {
        conditions.push(eq(openclawChannelMessages.senderId, filters.senderId));
      }

      if (filters?.isBot !== undefined) {
        conditions.push(eq(openclawChannelMessages.isBot, filters.isBot));
      }

      if (filters?.search) {
        conditions.push(like(openclawChannelMessages.content, `%${filters.search}%`));
      }

      if (filters?.since) {
        conditions.push(gte(openclawChannelMessages.createdAt, new Date(filters.since * 1000)));
      }

      if (filters?.until) {
        conditions.push(lte(openclawChannelMessages.createdAt, new Date(filters.until * 1000)));
      }

      const limit = filters?.limit ?? 100;
      const offset = filters?.offset ?? 0;

      const rows = db
        .select()
        .from(openclawChannelMessages)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(openclawChannelMessages.createdAt))
        .limit(limit)
        .offset(offset)
        .all();

      return rows;
    },
  );

  logger.info("OpenClaw activity handlers registered");
}
