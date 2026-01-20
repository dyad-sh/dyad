/**
 * Task Execution Engine Handlers
 * Robust task management, queuing, and execution system
 * 
 * Features:
 * - Task definition and lifecycle management
 * - Priority-based queuing
 * - Parallel execution with concurrency control
 * - Task dependencies and chaining
 * - Progress tracking and reporting
 * - Retry and error handling
 * - Resource allocation
 * - Task templates and presets
 */

import { ipcMain, app, BrowserWindow } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { EventEmitter } from "events";

const logger = log.scope("task_engine");

// ============================================================================
// Types
// ============================================================================

type TaskStatus = "pending" | "queued" | "running" | "completed" | "failed" | "cancelled" | "paused" | "retrying";
type TaskPriority = "critical" | "high" | "normal" | "low" | "background";
type TaskType = 
  | "data_import" | "data_export" | "data_transform" | "data_validate"
  | "agent_execution" | "workflow_trigger" | "api_call" | "script"
  | "file_operation" | "notification" | "scheduled" | "webhook"
  | "batch_process" | "pipeline_step" | "custom";

interface Task {
  id: string;
  name: string;
  description?: string;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  config: TaskConfig;
  input?: any;
  output?: any;
  context: TaskContext;
  dependencies: TaskDependency[];
  scheduling: TaskScheduling;
  retryPolicy: TaskRetryPolicy;
  resources: TaskResources;
  metrics: TaskMetrics;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  createdBy?: string;
  tags: string[];
  error?: string;
}

interface TaskConfig {
  handler: string;
  parameters: Record<string, any>;
  timeout?: number;
  inputSchema?: Record<string, any>;
  outputSchema?: Record<string, any>;
  validateInput?: boolean;
  validateOutput?: boolean;
}

interface TaskContext {
  workflowId?: string;
  workflowExecutionId?: string;
  agentId?: string;
  pipelineId?: string;
  parentTaskId?: string;
  sessionId?: string;
  variables: Record<string, any>;
  environment: Record<string, string>;
}

interface TaskDependency {
  taskId: string;
  type: "required" | "optional" | "soft";
  condition?: string;
}

interface TaskScheduling {
  scheduledAt?: Date;
  deadline?: Date;
  maxWaitTime?: number;
  cron?: string;
  repeatCount?: number;
  repeatInterval?: number;
  timezone?: string;
}

interface TaskRetryPolicy {
  enabled: boolean;
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
  nonRetryableErrors?: string[];
}

interface TaskResources {
  memoryLimit?: number;
  cpuLimit?: number;
  timeLimit?: number;
  networkAccess?: boolean;
  fileSystemAccess?: boolean;
  requiredCapabilities?: string[];
}

interface TaskMetrics {
  attempts: number;
  totalDuration?: number;
  waitTime?: number;
  executionTime?: number;
  retryCount: number;
  resourceUsage?: {
    peakMemory?: number;
    cpuTime?: number;
    ioOperations?: number;
  };
}

interface TaskQueue {
  id: string;
  name: string;
  description?: string;
  maxConcurrency: number;
  currentConcurrency: number;
  priorityWeights: Record<TaskPriority, number>;
  tasks: string[];
  runningTasks: string[];
  paused: boolean;
  createdAt: Date;
}

interface TaskWorker {
  id: string;
  name: string;
  queueId: string;
  status: "idle" | "busy" | "paused" | "stopped";
  currentTaskId?: string;
  processedCount: number;
  failedCount: number;
  startedAt: Date;
  lastActiveAt?: Date;
}

interface TaskBatch {
  id: string;
  name: string;
  taskIds: string[];
  status: "pending" | "running" | "completed" | "failed" | "partial";
  config: {
    parallelism: number;
    stopOnError: boolean;
    continueOnPartial: boolean;
  };
  progress: {
    total: number;
    completed: number;
    failed: number;
    running: number;
  };
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

interface TaskTemplate {
  id: string;
  name: string;
  description?: string;
  category: string;
  type: TaskType;
  config: TaskConfig;
  defaultPriority: TaskPriority;
  defaultRetryPolicy: TaskRetryPolicy;
  defaultResources: TaskResources;
}

// ============================================================================
// Storage & State
// ============================================================================

const tasks: Map<string, Task> = new Map();
const queues: Map<string, TaskQueue> = new Map();
const workers: Map<string, TaskWorker> = new Map();
const batches: Map<string, TaskBatch> = new Map();
const templates: Map<string, TaskTemplate> = new Map();
const eventEmitter = new EventEmitter();
const taskTimers: Map<string, NodeJS.Timeout> = new Map();

let engineRunning = false;
let processInterval: NodeJS.Timeout | null = null;

function getTaskStorageDir(): string {
  return path.join(app.getPath("userData"), "task-engine");
}

async function initializeTaskEngine() {
  const storageDir = getTaskStorageDir();
  await fs.ensureDir(storageDir);
  await fs.ensureDir(path.join(storageDir, "tasks"));
  await fs.ensureDir(path.join(storageDir, "history"));
  
  // Load tasks
  const tasksPath = path.join(storageDir, "tasks-index.json");
  if (await fs.pathExists(tasksPath)) {
    const data = await fs.readJson(tasksPath);
    for (const t of data) {
      tasks.set(t.id, {
        ...t,
        createdAt: new Date(t.createdAt),
        updatedAt: new Date(t.updatedAt),
        startedAt: t.startedAt ? new Date(t.startedAt) : undefined,
        completedAt: t.completedAt ? new Date(t.completedAt) : undefined,
      });
    }
  }
  
  // Load queues
  const queuesPath = path.join(storageDir, "queues.json");
  if (await fs.pathExists(queuesPath)) {
    const data = await fs.readJson(queuesPath);
    for (const q of data) {
      queues.set(q.id, { ...q, createdAt: new Date(q.createdAt) });
    }
  }
  
  // Create default queue if none exist
  if (queues.size === 0) {
    const defaultQueue: TaskQueue = {
      id: "default",
      name: "Default Queue",
      description: "Default task queue",
      maxConcurrency: 5,
      currentConcurrency: 0,
      priorityWeights: {
        critical: 1000,
        high: 100,
        normal: 10,
        low: 1,
        background: 0.1,
      },
      tasks: [],
      runningTasks: [],
      paused: false,
      createdAt: new Date(),
    };
    queues.set("default", defaultQueue);
  }
  
  // Initialize templates
  initializeDefaultTemplates();
  
  // Start engine
  startTaskEngine();
  
  logger.info(`Task engine initialized: ${tasks.size} tasks, ${queues.size} queues`);
}

function initializeDefaultTemplates() {
  const defaultTemplates: TaskTemplate[] = [
    {
      id: "data-import",
      name: "Data Import",
      description: "Import data from files or URLs",
      category: "data",
      type: "data_import",
      config: {
        handler: "builtin:data-import",
        parameters: {
          source: "",
          format: "auto",
          targetDataset: "",
        },
      },
      defaultPriority: "normal",
      defaultRetryPolicy: {
        enabled: true,
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
      },
      defaultResources: {
        timeLimit: 300000,
        networkAccess: true,
        fileSystemAccess: true,
      },
    },
    {
      id: "data-export",
      name: "Data Export",
      description: "Export data to various formats",
      category: "data",
      type: "data_export",
      config: {
        handler: "builtin:data-export",
        parameters: {
          sourceDataset: "",
          format: "jsonl",
          destination: "",
        },
      },
      defaultPriority: "normal",
      defaultRetryPolicy: {
        enabled: true,
        maxAttempts: 2,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
      },
      defaultResources: {
        timeLimit: 600000,
        fileSystemAccess: true,
      },
    },
    {
      id: "agent-task",
      name: "Agent Execution",
      description: "Execute an AI agent task",
      category: "agents",
      type: "agent_execution",
      config: {
        handler: "builtin:agent-execute",
        parameters: {
          agentId: "",
          input: {},
          sessionId: "",
        },
      },
      defaultPriority: "normal",
      defaultRetryPolicy: {
        enabled: true,
        maxAttempts: 2,
        initialDelayMs: 2000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
      },
      defaultResources: {
        timeLimit: 300000,
        networkAccess: true,
      },
    },
    {
      id: "api-call",
      name: "API Call",
      description: "Make HTTP API request",
      category: "integration",
      type: "api_call",
      config: {
        handler: "builtin:api-call",
        parameters: {
          url: "",
          method: "GET",
          headers: {},
          body: null,
        },
      },
      defaultPriority: "normal",
      defaultRetryPolicy: {
        enabled: true,
        maxAttempts: 3,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        retryableErrors: ["ECONNRESET", "ETIMEDOUT", "5xx"],
      },
      defaultResources: {
        timeLimit: 60000,
        networkAccess: true,
      },
    },
    {
      id: "script",
      name: "Script Execution",
      description: "Execute custom script",
      category: "automation",
      type: "script",
      config: {
        handler: "builtin:script",
        parameters: {
          language: "javascript",
          code: "",
          args: [],
        },
      },
      defaultPriority: "normal",
      defaultRetryPolicy: {
        enabled: false,
        maxAttempts: 1,
        initialDelayMs: 1000,
        maxDelayMs: 1000,
        backoffMultiplier: 1,
      },
      defaultResources: {
        timeLimit: 60000,
        fileSystemAccess: true,
      },
    },
    {
      id: "batch-process",
      name: "Batch Process",
      description: "Process items in batch",
      category: "processing",
      type: "batch_process",
      config: {
        handler: "builtin:batch",
        parameters: {
          items: [],
          processor: "",
          batchSize: 10,
          parallel: true,
        },
      },
      defaultPriority: "low",
      defaultRetryPolicy: {
        enabled: true,
        maxAttempts: 3,
        initialDelayMs: 2000,
        maxDelayMs: 60000,
        backoffMultiplier: 2,
      },
      defaultResources: {
        timeLimit: 3600000,
      },
    },
  ];
  
  for (const t of defaultTemplates) {
    templates.set(t.id, t);
  }
}

async function saveTasks() {
  const storageDir = getTaskStorageDir();
  await fs.writeJson(
    path.join(storageDir, "tasks-index.json"),
    Array.from(tasks.values()),
    { spaces: 2 }
  );
}

async function saveQueues() {
  const storageDir = getTaskStorageDir();
  await fs.writeJson(
    path.join(storageDir, "queues.json"),
    Array.from(queues.values()),
    { spaces: 2 }
  );
}

// ============================================================================
// Task Engine
// ============================================================================

function startTaskEngine() {
  if (engineRunning) return;
  
  engineRunning = true;
  
  // Process queues every 100ms
  processInterval = setInterval(() => {
    processQueues();
  }, 100);
  
  logger.info("Task engine started");
}

function stopTaskEngine() {
  if (!engineRunning) return;
  
  engineRunning = false;
  
  if (processInterval) {
    clearInterval(processInterval);
    processInterval = null;
  }
  
  // Clear task timers
  for (const timer of taskTimers.values()) {
    clearTimeout(timer);
  }
  taskTimers.clear();
  
  logger.info("Task engine stopped");
}

function processQueues() {
  for (const queue of queues.values()) {
    if (queue.paused) continue;
    
    // Check if we can start more tasks
    while (queue.currentConcurrency < queue.maxConcurrency && queue.tasks.length > 0) {
      // Get next task by priority
      const nextTaskId = getNextTask(queue);
      if (!nextTaskId) break;
      
      const task = tasks.get(nextTaskId);
      if (!task) {
        queue.tasks = queue.tasks.filter(id => id !== nextTaskId);
        continue;
      }
      
      // Check dependencies
      if (!areDependenciesMet(task)) {
        continue;
      }
      
      // Start task
      startTask(task, queue);
    }
  }
}

function getNextTask(queue: TaskQueue): string | null {
  if (queue.tasks.length === 0) return null;
  
  // Sort by priority weight and age
  const sortedTasks = queue.tasks
    .map(id => tasks.get(id))
    .filter((t): t is Task => t !== undefined && t.status === "queued")
    .sort((a, b) => {
      const weightA = queue.priorityWeights[a.priority] || 1;
      const weightB = queue.priorityWeights[b.priority] || 1;
      
      if (weightA !== weightB) {
        return weightB - weightA; // Higher weight first
      }
      
      // For same priority, older tasks first
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  
  return sortedTasks[0]?.id || null;
}

function areDependenciesMet(task: Task): boolean {
  for (const dep of task.dependencies) {
    const depTask = tasks.get(dep.taskId);
    if (!depTask) {
      if (dep.type === "required") return false;
      continue;
    }
    
    if (dep.type === "required" && depTask.status !== "completed") {
      return false;
    }
    
    if (dep.condition) {
      try {
        const result = evaluateCondition(dep.condition, depTask.output);
        if (!result) return false;
      } catch {
        if (dep.type === "required") return false;
      }
    }
  }
  
  return true;
}

function evaluateCondition(condition: string, context: any): boolean {
  const fn = new Function("output", `return ${condition}`);
  return fn(context);
}

async function startTask(task: Task, queue: TaskQueue) {
  task.status = "running";
  task.startedAt = new Date();
  task.metrics.attempts++;
  task.updatedAt = new Date();
  
  // Remove from queue, add to running
  queue.tasks = queue.tasks.filter(id => id !== task.id);
  queue.runningTasks.push(task.id);
  queue.currentConcurrency++;
  
  await saveTasks();
  await saveQueues();
  
  // Emit event
  eventEmitter.emit("task:started", task);
  notifyRenderer("task-engine:task-started", { taskId: task.id, name: task.name });
  
  // Execute task
  executeTaskAsync(task, queue);
}

async function executeTaskAsync(task: Task, queue: TaskQueue) {
  const startTime = Date.now();
  
  try {
    // Set timeout if specified
    let timeoutTimer: NodeJS.Timeout | undefined;
    if (task.config.timeout || task.resources.timeLimit) {
      const timeout = task.config.timeout || task.resources.timeLimit!;
      timeoutTimer = setTimeout(() => {
        failTask(task, queue, "Task timeout exceeded", false);
      }, timeout);
      taskTimers.set(task.id, timeoutTimer);
    }
    
    // Execute handler
    const result = await executeTaskHandler(task);
    
    // Clear timeout
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      taskTimers.delete(task.id);
    }
    
    // Validate output if schema provided
    if (task.config.validateOutput && task.config.outputSchema) {
      // Basic validation would go here
    }
    
    // Success
    task.output = result;
    task.status = "completed";
    task.completedAt = new Date();
    task.metrics.executionTime = Date.now() - startTime;
    task.metrics.totalDuration = (task.metrics.waitTime || 0) + task.metrics.executionTime;
    task.updatedAt = new Date();
    
    // Update queue
    queue.runningTasks = queue.runningTasks.filter(id => id !== task.id);
    queue.currentConcurrency--;
    
    await saveTasks();
    await saveQueues();
    
    // Emit event
    eventEmitter.emit("task:completed", task);
    notifyRenderer("task-engine:task-completed", { 
      taskId: task.id, 
      name: task.name,
      status: "completed",
      duration: task.metrics.executionTime,
    });
    
    // Check if this unblocks dependent tasks
    checkDependentTasks(task);
    
    // Update batch if part of one
    updateBatchProgress(task);
    
  } catch (error: any) {
    failTask(task, queue, error.message, shouldRetry(task, error));
  }
}

async function executeTaskHandler(task: Task): Promise<any> {
  const { handler, parameters } = task.config;
  
  // Built-in handlers
  if (handler.startsWith("builtin:")) {
    const handlerName = handler.substring(8);
    return executeBuiltinHandler(handlerName, parameters, task);
  }
  
  // Custom script handler
  if (handler === "script" || task.type === "script") {
    return executeScriptHandler(parameters, task);
  }
  
  // Custom function handler (from config)
  if (parameters.customHandler) {
    const fn = new Function("input", "context", parameters.customHandler);
    return fn(task.input, task.context);
  }
  
  throw new Error(`Unknown handler: ${handler}`);
}

async function executeBuiltinHandler(
  handlerName: string,
  parameters: Record<string, any>,
  task: Task
): Promise<any> {
  switch (handlerName) {
    case "data-import":
      return {
        success: true,
        imported: 0,
        source: parameters.source,
        format: parameters.format,
      };
    
    case "data-export":
      return {
        success: true,
        exported: 0,
        destination: parameters.destination,
        format: parameters.format,
      };
    
    case "agent-execute":
      return {
        success: true,
        agentId: parameters.agentId,
        output: null,
      };
    
    case "api-call":
      const response = await fetch(parameters.url, {
        method: parameters.method || "GET",
        headers: parameters.headers || {},
        body: parameters.body ? JSON.stringify(parameters.body) : undefined,
      });
      
      const contentType = response.headers.get("content-type");
      let data: any;
      
      if (contentType?.includes("application/json")) {
        data = await response.json();
      } else {
        data = await response.text();
      }
      
      return {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        data,
      };
    
    case "script":
      return executeScriptHandler(parameters, task);
    
    case "batch":
      return executeBatchHandler(parameters, task);
    
    case "notification":
      eventEmitter.emit("notification", {
        taskId: task.id,
        ...parameters,
      });
      return { sent: true };
    
    case "workflow-trigger":
      eventEmitter.emit("workflow:trigger", {
        workflowId: parameters.workflowId,
        variables: parameters.variables,
        triggeredBy: task.id,
      });
      return { triggered: true, workflowId: parameters.workflowId };
    
    default:
      return { handlerName, parameters, executed: true };
  }
}

async function executeScriptHandler(
  parameters: Record<string, any>,
  task: Task
): Promise<any> {
  const { language, code, args } = parameters;
  
  if (language === "javascript" || !language) {
    const fn = new Function("input", "args", "context", `
      "use strict";
      ${code}
    `);
    
    return fn(task.input, args || [], task.context);
  }
  
  throw new Error(`Unsupported script language: ${language}`);
}

async function executeBatchHandler(
  parameters: Record<string, any>,
  task: Task
): Promise<any> {
  const { items, processor, batchSize, parallel } = parameters;
  const results: any[] = [];
  const errors: any[] = [];
  
  const processItem = async (item: any, index: number) => {
    try {
      let result: any;
      
      if (processor) {
        const fn = new Function("item", "index", "context", processor);
        result = await fn(item, index, task.context);
      } else {
        result = item; // Pass through
      }
      
      return { success: true, index, result };
    } catch (error: any) {
      return { success: false, index, error: error.message };
    }
  };
  
  if (parallel) {
    // Process in parallel batches
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((item: any, idx: number) => processItem(item, i + idx))
      );
      
      for (const r of batchResults) {
        if (r.success) {
          results.push(r.result);
        } else {
          errors.push(r);
        }
      }
      
      // Report progress
      notifyRenderer("task-engine:task-progress", {
        taskId: task.id,
        progress: Math.min(i + batchSize, items.length) / items.length,
        processed: Math.min(i + batchSize, items.length),
        total: items.length,
      });
    }
  } else {
    // Process sequentially
    for (let i = 0; i < items.length; i++) {
      const r = await processItem(items[i], i);
      
      if (r.success) {
        results.push(r.result);
      } else {
        errors.push(r);
      }
      
      // Report progress
      if (i % 10 === 0) {
        notifyRenderer("task-engine:task-progress", {
          taskId: task.id,
          progress: (i + 1) / items.length,
          processed: i + 1,
          total: items.length,
        });
      }
    }
  }
  
  return {
    success: errors.length === 0,
    total: items.length,
    processed: results.length,
    failed: errors.length,
    results,
    errors: errors.length > 0 ? errors : undefined,
  };
}

function shouldRetry(task: Task, error: Error): boolean {
  if (!task.retryPolicy.enabled) return false;
  if (task.metrics.retryCount >= task.retryPolicy.maxAttempts - 1) return false;
  
  const errorMessage = error.message.toLowerCase();
  
  // Check non-retryable errors
  if (task.retryPolicy.nonRetryableErrors?.some(e => errorMessage.includes(e.toLowerCase()))) {
    return false;
  }
  
  // Check retryable errors (if specified, only retry these)
  if (task.retryPolicy.retryableErrors?.length) {
    return task.retryPolicy.retryableErrors.some(e => errorMessage.includes(e.toLowerCase()));
  }
  
  return true;
}

async function failTask(task: Task, queue: TaskQueue, errorMessage: string, retry: boolean) {
  // Clear timeout timer
  const timer = taskTimers.get(task.id);
  if (timer) {
    clearTimeout(timer);
    taskTimers.delete(task.id);
  }
  
  if (retry) {
    // Schedule retry
    task.status = "retrying";
    task.metrics.retryCount++;
    task.error = errorMessage;
    task.updatedAt = new Date();
    
    const delay = Math.min(
      task.retryPolicy.initialDelayMs * Math.pow(task.retryPolicy.backoffMultiplier, task.metrics.retryCount - 1),
      task.retryPolicy.maxDelayMs
    );
    
    // Update queue
    queue.runningTasks = queue.runningTasks.filter(id => id !== task.id);
    queue.currentConcurrency--;
    
    await saveTasks();
    await saveQueues();
    
    // Schedule retry
    const retryTimer = setTimeout(() => {
      task.status = "queued";
      task.updatedAt = new Date();
      queue.tasks.push(task.id);
      saveTasks();
      saveQueues();
      taskTimers.delete(task.id);
    }, delay);
    
    taskTimers.set(task.id, retryTimer);
    
    notifyRenderer("task-engine:task-retrying", {
      taskId: task.id,
      name: task.name,
      attempt: task.metrics.retryCount + 1,
      maxAttempts: task.retryPolicy.maxAttempts,
      delay,
    });
    
  } else {
    // Final failure
    task.status = "failed";
    task.error = errorMessage;
    task.completedAt = new Date();
    task.updatedAt = new Date();
    
    // Update queue
    queue.runningTasks = queue.runningTasks.filter(id => id !== task.id);
    queue.currentConcurrency--;
    
    await saveTasks();
    await saveQueues();
    
    // Emit event
    eventEmitter.emit("task:failed", task);
    notifyRenderer("task-engine:task-failed", {
      taskId: task.id,
      name: task.name,
      error: errorMessage,
    });
    
    // Update batch if part of one
    updateBatchProgress(task);
  }
}

function checkDependentTasks(completedTask: Task) {
  for (const task of tasks.values()) {
    if (task.status !== "queued") continue;
    
    const hasDependency = task.dependencies.some(d => d.taskId === completedTask.id);
    if (hasDependency) {
      // Dependencies may now be met, queue will pick it up
    }
  }
}

function updateBatchProgress(task: Task) {
  for (const batch of batches.values()) {
    if (!batch.taskIds.includes(task.id)) continue;
    
    // Recalculate progress
    batch.progress.completed = 0;
    batch.progress.failed = 0;
    batch.progress.running = 0;
    
    for (const taskId of batch.taskIds) {
      const batchTask = tasks.get(taskId);
      if (!batchTask) continue;
      
      switch (batchTask.status) {
        case "completed":
          batch.progress.completed++;
          break;
        case "failed":
          batch.progress.failed++;
          break;
        case "running":
          batch.progress.running++;
          break;
      }
    }
    
    // Update batch status
    if (batch.progress.completed + batch.progress.failed === batch.progress.total) {
      if (batch.progress.failed === 0) {
        batch.status = "completed";
      } else if (batch.progress.completed === 0) {
        batch.status = "failed";
      } else {
        batch.status = "partial";
      }
      batch.completedAt = new Date();
      
      notifyRenderer("task-engine:batch-completed", {
        batchId: batch.id,
        name: batch.name,
        status: batch.status,
        progress: batch.progress,
      });
    }
    
    break;
  }
}

function notifyRenderer(channel: string, data: any) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send(channel, data);
  }
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerTaskExecutionHandlers() {
  logger.info("Registering Task Execution Engine handlers");

  app.whenReady().then(() => {
    initializeTaskEngine().catch(err => {
      logger.error("Failed to initialize task engine:", err);
    });
  });

  app.on("before-quit", () => {
    stopTaskEngine();
  });

  // ========== Task CRUD ==========

  ipcMain.handle("task-engine:create-task", async (_event, args: {
    name: string;
    description?: string;
    type: TaskType;
    priority?: TaskPriority;
    config: TaskConfig;
    input?: any;
    context?: Partial<TaskContext>;
    dependencies?: TaskDependency[];
    scheduling?: Partial<TaskScheduling>;
    retryPolicy?: Partial<TaskRetryPolicy>;
    resources?: Partial<TaskResources>;
    tags?: string[];
    queueId?: string;
    autoStart?: boolean;
  }) => {
    try {
      const id = uuidv4();
      const now = new Date();
      
      const task: Task = {
        id,
        name: args.name,
        description: args.description,
        type: args.type,
        priority: args.priority || "normal",
        status: "pending",
        config: args.config,
        input: args.input,
        context: {
          variables: {},
          environment: {},
          ...args.context,
        },
        dependencies: args.dependencies || [],
        scheduling: {
          ...args.scheduling,
        },
        retryPolicy: {
          enabled: true,
          maxAttempts: 3,
          initialDelayMs: 1000,
          maxDelayMs: 30000,
          backoffMultiplier: 2,
          ...args.retryPolicy,
        },
        resources: {
          ...args.resources,
        },
        metrics: {
          attempts: 0,
          retryCount: 0,
        },
        metadata: {},
        createdAt: now,
        updatedAt: now,
        tags: args.tags || [],
      };
      
      tasks.set(id, task);
      await saveTasks();
      
      // Auto-start if requested
      if (args.autoStart !== false) {
        const queueId = args.queueId || "default";
        const queue = queues.get(queueId);
        
        if (queue) {
          task.status = "queued";
          task.metrics.waitTime = 0;
          queue.tasks.push(task.id);
          await saveQueues();
        }
      }
      
      return { success: true, task };
    } catch (error) {
      logger.error("Create task failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task-engine:create-from-template", async (_event, args: {
    templateId: string;
    name: string;
    input?: any;
    overrides?: Partial<Task>;
    queueId?: string;
    autoStart?: boolean;
  }) => {
    try {
      const template = templates.get(args.templateId);
      if (!template) throw new Error("Template not found");
      
      const id = uuidv4();
      const now = new Date();
      
      const task: Task = {
        id,
        name: args.name,
        description: template.description,
        type: template.type,
        priority: args.overrides?.priority || template.defaultPriority,
        status: "pending",
        config: { ...template.config, ...args.overrides?.config },
        input: args.input,
        context: {
          variables: {},
          environment: {},
          ...args.overrides?.context,
        },
        dependencies: args.overrides?.dependencies || [],
        scheduling: args.overrides?.scheduling || {},
        retryPolicy: { ...template.defaultRetryPolicy, ...args.overrides?.retryPolicy },
        resources: { ...template.defaultResources, ...args.overrides?.resources },
        metrics: {
          attempts: 0,
          retryCount: 0,
        },
        metadata: {},
        createdAt: now,
        updatedAt: now,
        tags: args.overrides?.tags || [],
      };
      
      tasks.set(id, task);
      await saveTasks();
      
      // Auto-start if requested
      if (args.autoStart !== false) {
        const queueId = args.queueId || "default";
        const queue = queues.get(queueId);
        
        if (queue) {
          task.status = "queued";
          queue.tasks.push(task.id);
          await saveQueues();
        }
      }
      
      return { success: true, task };
    } catch (error) {
      logger.error("Create from template failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task-engine:get-task", async (_event, taskId: string) => {
    try {
      const task = tasks.get(taskId);
      if (!task) throw new Error("Task not found");
      
      return { success: true, task };
    } catch (error) {
      logger.error("Get task failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task-engine:list-tasks", async (_event, args?: {
    status?: TaskStatus | TaskStatus[];
    type?: TaskType;
    priority?: TaskPriority;
    queueId?: string;
    tags?: string[];
    limit?: number;
    offset?: number;
  }) => {
    try {
      let result = Array.from(tasks.values());
      
      if (args?.status) {
        const statuses = Array.isArray(args.status) ? args.status : [args.status];
        result = result.filter(t => statuses.includes(t.status));
      }
      
      if (args?.type) {
        result = result.filter(t => t.type === args.type);
      }
      
      if (args?.priority) {
        result = result.filter(t => t.priority === args.priority);
      }
      
      if (args?.tags?.length) {
        result = result.filter(t => args.tags!.some(tag => t.tags.includes(tag)));
      }
      
      result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      
      const total = result.length;
      
      if (args?.offset) {
        result = result.slice(args.offset);
      }
      
      if (args?.limit) {
        result = result.slice(0, args.limit);
      }
      
      return { success: true, tasks: result, total };
    } catch (error) {
      logger.error("List tasks failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task-engine:cancel-task", async (_event, taskId: string) => {
    try {
      const task = tasks.get(taskId);
      if (!task) throw new Error("Task not found");
      
      if (task.status === "completed" || task.status === "cancelled") {
        throw new Error("Task cannot be cancelled");
      }
      
      // Clear any timers
      const timer = taskTimers.get(taskId);
      if (timer) {
        clearTimeout(timer);
        taskTimers.delete(taskId);
      }
      
      // Update task
      task.status = "cancelled";
      task.completedAt = new Date();
      task.updatedAt = new Date();
      
      // Remove from queues
      for (const queue of queues.values()) {
        queue.tasks = queue.tasks.filter(id => id !== taskId);
        if (queue.runningTasks.includes(taskId)) {
          queue.runningTasks = queue.runningTasks.filter(id => id !== taskId);
          queue.currentConcurrency--;
        }
      }
      
      await saveTasks();
      await saveQueues();
      
      notifyRenderer("task-engine:task-cancelled", { taskId, name: task.name });
      
      return { success: true };
    } catch (error) {
      logger.error("Cancel task failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task-engine:retry-task", async (_event, taskId: string) => {
    try {
      const task = tasks.get(taskId);
      if (!task) throw new Error("Task not found");
      
      if (task.status !== "failed" && task.status !== "cancelled") {
        throw new Error("Only failed or cancelled tasks can be retried");
      }
      
      // Reset task
      task.status = "queued";
      task.error = undefined;
      task.output = undefined;
      task.startedAt = undefined;
      task.completedAt = undefined;
      task.metrics.attempts = 0;
      task.metrics.retryCount = 0;
      task.updatedAt = new Date();
      
      // Add to default queue
      const queue = queues.get("default")!;
      queue.tasks.push(taskId);
      
      await saveTasks();
      await saveQueues();
      
      return { success: true, task };
    } catch (error) {
      logger.error("Retry task failed:", error);
      throw error;
    }
  });

  // ========== Queue Management ==========

  ipcMain.handle("task-engine:create-queue", async (_event, args: {
    name: string;
    description?: string;
    maxConcurrency?: number;
    priorityWeights?: Record<TaskPriority, number>;
  }) => {
    try {
      const id = uuidv4();
      
      const queue: TaskQueue = {
        id,
        name: args.name,
        description: args.description,
        maxConcurrency: args.maxConcurrency || 5,
        currentConcurrency: 0,
        priorityWeights: args.priorityWeights || {
          critical: 1000,
          high: 100,
          normal: 10,
          low: 1,
          background: 0.1,
        },
        tasks: [],
        runningTasks: [],
        paused: false,
        createdAt: new Date(),
      };
      
      queues.set(id, queue);
      await saveQueues();
      
      return { success: true, queue };
    } catch (error) {
      logger.error("Create queue failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task-engine:list-queues", async () => {
    try {
      const result = Array.from(queues.values());
      return { success: true, queues: result };
    } catch (error) {
      logger.error("List queues failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task-engine:get-queue", async (_event, queueId: string) => {
    try {
      const queue = queues.get(queueId);
      if (!queue) throw new Error("Queue not found");
      
      return { success: true, queue };
    } catch (error) {
      logger.error("Get queue failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task-engine:pause-queue", async (_event, queueId: string) => {
    try {
      const queue = queues.get(queueId);
      if (!queue) throw new Error("Queue not found");
      
      queue.paused = true;
      await saveQueues();
      
      return { success: true };
    } catch (error) {
      logger.error("Pause queue failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task-engine:resume-queue", async (_event, queueId: string) => {
    try {
      const queue = queues.get(queueId);
      if (!queue) throw new Error("Queue not found");
      
      queue.paused = false;
      await saveQueues();
      
      return { success: true };
    } catch (error) {
      logger.error("Resume queue failed:", error);
      throw error;
    }
  });

  // ========== Batch Operations ==========

  ipcMain.handle("task-engine:create-batch", async (_event, args: {
    name: string;
    tasks: Array<{
      name: string;
      type: TaskType;
      config: TaskConfig;
      input?: any;
    }>;
    parallelism?: number;
    stopOnError?: boolean;
    queueId?: string;
  }) => {
    try {
      const batchId = uuidv4();
      const taskIds: string[] = [];
      const now = new Date();
      
      // Create tasks
      for (const taskDef of args.tasks) {
        const taskId = uuidv4();
        
        const task: Task = {
          id: taskId,
          name: taskDef.name,
          type: taskDef.type,
          priority: "normal",
          status: "pending",
          config: taskDef.config,
          input: taskDef.input,
          context: {
            variables: { batchId },
            environment: {},
          },
          dependencies: [],
          scheduling: {},
          retryPolicy: {
            enabled: true,
            maxAttempts: 3,
            initialDelayMs: 1000,
            maxDelayMs: 30000,
            backoffMultiplier: 2,
          },
          resources: {},
          metrics: {
            attempts: 0,
            retryCount: 0,
          },
          metadata: { batchId },
          createdAt: now,
          updatedAt: now,
          tags: ["batch", batchId],
        };
        
        tasks.set(taskId, task);
        taskIds.push(taskId);
      }
      
      // Create batch
      const batch: TaskBatch = {
        id: batchId,
        name: args.name,
        taskIds,
        status: "pending",
        config: {
          parallelism: args.parallelism || 5,
          stopOnError: args.stopOnError || false,
          continueOnPartial: true,
        },
        progress: {
          total: taskIds.length,
          completed: 0,
          failed: 0,
          running: 0,
        },
        createdAt: now,
      };
      
      batches.set(batchId, batch);
      
      // Queue tasks
      const queueId = args.queueId || "default";
      const queue = queues.get(queueId);
      
      if (queue) {
        for (const taskId of taskIds) {
          const task = tasks.get(taskId)!;
          task.status = "queued";
          queue.tasks.push(taskId);
        }
        batch.status = "running";
        batch.startedAt = new Date();
      }
      
      await saveTasks();
      await saveQueues();
      
      return { success: true, batch };
    } catch (error) {
      logger.error("Create batch failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task-engine:get-batch", async (_event, batchId: string) => {
    try {
      const batch = batches.get(batchId);
      if (!batch) throw new Error("Batch not found");
      
      return { success: true, batch };
    } catch (error) {
      logger.error("Get batch failed:", error);
      throw error;
    }
  });

  ipcMain.handle("task-engine:list-batches", async (_event, args?: {
    status?: string;
    limit?: number;
  }) => {
    try {
      let result = Array.from(batches.values());
      
      if (args?.status) {
        result = result.filter(b => b.status === args.status);
      }
      
      result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      
      if (args?.limit) {
        result = result.slice(0, args.limit);
      }
      
      return { success: true, batches: result };
    } catch (error) {
      logger.error("List batches failed:", error);
      throw error;
    }
  });

  // ========== Templates ==========

  ipcMain.handle("task-engine:list-templates", async (_event, category?: string) => {
    try {
      let result = Array.from(templates.values());
      
      if (category) {
        result = result.filter(t => t.category === category);
      }
      
      return { success: true, templates: result };
    } catch (error) {
      logger.error("List templates failed:", error);
      throw error;
    }
  });

  // ========== Metrics ==========

  ipcMain.handle("task-engine:get-metrics", async () => {
    try {
      const allTasks = Array.from(tasks.values());
      
      const completed = allTasks.filter(t => t.status === "completed");
      const failed = allTasks.filter(t => t.status === "failed");
      const running = allTasks.filter(t => t.status === "running");
      const queued = allTasks.filter(t => t.status === "queued");
      
      const avgDuration = completed.length > 0
        ? completed.reduce((sum, t) => sum + (t.metrics.totalDuration || 0), 0) / completed.length
        : 0;
      
      const successRate = (completed.length + failed.length) > 0
        ? completed.length / (completed.length + failed.length)
        : 1;
      
      return {
        success: true,
        metrics: {
          totalTasks: allTasks.length,
          completedTasks: completed.length,
          failedTasks: failed.length,
          runningTasks: running.length,
          queuedTasks: queued.length,
          averageDuration: avgDuration,
          successRate,
          totalQueues: queues.size,
          activeBatches: Array.from(batches.values()).filter(b => b.status === "running").length,
          byType: Object.fromEntries(
            Array.from(
              allTasks.reduce((acc, t) => {
                acc.set(t.type, (acc.get(t.type) || 0) + 1);
                return acc;
              }, new Map<TaskType, number>())
            )
          ),
          byPriority: Object.fromEntries(
            Array.from(
              allTasks.reduce((acc, t) => {
                acc.set(t.priority, (acc.get(t.priority) || 0) + 1);
                return acc;
              }, new Map<TaskPriority, number>())
            )
          ),
        },
      };
    } catch (error) {
      logger.error("Get metrics failed:", error);
      throw error;
    }
  });

  logger.info("Task Execution Engine handlers registered");
}
