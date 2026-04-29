/**
 * Collaboration Hub IPC Handlers
 *
 * Operational comms substrate between agents — channels, DMs, subscriptions,
 * and structured handoff tasks. Distinct from the commercial a2a_* tables
 * (quotes/contracts/payments) and from agent_workspace_tasks (single-agent).
 *
 * Channels (collab:*):
 *   - collab:channel:list / create / update / archive / get
 *   - collab:subscription:join / leave / list-for-agent / list-for-channel
 *   - collab:message:post / list
 *   - collab:task:create / update-status / list
 *   - collab:activity:recent  (flattened messages + task status changes)
 */

import { ipcMain } from "electron";
import log from "electron-log";
import { and, asc, desc, eq, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  agentCollabChannels,
  agentCollabMessages,
  agentCollabSubscriptions,
  agentCollabTasks,
} from "@/db/schema";

const logger = log.scope("collab_hub_handlers");

// =============================================================================
// Types (renderer/handler shared shapes)
// =============================================================================

export type CollabChannelVisibility = "public" | "private";
export type CollabMessageKind = "chat" | "handoff" | "result" | "system" | "mention";
export type CollabTaskStatus =
  | "pending"
  | "accepted"
  | "in_progress"
  | "done"
  | "rejected"
  | "cancelled";
export type CollabTaskPriority = "low" | "normal" | "high" | "urgent";

export interface CollabChannel {
  id: number;
  name: string;
  description: string | null;
  topic: string | null;
  visibility: CollabChannelVisibility;
  createdByAgentId: number | null;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CollabMessage {
  id: number;
  channelId: number | null;
  fromAgentId: number | null;
  toAgentId: number | null;
  kind: CollabMessageKind;
  content: string;
  metadata: Record<string, unknown> | null;
  replyToId: number | null;
  taskId: number | null;
  createdAt: number;
}

export interface CollabSubscription {
  id: number;
  agentId: number;
  channelId: number;
  muted: boolean;
  joinedAt: number;
}

export interface CollabTask {
  id: number;
  fromAgentId: number;
  toAgentId: number;
  channelId: number | null;
  title: string;
  description: string | null;
  status: CollabTaskStatus;
  priority: CollabTaskPriority;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  dueAt: number | null;
  acceptedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type CollabActivityItem =
  | {
      kind: "message";
      at: number;
      message: CollabMessage;
    }
  | {
      kind: "task";
      at: number;
      task: CollabTask;
      event: "created" | "updated";
    };

// =============================================================================
// Helpers
// =============================================================================

function toUnix(value: unknown): number {
  if (value == null) return 0;
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
  }
  return 0;
}

function toUnixOrNull(value: unknown): number | null {
  if (value == null) return null;
  return toUnix(value);
}

function mapChannel(row: typeof agentCollabChannels.$inferSelect): CollabChannel {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    topic: row.topic ?? null,
    visibility: (row.visibility ?? "public") as CollabChannelVisibility,
    createdByAgentId: row.createdByAgentId ?? null,
    archived: Boolean(row.archived),
    createdAt: toUnix(row.createdAt),
    updatedAt: toUnix(row.updatedAt),
  };
}

function mapMessage(row: typeof agentCollabMessages.$inferSelect): CollabMessage {
  return {
    id: row.id,
    channelId: row.channelId ?? null,
    fromAgentId: row.fromAgentId ?? null,
    toAgentId: row.toAgentId ?? null,
    kind: (row.kind ?? "chat") as CollabMessageKind,
    content: row.content,
    metadata: (row.metadataJson ?? null) as Record<string, unknown> | null,
    replyToId: row.replyToId ?? null,
    taskId: row.taskId ?? null,
    createdAt: toUnix(row.createdAt),
  };
}

function mapSubscription(
  row: typeof agentCollabSubscriptions.$inferSelect,
): CollabSubscription {
  return {
    id: row.id,
    agentId: row.agentId,
    channelId: row.channelId,
    muted: Boolean(row.muted),
    joinedAt: toUnix(row.joinedAt),
  };
}

function mapTask(row: typeof agentCollabTasks.$inferSelect): CollabTask {
  return {
    id: row.id,
    fromAgentId: row.fromAgentId,
    toAgentId: row.toAgentId,
    channelId: row.channelId ?? null,
    title: row.title,
    description: row.description ?? null,
    status: (row.status ?? "pending") as CollabTaskStatus,
    priority: (row.priority ?? "normal") as CollabTaskPriority,
    input: (row.inputJson ?? null) as Record<string, unknown> | null,
    output: (row.outputJson ?? null) as Record<string, unknown> | null,
    dueAt: toUnixOrNull(row.dueAt),
    acceptedAt: toUnixOrNull(row.acceptedAt),
    completedAt: toUnixOrNull(row.completedAt),
    createdAt: toUnix(row.createdAt),
    updatedAt: toUnix(row.updatedAt),
  };
}

// =============================================================================
// Registration
// =============================================================================

export function registerCollaborationHubHandlers(): void {
  logger.info("Registering Collaboration Hub IPC handlers");

  // ---------------------------------------------------------------------------
  // Channels
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "collab:channel:list",
    async (_event, params?: { includeArchived?: boolean }): Promise<CollabChannel[]> => {
      const includeArchived = params?.includeArchived === true;
      const rows = includeArchived
        ? await db.select().from(agentCollabChannels).orderBy(asc(agentCollabChannels.name))
        : await db
            .select()
            .from(agentCollabChannels)
            .where(eq(agentCollabChannels.archived, false))
            .orderBy(asc(agentCollabChannels.name));
      return rows.map(mapChannel);
    },
  );

  ipcMain.handle(
    "collab:channel:get",
    async (_event, params: { id: number }): Promise<CollabChannel | null> => {
      if (!params || typeof params.id !== "number") return null;
      const [row] = await db
        .select()
        .from(agentCollabChannels)
        .where(eq(agentCollabChannels.id, params.id))
        .limit(1);
      return row ? mapChannel(row) : null;
    },
  );

  ipcMain.handle(
    "collab:channel:create",
    async (
      _event,
      params: {
        name: string;
        description?: string | null;
        topic?: string | null;
        visibility?: CollabChannelVisibility;
        createdByAgentId?: number | null;
      },
    ): Promise<CollabChannel> => {
      if (!params?.name?.trim()) throw new Error("channel name required");
      const [row] = await db
        .insert(agentCollabChannels)
        .values({
          name: params.name.trim(),
          description: params.description ?? null,
          topic: params.topic ?? null,
          visibility: params.visibility ?? "public",
          createdByAgentId: params.createdByAgentId ?? null,
        })
        .returning();
      logger.info(`Created channel ${row.id} (${row.name})`);
      return mapChannel(row);
    },
  );

  ipcMain.handle(
    "collab:channel:update",
    async (
      _event,
      params: {
        id: number;
        name?: string;
        description?: string | null;
        topic?: string | null;
        visibility?: CollabChannelVisibility;
      },
    ): Promise<CollabChannel | null> => {
      if (!params?.id) throw new Error("channel id required");
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (typeof params.name === "string") patch.name = params.name.trim();
      if (params.description !== undefined) patch.description = params.description;
      if (params.topic !== undefined) patch.topic = params.topic;
      if (params.visibility !== undefined) patch.visibility = params.visibility;
      const [row] = await db
        .update(agentCollabChannels)
        .set(patch)
        .where(eq(agentCollabChannels.id, params.id))
        .returning();
      return row ? mapChannel(row) : null;
    },
  );

  ipcMain.handle(
    "collab:channel:archive",
    async (_event, params: { id: number; archived?: boolean }): Promise<CollabChannel | null> => {
      if (!params?.id) throw new Error("channel id required");
      const archived = params.archived === false ? false : true;
      const [row] = await db
        .update(agentCollabChannels)
        .set({ archived, updatedAt: new Date() })
        .where(eq(agentCollabChannels.id, params.id))
        .returning();
      return row ? mapChannel(row) : null;
    },
  );

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "collab:subscription:join",
    async (
      _event,
      params: { agentId: number; channelId: number },
    ): Promise<CollabSubscription> => {
      if (!params?.agentId || !params?.channelId) {
        throw new Error("agentId and channelId required");
      }
      // Idempotent: return existing if present
      const existing = await db
        .select()
        .from(agentCollabSubscriptions)
        .where(
          and(
            eq(agentCollabSubscriptions.agentId, params.agentId),
            eq(agentCollabSubscriptions.channelId, params.channelId),
          ),
        )
        .limit(1);
      if (existing[0]) return mapSubscription(existing[0]);
      const [row] = await db
        .insert(agentCollabSubscriptions)
        .values({
          agentId: params.agentId,
          channelId: params.channelId,
        })
        .returning();
      return mapSubscription(row);
    },
  );

  ipcMain.handle(
    "collab:subscription:leave",
    async (
      _event,
      params: { agentId: number; channelId: number },
    ): Promise<{ removed: number }> => {
      if (!params?.agentId || !params?.channelId) {
        throw new Error("agentId and channelId required");
      }
      const removed = await db
        .delete(agentCollabSubscriptions)
        .where(
          and(
            eq(agentCollabSubscriptions.agentId, params.agentId),
            eq(agentCollabSubscriptions.channelId, params.channelId),
          ),
        )
        .returning();
      return { removed: removed.length };
    },
  );

  ipcMain.handle(
    "collab:subscription:list-for-agent",
    async (_event, params: { agentId: number }): Promise<CollabSubscription[]> => {
      if (!params?.agentId) return [];
      const rows = await db
        .select()
        .from(agentCollabSubscriptions)
        .where(eq(agentCollabSubscriptions.agentId, params.agentId));
      return rows.map(mapSubscription);
    },
  );

  ipcMain.handle(
    "collab:subscription:list-for-channel",
    async (_event, params: { channelId: number }): Promise<CollabSubscription[]> => {
      if (!params?.channelId) return [];
      const rows = await db
        .select()
        .from(agentCollabSubscriptions)
        .where(eq(agentCollabSubscriptions.channelId, params.channelId));
      return rows.map(mapSubscription);
    },
  );

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "collab:message:post",
    async (
      _event,
      params: {
        channelId?: number | null;
        fromAgentId?: number | null;
        toAgentId?: number | null;
        kind?: CollabMessageKind;
        content: string;
        metadata?: Record<string, unknown> | null;
        replyToId?: number | null;
        taskId?: number | null;
      },
    ): Promise<CollabMessage> => {
      if (!params || typeof params.content !== "string" || !params.content.trim()) {
        throw new Error("message content required");
      }
      if (params.channelId == null && params.toAgentId == null) {
        throw new Error("at least one of channelId or toAgentId is required");
      }
      const [row] = await db
        .insert(agentCollabMessages)
        .values({
          channelId: params.channelId ?? null,
          fromAgentId: params.fromAgentId ?? null,
          toAgentId: params.toAgentId ?? null,
          kind: params.kind ?? "chat",
          content: params.content,
          metadataJson: params.metadata ?? null,
          replyToId: params.replyToId ?? null,
          taskId: params.taskId ?? null,
        })
        .returning();
      // Touch channel updatedAt so list views can sort by recency
      if (row.channelId != null) {
        try {
          await db
            .update(agentCollabChannels)
            .set({ updatedAt: new Date() })
            .where(eq(agentCollabChannels.id, row.channelId));
        } catch (err) {
          logger.warn("Failed to touch channel updatedAt", err);
        }
      }
      return mapMessage(row);
    },
  );

  ipcMain.handle(
    "collab:message:list",
    async (
      _event,
      params?: {
        channelId?: number;
        agentId?: number;
        peerAgentId?: number;
        limit?: number;
        before?: number;
      },
    ): Promise<CollabMessage[]> => {
      const limit = Math.min(Math.max(params?.limit ?? 50, 1), 500);
      const conds = [] as any[];
      if (params?.channelId != null) {
        conds.push(eq(agentCollabMessages.channelId, params.channelId));
      } else if (params?.agentId != null && params?.peerAgentId != null) {
        // DM thread between two agents
        conds.push(
          or(
            and(
              eq(agentCollabMessages.fromAgentId, params.agentId),
              eq(agentCollabMessages.toAgentId, params.peerAgentId),
            ),
            and(
              eq(agentCollabMessages.fromAgentId, params.peerAgentId),
              eq(agentCollabMessages.toAgentId, params.agentId),
            ),
          ),
        );
      } else if (params?.agentId != null) {
        // All DMs involving this agent
        conds.push(
          or(
            eq(agentCollabMessages.fromAgentId, params.agentId),
            eq(agentCollabMessages.toAgentId, params.agentId),
          ),
        );
      }
      if (params?.before != null) {
        conds.push(lt(agentCollabMessages.createdAt, new Date(params.before * 1000)));
      }
      const where = conds.length ? and(...conds) : undefined;
      const rows = where
        ? await db
            .select()
            .from(agentCollabMessages)
            .where(where)
            .orderBy(desc(agentCollabMessages.createdAt))
            .limit(limit)
        : await db
            .select()
            .from(agentCollabMessages)
            .orderBy(desc(agentCollabMessages.createdAt))
            .limit(limit);
      // Return chronological (oldest first) so the UI can append
      return rows.map(mapMessage).reverse();
    },
  );

  // ---------------------------------------------------------------------------
  // Tasks (handoffs)
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "collab:task:create",
    async (
      _event,
      params: {
        fromAgentId: number;
        toAgentId: number;
        title: string;
        description?: string | null;
        priority?: CollabTaskPriority;
        channelId?: number | null;
        input?: Record<string, unknown> | null;
        dueAt?: number | null;
      },
    ): Promise<CollabTask> => {
      if (!params?.fromAgentId || !params?.toAgentId) {
        throw new Error("fromAgentId and toAgentId required");
      }
      if (!params.title?.trim()) throw new Error("title required");
      const [row] = await db
        .insert(agentCollabTasks)
        .values({
          fromAgentId: params.fromAgentId,
          toAgentId: params.toAgentId,
          channelId: params.channelId ?? null,
          title: params.title.trim(),
          description: params.description ?? null,
          priority: params.priority ?? "normal",
          inputJson: params.input ?? null,
          dueAt: params.dueAt != null ? new Date(params.dueAt * 1000) : null,
        })
        .returning();
      logger.info(
        `Created handoff task ${row.id}: agent ${row.fromAgentId} → ${row.toAgentId} (${row.title})`,
      );
      // Auto-post a handoff message into the channel if one was provided
      if (row.channelId != null) {
        try {
          await db.insert(agentCollabMessages).values({
            channelId: row.channelId,
            fromAgentId: row.fromAgentId,
            toAgentId: row.toAgentId,
            kind: "handoff",
            content: `Handoff requested: ${row.title}`,
            metadataJson: { taskId: row.id, priority: row.priority },
            taskId: row.id,
          });
        } catch (err) {
          logger.warn("Failed to post handoff system message", err);
        }
      }
      return mapTask(row);
    },
  );

  ipcMain.handle(
    "collab:task:update-status",
    async (
      _event,
      params: {
        id: number;
        status: CollabTaskStatus;
        output?: Record<string, unknown> | null;
      },
    ): Promise<CollabTask | null> => {
      if (!params?.id || !params?.status) throw new Error("id and status required");
      const patch: Record<string, unknown> = {
        status: params.status,
        updatedAt: new Date(),
      };
      if (params.output !== undefined) patch.outputJson = params.output;
      if (params.status === "accepted" || params.status === "in_progress") {
        patch.acceptedAt = new Date();
      }
      if (
        params.status === "done" ||
        params.status === "rejected" ||
        params.status === "cancelled"
      ) {
        patch.completedAt = new Date();
      }
      const [row] = await db
        .update(agentCollabTasks)
        .set(patch)
        .where(eq(agentCollabTasks.id, params.id))
        .returning();
      if (!row) return null;
      // Mirror the status transition into the channel as a `result` message when terminal
      if (row.channelId != null && (params.status === "done" || params.status === "rejected")) {
        try {
          await db.insert(agentCollabMessages).values({
            channelId: row.channelId,
            fromAgentId: row.toAgentId,
            toAgentId: row.fromAgentId,
            kind: "result",
            content:
              params.status === "done"
                ? `Task complete: ${row.title}`
                : `Task rejected: ${row.title}`,
            metadataJson: { taskId: row.id, status: row.status },
            taskId: row.id,
          });
        } catch (err) {
          logger.warn("Failed to post task result message", err);
        }
      }
      return mapTask(row);
    },
  );

  ipcMain.handle(
    "collab:task:list",
    async (
      _event,
      params?: {
        agentId?: number;
        status?: CollabTaskStatus;
        role?: "mine_assigned" | "mine_created";
        channelId?: number;
        limit?: number;
      },
    ): Promise<CollabTask[]> => {
      const limit = Math.min(Math.max(params?.limit ?? 100, 1), 500);
      const conds = [] as any[];
      if (params?.agentId != null) {
        if (params.role === "mine_created") {
          conds.push(eq(agentCollabTasks.fromAgentId, params.agentId));
        } else if (params.role === "mine_assigned") {
          conds.push(eq(agentCollabTasks.toAgentId, params.agentId));
        } else {
          conds.push(
            or(
              eq(agentCollabTasks.fromAgentId, params.agentId),
              eq(agentCollabTasks.toAgentId, params.agentId),
            ),
          );
        }
      }
      if (params?.status) conds.push(eq(agentCollabTasks.status, params.status));
      if (params?.channelId != null) conds.push(eq(agentCollabTasks.channelId, params.channelId));
      const where = conds.length ? and(...conds) : undefined;
      const rows = where
        ? await db
            .select()
            .from(agentCollabTasks)
            .where(where)
            .orderBy(desc(agentCollabTasks.updatedAt))
            .limit(limit)
        : await db
            .select()
            .from(agentCollabTasks)
            .orderBy(desc(agentCollabTasks.updatedAt))
            .limit(limit);
      return rows.map(mapTask);
    },
  );

  // ---------------------------------------------------------------------------
  // Activity feed
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    "collab:activity:recent",
    async (_event, params?: { limit?: number }): Promise<CollabActivityItem[]> => {
      const limit = Math.min(Math.max(params?.limit ?? 50, 1), 200);

      const [recentMessages, recentTasks] = await Promise.all([
        db
          .select()
          .from(agentCollabMessages)
          .orderBy(desc(agentCollabMessages.createdAt))
          .limit(limit),
        db
          .select()
          .from(agentCollabTasks)
          .orderBy(desc(agentCollabTasks.updatedAt))
          .limit(limit),
      ]);

      const items: CollabActivityItem[] = [];
      for (const m of recentMessages) {
        const mapped = mapMessage(m);
        items.push({ kind: "message", at: mapped.createdAt, message: mapped });
      }
      for (const t of recentTasks) {
        const mapped = mapTask(t);
        const event: "created" | "updated" =
          mapped.createdAt === mapped.updatedAt ? "created" : "updated";
        items.push({ kind: "task", at: mapped.updatedAt, task: mapped, event });
      }
      items.sort((a, b) => b.at - a.at);
      return items.slice(0, limit);
    },
  );

  // Quiet the unused-import linter for `sql` (kept available for future ad-hoc fragments)
  void sql;

  logger.info("Collaboration Hub IPC handlers registered");
}

export default registerCollaborationHubHandlers;
