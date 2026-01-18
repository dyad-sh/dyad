/**
 * n8n Integration Service
 * Connects agents to n8n for workflow automation
 */

import { IpcMainInvokeEvent, ipcMain } from "electron";
import { spawn, ChildProcess } from "child_process";
import path from "node:path";
import fs from "fs-extra";
import log from "electron-log";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getUserDataPath } from "@/paths/paths";

import type {
  N8nWorkflow,
  N8nNode,
  N8nConnections,
  N8nApiConfig,
  N8nExecutionResult,
  WorkflowBuildRequest,
  WorkflowGenerationRequest,
  WorkflowGenerationResult,
  AgentMessage,
  AgentCollaboration,
  N8N_NODE_TYPES,
} from "@/types/n8n_types";

const logger = log.scope("n8n_integration");

// ============================================================================
// n8n Configuration Types
// ============================================================================

export interface N8nDatabaseConfig {
  type: "sqlite" | "postgresdb";
  // PostgreSQL specific
  postgresHost?: string;
  postgresPort?: number;
  postgresDatabase?: string;
  postgresUser?: string;
  postgresPassword?: string;
  postgresSchema?: string;
  postgresSsl?: boolean;
}

// Default to SQLite for simplicity - no external database server needed
// Users can switch to PostgreSQL in settings if they have it configured
let n8nDbConfig: N8nDatabaseConfig = {
  type: "sqlite",
};

// ============================================================================
// n8n Process Management
// ============================================================================

let n8nProcess: ChildProcess | null = null;
let n8nConfig: N8nApiConfig = {
  baseUrl: "http://localhost:5678",
};

/**
 * Configure n8n database settings
 */
export function configureN8nDatabase(config: Partial<N8nDatabaseConfig>): void {
  n8nDbConfig = { ...n8nDbConfig, ...config };
  logger.info("n8n database configured:", { type: n8nDbConfig.type });
}

/**
 * Get environment variables for n8n database
 */
function getN8nDatabaseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  
  if (n8nDbConfig.type === "postgresdb") {
    env.DB_TYPE = "postgresdb";
    env.DB_POSTGRESDB_HOST = n8nDbConfig.postgresHost || "localhost";
    env.DB_POSTGRESDB_PORT = String(n8nDbConfig.postgresPort || 5432);
    env.DB_POSTGRESDB_DATABASE = n8nDbConfig.postgresDatabase || "n8n";
    env.DB_POSTGRESDB_USER = n8nDbConfig.postgresUser || "postgres";
    env.DB_POSTGRESDB_PASSWORD = n8nDbConfig.postgresPassword || "postgres";
    env.DB_POSTGRESDB_SCHEMA = n8nDbConfig.postgresSchema || "public";
    if (n8nDbConfig.postgresSsl) {
      env.DB_POSTGRESDB_SSL_ENABLED = "true";
    }
  } else {
    // SQLite fallback - store in user data directory
    env.DB_TYPE = "sqlite";
    env.DB_SQLITE_DATABASE = path.join(getUserDataPath(), "n8n.sqlite");
  }
  
  return env;
}

export async function startN8n(): Promise<{ success: boolean; error?: string }> {
  if (n8nProcess) {
    return { success: true };
  }

  try {
    logger.info("Starting n8n with database type:", n8nDbConfig.type);
    
    const dbEnv = getN8nDatabaseEnv();
    
    // Use npx to run n8n
    n8nProcess = spawn("npx", ["n8n", "start"], {
      shell: true,
      env: {
        ...process.env,
        ...dbEnv,
        N8N_PORT: "5678",
        N8N_PROTOCOL: "http",
        N8N_HOST: "localhost",
        GENERIC_TIMEZONE: "UTC",
        N8N_SECURE_COOKIE: "false",
        // User data directory for n8n
        N8N_USER_FOLDER: path.join(getUserDataPath(), "n8n"),
      },
      detached: false,
    });

    n8nProcess.stdout?.on("data", (data) => {
      logger.info(`n8n: ${data}`);
    });

    n8nProcess.stderr?.on("data", (data) => {
      logger.error(`n8n error: ${data}`);
    });

    n8nProcess.on("close", (code) => {
      logger.info(`n8n process exited with code ${code}`);
      n8nProcess = null;
    });

    // Wait for n8n to be ready
    await waitForN8n();
    
    return { success: true };
  } catch (error) {
    logger.error("Failed to start n8n:", error);
    return { success: false, error: String(error) };
  }
}

export async function stopN8n(): Promise<void> {
  if (n8nProcess) {
    n8nProcess.kill();
    n8nProcess = null;
    logger.info("n8n stopped");
  }
}

async function waitForN8n(maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${n8nConfig.baseUrl}/healthz`);
      if (response.ok) {
        logger.info("n8n is ready");
        return;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("n8n failed to start within timeout");
}

export function isN8nRunning(): boolean {
  return n8nProcess !== null;
}

// ============================================================================
// n8n API Client
// ============================================================================

async function n8nApiRequest<T>(
  method: string,
  endpoint: string,
  body?: unknown
): Promise<T> {
  const url = `${n8nConfig.baseUrl}/api/v1${endpoint}`;
  
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  
  if (n8nConfig.apiKey) {
    headers["X-N8N-API-KEY"] = n8nConfig.apiKey;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`n8n API error: ${response.status} - ${error}`);
  }

  return response.json();
}

// ============================================================================
// Workflow Management
// ============================================================================

export async function createWorkflow(workflow: N8nWorkflow): Promise<N8nWorkflow> {
  return n8nApiRequest<N8nWorkflow>("POST", "/workflows", workflow);
}

export async function updateWorkflow(id: string, workflow: N8nWorkflow): Promise<N8nWorkflow> {
  return n8nApiRequest<N8nWorkflow>("PATCH", `/workflows/${id}`, workflow);
}

export async function getWorkflow(id: string): Promise<N8nWorkflow> {
  return n8nApiRequest<N8nWorkflow>("GET", `/workflows/${id}`);
}

export async function listWorkflows(): Promise<{ data: N8nWorkflow[] }> {
  return n8nApiRequest<{ data: N8nWorkflow[] }>("GET", "/workflows");
}

export async function deleteWorkflow(id: string): Promise<void> {
  await n8nApiRequest<void>("DELETE", `/workflows/${id}`);
}

export async function activateWorkflow(id: string): Promise<N8nWorkflow> {
  return n8nApiRequest<N8nWorkflow>("POST", `/workflows/${id}/activate`);
}

export async function deactivateWorkflow(id: string): Promise<N8nWorkflow> {
  return n8nApiRequest<N8nWorkflow>("POST", `/workflows/${id}/deactivate`);
}

export async function executeWorkflow(id: string, data?: Record<string, unknown>): Promise<N8nExecutionResult> {
  return n8nApiRequest<N8nExecutionResult>("POST", `/workflows/${id}/execute`, { data });
}

// ============================================================================
// Workflow Builder - AI-Powered Workflow Generation
// ============================================================================

export async function generateWorkflow(
  request: WorkflowGenerationRequest
): Promise<WorkflowGenerationResult> {
  try {
    // Parse the prompt to understand what workflow to build
    const workflowSpec = parseWorkflowPrompt(request.prompt);
    
    // Build the workflow structure
    const workflow = buildWorkflowFromSpec(workflowSpec, request.constraints);
    
    // Validate the workflow
    const validation = validateWorkflow(workflow);
    
    if (!validation.valid) {
      return {
        success: false,
        errors: validation.errors,
      };
    }

    return {
      success: true,
      workflow,
      explanation: `Created workflow with ${workflow.nodes.length} nodes: ${workflowSpec.description}`,
      warnings: validation.warnings,
    };
  } catch (error) {
    return {
      success: false,
      errors: [String(error)],
    };
  }
}

interface WorkflowSpec {
  description: string;
  trigger: { type: string; config: Record<string, unknown> };
  steps: Array<{ type: string; name: string; config: Record<string, unknown> }>;
  errorHandling: boolean;
}

function parseWorkflowPrompt(prompt: string): WorkflowSpec {
  const promptLower = prompt.toLowerCase();
  
  // Detect trigger type
  let trigger = { type: "n8n-nodes-base.manualTrigger", config: {} };
  if (promptLower.includes("webhook") || promptLower.includes("api")) {
    trigger = { type: "n8n-nodes-base.webhook", config: { httpMethod: "POST", path: "webhook" } };
  } else if (promptLower.includes("schedule") || promptLower.includes("cron") || promptLower.includes("every")) {
    trigger = { type: "n8n-nodes-base.scheduleTrigger", config: { rule: { interval: [{ field: "hours", value: 1 }] } } };
  } else if (promptLower.includes("email")) {
    trigger = { type: "n8n-nodes-base.emailReadImap", config: {} };
  }

  // Detect steps
  const steps: WorkflowSpec["steps"] = [];
  
  if (promptLower.includes("http") || promptLower.includes("api") || promptLower.includes("fetch")) {
    steps.push({ type: "n8n-nodes-base.httpRequest", name: "HTTP Request", config: { method: "GET" } });
  }
  
  if (promptLower.includes("openai") || promptLower.includes("gpt") || promptLower.includes("ai")) {
    steps.push({ type: "n8n-nodes-base.openAi", name: "OpenAI", config: { operation: "message", model: "gpt-4" } });
  }
  
  if (promptLower.includes("slack")) {
    steps.push({ type: "n8n-nodes-base.slack", name: "Slack", config: { operation: "postMessage" } });
  }
  
  if (promptLower.includes("email") || promptLower.includes("send")) {
    steps.push({ type: "n8n-nodes-base.emailSend", name: "Send Email", config: {} });
  }
  
  if (promptLower.includes("database") || promptLower.includes("postgres")) {
    steps.push({ type: "n8n-nodes-base.postgres", name: "Postgres", config: { operation: "select" } });
  }

  if (promptLower.includes("code") || promptLower.includes("transform") || promptLower.includes("process")) {
    steps.push({ type: "n8n-nodes-base.code", name: "Code", config: { language: "javaScript" } });
  }

  // If no steps detected, add a basic set node
  if (steps.length === 0) {
    steps.push({ type: "n8n-nodes-base.set", name: "Set Data", config: {} });
  }

  return {
    description: prompt,
    trigger,
    steps,
    errorHandling: promptLower.includes("error") || promptLower.includes("retry"),
  };
}

function buildWorkflowFromSpec(
  spec: WorkflowSpec,
  constraints?: WorkflowGenerationRequest["constraints"]
): N8nWorkflow {
  const nodes: N8nNode[] = [];
  const connections: N8nConnections = {};
  
  let xPos = 250;
  const yPos = 300;
  const spacing = 200;

  // Add trigger node
  const triggerId = generateNodeId();
  const triggerNode: N8nNode = {
    id: triggerId,
    name: "Trigger",
    type: spec.trigger.type,
    typeVersion: 1,
    position: [xPos, yPos],
    parameters: spec.trigger.config,
  };
  nodes.push(triggerNode);
  
  let prevNodeName = triggerNode.name;
  xPos += spacing;

  // Add step nodes
  for (const step of spec.steps) {
    if (constraints?.maxNodes && nodes.length >= constraints.maxNodes) {
      break;
    }

    const nodeId = generateNodeId();
    const node: N8nNode = {
      id: nodeId,
      name: step.name,
      type: step.type,
      typeVersion: 1,
      position: [xPos, yPos],
      parameters: step.config,
    };
    nodes.push(node);

    // Connect to previous node
    if (!connections[prevNodeName]) {
      connections[prevNodeName] = { main: [[]] };
    }
    connections[prevNodeName].main[0].push({
      node: node.name,
      type: "main",
      index: 0,
    });

    prevNodeName = node.name;
    xPos += spacing;
  }

  // Add error handling if requested
  if (spec.errorHandling) {
    const errorNodeId = generateNodeId();
    const errorNode: N8nNode = {
      id: errorNodeId,
      name: "Error Handler",
      type: "n8n-nodes-base.noOp",
      typeVersion: 1,
      position: [xPos, yPos + 150],
      parameters: {},
      notes: "Handle errors here",
    };
    nodes.push(errorNode);
  }

  return {
    name: `Generated: ${spec.description.slice(0, 50)}...`,
    active: false,
    nodes,
    connections,
    settings: {
      executionOrder: "v1",
      saveManualExecutions: true,
    },
  };
}

function generateNodeId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function validateWorkflow(workflow: N8nWorkflow): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!workflow.nodes || workflow.nodes.length === 0) {
    errors.push("Workflow must have at least one node");
  }

  // Check for trigger node
  const hasTrigger = workflow.nodes.some((n) =>
    n.type.includes("Trigger") || n.type.includes("webhook") || n.type.includes("cron")
  );
  if (!hasTrigger) {
    warnings.push("Workflow has no trigger node - it can only be executed manually");
  }

  // Check for orphan nodes (not connected)
  const connectedNodes = new Set<string>();
  for (const [source, conns] of Object.entries(workflow.connections)) {
    connectedNodes.add(source);
    for (const outputs of Object.values(conns)) {
      for (const output of outputs) {
        for (const conn of output) {
          connectedNodes.add(conn.node);
        }
      }
    }
  }
  
  for (const node of workflow.nodes) {
    if (!connectedNodes.has(node.name) && workflow.nodes.length > 1) {
      warnings.push(`Node "${node.name}" is not connected to the workflow`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Meta Workflow Builder - Workflow that Builds Workflows
// ============================================================================

export function createMetaWorkflowBuilder(): N8nWorkflow {
  return {
    name: "Meta Workflow Builder",
    active: true,
    nodes: [
      {
        id: generateNodeId(),
        name: "Webhook Trigger",
        type: "n8n-nodes-base.webhook",
        typeVersion: 1,
        position: [250, 300],
        parameters: {
          httpMethod: "POST",
          path: "build-workflow",
          responseMode: "responseNode",
        },
      },
      {
        id: generateNodeId(),
        name: "Parse Request",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [450, 300],
        parameters: {
          language: "javaScript",
          code: `// Parse the workflow build request
const request = $input.first().json;

return [{
  json: {
    prompt: request.prompt || '',
    agentId: request.agentId,
    constraints: request.constraints || {},
    timestamp: new Date().toISOString()
  }
}];`,
        },
      },
      {
        id: generateNodeId(),
        name: "AI Workflow Designer",
        type: "n8n-nodes-base.openAi",
        typeVersion: 1,
        position: [650, 300],
        parameters: {
          operation: "message",
          model: "gpt-4",
          messages: {
            values: [
              {
                role: "system",
                content: `You are an n8n workflow designer. Given a description, output a valid n8n workflow JSON.

Available node types:
- Triggers: webhook, scheduleTrigger, manualTrigger
- Actions: httpRequest, code, set, if, switch, merge
- Integrations: slack, discord, email, postgres, mongodb
- AI: openAi, agent, chainLlm

Output format: { "name": "...", "nodes": [...], "connections": {...} }`,
              },
              {
                role: "user",
                content: "={{ $json.prompt }}",
              },
            ],
          },
        },
      },
      {
        id: generateNodeId(),
        name: "Parse AI Response",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [850, 300],
        parameters: {
          language: "javaScript",
          code: `// Parse AI response and extract workflow JSON
const aiResponse = $input.first().json.message.content;

try {
  // Extract JSON from response
  const jsonMatch = aiResponse.match(/\\{[\\s\\S]*\\}/);
  if (jsonMatch) {
    const workflow = JSON.parse(jsonMatch[0]);
    return [{ json: { success: true, workflow } }];
  }
  return [{ json: { success: false, error: 'No valid JSON found' } }];
} catch (e) {
  return [{ json: { success: false, error: e.message } }];
}`,
        },
      },
      {
        id: generateNodeId(),
        name: "Create Workflow",
        type: "n8n-nodes-base.n8n",
        typeVersion: 1,
        position: [1050, 300],
        parameters: {
          operation: "create",
          workflowObject: "={{ $json.workflow }}",
        },
      },
      {
        id: generateNodeId(),
        name: "Respond",
        type: "n8n-nodes-base.respondToWebhook",
        typeVersion: 1,
        position: [1250, 300],
        parameters: {
          respondWith: "json",
          responseBody: "={{ $json }}",
        },
      },
    ],
    connections: {
      "Webhook Trigger": {
        main: [[{ node: "Parse Request", type: "main", index: 0 }]],
      },
      "Parse Request": {
        main: [[{ node: "AI Workflow Designer", type: "main", index: 0 }]],
      },
      "AI Workflow Designer": {
        main: [[{ node: "Parse AI Response", type: "main", index: 0 }]],
      },
      "Parse AI Response": {
        main: [[{ node: "Create Workflow", type: "main", index: 0 }]],
      },
      "Create Workflow": {
        main: [[{ node: "Respond", type: "main", index: 0 }]],
      },
    },
    settings: {
      executionOrder: "v1",
    },
  };
}

// ============================================================================
// Agent Communication System
// ============================================================================

const agentMessages: Map<string, AgentMessage[]> = new Map();
const collaborations: Map<string, AgentCollaboration> = new Map();

export function sendAgentMessage(message: Omit<AgentMessage, "id" | "timestamp" | "status">): AgentMessage {
  const fullMessage: AgentMessage = {
    ...message,
    id: generateNodeId(),
    timestamp: Date.now(),
    status: "pending",
  };

  // Store message
  const key = message.toAgentId === "broadcast" ? "broadcast" : String(message.toAgentId);
  if (!agentMessages.has(key)) {
    agentMessages.set(key, []);
  }
  agentMessages.get(key)!.push(fullMessage);

  logger.info(`Agent message sent: ${message.fromAgentId} -> ${message.toAgentId}`);
  
  return fullMessage;
}

export function getAgentMessages(agentId: number): AgentMessage[] {
  const direct = agentMessages.get(String(agentId)) || [];
  const broadcast = agentMessages.get("broadcast") || [];
  return [...direct, ...broadcast].sort((a, b) => b.timestamp - a.timestamp);
}

export function createCollaboration(
  name: string,
  agentIds: number[]
): AgentCollaboration {
  const collab: AgentCollaboration = {
    id: generateNodeId(),
    name,
    agentIds,
    status: "active",
    createdAt: Date.now(),
    messages: [],
  };
  
  collaborations.set(collab.id, collab);
  return collab;
}

export function getCollaboration(id: string): AgentCollaboration | undefined {
  return collaborations.get(id);
}

export function listCollaborations(): AgentCollaboration[] {
  return Array.from(collaborations.values());
}

// ============================================================================
// Agent-to-Agent Workflow Builder
// ============================================================================

export function createAgentCollaborationWorkflow(agentIds: number[]): N8nWorkflow {
  return {
    name: "Agent Collaboration Hub",
    active: true,
    nodes: [
      {
        id: generateNodeId(),
        name: "Message Webhook",
        type: "n8n-nodes-base.webhook",
        typeVersion: 1,
        position: [250, 300],
        parameters: {
          httpMethod: "POST",
          path: "agent-message",
          responseMode: "responseNode",
        },
      },
      {
        id: generateNodeId(),
        name: "Route Message",
        type: "n8n-nodes-base.switch",
        typeVersion: 3,
        position: [450, 300],
        parameters: {
          rules: {
            values: [
              {
                conditions: {
                  conditions: [
                    { leftValue: "={{ $json.type }}", operator: { value: "equals" }, rightValue: "workflow-request" },
                  ],
                },
                output: 0,
              },
              {
                conditions: {
                  conditions: [
                    { leftValue: "={{ $json.type }}", operator: { value: "equals" }, rightValue: "task" },
                  ],
                },
                output: 1,
              },
            ],
          },
        },
      },
      {
        id: generateNodeId(),
        name: "Build Workflow",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4,
        position: [650, 200],
        parameters: {
          method: "POST",
          url: "http://localhost:5678/webhook/build-workflow",
          body: "={{ JSON.stringify($json) }}",
          contentType: "application/json",
        },
      },
      {
        id: generateNodeId(),
        name: "Execute Task",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [650, 400],
        parameters: {
          language: "javaScript",
          code: `// Process agent task
const task = $input.first().json;

// Execute task logic here
const result = {
  taskId: task.id,
  status: 'completed',
  result: 'Task processed successfully',
  timestamp: new Date().toISOString()
};

return [{ json: result }];`,
        },
      },
      {
        id: generateNodeId(),
        name: "Notify Agents",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4,
        position: [850, 300],
        parameters: {
          method: "POST",
          url: "http://localhost:3000/api/agent-notification",
          body: "={{ JSON.stringify($json) }}",
          contentType: "application/json",
        },
      },
      {
        id: generateNodeId(),
        name: "Respond",
        type: "n8n-nodes-base.respondToWebhook",
        typeVersion: 1,
        position: [1050, 300],
        parameters: {
          respondWith: "json",
          responseBody: "={{ $json }}",
        },
      },
    ],
    connections: {
      "Message Webhook": {
        main: [[{ node: "Route Message", type: "main", index: 0 }]],
      },
      "Route Message": {
        main: [
          [{ node: "Build Workflow", type: "main", index: 0 }],
          [{ node: "Execute Task", type: "main", index: 0 }],
        ],
      },
      "Build Workflow": {
        main: [[{ node: "Notify Agents", type: "main", index: 0 }]],
      },
      "Execute Task": {
        main: [[{ node: "Notify Agents", type: "main", index: 0 }]],
      },
      "Notify Agents": {
        main: [[{ node: "Respond", type: "main", index: 0 }]],
      },
    },
    settings: {
      executionOrder: "v1",
    },
  };
}

// ============================================================================
// IPC Handlers
// ============================================================================

export function registerN8nHandlers(): void {
  // n8n Process Management
  ipcMain.handle("n8n:start", async () => startN8n());
  ipcMain.handle("n8n:stop", async () => stopN8n());
  ipcMain.handle("n8n:status", async () => ({ running: isN8nRunning() }));
  
  // Database Configuration
  ipcMain.handle("n8n:db:configure", async (_event, config: Partial<N8nDatabaseConfig>) => {
    configureN8nDatabase(config);
    return { success: true };
  });
  ipcMain.handle("n8n:db:get-config", async () => n8nDbConfig);
  
  // Workflow Management
  ipcMain.handle("n8n:workflow:create", async (_event, workflow: N8nWorkflow) => createWorkflow(workflow));
  ipcMain.handle("n8n:workflow:update", async (_event, id: string, workflow: N8nWorkflow) => updateWorkflow(id, workflow));
  ipcMain.handle("n8n:workflow:get", async (_event, id: string) => getWorkflow(id));
  ipcMain.handle("n8n:workflow:list", async () => listWorkflows());
  ipcMain.handle("n8n:workflow:delete", async (_event, id: string) => deleteWorkflow(id));
  ipcMain.handle("n8n:workflow:activate", async (_event, id: string) => activateWorkflow(id));
  ipcMain.handle("n8n:workflow:deactivate", async (_event, id: string) => deactivateWorkflow(id));
  ipcMain.handle("n8n:workflow:execute", async (_event, id: string, data?: Record<string, unknown>) => executeWorkflow(id, data));
  
  // AI Workflow Generation
  ipcMain.handle("n8n:workflow:generate", async (_event, request: WorkflowGenerationRequest) => generateWorkflow(request));
  ipcMain.handle("n8n:meta-builder:create", async () => createMetaWorkflowBuilder());
  
  // Agent Communication
  ipcMain.handle("n8n:agent:send-message", async (_event, message) => sendAgentMessage(message));
  ipcMain.handle("n8n:agent:get-messages", async (_event, agentId: number) => getAgentMessages(agentId));
  ipcMain.handle("n8n:agent:create-collaboration", async (_event, name: string, agentIds: number[]) => createCollaboration(name, agentIds));
  ipcMain.handle("n8n:agent:get-collaboration", async (_event, id: string) => getCollaboration(id));
  ipcMain.handle("n8n:agent:list-collaborations", async () => listCollaborations());
  ipcMain.handle("n8n:agent:create-collab-workflow", async (_event, agentIds: number[]) => createAgentCollaborationWorkflow(agentIds));

  logger.info("n8n IPC handlers registered");
}
