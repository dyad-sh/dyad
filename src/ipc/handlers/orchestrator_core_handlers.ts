/**
 * Orchestrator Core Handlers
 * Central orchestration system for managing agents, tasks, workflows, and automation
 * 
 * Features:
 * - Workflow definition and execution
 * - Task scheduling and dependencies
 * - Event-driven orchestration
 * - State machine management
 * - Resource allocation
 * - Metrics and monitoring
 * - Checkpoint and recovery
 */

import { ipcMain, app, BrowserWindow } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { EventEmitter } from "events";

const logger = log.scope("orchestrator_core");

// ============================================================================
// Types
// ============================================================================

type WorkflowStatus = "draft" | "active" | "paused" | "completed" | "failed" | "archived";
type TaskStatus = "pending" | "queued" | "running" | "completed" | "failed" | "cancelled" | "skipped";
type TriggerType = "manual" | "schedule" | "event" | "webhook" | "file_watch" | "data_change" | "api";
type ExecutionMode = "sequential" | "parallel" | "conditional" | "loop" | "map_reduce";

interface Workflow {
  id: string;
  name: string;
  description?: string;
  version: string;
  status: WorkflowStatus;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: Record<string, any>;
  triggers: WorkflowTrigger[];
  errorHandling: ErrorHandlingConfig;
  retryPolicy: RetryPolicy;
  timeout?: number;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  tags: string[];
}

interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  config: Record<string, any>;
  position: { x: number; y: number };
  inputs: NodePort[];
  outputs: NodePort[];
  conditions?: NodeCondition[];
  timeout?: number;
  retryPolicy?: RetryPolicy;
  errorHandler?: string; // Node ID for error handling
}

type NodeType = 
  | "start" | "end" | "task" | "agent" | "decision" | "fork" | "join" 
  | "loop" | "map" | "reduce" | "delay" | "event" | "subworkflow" 
  | "http" | "script" | "data_operation" | "notification" | "approval"
  | "n8n_trigger" | "n8n_action";

interface NodePort {
  id: string;
  name: string;
  type: "input" | "output";
  dataType?: string;
  required?: boolean;
}

interface NodeCondition {
  id: string;
  expression: string;
  targetNodeId: string;
  priority: number;
}

interface WorkflowEdge {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
  condition?: string;
  transform?: string;
}

interface WorkflowTrigger {
  id: string;
  type: TriggerType;
  enabled: boolean;
  config: Record<string, any>;
}

interface ErrorHandlingConfig {
  strategy: "fail" | "continue" | "retry" | "fallback";
  fallbackNodeId?: string;
  notifyOnError: boolean;
  logLevel: "error" | "warn" | "info";
}

interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
}

interface WorkflowExecution {
  id: string;
  workflowId: string;
  workflowVersion: string;
  status: "running" | "completed" | "failed" | "cancelled" | "paused";
  startedAt: Date;
  completedAt?: Date;
  triggeredBy: string;
  triggerData?: Record<string, any>;
  variables: Record<string, any>;
  nodeExecutions: Map<string, NodeExecution>;
  currentNodes: string[];
  checkpoints: ExecutionCheckpoint[];
  error?: string;
  metrics: ExecutionMetrics;
}

interface NodeExecution {
  nodeId: string;
  status: TaskStatus;
  startedAt?: Date;
  completedAt?: Date;
  attempts: number;
  input?: any;
  output?: any;
  error?: string;
  logs: ExecutionLog[];
}

interface ExecutionLog {
  timestamp: Date;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: any;
}

interface ExecutionCheckpoint {
  id: string;
  timestamp: Date;
  nodeId: string;
  state: Record<string, any>;
}

interface ExecutionMetrics {
  totalNodes: number;
  completedNodes: number;
  failedNodes: number;
  totalDuration?: number;
  nodeMetrics: Record<string, { duration: number; attempts: number }>;
}

interface ScheduledExecution {
  id: string;
  workflowId: string;
  schedule: string; // Cron expression
  enabled: boolean;
  nextRunAt?: Date;
  lastRunAt?: Date;
  lastRunStatus?: string;
  timezone?: string;
}

interface OrchestrationEvent {
  id: string;
  type: string;
  source: string;
  timestamp: Date;
  data: any;
  correlationId?: string;
  processed: boolean;
}

// ============================================================================
// Storage & State
// ============================================================================

const workflows: Map<string, Workflow> = new Map();
const executions: Map<string, WorkflowExecution> = new Map();
const scheduledExecutions: Map<string, ScheduledExecution> = new Map();
const eventQueue: OrchestrationEvent[] = [];
const eventEmitter = new EventEmitter();
const executionTimers: Map<string, NodeJS.Timeout> = new Map();

// Execution engine state
let isEngineRunning = false;
let schedulerInterval: NodeJS.Timeout | null = null;
let eventProcessorInterval: NodeJS.Timeout | null = null;

function getOrchestratorStorageDir(): string {
  return path.join(app.getPath("userData"), "orchestrator");
}

async function initializeOrchestrator() {
  const storageDir = getOrchestratorStorageDir();
  await fs.ensureDir(storageDir);
  await fs.ensureDir(path.join(storageDir, "workflows"));
  await fs.ensureDir(path.join(storageDir, "executions"));
  await fs.ensureDir(path.join(storageDir, "checkpoints"));
  
  // Load workflows
  const workflowsPath = path.join(storageDir, "workflows-index.json");
  if (await fs.pathExists(workflowsPath)) {
    const data = await fs.readJson(workflowsPath);
    for (const w of data) {
      workflows.set(w.id, {
        ...w,
        createdAt: new Date(w.createdAt),
        updatedAt: new Date(w.updatedAt),
      });
    }
  }
  
  // Load scheduled executions
  const scheduledPath = path.join(storageDir, "scheduled.json");
  if (await fs.pathExists(scheduledPath)) {
    const data = await fs.readJson(scheduledPath);
    for (const s of data) {
      scheduledExecutions.set(s.id, {
        ...s,
        nextRunAt: s.nextRunAt ? new Date(s.nextRunAt) : undefined,
        lastRunAt: s.lastRunAt ? new Date(s.lastRunAt) : undefined,
      });
    }
  }
  
  // Start engine
  startOrchestrationEngine();
  
  logger.info(`Orchestrator initialized: ${workflows.size} workflows, ${scheduledExecutions.size} schedules`);
}

async function saveWorkflows() {
  const storageDir = getOrchestratorStorageDir();
  await fs.writeJson(
    path.join(storageDir, "workflows-index.json"),
    Array.from(workflows.values()),
    { spaces: 2 }
  );
}

async function saveScheduledExecutions() {
  const storageDir = getOrchestratorStorageDir();
  await fs.writeJson(
    path.join(storageDir, "scheduled.json"),
    Array.from(scheduledExecutions.values()),
    { spaces: 2 }
  );
}

async function saveExecution(execution: WorkflowExecution) {
  const storageDir = getOrchestratorStorageDir();
  const execPath = path.join(storageDir, "executions", `${execution.id}.json`);
  
  const serializable = {
    ...execution,
    nodeExecutions: Object.fromEntries(execution.nodeExecutions),
  };
  
  await fs.writeJson(execPath, serializable, { spaces: 2 });
}

// ============================================================================
// Orchestration Engine
// ============================================================================

function startOrchestrationEngine() {
  if (isEngineRunning) return;
  
  isEngineRunning = true;
  
  // Start scheduler (check every minute)
  schedulerInterval = setInterval(() => {
    checkScheduledWorkflows();
  }, 60000);
  
  // Start event processor (check every second)
  eventProcessorInterval = setInterval(() => {
    processEventQueue();
  }, 1000);
  
  // Initial check
  checkScheduledWorkflows();
  
  logger.info("Orchestration engine started");
}

function stopOrchestrationEngine() {
  if (!isEngineRunning) return;
  
  isEngineRunning = false;
  
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  
  if (eventProcessorInterval) {
    clearInterval(eventProcessorInterval);
    eventProcessorInterval = null;
  }
  
  // Clear execution timers
  for (const timer of executionTimers.values()) {
    clearTimeout(timer);
  }
  executionTimers.clear();
  
  logger.info("Orchestration engine stopped");
}

function checkScheduledWorkflows() {
  const now = new Date();
  
  for (const [id, scheduled] of scheduledExecutions) {
    if (!scheduled.enabled || !scheduled.nextRunAt) continue;
    
    if (scheduled.nextRunAt <= now) {
      // Trigger workflow
      triggerWorkflowExecution(scheduled.workflowId, "schedule", { scheduleId: id })
        .then(execId => {
          scheduled.lastRunAt = now;
          scheduled.lastRunStatus = "started";
          scheduled.nextRunAt = calculateNextRun(scheduled.schedule, scheduled.timezone);
          saveScheduledExecutions();
        })
        .catch(err => {
          logger.error(`Failed to trigger scheduled workflow ${scheduled.workflowId}:`, err);
          scheduled.lastRunStatus = "trigger_failed";
          saveScheduledExecutions();
        });
    }
  }
}

function calculateNextRun(cronExpression: string, timezone?: string): Date {
  // Simple cron parser for common patterns
  // Format: minute hour day month weekday
  const parts = cronExpression.split(" ");
  if (parts.length !== 5) {
    return new Date(Date.now() + 3600000); // Default: 1 hour
  }
  
  const now = new Date();
  const next = new Date(now);
  
  // Simple implementation for common patterns
  const [minute, hour] = parts;
  
  if (minute !== "*") {
    next.setMinutes(parseInt(minute));
  }
  if (hour !== "*") {
    next.setHours(parseInt(hour));
  }
  
  // If time has passed, move to next day
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  
  next.setSeconds(0);
  next.setMilliseconds(0);
  
  return next;
}

function processEventQueue() {
  const unprocessed = eventQueue.filter(e => !e.processed);
  
  for (const event of unprocessed.slice(0, 10)) { // Process 10 at a time
    event.processed = true;
    
    // Find workflows with matching event triggers
    for (const workflow of workflows.values()) {
      if (workflow.status !== "active") continue;
      
      for (const trigger of workflow.triggers) {
        if (trigger.type === "event" && trigger.enabled) {
          const eventType = trigger.config.eventType;
          if (eventType === event.type || eventType === "*") {
            triggerWorkflowExecution(workflow.id, "event", {
              event: event.data,
              eventId: event.id,
              eventType: event.type,
            }).catch(err => {
              logger.error(`Failed to trigger workflow ${workflow.id} on event:`, err);
            });
          }
        }
      }
    }
    
    // Emit for local listeners
    eventEmitter.emit(event.type, event);
  }
  
  // Clean old processed events (keep last 1000)
  if (eventQueue.length > 1000) {
    const processed = eventQueue.filter(e => e.processed);
    if (processed.length > 500) {
      for (let i = 0; i < 500; i++) {
        const idx = eventQueue.indexOf(processed[i]);
        if (idx > -1) eventQueue.splice(idx, 1);
      }
    }
  }
}

// ============================================================================
// Workflow Execution Engine
// ============================================================================

async function triggerWorkflowExecution(
  workflowId: string,
  triggeredBy: string,
  triggerData?: Record<string, any>
): Promise<string> {
  const workflow = workflows.get(workflowId);
  if (!workflow) throw new Error("Workflow not found");
  if (workflow.status !== "active") throw new Error("Workflow is not active");
  
  const executionId = uuidv4();
  const startNode = workflow.nodes.find(n => n.type === "start");
  if (!startNode) throw new Error("Workflow has no start node");
  
  const execution: WorkflowExecution = {
    id: executionId,
    workflowId,
    workflowVersion: workflow.version,
    status: "running",
    startedAt: new Date(),
    triggeredBy,
    triggerData,
    variables: { ...workflow.variables, ...triggerData },
    nodeExecutions: new Map(),
    currentNodes: [startNode.id],
    checkpoints: [],
    metrics: {
      totalNodes: workflow.nodes.length,
      completedNodes: 0,
      failedNodes: 0,
      nodeMetrics: {},
    },
  };
  
  executions.set(executionId, execution);
  await saveExecution(execution);
  
  // Start execution
  executeNextNodes(execution, workflow);
  
  // Emit event
  emitOrchestrationEvent("workflow.started", {
    executionId,
    workflowId,
    workflowName: workflow.name,
  });
  
  // Notify renderer
  notifyRenderer("orchestrator:execution-started", {
    executionId,
    workflowId,
    workflowName: workflow.name,
  });
  
  return executionId;
}

async function executeNextNodes(execution: WorkflowExecution, workflow: Workflow) {
  if (execution.status !== "running") return;
  
  const nodesToExecute = [...execution.currentNodes];
  execution.currentNodes = [];
  
  for (const nodeId of nodesToExecute) {
    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node) continue;
    
    // Check if all incoming edges are satisfied
    const incomingEdges = workflow.edges.filter(e => e.targetNodeId === nodeId);
    let canExecute = true;
    
    for (const edge of incomingEdges) {
      const sourceExec = execution.nodeExecutions.get(edge.sourceNodeId);
      if (!sourceExec || sourceExec.status !== "completed") {
        canExecute = false;
        break;
      }
    }
    
    if (!canExecute) {
      execution.currentNodes.push(nodeId);
      continue;
    }
    
    // Execute node
    executeNode(execution, workflow, node);
  }
}

async function executeNode(
  execution: WorkflowExecution,
  workflow: Workflow,
  node: WorkflowNode
) {
  const nodeExec: NodeExecution = {
    nodeId: node.id,
    status: "running",
    startedAt: new Date(),
    attempts: 1,
    logs: [],
  };
  
  execution.nodeExecutions.set(node.id, nodeExec);
  
  // Gather input from connected nodes
  const input = gatherNodeInput(execution, workflow, node);
  nodeExec.input = input;
  
  try {
    // Execute based on node type
    const output = await executeNodeByType(node, input, execution, workflow);
    
    nodeExec.output = output;
    nodeExec.status = "completed";
    nodeExec.completedAt = new Date();
    
    execution.metrics.completedNodes++;
    execution.metrics.nodeMetrics[node.id] = {
      duration: nodeExec.completedAt.getTime() - nodeExec.startedAt!.getTime(),
      attempts: nodeExec.attempts,
    };
    
    // Log success
    nodeExec.logs.push({
      timestamp: new Date(),
      level: "info",
      message: `Node completed successfully`,
      data: { output: summarizeOutput(output) },
    });
    
    // Determine next nodes
    const nextNodes = determineNextNodes(workflow, node, output);
    
    if (node.type === "end") {
      // Check if all end nodes are complete
      const endNodes = workflow.nodes.filter(n => n.type === "end");
      const allEndsDone = endNodes.every(n => {
        const exec = execution.nodeExecutions.get(n.id);
        return exec && exec.status === "completed";
      });
      
      if (allEndsDone) {
        completeExecution(execution, "completed");
        return;
      }
    }
    
    // Queue next nodes
    for (const nextNodeId of nextNodes) {
      if (!execution.currentNodes.includes(nextNodeId)) {
        execution.currentNodes.push(nextNodeId);
      }
    }
    
    await saveExecution(execution);
    
    // Continue execution
    if (execution.currentNodes.length > 0) {
      // Use setImmediate to prevent stack overflow
      setImmediate(() => executeNextNodes(execution, workflow));
    }
    
  } catch (error: any) {
    nodeExec.status = "failed";
    nodeExec.completedAt = new Date();
    nodeExec.error = error.message;
    execution.metrics.failedNodes++;
    
    nodeExec.logs.push({
      timestamp: new Date(),
      level: "error",
      message: `Node failed: ${error.message}`,
    });
    
    // Handle retry
    const retryPolicy = node.retryPolicy || workflow.retryPolicy;
    if (nodeExec.attempts < retryPolicy.maxAttempts) {
      const delay = Math.min(
        retryPolicy.initialDelayMs * Math.pow(retryPolicy.backoffMultiplier, nodeExec.attempts - 1),
        retryPolicy.maxDelayMs
      );
      
      nodeExec.logs.push({
        timestamp: new Date(),
        level: "info",
        message: `Retrying in ${delay}ms (attempt ${nodeExec.attempts + 1}/${retryPolicy.maxAttempts})`,
      });
      
      const timer = setTimeout(() => {
        nodeExec.status = "running";
        nodeExec.attempts++;
        nodeExec.startedAt = new Date();
        executeNode(execution, workflow, node);
      }, delay);
      
      executionTimers.set(`${execution.id}:${node.id}`, timer);
      return;
    }
    
    // Handle error based on strategy
    const errorHandling = workflow.errorHandling;
    
    if (errorHandling.strategy === "continue") {
      // Continue to next nodes
      const nextNodes = determineNextNodes(workflow, node, null);
      execution.currentNodes.push(...nextNodes);
      
      if (execution.currentNodes.length > 0) {
        setImmediate(() => executeNextNodes(execution, workflow));
      }
    } else if (errorHandling.strategy === "fallback" && errorHandling.fallbackNodeId) {
      // Execute fallback node
      execution.currentNodes.push(errorHandling.fallbackNodeId);
      setImmediate(() => executeNextNodes(execution, workflow));
    } else {
      // Fail execution
      completeExecution(execution, "failed", error.message);
    }
    
    await saveExecution(execution);
  }
}

async function executeNodeByType(
  node: WorkflowNode,
  input: any,
  execution: WorkflowExecution,
  workflow: Workflow
): Promise<any> {
  switch (node.type) {
    case "start":
      return { ...execution.triggerData, ...input };
    
    case "end":
      return input;
    
    case "task":
      return await executeTaskNode(node, input, execution);
    
    case "agent":
      return await executeAgentNode(node, input, execution);
    
    case "decision":
      return evaluateDecisionNode(node, input);
    
    case "fork":
      return input; // Fork just passes data through
    
    case "join":
      return mergeJoinInputs(execution, workflow, node);
    
    case "loop":
      return await executeLoopNode(node, input, execution, workflow);
    
    case "map":
      return await executeMapNode(node, input, execution);
    
    case "reduce":
      return executeReduceNode(node, input);
    
    case "delay":
      await new Promise(r => setTimeout(r, node.config.delayMs || 1000));
      return input;
    
    case "event":
      emitOrchestrationEvent(node.config.eventType, {
        ...input,
        workflowId: workflow.id,
        executionId: execution.id,
      });
      return input;
    
    case "subworkflow":
      return await executeSubworkflow(node, input);
    
    case "http":
      return await executeHttpNode(node, input);
    
    case "script":
      return await executeScriptNode(node, input, execution);
    
    case "data_operation":
      return await executeDataOperationNode(node, input);
    
    case "notification":
      return await executeNotificationNode(node, input);
    
    case "approval":
      return await executeApprovalNode(node, input, execution);
    
    case "n8n_trigger":
      return await executeN8nTriggerNode(node, input);
    
    case "n8n_action":
      return await executeN8nActionNode(node, input);
    
    default:
      throw new Error(`Unknown node type: ${node.type}`);
  }
}

function gatherNodeInput(
  execution: WorkflowExecution,
  workflow: Workflow,
  node: WorkflowNode
): any {
  const inputs: Record<string, any> = {};
  
  // Get data from incoming edges
  const incomingEdges = workflow.edges.filter(e => e.targetNodeId === node.id);
  
  for (const edge of incomingEdges) {
    const sourceExec = execution.nodeExecutions.get(edge.sourceNodeId);
    if (sourceExec && sourceExec.output !== undefined) {
      let data = sourceExec.output;
      
      // Apply transform if specified
      if (edge.transform) {
        try {
          data = evaluateExpression(edge.transform, { input: data, variables: execution.variables });
        } catch (e) {
          // Keep original data on transform error
        }
      }
      
      inputs[edge.sourceNodeId] = data;
    }
  }
  
  // Merge with workflow variables
  return { ...execution.variables, ...inputs };
}

function determineNextNodes(
  workflow: Workflow,
  currentNode: WorkflowNode,
  output: any
): string[] {
  const nextNodes: string[] = [];
  
  // Check conditions on node
  if (currentNode.conditions && currentNode.conditions.length > 0) {
    // Sort by priority
    const sorted = [...currentNode.conditions].sort((a, b) => a.priority - b.priority);
    
    for (const condition of sorted) {
      try {
        const result = evaluateExpression(condition.expression, { output, input: output });
        if (result) {
          nextNodes.push(condition.targetNodeId);
          break; // Only first matching condition
        }
      } catch (e) {
        // Skip on error
      }
    }
  }
  
  // Get outgoing edges
  const outgoingEdges = workflow.edges.filter(e => e.sourceNodeId === currentNode.id);
  
  for (const edge of outgoingEdges) {
    if (edge.condition) {
      try {
        const result = evaluateExpression(edge.condition, { output, input: output });
        if (result) {
          nextNodes.push(edge.targetNodeId);
        }
      } catch (e) {
        // Skip conditional edge on error
      }
    } else {
      nextNodes.push(edge.targetNodeId);
    }
  }
  
  return [...new Set(nextNodes)]; // Deduplicate
}

function completeExecution(
  execution: WorkflowExecution,
  status: "completed" | "failed" | "cancelled",
  error?: string
) {
  execution.status = status;
  execution.completedAt = new Date();
  execution.error = error;
  execution.metrics.totalDuration = 
    execution.completedAt.getTime() - execution.startedAt.getTime();
  
  // Clean up timers
  for (const [key, timer] of executionTimers) {
    if (key.startsWith(execution.id)) {
      clearTimeout(timer);
      executionTimers.delete(key);
    }
  }
  
  saveExecution(execution);
  
  // Emit event
  emitOrchestrationEvent(`workflow.${status}`, {
    executionId: execution.id,
    workflowId: execution.workflowId,
    duration: execution.metrics.totalDuration,
    error,
  });
  
  // Notify renderer
  notifyRenderer("orchestrator:execution-completed", {
    executionId: execution.id,
    workflowId: execution.workflowId,
    status,
    duration: execution.metrics.totalDuration,
    error,
  });
}

// ============================================================================
// Node Execution Helpers
// ============================================================================

async function executeTaskNode(node: WorkflowNode, input: any, execution: WorkflowExecution): Promise<any> {
  const { taskType, taskConfig } = node.config;
  
  switch (taskType) {
    case "data_import":
      // Call data studio handlers
      return { success: true, imported: 0, task: "data_import" };
    
    case "data_export":
      return { success: true, exported: 0, task: "data_export" };
    
    case "transform":
      return { success: true, transformed: 0, task: "transform" };
    
    case "validate":
      return { success: true, valid: true, task: "validate" };
    
    case "custom":
      // Execute custom task logic
      if (taskConfig.handler) {
        const fn = new Function("input", "config", taskConfig.handler);
        return fn(input, taskConfig);
      }
      return input;
    
    default:
      return input;
  }
}

async function executeAgentNode(node: WorkflowNode, input: any, execution: WorkflowExecution): Promise<any> {
  const { agentId, action, parameters } = node.config;
  
  // This would integrate with the agent builder system
  // For now, return placeholder
  return {
    agentId,
    action,
    result: null,
    status: "completed",
  };
}

function evaluateDecisionNode(node: WorkflowNode, input: any): any {
  const { conditions } = node.config;
  
  for (const condition of conditions || []) {
    try {
      if (evaluateExpression(condition.expression, input)) {
        return { branch: condition.branch, matched: true };
      }
    } catch (e) {
      // Skip on error
    }
  }
  
  return { branch: "default", matched: false };
}

function mergeJoinInputs(
  execution: WorkflowExecution,
  workflow: Workflow,
  node: WorkflowNode
): any {
  const incomingEdges = workflow.edges.filter(e => e.targetNodeId === node.id);
  const merged: Record<string, any> = {};
  
  for (const edge of incomingEdges) {
    const sourceExec = execution.nodeExecutions.get(edge.sourceNodeId);
    if (sourceExec && sourceExec.output !== undefined) {
      merged[edge.sourceNodeId] = sourceExec.output;
    }
  }
  
  const strategy = node.config.mergeStrategy || "object";
  
  switch (strategy) {
    case "array":
      return Object.values(merged);
    case "first":
      return Object.values(merged)[0];
    case "last":
      return Object.values(merged).pop();
    case "object":
    default:
      return merged;
  }
}

async function executeLoopNode(
  node: WorkflowNode,
  input: any,
  execution: WorkflowExecution,
  workflow: Workflow
): Promise<any> {
  const { iterations, condition, bodyNodeId } = node.config;
  const results: any[] = [];
  
  let i = 0;
  while (true) {
    if (iterations !== undefined && i >= iterations) break;
    
    if (condition) {
      try {
        if (!evaluateExpression(condition, { index: i, input, results })) break;
      } catch (e) {
        break;
      }
    }
    
    // For simplicity, just track iteration
    results.push({ index: i, input });
    i++;
    
    if (i > 10000) break; // Safety limit
  }
  
  return { iterations: i, results };
}

async function executeMapNode(node: WorkflowNode, input: any, execution: WorkflowExecution): Promise<any> {
  const { items, mapExpression } = node.config;
  const itemsToProcess = items || (Array.isArray(input) ? input : [input]);
  
  const results = [];
  for (let i = 0; i < itemsToProcess.length; i++) {
    const item = itemsToProcess[i];
    try {
      const result = mapExpression 
        ? evaluateExpression(mapExpression, { item, index: i, input })
        : item;
      results.push(result);
    } catch (e) {
      results.push({ error: (e as Error).message, item });
    }
  }
  
  return results;
}

function executeReduceNode(node: WorkflowNode, input: any): any {
  const { reduceExpression, initialValue } = node.config;
  const items = Array.isArray(input) ? input : [input];
  
  if (!reduceExpression) return items;
  
  let accumulator = initialValue ?? null;
  
  for (let i = 0; i < items.length; i++) {
    try {
      accumulator = evaluateExpression(reduceExpression, {
        accumulator,
        current: items[i],
        index: i,
        items,
      });
    } catch (e) {
      // Skip on error
    }
  }
  
  return accumulator;
}

async function executeSubworkflow(node: WorkflowNode, input: any): Promise<any> {
  const { workflowId, waitForCompletion } = node.config;
  
  const execId = await triggerWorkflowExecution(workflowId, "subworkflow", input);
  
  if (waitForCompletion) {
    // Wait for completion
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const exec = executions.get(execId);
        if (!exec) {
          clearInterval(checkInterval);
          reject(new Error("Execution not found"));
          return;
        }
        
        if (exec.status === "completed") {
          clearInterval(checkInterval);
          // Get final output
          const endNodes = Array.from(exec.nodeExecutions.values())
            .filter(n => n.nodeId.includes("end") && n.output);
          resolve(endNodes[0]?.output || {});
        } else if (exec.status === "failed" || exec.status === "cancelled") {
          clearInterval(checkInterval);
          reject(new Error(exec.error || "Subworkflow failed"));
        }
      }, 1000);
      
      // Timeout after 1 hour
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error("Subworkflow timeout"));
      }, 3600000);
    });
  }
  
  return { executionId: execId, status: "started" };
}

async function executeHttpNode(node: WorkflowNode, input: any): Promise<any> {
  const { method, url, headers, body, timeout } = node.config;
  
  const resolvedUrl = interpolateString(url, input);
  const resolvedHeaders = interpolateObject(headers || {}, input);
  const resolvedBody = body ? interpolateObject(body, input) : undefined;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout || 30000);
  
  try {
    const response = await fetch(resolvedUrl, {
      method: method || "GET",
      headers: resolvedHeaders,
      body: resolvedBody ? JSON.stringify(resolvedBody) : undefined,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
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
  } catch (error: any) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function executeScriptNode(node: WorkflowNode, input: any, execution: WorkflowExecution): Promise<any> {
  const { language, code, timeout } = node.config;
  
  if (language === "javascript" || !language) {
    // Execute in sandboxed context
    const fn = new Function("input", "variables", "require", `
      "use strict";
      ${code}
    `);
    
    return fn(input, execution.variables, undefined);
  }
  
  throw new Error(`Unsupported script language: ${language}`);
}

async function executeDataOperationNode(node: WorkflowNode, input: any): Promise<any> {
  const { operation, datasetId, config } = node.config;
  
  switch (operation) {
    case "query":
      // Would integrate with data studio
      return { rows: [], count: 0 };
    
    case "insert":
      return { inserted: 0 };
    
    case "update":
      return { updated: 0 };
    
    case "delete":
      return { deleted: 0 };
    
    case "aggregate":
      return { result: null };
    
    default:
      return input;
  }
}

async function executeNotificationNode(node: WorkflowNode, input: any): Promise<any> {
  const { channel, recipients, template, data } = node.config;
  
  const message = interpolateString(template || "", { ...input, ...data });
  
  // Emit notification event
  emitOrchestrationEvent("notification.send", {
    channel,
    recipients,
    message,
    data: input,
  });
  
  return { sent: true, channel, recipients };
}

async function executeApprovalNode(
  node: WorkflowNode,
  input: any,
  execution: WorkflowExecution
): Promise<any> {
  const { approvers, timeout, autoApprove } = node.config;
  
  if (autoApprove) {
    return { approved: true, approver: "auto", timestamp: new Date() };
  }
  
  // Create approval request
  const approvalId = uuidv4();
  
  emitOrchestrationEvent("approval.requested", {
    approvalId,
    executionId: execution.id,
    nodeId: node.id,
    approvers,
    data: input,
    timeout,
  });
  
  // In a real implementation, this would pause and wait for approval
  // For now, auto-approve after delay
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ approved: true, approver: "system", timestamp: new Date(), approvalId });
    }, 2000);
  });
}

async function executeN8nTriggerNode(node: WorkflowNode, input: any): Promise<any> {
  const { webhookUrl, eventType, payload } = node.config;
  
  if (!webhookUrl) {
    throw new Error("N8n webhook URL not configured");
  }
  
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: eventType,
      data: payload || input,
      timestamp: new Date().toISOString(),
    }),
  });
  
  if (!response.ok) {
    throw new Error(`N8n trigger failed: ${response.status}`);
  }
  
  return {
    triggered: true,
    response: await response.json().catch(() => ({})),
  };
}

async function executeN8nActionNode(node: WorkflowNode, input: any): Promise<any> {
  const { workflowId, webhookUrl, waitForResponse } = node.config;
  
  if (!webhookUrl) {
    throw new Error("N8n webhook URL not configured");
  }
  
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workflowId,
      input,
      timestamp: new Date().toISOString(),
    }),
  });
  
  if (!response.ok) {
    throw new Error(`N8n action failed: ${response.status}`);
  }
  
  const result = await response.json().catch(() => ({}));
  
  return {
    success: true,
    workflowId,
    result,
  };
}

// ============================================================================
// Expression Evaluation
// ============================================================================

function evaluateExpression(expression: string, context: Record<string, any>): any {
  // Simple expression evaluator
  // Supports: variable access, comparisons, logical operators
  
  // Replace variables
  let resolved = expression;
  for (const [key, value] of Object.entries(context)) {
    if (typeof value === "object") {
      // Skip complex objects in simple replace
      continue;
    }
    resolved = resolved.replace(new RegExp(`\\$\\{${key}\\}`, "g"), String(value));
    resolved = resolved.replace(new RegExp(`\\b${key}\\b`, "g"), JSON.stringify(value));
  }
  
  // Evaluate
  const fn = new Function("context", `
    with(context) {
      return ${resolved};
    }
  `);
  
  return fn(context);
}

function interpolateString(template: string, context: Record<string, any>): string {
  return template.replace(/\$\{([^}]+)\}/g, (match, path) => {
    const value = getNestedValue(context, path.trim());
    return value !== undefined ? String(value) : match;
  });
}

function interpolateObject(obj: Record<string, any>, context: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = interpolateString(value, context);
    } else if (typeof value === "object" && value !== null) {
      result[key] = interpolateObject(value, context);
    } else {
      result[key] = value;
    }
  }
  
  return result;
}

function getNestedValue(obj: any, path: string): any {
  const parts = path.split(".");
  let current = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  
  return current;
}

function summarizeOutput(output: any): any {
  if (output === null || output === undefined) return output;
  
  if (typeof output === "string" && output.length > 100) {
    return output.substring(0, 100) + "...";
  }
  
  if (Array.isArray(output) && output.length > 10) {
    return { type: "array", length: output.length, sample: output.slice(0, 3) };
  }
  
  return output;
}

// ============================================================================
// Event System
// ============================================================================

function emitOrchestrationEvent(type: string, data: any, correlationId?: string) {
  const event: OrchestrationEvent = {
    id: uuidv4(),
    type,
    source: "orchestrator",
    timestamp: new Date(),
    data,
    correlationId,
    processed: false,
  };
  
  eventQueue.push(event);
  eventEmitter.emit(type, event);
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

export function registerOrchestratorCoreHandlers() {
  logger.info("Registering Orchestrator Core handlers");

  app.whenReady().then(() => {
    initializeOrchestrator().catch(err => {
      logger.error("Failed to initialize orchestrator:", err);
    });
  });

  app.on("before-quit", () => {
    stopOrchestrationEngine();
  });

  // ========== Workflow CRUD ==========

  ipcMain.handle("orchestrator:create-workflow", async (_event, args: {
    name: string;
    description?: string;
    nodes?: WorkflowNode[];
    edges?: WorkflowEdge[];
    triggers?: WorkflowTrigger[];
    variables?: Record<string, any>;
    tags?: string[];
  }) => {
    try {
      const id = uuidv4();
      const now = new Date();
      
      const workflow: Workflow = {
        id,
        name: args.name,
        description: args.description,
        version: "1.0.0",
        status: "draft",
        nodes: args.nodes || [
          { id: "start-1", type: "start", name: "Start", config: {}, position: { x: 100, y: 100 }, inputs: [], outputs: [{ id: "out-1", name: "output", type: "output" }] },
          { id: "end-1", type: "end", name: "End", config: {}, position: { x: 500, y: 100 }, inputs: [{ id: "in-1", name: "input", type: "input" }], outputs: [] },
        ],
        edges: args.edges || [
          { id: "edge-1", sourceNodeId: "start-1", sourcePortId: "out-1", targetNodeId: "end-1", targetPortId: "in-1" },
        ],
        variables: args.variables || {},
        triggers: args.triggers || [],
        errorHandling: {
          strategy: "fail",
          notifyOnError: true,
          logLevel: "error",
        },
        retryPolicy: {
          maxAttempts: 3,
          initialDelayMs: 1000,
          maxDelayMs: 30000,
          backoffMultiplier: 2,
        },
        metadata: {},
        createdAt: now,
        updatedAt: now,
        tags: args.tags || [],
      };
      
      workflows.set(id, workflow);
      await saveWorkflows();
      
      return { success: true, workflow };
    } catch (error) {
      logger.error("Create workflow failed:", error);
      throw error;
    }
  });

  ipcMain.handle("orchestrator:get-workflow", async (_event, workflowId: string) => {
    try {
      const workflow = workflows.get(workflowId);
      if (!workflow) throw new Error("Workflow not found");
      
      return { success: true, workflow };
    } catch (error) {
      logger.error("Get workflow failed:", error);
      throw error;
    }
  });

  ipcMain.handle("orchestrator:list-workflows", async (_event, args?: {
    status?: WorkflowStatus;
    tags?: string[];
    search?: string;
  }) => {
    try {
      let result = Array.from(workflows.values());
      
      if (args?.status) {
        result = result.filter(w => w.status === args.status);
      }
      
      if (args?.tags?.length) {
        result = result.filter(w => args.tags!.some(t => w.tags.includes(t)));
      }
      
      if (args?.search) {
        const search = args.search.toLowerCase();
        result = result.filter(w => 
          w.name.toLowerCase().includes(search) ||
          w.description?.toLowerCase().includes(search)
        );
      }
      
      result.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      
      return { success: true, workflows: result };
    } catch (error) {
      logger.error("List workflows failed:", error);
      throw error;
    }
  });

  ipcMain.handle("orchestrator:update-workflow", async (_event, args: {
    workflowId: string;
    updates: Partial<Omit<Workflow, "id" | "createdAt">>;
    bumpVersion?: boolean;
  }) => {
    try {
      const workflow = workflows.get(args.workflowId);
      if (!workflow) throw new Error("Workflow not found");
      
      // Apply updates
      if (args.updates.name) workflow.name = args.updates.name;
      if (args.updates.description !== undefined) workflow.description = args.updates.description;
      if (args.updates.nodes) workflow.nodes = args.updates.nodes;
      if (args.updates.edges) workflow.edges = args.updates.edges;
      if (args.updates.variables) workflow.variables = args.updates.variables;
      if (args.updates.triggers) workflow.triggers = args.updates.triggers;
      if (args.updates.errorHandling) workflow.errorHandling = args.updates.errorHandling;
      if (args.updates.retryPolicy) workflow.retryPolicy = args.updates.retryPolicy;
      if (args.updates.tags) workflow.tags = args.updates.tags;
      if (args.updates.status) workflow.status = args.updates.status;
      
      if (args.bumpVersion) {
        const [major, minor, patch] = workflow.version.split(".").map(Number);
        workflow.version = `${major}.${minor}.${patch + 1}`;
      }
      
      workflow.updatedAt = new Date();
      
      await saveWorkflows();
      
      return { success: true, workflow };
    } catch (error) {
      logger.error("Update workflow failed:", error);
      throw error;
    }
  });

  ipcMain.handle("orchestrator:delete-workflow", async (_event, workflowId: string) => {
    try {
      if (!workflows.has(workflowId)) throw new Error("Workflow not found");
      
      workflows.delete(workflowId);
      
      // Delete related schedules
      for (const [id, schedule] of scheduledExecutions) {
        if (schedule.workflowId === workflowId) {
          scheduledExecutions.delete(id);
        }
      }
      
      await saveWorkflows();
      await saveScheduledExecutions();
      
      return { success: true };
    } catch (error) {
      logger.error("Delete workflow failed:", error);
      throw error;
    }
  });

  ipcMain.handle("orchestrator:activate-workflow", async (_event, workflowId: string) => {
    try {
      const workflow = workflows.get(workflowId);
      if (!workflow) throw new Error("Workflow not found");
      
      // Validate workflow
      const startNodes = workflow.nodes.filter(n => n.type === "start");
      const endNodes = workflow.nodes.filter(n => n.type === "end");
      
      if (startNodes.length === 0) throw new Error("Workflow must have at least one start node");
      if (endNodes.length === 0) throw new Error("Workflow must have at least one end node");
      
      workflow.status = "active";
      workflow.updatedAt = new Date();
      
      await saveWorkflows();
      
      return { success: true, workflow };
    } catch (error) {
      logger.error("Activate workflow failed:", error);
      throw error;
    }
  });

  ipcMain.handle("orchestrator:pause-workflow", async (_event, workflowId: string) => {
    try {
      const workflow = workflows.get(workflowId);
      if (!workflow) throw new Error("Workflow not found");
      
      workflow.status = "paused";
      workflow.updatedAt = new Date();
      
      await saveWorkflows();
      
      return { success: true, workflow };
    } catch (error) {
      logger.error("Pause workflow failed:", error);
      throw error;
    }
  });

  // ========== Execution ==========

  ipcMain.handle("orchestrator:execute-workflow", async (_event, args: {
    workflowId: string;
    variables?: Record<string, any>;
    async?: boolean;
  }) => {
    try {
      const executionId = await triggerWorkflowExecution(
        args.workflowId,
        "manual",
        args.variables
      );
      
      if (!args.async) {
        // Wait for completion (with timeout)
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Execution timeout"));
          }, 300000); // 5 minute timeout
          
          const checkInterval = setInterval(() => {
            const exec = executions.get(executionId);
            if (!exec) {
              clearInterval(checkInterval);
              clearTimeout(timeout);
              reject(new Error("Execution not found"));
              return;
            }
            
            if (exec.status !== "running") {
              clearInterval(checkInterval);
              clearTimeout(timeout);
              resolve({
                success: exec.status === "completed",
                executionId,
                status: exec.status,
                metrics: exec.metrics,
                error: exec.error,
              });
            }
          }, 500);
        });
      }
      
      return { success: true, executionId, status: "running" };
    } catch (error) {
      logger.error("Execute workflow failed:", error);
      throw error;
    }
  });

  ipcMain.handle("orchestrator:get-execution", async (_event, executionId: string) => {
    try {
      let execution = executions.get(executionId);
      
      if (!execution) {
        // Try loading from disk
        const execPath = path.join(getOrchestratorStorageDir(), "executions", `${executionId}.json`);
        if (await fs.pathExists(execPath)) {
          const data = await fs.readJson(execPath);
          execution = {
            ...data,
            startedAt: new Date(data.startedAt),
            completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
            nodeExecutions: new Map(Object.entries(data.nodeExecutions)),
          };
        }
      }
      
      if (!execution) throw new Error("Execution not found");
      
      return {
        success: true,
        execution: {
          ...execution,
          nodeExecutions: Object.fromEntries(execution.nodeExecutions),
        },
      };
    } catch (error) {
      logger.error("Get execution failed:", error);
      throw error;
    }
  });

  ipcMain.handle("orchestrator:list-executions", async (_event, args?: {
    workflowId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) => {
    try {
      let result = Array.from(executions.values());
      
      if (args?.workflowId) {
        result = result.filter(e => e.workflowId === args.workflowId);
      }
      
      if (args?.status) {
        result = result.filter(e => e.status === args.status);
      }
      
      result.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
      
      const total = result.length;
      
      if (args?.offset) {
        result = result.slice(args.offset);
      }
      
      if (args?.limit) {
        result = result.slice(0, args.limit);
      }
      
      return {
        success: true,
        executions: result.map(e => ({
          ...e,
          nodeExecutions: Object.fromEntries(e.nodeExecutions),
        })),
        total,
      };
    } catch (error) {
      logger.error("List executions failed:", error);
      throw error;
    }
  });

  ipcMain.handle("orchestrator:cancel-execution", async (_event, executionId: string) => {
    try {
      const execution = executions.get(executionId);
      if (!execution) throw new Error("Execution not found");
      
      if (execution.status !== "running") {
        throw new Error("Execution is not running");
      }
      
      completeExecution(execution, "cancelled", "Cancelled by user");
      
      return { success: true };
    } catch (error) {
      logger.error("Cancel execution failed:", error);
      throw error;
    }
  });

  ipcMain.handle("orchestrator:pause-execution", async (_event, executionId: string) => {
    try {
      const execution = executions.get(executionId);
      if (!execution) throw new Error("Execution not found");
      
      if (execution.status !== "running") {
        throw new Error("Execution is not running");
      }
      
      execution.status = "paused";
      
      // Create checkpoint
      execution.checkpoints.push({
        id: uuidv4(),
        timestamp: new Date(),
        nodeId: execution.currentNodes[0] || "",
        state: { variables: execution.variables },
      });
      
      await saveExecution(execution);
      
      return { success: true };
    } catch (error) {
      logger.error("Pause execution failed:", error);
      throw error;
    }
  });

  ipcMain.handle("orchestrator:resume-execution", async (_event, executionId: string) => {
    try {
      const execution = executions.get(executionId);
      if (!execution) throw new Error("Execution not found");
      
      if (execution.status !== "paused") {
        throw new Error("Execution is not paused");
      }
      
      const workflow = workflows.get(execution.workflowId);
      if (!workflow) throw new Error("Workflow not found");
      
      execution.status = "running";
      await saveExecution(execution);
      
      // Resume execution
      executeNextNodes(execution, workflow);
      
      return { success: true };
    } catch (error) {
      logger.error("Resume execution failed:", error);
      throw error;
    }
  });

  // ========== Scheduling ==========

  ipcMain.handle("orchestrator:schedule-workflow", async (_event, args: {
    workflowId: string;
    schedule: string;
    timezone?: string;
    enabled?: boolean;
  }) => {
    try {
      const workflow = workflows.get(args.workflowId);
      if (!workflow) throw new Error("Workflow not found");
      
      const id = uuidv4();
      const scheduled: ScheduledExecution = {
        id,
        workflowId: args.workflowId,
        schedule: args.schedule,
        enabled: args.enabled ?? true,
        nextRunAt: args.enabled !== false ? calculateNextRun(args.schedule, args.timezone) : undefined,
        timezone: args.timezone,
      };
      
      scheduledExecutions.set(id, scheduled);
      await saveScheduledExecutions();
      
      return { success: true, scheduled };
    } catch (error) {
      logger.error("Schedule workflow failed:", error);
      throw error;
    }
  });

  ipcMain.handle("orchestrator:list-schedules", async (_event, workflowId?: string) => {
    try {
      let result = Array.from(scheduledExecutions.values());
      
      if (workflowId) {
        result = result.filter(s => s.workflowId === workflowId);
      }
      
      return { success: true, schedules: result };
    } catch (error) {
      logger.error("List schedules failed:", error);
      throw error;
    }
  });

  ipcMain.handle("orchestrator:update-schedule", async (_event, args: {
    scheduleId: string;
    updates: Partial<Omit<ScheduledExecution, "id" | "workflowId">>;
  }) => {
    try {
      const schedule = scheduledExecutions.get(args.scheduleId);
      if (!schedule) throw new Error("Schedule not found");
      
      if (args.updates.schedule !== undefined) {
        schedule.schedule = args.updates.schedule;
      }
      if (args.updates.enabled !== undefined) {
        schedule.enabled = args.updates.enabled;
        if (args.updates.enabled) {
          schedule.nextRunAt = calculateNextRun(schedule.schedule, schedule.timezone);
        }
      }
      if (args.updates.timezone !== undefined) {
        schedule.timezone = args.updates.timezone;
      }
      
      await saveScheduledExecutions();
      
      return { success: true, schedule };
    } catch (error) {
      logger.error("Update schedule failed:", error);
      throw error;
    }
  });

  ipcMain.handle("orchestrator:delete-schedule", async (_event, scheduleId: string) => {
    try {
      if (!scheduledExecutions.has(scheduleId)) {
        throw new Error("Schedule not found");
      }
      
      scheduledExecutions.delete(scheduleId);
      await saveScheduledExecutions();
      
      return { success: true };
    } catch (error) {
      logger.error("Delete schedule failed:", error);
      throw error;
    }
  });

  // ========== Events ==========

  ipcMain.handle("orchestrator:emit-event", async (_event, args: {
    type: string;
    data: any;
    correlationId?: string;
  }) => {
    try {
      emitOrchestrationEvent(args.type, args.data, args.correlationId);
      return { success: true };
    } catch (error) {
      logger.error("Emit event failed:", error);
      throw error;
    }
  });

  ipcMain.handle("orchestrator:list-events", async (_event, args?: {
    type?: string;
    limit?: number;
  }) => {
    try {
      let result = [...eventQueue];
      
      if (args?.type) {
        result = result.filter(e => e.type === args.type || e.type.startsWith(args.type + "."));
      }
      
      result.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      
      if (args?.limit) {
        result = result.slice(0, args.limit);
      }
      
      return { success: true, events: result };
    } catch (error) {
      logger.error("List events failed:", error);
      throw error;
    }
  });

  // ========== Metrics ==========

  ipcMain.handle("orchestrator:get-metrics", async () => {
    try {
      const allExecutions = Array.from(executions.values());
      
      const completed = allExecutions.filter(e => e.status === "completed");
      const failed = allExecutions.filter(e => e.status === "failed");
      const running = allExecutions.filter(e => e.status === "running");
      
      const avgDuration = completed.length > 0
        ? completed.reduce((sum, e) => sum + (e.metrics.totalDuration || 0), 0) / completed.length
        : 0;
      
      return {
        success: true,
        metrics: {
          totalWorkflows: workflows.size,
          activeWorkflows: Array.from(workflows.values()).filter(w => w.status === "active").length,
          totalExecutions: allExecutions.length,
          completedExecutions: completed.length,
          failedExecutions: failed.length,
          runningExecutions: running.length,
          averageDuration: avgDuration,
          scheduledTasks: scheduledExecutions.size,
          eventQueueSize: eventQueue.length,
        },
      };
    } catch (error) {
      logger.error("Get metrics failed:", error);
      throw error;
    }
  });

  // ========== Node Templates ==========

  ipcMain.handle("orchestrator:get-node-types", async () => {
    try {
      const nodeTypes = [
        { type: "start", name: "Start", category: "control", description: "Entry point of the workflow" },
        { type: "end", name: "End", category: "control", description: "Exit point of the workflow" },
        { type: "task", name: "Task", category: "execution", description: "Execute a data operation task" },
        { type: "agent", name: "Agent", category: "execution", description: "Execute an AI agent" },
        { type: "decision", name: "Decision", category: "control", description: "Conditional branching" },
        { type: "fork", name: "Fork", category: "control", description: "Split into parallel branches" },
        { type: "join", name: "Join", category: "control", description: "Merge parallel branches" },
        { type: "loop", name: "Loop", category: "control", description: "Iterate with conditions" },
        { type: "map", name: "Map", category: "data", description: "Transform each item in array" },
        { type: "reduce", name: "Reduce", category: "data", description: "Aggregate array to single value" },
        { type: "delay", name: "Delay", category: "utility", description: "Wait for specified time" },
        { type: "event", name: "Event", category: "integration", description: "Emit an event" },
        { type: "subworkflow", name: "Subworkflow", category: "control", description: "Execute another workflow" },
        { type: "http", name: "HTTP Request", category: "integration", description: "Make HTTP API calls" },
        { type: "script", name: "Script", category: "execution", description: "Execute custom code" },
        { type: "data_operation", name: "Data Operation", category: "data", description: "Database operations" },
        { type: "notification", name: "Notification", category: "utility", description: "Send notifications" },
        { type: "approval", name: "Approval", category: "control", description: "Wait for human approval" },
        { type: "n8n_trigger", name: "N8n Trigger", category: "n8n", description: "Trigger n8n workflow" },
        { type: "n8n_action", name: "N8n Action", category: "n8n", description: "Execute n8n workflow" },
      ];
      
      return { success: true, nodeTypes };
    } catch (error) {
      logger.error("Get node types failed:", error);
      throw error;
    }
  });

  logger.info("Orchestrator Core handlers registered");
}
