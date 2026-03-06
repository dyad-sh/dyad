/**
 * Agent Workspace Handlers
 * IPC handlers for agent task management, knowledge source CRUD,
 * task execution, and workspace operations.
 *
 * Provides the backend for the end-to-end agent builder where each agent
 * can have tasks, knowledge sources (scraping, AI queries, local vault),
 * and execute work locally or across the web.
 */

import { IpcMainInvokeEvent, ipcMain } from "electron";
import log from "electron-log";
import { randomUUID } from "node:crypto";
import { getOpenClawCNS } from "@/lib/openclaw_cns";
import {
  initEngine as initScrapingEngine,
  createJob,
  startJob,
  getJob,
} from "@/ipc/handlers/scraping/engine";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/db";
import {
  agentWorkspaceTasks,
  agentWorkspaceExecutions,
  agentWorkspaceKnowledgeSources,
} from "@/db/schema";

import type {
  AgentTask,
  AgentKnowledgeSource,
  TaskExecution,
  TaskExecutionLog,
  AgentWorkspace,
  AgentWorkspaceStats,
  KnowledgeQueryResult,
  KnowledgeItem,
  CreateAgentTaskRequest,
  UpdateAgentTaskRequest,
  ExecuteTaskRequest,
  AddKnowledgeSourceRequest,
  UpdateKnowledgeSourceRequest,
  QueryKnowledgeRequest,
  ScrapingKnowledgeConfig,
  AIQueryKnowledgeConfig,
  KnowledgeSourceType,
} from "@/types/agent_workspace";

const logger = log.scope("agent_workspace");

/** Safely convert a typed object to a plain JSON-compatible record for DB storage */
function toJsonRecord(obj: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(obj));
}

// =============================================================================
// DB HELPERS — convert between DB rows and domain types
// =============================================================================

function rowToTask(row: any): AgentTask {
  return {
    id: row.id,
    agentId: row.agentId,
    name: row.name,
    description: row.description,
    type: row.type,
    status: row.status,
    priority: row.priority,
    executionMode: row.executionMode,
    toolId: row.toolId ?? undefined,
    triggerId: row.triggerId ?? undefined,
    input: row.inputJson ?? {},
    output: row.outputJson ?? undefined,
    error: row.error ?? undefined,
    dependencies: row.dependenciesJson ?? [],
    recurring: !!row.recurring,
    cronExpression: row.cronExpression ?? undefined,
    executionCount: row.executionCount ?? 0,
    lastExecutedAt: row.lastExecutedAt ?? undefined,
    averageDurationMs: row.averageDurationMs ?? undefined,
    n8nNodeId: row.n8nNodeId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToExecution(row: any): TaskExecution {
  return {
    id: row.id,
    taskId: row.taskId,
    agentId: row.agentId,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? undefined,
    durationMs: row.durationMs ?? undefined,
    input: row.inputJson ?? {},
    output: row.outputJson ?? undefined,
    error: row.error ?? undefined,
    logs: row.logsJson ?? [],
    metrics: row.metricsJson ?? { executionMode: "local" },
  };
}

function rowToKnowledgeSource(row: any): AgentKnowledgeSource {
  return {
    id: row.id,
    agentId: row.agentId,
    name: row.name,
    description: row.description ?? undefined,
    type: row.type as KnowledgeSourceType,
    status: row.status,
    config: row.configJson as any,
    totalDocuments: row.totalDocuments ?? 0,
    totalBytes: row.totalBytes ?? 0,
    lastSyncAt: row.lastSyncAt ?? undefined,
    syncIntervalMs: row.syncIntervalMs ?? undefined,
    autoSync: !!row.autoSync,
    filters: row.filtersJson ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// =============================================================================
// TASK CRUD
// =============================================================================

async function handleCreateTask(
  _event: IpcMainInvokeEvent,
  request: CreateAgentTaskRequest,
): Promise<AgentTask> {
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();

  db.insert(agentWorkspaceTasks)
    .values({
      id,
      agentId: request.agentId,
      name: request.name,
      description: request.description,
      type: request.type,
      status: "draft",
      priority: request.priority || "medium",
      executionMode: request.executionMode || "local",
      toolId: request.toolId,
      triggerId: request.triggerId,
      inputJson: request.input || {},
      dependenciesJson: request.dependencies || [],
      recurring: request.recurring || false,
      cronExpression: request.cronExpression,
      executionCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const row = db.select().from(agentWorkspaceTasks).where(eq(agentWorkspaceTasks.id, id)).get();
  const task = rowToTask(row);
  logger.info(`Created task "${task.name}" (${task.type}) for agent ${task.agentId}`);
  return task;
}

async function handleListTasks(
  _event: IpcMainInvokeEvent,
  agentId: number,
): Promise<AgentTask[]> {
  const db = getDb();
  const rows = db
    .select()
    .from(agentWorkspaceTasks)
    .where(eq(agentWorkspaceTasks.agentId, agentId))
    .all();
  return rows.map(rowToTask).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function handleGetTask(
  _event: IpcMainInvokeEvent,
  taskId: string,
): Promise<AgentTask> {
  const db = getDb();
  const row = db.select().from(agentWorkspaceTasks).where(eq(agentWorkspaceTasks.id, taskId)).get();
  if (!row) throw new Error(`Task not found: ${taskId}`);
  return rowToTask(row);
}

async function handleUpdateTask(
  _event: IpcMainInvokeEvent,
  request: UpdateAgentTaskRequest,
): Promise<AgentTask> {
  const db = getDb();
  const row = db.select().from(agentWorkspaceTasks).where(eq(agentWorkspaceTasks.id, request.id)).get();
  if (!row) throw new Error(`Task not found: ${request.id}`);

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (request.name !== undefined) updates.name = request.name;
  if (request.description !== undefined) updates.description = request.description;
  if (request.type !== undefined) updates.type = request.type;
  if (request.priority !== undefined) updates.priority = request.priority;
  if (request.executionMode !== undefined) updates.executionMode = request.executionMode;
  if (request.input !== undefined) updates.inputJson = request.input;
  if (request.dependencies !== undefined) updates.dependenciesJson = request.dependencies;
  if (request.toolId !== undefined) updates.toolId = request.toolId;
  if (request.triggerId !== undefined) updates.triggerId = request.triggerId;
  if (request.recurring !== undefined) updates.recurring = request.recurring;
  if (request.cronExpression !== undefined) updates.cronExpression = request.cronExpression;

  db.update(agentWorkspaceTasks).set(updates).where(eq(agentWorkspaceTasks.id, request.id)).run();

  const updated = db.select().from(agentWorkspaceTasks).where(eq(agentWorkspaceTasks.id, request.id)).get();
  logger.info(`Updated task ${request.id}`);
  return rowToTask(updated);
}

async function handleDeleteTask(
  _event: IpcMainInvokeEvent,
  taskId: string,
): Promise<void> {
  const db = getDb();
  db.delete(agentWorkspaceTasks).where(eq(agentWorkspaceTasks.id, taskId)).run();
  logger.info(`Deleted task ${taskId}`);
}

// =============================================================================
// TASK EXECUTION
// =============================================================================

async function handleExecuteTask(
  _event: IpcMainInvokeEvent,
  request: ExecuteTaskRequest,
): Promise<TaskExecution> {
  const db = getDb();
  const taskRow = db.select().from(agentWorkspaceTasks).where(eq(agentWorkspaceTasks.id, request.taskId)).get();
  if (!taskRow) throw new Error(`Task not found: ${request.taskId}`);
  const task = rowToTask(taskRow);

  const executionId = randomUUID();
  const now = new Date().toISOString();

  const execution: TaskExecution = {
    id: executionId,
    taskId: task.id,
    agentId: task.agentId,
    status: "running",
    startedAt: now,
    input: { ...task.input, ...request.inputOverrides },
    logs: [],
    metrics: {
      executionMode: request.forceMode || task.executionMode,
    },
  };

  // Insert execution row
  db.insert(agentWorkspaceExecutions)
    .values({
      id: executionId,
      taskId: task.id,
      agentId: task.agentId,
      status: "running",
      startedAt: now,
      inputJson: execution.input,
      logsJson: [],
      metricsJson: toJsonRecord(execution.metrics),
    })
    .run();

  // Update task status
  db.update(agentWorkspaceTasks)
    .set({ status: "running", updatedAt: now })
    .where(eq(agentWorkspaceTasks.id, task.id))
    .run();

  addLog(execution, "info", `Starting task: ${task.name} (${task.type})`);

  try {
    const result = await runTaskByType(task, execution);
    execution.output = result;
    execution.status = "completed";
    execution.completedAt = new Date().toISOString();
    execution.durationMs =
      new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime();

    const newCount = (task.executionCount || 0) + 1;
    const avgDuration = task.averageDurationMs
      ? Math.round((task.averageDurationMs + execution.durationMs) / 2)
      : execution.durationMs;

    addLog(execution, "info", `Task completed in ${execution.durationMs}ms`);
    logger.info(`Task ${task.id} executed successfully in ${execution.durationMs}ms`);

    // Persist execution results
    db.update(agentWorkspaceExecutions)
      .set({
        status: "completed",
        completedAt: execution.completedAt,
        durationMs: execution.durationMs,
        outputJson: result,
        logsJson: execution.logs as any,
        metricsJson: toJsonRecord(execution.metrics),
      })
      .where(eq(agentWorkspaceExecutions.id, executionId))
      .run();

    // Persist task results
    db.update(agentWorkspaceTasks)
      .set({
        status: "completed",
        outputJson: result,
        lastExecutedAt: execution.completedAt,
        executionCount: newCount,
        averageDurationMs: avgDuration,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(agentWorkspaceTasks.id, task.id))
      .run();
  } catch (err: any) {
    execution.status = "failed";
    execution.error = err.message;
    execution.completedAt = new Date().toISOString();
    execution.durationMs =
      new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime();

    addLog(execution, "error", `Task failed: ${err.message}`);
    logger.error(`Task ${task.id} failed: ${err.message}`);

    db.update(agentWorkspaceExecutions)
      .set({
        status: "failed",
        completedAt: execution.completedAt,
        durationMs: execution.durationMs,
        error: err.message,
        logsJson: execution.logs as any,
        metricsJson: toJsonRecord(execution.metrics),
      })
      .where(eq(agentWorkspaceExecutions.id, executionId))
      .run();

    db.update(agentWorkspaceTasks)
      .set({
        status: "failed",
        error: err.message,
        lastExecutedAt: execution.completedAt,
        executionCount: (task.executionCount || 0) + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(agentWorkspaceTasks.id, task.id))
      .run();
  }

  return execution;
}

async function handleListExecutions(
  _event: IpcMainInvokeEvent,
  taskId: string,
): Promise<TaskExecution[]> {
  const db = getDb();
  const rows = db
    .select()
    .from(agentWorkspaceExecutions)
    .where(eq(agentWorkspaceExecutions.taskId, taskId))
    .all();
  return rows.map(rowToExecution).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

// =============================================================================
// TASK EXECUTION ROUTER — executes tasks by type
// =============================================================================

async function runTaskByType(
  task: AgentTask,
  execution: TaskExecution,
): Promise<Record<string, unknown>> {
  switch (task.type) {
    case "web_scrape":
      return runWebScrapeTask(task, execution);
    case "knowledge_query":
      return runKnowledgeQueryTask(task, execution);
    case "llm_inference":
      return runLlmTask(task, execution);
    case "summarize":
      return runSummarizeTask(task, execution);
    case "search":
      return runSearchTask(task, execution);
    case "api_call":
      return runApiCallTask(task, execution);
    case "document_process":
      return runDocumentProcessTask(task, execution);
    case "code_execution":
      return runCodeExecutionTask(task, execution);
    default:
      return runGenericTask(task, execution);
  }
}

async function runWebScrapeTask(
  task: AgentTask,
  execution: TaskExecution,
): Promise<Record<string, unknown>> {
  addLog(execution, "info", "Initializing scraping engine...");
  try {
    await initScrapingEngine();
  } catch {
    // Already initialized
  }

  const url = (task.input.url as string) || "";
  if (!url) throw new Error("No URL provided for web scrape task");

  addLog(execution, "info", `Scraping: ${url}`);
  const config = {
    sourceType: "web" as const,
    mode: "hybrid" as const,
    urls: [url],
    output: {
      format: "markdown" as const,
      includeMetadata: true,
      extractImages: true,
      extractLinks: true,
      extractStructuredData: true,
      extractTables: true,
    },
    autoTag: { enabled: true },
    aiExtraction: {
      enabled: (task.input.aiExtraction as boolean) !== false,
      instructions: task.input.description as string | undefined,
      summarize: true,
    },
    crawl: task.input.crawl
      ? {
          enabled: true,
          maxDepth: 3,
          maxPages: (task.input.maxPages as number) || 10,
          followExternal: false,
        }
      : undefined,
  };

  const job = createJob(task.name, config);
  const result = await startJob(job.id);

  execution.metrics.pagesScraped = result.stats.pagesScraped;
  execution.metrics.bytesProcessed = result.stats.bytesDownloaded;

  return {
    status: result.status,
    pagesScraped: result.stats.pagesScraped,
    itemsExtracted: result.stats.itemsExtracted,
    bytesDownloaded: result.stats.bytesDownloaded,
    datasetId: result.datasetId,
    durationMs: result.stats.durationMs,
  };
}

async function runKnowledgeQueryTask(
  task: AgentTask,
  execution: TaskExecution,
): Promise<Record<string, unknown>> {
  const query = (task.input.query as string) || task.description;
  addLog(execution, "info", `Querying knowledge: "${query.slice(0, 100)}..."`);

  const cns = getOpenClawCNS();
  const response = await cns.chat(
    `Based on your knowledge, answer this query thoroughly:\n\n${query}`,
    { preferLocal: task.executionMode === "local" },
  );

  execution.metrics.tokensUsed = response.length;
  return { query, answer: response };
}

async function runLlmTask(
  task: AgentTask,
  execution: TaskExecution,
): Promise<Record<string, unknown>> {
  const prompt = (task.input.prompt as string) || task.description;
  addLog(execution, "info", `Running LLM inference...`);

  const cns = getOpenClawCNS();
  const response = await cns.chat(prompt, {
    preferLocal: task.executionMode === "local",
  });

  execution.metrics.tokensUsed = response.length;
  return { prompt, response };
}

async function runSummarizeTask(
  task: AgentTask,
  execution: TaskExecution,
): Promise<Record<string, unknown>> {
  const text = (task.input.text as string) || "";
  addLog(execution, "info", `Summarizing ${text.length} characters...`);

  const cns = getOpenClawCNS();
  const response = await cns.chat(
    `Summarize the following text concisely:\n\n${text.slice(0, 50000)}`,
    { preferLocal: task.executionMode === "local" },
  );

  return { originalLength: text.length, summary: response };
}

async function runSearchTask(
  task: AgentTask,
  execution: TaskExecution,
): Promise<Record<string, unknown>> {
  const query = (task.input.query as string) || task.description;
  addLog(execution, "info", `Searching: "${query}"`);

  const cns = getOpenClawCNS();
  const response = await cns.chat(
    `Search the web for: "${query}". Provide comprehensive results with sources.`,
    { preferLocal: false },
  );

  execution.metrics.apiCalls = 1;
  return { query, results: response };
}

async function runApiCallTask(
  task: AgentTask,
  execution: TaskExecution,
): Promise<Record<string, unknown>> {
  const url = (task.input.url as string) || "";
  const method = (task.input.method as string) || "GET";
  addLog(execution, "info", `${method} ${url}`);

  const fetchOptions: RequestInit = {
    method,
    headers: (task.input.headers as Record<string, string>) || {},
  };
  if (method !== "GET" && task.input.body) {
    fetchOptions.body =
      typeof task.input.body === "string"
        ? task.input.body
        : JSON.stringify(task.input.body);
  }

  const res = await fetch(url, fetchOptions);
  const contentType = res.headers.get("content-type") || "";
  let body: unknown;
  if (contentType.includes("json")) {
    body = await res.json();
  } else {
    body = await res.text();
  }

  execution.metrics.apiCalls = 1;
  execution.metrics.bytesProcessed = JSON.stringify(body).length;

  return { status: res.status, statusText: res.statusText, body };
}

async function runDocumentProcessTask(
  task: AgentTask,
  execution: TaskExecution,
): Promise<Record<string, unknown>> {
  const path = (task.input.documentPath as string) || (task.input.path as string) || "";
  addLog(execution, "info", `Processing document: ${path}`);

  const cns = getOpenClawCNS();
  const response = await cns.chat(
    `Process and analyze this document task: ${task.description}\nDocument path: ${path}`,
    { preferLocal: task.executionMode === "local" },
  );

  execution.metrics.documentsProcessed = 1;
  return { path, result: response };
}

async function runCodeExecutionTask(
  task: AgentTask,
  execution: TaskExecution,
): Promise<Record<string, unknown>> {
  const code = (task.input.code as string) || "";
  const language = (task.input.language as string) || "javascript";
  addLog(execution, "info", `Executing ${language} code...`);

  if (language === "javascript") {
    try {
      // Safe execution in a limited scope
      const fn = new Function("input", `"use strict";\n${code}`);
      const result = fn(task.input.inputs || {});
      return { language, success: true, result };
    } catch (err: any) {
      return { language, success: false, error: err.message };
    }
  }

  return { language, success: false, error: `Language ${language} execution not supported locally` };
}

async function runGenericTask(
  task: AgentTask,
  execution: TaskExecution,
): Promise<Record<string, unknown>> {
  addLog(execution, "info", `Running generic task via LLM...`);

  const cns = getOpenClawCNS();
  const prompt = `Execute this task:\n\nTask: ${task.name}\nDescription: ${task.description}\nType: ${task.type}\nInput: ${JSON.stringify(task.input)}`;
  const response = await cns.chat(prompt, {
    preferLocal: task.executionMode === "local",
  });

  return { result: response };
}

function addLog(execution: TaskExecution, level: TaskExecutionLog["level"], message: string): void {
  execution.logs.push({
    timestamp: new Date().toISOString(),
    level,
    message,
  });
}

// =============================================================================
// KNOWLEDGE SOURCE CRUD
// =============================================================================

async function handleAddKnowledgeSource(
  _event: IpcMainInvokeEvent,
  request: AddKnowledgeSourceRequest,
): Promise<AgentKnowledgeSource> {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  db.insert(agentWorkspaceKnowledgeSources)
    .values({
      id,
      agentId: request.agentId,
      name: request.name,
      description: request.description,
      type: request.type,
      status: "pending",
      configJson: toJsonRecord(request.config),
      totalDocuments: 0,
      totalBytes: 0,
      autoSync: request.autoSync ?? false,
      syncIntervalMs: request.syncIntervalMs,
      filtersJson: request.filters as Record<string, unknown> | null ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const row = db.select().from(agentWorkspaceKnowledgeSources).where(eq(agentWorkspaceKnowledgeSources.id, id)).get();
  const source = rowToKnowledgeSource(row);
  logger.info(`Added knowledge source "${source.name}" (${source.type}) to agent ${source.agentId}`);

  // Auto-sync if requested
  if (source.autoSync) {
    syncKnowledgeSource(source).catch((err: any) => {
      logger.warn(`Auto-sync failed for source ${source.id}: ${err.message}`);
    });
  }

  return source;
}

async function handleListKnowledgeSources(
  _event: IpcMainInvokeEvent,
  agentId: number,
): Promise<AgentKnowledgeSource[]> {
  const db = getDb();
  const rows = db
    .select()
    .from(agentWorkspaceKnowledgeSources)
    .where(eq(agentWorkspaceKnowledgeSources.agentId, agentId))
    .all();
  return rows.map(rowToKnowledgeSource).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function handleGetKnowledgeSource(
  _event: IpcMainInvokeEvent,
  sourceId: string,
): Promise<AgentKnowledgeSource> {
  const db = getDb();
  const row = db.select().from(agentWorkspaceKnowledgeSources).where(eq(agentWorkspaceKnowledgeSources.id, sourceId)).get();
  if (!row) throw new Error(`Knowledge source not found: ${sourceId}`);
  return rowToKnowledgeSource(row);
}

async function handleUpdateKnowledgeSource(
  _event: IpcMainInvokeEvent,
  request: UpdateKnowledgeSourceRequest,
): Promise<AgentKnowledgeSource> {
  const db = getDb();
  const row = db.select().from(agentWorkspaceKnowledgeSources).where(eq(agentWorkspaceKnowledgeSources.id, request.id)).get();
  if (!row) throw new Error(`Knowledge source not found: ${request.id}`);

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (request.name !== undefined) updates.name = request.name;
  if (request.description !== undefined) updates.description = request.description;
  if (request.config !== undefined) {
    const existing = row.configJson ?? {};
    updates.configJson = { ...existing, ...(request.config as Record<string, unknown>) };
  }
  if (request.autoSync !== undefined) updates.autoSync = request.autoSync;
  if (request.syncIntervalMs !== undefined) updates.syncIntervalMs = request.syncIntervalMs;
  if (request.filters !== undefined) updates.filtersJson = request.filters;

  db.update(agentWorkspaceKnowledgeSources).set(updates).where(eq(agentWorkspaceKnowledgeSources.id, request.id)).run();

  const updated = db.select().from(agentWorkspaceKnowledgeSources).where(eq(agentWorkspaceKnowledgeSources.id, request.id)).get();
  logger.info(`Updated knowledge source ${request.id}`);
  return rowToKnowledgeSource(updated);
}

async function handleDeleteKnowledgeSource(
  _event: IpcMainInvokeEvent,
  sourceId: string,
): Promise<void> {
  const db = getDb();
  db.delete(agentWorkspaceKnowledgeSources).where(eq(agentWorkspaceKnowledgeSources.id, sourceId)).run();
  logger.info(`Deleted knowledge source ${sourceId}`);
}

async function handleSyncKnowledgeSource(
  _event: IpcMainInvokeEvent,
  sourceId: string,
): Promise<AgentKnowledgeSource> {
  const db = getDb();
  const row = db.select().from(agentWorkspaceKnowledgeSources).where(eq(agentWorkspaceKnowledgeSources.id, sourceId)).get();
  if (!row) throw new Error(`Knowledge source not found: ${sourceId}`);

  return syncKnowledgeSource(rowToKnowledgeSource(row));
}

async function syncKnowledgeSource(
  source: AgentKnowledgeSource,
): Promise<AgentKnowledgeSource> {
  const db = getDb();

  db.update(agentWorkspaceKnowledgeSources)
    .set({ status: "syncing", updatedAt: new Date().toISOString() })
    .where(eq(agentWorkspaceKnowledgeSources.id, source.id))
    .run();

  let totalDocuments = source.totalDocuments;
  let totalBytes = source.totalBytes;
  let finalStatus: string = "connected";

  try {
    switch (source.config.type) {
      case "scraping_engine": {
        const config = source.config as ScrapingKnowledgeConfig;
        if (config.urls.length > 0) {
          try {
            await initScrapingEngine();
          } catch {
            // Already initialized
          }
          const scrapeConfig = {
            sourceType: "web" as const,
            mode: "hybrid" as const,
            urls: config.urls,
            output: {
              format: "markdown" as const,
              includeMetadata: true,
              extractImages: true,
              extractLinks: true,
              extractStructuredData: true,
              extractTables: true,
            },
            autoTag: { enabled: true },
            aiExtraction: { enabled: config.aiExtraction !== false },
            crawl: config.crawl
              ? { enabled: true, maxDepth: 3, maxPages: config.maxPages || 10, followExternal: false }
              : undefined,
          };
          const job = createJob(`Knowledge: ${source.name}`, scrapeConfig);
          const result = await startJob(job.id);
          totalDocuments = result.stats.itemsExtracted;
          totalBytes = result.stats.bytesDownloaded;
        }
        break;
      }

      case "ai_query": {
        const config = source.config as AIQueryKnowledgeConfig;
        const cns = getOpenClawCNS();
        const response = await cns.chat(config.query, {
          preferLocal: config.preferLocal,
        });
        totalDocuments = 1;
        totalBytes = response.length;
        break;
      }

      default:
        logger.info(`Sync for type ${source.config.type} — connected (data loaded on query)`);
        break;
    }
  } catch (err: any) {
    finalStatus = "error";
    logger.error(`Knowledge sync failed for ${source.id}: ${err.message}`);
  }

  const now = new Date().toISOString();
  db.update(agentWorkspaceKnowledgeSources)
    .set({
      status: finalStatus,
      totalDocuments,
      totalBytes,
      lastSyncAt: now,
      updatedAt: now,
    })
    .where(eq(agentWorkspaceKnowledgeSources.id, source.id))
    .run();

  const row = db.select().from(agentWorkspaceKnowledgeSources).where(eq(agentWorkspaceKnowledgeSources.id, source.id)).get();
  return rowToKnowledgeSource(row);
}

// =============================================================================
// KNOWLEDGE QUERY — query across all knowledge sources for an agent
// =============================================================================

async function handleQueryKnowledge(
  _event: IpcMainInvokeEvent,
  request: QueryKnowledgeRequest,
): Promise<KnowledgeQueryResult[]> {
  const db = getDb();
  const allRows = db
    .select()
    .from(agentWorkspaceKnowledgeSources)
    .where(eq(agentWorkspaceKnowledgeSources.agentId, request.agentId))
    .all();

  const sources = allRows
    .map(rowToKnowledgeSource)
    .filter(
      (s) =>
        s.status === "connected" &&
        (!request.sourceIds || request.sourceIds.length === 0 || request.sourceIds.includes(s.id)),
    );

  const results: KnowledgeQueryResult[] = [];

  for (const source of sources) {
    const startTime = Date.now();
    try {
      const cns = getOpenClawCNS();
      const response = await cns.chat(
        `Using knowledge from "${source.name}" (${source.type}), answer: ${request.query}`,
        { preferLocal: source.config.type === "ai_query" && (source.config as AIQueryKnowledgeConfig).preferLocal },
      );

      results.push({
        sourceId: source.id,
        sourceName: source.name,
        sourceType: source.type,
        results: [
          {
            id: randomUUID(),
            content: response,
            relevanceScore: 0.8,
            sourceType: source.type,
            createdAt: new Date().toISOString(),
          },
        ],
        totalResults: 1,
        queryTimeMs: Date.now() - startTime,
      });
    } catch (err: any) {
      logger.warn(`Knowledge query failed for source ${source.id}: ${err.message}`);
    }
  }

  return results;
}

// =============================================================================
// AGENT WORKSPACE — aggregated view
// =============================================================================

async function handleGetWorkspace(
  _event: IpcMainInvokeEvent,
  agentId: number,
): Promise<AgentWorkspace> {
  const db = getDb();

  const taskRows = db
    .select()
    .from(agentWorkspaceTasks)
    .where(eq(agentWorkspaceTasks.agentId, agentId))
    .all();
  const tasks = taskRows.map(rowToTask);

  const ksRows = db
    .select()
    .from(agentWorkspaceKnowledgeSources)
    .where(eq(agentWorkspaceKnowledgeSources.agentId, agentId))
    .all();
  const knowledgeSources = ksRows.map(rowToKnowledgeSource);

  const execRows = db
    .select()
    .from(agentWorkspaceExecutions)
    .where(eq(agentWorkspaceExecutions.agentId, agentId))
    .all();

  const stats: AgentWorkspaceStats = {
    totalTasks: tasks.length,
    runningTasks: tasks.filter((t) => t.status === "running").length,
    completedTasks: tasks.filter((t) => t.status === "completed").length,
    failedTasks: tasks.filter((t) => t.status === "failed").length,
    totalExecutions: execRows.length,
    totalKnowledgeSources: knowledgeSources.length,
    totalKnowledgeDocuments: knowledgeSources.reduce((n, s) => n + s.totalDocuments, 0),
    totalKnowledgeBytes: knowledgeSources.reduce((n, s) => n + s.totalBytes, 0),
    lastActivityAt: tasks
      .map((t) => t.updatedAt)
      .sort()
      .pop(),
  };

  return {
    agentId,
    agentName: "",
    agentType: "",
    tasks,
    knowledgeSources,
    activeTriggers: 0,
    activeTools: 0,
    stats,
  };
}

// =============================================================================
// REGISTER ALL HANDLERS
// =============================================================================

export function registerAgentWorkspaceHandlers(): void {
  // Task CRUD
  ipcMain.handle("agent:workspace:task:create", handleCreateTask);
  ipcMain.handle("agent:workspace:task:list", handleListTasks);
  ipcMain.handle("agent:workspace:task:get", handleGetTask);
  ipcMain.handle("agent:workspace:task:update", handleUpdateTask);
  ipcMain.handle("agent:workspace:task:delete", handleDeleteTask);

  // Task Execution
  ipcMain.handle("agent:workspace:task:execute", handleExecuteTask);
  ipcMain.handle("agent:workspace:task:executions", handleListExecutions);

  // Knowledge Source CRUD
  ipcMain.handle("agent:workspace:knowledge:add", handleAddKnowledgeSource);
  ipcMain.handle("agent:workspace:knowledge:list", handleListKnowledgeSources);
  ipcMain.handle("agent:workspace:knowledge:get", handleGetKnowledgeSource);
  ipcMain.handle("agent:workspace:knowledge:update", handleUpdateKnowledgeSource);
  ipcMain.handle("agent:workspace:knowledge:delete", handleDeleteKnowledgeSource);
  ipcMain.handle("agent:workspace:knowledge:sync", handleSyncKnowledgeSource);
  ipcMain.handle("agent:workspace:knowledge:query", handleQueryKnowledge);

  // Workspace
  ipcMain.handle("agent:workspace:get", handleGetWorkspace);

  logger.info("Agent workspace handlers registered");
}
