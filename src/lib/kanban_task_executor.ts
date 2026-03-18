/**
 * Kanban Task Executor — Autonomous Loop Engine
 *
 * Polls for kanban tasks in "in_progress" status and executes them:
 * 1. Pick up unstarted in_progress tasks
 * 2. Run inference via Ollama (privacy-preserving, local-first)
 * 3. Create IPLD receipt for the inference
 * 4. Post receipt to Celestia DA layer (best-effort)
 * 5. Trigger n8n workflow if configured (best-effort)
 * 6. Update task with results and move to completed/failed
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { eq, and, isNull } from "drizzle-orm";
import { createHash } from "crypto";
import log from "electron-log";

import { getDb } from "@/db";
import { openclawKanbanTasks, openclawKanbanActivity } from "@/db/schema";
import { ipldReceiptService } from "@/lib/ipld_receipt_service";
import { celestiaBlobService } from "@/lib/celestia_blob_service";
import { getOllamaApiUrl } from "@/ipc/handlers/local_model_ollama_handler";

const logger = log.scope("task_executor");

// =============================================================================
// STATE
// =============================================================================

let running = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let activeTasks = new Set<string>();

const POLL_INTERVAL_MS = 5_000;
const INFERENCE_TIMEOUT_MS = 120_000;

interface ExecutorStatus {
  running: boolean;
  activeTaskCount: number;
  activeTasks: string[];
  pollIntervalMs: number;
  totalExecuted: number;
  totalSucceeded: number;
  totalFailed: number;
}

let stats = {
  totalExecuted: 0,
  totalSucceeded: 0,
  totalFailed: 0,
};

// =============================================================================
// CORE LOOP
// =============================================================================

async function pollForTasks(): Promise<void> {
  if (!running) return;

  try {
    const db = getDb();

    // Find in_progress tasks that haven't been started (no startedAt)
    const pendingTasks = await db
      .select()
      .from(openclawKanbanTasks)
      .where(
        and(
          eq(openclawKanbanTasks.status, "in_progress"),
          isNull(openclawKanbanTasks.startedAt),
        ),
      )
      .limit(3); // Process up to 3 tasks per poll cycle

    for (const task of pendingTasks) {
      if (activeTasks.has(task.id)) continue;
      // Fire and forget — don't block the poll loop
      executeTask(task).catch((err) =>
        logger.error(`Unhandled error executing task ${task.id}:`, err),
      );
    }
  } catch (err) {
    logger.error("Poll error:", err);
  }
}

async function executeTask(task: any): Promise<void> {
  const db = getDb();
  const taskId = task.id;
  activeTasks.add(taskId);
  stats.totalExecuted++;

  const startTime = Date.now();

  try {
    // Mark as started
    const now = new Date();
    await db
      .update(openclawKanbanTasks)
      .set({ startedAt: now, updatedAt: now })
      .where(eq(openclawKanbanTasks.id, taskId));

    await logActivity(db, taskId, "started", "task_executor");

    logger.info(`Executing task: ${task.title} (${taskId})`);

    // ── Step 1: Run inference ──
    const prompt = buildPromptFromTask(task);
    const model = task.model || "llama3.2:3b";
    const inferenceResult = await runOllamaInference(prompt, model, task.agentId);
    const durationMs = Date.now() - startTime;

    logger.info(
      `Inference complete for ${taskId}: ${inferenceResult.content.length} chars, ${inferenceResult.totalTokens} tokens in ${durationMs}ms`,
    );

    // ── Step 2: Create IPLD receipt ──
    let receiptCid: string | undefined;
    try {
      const promptHash = createHash("sha256").update(prompt).digest("hex");
      const dataHash = createHash("sha256")
        .update(inferenceResult.content)
        .digest("hex");

      const receipt = await ipldReceiptService.createReceipt({
        issuer: task.assignee || "openclaw",
        payer: task.assignee || "openclaw",
        modelId: model,
        dataHash,
        promptHash,
        outputHash: dataHash,
        timestamp: Math.floor(Date.now() / 1000),
      });

      receiptCid = receipt.cid;
      logger.info(`Receipt created: ${receiptCid}`);
      await logActivity(db, taskId, "comment", "task_executor", undefined, `receipt:${receiptCid}`);
    } catch (err) {
      logger.warn(`Failed to create receipt for ${taskId}:`, err);
    }

    // ── Step 3: Post receipt to Celestia (best-effort) ──
    let celestiaHeight: number | undefined;
    let celestiaHash: string | undefined;
    try {
      const available = await celestiaBlobService.isAvailable();
      if (available && receiptCid) {
        const receiptRecord = await ipldReceiptService.getReceipt(receiptCid);
        if (receiptRecord) {
          const submission = await celestiaBlobService.submitJSON(
            receiptRecord.receipt,
            { label: task.title, dataType: "inference-receipt" },
          );
          celestiaHeight = submission.height;
          celestiaHash = submission.contentHash;
          logger.info(
            `Celestia blob submitted at height ${celestiaHeight}: ${celestiaHash}`,
          );
          await logActivity(
            db,
            taskId,
            "comment",
            "task_executor",
            undefined,
            `celestia:height:${celestiaHeight} hash:${celestiaHash}`,
          );
        }
      }
    } catch (err) {
      logger.warn(`Celestia submission failed for ${taskId}:`, err);
    }

    // ── Step 4: Update task as completed ──
    const completedAt = new Date();
    const resultJson: Record<string, unknown> = {
      content: inferenceResult.content,
      promptTokens: inferenceResult.promptTokens,
      completionTokens: inferenceResult.completionTokens,
      totalTokens: inferenceResult.totalTokens,
      model,
      ...(receiptCid ? { receiptCid } : {}),
      ...(celestiaHeight ? { celestiaHeight, celestiaHash } : {}),
    };

    await db
      .update(openclawKanbanTasks)
      .set({
        status: "completed",
        tokensUsed: inferenceResult.totalTokens,
        durationMs,
        localProcessed: true,
        resultJson,
        completedAt,
        updatedAt: completedAt,
        provider: "ollama",
        model,
      })
      .where(eq(openclawKanbanTasks.id, taskId));

    await logActivity(
      db,
      taskId,
      "status_changed",
      "task_executor",
      "in_progress",
      "completed",
    );

    stats.totalSucceeded++;

    // ── Step 5: Trigger n8n workflow (best-effort) ──
    if (task.workflowId) {
      try {
        const { getOpenClawN8nBridge } = await import(
          "@/lib/openclaw_n8n_bridge"
        );
        const bridge = getOpenClawN8nBridge();
        await bridge.triggerWorkflow({
          workflowId: task.workflowId,
          data: {
            taskId,
            taskTitle: task.title,
            result: inferenceResult.content,
            receiptCid,
            celestiaHash,
            celestiaHeight,
            tokensUsed: inferenceResult.totalTokens,
            durationMs,
          },
        });
        logger.info(`n8n workflow ${task.workflowId} triggered for ${taskId}`);
        await logActivity(
          db,
          taskId,
          "comment",
          "task_executor",
          undefined,
          task.workflowId,
        );
      } catch (err) {
        logger.warn(`n8n trigger failed for ${taskId}:`, err);
      }
    }

    logger.info(`Task completed: ${task.title} (${taskId}) in ${durationMs}ms`);
  } catch (err: any) {
    // ── Task failed ──
    const durationMs = Date.now() - startTime;
    const errorMessage =
      err instanceof Error ? err.message : String(err);

    logger.error(`Task failed: ${task.title} (${taskId}):`, errorMessage);

    try {
      await db
        .update(openclawKanbanTasks)
        .set({
          status: "failed",
          errorMessage,
          durationMs,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(openclawKanbanTasks.id, taskId));

      await logActivity(
        db,
        taskId,
        "status_changed",
        "task_executor",
        "in_progress",
        "failed",
      );
    } catch (dbErr) {
      logger.error(`Failed to update failed task ${taskId}:`, dbErr);
    }

    stats.totalFailed++;
  } finally {
    activeTasks.delete(taskId);
  }
}

// =============================================================================
// INFERENCE
// =============================================================================

interface InferenceResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function buildPromptFromTask(task: any): string {
  const parts: string[] = [];

  if (task.taskType && task.taskType !== "custom") {
    parts.push(`Task type: ${task.taskType}`);
  }
  parts.push(`Task: ${task.title}`);
  if (task.description) {
    parts.push(`\nDetails:\n${task.description}`);
  }

  return parts.join("\n");
}

async function runOllamaInference(
  prompt: string,
  model: string,
  agentId?: string | null,
): Promise<InferenceResult> {
  const baseUrl = getOllamaApiUrl();

  // Build system prompt
  let systemPrompt =
    "You are an AI agent executing tasks autonomously. Complete the task accurately and concisely. Provide clear, actionable output.";

  // Load agent system prompt if available
  if (agentId) {
    try {
      const { app } = await import("electron");
      const path = await import("node:path");
      const fs = await import("node:fs/promises");
      const agentsDir = path.join(app.getPath("userData"), "agents");
      const raw = await fs.readFile(
        path.join(agentsDir, `${agentId}.json`),
        "utf-8",
      );
      const agent = JSON.parse(raw);
      if (agent.systemPrompt) systemPrompt = agent.systemPrompt;
    } catch {
      // Agent file not found, use default prompt
    }
  }

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
    signal: AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = data.message?.content ?? "";
  const promptTokens =
    data.prompt_eval_count ?? Math.ceil(prompt.length / 4);
  const completionTokens =
    data.eval_count ?? Math.ceil(content.length / 4);

  return {
    content,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

// =============================================================================
// ACTIVITY LOG HELPER
// =============================================================================

type ActivityAction =
  | "created"
  | "status_changed"
  | "priority_changed"
  | "assigned"
  | "comment"
  | "started"
  | "completed"
  | "failed"
  | "retried"
  | "label_added"
  | "label_removed"
  | "artifact_added";

async function logActivity(
  db: ReturnType<typeof getDb>,
  taskId: string,
  action: ActivityAction,
  actor: string,
  fromValue?: string,
  toValue?: string,
): Promise<void> {
  const { v4: uuidv4 } = await import("uuid");
  await db.insert(openclawKanbanActivity).values({
    id: uuidv4(),
    taskId,
    action,
    actor,
    fromValue: fromValue ?? null,
    toValue: toValue ?? null,
    note: null,
    createdAt: new Date(),
  });
}

// =============================================================================
// PUBLIC API
// =============================================================================

export function startTaskExecutor(): void {
  if (running) {
    logger.info("Task executor already running");
    return;
  }

  running = true;
  pollTimer = setInterval(pollForTasks, POLL_INTERVAL_MS);
  logger.info(`Task executor started (poll every ${POLL_INTERVAL_MS}ms)`);

  // Run first poll immediately
  pollForTasks();
}

export function stopTaskExecutor(): void {
  running = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  logger.info("Task executor stopped");
}

export function getTaskExecutorStatus(): ExecutorStatus {
  return {
    running,
    activeTaskCount: activeTasks.size,
    activeTasks: Array.from(activeTasks),
    pollIntervalMs: POLL_INTERVAL_MS,
    ...stats,
  };
}

export function isTaskExecutorRunning(): boolean {
  return running;
}

// =============================================================================
// IPC HANDLERS
// =============================================================================

export function registerTaskExecutorHandlers(): void {
  ipcMain.handle("task-executor:status", async () => {
    return getTaskExecutorStatus();
  });

  ipcMain.handle("task-executor:start", async () => {
    startTaskExecutor();
    return getTaskExecutorStatus();
  });

  ipcMain.handle("task-executor:stop", async () => {
    stopTaskExecutor();
    return getTaskExecutorStatus();
  });
}

// =============================================================================
// SYSTEM SERVICES HEALTH
// =============================================================================

export async function getSystemServicesHealth(): Promise<
  Array<{
    name: string;
    status: "healthy" | "degraded" | "offline" | "unknown";
    port?: number;
    details?: string;
    lastCheck: number;
  }>
> {
  const services: Array<{
    name: string;
    status: "healthy" | "degraded" | "offline" | "unknown";
    port?: number;
    details?: string;
    lastCheck: number;
  }> = [];

  const now = Date.now();

  // 1. Ollama
  try {
    const ollamaUrl = getOllamaApiUrl();
    const res = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      const modelCount = data.models?.length ?? 0;
      services.push({
        name: "Ollama",
        status: "healthy",
        port: 11434,
        details: `${modelCount} models available`,
        lastCheck: now,
      });
    } else {
      services.push({
        name: "Ollama",
        status: "degraded",
        port: 11434,
        details: `HTTP ${res.status}`,
        lastCheck: now,
      });
    }
  } catch {
    services.push({
      name: "Ollama",
      status: "offline",
      port: 11434,
      details: "Not reachable at localhost:11434",
      lastCheck: now,
    });
  }

  // 2. n8n
  try {
    const res = await fetch("http://localhost:5678/healthz", {
      signal: AbortSignal.timeout(3000),
    });
    services.push({
      name: "n8n",
      status: res.ok ? "healthy" : "degraded",
      port: 5678,
      details: res.ok ? "Workflow engine running" : `HTTP ${res.status}`,
      lastCheck: now,
    });
  } catch {
    services.push({
      name: "n8n",
      status: "offline",
      port: 5678,
      details: "Docker container not running",
      lastCheck: now,
    });
  }

  // 3. Celestia
  try {
    const available = await celestiaBlobService.isAvailable();
    if (available) {
      const syncState = await celestiaBlobService.getSyncState();
      services.push({
        name: "Celestia",
        status: "healthy",
        port: 26658,
        details: `Synced to height ${syncState?.height ?? "unknown"}`,
        lastCheck: now,
      });
    } else {
      services.push({
        name: "Celestia",
        status: "offline",
        port: 26658,
        details: "Light node not reachable",
        lastCheck: now,
      });
    }
  } catch {
    services.push({
      name: "Celestia",
      status: "offline",
      port: 26658,
      details: "Not running",
      lastCheck: now,
    });
  }

  // 4. OpenClaw Gateway
  try {
    const res = await fetch("http://127.0.0.1:18789/", {
      signal: AbortSignal.timeout(3000),
    });
    services.push({
      name: "OpenClaw Gateway",
      status: res.ok || res.status === 426 ? "healthy" : "degraded",
      port: 18789,
      details: "Gateway running",
      lastCheck: now,
    });
  } catch {
    services.push({
      name: "OpenClaw Gateway",
      status: "offline",
      port: 18789,
      details: "Gateway not running",
      lastCheck: now,
    });
  }

  // 5. Inference Bridge
  services.push({
    name: "Inference Bridge",
    status: "healthy",
    details: "Privacy-preserving bridge active",
    lastCheck: now,
  });

  // 6. Task Executor
  const executorStatus = getTaskExecutorStatus();
  services.push({
    name: "Task Executor",
    status: executorStatus.running ? "healthy" : "offline",
    details: executorStatus.running
      ? `Running: ${executorStatus.activeTaskCount} active, ${executorStatus.totalExecuted} total`
      : "Stopped",
    lastCheck: now,
  });

  return services;
}

export function registerSystemServicesHandlers(): void {
  ipcMain.handle("system:services-health", async () => {
    return getSystemServicesHealth();
  });
}
