/**
 * OpenClaw Kanban IPC Handlers
 * CRUD + analytics for the OpenClaw task board
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { v4 as uuidv4 } from "uuid";
import { eq, desc, asc, and, sql, count, like, inArray } from "drizzle-orm";
import log from "electron-log";

import { getDb } from "@/db";
import {
  openclawKanbanTasks,
  openclawKanbanActivity,
} from "@/db/schema";

const logger = log.scope("openclaw_kanban");

// ─── Types ──────────────────────────────────────────────────────────────────

export type KanbanStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "review"
  | "completed"
  | "failed"
  | "cancelled";

export type KanbanTaskType =
  | "research"
  | "build"
  | "analyze"
  | "optimize"
  | "automate"
  | "code_generation"
  | "refactor"
  | "debug"
  | "deploy"
  | "data_pipeline"
  | "agent_task"
  | "workflow"
  | "custom";

export type KanbanPriority = "critical" | "high" | "medium" | "low";

export interface CreateKanbanTaskParams {
  title: string;
  description?: string;
  status?: KanbanStatus;
  taskType?: KanbanTaskType;
  priority?: KanbanPriority;
  provider?: string;
  model?: string;
  agentId?: string;
  workflowId?: string;
  parentTaskId?: string;
  labels?: string[];
  assignee?: string;
}

export interface UpdateKanbanTaskParams {
  id: string;
  title?: string;
  description?: string;
  status?: KanbanStatus;
  taskType?: KanbanTaskType;
  priority?: KanbanPriority;
  provider?: string;
  model?: string;
  agentId?: string;
  workflowId?: string;
  labels?: string[];
  assignee?: string;
  sortOrder?: number;
  tokensUsed?: number;
  iterationsRun?: number;
  costEstimate?: string;
  durationMs?: number;
  localProcessed?: boolean;
  resultJson?: Record<string, unknown> | null;
  errorMessage?: string;
  artifactsJson?: Array<{
    id: string;
    type: string;
    name: string;
    path?: string;
    language?: string;
  }> | null;
}

export interface KanbanFilterParams {
  status?: KanbanStatus | KanbanStatus[];
  taskType?: KanbanTaskType;
  priority?: KanbanPriority;
  assignee?: string;
  label?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

// ─── Registration ───────────────────────────────────────────────────────────

export function registerOpenClawKanbanHandlers(): void {
  // =========================================================================
  // LIST / FILTER TASKS
  // =========================================================================

  ipcMain.handle(
    "openclaw:kanban:tasks:list",
    async (_event: IpcMainInvokeEvent, filters?: KanbanFilterParams) => {
      const db = getDb();
      const conditions: any[] = [];

      if (filters?.status) {
        if (Array.isArray(filters.status)) {
          conditions.push(inArray(openclawKanbanTasks.status, filters.status));
        } else {
          conditions.push(eq(openclawKanbanTasks.status, filters.status));
        }
      }
      if (filters?.taskType) {
        conditions.push(eq(openclawKanbanTasks.taskType, filters.taskType));
      }
      if (filters?.priority) {
        conditions.push(eq(openclawKanbanTasks.priority, filters.priority));
      }
      if (filters?.assignee) {
        conditions.push(eq(openclawKanbanTasks.assignee, filters.assignee));
      }
      if (filters?.search) {
        conditions.push(like(openclawKanbanTasks.title, `%${filters.search}%`));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const tasks = await db
        .select()
        .from(openclawKanbanTasks)
        .where(where)
        .orderBy(
          asc(openclawKanbanTasks.sortOrder),
          desc(openclawKanbanTasks.createdAt)
        )
        .limit(filters?.limit ?? 500)
        .offset(filters?.offset ?? 0);

      return tasks;
    }
  );

  // =========================================================================
  // GET SINGLE TASK
  // =========================================================================

  ipcMain.handle(
    "openclaw:kanban:tasks:get",
    async (_event: IpcMainInvokeEvent, taskId: string) => {
      const db = getDb();
      const [task] = await db
        .select()
        .from(openclawKanbanTasks)
        .where(eq(openclawKanbanTasks.id, taskId));

      if (!task) throw new Error(`Task ${taskId} not found`);
      return task;
    }
  );

  // =========================================================================
  // CREATE TASK
  // =========================================================================

  ipcMain.handle(
    "openclaw:kanban:tasks:create",
    async (_event: IpcMainInvokeEvent, params: CreateKanbanTaskParams) => {
      const db = getDb();
      const id = uuidv4();
      const now = new Date();

      await db.insert(openclawKanbanTasks).values({
        id,
        title: params.title,
        description: params.description ?? null,
        status: params.status ?? "backlog",
        taskType: params.taskType ?? "custom",
        priority: params.priority ?? "medium",
        provider: params.provider ?? null,
        model: params.model ?? null,
        agentId: params.agentId ?? null,
        workflowId: params.workflowId ?? null,
        parentTaskId: params.parentTaskId ?? null,
        labels: params.labels ?? null,
        assignee: params.assignee ?? "openclaw",
        createdAt: now,
        updatedAt: now,
      });

      // Record activity
      await db.insert(openclawKanbanActivity).values({
        id: uuidv4(),
        taskId: id,
        action: "created",
        toValue: params.status ?? "backlog",
        actor: "user",
        createdAt: now,
      });

      logger.info(`Created kanban task: ${id} - ${params.title}`);

      const [task] = await db
        .select()
        .from(openclawKanbanTasks)
        .where(eq(openclawKanbanTasks.id, id));

      return task;
    }
  );

  // =========================================================================
  // UPDATE TASK
  // =========================================================================

  ipcMain.handle(
    "openclaw:kanban:tasks:update",
    async (_event: IpcMainInvokeEvent, params: UpdateKanbanTaskParams) => {
      const db = getDb();
      const now = new Date();

      // Get current task for activity logging
      const [existing] = await db
        .select()
        .from(openclawKanbanTasks)
        .where(eq(openclawKanbanTasks.id, params.id));

      if (!existing) throw new Error(`Task ${params.id} not found`);

      const updates: Record<string, any> = { updatedAt: now };

      // Map fields
      if (params.title !== undefined) updates.title = params.title;
      if (params.description !== undefined) updates.description = params.description;
      if (params.taskType !== undefined) updates.taskType = params.taskType;
      if (params.priority !== undefined) updates.priority = params.priority;
      if (params.provider !== undefined) updates.provider = params.provider;
      if (params.model !== undefined) updates.model = params.model;
      if (params.agentId !== undefined) updates.agentId = params.agentId;
      if (params.workflowId !== undefined) updates.workflowId = params.workflowId;
      if (params.labels !== undefined) updates.labels = params.labels;
      if (params.assignee !== undefined) updates.assignee = params.assignee;
      if (params.sortOrder !== undefined) updates.sortOrder = params.sortOrder;
      if (params.tokensUsed !== undefined) updates.tokensUsed = params.tokensUsed;
      if (params.iterationsRun !== undefined) updates.iterationsRun = params.iterationsRun;
      if (params.costEstimate !== undefined) updates.costEstimate = params.costEstimate;
      if (params.durationMs !== undefined) updates.durationMs = params.durationMs;
      if (params.localProcessed !== undefined) updates.localProcessed = params.localProcessed;
      if (params.resultJson !== undefined) updates.resultJson = params.resultJson;
      if (params.errorMessage !== undefined) updates.errorMessage = params.errorMessage;
      if (params.artifactsJson !== undefined) updates.artifactsJson = params.artifactsJson;

      // Status change tracking
      if (params.status !== undefined && params.status !== existing.status) {
        updates.status = params.status;

        if (params.status === "in_progress" && !existing.startedAt) {
          updates.startedAt = now;
        }
        if (params.status === "completed" || params.status === "failed" || params.status === "cancelled") {
          updates.completedAt = now;
          if (existing.startedAt && !params.durationMs) {
            updates.durationMs = now.getTime() - new Date(existing.startedAt).getTime();
          }
        }

        // Record status change activity
        await db.insert(openclawKanbanActivity).values({
          id: uuidv4(),
          taskId: params.id,
          action: "status_changed",
          fromValue: existing.status,
          toValue: params.status,
          actor: "user",
          createdAt: now,
        });
      }

      if (params.priority !== undefined && params.priority !== existing.priority) {
        await db.insert(openclawKanbanActivity).values({
          id: uuidv4(),
          taskId: params.id,
          action: "priority_changed",
          fromValue: existing.priority,
          toValue: params.priority,
          actor: "user",
          createdAt: now,
        });
      }

      await db
        .update(openclawKanbanTasks)
        .set(updates)
        .where(eq(openclawKanbanTasks.id, params.id));

      const [updated] = await db
        .select()
        .from(openclawKanbanTasks)
        .where(eq(openclawKanbanTasks.id, params.id));

      return updated;
    }
  );

  // =========================================================================
  // DELETE TASK
  // =========================================================================

  ipcMain.handle(
    "openclaw:kanban:tasks:delete",
    async (_event: IpcMainInvokeEvent, taskId: string) => {
      const db = getDb();
      // Delete activities first
      await db
        .delete(openclawKanbanActivity)
        .where(eq(openclawKanbanActivity.taskId, taskId));
      await db
        .delete(openclawKanbanTasks)
        .where(eq(openclawKanbanTasks.id, taskId));

      logger.info(`Deleted kanban task: ${taskId}`);
      return { success: true };
    }
  );

  // =========================================================================
  // MOVE TASK (update status + sort order atomically)
  // =========================================================================

  ipcMain.handle(
    "openclaw:kanban:tasks:move",
    async (
      _event: IpcMainInvokeEvent,
      params: { taskId: string; status: KanbanStatus; sortOrder: number }
    ) => {
      const db = getDb();
      const now = new Date();

      const [existing] = await db
        .select()
        .from(openclawKanbanTasks)
        .where(eq(openclawKanbanTasks.id, params.taskId));

      if (!existing) throw new Error(`Task ${params.taskId} not found`);

      const updates: Record<string, any> = {
        status: params.status,
        sortOrder: params.sortOrder,
        updatedAt: now,
      };

      if (params.status === "in_progress" && !existing.startedAt) {
        updates.startedAt = now;
      }
      if (
        (params.status === "completed" || params.status === "failed" || params.status === "cancelled") &&
        !existing.completedAt
      ) {
        updates.completedAt = now;
        if (existing.startedAt) {
          updates.durationMs = now.getTime() - new Date(existing.startedAt).getTime();
        }
      }

      await db
        .update(openclawKanbanTasks)
        .set(updates)
        .where(eq(openclawKanbanTasks.id, params.taskId));

      if (params.status !== existing.status) {
        await db.insert(openclawKanbanActivity).values({
          id: uuidv4(),
          taskId: params.taskId,
          action: "status_changed",
          fromValue: existing.status,
          toValue: params.status,
          actor: "user",
          createdAt: now,
        });
      }

      const [moved] = await db
        .select()
        .from(openclawKanbanTasks)
        .where(eq(openclawKanbanTasks.id, params.taskId));

      return moved;
    }
  );

  // =========================================================================
  // TASK ACTIVITY LOG
  // =========================================================================

  ipcMain.handle(
    "openclaw:kanban:activity:list",
    async (
      _event: IpcMainInvokeEvent,
      params: { taskId?: string; limit?: number }
    ) => {
      const db = getDb();
      const conditions: any[] = [];
      if (params.taskId) {
        conditions.push(eq(openclawKanbanActivity.taskId, params.taskId));
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      return db
        .select()
        .from(openclawKanbanActivity)
        .where(where)
        .orderBy(desc(openclawKanbanActivity.createdAt))
        .limit(params.limit ?? 100);
    }
  );

  // =========================================================================
  // ANALYTICS
  // =========================================================================

  ipcMain.handle("openclaw:kanban:analytics", async () => {
    const db = getDb();

    // Counts by status
    const statusCounts = await db
      .select({
        status: openclawKanbanTasks.status,
        count: count(),
      })
      .from(openclawKanbanTasks)
      .groupBy(openclawKanbanTasks.status);

    // Counts by task type
    const typeCounts = await db
      .select({
        taskType: openclawKanbanTasks.taskType,
        count: count(),
      })
      .from(openclawKanbanTasks)
      .groupBy(openclawKanbanTasks.taskType);

    // Counts by priority
    const priorityCounts = await db
      .select({
        priority: openclawKanbanTasks.priority,
        count: count(),
      })
      .from(openclawKanbanTasks)
      .groupBy(openclawKanbanTasks.priority);

    // Provider usage
    const providerCounts = await db
      .select({
        provider: openclawKanbanTasks.provider,
        count: count(),
      })
      .from(openclawKanbanTasks)
      .groupBy(openclawKanbanTasks.provider);

    // Aggregate metrics
    const [metrics] = await db
      .select({
        totalTasks: count(),
        totalTokens: sql<number>`COALESCE(SUM(${openclawKanbanTasks.tokensUsed}), 0)`,
        totalDurationMs: sql<number>`COALESCE(SUM(${openclawKanbanTasks.durationMs}), 0)`,
        avgDurationMs: sql<number>`COALESCE(AVG(${openclawKanbanTasks.durationMs}), 0)`,
        localCount: sql<number>`SUM(CASE WHEN ${openclawKanbanTasks.localProcessed} = 1 THEN 1 ELSE 0 END)`,
        completedCount: sql<number>`SUM(CASE WHEN ${openclawKanbanTasks.status} = 'completed' THEN 1 ELSE 0 END)`,
        failedCount: sql<number>`SUM(CASE WHEN ${openclawKanbanTasks.status} = 'failed' THEN 1 ELSE 0 END)`,
      })
      .from(openclawKanbanTasks);

    // Recent activity (last 50)
    const recentActivity = await db
      .select()
      .from(openclawKanbanActivity)
      .orderBy(desc(openclawKanbanActivity.createdAt))
      .limit(50);

    // Completion over time (last 30 days, grouped by day)
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    const completionsOverTime = await db
      .select({
        day: sql<string>`date(${openclawKanbanTasks.completedAt}, 'unixepoch')`,
        count: count(),
      })
      .from(openclawKanbanTasks)
      .where(
        and(
          eq(openclawKanbanTasks.status, "completed"),
          sql`${openclawKanbanTasks.completedAt} > ${thirtyDaysAgo}`
        )
      )
      .groupBy(sql`date(${openclawKanbanTasks.completedAt}, 'unixepoch')`)
      .orderBy(sql`date(${openclawKanbanTasks.completedAt}, 'unixepoch')`);

    return {
      statusCounts: Object.fromEntries(
        statusCounts.map((r) => [r.status, r.count])
      ),
      typeCounts: Object.fromEntries(
        typeCounts.map((r) => [r.taskType, r.count])
      ),
      priorityCounts: Object.fromEntries(
        priorityCounts.map((r) => [r.priority, r.count])
      ),
      providerCounts: Object.fromEntries(
        providerCounts.filter((r) => r.provider).map((r) => [r.provider, r.count])
      ),
      metrics: {
        totalTasks: metrics.totalTasks,
        totalTokens: metrics.totalTokens,
        totalDurationMs: metrics.totalDurationMs,
        avgDurationMs: Math.round(metrics.avgDurationMs),
        localProcessedPercent:
          metrics.totalTasks > 0
            ? Math.round(((metrics.localCount ?? 0) / metrics.totalTasks) * 100)
            : 0,
        completionRate:
          metrics.totalTasks > 0
            ? Math.round(((metrics.completedCount ?? 0) / metrics.totalTasks) * 100)
            : 0,
        failureRate:
          metrics.totalTasks > 0
            ? Math.round(((metrics.failedCount ?? 0) / metrics.totalTasks) * 100)
            : 0,
      },
      recentActivity,
      completionsOverTime,
    };
  });

  // =========================================================================
  // MODEL REGISTRY (available models for task creation)
  // =========================================================================

  ipcMain.handle(
    "openclaw:kanban:models:list",
    async (_event: IpcMainInvokeEvent, filters?: { taskType?: string; source?: string }) => {
      try {
        const { getAvailableModels } = await import("@/lib/openclaw_registry_bridge");
        return await getAvailableModels(filters);
      } catch (err) {
        logger.error("Failed to list models:", err);
        throw new Error("Could not retrieve available models");
      }
    },
  );

  // =========================================================================
  // TASK RATING (human feedback for MAB + flywheel)
  // =========================================================================

  ipcMain.handle(
    "openclaw:kanban:tasks:rate",
    async (
      _event: IpcMainInvokeEvent,
      params: { taskId: string; rating: number; feedback?: string },
    ) => {
      if (!params.taskId || typeof params.rating !== "number") {
        throw new Error("taskId and numeric rating are required");
      }
      if (params.rating < 1 || params.rating > 5) {
        throw new Error("rating must be between 1 and 5");
      }

      const db = getDb();

      // Fetch the task to get model/taskType info
      const [task] = await db
        .select()
        .from(openclawKanbanTasks)
        .where(eq(openclawKanbanTasks.id, params.taskId))
        .limit(1);

      if (!task) throw new Error("Task not found");

      // Record MAB outcome via registry bridge
      try {
        const { recordTaskOutcome } = await import("@/lib/openclaw_registry_bridge");
        await recordTaskOutcome({
          taskType: task.taskType ?? "custom",
          model: task.model ?? "unknown",
          success: params.rating >= 3,
          qualityScore: params.rating / 5,
          feedback: params.feedback,
        });
      } catch (err) {
        logger.warn("Could not record MAB outcome for rating:", err);
      }

      // Update flywheel training pair rating if applicable
      try {
        const { updateTrainingPairRating } = await import("@/lib/data_flywheel");
        const flywheelRating = params.rating >= 3 ? "positive" as const : "negative" as const;
        await updateTrainingPairRating("openclaw", task.model ?? "unknown", flywheelRating);
      } catch (err) {
        logger.debug("No flywheel pair to update for task:", params.taskId);
      }

      // Log activity
      await db.insert(openclawKanbanActivity).values({
        id: uuidv4(),
        taskId: params.taskId,
        action: "rated",
        actor: "user",
        toValue: String(params.rating),
        details: params.feedback ?? null,
        createdAt: Math.floor(Date.now() / 1000),
      });

      return { success: true, rating: params.rating };
    },
  );

  logger.info("OpenClaw Kanban handlers registered");
}
